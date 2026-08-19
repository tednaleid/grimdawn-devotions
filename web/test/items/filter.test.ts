// ABOUTME: Tests for applyView: scope resolution (skill/mastery), facet filters, and sort.
import { test, expect } from "bun:test";
import { applyView } from "../../src/items/core/filter";

const skill = (record: string, group: string, mastery: string) =>
  ({
    record,
    group,
    mastery,
    nodeKind: "base",
    uiX: 0,
    uiY: 0,
    nameTag: null,
    icon: "",
    maxLevel: 16,
    ultimateLevel: 26,
    ranks: [],
    pets: [],
  }) as any;

// Two skills in mastery A (different groups), one in mastery B.
const skills = [
  skill("s/cadence1", "s/cadence1", "m/A"),
  skill("s/blitz1", "s/blitz1", "m/A"),
  skill("s/other1", "s/other1", "m/B"),
];

const item = (record: string, over: Partial<any> = {}) =>
  ({
    record,
    nameTag: `tag${record}`,
    domain: "gear",
    slots: ["medal"],
    gearType: "medal",
    rarity: "Legendary",
    itemLevel: 94,
    tiers: [],
    grimtools: null,
    boosts: [],
    masteryBoosts: [],
    modifiers: [],
    ...over,
  }) as any;

const badge = item("badge", {
  boosts: [{ skill: "s/cadence1", level: 3 }],
  modifiers: [{ skill: "s/cadence1", stats: [{ stat: "offensiveFireMin", value: 200 }] }],
});
const plainRing = item("ring", { boosts: [{ skill: "s/cadence1", level: 2 }] });
const blitzOnly = item("blitz", { boosts: [{ skill: "s/blitz1", level: 4 }] });
const wideAmulet = item("amulet", { masteryBoosts: [{ mastery: "m/A", level: 1 }] });
const offMastery = item("off", { boosts: [{ skill: "s/other1", level: 5 }] });
const items = [badge, plainRing, blitzOnly, wideAmulet, offMastery];

const base = {
  mastery: "m/A",
  skills: new Set<string>(),
  fCat: new Set<string>(),
  fRarity: new Set<string>(),
  fDomain: new Set<string>(),
  fKind: new Set<string>(),
  masteryWide: false,
  q: "",
  sortKey: "name",
  sortDir: 1 as 1 | -1,
};
const nameOf = (i: any) => i.record;
const recs = (v: any) => applyView(items, skills, [], v, nameOf).map((r) => r.item.record);

test("a skill selection narrows to exactly that skill", () => {
  expect(recs({ ...base, skills: new Set(["s/cadence1"]) }).sort()).toEqual(["badge", "ring"]);
});

test("a mastery selection unions every skill in the mastery", () => {
  expect(recs(base).sort()).toEqual(["badge", "blitz", "ring"]);
});

test("mastery-wide boosts are excluded unless the toggle is on", () => {
  expect(recs(base)).not.toContain("amulet");
  expect(recs({ ...base, masteryWide: true })).toContain("amulet");
});

test("the modifies chip excludes level-only items", () => {
  expect(recs({ ...base, skills: new Set(["s/cadence1"]), fKind: new Set(["modifies"]) })).toEqual(["badge"]);
});

test("levels sums only the selected scope", () => {
  const rows = applyView(items, skills, [], { ...base, skills: new Set(["s/cadence1"]) }, nameOf);
  expect(rows.find((r) => r.item.record === "badge")!.levels).toBe(3);
});

test("search matches the resolved name, not the raw tag", () => {
  // "z1" and its nameTag "tagz1" don't contain "blitz" anywhere, so this only passes if the
  // implementation searches nameOf's resolved text and not the item's record or raw tag - unlike
  // the old fixture, where the raw tag "tagblitz" also happened to contain the query.
  const cloaked = item("z1", { boosts: [{ skill: "s/cadence1", level: 1 }] });
  const resolved: Record<string, string> = { z1: "Blitzkrieg Cloak" };
  const resolvedNameOf = (i: { record: string }) => resolved[i.record] ?? i.record;
  const rows = applyView([badge, plainRing, cloaked], skills, [], { ...base, q: "blitz" }, resolvedNameOf);
  expect(rows.map((r) => r.item.record)).toEqual(["z1"]);
});

