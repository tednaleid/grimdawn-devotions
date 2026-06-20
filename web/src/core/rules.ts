// ABOUTME: Pure selection rules: validClosure (fixpoint), selectableStars, canRemove, toggleStar.
// ABOUTME: No mutations of input state; all functions return new objects or Sets on change.
import type { DevotionModel, SelectionState, StarId } from "./types";
import { affinityFrom, completedConstellations, meetsRequirement } from "./affinity";

export function validClosure(model: DevotionModel, selected: Set<StarId>): Set<StarId> {
  let cur = new Set(selected);
  for (;;) {
    const completed = completedConstellations(model, cur);
    const next = new Set<StarId>();
    for (const id of cur) {
      const star = model.stars.get(id);
      if (!star) continue;
      if (!star.predecessors.every((p) => cur.has(p))) continue; // predecessor gone
      if (star.predecessors.length === 0) {
        const con = model.constellations.get(star.constellationId)!;
        // Total pool from ALL completed constellations, including this one once
        // complete - so a self-sustaining constellation survives bootstrap removal.
        if (!meetsRequirement(affinityFrom(model, completed), con.affinityRequired)) continue;
      }
      next.add(id);
    }
    if (next.size === cur.size) return next;
    cur = next;
  }
}

export function selectableStars(model: DevotionModel, state: SelectionState): Set<StarId> {
  const out = new Set<StarId>();
  if (state.selected.size >= state.pointCap) return out;
  const completed = completedConstellations(model, state.selected);
  const totals = affinityFrom(model, completed);
  for (const star of model.stars.values()) {
    if (state.selected.has(star.id)) continue;
    if (!star.predecessors.every((p) => state.selected.has(p))) continue;
    if (star.predecessors.length === 0) {
      const con = model.constellations.get(star.constellationId)!;
      if (!meetsRequirement(totals, con.affinityRequired)) continue;
    }
    out.add(star.id);
  }
  return out;
}

export function canRemove(model: DevotionModel, state: SelectionState, starId: StarId): boolean {
  if (!state.selected.has(starId)) return false;
  const next = new Set(state.selected);
  next.delete(starId);
  // Removable only if nothing else falls out of validity (guarded / leaf rule).
  return validClosure(model, next).size === next.size;
}

export function toggleStar(model: DevotionModel, state: SelectionState, starId: StarId): SelectionState {
  if (state.selected.has(starId)) {
    if (!canRemove(model, state, starId)) return state; // reject: would invalidate others
    const next = new Set(state.selected);
    next.delete(starId);
    return { selected: next, pointCap: state.pointCap };
  }
  if (selectableStars(model, state).has(starId)) {
    // Adding a selectable star never invalidates existing selections.
    const next = new Set(state.selected);
    next.add(starId);
    return { selected: next, pointCap: state.pointCap };
  }
  return state;
}
