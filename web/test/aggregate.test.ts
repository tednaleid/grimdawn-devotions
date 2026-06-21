// ABOUTME: Tests for aggregate.ts -- sumBonuses, powersGained, weaponRequirements.
// ABOUTME: Uses real devotions.json data via buildModel to verify additive stat summation.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { sumBonuses, powersGained, starsGranting } from "../src/core/aggregate";

const model = buildModel(doc as any);

function manualCount(pred: (b: Record<string, number>) => boolean): number {
  let n = 0;
  for (const s of model.stars.values()) if (pred(s.bonuses)) n++;
  return n;
}

test("starsGranting returns exactly the stars whose bonuses include a selected id", () => {
  const got = starsGranting(model, new Set(["characterStrength"]));
  expect(got.size).toBe(manualCount((b) => "characterStrength" in b));
  for (const id of got) expect("characterStrength" in model.stars.get(id)!.bonuses).toBe(true);
});

test("starsGranting unions multiple ids and is empty for an empty set", () => {
  const got = starsGranting(model, new Set(["characterStrength", "characterIntelligence"]));
  expect(got.size).toBe(manualCount((b) => "characterStrength" in b || "characterIntelligence" in b));
  expect(starsGranting(model, new Set()).size).toBe(0);
});

test("sums like stat ids additively across stars", () => {
  // bat:0 offensiveLifeModifier=15, bat:2 offensiveLifeModifier=24 -> 39
  const totals = sumBonuses(model, new Set(["bat:0", "bat:2"]));
  expect(totals.offensiveLifeModifier).toBe(39);
  expect(totals.offensiveSlowBleedingModifier).toBe(65); // 15 + 50
});

test("collects celestial powers with their star ids", () => {
  const powers = powersGained(model, new Set(["bat:4"]));
  expect(powers.map((p) => p.power.name)).toContain("Twin Fangs");
  expect(powers[0]!.power.description).toBeTruthy();
  expect(powers[0]!.starId).toBe("bat:4");
});
