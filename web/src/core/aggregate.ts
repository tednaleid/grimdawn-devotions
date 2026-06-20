// ABOUTME: Aggregation functions over a set of selected star ids.
// ABOUTME: Computes summed stat bonuses, celestial powers gained, and weapon requirements.
import type { DevotionModel, StarId } from "./types";

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

export function powersGained(model: DevotionModel, selected: Set<StarId>): string[] {
  const out: string[] = [];
  for (const id of selected) {
    const star = model.stars.get(id);
    if (star?.celestialPower) out.push(star.celestialPower.name);
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
