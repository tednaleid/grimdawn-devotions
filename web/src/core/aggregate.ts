// ABOUTME: Aggregation functions over a set of selected star ids.
// ABOUTME: Computes summed stat bonuses, celestial powers gained, and weapon requirements.
import type { CelestialPower, DevotionModel, StarId } from "./types";

export function sumBonuses(model: DevotionModel, selected: Set<StarId>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of selected) {
    const star = model.stars.get(id);
    if (!star) continue;
    for (const [stat, val] of Object.entries(star.bonuses)) {
      out[stat] = (out[stat] ?? 0) + val;
    }
  }
  return out;
}

export function racialTargets(model: DevotionModel, selected: Iterable<StarId>): string[] {
  const out = new Set<string>();
  for (const id of selected) {
    model.stars.get(id)?.racialTarget?.forEach((r) => { out.add(r); });
  }
  return [...out];
}

export function powersGained(
  model: DevotionModel,
  selected: Set<StarId>,
): { starId: StarId; power: CelestialPower }[] {
  const out: { starId: StarId; power: CelestialPower }[] = [];
  for (const id of selected) {
    const star = model.stars.get(id);
    if (star?.celestialPower) out.push({ starId: id, power: star.celestialPower });
  }
  return out;
}

// The stars whose bonuses include ANY of the given raw stat ids - used to highlight
// on the map where a selected benefit can still be picked up. Empty for an empty set.
export function starsGranting(model: DevotionModel, ids: Set<string>): Set<StarId> {
  const out = new Set<StarId>();
  if (ids.size === 0) return out;
  for (const star of model.stars.values()) {
    for (const k of Object.keys(star.bonuses)) {
      if (ids.has(k)) {
        out.add(star.id);
        break;
      }
    }
  }
  return out;
}

export function weaponRequirements(
  model: DevotionModel,
  selected: Set<StarId>,
): { starId: StarId; weapons: string[] }[] {
  const out: { starId: StarId; weapons: string[] }[] = [];
  for (const id of selected) {
    const star = model.stars.get(id);
    if (star?.weaponRequirement) out.push({ starId: id, weapons: star.weaponRequirement.weapons });
  }
  return out;
}
