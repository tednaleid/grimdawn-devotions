// ABOUTME: Single source of truth for the items page's facet vocabularies and sort keys.
// ABOUTME: urlState.ts derives its hash-validation sets from these; the table renders chips from them.

// The 13 slot ids, ordered head to feet (armor), then weapons, then jewellery.
export const SLOTS: string[] = [
  "head",
  "shoulders",
  "chest",
  "hands",
  "waist",
  "legs",
  "feet",
  "main_hand",
  "off_hand",
  "amulet",
  "ring",
  "medal",
  "relic",
];

export const RARITIES: string[] = ["Legendary", "Epic", "Rare", "Common"];

export const DOMAINS: string[] = ["gear", "relic"];

// "modifies" = the item carries a ModBlock for the selected skill; "levels" = it boosts
// the skill's rank via Boost/MasteryBoost.
export const EFFECT_KINDS: string[] = ["modifies", "levels"];

// Mirrors the table's sortable columns; urlState.ts validates an incoming `sort=` key
// against this before trusting it.
export const SORT_KEYS: string[] = ["name", "slot", "rarity", "ilvl", "levels"];
