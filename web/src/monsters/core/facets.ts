// ABOUTME: Single source of truth for the monster page's ordered facet lists and damage types.
// ABOUTME: The DamageType and Difficulty types derive from these lists, so there is one definition.
//
// This module owns both the constants and the types derived from them, and imports nothing from
// ./model. model.ts imports from here. Defining the type in model.ts and the array here would
// make the two files import each other, which survives only because type imports are erased.

/** The ten damage types, in the order every table column, ranking row and offset array uses. */
export const DAMAGE_TYPES = [
  "physical",
  "pierce",
  "fire",
  "cold",
  "lightning",
  "poison",
  "aether",
  "chaos",
  "vitality",
  "bleeding",
] as const;

export type DamageType = (typeof DAMAGE_TYPES)[number];

/** The six monster classifications, ordered weakest to strongest rather than alphabetically. */
export const TIERS = ["Common", "Champion", "Hero", "Boss", "SuperBoss", "Quest"];

export const DIFFICULTIES = ["normal", "elite", "ultimate"] as const;

export type Difficulty = (typeof DIFFICULTIES)[number];

export const PLAYER_COUNTS = ["1", "2", "3", "4"];
