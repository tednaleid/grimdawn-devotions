// ABOUTME: Tests for condensedRows - collapsing benefit dimensions onto one subject line per concept.
// ABOUTME: Verifies subject grouping, dimension order (flat before percent), and per-part ids for selection.
import { test, expect } from "bun:test";
import { condensedRows } from "../src/core/statFormat";

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
  groups.find((g) => g.group === group)?.subjects.find((s) => s.subject === subject);

test("groups are returned in GROUP_ORDER", () => {
  expect(groups.map((g) => g.group)).toEqual(["Attributes", "Offense", "Resistances"]);
});

test("a DoT damage type collapses to one subject with flat/pct/durFlat/durPct in order", () => {
  const s = subj("Offense", "Frostburn")!;
  expect(s.parts.map((p) => p.dim)).toEqual(["flat", "pct", "durFlat", "durPct"]);
  expect(s.parts.map((p) => p.value)).toEqual(["+10-15", "+18%", "+0.5", "+20%"]);
});

test("flat comes before percent for instant damage and attributes", () => {
  expect(subj("Offense", "Fire")!.parts.map((p) => p.value)).toEqual(["+5-8", "+13%"]);
  expect(subj("Attributes", "Physique")!.parts.map((p) => p.value)).toEqual(["+32", "+3%"]);
});

test("resistance collapses base + max onto one subject", () => {
  const s = subj("Resistances", "Fire Resistance")!;
  expect(s.parts.map((p) => p.dim)).toEqual(["pct", "max"]);
  expect(s.parts.map((p) => p.value)).toEqual(["+13%", "+3%"]);
});

test("each part carries its representative raw id (flat uses the Min id)", () => {
  const fire = subj("Offense", "Fire")!;
  expect(fire.parts.find((p) => p.dim === "flat")!.id).toBe("offensiveFireMin");
  expect(fire.parts.find((p) => p.dim === "pct")!.id).toBe("offensiveFireModifier");
});

test("a single-dimension stat is its own one-part subject", () => {
  const s = subj("Attributes", "Movement Speed")!;
  expect(s.parts.map((p) => p.dim)).toEqual(["pct"]);
  expect(s.parts[0]!.value).toBe("+5%");
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
  const subjects = ret!.subjects.map((s) => s.subject).sort();
  expect(subjects).toContain("Fire Retaliation");
  expect(subjects).toContain("% Retaliation added to Attack");
  expect(subjects).toContain("Fear");
  // Fire flat + Fire % collapse onto one subject; Fear min + chance onto one.
  const fire = ret!.subjects.find((s) => s.subject === "Fire Retaliation")!;
  expect(fire.parts.map((p) => p.dim).sort()).toEqual(["flat", "pct"]);
  const fear = ret!.subjects.find((s) => s.subject === "Fear")!;
  expect(fear.parts.length).toBe(2);
});
