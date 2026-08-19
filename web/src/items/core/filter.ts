// ABOUTME: Pure filter/sort over the skill-items catalogue, driven by a ViewState.
// ABOUTME: i18n-free: callers inject a nameOf resolver so search/sort see resolved display text.
import type { ModStat } from "./effectText";
import { CATEGORIES, categoryOf, RARITIES } from "./facets";
import type { Item, ItemSet, Skill } from "./model";
import type { ViewState } from "./urlState";

export interface Row {
  item: Item;
  levels: number;
  // One entry per in-scope modifier block, each holding that block's own stats. Never flatten
  // these into one array: effectLines keys a byId map and a used-set per call, so feeding it two
  // blocks' stats at once lets one skill's Min pair with a different skill's Max (see
  // .superpowers/sdd/2026-08-17-items-page/task-12-13-fix-1.md, C1). Callers must call
  // effectLines once per block and concatenate the resulting Text lines, not the stats.
  modBlocks: ModStat[][];
  // The in-scope skill records this item actually touches, boosted or modified, in the order the
  // item lists them, followed by any the item reaches only through its set. This is the row's
  // answer to "why is this here", which otherwise could only be had by expanding it.
  skills: string[];
  // The set this piece belongs to, when that set has in-scope bonuses of its own. A set bonus is
  // NOT merged into levels/modBlocks above: the player only has it while wearing `pieces` members,
  // so the page has to be able to say which is which.
  set: SetMatch | null;
}

/** What a row's set contributes inside the current scope. `skills` is the subset the item does not
 *  already touch on its own, which is what the table marks as set-sourced. */
export interface SetMatch {
  set: ItemSet;
  modBlocks: SetModMatch[];
  boosts: SetLevelMatch[];
  skills: string[];
}

export interface SetModMatch {
  pieces: number;
  skill: string;
  stats: ModStat[];
}

export interface SetLevelMatch {
  pieces: number;
  skill: string;
  level: number;
}

type NameOf = (item: Item) => string;

const RARITY_RANK: Record<string, number> = Object.fromEntries(RARITIES.map((r, i) => [r, i]));
const CATEGORY_RANK: Record<string, number> = Object.fromEntries(CATEGORIES.map((c, i) => [c, i]));

/** The item's gear category, falling back to its raw gear_type when the dataset carries a class
 *  core/facets.ts does not know yet. Filtering and sorting both go through this, so a new weapon
 *  class in a game patch sorts last and matches no chip rather than making items disappear. */
export function itemCategory(item: Item): string {
  return categoryOf(item.gearType) ?? item.gearType;
}

// A skill selection scopes to its node group (the base skill and its modifier/transmuter
// nodes), not the bare skill: see docs/superpowers/specs/2026-08-15-skill-item-finder-page-design.md.
// A mastery selection (no skill) scopes to every skill in that mastery. Neither selected means
// no scope at all, so applyView correctly returns no rows.
function scopeSkillSet(skills: Skill[], view: ViewState): Set<string> {
  if (view.skills.size) {
    // Exactly the nodes picked, not their whole node groups. Picking a skill is how the player
    // says which power they care about, and a group is a rendering relationship, not a claim
    // that its members are interchangeable - Reckless Power and Star Pact shared a group tag
    // while being mutually exclusive in game. Several picks WIDEN the scope (the union), so a
    // player planning around Cadence and Blitz sees every item touching either.
    return new Set(view.skills);
  }
  if (view.mastery) {
    return new Set(skills.filter((s) => s.mastery === view.mastery).map((s) => s.record));
  }
  return new Set();
}

// Levels and modBlocks are both scoped to the selected skill/mastery, per the Task 12 interface:
// levels is the total skill levels the item grants within the scope, modBlocks the item's
// in-scope modifier blocks, kept separate (empty when the item only grants levels). A
// mastery-wide boost only counts toward levels when the caller has opted into it via
// view.masteryWide.
// What the item's set contributes inside the scope, or null when it contributes nothing. Read
// through the catalogue's set list rather than off the item: a set's bonuses are stored once, not
// copied onto each of its five members.
function setMatch(item: Item, sets: Map<string, ItemSet>, scope: Set<string>, own: Set<string>): SetMatch | null {
  const set = item.set ? sets.get(item.set) : undefined;
  if (!set) return null;
  const modBlocks = set.modifiers.filter((m) => scope.has(m.skill));
  const boosts = set.boosts.filter((b) => scope.has(b.skill));
  if (!modBlocks.length && !boosts.length) return null;
  const reached: string[] = [];
  for (const r of [...modBlocks.map((m) => m.skill), ...boosts.map((b) => b.skill)]) {
    if (!own.has(r) && !reached.includes(r)) reached.push(r);
  }
  return {
    set,
    modBlocks: modBlocks.map((m) => ({ pieces: m.pieces, skill: m.skill, stats: m.stats })),
    boosts: boosts.map((b) => ({ pieces: b.pieces, skill: b.skill, level: b.level })),
    skills: reached,
  };
}

