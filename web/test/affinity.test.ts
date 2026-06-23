// ABOUTME: Tests for affinity computation - completion detection, totals, and requirement checks.
// ABOUTME: Uses real devotions.json data (crossroads_eldritch, bat) to verify correct affinity values.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { completedConstellations, affinityTotals, meetsRequirement } from "../src/core/affinity";

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
