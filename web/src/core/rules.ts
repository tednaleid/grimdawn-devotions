// ABOUTME: Pure selection rules: validClosure (fixpoint), selectableStars, canRemove, toggleStar.
// ABOUTME: No mutations of input state; all functions return new objects or Sets on change.
import type { DevotionModel, SelectionState, StarId } from "./types";
import { affinityFrom, completedConstellations, meetsRequirement } from "./affinity";

// The finite cap to restore when leaving uncapped mode, or null when re-capping
// is not allowed yet. A cap can never sit below the points already spent, and the
// real-game maximum is maxCap - so a selection larger than maxCap must be trimmed
// before any limit can be re-imposed.
export function recapValue(selectedSize: number, lastFiniteCap: number, maxCap = 55): number | null {
  if (selectedSize > maxCap) return null;
  return Math.min(maxCap, Math.max(lastFiniteCap, selectedSize));
}

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

// The currently-selected stars that would become invalid if `toRemove` were
// deselected - i.e. what is blocking that removal and must be removed first.
// Empty when the removal is allowed. Covers both predecessor dependencies and
// affinity dependencies, since both fall out of validClosure. The stars in
// `toRemove` are never themselves reported as blockers.
export function removalBlockers(model: DevotionModel, state: SelectionState, toRemove: Set<StarId>): Set<StarId> {
  const next = new Set(state.selected);
  for (const id of toRemove) next.delete(id);
  const closure = validClosure(model, next);
  const blockers = new Set<StarId>();
  for (const id of next) if (!closure.has(id)) blockers.add(id);
  return blockers;
}

export function toggleConstellation(model: DevotionModel, state: SelectionState, conId: string): SelectionState {
  const con = model.constellations.get(conId);
  if (!con || con.starIds.length === 0) return state;
  const allSelected = con.starIds.every((id) => state.selected.has(id));
  const next = new Set(state.selected);
  if (allSelected) {
    for (const id of con.starIds) next.delete(id);
    // Only remove the whole constellation if nothing else falls out of validity.
    if (validClosure(model, next).size !== next.size) return state;
  } else {
    // Must be startable now: requirement met by OTHER completed constellations'
    // affinity (excluding this one), exactly as taking its first star would be.
    // This blocks bootstrapping a self-sustaining constellation from nothing.
    const completed = completedConstellations(model, state.selected);
    completed.delete(conId);
    if (!meetsRequirement(affinityFrom(model, completed), con.affinityRequired)) return state;
    for (const id of con.starIds) next.add(id);
    if (next.size > state.pointCap) return state; // would exceed the point budget
    // Defensive: every star (this constellation's + all prior picks) stays valid.
    if (validClosure(model, next).size !== next.size) return state;
  }
  return { selected: next, pointCap: state.pointCap };
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
