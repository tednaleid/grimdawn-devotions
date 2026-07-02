// ABOUTME: Tests for condensedRows - collapsing benefit dimensions onto one subject line per concept.
// ABOUTME: Verifies subject grouping, dimension order (flat before percent), and per-part ids for selection.
import { test, expect } from "bun:test";
import { condensedRows } from "../src/core/statFormat";
import { enLoc } from "./helpers/localizeEn";
import { resolveText, type Text } from "../src/core/localization";

const res = (t: Text) => resolveText(enLoc, t);

const bonuses = {
  // Frostburn (Cold DoT): flat dmg, % dmg, flat duration, % duration.
  offensiveSlowColdMin: 10,
  offensiveSlowColdMax: 15,
  offensiveSlowColdModifier: 18,
  offensiveSlowColdDurationMin: 0.5,
  offensiveSlowColdDurationModifier: 20,
  // Fire (instant): flat + %.
  offensiveFireMin: 5,
  offensiveFireMax: 8,
  offensiveFireModifier: 13,
  // Fire resistance: base + max.
  defensiveFire: 13,
  defensiveFireMaxResist: 3,
  // Physique: flat + %.
  characterStrength: 32,
  characterStrengthModifier: 3,
  // Standalone single-dimension.
  characterRunSpeedModifier: 5,
};

const groups = condensedRows(bonuses);
const subj = (group: string, subject: string) =>
  groups.find((g) => g.group === group)?.subjects.find((s) => res(s.subject) === subject);

test("groups are returned in GROUP_ORDER", () => {
  expect(groups.map((g) => g.group)).toEqual(["Attributes", "Offense", "Resistances"]);
});

test("a DoT damage type collapses to one subject with flat/pct/durFlat/durPct in order", () => {
  const s = subj("Offense", "Frostburn")!;
  expect(s.parts.map((p) => p.dim)).toEqual(["flat", "pct", "durFlat", "durPct"]);
  expect(s.parts.map((p) => res(p.value))).toEqual(["+10-15", "+18%", "+0.5", "+20%"]);
});

test("flat comes before percent for instant damage and attributes", () => {
  expect(subj("Offense", "Fire")!.parts.map((p) => res(p.value))).toEqual(["+5-8", "+13%"]);
  expect(subj("Attributes", "Physique")!.parts.map((p) => res(p.value))).toEqual(["+32", "+3%"]);
});

test("resistance collapses base + max onto one subject", () => {
  const s = subj("Resistances", "Fire Resistance")!;
  expect(s.parts.map((p) => p.dim)).toEqual(["pct", "max"]);
  expect(s.parts.map((p) => res(p.value))).toEqual(["+13%", "+3%"]);
});

test("each part carries its representative raw id (flat uses the Min id)", () => {
  const fire = subj("Offense", "Fire")!;
  expect(fire.parts.find((p) => p.dim === "flat")!.id).toBe("offensiveFireMin");
  expect(fire.parts.find((p) => p.dim === "pct")!.id).toBe("offensiveFireModifier");
});

test("a single-dimension stat is its own one-part subject", () => {
  const s = subj("Attributes", "Movement Speed")!;
  expect(s.parts.map((p) => p.dim)).toEqual(["pct"]);
  expect(res(s.parts[0]!.value)).toBe("+5%");
});

test("resistance reduction stats group under Resistance Reduction with distinct flat/percent subjects", () => {
  const g = condensedRows({
    offensiveTotalResistanceReductionAbsoluteMin: 24,
    offensiveTotalResistanceReductionAbsoluteDurationMin: 1,
    offensiveElementalResistanceReductionAbsoluteMin: 32,
    offensiveElementalResistanceReductionPercentMin: 20,
    offensivePhysicalReductionPercentMin: 18,
  });
  const rr = g.find((x) => x.group === "Resistance Reduction");
  expect(rr).toBeTruthy();
  const subjects = rr!.subjects.map((s) => res(s.subject)).sort();
  expect(subjects).toEqual([
    "Reduced target's Elemental Resistances",
    "Reduced target's Elemental Resistances (flat)",
    "Reduced target's Physical Resistance",
    "Reduced target's Resistances",
  ]);
  // The flat all-res subject carries its magnitude (flat) and a duration facet.
  const all = rr!.subjects.find((s) => res(s.subject) === "Reduced target's Resistances")!;
  expect(all.parts.map((p) => p.dim).sort()).toEqual(["durFlat", "flat"]);
});

