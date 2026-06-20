// ABOUTME: Canonical affinity -> color map shared by the SVG map, tooltip, and sidebar.
// ABOUTME: Colors match Grim Dawn / grimtools: ascendant purple, chaos red, eldritch green, order gold, primordial blue.
import { AFFINITIES, type Affinity } from "../core/types";

const AFFINITY_COLORS: Record<Affinity, string> = {
  ascendant: "#b06fd6", // purple
  chaos: "#d8453a", // red
  eldritch: "#36b56a", // green
  order: "#e6c34d", // gold
  primordial: "#3f93d8", // blue
};

export function affinityColor(a: Affinity): string {
  return AFFINITY_COLORS[a];
}

/** Affinities present in a map (value > 0), in canonical order. */
export function presentAffinities(map: Partial<Record<Affinity, number>>): Affinity[] {
  return AFFINITIES.filter((a) => (map[a] ?? 0) > 0);
}

/** A small colored orb (inline-block span) for an affinity, for tooltip/sidebar use. */
export function affinityOrb(a: Affinity): string {
  return `<span class="orb" style="background:${affinityColor(a)}"></span>`;
}
