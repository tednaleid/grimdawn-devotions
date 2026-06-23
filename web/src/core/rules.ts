// ABOUTME: Reachability-driven selection rules: add only ReachView-approved targets, remove freely.
// ABOUTME: No engine calls here; the controller passes a precomputed ReachView. recapValue is unchanged.
import type { DevotionModel, SelectionState, StarId } from "./types";
import { classifyForSelection, selectionSummary, type CoverTable, type ReachCon, type ReachView } from "./reachability";

// The finite cap to restore when leaving uncapped mode, or null when re-capping
// is not allowed yet. A cap can never sit below the points already spent, and the
// real-game maximum is maxCap - so a selection larger than maxCap must be trimmed
// before any limit can be re-imposed.
export function recapValue(selectedSize: number, lastFiniteCap: number, maxCap = 55): number | null {
  if (selectedSize > maxCap) return null;
  return Math.min(maxCap, Math.max(lastFiniteCap, selectedSize));
}

// Remove starId and every star that (transitively) depends on it within its constellation.
export function removeWithDependents(model: DevotionModel, selected: Set<StarId>, starId: StarId): Set<StarId> {
  const next = new Set(selected);
  const stack = [starId];
  while (stack.length) {
    const id = stack.pop()!;
    if (!next.has(id)) continue;
    next.delete(id);
    for (const s of model.stars.values()) if (next.has(s.id) && s.predecessors.includes(id)) stack.push(s.id);
  }
  return next;
}

export function toggleStar(
  model: DevotionModel,
  state: SelectionState,
  reach: ReachView,
  starId: StarId,
): SelectionState {
  if (state.selected.has(starId))
    return { selected: removeWithDependents(model, state.selected, starId), pointCap: state.pointCap };
  if (!reach.clickable.has(starId)) return state; // not a valid target right now
  const next = new Set(state.selected);
  next.add(starId);
  return { selected: next, pointCap: state.pointCap };
}

export function toggleConstellation(
  model: DevotionModel,
  state: SelectionState,
  reach: ReachView,
  conId: string,
): SelectionState {
  const con = model.constellations.get(conId);
  if (!con || con.starIds.length === 0) return state;
  if (con.starIds.every((id) => state.selected.has(id))) {
    // fully selected -> remove all (free)
    const next = new Set(state.selected);
    for (const id of con.starIds) next.delete(id);
    return { selected: next, pointCap: state.pointCap };
  }
  if (!reach.completable.has(conId)) return state; // cannot finish within budget
  const next = new Set(state.selected);
  for (const id of con.starIds) next.add(id);
  return { selected: next, pointCap: state.pointCap };
}

// Drop selected stars whose predecessors are absent (malformed link), keeping predecessor-closure.
function predecessorClosure(model: DevotionModel, selected: Set<StarId>): Set<StarId> {
  let cur = new Set(selected);
  for (;;) {
    const next = new Set<StarId>();
    for (const id of cur) {
      const s = model.stars.get(id);
      if (s && s.predecessors.every((p) => cur.has(p))) next.add(id);
    }
    if (next.size === cur.size) return next;
    cur = next;
  }
}

// Best-effort repair for a restored selection: enforce predecessor-closure, then drop the largest
// started constellation until the set is reachable within cap. App-generated links are already
// reachable, so this only fires for stale or hand-edited links. Null table -> accept as-is (degraded).
export function repairSelection(
  model: DevotionModel,
  cons: ReachCon[],
  table: CoverTable | null,
  selected: Set<StarId>,
  cap: number,
): Set<StarId> {
  const cur = predecessorClosure(model, selected);
  if (!table) return cur;
  while (cur.size > 0 && classifyForSelection(cons, table, selectionSummary(model, cur), cap) === "dim") {
    const started = new Map<string, number>();
    for (const id of cur) {
      const cid = model.stars.get(id)?.constellationId;
      if (cid) started.set(cid, (started.get(cid) ?? 0) + 1);
    }
    let drop = "",
      best = -1;
    for (const [cid, n] of started)
      if (n > best) {
        best = n;
        drop = cid;
      }
    const con = model.constellations.get(drop);
    if (!con) break;
    for (const id of con.starIds) cur.delete(id);
  }
  return cur;
}
