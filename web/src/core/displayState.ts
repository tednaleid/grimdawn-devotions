// ABOUTME: Pure resolver mapping each constellation/star/edge to a display record.
// ABOUTME: Three orthogonal channels - brightness (attainability), color (affinity filter), emphasis.
import type { Affinity, Constellation, StarId } from "./types";
import type { ReachView } from "./reachability";
import { matchedAffinities } from "./affinity";

export type Brightness = "active" | "attainable" | "unattainable";
export type ColorOutcome = { kind: "identity" } | { kind: "mute" } | { kind: "match"; affinities: Affinity[] };

export interface DisplaySettings {
  selected: Set<StarId>;
  reach?: ReachView;
  affinityFilter?: { grants: Set<Affinity>; requires: Set<Affinity> };
  benefitMatch?: Set<StarId>;
  diff?: { added: Set<StarId>; removed: Set<StarId> } | null;
}

export interface ConstellationDisplay {
  brightness: Brightness;
  color: ColorOutcome;
  selfGlow: boolean;
}

// A constellation is active when fully selected, attainable when started or completable
// (or when no reach view is present, the permissive default), else unattainable.
function constellationBrightness(con: Constellation, s: DisplaySettings): Brightness {
  if (con.starIds.length > 0 && con.starIds.every((id) => s.selected.has(id))) return "active";
  if (!s.reach) return "attainable";
  if (con.starIds.some((id) => s.selected.has(id))) return "attainable";
  if (s.reach.completable.has(con.id)) return "attainable";
  return "unattainable";
}

// Color is driven by the affinity filter ALONE: a constellation that provides a filtered
// affinity matches (its matched colors), one that provides none mutes, no filter is identity.
function constellationColor(con: Constellation, s: DisplaySettings): ColorOutcome {
  if (!s.affinityFilter) return { kind: "identity" };
  const matched = matchedAffinities(con, s.affinityFilter.grants, s.affinityFilter.requires);
  return matched.length > 0 ? { kind: "match", affinities: matched } : { kind: "mute" };
}

export function constellationDisplay(con: Constellation, s: DisplaySettings): ConstellationDisplay {
  const brightness = constellationBrightness(con, s);
  return { brightness, color: constellationColor(con, s), selfGlow: brightness === "active" };
}
