// ABOUTME: Core domain types for the devotion planner (affinities, stars, model, selection).
// ABOUTME: Pure data shapes with no DOM or IO dependencies.
export type Affinity = "ascendant" | "chaos" | "eldritch" | "order" | "primordial";
export const AFFINITIES: Affinity[] = ["ascendant", "chaos", "eldritch", "order", "primordial"];

export type AffinityMap = Partial<Record<Affinity, number>>;
export type StarId = string; // `${constellationId}:${index}`

export interface Star {
  id: StarId;
  constellationId: string;
  index: number;
  predecessors: StarId[];
  position: { x: number; y: number };
  bonuses: Record<string, number>;
  celestialPower: { name: string } | null;
  weaponRequirement: { weapons: string[] } | null;
}

export interface Constellation {
  id: string;
  name: string;
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
