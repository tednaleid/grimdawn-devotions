// ABOUTME: Pure resolver mapping each constellation/star/edge to a display record.
// ABOUTME: Three orthogonal channels - brightness (attainability), color (affinity filter), emphasis.
import type { Affinity, Constellation, Star, StarId } from "./types";
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

export interface StarDisplay {
  brightness: Brightness;
  color: { kind: "mute" } | { kind: "identity" };
  clickable: boolean;
  selected: boolean;
  benefitMatch: boolean;
  diff: "add" | "remove" | null;
}

export function starDisplay(star: Star, con: Constellation, s: DisplaySettings): StarDisplay {
  const selected = s.selected.has(star.id);
  const clickable = !s.reach || s.reach.clickable.has(star.id);
  let brightness: Brightness;
  if (selected) brightness = "active";
  else if (!s.reach || clickable || s.reach.completable.has(con.id)) brightness = "attainable";
  else brightness = "unattainable";
  // Stars carry no affinity halo; the affinity axis only mutes them (when their constellation
  // provides none of the filtered colors) or leaves them at identity.
  const conColor = constellationColor(con, s);
  const color: StarDisplay["color"] = conColor.kind === "mute" ? { kind: "mute" } : { kind: "identity" };
  const diff = s.diff ? (s.diff.added.has(star.id) ? "add" : s.diff.removed.has(star.id) ? "remove" : null) : null;
  return { brightness, color, clickable, selected, benefitMatch: s.benefitMatch?.has(star.id) ?? false, diff };
}
