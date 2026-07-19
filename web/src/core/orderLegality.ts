// ABOUTME: Independent legality oracle for guided build orders: replays a BuildStep schedule from an
// ABOUTME: empty board, enforcing the in-game rules at every step, and exposes the per-step standing
// ABOUTME: states so the panel's popup shows exactly what the judge saw (the verified-or-absent gate).
import type { BuildStep, ReachCon, Vec } from "./reachability";

// Deliberately duplicated from reachability.ts (its private CAP_MAX): the oracle must not import engine code. Keep in sync.
const CAP_MAX: Vec = [20, 8, 20, 10, 20];
const zero = (): Vec => [0, 0, 0, 0, 0];
const addCap = (g: Vec, x: Vec): Vec => g.map((n, i) => Math.min(n + x[i]!, CAP_MAX[i]!)) as Vec;
const maxV = (a: Vec, b: Vec): Vec => a.map((n, i) => Math.max(n, b[i]!)) as Vec;
const covers = (g: Vec, d: Vec): boolean => g.every((n, i) => n >= d[i]!);

/** Post-step affinity state for one build-order step, from the same replay that judges legality. */
export interface StepState {
  have: Vec; // capped grant sum of standing complete constellations after the step
  need: Vec; // elementwise max requirement over standing constellations after the step
  needSource: Map<number, string[]>; // per color index, the standing constellation ids demanding it
  conReq: Vec; // the step's own constellation requirement (target-override lookup)
  conGrant: Vec; // the step's own constellation grant (zero for synthetic partials)
}

/**
 * The verification walk with its states exposed. Replays `steps` from an empty board, enforcing the
 * in-game rules at the conservative mid-step point (a step's requirement stands at its first star,
 * its grant only at completion; a refund loses the grant at the first refunded star while the
 * requirement stands until zero):
 *  - every standing constellation's requirement is covered by standing completed grants (the in-game
 *    "removal cannot strand a dependent" rule, docs/devotion-system.md, the refunded one included);
 *  - an add lands at or under `cap`, and `heldAfter` matches the running total at every step;
 *  - the end state is exactly `target`.
 * `target` members take precedence over `allCons` in lookups so the panel's synthetic partial members
 * (selected-star size, zero grant) are judged at their real standing size. `error` is null when the
 * whole schedule is legal, else the first violation; `states` holds one post-step entry per step that
 * completed its checks (a step failing pre-add or mid-refund contributes no state). Pure: fresh
 * vectors and maps per entry, nothing of the caller's is mutated.
 */
export function replayBuildOrder(
  allCons: ReachCon[],
  target: ReachCon[],
  steps: BuildStep[],
  cap: number,
): { error: string | null; states: StepState[] } {
  const conOf = new Map(allCons.map((c) => [c.id, c]));
  for (const t of target) conOf.set(t.id, t);
  const standing = new Set<string>();
  const states: StepState[] = [];
  let running = 0;
  const fail = (error: string) => ({ error, states });
  // The post-step standing state (fresh structures per call). covers(have, need) IS the post-step
  // legality check, so what the popup renders is literally what the judge saw.
  const standingState = (): { have: Vec; need: Vec; needSource: Map<number, string[]> } => {
    let have = zero();
    let need = zero();
    const needSource = new Map<number, string[]>();
    for (const id of standing) {
      const c = conOf.get(id)!;
      have = addCap(have, c.grant);
      need = maxV(need, c.req);
      for (let i = 0; i < 5; i++)
        if (c.req[i]! > 0) {
          const list = needSource.get(i) ?? [];
          list.push(id);
          needSource.set(i, list);
        }
    }
    return { have, need, needSource };
  };
  // Mid-step validity; `pending` is a constellation whose requirement must count but whose grant
  // must not (the conservative mid-step point).
  const check = (label: string, pending: string): string | null => {
    let grant = zero();
    let req = zero();
    for (const id of standing) {
      const c = conOf.get(id)!;
      req = maxV(req, c.req);
      if (id !== pending) grant = addCap(grant, c.grant);
    }
    if (!standing.has(pending)) req = maxV(req, conOf.get(pending)!.req);
    return covers(grant, req) ? null : `${label}: requirement uncovered`;
  };
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    const c = conOf.get(s.conId);
    if (!c) return fail(`step ${i}: unknown constellation ${s.conId}`);
    if (s.kind === "scaffold-refund") {
      if (!standing.has(s.conId)) return fail(`step ${i} (${s.conId}): refund of a constellation not standing`);
      if (s.points !== -c.size) return fail(`step ${i} (${s.conId}): refund points ${s.points}, expected ${-c.size}`);
      const mid = check(`step ${i} (${s.conId}) mid-refund`, s.conId);
      if (mid) return fail(mid);
      standing.delete(s.conId);
      running -= c.size;
      const st = standingState();
      if (!covers(st.have, st.need)) return fail(`step ${i} (${s.conId}) post-refund: requirement uncovered`);
      states.push({ ...st, conReq: c.req, conGrant: c.grant });
    } else {
      if (standing.has(s.conId)) return fail(`step ${i} (${s.conId}): added while already standing`);
      if (s.points !== c.size) return fail(`step ${i} (${s.conId}): add points ${s.points}, expected ${c.size}`);
      const mid = check(`step ${i} (${s.conId}) pre-add`, s.conId);
      if (mid) return fail(mid);
      standing.add(s.conId);
      running += c.size;
      if (running > cap) return fail(`step ${i} (${s.conId}): cap exceeded (${running} > ${cap})`);
      const st = standingState();
      if (!covers(st.have, st.need)) return fail(`step ${i} (${s.conId}) post-add: requirement uncovered`);
      states.push({ ...st, conReq: c.req, conGrant: c.grant });
    }
    if (s.heldAfter !== running)
      return fail(`step ${i} (${s.conId}): heldAfter=${s.heldAfter}, running total is ${running}`);
  }
  const want = new Set(target.map((c) => c.id));
  if (want.size !== standing.size) return fail(`end state: ${standing.size} standing, ${want.size} wanted`);
  for (const id of want) if (!standing.has(id)) return fail(`end state: ${id} missing`);
  return { error: null, states };
}

/** The replay's verdict alone: null when every step is legal in-game, else the first violation. */
export function verifyBuildOrder(
  allCons: ReachCon[],
  target: ReachCon[],
  steps: BuildStep[],
  cap: number,
): string | null {
  return replayBuildOrder(allCons, target, steps, cap).error;
}

/** A verified order together with the per-step states its verifying replay produced. */
export interface GatedOrder {
  steps: BuildStep[];
  states: StepState[];
}

/** The verified-or-absent gate: pass a schedule through, with its states, only when the replay proves it legal. */
export function gateBuildOrder(
  allCons: ReachCon[],
  target: ReachCon[],
  steps: BuildStep[] | null,
  cap: number,
): GatedOrder | null {
  if (!steps) return null;
  const r = replayBuildOrder(allCons, target, steps, cap);
  return r.error === null ? { steps, states: r.states } : null;
}
