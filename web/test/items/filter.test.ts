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
  skill: null as string | null,
  fSlot: new Set<string>(),
  fRarity: new Set<string>(),
  fDomain: new Set<string>(),
  fKind: new Set<string>(),
  masteryWide: false,
  q: "",
  sortKey: "name",
  sortDir: 1 as 1 | -1,
};
const nameOf = (i: any) => i.record;
const recs = (v: any) => applyView(items, skills, v, nameOf).map((r) => r.item.record);

test("a skill selection narrows to that node group", () => {
  expect(recs({ ...base, skill: "s/cadence1" }).sort()).toEqual(["badge", "ring"]);
});

test("a mastery selection unions every skill in the mastery", () => {
  expect(recs(base).sort()).toEqual(["badge", "blitz", "ring"]);
});

test("mastery-wide boosts are excluded unless the toggle is on", () => {
  expect(recs(base)).not.toContain("amulet");
  expect(recs({ ...base, masteryWide: true })).toContain("amulet");
});

test("the modifies chip excludes level-only items", () => {
  expect(recs({ ...base, skill: "s/cadence1", fKind: new Set(["modifies"]) })).toEqual(["badge"]);
});

test("levels sums only the selected scope", () => {
  const rows = applyView(items, skills, { ...base, skill: "s/cadence1" }, nameOf);
  expect(rows.find((r) => r.item.record === "badge")!.levels).toBe(3);
});

test("search matches the resolved name, not the raw tag", () => {
  expect(recs({ ...base, q: "blitz" })).toEqual(["blitz"]);
});

test("sort is stable and breaks ties by record", () => {
  const tie = (r: string) => item(r, { boosts: [{ skill: "s/cadence1", level: 1 }] });
  const same = [tie("bbb"), tie("aaa")];
  const out = applyView(same, skills, { ...base, sortKey: "rarity" }, () => "same");
  expect(out.map((r) => r.item.record)).toEqual(["aaa", "bbb"]);
});
