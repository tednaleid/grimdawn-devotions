// ABOUTME: Computes affinity totals, constellation completion, and requirement checks.
// ABOUTME: Pure functions over DevotionModel and SelectionState with no side effects.
import {
  AFFINITIES,
  type Affinity,
  type AffinityMap,
  type Constellation,
  type DevotionModel,
  type StarId,
} from "./types";

export function completedConstellations(model: DevotionModel, selected: Set<StarId>): Set<string> {
  const out = new Set<string>();
  for (const c of model.constellations.values()) {
    if (c.starIds.length > 0 && c.starIds.every((id) => selected.has(id))) out.add(c.id);
  }
  return out;
}

function zeroAffinity(): Record<Affinity, number> {
  return { ascendant: 0, chaos: 0, eldritch: 0, order: 0, primordial: 0 };
}

export function affinityFrom(model: DevotionModel, completedIds: Iterable<string>): Record<Affinity, number> {
  const totals = zeroAffinity();
  for (const id of completedIds) {
    const c = model.constellations.get(id);
    if (!c) continue;
    for (const a of AFFINITIES) {
      const v = c.affinityBonus[a];
      if (v) totals[a] += v;
    }
  }
  return totals;
}

export function affinityTotals(model: DevotionModel, selected: Set<StarId>): Record<Affinity, number> {
  return affinityFrom(model, completedConstellations(model, selected));
}

export function meetsRequirement(have: Record<Affinity, number>, need: AffinityMap): boolean {
  for (const a of AFFINITIES) {
    const n = need[a] ?? 0;
    if (have[a] < n) return false;
  }
  return true;
}

// The affinities a constellation provides for the active affinity filter: those in `grants` it grants
// (affinityBonus > 0) or in `requires` it requires (affinityRequired > 0), in canonical order. Drives
// the renderer's matched-color glow; empty means the constellation does not match the filter.
export function matchedAffinities(con: Constellation, grants: Set<Affinity>, requires: Set<Affinity>): Affinity[] {
  return AFFINITIES.filter(
    (a) =>
      (grants.has(a) && (con.affinityBonus[a] ?? 0) > 0) || (requires.has(a) && (con.affinityRequired[a] ?? 0) > 0),
  );
}
