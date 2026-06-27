// ABOUTME: Tests for affinity computation - completion detection, totals, and requirement checks.
// ABOUTME: Uses real devotions.json data (crossroads_eldritch, bat) to verify correct affinity values.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import {
  completedConstellations,
  affinityTotals,
  meetsRequirement,
  constellationsMatchingAffinity,
} from "../src/core/affinity";

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

test("constellationsMatchingAffinity matches granted and required affinities", () => {
  const granters = constellationsMatchingAffinity(model, new Set(["eldritch"]), new Set());
  expect(granters.size).toBeGreaterThan(0);
  for (const id of granters) expect((model.constellations.get(id)!.affinityBonus.eldritch ?? 0) > 0).toBe(true);

  const requirers = constellationsMatchingAffinity(model, new Set(), new Set(["eldritch"]));
  expect(requirers.size).toBeGreaterThan(0);
  for (const id of requirers) expect((model.constellations.get(id)!.affinityRequired.eldritch ?? 0) > 0).toBe(true);

  expect(constellationsMatchingAffinity(model, new Set(), new Set()).size).toBe(0);
});
