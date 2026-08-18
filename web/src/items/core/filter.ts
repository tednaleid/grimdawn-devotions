// ABOUTME: Pure filter/sort over the skill-items catalogue, driven by a ViewState.
// ABOUTME: i18n-free: callers inject a nameOf resolver so search/sort see resolved display text.
import type { ModStat } from "./effectText";
import { RARITIES, SLOTS } from "./facets";
import type { Item, Skill } from "./model";
import type { ViewState } from "./urlState";

export interface Row {
  item: Item;
  levels: number;
  modStats: ModStat[];
}

type NameOf = (item: Item) => string;

const RARITY_RANK: Record<string, number> = Object.fromEntries(RARITIES.map((r, i) => [r, i]));
const SLOT_RANK: Record<string, number> = Object.fromEntries(SLOTS.map((s, i) => [s, i]));

// A skill selection scopes to its node group (the base skill and its modifier/transmuter
// nodes), not the bare skill: see docs/superpowers/specs/2026-08-15-skill-item-finder-page-design.md.
// A mastery selection (no skill) scopes to every skill in that mastery. Neither selected means
// no scope at all, so applyView correctly returns no rows.
function scopeSkillSet(skills: Skill[], view: ViewState): Set<string> {
  if (view.skill) {
    const target = skills.find((s) => s.record === view.skill);
    if (!target) return new Set([view.skill]);
    return new Set(skills.filter((s) => s.group === target.group).map((s) => s.record));
  }
  if (view.mastery) {
    return new Set(skills.filter((s) => s.mastery === view.mastery).map((s) => s.record));
  }
  return new Set();
}

// Levels and modStats are both scoped to the selected skill/mastery, per the Task 12 interface:
// levels is the total skill levels the item grants within the scope, modStats the modifier
// stats within it (empty when the item only grants levels). A mastery-wide boost only counts
// toward levels when the caller has opted into it via view.masteryWide.
function buildRow(item: Item, scope: Set<string>, view: ViewState): Row | null {
  let levels = 0;
  for (const b of item.boosts) if (scope.has(b.skill)) levels += b.level;
  if (view.masteryWide && view.mastery) {
    for (const mb of item.masteryBoosts) if (mb.mastery === view.mastery) levels += mb.level;
  }
  const modStats: ModStat[] = [];
  for (const mb of item.modifiers) if (scope.has(mb.skill)) modStats.push(...mb.stats);

  if (levels === 0 && modStats.length === 0) return null;
  return { item, levels, modStats };
}

// A row's effect kind is derived from its already-scoped modStats, not recomputed from the raw
// item: "modifies" means it carries a modifier block for the selected scope, "levels" means it
// only raises rank there.
function kindOf(row: Row): string {
  return row.modStats.length > 0 ? "modifies" : "levels";
}

function matchesFilters(row: Row, view: ViewState, nameOf: NameOf): boolean {
  const item = row.item;
  if (view.fSlot.size && !item.slots.some((s) => view.fSlot.has(s))) return false;
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
    case "slot": {
      const ranks = row.item.slots.map((s) => SLOT_RANK[s] ?? SLOTS.length);
      return ranks.length ? Math.min(...ranks) : SLOTS.length;
    }
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
