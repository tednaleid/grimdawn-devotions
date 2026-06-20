// ABOUTME: Pure selection rules: validClosure (fixpoint), selectableStars, canRemove, toggleStar.
// ABOUTME: No mutations of input state; all functions return new objects or Sets on change.
import type { DevotionModel, StarId } from "./types";
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
