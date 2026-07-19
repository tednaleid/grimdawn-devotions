// ABOUTME: Independent legality oracle for guided build orders: replays a BuildStep schedule from an
// ABOUTME: empty board and enforces the in-game rules at every step (the verified-or-absent gate).
import type { BuildStep, ReachCon, Vec } from "./reachability";

// Deliberately duplicated from reachability.ts (its private CAP_MAX): the oracle must not import engine code. Keep in sync.
const CAP_MAX: Vec = [20, 8, 20, 10, 20];
const zero = (): Vec => [0, 0, 0, 0, 0];
const addCap = (g: Vec, x: Vec): Vec => g.map((n, i) => Math.min(n + x[i]!, CAP_MAX[i]!)) as Vec;
const maxV = (a: Vec, b: Vec): Vec => a.map((n, i) => Math.max(n, b[i]!)) as Vec;
const covers = (g: Vec, d: Vec): boolean => g.every((n, i) => n >= d[i]!);

/**
 * Replay `steps` from an empty board; null when every step is legal in-game, else a description of the
 * first violation. Deliberately independent of the engine that produced the schedule: type-only imports,
 * no shared helpers, validity re-derived from scratch at every step. Rules enforced, at the conservative
 * mid-step point (a step's requirement stands at its first star, its grant only at completion; a refund
 * loses the grant at the first refunded star while the requirement stands until zero):
 *  - every standing constellation's requirement is covered by standing completed grants (the in-game
 *    "removal cannot strand a dependent" rule, docs/devotion-system.md, the refunded one included);
 *  - an add lands at or under `cap`, and `heldAfter` matches the running total at every step;
 *  - the end state is exactly `target`.
 * `target` members take precedence over `allCons` in lookups so the panel's synthetic partial members
 * (selected-star size, zero grant) are judged at their real standing size.
 */
export function verifyBuildOrder(
  allCons: ReachCon[],
  target: ReachCon[],
  steps: BuildStep[],
  cap: number,
): string | null {
  const conOf = new Map(allCons.map((c) => [c.id, c]));
  for (const t of target) conOf.set(t.id, t);
  const standing = new Set<string>();
  let running = 0;
  // Standing-state validity; `pending` is a constellation whose requirement must count but whose
  // grant must not (the conservative mid-step point).
  const check = (label: string, pending: string | null): string | null => {
    let grant = zero();
    let req = zero();
    for (const id of standing) {
      const c = conOf.get(id)!;
      req = maxV(req, c.req);
      if (id !== pending) grant = addCap(grant, c.grant);
    }
    if (pending && !standing.has(pending)) req = maxV(req, conOf.get(pending)!.req);
    return covers(grant, req) ? null : `${label}: requirement uncovered`;
  };
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    const c = conOf.get(s.conId);
    if (!c) return `step ${i}: unknown constellation ${s.conId}`;
    if (s.kind === "scaffold-refund") {
      if (!standing.has(s.conId)) return `step ${i} (${s.conId}): refund of a constellation not standing`;
      if (s.points !== -c.size) return `step ${i} (${s.conId}): refund points ${s.points}, expected ${-c.size}`;
      const mid = check(`step ${i} (${s.conId}) mid-refund`, s.conId);
      if (mid) return mid;
      standing.delete(s.conId);
      running -= c.size;
      const end = check(`step ${i} (${s.conId}) post-refund`, null);
      if (end) return end;
    } else {
      if (standing.has(s.conId)) return `step ${i} (${s.conId}): added while already standing`;
      if (s.points !== c.size) return `step ${i} (${s.conId}): add points ${s.points}, expected ${c.size}`;
      const mid = check(`step ${i} (${s.conId}) pre-add`, s.conId);
      if (mid) return mid;
      standing.add(s.conId);
      running += c.size;
      if (running > cap) return `step ${i} (${s.conId}): cap exceeded (${running} > ${cap})`;
      const end = check(`step ${i} (${s.conId}) post-add`, null);
      if (end) return end;
    }
    if (s.heldAfter !== running) return `step ${i} (${s.conId}): heldAfter=${s.heldAfter}, running total is ${running}`;
  }
  const want = new Set(target.map((c) => c.id));
  if (want.size !== standing.size) return `end state: ${standing.size} standing, ${want.size} wanted`;
  for (const id of want) if (!standing.has(id)) return `end state: ${id} missing`;
  return null;
}

/** The verified-or-absent gate: pass a schedule through only when the oracle proves it legal. */
export function gateBuildOrder(
  allCons: ReachCon[],
  target: ReachCon[],
  steps: BuildStep[] | null,
  cap: number,
): BuildStep[] | null {
  return steps && verifyBuildOrder(allCons, target, steps, cap) === null ? steps : null;
}