test("sort is stable and breaks ties by record", () => {
  const tie = (r: string) => item(r, { boosts: [{ skill: "s/cadence1", level: 1 }] });
  const same = [tie("bbb"), tie("aaa")];
  const out = applyView(same, skills, [], { ...base, sortKey: "rarity" }, () => "same");
  expect(out.map((r) => r.item.record)).toEqual(["aaa", "bbb"]);
});

test("the record tiebreak reverses with sortDir, like every other sort key here", () => {
  // Documents current, intentional behavior (matches web/src/rr/core/filter.ts's own
  // `cmp * dir` tiebreak): flipping sortDir reverses the whole order, ties included, rather
  // than always breaking ascending. Kept as-is per fix-1 M6 - this test pins the behavior,
  // it does not judge it.
  const tie = (r: string) => item(r, { boosts: [{ skill: "s/cadence1", level: 1 }] });
  const same = [tie("aaa"), tie("bbb")];
  const out = applyView(same, skills, [], { ...base, sortKey: "rarity", sortDir: -1 }, () => "same");
  expect(out.map((r) => r.item.record)).toEqual(["bbb", "aaa"]);
});

test("several selected skills widen the scope to the union of their groups", () => {
  // The point of multi-select: a player planning around both skills sees items touching either,
  // not the (empty) intersection.
  expect(recs({ ...base, skills: new Set(["s/cadence1", "s/blitz1"]) }).sort()).toEqual(["badge", "blitz", "ring"]);
});

test("a skill id outside the catalogue scopes to itself rather than widening to everything", () => {
  // Mirrors treeView's own fallback for a stale link. Without it, an unknown id would contribute
  // no group and the selection would silently behave like "the whole mastery".
  expect(recs({ ...base, skills: new Set(["s/gone"]) })).toEqual([]);
});

test("the category facet separates weapons that share a slot list", () => {
  // The regression this facet exists for: every weapon in the game carries the same
  // ["main_hand","off_hand"] pair, so filtering on slots cannot tell these two apart. gear_type
  // can, and the facet is built from it.
  const spear = item("spear", {
    slots: ["main_hand", "off_hand"],
    gearType: "spear2h",
    boosts: [{ skill: "s/cadence1", level: 1 }],
  });
  const dagger = item("dagger", {
    slots: ["main_hand", "off_hand"],
    gearType: "dagger",
    boosts: [{ skill: "s/cadence1", level: 1 }],
  });
  const both = [spear, dagger];
  const pick = (cat: string) =>
    applyView(both, skills, [], { ...base, fCat: new Set([cat]) }, nameOf).map((r) => r.item.record);
  expect(pick("melee2h")).toEqual(["spear"]);
  expect(pick("daggerScepter")).toEqual(["dagger"]);
});

test("an unknown gear class falls back to its raw id instead of vanishing from the table", () => {
  // A game patch adding a weapon class core/facets.ts has not been taught must not make items
  // disappear: unfiltered they still show, and they only fail to match the known chips.
  const exotic = item("exotic", { gearType: "whip1h", boosts: [{ skill: "s/cadence1", level: 1 }] });
  expect(recs({ ...base })).toBeDefined();
  const all = applyView([exotic], skills, [], base, nameOf).map((r) => r.item.record);
  expect(all).toEqual(["exotic"]);
  const filtered = applyView([exotic], skills, [], { ...base, fCat: new Set(["melee1h"]) }, nameOf);
  expect(filtered).toEqual([]);
});

test("selecting a base does not pull in items that only touch its modifier", () => {
  // Selection is per node, so a group is a rendering relationship and not a filter scope. The
  // fixture's three skills are all their own group, so this needs a real modifier to be a test
  // of anything: modOnly is reachable only by picking the modifier itself.
  const withMod = [
    ...skills,
    skill("s/cadence2", "s/cadence1", "m/A"), // a modifier inside Cadence's group
  ];
  const modOnly = item("modonly", { boosts: [{ skill: "s/cadence2", level: 1 }] });
  const pool = [badge, modOnly];
  const pick = (record: string) =>
    applyView(pool, withMod, [], { ...base, skills: new Set([record]) }, nameOf).map((r) => r.item.record);
  expect(pick("s/cadence1")).toEqual(["badge"]);
  expect(pick("s/cadence2")).toEqual(["modonly"]);
});

