// ABOUTME: Tests for the devotion stat formatter (label + percent/flat value rendering).
// ABOUTME: Anchored on grimtools-confirmed cases (Falcon, Shepherd's Crook) plus family rules.
import { expect, test, describe } from "bun:test";
import { statRow, formatBonusRows } from "./statFormat";

describe("statRow attributes (GD internal -> display names)", () => {
  test("dexterity is Cunning, flat", () => {
    expect(statRow("characterDexterity", 20)).toEqual({ label: "Cunning", value: "+20" });
  });
  test("strength is Physique, flat", () => {
    expect(statRow("characterStrength", 10)).toEqual({ label: "Physique", value: "+10" });
  });
  test("intelligence is Spirit, flat", () => {
    expect(statRow("characterIntelligence", 8)).toEqual({ label: "Spirit", value: "+8" });
  });
  test("life is Health, flat", () => {
    expect(statRow("characterLife", 40)).toEqual({ label: "Health", value: "+40" });
  });
  test("life modifier is Health, percent", () => {
    expect(statRow("characterLifeModifier", 3)).toEqual({ label: "Health", value: "+3%" });
  });
  test("offensive ability is flat, no Character prefix", () => {
    expect(statRow("characterOffensiveAbility", 15)).toEqual({ label: "Offensive Ability", value: "+15" });
  });
});

describe("statRow offensive damage (percent vs flat)", () => {
  test("physical modifier is percent damage", () => {
    expect(statRow("offensivePhysicalModifier", 15)).toEqual({ label: "Physical Damage", value: "+15%" });
  });
  test("bleeding (Slow) modifier is percent Bleeding damage", () => {
    expect(statRow("offensiveSlowBleedingModifier", 15)).toEqual({ label: "Bleeding Damage", value: "+15%" });
  });
  test("Slow physical is Internal Trauma", () => {
    expect(statRow("offensiveSlowPhysicalModifier", 10)).toEqual({ label: "Internal Trauma Damage", value: "+10%" });
  });
  test("offensive Life is Vitality (GD quirk)", () => {
    expect(statRow("offensiveLifeModifier", 11)).toEqual({ label: "Vitality Damage", value: "+11%" });
  });
});

describe("statRow defensive (resistances are percent; armor is flat)", () => {
  test("physical resistance is percent", () => {
    expect(statRow("defensivePhysical", 12)).toEqual({ label: "Physical Resistance", value: "+12%" });
  });
  test("protection is Armor, flat", () => {
    expect(statRow("defensiveProtection", 24)).toEqual({ label: "Armor", value: "+24" });
  });
});

describe("statRow speeds and weapon tokens", () => {
  test("run speed is Movement Speed, percent", () => {
    expect(statRow("characterRunSpeedModifier", 5)).toEqual({ label: "Movement Speed", value: "+5%" });
  });
  test("weapon-class tokens (capitalized) are skipped", () => {
    expect(statRow("Spear2h", 1)).toBeNull();
    expect(statRow("Dagger", 1)).toBeNull();
  });
  test("strips the redundant Character prefix from fallback keys (and renames attrs)", () => {
    expect(statRow("characterArmorStrengthReqReduction", 10)).toEqual({
      label: "Armor Physique Req Reduction",
      value: "-10%",
    });
  });
});

describe("formatBonusRows merges Min/Max damage into a range and skips weapon tokens", () => {
  test("merges a flat damage Min/Max pair", () => {
    expect(formatBonusRows({ offensiveFireMin: 3, offensiveFireMax: 5 })).toEqual([
      { label: "Fire Damage", value: "+3-5" },
    ]);
  });
  test("drops capitalized weapon tokens from rows", () => {
    const rows = formatBonusRows({ Spear2h: 1, characterLife: 60, characterOffensiveAbility: 15 });
    expect(rows).toEqual([
      { label: "Health", value: "+60" },
      { label: "Offensive Ability", value: "+15" },
    ]);
  });
});
