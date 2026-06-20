// ABOUTME: Tests for the devotion stat formatter (label + percent/flat value rendering).
// ABOUTME: Anchored on grimtools-confirmed cases (Falcon, Shepherd's Crook) plus family rules.
import { expect, test, describe } from "bun:test";
import { statRow, formatBonusRows, groupedBonusRows } from "./statFormat";

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
  test("strips the redundant Character prefix in the humanize fallback", () => {
    expect(statRow("characterFooBar", 5)).toEqual({ label: "Foo Bar", value: "+5" });
  });
});

describe("statRow grimtools-verified corrections", () => {
  test("status effects are reduced-duration / protection, not resistances", () => {
    expect(statRow("defensiveStun", 25)).toEqual({ label: "Reduced Stun Duration", value: "+25%" });
    expect(statRow("defensiveTrap", 30)).toEqual({ label: "Reduced Entrapment Duration", value: "+30%" });
    expect(statRow("defensiveDisruption", 30)).toEqual({ label: "Skill Disruption Protection", value: "+30%" });
  });
  test("defensive DoT duration uses DoT names and a positive percent", () => {
    expect(statRow("defensiveFireDuration", 25)).toEqual({ label: "Reduced Burn Duration", value: "+25%" });
    expect(statRow("defensivePhysicalDuration", 25)).toEqual({ label: "Reduced Internal Trauma Duration", value: "+25%" });
    expect(statRow("defensiveColdDuration", 20)).toEqual({ label: "Reduced Frostburn Duration", value: "+20%" });
  });
  test("poison resistance is Poison & Acid", () => {
    expect(statRow("defensivePoison", 15)).toEqual({ label: "Poison & Acid Resistance", value: "+15%" });
    expect(statRow("defensivePoisonMaxResist", 3)).toEqual({ label: "Maximum Poison & Acid Resistance", value: "+3%" });
  });
  test("requirement reductions use official labels and a negative percent", () => {
    expect(statRow("characterMeleeStrengthReqReduction", 10)).toEqual({
      label: "Physique Requirement for Melee Weapons",
      value: "-10%",
    });
  });
  test("reduced-target resistance debuff is shown positive", () => {
    expect(statRow("offensiveElementalResistanceReductionPercentMin", 20)).toEqual({
      label: "Reduced target's Elemental Resistances",
      value: "+20%",
    });
  });
});

describe("statRow racial damage/defense names the concrete race", () => {
  test("single race is pluralized", () => {
    expect(statRow("racialBonusPercentDamage", 8, ["Human"])).toEqual({ label: "Damage to Humans", value: "+8%" });
    expect(statRow("racialBonusPercentDefense", 10, ["Beast"])).toEqual({ label: "Less Damage from Beasts", value: "+10%" });
  });
  test("Undead stays Undead; multiple races join with &", () => {
    expect(statRow("racialBonusPercentDamage", 6, ["Undead", "Human"])).toEqual({
      label: "Damage to Undead & Humans",
      value: "+6%",
    });
  });
  test("falls back to the generic label when no target is given", () => {
    expect(statRow("racialBonusPercentDamage", 8)).toEqual({ label: "Damage to specific enemy types", value: "+8%" });
  });
  test("formatBonusRows threads the racial target through", () => {
    expect(formatBonusRows({ racialBonusPercentDamage: 8 }, { racialTarget: ["Chthonic"] })).toEqual([
      { label: "Damage to Chthonics", value: "+8%" },
    ]);
  });
});

describe("groupedBonusRows groups by category in render order", () => {
  test("splits attributes / offense / defense / other", () => {
    const groups = groupedBonusRows({
      characterStrength: 10,
      offensivePhysicalModifier: 15,
      defensivePhysical: 12,
      skillManaCostReduction: 5,
    });
    expect(groups.map((g) => g.group)).toEqual(["Attributes", "Offense", "Defense", "Other"]);
    expect(groups[0]!.rows).toEqual([{ label: "Physique", value: "+10" }]);
    expect(groups[1]!.rows).toEqual([{ label: "Physical Damage", value: "+15%" }]);
  });
  test("omits groups with no rows", () => {
    const groups = groupedBonusRows({ characterDexterity: 5 });
    expect(groups.map((g) => g.group)).toEqual(["Attributes"]);
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
