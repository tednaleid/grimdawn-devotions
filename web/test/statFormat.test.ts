// ABOUTME: Tests for the devotion stat formatter (label + percent/flat value rendering).
// ABOUTME: Anchored on grimtools-confirmed cases (Falcon, Shepherd's Crook) plus family rules.
import { expect, test, describe } from "bun:test";
import {
  statRow,
  formatBonusRows,
  formatBonusRowsWithIds,
  groupedBonusRows,
  formatPowerStats,
  formatPet,
  isFilterableStat,
} from "../src/core/statFormat";
import { installEnglish, enLoc } from "./helpers/localizeEn";
import { makeLocalization, setLocalization, resolveText, type Text } from "../src/core/localization";
import { STAT_TAGS } from "../src/core/statTags";

installEnglish();

const res = (t: Text) => resolveText(enLoc, t);
const resRow = (r: { label: Text; value: Text } | null) => (r ? { label: res(r.label), value: res(r.value) } : null);
const resRows = (rows: { label: Text; value: Text }[]) =>
  rows.map((r) => ({ value: res(r.value), label: res(r.label) }));
// Mirrors the adapter render for the fallthrough segment: resolve, then sort by resolved label.
const resSorted = (rows: { label: Text; value: Text }[]) =>
  resRows(rows).sort((a, b) => a.label.localeCompare(b.label));

describe("statRow attributes (GD internal -> display names)", () => {
  test("dexterity is Cunning, flat", () => {
    expect(resRow(statRow("characterDexterity", 20))).toEqual({ label: "Cunning", value: "+20" });
  });
  test("strength is Physique, flat", () => {
    expect(resRow(statRow("characterStrength", 10))).toEqual({ label: "Physique", value: "+10" });
  });
  test("intelligence is Spirit, flat", () => {
    expect(resRow(statRow("characterIntelligence", 8))).toEqual({ label: "Spirit", value: "+8" });
  });
  test("life is Health, flat", () => {
    expect(resRow(statRow("characterLife", 40))).toEqual({ label: "Health", value: "+40" });
  });
  test("life modifier is Health, percent", () => {
    expect(resRow(statRow("characterLifeModifier", 3))).toEqual({ label: "Health", value: "+3%" });
  });
  test("offensive ability is flat, no Character prefix", () => {
    expect(resRow(statRow("characterOffensiveAbility", 15))).toEqual({ label: "Offensive Ability", value: "+15" });
  });
});

describe("statRow format-string stats (game-sourced term, value stripped)", () => {
  // These GD stats store their display as a value-embedded format string ("{v}% <noun>").
  // We source the noun from the game tag and strip the value token; the value renders separately.
  test("defensivePercentCurrentLife is Resistance to Life Reduction, percent", () => {
    expect(resRow(statRow("defensivePercentCurrentLife", 20))).toEqual({
      label: "Resistance to Life Reduction",
      value: "+20%",
    });
  });
  test("defensiveConvert is Reduced Mind Control Duration, percent (not stun, not flat +50)", () => {
    expect(resRow(statRow("defensiveConvert", 50))).toEqual({
      label: "Reduced Mind Control Duration",
      value: "+50%",
    });
  });
  test("characterHealIncreasePercent is an authored percent label (value-suffix game format)", () => {
    expect(resRow(statRow("characterHealIncreasePercent", 20))).toEqual({
      label: "Increased Healing",
      value: "+20%",
    });
  });
});

describe("statRow offensive damage (percent vs flat)", () => {
  test("physical modifier is percent damage", () => {
    expect(resRow(statRow("offensivePhysicalModifier", 15))).toEqual({ label: "Physical Damage", value: "+15%" });
  });
  test("bleeding (Slow) modifier is percent Bleeding damage", () => {
    expect(resRow(statRow("offensiveSlowBleedingModifier", 15))).toEqual({
      label: "Bleeding Damage",
      value: "+15%",
    });
  });
  test("Slow physical is Internal Trauma", () => {
    expect(resRow(statRow("offensiveSlowPhysicalModifier", 10))).toEqual({
      label: "Internal Trauma Damage",
      value: "+10%",
    });
  });
  test("offensive Life is Vitality (GD quirk)", () => {
    expect(resRow(statRow("offensiveLifeModifier", 11))).toEqual({ label: "Vitality Damage", value: "+11%" });
  });
});

