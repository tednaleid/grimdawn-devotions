// ABOUTME: Aggregation functions over a set of selected star ids.
// ABOUTME: Computes summed stat bonuses, celestial powers gained, and weapon requirements.
import type { CelestialPower, DevotionModel, StarId } from "./types";
import { petTagId } from "./benefitTag";
import { isFilterableStat } from "./statFormat";

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

// "Bonus to All Pets" stats summed across the selection, kept separate from the
// player bonuses (same stat ids, but they apply to the player's pets).
export function sumPetBonuses(model: DevotionModel, selected: Iterable<StarId>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of selected) {
    const pet = model.stars.get(id)?.petBonuses;
    if (!pet) continue;
    for (const [stat, val] of Object.entries(pet)) {
      out[stat] = (out[stat] ?? 0) + val;
    }
  }
  return out;
}

export function racialTargets(model: DevotionModel, selected: Iterable<StarId>): string[] {
  const out = new Set<string>();
  for (const id of selected) {
    model.stars.get(id)?.racialTarget?.forEach((r) => {
      out.add(r);
    });
  }
  return [...out];
}

export function powersGained(model: DevotionModel, selected: Set<StarId>): { starId: StarId; power: CelestialPower }[] {
  const out: { starId: StarId; power: CelestialPower }[] = [];
  for (const id of selected) {
    const star = model.stars.get(id);
    if (star?.celestialPower) out.push({ starId: id, power: star.celestialPower });
  }
  return out;
}

// The stars whose bonuses OR celestial power grant ANY of the given raw stat ids - used to highlight
// on the map where a selected benefit can still be picked up. A power's diamond star lights up when the
// filter matches its celestial power. Pet attack stats are intentionally not scanned. Empty for an empty set.
export function starsGranting(model: DevotionModel, ids: Set<string>): Set<StarId> {
  const out = new Set<StarId>();
  if (ids.size === 0) return out;
  for (const star of model.stars.values()) {
    let hit = false;
    for (const k of Object.keys(star.bonuses)) {
      if (ids.has(k)) {
        hit = true;
        break;
      }
    }
    if (!hit) {
      const power = star.celestialPower;
      if (power)
        for (const k of Object.keys(power.stats)) {
          if (ids.has(k)) {
            hit = true;
            break;
          }
        }
    }
    if (hit) out.add(star.id);
  }
  return out;
}

// Like starsGranting, but over pet bonuses: the stars whose petBonuses include any of the
// given raw pet stat ids. Used to highlight where a tagged pet benefit can be picked up.
export function starsGrantingPet(model: DevotionModel, ids: Set<string>): Set<StarId> {
  const out = new Set<StarId>();
  if (ids.size === 0) return out;
  for (const star of model.stars.values()) {
    const pet = star.petBonuses;
    if (!pet) continue;
    for (const k of Object.keys(pet)) {
      if (ids.has(k)) {
        out.add(star.id);
        break;
      }
    }
  }
  return out;
}

// The stat ids still obtainable from the current selection: every bonus carried by a reachable star
// (reachableStars: unselected stars whose path fits the budget - all stars of completable
// constellations plus the in-reach stars of partially enterable ones). Drives "Available to get".
export function availableBonusIds(model: DevotionModel, reachableStars: Set<StarId>): Set<string> {
  const out = new Set<string>();
  for (const sid of reachableStars) {
    const star = model.stars.get(sid);
    if (!star) continue;
    for (const k of Object.keys(star.bonuses)) out.add(k);
    const power = star.celestialPower;
    if (power) for (const k of Object.keys(power.stats)) if (isFilterableStat(k)) out.add(k);
  }
  return out;
}

// The pet bonuses still obtainable, as pet:-scoped tag keys (see availableBonusIds for the
// reachableStars contract). Drives the pet "Available to get" list.
export function availablePetKeys(model: DevotionModel, reachableStars: Set<StarId>): Set<string> {
  const out = new Set<string>();
  for (const sid of reachableStars) {
    const pet = model.stars.get(sid)?.petBonuses;
    if (!pet) continue;
    for (const k of Object.keys(pet)) out.add(petTagId(k));
  }
  return out;
}

// The celestial powers still validly pickable: the power star of any reachable star set (a gained
// power's star is selected, so it is never in reachableStars). Drives the "Celestial Powers" list.
export function availablePowers(
  model: DevotionModel,
  reachableStars: Set<StarId>,
): { starId: StarId; power: CelestialPower }[] {
  const out: { starId: StarId; power: CelestialPower }[] = [];
  for (const sid of reachableStars) {
    const star = model.stars.get(sid);
    if (star?.celestialPower) out.push({ starId: sid, power: star.celestialPower });
  }
  return out;
}

export function weaponRequirements(
  model: DevotionModel,
  selected: Set<StarId>,
): { starId: StarId; weapons: string[]; descriptionTag: string | null }[] {
  const out: { starId: StarId; weapons: string[]; descriptionTag: string | null }[] = [];
  for (const id of selected) {
    const star = model.stars.get(id);
    if (star?.weaponRequirement)
      out.push({
        starId: id,
        weapons: star.weaponRequirement.weapons,
        descriptionTag: star.weaponRequirement.descriptionTag,
      });
  }
  return out;
}
