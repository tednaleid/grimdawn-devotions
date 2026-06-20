// ABOUTME: Tests for aggregate.ts -- sumBonuses, powersGained, weaponRequirements.
// ABOUTME: Uses real devotions.json data via buildModel to verify additive stat summation.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { sumBonuses, powersGained } from "../src/core/aggregate";

const model = buildModel(doc as any);

test("sums like stat ids additively across stars", () => {
  // bat:0 offensiveLifeModifier=15, bat:2 offensiveLifeModifier=24 -> 39
  const totals = sumBonuses(model, new Set(["bat:0", "bat:2"]));
  expect(totals.offensiveLifeModifier).toBe(39);
  expect(totals.offensiveSlowBleedingModifier).toBe(65); // 15 + 50
});

test("collects celestial power names", () => {
  const powers = powersGained(model, new Set(["bat:4"]));
  expect(powers).toContain("Twin Fangs");
});
