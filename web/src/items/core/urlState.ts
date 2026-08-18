// ABOUTME: The items page ViewState (every view-changing control) and its hash codec.
// ABOUTME: ViewState is the single source of view state; main.ts round-trips it through the URL hash.
import { putSet, readSet } from "../../core/hashCodec";
import { CATEGORIES, DOMAINS, EFFECT_KINDS, RARITIES, SORT_KEYS } from "./facets";

export interface ViewState {
  mastery: string | null;
  // Several skills widen the scope: the table shows items touching ANY of them, so a player can
  // see everything relevant to a planned build at once. Empty means the whole mastery is in
  // scope (see core/filter.ts's scopeSkillSet). Every member belongs to `mastery`.
  skills: Set<string>;
  fCat: Set<string>;
  fRarity: Set<string>;
  fDomain: Set<string>;
  fKind: Set<string>;
  masteryWide: boolean;
  q: string;
  sortKey: string;
  sortDir: 1 | -1;
}

export const DEFAULT_VIEW: ViewState = {
  mastery: null,
  skills: new Set(),
  fCat: new Set(),
  fRarity: new Set(),
  fDomain: new Set(),
  fKind: new Set(),
  masteryWide: false,
  q: "",
  sortKey: "name",
  sortDir: 1,
};

const CATEGORY_VALUES = new Set(CATEGORIES);
const RARITY_VALUES = new Set(RARITIES);
const DOMAIN_VALUES = new Set(DOMAINS);
const KIND_VALUES = new Set(EFFECT_KINDS);
const SORT_VALUES = new Set(SORT_KEYS);

/** Encode the view into a `key=value&...` hash body (no leading '#'). Defaults are omitted,
 *  so a link to the default view is just the bare page URL. */
export function encodeHash(v: ViewState): string {
  const parts: string[] = [];
  if (v.mastery) parts.push(`mastery=${encodeURIComponent(v.mastery)}`);
  putSet(parts, "skill", v.skills);
  putSet(parts, "cat", v.fCat);
  putSet(parts, "rarity", v.fRarity);
  putSet(parts, "domain", v.fDomain);
  putSet(parts, "kind", v.fKind);
  if (v.masteryWide) parts.push("wide=1");
  if (v.q) parts.push(`q=${encodeURIComponent(v.q)}`);
  if (v.sortKey !== DEFAULT_VIEW.sortKey || v.sortDir !== DEFAULT_VIEW.sortDir) {
    parts.push(`sort=${v.sortKey}:${v.sortDir}`);
  }
  return parts.join("&");
}

/** Decode a hash body onto DEFAULT_VIEW, tolerating garbage and stale links.
 *
 *  `known` comes from the loaded catalogue rather than a constant: mastery and skill ids are
 *  data, not a fixed vocabulary. A mastery id absent from `known` (a stale link after a dataset
 *  update) falls back to no selection rather than throwing, and an unknown skill id is dropped
 *  from the list on its own. `known.skills` maps each skill record to its owning mastery record,
 *  which serves two invariants at the end of this function: a hash carrying valid skills but no
 *  (or a stale) `mastery` backfills the mastery from the first of them, and any skill outside the
 *  resulting mastery is dropped. Both exist so the pickers and the active filter can never
 *  disagree - without the backfill, a valid skill with a missing mastery filtered the table while
 *  both pickers showed no selection and Reset could not clear it (fix round 1, M4), and the only
 *  escape was picking a mastery by hand.
 */
export function decodeHash(hash: string, known: { masteries: Set<string>; skills: Map<string, string> }): ViewState {
  const v: ViewState = {
    ...DEFAULT_VIEW,
    skills: new Set(),
    fCat: new Set(),
    fRarity: new Set(),
    fDomain: new Set(),
    fKind: new Set(),
  };
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  for (const pair of body.split("&")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const key = pair.slice(0, eq);
    const rawVal = pair.slice(eq + 1);
    // Set-valued keys read the raw value: readSet drops bad tokens individually, where the
    // outer decode below would discard the whole list on one malformed member.
    if (key === "cat") {
      v.fCat = readSet(rawVal, CATEGORY_VALUES);
      continue;
    }
    if (key === "skill") {
      // Validated against the catalogue rather than a fixed vocabulary: skill ids are data.
      // readSet drops an unknown id (a stale link) on its own, leaving the rest of the list.
      v.skills = readSet(rawVal, new Set(known.skills.keys()));
      continue;
    }
    if (key === "rarity") {
      v.fRarity = readSet(rawVal, RARITY_VALUES);
      continue;
    }
    if (key === "domain") {
      v.fDomain = readSet(rawVal, DOMAIN_VALUES);
      continue;
    }
    if (key === "kind") {
      v.fKind = readSet(rawVal, KIND_VALUES);
      continue;
    }
    let val: string;
    try {
      val = decodeURIComponent(rawVal);
    } catch {
      continue;
    }
    switch (key) {
      case "mastery":
        v.mastery = known.masteries.has(val) ? val : null;
        break;
      case "wide":
        v.masteryWide = val === "1";
        break;
      case "q":
        v.q = val;
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
  // A valid skill with no (or a stale) mastery backfills from the skill's own record, so the
  // mastery/skill pickers and the active filter never disagree. mastery and skill are decoded
  // independently above and each can arrive in either order, so this runs once the whole hash
  // has been read rather than inline in the "skill" case.
  const firstSkill = [...v.skills][0];
  if (firstSkill && !v.mastery) {
    v.mastery = known.skills.get(firstSkill) ?? null;
  }
  // Every selected skill must belong to the selected mastery. The tree only ever shows one
  // mastery, so a hand-edited hash mixing two would filter the table by skills the tree cannot
  // display or clear - the same disagreement the mastery backfill above exists to prevent.
  if (v.mastery) {
    for (const record of [...v.skills]) {
      if (known.skills.get(record) !== v.mastery) v.skills.delete(record);
    }
  }
  return v;
}
