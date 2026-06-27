// ABOUTME: Tests for affinity computation - completion detection, totals, and requirement checks.
// ABOUTME: Uses real devotions.json data (crossroads_eldritch, bat) to verify correct affinity values.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { completedConstellations, affinityTotals, meetsRequirement, matchedAffinities } from "../src/core/affinity";

const model = buildModel(doc as any);

test("a single-star Crossroads completes when its star is taken", () => {
  const completed = completedConstellations(model, new Set(["crossroads_eldritch:0"]));
  expect(completed.has("crossroads_eldritch")).toBe(true);
});

test("an incomplete constellation grants no affinity", () => {
  const totals = affinityTotals(model, new Set(["bat:0"]));
  expect(totals.eldritch).toBe(0);
});

test("completed Crossroads grants its affinity", () => {
  const totals = affinityTotals(model, new Set(["crossroads_eldritch:0"]));
  expect(totals.eldritch).toBe(1);
  expect(totals.chaos).toBe(0);
});

test("meetsRequirement compares per-affinity", () => {
  expect(meetsRequirement({ ascendant: 0, chaos: 0, eldritch: 1, order: 0, primordial: 0 }, { eldritch: 1 })).toBe(
    true,
  );
  expect(meetsRequirement({ ascendant: 0, chaos: 0, eldritch: 0, order: 0, primordial: 0 }, { eldritch: 1 })).toBe(
    false,
  );
});

test("matchedAffinities returns only the filter affinities the constellation provides, in canonical order", () => {
  // Synthetic constellation: grants eldritch + order, requires chaos.
  const con = { affinityBonus: { eldritch: 3, order: 2 }, affinityRequired: { chaos: 5 } } as any;
  expect(matchedAffinities(con, new Set(["eldritch"]), new Set())).toEqual(["eldritch"]);
  expect(matchedAffinities(con, new Set(["order", "eldritch"]), new Set())).toEqual(["eldritch", "order"]); // canonical order
  expect(matchedAffinities(con, new Set(["chaos"]), new Set())).toEqual([]); // chaos is required, not granted -> no grant match
  expect(matchedAffinities(con, new Set(), new Set(["chaos"]))).toEqual(["chaos"]);
  expect(matchedAffinities(con, new Set(), new Set(["order"]))).toEqual([]); // order is granted, not required
  expect(matchedAffinities(con, new Set(), new Set())).toEqual([]);
});
