// ABOUTME: Builds the in-memory DevotionModel graph from the raw devotions.json document.
// ABOUTME: Maps snake_case JSON fields to camelCase typed interfaces for the domain core.
import type { Constellation, DevotionModel, Star, StarId } from "./types";

interface RawStar {
  index: number;
  predecessors: number[];
  position: { x: number; y: number };
  bonuses: Record<string, number>;
  celestial_power: {
    name: string | null;
    description?: string | null;
    proc?: { chance: number; trigger: string } | null;
    level?: number;
    stats?: Record<string, number>;
    pet?: {
      name: string | null;
      count: number | null;
      duration: number | null;
      attack_stats?: Record<string, number>;
    } | null;
  } | null;
  weapon_requirement: { weapons: string[]; description?: string | null } | null;
  racial_target?: string[] | null;
  pet_bonuses?: Record<string, number> | null;
}
interface RawConstellation {
  id: string;
  name: string;
  tier: number | null;
  affinity_required: Record<string, number>;
  affinity_bonus: Record<string, number>;
  background: { image: string | null; x: number | null; y: number | null } | null;
  stars: RawStar[];
}
export interface DevotionsDoc {
  constellations: RawConstellation[];
}

export function buildModel(doc: DevotionsDoc): DevotionModel {
  const stars = new Map<StarId, Star>();
  const constellations = new Map<string, Constellation>();

  for (const c of doc.constellations) {
    const starIds: StarId[] = c.stars.map((s) => `${c.id}:${s.index}`);
    for (const s of c.stars) {
      const id = `${c.id}:${s.index}`;
      stars.set(id, {
        id,
        constellationId: c.id,
        index: s.index,
        predecessors: s.predecessors.map((p) => `${c.id}:${p}`),
        position: s.position,
        bonuses: s.bonuses,
        celestialPower: s.celestial_power?.name
          ? {
              name: s.celestial_power.name,
              description: s.celestial_power.description ?? null,
              proc: s.celestial_power.proc ?? null,
              level: s.celestial_power.level ?? 0,
              stats: s.celestial_power.stats ?? {},
              pet: s.celestial_power.pet
                ? {
                    name: s.celestial_power.pet.name,
                    count: s.celestial_power.pet.count,
                    duration: s.celestial_power.pet.duration,
                    attackStats: s.celestial_power.pet.attack_stats ?? {},
                  }
                : null,
            }
          : null,
        weaponRequirement: s.weapon_requirement
          ? { weapons: s.weapon_requirement.weapons, description: s.weapon_requirement.description ?? null }
          : null,
        racialTarget: s.racial_target ?? undefined,
        petBonuses: s.pet_bonuses ?? undefined,
      });
    }
    constellations.set(c.id, {
      id: c.id,
      name: c.name,
      tier: c.tier,
      affinityRequired: c.affinity_required,
      affinityBonus: c.affinity_bonus,
      background: c.background,
      starIds,
    });
  }
  return { stars, constellations };
}
