// ABOUTME: Core domain types for the devotion planner (affinities, stars, model, selection).
// ABOUTME: Pure data shapes with no DOM or IO dependencies.
export type Affinity = "ascendant" | "chaos" | "eldritch" | "order" | "primordial";
export const AFFINITIES: Affinity[] = ["ascendant", "chaos", "eldritch", "order", "primordial"];

export type AffinityMap = Partial<Record<Affinity, number>>;
export type StarId = string; // `${constellationId}:${index}`

// A devotion celestial power: its proc trigger (null for always-on auras), the
// fixed granted skill level, and the level-selected raw stat ids the tooltip shows.
// A temporary creature summoned by a spawn-pet power. count/duration are at the
// granted level; attackStats is the pet's base attack damage (its other stats scale
// with the player's pet bonuses, so they are not fixed and not surfaced).
export interface PetInfo {
  nameTag: string | null;
  count: number | null;
  duration: number | null;
  attackStats: Record<string, number>;
}

export interface CelestialPower {
  nameTag: string;
  descriptionTag: string | null;
  proc: { chance: number; triggerKey: string } | null;
  level: number;
  stats: Record<string, number>;
  pet: PetInfo | null;
}

export interface Star {
  id: StarId;
  constellationId: string;
  index: number;
  predecessors: StarId[];
  position: { x: number; y: number };
  bonuses: Record<string, number>;
  petBonuses?: Record<string, number>; // "Bonus to All Pets" stats, same ids as bonuses
  celestialPower: CelestialPower | null;
  weaponRequirement: { weapons: string[]; descriptionTag: string | null } | null;
  racialTarget?: string[]; // races a racialBonus* stat applies to, e.g. ["Beast"]
}

export interface Constellation {
  id: string;
  nameTag: string;
  tier: number | null;
  affinityRequired: AffinityMap;
  affinityBonus: AffinityMap;
  background: { image: string | null; x: number | null; y: number | null } | null;
  starIds: StarId[];
}

export interface DevotionModel {
  stars: Map<StarId, Star>;
  constellations: Map<string, Constellation>;
}

export interface SelectionState {
  selected: Set<StarId>;
  pointCap: number;
}
