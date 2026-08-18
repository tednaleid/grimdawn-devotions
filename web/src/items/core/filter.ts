// ABOUTME: Pure filter/sort over the skill-items catalogue, driven by a ViewState.
// ABOUTME: i18n-free: callers inject a nameOf resolver so search/sort see resolved display text.
import type { ModStat } from "./effectText";
import { CATEGORIES, categoryOf, RARITIES } from "./facets";
import type { Item, Skill } from "./model";
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
  // item lists them. This is the row's answer to "why is this here", which otherwise could only
  // be had by expanding it.
  skills: string[];
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
function buildRow(item: Item, scope: Set<string>, view: ViewState): Row | null {
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

  if (levels === 0 && modBlocks.length === 0) return null;
  return { item, levels, modBlocks, skills: [...matched] };
}

// A row's effect kind is derived from its already-scoped modBlocks, not recomputed from the raw
// item: "modifies" means it carries a modifier block for the selected scope, "levels" means it
// only raises rank there.
function kindOf(row: Row): string {
  return row.modBlocks.length > 0 ? "modifies" : "levels";
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
export function applyView(items: Item[], skills: Skill[], view: ViewState, nameOf: NameOf): Row[] {
  const scope = scopeSkillSet(skills, view);
  const rows: Row[] = [];
  for (const item of items) {
    const row = buildRow(item, scope, view);
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
