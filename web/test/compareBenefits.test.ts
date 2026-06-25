// ABOUTME: Tests the baseline-vs-current comparison view-model: per-part base/now/delta and verdicts.
// ABOUTME: Uses the real devotions.json model; picks stars by scanning bonuses so it is data-robust.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { compareBenefits } from "../src/core/compareBenefits";

const model = buildModel(doc as any);

// Find one star id that grants a given stat key (for building deterministic selections).
function starGranting(stat: string): string {
  for (const s of model.stars.values()) if (s.bonuses[stat] !== undefined) return s.id;
  throw new Error(`no star grants ${stat}`);
}

test("a stat present in current but not baseline is an up-delta row", () => {
  const star = starGranting("offensiveTotalDamageModifier");
  const now = new Set<string>([star]);
  const base = new Set<string>();
  const { player } = compareBenefits(model, base, now);
  const parts = player.flatMap((g) => g.subjects).flatMap((s) => s.parts);
  const td = parts.find((p) => p.id === "offensiveTotalDamageModifier")!;
  expect(td.verdict).toBe("up");
  expect(td.base).toBe("—"); // em dash for absent
  expect(td.now).not.toBe("—");
});

test("an identical baseline and current yields all 'same' verdicts and a zero/dash delta", () => {
  const star = starGranting("offensiveTotalDamageModifier");
  const sel = new Set<string>([star]);
  const { player } = compareBenefits(model, sel, sel);
  const parts = player.flatMap((g) => g.subjects).flatMap((s) => s.parts);
  expect(parts.length).toBeGreaterThan(0);
  expect(parts.every((p) => p.verdict === "same")).toBe(true);
});

test("union includes a stat present only in the baseline as a down-delta row", () => {
  const star = starGranting("offensiveTotalDamageModifier");
  const base = new Set<string>([star]);
  const now = new Set<string>();
  const { player } = compareBenefits(model, base, now);
  const parts = player.flatMap((g) => g.subjects).flatMap((s) => s.parts);
  const td = parts.find((p) => p.id === "offensiveTotalDamageModifier")!;
  expect(td.verdict).toBe("down");
  expect(td.now).toBe("—");
});