describe("statRow defensive (resistances are percent; armor is flat)", () => {
  test("physical resistance is percent", () => {
    expect(resRow(statRow("defensivePhysical", 12))).toEqual({ label: "Physical Resistance", value: "+12%" });
  });
  test("protection is Armor, flat", () => {
    expect(resRow(statRow("defensiveProtection", 24))).toEqual({ label: "Armor", value: "+24" });
  });
});

describe("statRow speeds and weapon tokens", () => {
  test("run speed is Movement Speed, percent", () => {
    expect(resRow(statRow("characterRunSpeedModifier", 5))).toEqual({ label: "Movement Speed", value: "+5%" });
  });
  test("weapon-class tokens (capitalized) are skipped", () => {
    expect(statRow("Spear2h", 1)).toBeNull();
    expect(statRow("Dagger", 1)).toBeNull();
  });
  test("strips the redundant Character prefix in the humanize fallback", () => {
    expect(resRow(statRow("characterFooBar", 5))).toEqual({ label: "Foo Bar", value: "+5" });
  });
});

describe("statRow grimtools-verified corrections", () => {
  test("status effects are reduced-duration / protection, not resistances", () => {
    expect(resRow(statRow("defensiveStun", 25))).toEqual({ label: "Reduced Stun Duration", value: "+25%" });
    expect(resRow(statRow("defensiveTrap", 30))).toEqual({ label: "Reduced Entrapment Duration", value: "+30%" });
    expect(resRow(statRow("defensiveDisruption", 30))).toEqual({
      label: "Skill Disruption Protection",
      value: "+30%",
    });
  });
  test("defensive DoT duration uses DoT names and a positive percent", () => {
    expect(resRow(statRow("defensiveFireDuration", 25))).toEqual({ label: "Reduced Burn Duration", value: "+25%" });
    expect(resRow(statRow("defensivePhysicalDuration", 25))).toEqual({
      label: "Reduced Internal Trauma Duration",
      value: "+25%",
    });
    expect(resRow(statRow("defensiveColdDuration", 20))).toEqual({
      label: "Reduced Frostburn Duration",
      value: "+20%",
    });
  });
  test("poison resistance is Poison & Acid", () => {
    expect(resRow(statRow("defensivePoison", 15))).toEqual({ label: "Poison & Acid Resistance", value: "+15%" });
    expect(resRow(statRow("defensivePoisonMaxResist", 3))).toEqual({
      label: "Maximum Poison & Acid Resistance",
      value: "+3%",
    });
  });
  test("requirement reductions use official labels and a negative percent", () => {
    expect(resRow(statRow("characterMeleeStrengthReqReduction", 10))).toEqual({
      label: "Physique Requirement for Melee Weapons",
      value: "-10%",
    });
  });
  test("reduced-target resistance debuff is shown positive", () => {
    expect(resRow(statRow("offensiveElementalResistanceReductionPercentMin", 20))).toEqual({
      label: "Reduced target's Elemental Resistances",
      value: "+20%",
    });
  });
});

