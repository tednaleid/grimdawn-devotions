// ABOUTME: Single source of truth for the RR page's three ordered chip facet lists.
// ABOUTME: tableView.ts renders chips from these; urlState.ts derives its hash-validation sets from them.
import type { RrType } from "./model";

export const DAMAGE_TYPES = [
  "Physical",
  "Pierce",
  "Fire",
  "Cold",
  "Lightning",
  "Poison & Acid",
  "Aether",
  "Chaos",
  "Vitality",
  "Bleeding",
];

export const RR_TYPES: RrType[] = ["stacking", "reduced-percent", "reduced-flat"];

export const COARSE_CATEGORIES = ["devotion", "skill", "item"] as const;

// The source facet's default selection: devotion and skill are the deterministic, farmable-once RR
// sources most builds plan around; items (the large majority of rows) are opt-in. Unlike the damage
// and RR facets, this facet defaults to a non-empty selection, so the hash codec always emits it.
export const DEFAULT_COARSE_CATEGORIES = ["devotion", "skill"] as const;

// Mirrors the `key`s in tableView.ts's COLS: every column the table can be sorted by.
// urlState.ts validates an incoming `sort=` key against this before trusting it.
export const SORT_KEYS = ["name", "cat", "rr", "typesLabel", "value", "trigger", "dur"] as const;