function buildRow(item: Item, scope: Set<string>, view: ViewState, sets: Map<string, ItemSet>): Row | null {
  let levels = 0;
  const matched = new Set<string>();
  for (const b of item.boosts) {
    if (!scope.has(b.skill)) continue;
    levels += b.level;
    matched.add(b.skill);
  }
  if (view.masteryWide && view.mastery) {
    for (const mb of item.masteryBoosts) if (mb.mastery === view.mastery) levels += mb.level;
  }
  const modBlocks: ModStat[][] = [];
  for (const mb of item.modifiers) {
    if (!scope.has(mb.skill)) continue;
    modBlocks.push(mb.stats);
    matched.add(mb.skill);
  }

  // A set bonus counts as a match: wearing the piece is how a player gets it, so an item whose
  // only tie to the selected skill is its set still belongs in the table. Its levels stay OUT of
  // `levels` and its stats out of `modBlocks`, because those are what the item gives on its own.
  const set = setMatch(item, sets, scope, matched);
  if (levels === 0 && modBlocks.length === 0 && !set) return null;
  return { item, levels, modBlocks, skills: [...matched, ...(set?.skills ?? [])], set };
}

// A row's effect kind is derived from its already-scoped modBlocks, not recomputed from the raw
// item: "modifies" means it carries a modifier block for the selected scope, "levels" means it
// only raises rank there. A set's modifier block counts, since it is a modifier the player gets
// by wearing this piece alongside the others.
function kindOf(row: Row): string {
  return row.modBlocks.length > 0 || (row.set?.modBlocks.length ?? 0) > 0 ? "modifies" : "levels";
}

function matchesFilters(row: Row, view: ViewState, nameOf: NameOf): boolean {
  const item = row.item;
  if (view.fCat.size && !view.fCat.has(itemCategory(item))) return false;
  if (view.fRarity.size && !view.fRarity.has(item.rarity)) return false;
  if (view.fDomain.size && !view.fDomain.has(item.domain)) return false;
  if (view.fKind.size && !view.fKind.has(kindOf(row))) return false;
  if (view.q) {
    // Search the resolved display name, not the raw record/tag, so a query matches what the
    // player actually sees.
    if (!nameOf(item).toLowerCase().includes(view.q.toLowerCase())) return false;
  }
  return true;
}

function sortKeyValue(row: Row, key: string, nameOf: NameOf): string | number {
  switch (key) {
    case "name":
      return nameOf(row.item);
    case "slot":
      return CATEGORY_RANK[itemCategory(row.item)] ?? CATEGORIES.length;
    case "rarity":
      return RARITY_RANK[row.item.rarity] ?? RARITIES.length;
    case "ilvl":
      return row.item.itemLevel;
    case "levels":
      return row.levels;
    default:
      return nameOf(row.item);
  }
}

/** Filter then sort items for the current view. Stable, pure; ties break by item.record. */
export function applyView(items: Item[], skills: Skill[], sets: ItemSet[], view: ViewState, nameOf: NameOf): Row[] {
  const scope = scopeSkillSet(skills, view);
  const setsByRecord = new Map(sets.map((s) => [s.record, s]));
  const rows: Row[] = [];
  for (const item of items) {
    const row = buildRow(item, scope, view, setsByRecord);
    if (row && matchesFilters(row, view, nameOf)) rows.push(row);
  }
  const dir = view.sortDir;
  return rows.sort((a, b) => {
    const va = sortKeyValue(a, view.sortKey, nameOf);
    const vb = sortKeyValue(b, view.sortKey, nameOf);
    let cmp: number;
    if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
    else cmp = String(va).localeCompare(String(vb));
    if (cmp === 0) cmp = a.item.record.localeCompare(b.item.record);
    return cmp * dir;
  });
}
