// ABOUTME: Single source of truth for the items page's facet vocabularies and sort keys.
// ABOUTME: urlState.ts derives its hash-validation sets from these; the table renders chips from them.

// The gear category each item falls into: the facet the page filters and sorts on, and what
// the table's category column shows.
//
// This replaces filtering on the item's `slots` list, which cannot answer the question players
// actually ask. data/item-curation/gear-types.json gives EVERY weapon class the same
// ["main_hand", "off_hand"] pair, one-handed and two-handed alike, so by slots a dagger and a
// two-handed spear are identical and an "off hand" filter returns 118 two-handers that cannot be
// equipped in an off hand. `gear_type` is the field that separates them.
//
// The seven weapon categories are the game's own, from its loot filter, so the grouping is Crate's
// rather than ours and the labels come already translated into every locale (see FACET_TAGS in
// scripts/build_game_tables.py). The game's help text states the grouping: tagLootFilter10Info
// reads "Two-handed Axes, Maces, Spears and Swords" against axe2h/mace2h/spear2h/sword2h.
// Armour, jewellery and relics keep their own names, where gear_type already equals the slot.
export const CATEGORIES: string[] = [
  "head",
  "shoulders",
  "chest",
  "hands",
  "waist",
  "legs",
  "feet",
  "melee1h",
  "melee2h",
  "ranged1h",
  "ranged2h",
  "daggerScepter",
  "casterOffHand",
  "shield",
  "amulet",
  "ring",
  "medal",
  "relic",
];

// gear_type (as emitted by scripts/build_skill_items.py) to its category. Every one of the 24
// gear_types present on the page maps here; an unmapped one is a dataset change, and categoryOf
// reports it as null rather than guessing a bucket.
const CATEGORY_BY_GEAR_TYPE: Record<string, string> = {
  head: "head",
  shoulders: "shoulders",
  chest: "chest",
  hands: "hands",
  waist: "waist",
  legs: "legs",
  feet: "feet",
  sword1h: "melee1h",
  axe1h: "melee1h",
  mace1h: "melee1h",
  sword2h: "melee2h",
  axe2h: "melee2h",
  mace2h: "melee2h",
  spear2h: "melee2h",
  ranged1h: "ranged1h",
  ranged2h: "ranged2h",
  dagger: "daggerScepter",
  scepter: "daggerScepter",
  offhand: "casterOffHand",
  shield: "shield",
  amulet: "amulet",
  ring: "ring",
  medal: "medal",
  relic: "relic",
};

/** The category for a gear_type, or null when the dataset carries one this table does not know.
 *  Callers show an unknown category as the raw gear_type rather than dropping the item: a new
 *  weapon class in a game patch must not make items silently vanish from the table. */
export function categoryOf(gearType: string): string | null {
  return CATEGORY_BY_GEAR_TYPE[gearType] ?? null;
}

// The game's own tag for each weapon category, from its loot filter. Armour, jewellery and relic
// categories are not here: the game has no single tag naming those buckets, so they resolve
// through the app catalogue's items.category.* keys like every other page string.
const GAME_TAG_BY_CATEGORY: Record<string, string> = {
  melee1h: "tagLootFilter09",
  melee2h: "tagLootFilter10",
  ranged1h: "tagLootFilter11",
  ranged2h: "tagLootFilter12",
  daggerScepter: "tagLootFilter13",
  casterOffHand: "tagLootFilter14",
  shield: "tagLootFilter15",
};

/** The game tag naming a category, or null when the category is named from the app catalogue. */
export function categoryGameTag(category: string): string | null {
  return GAME_TAG_BY_CATEGORY[category] ?? null;
}

export const RARITIES: string[] = ["Legendary", "Epic", "Rare", "Common"];

export const DOMAINS: string[] = ["gear", "relic"];

// "modifies" = the item carries a ModBlock for the selected skill; "levels" = it boosts
// the skill's rank via Boost/MasteryBoost.
export const EFFECT_KINDS: string[] = ["modifies", "levels"];

// Mirrors the table's sortable columns; urlState.ts validates an incoming `sort=` key
// against this before trusting it.
export const SORT_KEYS: string[] = ["name", "slot", "rarity", "ilvl", "levels"];
