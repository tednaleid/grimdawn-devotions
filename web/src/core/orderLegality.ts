// ABOUTME: Independent legality oracle for guided build orders: replays a BuildStep schedule from an
// ABOUTME: empty board, enforcing the in-game rules at every step, and exposes the per-step standing
// ABOUTME: states so the panel's popup shows exactly what the judge saw (the verified-or-absent gate).
import type { BuildStep, ReachCon, Vec } from "./reachability";

// Grants sum uncapped, as in the game (the engine's CAP_MAX clamp is a cover-table concern that must
// not leak here): requirements bound what `covers` compares, so no cap changes a verdict, and the
// exposed step states show the player's true totals.
const zero = (): Vec => [0, 0, 0, 0, 0];
const addV = (g: Vec, x: Vec): Vec => g.map((n, i) => n + x[i]!) as Vec;
const maxV = (a: Vec, b: Vec): Vec => a.map((n, i) => Math.max(n, b[i]!)) as Vec;
const covers = (g: Vec, d: Vec): boolean => g.every((n, i) => n >= d[i]!);

/** Post-step affinity state for one build-order step, from the same replay that judges legality. */
export interface StepState {
  have: Vec; // grant sum of standing complete constellations after the step (the true in-game total)
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
      have = addV(have, c.grant);
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
      if (id !== pending) grant = addV(grant, c.grant);
    }
    if (!standing.has(pending)) req = maxV(req, conOf.get(pending)!.req);
    return covers(grant, req) ? null : `${label}: requirement uncovered`;
  };
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    const c = conOf.get(s.conId);
    if (!c) return fail(`step ${i}: unknown constellation ${s.conId}`);
    let st: { have: Vec; need: Vec; needSource: Map<number, string[]> };
    if (s.kind === "scaffold-refund") {
      if (!standing.has(s.conId)) return fail(`step ${i} (${s.conId}): refund of a constellation not standing`);
      if (s.points !== -c.size) return fail(`step ${i} (${s.conId}): refund points ${s.points}, expected ${-c.size}`);
      const mid = check(`step ${i} (${s.conId}) mid-refund`, s.conId);
      if (mid) return fail(mid);
      standing.delete(s.conId);
      running -= c.size;
      st = standingState();
      if (!covers(st.have, st.need)) return fail(`step ${i} (${s.conId}) post-refund: requirement uncovered`);
    } else {
      if (standing.has(s.conId)) return fail(`step ${i} (${s.conId}): added while already standing`);
      if (s.points !== c.size) return fail(`step ${i} (${s.conId}): add points ${s.points}, expected ${c.size}`);
      const mid = check(`step ${i} (${s.conId}) pre-add`, s.conId);
      if (mid) return fail(mid);
      standing.add(s.conId);
      running += c.size;
      if (running > cap) return fail(`step ${i} (${s.conId}): cap exceeded (${running} > ${cap})`);
      st = standingState();
      if (!covers(st.have, st.need)) return fail(`step ${i} (${s.conId}) post-add: requirement uncovered`);
    }
    if (s.heldAfter !== running)
      return fail(`step ${i} (${s.conId}): heldAfter=${s.heldAfter}, running total is ${running}`);
    // Push only after every check: a state exists exactly for each step that completed its checks.
    states.push({ ...st, conReq: c.req, conGrant: c.grant });
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

/** One step of a baseline-to-current transition: star counts, not points. `from`/`to` are the
 *  constellation's standing star count before/after the step; `heldAfter` is the running total. */
export interface TransStep {
  kind: "add" | "refund";
  conId: string;
  from: number;
  to: number;
  heldAfter: number;
}

/**
 * The transition verification walk with its states exposed. Replays `steps` from the standing
 * `base` build, re-deriving validity from scratch at each step: standing grants come only from
 * COMPLETE constellations (star count at full size), standing requirements from every STARTED one,
 * and coverage must hold at the conservative mid-step point (an add's requirement stands before its
 * grant lands; a refund loses the grant at its first refunded star while the requirement stands
 * until zero). Cap rule: an ADD must land at or under `cap` and the end state must fit `cap`;
 * refunds may pass through over-cap totals (how a baseline larger than the live cap legally tears
 * down). The end state must equal `cur` exactly. Unlike replayBuildOrder, `cur` members never
 * override lookups: partiality is expressed through star counts, so grants and sizes come from the
 * full definitions in `allCons`. Grant sums are capped (addCap) like the rest of this module -
 * verdict-equivalent to uncapped sums because no requirement exceeds CAP_MAX, and it makes the
 * states' `have` match the Affinity panel. `error` is null when legal, else the first violation;
 * `states` holds one post-step entry per step that completed its checks. Pure.
 */
