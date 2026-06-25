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

// Find a star granting a merged flat damage range (a *Min key with a paired *Max), plus that part id.
function starGrantingRange(): { star: string; partId: string } {
  for (const s of model.stars.values()) {
    for (const k of Object.keys(s.bonuses)) {
      if (k.endsWith("Min") && s.bonuses[`${k.slice(0, -3)}Max`] !== undefined) return { star: s.id, partId: k };
    }
  }
  throw new Error("no star grants a flat damage range");
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

test("a flat damage range part shows a colored value with no numeric delta when it changes", () => {
  const { star, partId } = starGrantingRange();
  // added vs an empty baseline: the range gained a value, so it reads "up" with an empty delta (no number).
  const added = compareBenefits(model, new Set(), new Set<string>([star]));
  const addedPart = added.player
    .flatMap((g) => g.subjects)
    .flatMap((s) => s.parts)
    .find((p) => p.id === partId)!;
  expect(addedPart.verdict).toBe("up");
  expect(addedPart.base).toBe("—");
  expect(addedPart.delta).toBe(""); // colored, but no scalar delta for a range
  // identical baseline and current: unchanged range is "same" with a neutral dash delta.
  const sel = new Set<string>([star]);
  const unchanged = compareBenefits(model, sel, sel);
  const samePart = unchanged.player
    .flatMap((g) => g.subjects)
    .flatMap((s) => s.parts)
    .find((p) => p.id === partId)!;
  expect(samePart.verdict).toBe("same");
  expect(samePart.delta).toBe("—");
});

test("a subject with one part up and another down rolls up to a 'mixed' verdict", () => {
  // Offensive Ability carries both a flat and a percent part; swapping a flat-source star for a
  // percent-source star moves one part up and the other down.
  const { player } = compareBenefits(model, new Set<string>(["akeron_s_scorpion:0"]), new Set<string>(["hawk:2"]));
  const subj = player.flatMap((g) => g.subjects).find((s) => s.key === "Attributes:Offensive Ability")!;
  expect(subj.parts.some((p) => p.verdict === "up")).toBe(true);
  expect(subj.parts.some((p) => p.verdict === "down")).toBe(true);
  expect(subj.verdict).toBe("mixed");
});