describe("statRow racial damage/defense names the concrete race", () => {
  test("single race is pluralized", () => {
    expect(resRow(statRow("racialBonusPercentDamage", 8, ["Human"]))).toEqual({
      label: "Damage to Humans",
      value: "+8%",
    });
    expect(resRow(statRow("racialBonusPercentDefense", 10, ["Beast"]))).toEqual({
      label: "Less Damage from Beasts",
      value: "+10%",
    });
  });
  test("Undead stays Undead; multiple races join with &", () => {
    expect(resRow(statRow("racialBonusPercentDamage", 6, ["Undead", "Human"]))).toEqual({
      label: "Damage to Undead & Humans",
      value: "+6%",
    });
  });
  test("falls back to the generic label when no target is given", () => {
    expect(resRow(statRow("racialBonusPercentDamage", 8))).toEqual({
      label: "Damage to specific enemy types",
      value: "+8%",
    });
  });
  test("formatBonusRows threads the racial target through", () => {
    expect(formatBonusRows({ racialBonusPercentDamage: 8 }, { racialTarget: ["Chthonic"] }).map(resRow)).toEqual([
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
    expect(groups.map((g) => g.group)).toEqual(["Attributes", "Offense", "Resistances", "Other"]);
    expect(groups[0]!.rows).toEqual([{ id: "characterStrength", label: "Physique", value: "+10" }]);
    expect(groups[1]!.rows).toEqual([{ id: "offensivePhysicalModifier", label: "Physical Damage", value: "+15%" }]);
  });
  test("omits groups with no rows", () => {
    const groups = groupedBonusRows({ characterDexterity: 5 });
    expect(groups.map((g) => g.group)).toEqual(["Attributes"]);
  });
});

describe("formatBonusRows merges Min/Max damage into a range and skips weapon tokens", () => {
  test("merges a flat damage Min/Max pair", () => {
    expect(formatBonusRows({ offensiveFireMin: 3, offensiveFireMax: 5 }).map(resRow)).toEqual([
      { label: "Fire Damage", value: "+3-5" },
    ]);
  });
  test("drops capitalized weapon tokens from rows", () => {
    const rows = formatBonusRows({ Spear2h: 1, characterLife: 60, characterOffensiveAbility: 15 })
      .map(resRow)
      .sort((a, b) => a!.label.localeCompare(b!.label));
    expect(rows).toEqual([
      { label: "Health", value: "+60" },
      { label: "Offensive Ability", value: "+15" },
    ]);
  });
});

describe("formatPowerStats renders celestial-power ability lines GD-style", () => {
  // The Scorpion Sting acceptance example: every line must reproduce exactly.
  test("Scorpion Sting reproduces the grimtools tooltip stat lines in order", () => {
    const r = formatPowerStats({
      skillCooldownTime: 1.5,
      projectileLaunchNumber: 6,
      projectilePiercingChance: 100,
      projectileExplosionRadius: 0.1,
      weaponDamagePct: 40,
      offensiveSlowPoisonMin: 225,
      offensiveSlowPoisonDurationMin: 5,
      offensiveSlowDefensiveAbilityMin: 150,
      offensiveSlowDefensiveAbilityDurationMin: 5,
    });
    expect(r.fallthrough).toEqual([]);
    expect(resRows(r.rows)).toEqual([
      { value: "1.5", label: "Second Skill Recharge" },
      { value: "6", label: "Projectile(s)" },
      { value: "100%", label: "Chance to pass through Enemies" },
      { value: "0.1", label: "Meter Radius" },
      { value: "40%", label: "Weapon Damage" },
      { value: "1125", label: "Poison Damage over 5 Seconds" },
      { value: "150", label: "Reduced target's Defensive Ability for 5 Seconds" },
    ]);
  });

  test("Stone Form: active duration and damage absorption render as ability lines (grimtools)", () => {
    const rows = formatPowerStats({
      skillCooldownTime: 12,
      skillActiveDuration: 8,
      skillTargetRadius: 15,
      damageAbsorption: 400,
    }).rows;
    expect(resRows(rows)).toEqual([
      { value: "12", label: "Second Skill Recharge" },
      { value: "8", label: "Second Duration" },
      { value: "15", label: "Meter Radius" },
      { value: "400", label: "Damage Absorption" },
    ]);
  });

  test("heal/restore powers render flat + percent health and percent energy (Dryad's Blessing, Inspiration)", () => {
    expect(
      resRows(formatPowerStats({ skillCooldownTime: 2.7, skillLifeBonus: 848, skillLifePercent: 10 }).rows),
    ).toEqual([
      { value: "2.7", label: "Second Skill Recharge" },
      { value: "848", label: "Health Restored" },
      { value: "10%", label: "Health Restored" },
    ]);
    expect(resRows(formatPowerStats({ skillManaPercent: 25 }).rows)).toEqual([
      { value: "25%", label: "Energy Restored" },
    ]);
  });

  test("DoT pairs multiply per-second by duration and use the DoT display name", () => {
    expect(resRows(formatPowerStats({ offensiveSlowFireMin: 100, offensiveSlowFireDurationMin: 3 }).rows)).toEqual([
      { value: "300", label: "Burn Damage over 3 Seconds" },
    ]);
    expect(
      resRows(formatPowerStats({ offensiveSlowPhysicalMin: 50, offensiveSlowPhysicalDurationMin: 4 }).rows),
    ).toEqual([{ value: "200", label: "Internal Trauma Damage over 4 Seconds" }]);
  });

  test("target debuffs (movement slow, resistance/damage reduction) render as timed reductions", () => {
    expect(
      resRows(
        formatPowerStats({
          offensiveSlowRunSpeedMin: 45,
          offensiveSlowRunSpeedDurationMin: 3,
          offensiveTotalResistanceReductionAbsoluteMin: 24,
          offensiveTotalResistanceReductionAbsoluteDurationMin: 1,
          offensiveTotalDamageReductionPercentMin: 15,
          offensiveTotalDamageReductionPercentDurationMin: 2,
        }).rows,
      ),
    ).toEqual([
      { value: "45%", label: "Slower target Movement for 3 Seconds" },
      { value: "24", label: "Reduced target's Resistances for 1 Seconds" },
      { value: "15%", label: "Reduced target's Damage for 2 Seconds" },
    ]);
  });

  test("crowd-control procs render as chance/duration, not raw offensive ids", () => {
    // Stun with a chance: "50% Chance of 1 Seconds of Stun".
    expect(resRows(formatPowerStats({ offensiveStunChance: 50, offensiveStunMin: 1 }).rows)).toEqual([
      { value: "50%", label: "Chance of 1 Seconds of Stun" },
    ]);
    // Guaranteed (no chance facet): "1.8 Seconds of Confusion".
    expect(resRows(formatPowerStats({ offensiveConfusionMin: 1.8 }).rows)).toEqual([
      { value: "1.8", label: "Seconds of Confusion" },
    ]);
    // Knockdown carries a Min-Max duration range.
    expect(
      resRows(
        formatPowerStats({ offensiveKnockdownChance: 100, offensiveKnockdownMin: 0.8, offensiveKnockdownMax: 1.5 })
          .rows,
      ),
    ).toEqual([{ value: "100%", label: "Chance of 0.8-1.5 Seconds of Knockdown" }]);
    // No raw humanized "Offensive ..." label survives.
    const petrify = formatPowerStats({ offensivePetrifyChance: 50, offensivePetrifyMin: 1.5 });
    expect(resRows(petrify.rows)).toEqual([{ value: "50%", label: "Chance of 1.5 Seconds of Petrify" }]);
  });

  test("timed magnitude debuffs (fumble, slows, resist reductions) render as reused subject phrases", () => {
    expect(resRows(formatPowerStats({ offensiveFumbleMin: 14, offensiveFumbleDurationMin: 2 }).rows)).toEqual([
      { value: "14%", label: "Fumble for 2 Seconds" },
    ]);
    expect(
      resRows(formatPowerStats({ offensiveProjectileFumbleMin: 25, offensiveProjectileFumbleDurationMin: 3 }).rows),
    ).toEqual([{ value: "25%", label: "Impaired Aim for 3 Seconds" }]);
    expect(
      resRows(formatPowerStats({ offensiveSlowAttackSpeedMin: 30, offensiveSlowAttackSpeedDurationMin: 5 }).rows),
    ).toEqual([{ value: "30%", label: "Slow target's Attack Speed for 5 Seconds" }]);
    expect(
      resRows(formatPowerStats({ offensiveSlowTotalSpeedMin: 50, offensiveSlowTotalSpeedDurationMin: 8 }).rows),
    ).toEqual([{ value: "50%", label: "Slow target's Total Speed for 8 Seconds" }]);
    expect(
      resRows(
        formatPowerStats({
          offensiveElementalResistanceReductionAbsoluteMin: 32,
          offensiveElementalResistanceReductionAbsoluteDurationMin: 2,
        }).rows,
      ),
    ).toEqual([{ value: "32", label: "Reduced target's Elemental Resistances (flat) for 2 Seconds" }]);
    expect(
      resRows(
        formatPowerStats({ offensivePhysicalReductionPercentMin: 20, offensivePhysicalReductionPercentDurationMin: 5 })
          .rows,
      ),
    ).toEqual([{ value: "20%", label: "Reduced target's Physical Resistance for 5 Seconds" }]);
  });

  test("radius falls back to skillTargetRadius when there is no projectile radius", () => {
    expect(resRows(formatPowerStats({ skillTargetRadius: 3.5 }).rows)).toEqual([
      { value: "3.5", label: "Meter Radius" },
    ]);
  });

  test("unhandled stat ids fall through to bonus formatting without a leading +", () => {
    // Twin Fangs: flat Vitality range + a leech percent, shown as ability lines.
    const r = formatPowerStats({
      weaponDamagePct: 22,
      offensiveLifeMin: 128,
      offensiveLifeMax: 221,
      offensiveLifeLeechMin: 45,
    });
    // Explicit meta lines are the ordered rows; the rest reuse the bonus formatter
    // (sign stripped) and land in fallthrough, which adapters sort by resolved label.
    expect(resRows(r.rows)).toEqual([{ value: "22%", label: "Weapon Damage" }]);
    expect(resSorted(r.fallthrough)).toEqual([
      { value: "45%", label: "of Attack Damage converted to Health" },
      { value: "128-221", label: "Vitality Damage" },
    ]);
  });

  test("empty stats yield no rows", () => {
    const r = formatPowerStats({});
    expect(r.rows).toEqual([]);
    expect(r.fallthrough).toEqual([]);
  });
});

describe("formatPet renders a summon proc's summary + base attack", () => {
  test("plural count + duration + base-attack damage (Raise the Dead)", () => {
    const r = formatPet({
      nameTag: "tagDevotionPet_Skeleton",
      count: 6,
      duration: 20,
      attackStats: { offensiveAetherMin: 230, offensiveLifeMin: 230 },
    });
    expect(res(r.summon)).toBe("Summons 6 Skeletons for 20 Seconds");
    expect(r.attack.rows).toEqual([]);
    expect(resSorted(r.attack.fallthrough)).toEqual([
      { value: "230", label: "Aether Damage" },
      { value: "230", label: "Vitality Damage" },
    ]);
  });
  test("single pet shows no count or plural (Bysmiel's Command)", () => {
    expect(res(formatPet({ nameTag: "tagDevotionPet_Hound", count: 1, duration: 20, attackStats: {} }).summon)).toBe(
      "Summons Eldritch Hound for 20 Seconds",
    );
  });
  test("missing count omits the number (Elemental Seeker)", () => {
    expect(
      res(formatPet({ nameTag: "tagDevotionPet_ElementalSeeker", count: null, duration: 3, attackStats: {} }).summon),
    ).toBe("Summons Elemental Seeker for 3 Seconds");
  });
});

test("formatBonusRowsWithIds keeps each row's stat id, merging a flat damage range to its Min id", () => {
  const rows = formatBonusRowsWithIds({ offensiveFireMin: 10, offensiveFireMax: 20, characterStrength: 5 });
  const ids = rows.map((r) => r.id);
  expect(ids).toContain("offensiveFireMin");
  expect(ids).toContain("characterStrength");
  expect(ids).not.toContain("offensiveFireMax"); // merged into the Min row
});

test("formatBonusRowsWithIds rows carry the correct label and value", () => {
  const bonuses = { characterStrength: 5, offensiveFireModifier: 12 };
  const withIds = formatBonusRowsWithIds(bonuses);
  expect(res(withIds.find((r) => r.id === "characterStrength")!.label)).toBe("Physique");
  expect(res(withIds.find((r) => r.id === "offensiveFireModifier")!.value)).toBe("+12%");
});

describe("mapped stat labels resolve via gameText, not translate", () => {
  test("Fire damage label uses the game catalog term even when it diverges from the app catalog", () => {
    // Deliberately divergent catalogs: if statLabel ever regressed to translate(key) for a
    // mapped key, the rendered label would contain "APP_FIRE" instead of "GAME_FIRE".
    const fireTag = STAT_TAGS["stat.damage.Fire"]!;
    const loc = makeLocalization(
      { "stat.damage.Fire": "APP_FIRE", "stat.template.damage": "{type} Damage" },
      {},
      "en",
      { [fireTag]: "GAME_FIRE" },
      {},
    );
    setLocalization(loc);
    try {
      const row = statRow("offensiveFireModifier", 10);
      const label = row ? resolveText(loc, row.label) : undefined;
      expect(label).toContain("GAME_FIRE");
      expect(label).not.toContain("APP_FIRE");
    } finally {
      installEnglish();
    }
  });
});

describe("isFilterableStat: the in/out boundary for power stats", () => {
  test("recognized damage/debuff stats are filterable", () => {
    expect(isFilterableStat("offensiveStunMin")).toBe(true);
    expect(isFilterableStat("offensiveTotalResistanceReductionAbsoluteMin")).toBe(true);
    expect(isFilterableStat("offensiveColdMax")).toBe(true);
  });
  test("ability-meta stats are NOT filterable (group Other)", () => {
    expect(isFilterableStat("skillCooldownTime")).toBe(false);
    expect(isFilterableStat("projectileLaunchNumber")).toBe(false);
    expect(isFilterableStat("weaponDamagePct")).toBe(false);
    expect(isFilterableStat("skillTargetRadius")).toBe(false);
    expect(isFilterableStat("damageAbsorption")).toBe(false);
  });
});
