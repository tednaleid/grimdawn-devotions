// ABOUTME: Tests pure filter/sort over logical sources driven by a ViewState.
import { test, expect } from "bun:test";
import { parseCatalogue } from "../../src/rr/core/model";
import { aggregate } from "../../src/rr/core/aggregate";
import { applyView, coarseCategory } from "../../src/rr/core/filter";
import { DEFAULT_VIEW, type ViewState } from "../../src/rr/core/urlState";
import { sourceHits } from "../../src/rr/core/ledger";
import doc from "../../../data/resistance-reduction.json";

const logical = aggregate(parseCatalogue(doc).sources);
const nameOf = (s: { name: string }) => s.name;
const view = (patch: Partial<ViewState>): ViewState => ({ ...DEFAULT_VIEW, ...patch });

test("RR-type filter narrows to one type", () => {
  const out = applyView(logical, view({ fRR: new Set(["stacking"]) }), nameOf);
  expect(out.length).toBeGreaterThan(0);
  expect(out.every((s) => s.rrType === "stacking")).toBe(true);
});

test("damage-type Fire folds in Elemental and All sources (OR within the facet)", () => {
  const out = applyView(logical, view({ fType: new Set(["Fire"]) }), nameOf);
  expect(out.some((s) => s.resistances.includes("Elemental"))).toBe(true);
  expect(out.some((s) => s.resistances.includes("All"))).toBe(true);
  expect(out.every((s) => sourceHits(s, "Fire"))).toBe(true);
});

test("damage type AND category: every result matches both facets", () => {
  const out = applyView(logical, view({ fType: new Set(["Fire"]), fCat: new Set(["devotion"]) }), nameOf);
  expect(out.length).toBeGreaterThan(0);
  expect(out.every((s) => coarseCategory(s.category) === "devotion" && sourceHits(s, "Fire"))).toBe(true);
});

test("coarseCategory maps fine categories to devotion/skill/item", () => {
  expect(coarseCategory("relic")).toBe("item");
  expect(coarseCategory("mastery skill")).toBe("skill");
  expect(coarseCategory("modifier")).toBe("skill");
  expect(coarseCategory("devotion")).toBe("devotion");
  expect(coarseCategory("item skill modifier")).toBe("item");
});

test("empty facet set applies no constraint", () => {
  const out = applyView(logical, view({ fType: new Set() }), nameOf);
  expect(out.length).toBe(logical.length);
});

test("search matches the resolved parent/item name, not the raw tag", () => {
  const conduit = logical.find((s) => s.parent === "tagGDX1NecklaceD113C");
  expect(conduit).toBeDefined();
  const parentOf = (s: { parent: string }) =>
    s.parent === "tagGDX1NecklaceD113C" ? "Conduit of Eldritch Whispers" : s.parent;
  // Raw-key resolver: "conduit" finds nothing (the bug); resolved parent: it finds the Conduit rows.
  expect(applyView(logical, view({ q: "conduit" }), nameOf).length).toBe(0);
  const hits = applyView(logical, view({ q: "conduit" }), nameOf, parentOf);
  expect(hits.length).toBeGreaterThan(0);
  expect(hits.every((s) => s.parent === "tagGDX1NecklaceD113C")).toBe(true);
});

test("default rr sort reads in application order: stacking, then percent, then flat", () => {
  const out = applyView(logical, view({ sortKey: "rr", sortDir: 1 }), nameOf);
  const rank = { stacking: 0, "reduced-percent": 1, "reduced-flat": 2 } as const;
  const ranks = out.map((s) => rank[s.rrType]);
  for (let i = 1; i < ranks.length; i++) expect(ranks[i]!).toBeGreaterThanOrEqual(ranks[i - 1]!);
  expect(out[0]!.rrType).toBe("stacking");
});

test("sort by value orders by |valueAtMax|", () => {
  const asc = applyView(logical, view({ sortKey: "value", sortDir: 1 }), nameOf);
  const mags = asc.map((s) => Math.abs(s.valueAtMax ?? 0));
  for (let i = 1; i < mags.length; i++) expect(mags[i]!).toBeGreaterThanOrEqual(mags[i - 1]!);
});
