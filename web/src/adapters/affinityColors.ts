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

// Deeper, purer variants used only for the affinity-match glow halo. The halo is blurred and drawn over
// the constellation's bright (near-white) line art; a mid-tone source still reads washed against it, so
// a #d8453a chaos red would look pink. These darker, more-saturated sources read as the true affinity
// color through the linework. Identity tints/orbs/stars keep AFFINITY_COLORS.
const GLOW_COLORS: Record<Affinity, string> = {
  ascendant: "#9a2fe0", // purple
  chaos: "#d00000", // red
  eldritch: "#14a848", // green
  order: "#f0bd14", // gold
  primordial: "#1f7be8", // blue
};

export function glowColor(a: Affinity): string {
  return GLOW_COLORS[a];
}

/** Affinities present in a map (value > 0), in canonical order. */
export function presentAffinities(map: Partial<Record<Affinity, number>>): Affinity[] {
  return AFFINITIES.filter((a) => (map[a] ?? 0) > 0);
}

/** A small colored orb (inline-block span) for an affinity, for tooltip/sidebar use. */
export function affinityOrb(a: Affinity): string {
  return `<span class="orb" style="background:${affinityColor(a)}"></span>`;
}
