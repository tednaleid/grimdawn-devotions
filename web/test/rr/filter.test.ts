// ABOUTME: Tests pure filter/sort/group over logical sources driven by a ViewState.
import { test, expect } from "bun:test";
import { parseCatalogue } from "../../src/rr/core/model";
import { aggregate } from "../../src/rr/core/aggregate";
import { applyView, groupView } from "../../src/rr/core/filter";
import { DEFAULT_VIEW, type ViewState } from "../../src/rr/core/urlState";
import doc from "../../../data/resistance-reduction.json";

const logical = aggregate(parseCatalogue(doc).sources);
const nameOf = (s: { name: string }) => s.name;
const view = (patch: Partial<ViewState>): ViewState => ({ ...DEFAULT_VIEW, ...patch });

test("RR-type filter narrows to one type", () => {
  const out = applyView(logical, view({ fRR: "stacking" }), nameOf);
  expect(out.length).toBeGreaterThan(0);
  expect(out.every((s) => s.rrType === "stacking")).toBe(true);
});

test("damage-type Fire includes an Elemental source", () => {
  const out = applyView(logical, view({ fType: "Fire" }), nameOf);
  expect(out.some((s) => s.resistances.includes("Elemental"))).toBe(true);
  expect(
    out.every(
      (s) => s.resistances.includes("Fire") || s.resistances.includes("Elemental") || s.resistances.includes("All"),
    ),
  ).toBe(true);
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

test("group by category yields buckets; none yields one", () => {
  const sorted = applyView(logical, view({}), nameOf);
  const one = groupView(sorted, view({ group: "none" }), (s) => s.category);
  expect(one.length).toBe(1);
  expect(one[0]!.items.length).toBe(sorted.length);

  const buckets = groupView(sorted, view({ group: "item" }), (s) => s.category);
  expect(buckets.length).toBeGreaterThan(1);
  expect(buckets.some((b) => b.key === "devotion")).toBe(true);
});