test("a row reports which in-scope skills it matched, so the table can say why it is there", () => {
  const rows = applyView(items, skills, [], { ...base }, nameOf);
  expect(rows.find((r) => r.item.record === "badge")!.skills).toEqual(["s/cadence1"]);
  expect(rows.find((r) => r.item.record === "blitz")!.skills).toEqual(["s/blitz1"]);
  // A mastery-wide boost grants levels without naming a skill, so it matches no skill record.
  const wide = applyView(items, skills, [], { ...base, masteryWide: true }, nameOf);
  expect(wide.find((r) => r.item.record === "amulet")!.skills).toEqual([]);
});

// --- set bonuses ------------------------------------------------------------
// Ted's call: a set bonus makes the item match, because wearing the piece is how a player gets
// that bonus. The shape is Ultos' Tempest, whose Savagery block lives on the SET record and on
// none of its five members.
const ultos = {
  record: "sets/ultos",
  nameTag: "tagUltos",
  members: 5,
  modifiers: [{ pieces: 5, skill: "s/blitz1", stats: [{ stat: "offensiveFireMin", value: 33 }] }],
  boosts: [{ pieces: 4, skill: "s/cadence1", level: 2 }],
  masteryBoosts: [],
} as any;
const piece = item("piece", { boosts: [{ skill: "s/cadence1", level: 1 }], set: "sets/ultos" });
const strayPiece = item("stray", { set: "sets/ultos" });

test("a skill an item reaches only through its set still matches", () => {
  const rows = applyView([piece], skills, [ultos], { ...base, skills: new Set(["s/blitz1"]) }, nameOf);
  expect(rows.map((r) => r.item.record)).toEqual(["piece"]);
  // Nothing of the item's own is in scope, so its own numbers stay empty.
  expect(rows[0]!.levels).toBe(0);
  expect(rows[0]!.modBlocks).toEqual([]);
  expect(rows[0]!.set!.modBlocks).toEqual([
    { pieces: 5, skill: "s/blitz1", stats: [{ stat: "offensiveFireMin", value: 33 }] },
  ]);
});

// The Skills column badges exactly these, so a skill the item touches on its own must not be in
// the list even when the set touches it too.
test("set.skills names only what the item does not already reach itself", () => {
  const rows = applyView([piece], skills, [ultos], { ...base }, nameOf);
  expect(rows[0]!.skills).toEqual(["s/cadence1", "s/blitz1"]);
  expect(rows[0]!.set!.skills).toEqual(["s/blitz1"]);
});

// A set's +2 is not this item's +2: the Levels column reports what the piece grants on its own.
test("a set's skill levels stay out of the row's own level count", () => {
  const rows = applyView([piece], skills, [ultos], { ...base, skills: new Set(["s/cadence1"]) }, nameOf);
  expect(rows[0]!.levels).toBe(1);
  expect(rows[0]!.set!.boosts).toEqual([{ pieces: 4, skill: "s/cadence1", level: 2 }]);
});

// An item whose set has nothing in scope is filtered out exactly as before.
test("a set with no in-scope bonus does not put an item in the table", () => {
  const rows = applyView([strayPiece], skills, [ultos], { ...base, skills: new Set(["s/other1"]) }, nameOf);
  expect(rows).toEqual([]);
});

// A set-only match is a modifier match: the kind facet must not hide the row under "Levels".
test("a set modifier block counts as 'modifies' for the kind facet", () => {
  const scoped = { ...base, skills: new Set(["s/blitz1"]) };
  expect(applyView([piece], skills, [ultos], { ...scoped, fKind: new Set(["modifies"]) }, nameOf).length).toBe(1);
  expect(applyView([piece], skills, [ultos], { ...scoped, fKind: new Set(["levels"]) }, nameOf).length).toBe(0);
});

// The catalogue can omit a set (one with no skill wiring is not emitted), and an item still
// names it. That must read as "no set bonus", not throw.
test("an item naming a set the catalogue does not carry is left alone", () => {
  const rows = applyView([piece], skills, [], { ...base, skills: new Set(["s/cadence1"]) }, nameOf);
  expect(rows[0]!.set).toBeNull();
  expect(rows[0]!.skills).toEqual(["s/cadence1"]);
});