test("retaliation stats group under Retaliation and collapse by concept", () => {
  const g = condensedRows({
    retaliationFireMin: 100,
    retaliationFireModifier: 20,
    retaliationDamagePct: 17,
    retaliationFearMin: 3,
    retaliationFearChance: 70,
  });
  const ret = g.find((x) => x.group === "Retaliation");
  expect(ret).toBeTruthy();
  const subjects = ret!.subjects.map((s) => res(s.subject)).sort();
  expect(subjects).toContain("Fire Retaliation");
  expect(subjects).toContain("% Retaliation added to Attack");
  expect(subjects).toContain("Fear");
  // Fire flat + Fire % collapse onto one subject; Fear min + chance onto one.
  const fire = ret!.subjects.find((s) => res(s.subject) === "Fire Retaliation")!;
  expect(fire.parts.map((p) => p.dim).sort()).toEqual(["flat", "pct"]);
  const fear = ret!.subjects.find((s) => res(s.subject) === "Fear")!;
  expect(fear.parts.length).toBe(2);
});

test("crowd-control stats group under Crowd Control with one subject per effect", () => {
  const g = condensedRows({
    offensiveStunMin: 1,
    offensiveStunChance: 50,
    offensiveFreezeMin: 1,
    offensiveFreezeChance: 50,
    offensiveSlowDefensiveAbilityMin: 150,
    offensiveSlowDefensiveAbilityDurationMin: 5,
    offensiveSlowRunSpeedMin: 45,
    offensiveSlowRunSpeedDurationMin: 3,
    offensiveTotalDamageReductionPercentMin: 15,
    offensiveProjectileFumbleMin: 30,
  });
  const cc = g.find((x) => x.group === "Crowd Control");
  expect(cc).toBeTruthy();
  const subjects = cc!.subjects.map((s) => res(s.subject)).sort();
  expect(subjects).toEqual(
    [
      "Impaired Aim",
      "Reduced target's Damage",
      "Reduced target's Defensive Ability",
      "Slow target's Movement",
      "Stun",
      "Freeze",
    ].sort(),
  );
  // Stun's magnitude (flat) and chance (pct) collapse onto one subject.
  const stun = cc!.subjects.find((s) => res(s.subject) === "Stun")!;
  expect(stun.parts.map((p) => p.dim).sort()).toEqual(["flat", "pct"]);
});

test("DoT damage stays in Offense, not Crowd Control (offensiveSlowFire is Burn)", () => {
  const g = condensedRows({ offensiveSlowFireMin: 100, offensiveSlowFireDurationMin: 3 });
  expect(g.find((x) => x.group === "Offense")?.subjects.map((s) => res(s.subject))).toContain("Burn");
  expect(g.find((x) => x.group === "Crowd Control")).toBeUndefined();
});

test("subject keys are structural, not display text", () => {
  const groups = condensedRows({ offensiveFireMin: 10, defensiveFire: 8, defensiveFireMaxResist: 3 });
  const keys = groups.flatMap((g) => g.subjects.map((s) => s.key));
  expect(keys).toContain("Offense:damage:Fire");
  expect(keys).toContain("Resistances:resist:Fire");
  // base resist and max resist merge into ONE subject (max is a dim of the resistance subject)
  expect(keys.filter((k) => k === "Resistances:resist:Fire")).toHaveLength(1);
});
test("intentional merges hold under structural keys", () => {
  const armor = condensedRows({ defensiveProtection: 100, defensiveProtectionModifier: 8 });
  expect(armor.flatMap((g) => g.subjects).map((s) => s.key)).toEqual(["Armor & Mitigation:armor"]);
  const fear = condensedRows({ retaliationFearMin: 1, retaliationFearChance: 20 });
  expect(fear.flatMap((g) => g.subjects).map((s) => s.key)).toEqual(["Retaliation:retaliation-fear"]);
});