export function replayTransition(
  allCons: ReachCon[],
  base: ReachCon[],
  cur: ReachCon[],
  steps: TransStep[],
  cap: number,
): { error: string | null; states: StepState[] } {
  const conOf = new Map(allCons.map((c) => [c.id, c]));
  const counts = new Map<string, number>(base.map((b) => [b.id, b.size]));
  const states: StepState[] = [];
  const total = () => [...counts.values()].reduce((a, b) => a + b, 0);
  const fail = (error: string) => ({ error, states });
  // Standing validity with the conservative override: `pending` is a con whose requirement must
  // count but whose grant must not (add completing / refund starting).
  const check = (label: string, pending: string | null): string | null => {
    let grant = zero();
    let req = zero();
    for (const [id, n] of counts) {
      if (n <= 0) continue;
      const c = conOf.get(id)!;
      req = maxV(req, c.req);
      if (n >= c.size && id !== pending) grant = addCap(grant, c.grant);
    }
    if (pending) {
      const pc = conOf.get(pending);
      if (pc) req = maxV(req, pc.req);
    }
    return covers(grant, req) ? null : `${label}: requirement uncovered`;
  };
  // The post-step standing state (fresh structures per call), the popup's data source.
  const standingState = (): { have: Vec; need: Vec; needSource: Map<number, string[]> } => {
    let have = zero();
    let need = zero();
    const needSource = new Map<number, string[]>();
    for (const [id, n] of counts) {
      if (n <= 0) continue;
      const c = conOf.get(id)!;
      need = maxV(need, c.req);
      if (n >= c.size) have = addCap(have, c.grant);
      for (let i = 0; i < 5; i++)
        if (c.req[i]! > 0) {
          const list = needSource.get(i) ?? [];
          list.push(id);
          needSource.set(i, list);
        }
    }
    return { have, need, needSource };
  };
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    const c = conOf.get(s.conId);
    if (!c) return fail(`step ${i}: unknown constellation ${s.conId}`);
    const cur0 = counts.get(s.conId) ?? 0;
    if (cur0 !== s.from) return fail(`step ${i} (${s.conId}): from=${s.from} but standing count is ${cur0}`);
    if (s.to < 0 || s.to > c.size) return fail(`step ${i} (${s.conId}): to=${s.to} out of range`);
    if (s.kind === "add" && s.to <= s.from) return fail(`step ${i} (${s.conId}): add must increase count`);
    if (s.kind === "refund" && s.to >= s.from) return fail(`step ${i} (${s.conId}): refund must decrease count`);
    counts.set(s.conId, s.to);
    const mid = check(`step ${i} (${s.conId}) mid`, s.conId);
    if (mid) return fail(mid);
    const end = check(`step ${i} (${s.conId}) end`, null);
    if (end) return fail(end);
    const t = total();
    if (s.kind === "add" && t > cap) return fail(`step ${i} (${s.conId}): cap exceeded (${t} > ${cap})`);
    if (t !== s.heldAfter) return fail(`step ${i} (${s.conId}): heldAfter=${s.heldAfter} but total is ${t}`);
    // Grant delta the popup shows: only a step that completes (add to full size) or un-completes
    // (refund from full size) the constellation moves its grant.
    const conGrant =
      (s.kind === "add" && s.to === c.size) || (s.kind === "refund" && s.from === c.size) ? c.grant : zero();
    const st = standingState();
    states.push({ ...st, conReq: c.req, conGrant });
    if (s.to === 0) counts.delete(s.conId);
  }
  if (total() > cap) return fail(`end state over cap (${total()} > ${cap})`);
  const want = new Map(cur.map((c) => [c.id, c.size]));
  if (want.size !== counts.size) return fail(`end state mismatch: ${counts.size} standing, ${want.size} wanted`);
  for (const [id, n] of want) if (counts.get(id) !== n) return fail(`end state mismatch at ${id}`);
  return { error: null, states };
}

/** The transition replay's verdict alone: null when every step is legal in-game. */
export function verifyTransition(
  allCons: ReachCon[],
  base: ReachCon[],
  cur: ReachCon[],
  steps: TransStep[],
  cap: number,
): string | null {
  return replayTransition(allCons, base, cur, steps, cap).error;
}

/** A verified transition together with the per-step states its verifying replay produced. */
export interface GatedTransition {
  steps: TransStep[];
  states: StepState[];
}

/** The verified-or-absent gate for transitions: steps pass through, with states, only when legal. */
export function gateTransition(
  allCons: ReachCon[],
  base: ReachCon[],
  cur: ReachCon[],
  steps: TransStep[] | null,
  cap: number,
): GatedTransition | null {
  if (!steps) return null;
  const r = replayTransition(allCons, base, cur, steps, cap);
  return r.error === null ? { steps, states: r.states } : null;
}
