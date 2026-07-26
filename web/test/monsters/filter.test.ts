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
  // The level fields stay populated and non-parallel even though nothing sorts or filters on
  // them any more: they are part of the Monster contract, so a fixture that zeroed them would
  // stop representing real rows.
  mon("a", {
    classification: "Quest",
    role: "boss&quest",
    minLevel: 5,
    maxLevel: 100,
    resistances: { ...ZERO, fire: 30 },
  }),
  mon("b", {
    classification: "Hero",
    role: "nemesis",
    minLevel: 60,
    maxLevel: 90,
    isSummon: true,
    resistances: { ...ZERO, fire: 10 },
  }),
  mon("c", { classification: "Common", role: "base", minLevel: 15, maxLevel: 20, resistances: { ...ZERO, fire: 50 } }),
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

test("hideSummons drops summoned rows", () => {
  expect(
    applyView(ROWS, view({ hideSummons: true }), ZERO, nameOf)
      .map((m) => m.id)
      .sort(),
  ).toEqual(["a", "c"]);
});

test("filters combine conjunctively", () => {
  // Tier alone keeps a and b; adding the summon toggle must narrow it to a, not union.
  const v = view({ tiers: new Set(["Hero", "Quest"]), hideSummons: true });
  expect(applyView(ROWS, v, ZERO, nameOf).map((m) => m.id)).toEqual(["a"]);
  expect(
    applyView(ROWS, view({ tiers: new Set(["Hero", "Quest"]) }), ZERO, nameOf)
      .map((m) => m.id)
      .sort(),
  ).toEqual(["a", "b"]);
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

test("a flat difficulty offset shifts every row equally and cannot reorder them", () => {
  const off = { ...ZERO, fire: 100 } as Resistances;
  const rows = applyView(ROWS, view({ sortKey: "fire", sortDir: -1 }), off, nameOf);
  expect(rows.map((m) => m.id)).toEqual(["c", "a", "b"]);
});

test("sorting by a damage type ranks on the effective value, not the base", () => {
  // A flat offset cannot discriminate base-vs-effective sorting: it moves every row by the
  // same amount, so the order is identical either way. Auras can, because they are per
  // monster. Here `low` has the smaller base but the larger effective value, so an
  // implementation sorting on `m.resistances` would return the opposite order.
  const high = mon("high", { resistances: { ...ZERO, fire: 30 } });
  const low = mon("low", { resistances: { ...ZERO, fire: 10 }, aura: { fire: 50 } });
  const v = view({ sortKey: "fire", sortDir: -1, includeAuras: true });
  expect(applyView([high, low], v, ZERO, nameOf).map((m) => m.id)).toEqual(["low", "high"]);
  // With auras excluded the effective values are 30 and 10, so the order flips back.
  const noAuras = view({ sortKey: "fire", sortDir: -1, includeAuras: false });
  expect(applyView([high, low], noAuras, ZERO, nameOf).map((m) => m.id)).toEqual(["high", "low"]);
});

test("sorting by tier uses the weakest-to-strongest rank, not alphabetical order", () => {
  // Boss sorts before Common alphabetically but after it by rank, so this discriminates.
  const boss = mon("boss", { classification: "Boss" });
  const common = mon("common", { classification: "Common" });
  const asc = applyView([boss, common], view({ sortKey: "tier", sortDir: 1 }), ZERO, nameOf);
  expect(asc.map((m) => m.classification)).toEqual(["Common", "Boss"]);
});

test("sorting by role uses the role text", () => {
  expect(applyView(ROWS, view({ sortKey: "role", sortDir: 1 }), ZERO, nameOf).map((m) => m.role)).toEqual([
    "base",
    "boss&quest",
    "nemesis",
  ]);
});

test("an unknown sort key falls through to a resistance lookup and cannot throw", () => {
  // "level" was a real key until the Lv column was dropped; a stale link can still carry it.
  // decodeHash rejects it, but applyView must stay total for any string that reaches it.
  const rows = applyView(ROWS, view({ sortKey: "level" }), ZERO, nameOf);
  expect(rows).toHaveLength(3);
});

test("ties break on id so the order is deterministic", () => {
  const tied = [mon("z"), mon("y")];
  const namesTied = (_m: Monster) => "same";
  expect(applyView(tied, view(), ZERO, namesTied).map((m) => m.id)).toEqual(["y", "z"]);
});
