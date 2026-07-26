// ABOUTME: The monster page ViewState (every view-changing control) and its hash codec.
// ABOUTME: ViewState is the single source of view state; main.ts round-trips it through the URL.
import { putSet, readSet } from "../../core/hashCodec";
import { DAMAGE_TYPES, DIFFICULTIES, PLAYER_COUNTS, TIERS } from "./facets";
import type { Difficulty } from "./model";

export interface ViewState {
  diff: Difficulty;
  players: string;
  tiers: Set<string>;
  roles: Set<string>;
  q: string;
  hideSummons: boolean;
  includeAuras: boolean;
  sortKey: string;
  sortDir: 1 | -1;
}

/** Ultimate at one player is the difficulty most planning happens against; name-ascending
 *  opens the table on a stable alphabetical reference rather than an arbitrary type. */
export const DEFAULT_VIEW: ViewState = {
  diff: "ultimate",
  players: "1",
  tiers: new Set(),
  roles: new Set(),
  q: "",
  hideSummons: false,
  includeAuras: false,
  sortKey: "name",
  sortDir: 1,
};

const TIER_VALUES = new Set(TIERS);
const DIFF_VALUES = new Set<string>(DIFFICULTIES);
const PLAYER_VALUES = new Set(PLAYER_COUNTS);
const SORT_VALUES = new Set<string>(["name", "tier", "role", ...DAMAGE_TYPES]);

/** Encode the view into a `key=value&...` hash body (no leading '#'). Defaults are omitted,
 *  so a link to the default view is just the bare page URL. */
export function encodeHash(view: ViewState): string {
  const parts: string[] = [];
  if (view.diff !== DEFAULT_VIEW.diff) parts.push(`diff=${view.diff}`);
  if (view.players !== DEFAULT_VIEW.players) parts.push(`players=${view.players}`);
  putSet(parts, "tier", view.tiers);
  putSet(parts, "role", view.roles);
  if (view.q) parts.push(`q=${encodeURIComponent(view.q)}`);
  if (view.hideSummons) parts.push("summons=1");
  if (view.includeAuras) parts.push("auras=1");
  if (view.sortKey !== DEFAULT_VIEW.sortKey || view.sortDir !== DEFAULT_VIEW.sortDir) {
    parts.push(`sort=${view.sortKey}:${view.sortDir}`);
  }
  return parts.join("&");
}

/** Decode a hash body onto DEFAULT_VIEW, tolerating garbage.
 *
 *  `knownRoles` comes from the loaded dataset rather than a constant, because roles are derived
 *  from record paths and a game patch can introduce one. An unknown role token is dropped.
 */
export function decodeHash(hash: string, knownRoles: Set<string>): ViewState {
  const v: ViewState = { ...DEFAULT_VIEW, tiers: new Set(), roles: new Set() };
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  for (const pair of body.split("&")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const key = pair.slice(0, eq);
    const rawVal = pair.slice(eq + 1);
    // Set-valued keys read the raw value: readSet drops bad tokens individually, where the
    // outer decode below would discard the whole list on one malformed member.
    if (key === "tier") {
      v.tiers = readSet(rawVal, TIER_VALUES);
      continue;
    }
    if (key === "role") {
      v.roles = readSet(rawVal, knownRoles);
      continue;
    }
    let val: string;
    try {
      val = decodeURIComponent(rawVal);
    } catch {
      continue;
    }
    switch (key) {
      case "diff":
        if (DIFF_VALUES.has(val)) v.diff = val as Difficulty;
        break;
      case "players":
        if (PLAYER_VALUES.has(val)) v.players = val;
        break;
      case "q":
        v.q = val;
        break;
      // `minlv` is deliberately unhandled: a Min level control shipped briefly and could not
      // filter anything (max_level is 250 on 1,630 of 1,635 rows), so it was removed. An old
      // link carrying it falls through to `default` and is ignored, like any stale key.
      case "summons":
        v.hideSummons = val === "1";
        break;
      case "auras":
        v.includeAuras = val === "1";
        break;
      case "sort": {
        const [k, d] = val.split(":");
        // Key and direction are one unit. An unrecognised key means the whole token is stale,
        // so the direction is discarded with it: applying the direction alone would leave a
        // state that is neither what the link asked for nor the default.
        if (k && SORT_VALUES.has(k)) {
          v.sortKey = k;
          v.sortDir = d === "-1" ? -1 : 1;
        }
        break;
      }
      default:
        break;
    }
  }
  return v;
}
