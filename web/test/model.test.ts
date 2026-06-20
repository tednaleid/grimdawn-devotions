// ABOUTME: Tests for buildModel - verifies constellation/star indexing and data shape.
// ABOUTME: Uses the real devotions.json data to confirm counts and specific node values.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";

const model = buildModel(doc as any);

test("indexes every constellation and star", () => {
  expect(model.constellations.size).toBe(86);
  expect(model.stars.size).toBe(438);
});

test("star global ids and predecessor links resolve to ids", () => {
  const bat0 = model.stars.get("bat:0")!;
  const bat1 = model.stars.get("bat:1")!;
  expect(bat0.predecessors).toEqual([]);
  expect(bat1.predecessors).toEqual(["bat:0"]);
  expect(bat0.position).toEqual({ x: -968, y: 80 });
  expect(bat0.bonuses.offensiveLifeModifier).toBe(15);
});

test("celestial power carries proc, granted level and level-selected stats", () => {
  const scorpion = [...model.stars.values()].find((s) => s.celestialPower?.name === "Scorpion Sting");
  const power = scorpion!.celestialPower!;
  expect(power.proc).toEqual({ chance: 25, trigger: "Attack" });
  expect(power.level).toBe(25);
  expect(power.stats.weaponDamagePct).toBe(40);
  expect(power.stats.offensiveSlowPoisonMin).toBe(225);
  expect(power.stats.offensiveSlowDefensiveAbilityMin).toBe(150);
});

test("constellation carries affinity req/bonus and member ids", () => {
  const bat = model.constellations.get("bat")!;
  expect(bat.affinityRequired).toEqual({ eldritch: 1 });
  expect(bat.affinityBonus).toEqual({ chaos: 2, eldritch: 3 });
  expect(bat.starIds).toEqual(["bat:0", "bat:1", "bat:2", "bat:3", "bat:4"]);
});
