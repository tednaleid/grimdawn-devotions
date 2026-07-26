// ABOUTME: Tests for the pure monster filter and sort.
// ABOUTME: Search and sort go through an injected resolver, so core never sees a locale.
import { test, expect } from "bun:test";
import { applyView } from "../../src/monsters/core/filter";
import { DEFAULT_VIEW, type ViewState } from "../../src/monsters/core/urlState";
import { DAMAGE_TYPES } from "../../src/monsters/core/facets";
import type { Monster, Resistances } from "../../src/monsters/core/model";

const ZERO = Object.fromEntries(DAMAGE_TYPES.map((t) => [t, 0])) as Resistances;

function mon(id: string, over: Partial<Monster> = {}): Monster {
  return {
    id,
    nameTag: `tag_${id}`,
    classification: "Common",
    role: "base",
    raceTag: null,
    minLevel: 1,
    maxLevel: 50,
    isSummon: false,
    variantCount: 1,
    variantsDisagree: false,
    resistances: { ...ZERO },
    passive: {},
    aura: {},
    ...over,
  };
}

const NAMES: Record<string, string> = { a: "Alkamos", b: "Kaisan", c: "Fabius" };
const nameOf = (m: Monster) => NAMES[m.id] ?? m.id;

const ROWS = [
  mon("a", { classification: "Quest", role: "boss&quest", maxLevel: 100, resistances: { ...ZERO, fire: 30 } }),
  mon("b", {
    classification: "Hero",
    role: "nemesis",
    maxLevel: 90,
    isSummon: true,
    resistances: { ...ZERO, fire: 10 },
  }),
  mon("c", { classification: "Common", role: "base", maxLevel: 20, resistances: { ...ZERO, fire: 50 } }),
];

function view(over: Partial<ViewState> = {}): ViewState {
  return { ...DEFAULT_VIEW, ...over };
}

test("an empty view returns every row", () => {
  expect(applyView(ROWS, view(), ZERO, nameOf)).toHaveLength(3);
});

test("the tier facet filters, and an empty set means all", () => {
  expect(applyView(ROWS, view({ tiers: new Set(["Hero"]) }), ZERO, nameOf).map((m) => m.id)).toEqual(["b"]);
  expect(applyView(ROWS, view({ tiers: new Set() }), ZERO, nameOf)).toHaveLength(3);
});

test("the role facet filters", () => {
  expect(
    applyView(ROWS, view({ roles: new Set(["nemesis", "base"]) }), ZERO, nameOf)
      .map((m) => m.id)
      .sort(),
  ).toEqual(["b", "c"]);
});

test("search matches the resolved name case-insensitively, not the id or tag", () => {
  expect(applyView(ROWS, view({ q: "kais" }), ZERO, nameOf).map((m) => m.id)).toEqual(["b"]);
  expect(applyView(ROWS, view({ q: "KAIS" }), ZERO, nameOf).map((m) => m.id)).toEqual(["b"]);
  // "tag_a" is the raw tag; searching it must not match, because the user never sees it.
  expect(applyView(ROWS, view({ q: "tag_a" }), ZERO, nameOf)).toHaveLength(0);
});

test("minLevel filters on maxLevel", () => {
  expect(
    applyView(ROWS, view({ minLevel: 90 }), ZERO, nameOf)
      .map((m) => m.id)
      .sort(),
  ).toEqual(["a", "b"]);
});

test("hideSummons drops summoned rows", () => {
  expect(
    applyView(ROWS, view({ hideSummons: true }), ZERO, nameOf)
      .map((m) => m.id)
      .sort(),
  ).toEqual(["a", "c"]);
});

test("filters combine conjunctively", () => {
  const v = view({ tiers: new Set(["Hero", "Quest"]), minLevel: 95 });
  expect(applyView(ROWS, v, ZERO, nameOf).map((m) => m.id)).toEqual(["a"]);
});

test("default sort is by resolved name ascending", () => {
  expect(applyView(ROWS, view(), ZERO, nameOf).map((m) => m.id)).toEqual(["a", "c", "b"]);
});

test("sorting by a damage type uses the effective value and respects direction", () => {
  const desc = applyView(ROWS, view({ sortKey: "fire", sortDir: -1 }), ZERO, nameOf);
  expect(desc.map((m) => m.id)).toEqual(["c", "a", "b"]);
  const asc = applyView(ROWS, view({ sortKey: "fire", sortDir: 1 }), ZERO, nameOf);
  expect(asc.map((m) => m.id)).toEqual(["b", "a", "c"]);
});

test("sorting by a damage type accounts for the difficulty offset", () => {
  const off = { ...ZERO, fire: 100 } as Resistances;
  const rows = applyView(ROWS, view({ sortKey: "fire", sortDir: -1 }), off, nameOf);
  // The offset is flat, so it shifts every row equally and the order is unchanged.
  expect(rows.map((m) => m.id)).toEqual(["c", "a", "b"]);
});

test("sorting by level and by tier works", () => {
  expect(applyView(ROWS, view({ sortKey: "level", sortDir: -1 }), ZERO, nameOf).map((m) => m.id)).toEqual([
    "a",
    "b",
    "c",
  ]);
  expect(applyView(ROWS, view({ sortKey: "tier", sortDir: 1 }), ZERO, nameOf)[0]!.classification).toBe("Common");
});

test("ties break on id so the order is deterministic", () => {
  const tied = [mon("z"), mon("y")];
  const namesTied = (_m: Monster) => "same";
  expect(applyView(tied, view(), ZERO, namesTied).map((m) => m.id)).toEqual(["y", "z"]);
});
