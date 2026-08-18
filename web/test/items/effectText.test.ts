// ABOUTME: Tests for effectLines: single-stat rendering, min/max range collapse,
// ABOUTME: damage-over-time/debuff duration composition, refresh, and conversion lines.
import { test, expect } from "bun:test";
import { litT, makeLocalization, resolveText } from "../../src/core/localization";
import { COMPOSER, effectLines, maxPlaceholderIndex } from "../../src/items/core/effectText";
import statItemTags from "../../../data/stat-item-tags.json";
import gameEn from "../../../data/i18n/game.en.json";

const GAME: Record<string, string> = {
  DamageFire: "{%t0} Fire Damage",
  tagCharAttackSpeed: "{%+.0f0}% Attack Speed",
  SkillWeaponDamageFormat: "{%.0f0%} Weapon Damage",
};
const TAGS: Record<string, string> = {
  offensiveFireMin: "DamageFire",
  offensiveFireMax: "DamageFire",
  characterAttackSpeed: "tagCharAttackSpeed",
  weaponDamagePct: "SkillWeaponDamageFormat",
};
const ctx = {
  tagOf: (s: string) => TAGS[s],
  templateOf: (t: string) => GAME[t],
  nameOf: () => undefined,
};
const loc = makeLocalization({}, {}, "en", GAME, GAME);
const render = (stats: any[]) => effectLines(stats, ctx).map((t) => resolveText(loc, t));

test("a templated stat renders through its own template", () => {
  expect(render([{ stat: "characterAttackSpeed", value: 5 }])).toEqual(["+5% Attack Speed"]);
});
test("a lone min renders as a single value, not a range", () => {
  expect(render([{ stat: "offensiveFireMin", value: 200 }])).toEqual(["200 Fire Damage"]);
});
test("min and max collapse into one range line", () => {
  expect(
    render([
      { stat: "offensiveFireMin", value: 120 },
      { stat: "offensiveFireMax", value: 180 },
    ]),
  ).toEqual(["120-180 Fire Damage"]);
});
test("an unknown stat is dropped rather than rendered raw", () => {
  expect(render([{ stat: "overwriteBaseSkill", value: 1 }])).toEqual([]);
});

// The real data (data/skill-items.json) orders stats by id, and "Max" sorts before "Min",
// so every one of the 80 paired min/max blocks in the actual dataset hits Max first. The
// "min and max collapse" test above never exercises that ordering.
test("max before min still collapses to one range line, values ordered min-max", () => {
  expect(
    render([
      { stat: "offensiveFireMax", value: 180 },
      { stat: "offensiveFireMin", value: 120 },
    ]),
  ).toEqual(["120-180 Fire Damage"]);
});
test("min before max still yields exactly one range line (guards the other ordering)", () => {
  expect(
    render([
      { stat: "offensiveFireMin", value: 120 },
      { stat: "offensiveFireMax", value: 180 },
    ]),
  ).toEqual(["120-180 Fire Damage"]);
});
test("a max-before-min pair among other stats renders at the pair's first-appearing position", () => {
  expect(
    render([
      { stat: "characterAttackSpeed", value: 5 },
      { stat: "offensiveFireMax", value: 180 },
      { stat: "weaponDamagePct", value: 20 },
      { stat: "offensiveFireMin", value: 120 },
    ]),
  ).toEqual(["+5% Attack Speed", "120-180 Fire Damage", "20% Weapon Damage"]);
});
test("a lone max renders as a single value, not dropped", () => {
  expect(render([{ stat: "offensiveFireMax", value: 180 }])).toEqual(["180 Fire Damage"]);
});
// The DOT pattern was widened (fix round 1, C2) from anchoring on "offensiveSlow" to matching
// any "<f>Min"/"<f>DurationMin" pair, so an ordinary ranged stat like offensiveFireMin now
// matches DOT too. It must still fall through to the range rule below when no
// offensiveFireDurationMin sibling exists, rather than being swallowed by the DOT branch.
test("a widened DOT match on an ordinary Min/Max pair still falls through to the range rule", () => {
  expect(
    render([
      { stat: "offensiveFireMin", value: 120 },
      { stat: "offensiveFireMax", value: 180 },
    ]),
  ).toEqual(["120-180 Fire Damage"]);
});

// Pinned to real grimtools cards: damage-over-time, debuff duration, refresh, and
// conversion composition. The real stat->tag catalog (data/stat-item-tags.json) maps
// a DurationMin stat to the SAME tag as its value stat, and the real data
// (data/skill-items.json) sorts DurationMin before the value stat by id, so every
// test below lists the duration stat first, exactly as it arrives in production.
const CARD_GAME: Record<string, string> = {
  ...GAME,
  DamageDurationBleeding: "Bleeding Damage",
  DamageDurationPoison: "Poison Damage",
  DamageDurationLightning: "Electrocute Damage",
  DamageDurationTotalSpeed: "% Slow target",
  DamageDurationDefensiveAbility: "Reduced target's Defensive Ability",
  DamageDurationResistanceReduction: "Reduced target's Resistances",
  DamageSingleFormatTime: "over {%.1f0} Seconds",
  DamageFixedSingleFormatTime: "for {%.1f0} Seconds",
  tagDamageConversion: "{%.0f0}% {%s1} converted to {%s2}",
  tagCharStatsVitality: "Vitality",
  tagCharStatsFire: "Fire",
  tagSkillCooldownRefreshName: "{%t0} to reduce cooldown of {%s1} by {%.1f2} {%z3}",
  tagSkillCooldownRefresh: "{%t0} to reduce cooldown by {%.1f1} {%z2}",
  // fix round 1, C1: the plan's COMPOSER_TAGS omitted these two; the duration family
  // needs all four name/max combinations (data/skill-items.json: 23 of its 29 blocks
  // carry a Max), the cooldown family only ever needs the two above (0 of 73 do).
  tagSkillDurationRefresh: "{%t0} to extend duration by {%.1f1} {%z2}",
  tagSkillDurationRefreshName: "{%t0} to extend duration of {%s1} by {%.1f2} {%z3}",
  tagSkillDurationRefreshMax: "{%t0} to refresh duration by {%.1f1} {%z2} (Max {%.1f3} {%z4})",
  tagSkillDurationRefreshNameMax: "{%t0} to refresh duration of {%s1} by {%.1f2} {%z3} (Max {%.1f4} {%z5})",
  tagRefreshSkillCondition07: "{%d0}% Chance on Attack",
  tagSecond: "Second",
  tagSeconds: "Seconds",
  // Task 9: the COMPOSER table's generic unit/count/percent composers, plus the two
  // plain labels exercised directly below. Real text, data/i18n/game.en.json.
  CooldownTime: "Skill Recharge",
  SkillSecondFormat: "{%.1f0 Second %s1}",
  TargetRadius: "Target Area",
  SkillDistanceFormat: "{%.1f0 Meter %s1}",
  ManaCost: "Energy Cost",
  SkillCostFormat: "{%.1f0 %s1}",
  SkillIntFormat: "{%d0 %s1}",
  tagCharStatsBlockChance: "Chance to Block",
  SkillPercentFormat: "{%.0f0% %s1}",
};
const CARD_TAGS: Record<string, string> = {
  ...TAGS,
  skillCooldownTime: "CooldownTime",
  skillTargetRadius: "TargetRadius",
  skillManaCost: "ManaCost",
  defensiveBlockChance: "tagCharStatsBlockChance",
  offensiveSlowBleedingMin: "DamageDurationBleeding",
  offensiveSlowBleedingDurationMin: "DamageDurationBleeding",
  offensiveSlowPoisonMin: "DamageDurationPoison",
  offensiveSlowPoisonDurationMin: "DamageDurationPoison",
  offensiveSlowLightningMin: "DamageDurationLightning",
  offensiveSlowLightningDurationMin: "DamageDurationLightning",
  offensiveSlowLightningChance: "DamageDurationLightning",
  offensiveSlowTotalSpeedMin: "DamageDurationTotalSpeed",
  offensiveSlowTotalSpeedDurationMin: "DamageDurationTotalSpeed",
  offensiveSlowDefensiveAbilityMin: "DamageDurationDefensiveAbility",
  offensiveSlowDefensiveAbilityDurationMin: "DamageDurationDefensiveAbility",
  // fix round 1, C2: the DoT/debuff-duration shape isn't limited to offensiveSlow*
  // families. offensiveTotalResistanceReductionAbsolute is one of six such families
  // (45 blocks total) that the old offensiveSlow-anchored regex missed.
  offensiveTotalResistanceReductionAbsoluteMin: "DamageDurationResistanceReduction",
  offensiveTotalResistanceReductionAbsoluteDurationMin: "DamageDurationResistanceReduction",
  conversionPercentage: "tagDamageConversion",
  conversionPercentage2: "tagDamageConversion",
  refreshCooldownAmount: "tagSkillCooldownRefresh",
  refreshCooldownChance: "tagSkillCooldownRefresh",
  refreshDurationAmount: "tagSkillDurationRefresh",
  refreshDurationChance: "tagSkillDurationRefresh",
  refreshDurationMax: "tagSkillDurationRefreshMax",
};
const SKILL_NAMES: Record<string, string> = {
  "records/skills/playerclass10/leap1.dbr": "Leap",
};
const cardCtx = {
  tagOf: (s: string) => CARD_TAGS[s],
  templateOf: (t: string) => CARD_GAME[t],
  // Throws on a falsy skill record rather than silently returning undefined, so a
  // regression that drops the `amount.refresh_skill ?` guard (fix round 1, I4b) fails
  // loudly instead of coincidentally matching the unnamed-variant test below.
  nameOf: (r: string) => {
    if (!r) throw new Error("nameOf called with no refresh_skill - the guard was removed");
    return SKILL_NAMES[r] ? litT(SKILL_NAMES[r]) : undefined;
  },
};
const cardLoc = makeLocalization({}, {}, "en", CARD_GAME, CARD_GAME);
const cardRender = (stats: any[]) => effectLines(stats, cardCtx).map((t) => resolveText(cardLoc, t));

test("Badge of the Crimson Company: DoT total is the per-second value times duration", () => {
  // grimtools card: "300 Bleeding Damage over 2 Seconds"
  expect(
    cardRender([
      { stat: "offensiveSlowBleedingDurationMin", value: 2 },
      { stat: "offensiveSlowBleedingMin", value: 150 },
    ]),
  ).toEqual(["300 Bleeding Damage over 2 Seconds"]);
});

test("Scarstone Memento: the same rule at a different duration", () => {
  // grimtools card: "400 Poison Damage over 5 Seconds"
  expect(
    cardRender([
      { stat: "offensiveSlowPoisonDurationMin", value: 5 },
      { stat: "offensiveSlowPoisonMin", value: 80 },
    ]),
  ).toEqual(["400 Poison Damage over 5 Seconds"]);
});

test("Eldrun's Cursed Vision: damage multiplies and says over, a debuff does neither", () => {
  // One Storm Totem block, one duration, both rules. grimtools card:
  //   "160 Electrocute Damage over 2 Seconds"
  //   "25% Slow target for 2 Seconds"
  // This is the pin for R2. A rule that multiplies every offensiveSlow family
  // prints 50 for the slow, and "over" instead of "for".
  expect(
    cardRender([
      { stat: "offensiveSlowLightningDurationMin", value: 2 },
      { stat: "offensiveSlowLightningMin", value: 80 },
      { stat: "offensiveSlowTotalSpeedDurationMin", value: 2 },
      { stat: "offensiveSlowTotalSpeedMin", value: 25 },
    ]),
  ).toEqual(["160 Electrocute Damage over 2 Seconds", "25% Slow target for 2 Seconds"]);
});

test("Diremane Trophy: a reduction debuff keeps its magnitude", () => {
  // grimtools card: "150 Reduced target's Defensive Ability for 5 Seconds"
  expect(
    cardRender([
      { stat: "offensiveSlowDefensiveAbilityDurationMin", value: 5 },
      { stat: "offensiveSlowDefensiveAbilityMin", value: 150 },
    ]),
  ).toEqual(["150 Reduced target's Defensive Ability for 5 Seconds"]);
});

test("Badge of the Crimson Company: the refresh line names its target and trigger", () => {
  // grimtools card: "25% Chance on Attack to reduce cooldown of Leap by 1 Second"
  expect(
    cardRender([
      {
        stat: "refreshCooldownAmount",
        value: 1,
        refresh_skill: "records/skills/playerclass10/leap1.dbr",
        refresh_trigger: "AttackEnemy",
      },
      {
        stat: "refreshCooldownChance",
        value: 25,
        refresh_skill: "records/skills/playerclass10/leap1.dbr",
        refresh_trigger: "AttackEnemy",
      },
    ]),
  ).toEqual(["25% Chance on Attack to reduce cooldown of Leap by 1 Second"]);
});

test("a refresh line with no target skill uses the unnamed variant", () => {
  expect(
    cardRender([
      { stat: "refreshCooldownAmount", value: 2, refresh_trigger: "AttackEnemy" },
      { stat: "refreshCooldownChance", value: 30, refresh_trigger: "AttackEnemy" },
    ]),
  ).toEqual(["30% Chance on Attack to reduce cooldown by 2 Seconds"]);
});

test("Scarstone Memento: two conversions on one block stay two lines", () => {
  expect(
    cardRender([
      { stat: "conversionPercentage", value: 100, from_tag: "tagCharStatsVitality", to_tag: "tagCharStatsFire" },
      { stat: "conversionPercentage2", value: 20, from_tag: "tagCharStatsFire", to_tag: "tagCharStatsVitality" },
    ]),
  ).toEqual(["100% Vitality converted to Fire", "20% Fire converted to Vitality"]);
});

// fix round 1, I2: 1 of 796 conversion stats in the real data lacks a from_tag or to_tag.
test("a conversion missing either tag is dropped, not rendered with the value alone", () => {
  expect(cardRender([{ stat: "conversionPercentage", value: 100, to_tag: "tagCharStatsFire" }])).toEqual([]);
});

// fix round 1, C2: the DoT/debuff-duration shape occurs outside offensiveSlow too. Pinned to
// the brief's example wording (verified against the real 22-block family in data/skill-items.json).
test("offensiveTotalResistanceReductionAbsolute: a non-offensiveSlow debuff family composes too", () => {
  expect(
    cardRender([
      { stat: "offensiveTotalResistanceReductionAbsoluteDurationMin", value: 3 },
      { stat: "offensiveTotalResistanceReductionAbsoluteMin", value: 32 },
    ]),
  ).toEqual(["32 Reduced target's Resistances for 3 Seconds"]);
});

// fix round 1, C2 trap: exactly one block in the real data has a lone offensiveSlow*DurationMin
// with no value sibling (offensiveSlowLightningDurationMin, paired only with
// offensiveSlowLightningChance). It must render through the ordinary fallback, not be dropped.
test("a lone duration stat with no value sibling falls through rather than being dropped", () => {
  expect(cardRender([{ stat: "offensiveSlowLightningDurationMin", value: 2 }])).toEqual(["2 Electrocute Damage"]);
});

// fix round 1, I4a: a plain (non-templated) label reaching the ordinary fallback - not the DOT
// branch - still carries its value. Mutating the fallback back to gameFormatT(tag, [s.value])
// would silently drop the value for this template, since it has no placeholder to hold it.
test("a plain-label stat with no duration sibling still carries its value through the ordinary fallback", () => {
  expect(cardRender([{ stat: "offensiveSlowTotalSpeedMin", value: 25 }])).toEqual(["25% Slow target"]);
});

// fix round 1, C1: refreshDuration's Max variant (23 of its 29 blocks carry one) previously
// reached the plain renderer under its own 5-arg composer tag and emitted a second, broken
// line; here it composes into the one named line with the "(Max N Seconds)" suffix.
// Synthetic (no single grimtools card pins Name+Max together): exercises the composer
// selection directly against the templates in data/i18n/game.en.json.
test("a refreshDuration line with a target and a Max caps the duration", () => {
  expect(
    cardRender([
      {
        stat: "refreshDurationAmount",
        value: 1,
        refresh_skill: "records/skills/playerclass10/leap1.dbr",
        refresh_trigger: "AttackEnemy",
      },
      {
        stat: "refreshDurationChance",
        value: 20,
        refresh_skill: "records/skills/playerclass10/leap1.dbr",
        refresh_trigger: "AttackEnemy",
      },
      {
        stat: "refreshDurationMax",
        value: 5,
        refresh_skill: "records/skills/playerclass10/leap1.dbr",
        refresh_trigger: "AttackEnemy",
      },
    ]),
  ).toEqual(["20% Chance on Attack to refresh duration of Leap by 1 Second (Max 5 Seconds)"]);
});

test("a refreshDuration line with a Max but no target uses the unnamed Max variant", () => {
  expect(
    cardRender([
      { stat: "refreshDurationAmount", value: 2, refresh_trigger: "AttackEnemy" },
      { stat: "refreshDurationChance", value: 30, refresh_trigger: "AttackEnemy" },
      { stat: "refreshDurationMax", value: 6, refresh_trigger: "AttackEnemy" },
    ]),
  ).toEqual(["30% Chance on Attack to refresh duration by 2 Seconds (Max 6 Seconds)"]);
});

// fix round 1, C1 second half: REFRESH previously didn't match the *Max stat itself, so if it
// were ever visited before its Amount/Chance siblings, it would render its own broken line (a
// 5-arg composer handed one value) in addition to the correctly composed line. Real data always
// orders Max last (data/skill-items.json), so this specifically exercises the out-of-order case.
test("a refresh Max stat visited before its Amount/Chance siblings still composes into one line", () => {
  expect(
    cardRender([
      { stat: "refreshDurationMax", value: 5, refresh_trigger: "AttackEnemy" },
      { stat: "refreshDurationAmount", value: 2, refresh_trigger: "AttackEnemy" },
      { stat: "refreshDurationChance", value: 30, refresh_trigger: "AttackEnemy" },
    ]),
  ).toEqual(["30% Chance on Attack to refresh duration by 2 Seconds (Max 5 Seconds)"]);
});

test("a refreshDuration line with a target and no Max uses the unnamed-Max-free named variant", () => {
  expect(
    cardRender([
      {
        stat: "refreshDurationAmount",
        value: 3,
        refresh_skill: "records/skills/playerclass10/leap1.dbr",
        refresh_trigger: "AttackEnemy",
      },
      {
        stat: "refreshDurationChance",
        value: 15,
        refresh_skill: "records/skills/playerclass10/leap1.dbr",
        refresh_trigger: "AttackEnemy",
      },
    ]),
  ).toEqual(["15% Chance on Attack to extend duration of Leap by 3 Seconds"]);
});

// Task 9: valueLine's plain/templated split was /\{%/, which misses a sign-prefixed
// placeholder group like "{-%.0f0}" (the sign sits outside the "%", unlike the more common
// "{%+.0f0}"). tagCharDefensiveBlockRecoveryReduction is real production data, 13
// occurrences in data/skill-items.json, and rendered the raw unformatted template text
// under the old check ("12 {-%.0f0}% Shield Recovery Time") instead of substituting it.
test("a sign-prefixed placeholder group is recognized as templated, not a plain label", () => {
  const signGame = { tagCharDefensiveBlockRecoveryReduction: "{-%.0f0}% Shield Recovery Time" };
  const ctx = {
    tagOf: (s: string) =>
      s === "characterDefensiveBlockRecoveryReduction" ? "tagCharDefensiveBlockRecoveryReduction" : undefined,
    templateOf: (t: string) => signGame[t as keyof typeof signGame],
    nameOf: () => undefined,
  };
  const loc = makeLocalization({}, {}, "en", signGame, signGame);
  expect(
    effectLines([{ stat: "characterDefensiveBlockRecoveryReduction", value: 12 }], ctx).map((t) => resolveText(loc, t)),
  ).toEqual(["-12% Shield Recovery Time"]);
});

// Task 9: COMPOSER. R12 - "a plain label already carrying its own percent" is not a valid
// oracle for this table: Task 8's valueLine already handles that case (template.startsWith("%")),
// so a test built on offensiveSlowTotalSpeedMin passes with or without COMPOSER and proves
// nothing. These three exercise the three composer families that actually need one.
test("a seconds-unit label composes through SkillSecondFormat", () => {
  // CooldownTime = "Skill Recharge", SkillSecondFormat = "{%.1f0 Second %s1}"
  expect(cardRender([{ stat: "skillCooldownTime", value: 3 }])).toEqual(["3 Second Skill Recharge"]);
});
test("a bare-percent-missing label composes through SkillPercentFormat", () => {
  // tagCharStatsBlockChance = "Chance to Block", unlike "% Slow target" it carries no "%"
  // of its own, so the bare fallback would read "15 Chance to Block" without a composer.
  expect(cardRender([{ stat: "defensiveBlockChance", value: 15 }])).toEqual(["15% Chance to Block"]);
});
test("a radius label composes through SkillDistanceFormat", () => {
  expect(cardRender([{ stat: "skillTargetRadius", value: 4 }])).toEqual(["4 Meter Target Area"]);
});

// Task 9, Step 5: the brief's coverage guard used /\{%/ to detect "templated"; effectText.ts's
// actual split (valueLine) is /\{/, since every brace group in data/i18n/game.en.json wraps a
// substitution - a narrower check misses sign-prefixed groups like "{-%.0f0}" and would demand
// a composer for tags that are actually templated already. This guard mirrors the real split.
test("every plain label has a composer or carries its own percent", () => {
  const tags = statItemTags as Record<string, string>;
  const game = gameEn as Record<string, string>;
  const unhandled = [...new Set(Object.values(tags))].filter((t) => {
    const text = game[t];
    return text !== undefined && !/\{/.test(text) && !COMPOSER[t] && !text.startsWith("%");
  });
  expect(unhandled).toEqual([]);
});

// R14: a templated tag whose highest placeholder index exceeds the single value valueLine
// supplies must not emit a partial line ("+16% Damage to"). This walks every tag directly
// assigned to a stat (data/stat-item-tags.json) and flags any templated one that both (a)
// needs more than index 0 and (b) isn't handled by a path that supplies its own extra args
// (conversionPercentage's 3-arg composer, the refresh family's composers). A change to the
// frozen list below means either a new such tag showed up in the data (real bug: check
// whether it's now suppressed) or an exemption needs updating (not a silent pass).
test("every templated tag reachable directly from a stat needs no more than the value we supply, except conversion/refresh composers", () => {
  const tags = statItemTags as Record<string, string>;
  const game = gameEn as Record<string, string>;
  const isConversion = (stat: string) => stat.startsWith("conversionPercentage");
  const isRefresh = (stat: string) => /^(refreshCooldown|refreshDuration)(Amount|Chance|Max)$/.test(stat);
  const offenders = Object.entries(tags)
    .filter(([stat, tag]) => {
      const text = game[tag];
      return text?.includes("{") && !isConversion(stat) && !isRefresh(stat) && maxPlaceholderIndex(text) > 0;
    })
    .map(([stat]) => stat)
    .sort();
  // Real occurrences in data/skill-items.json: sparkChance x6, racialBonusPercentDamage x1.
  // augmentSkillLevel1/2 (tag ItemSkillIncrement), augmentMasteryLevel1/2 (tag
  // ItemMasteryIncrement), and racialBonusPercentDefense share the shape but occur 0 times
  // today. All seven are suppressed by valueLine's maxPlaceholderIndex check, not rendered.
  expect(offenders).toEqual([
    "augmentMasteryLevel1",
    "augmentMasteryLevel2",
    "augmentSkillLevel1",
    "augmentSkillLevel2",
    "racialBonusPercentDamage",
    "racialBonusPercentDefense",
    "sparkChance",
  ]);
});

test("racialBonusPercentDamage is suppressed rather than truncated to a dangling 'to'", () => {
  // Real template (data/i18n/game.en.json): "{%+.0f0}% Damage to {%s1}". grimtools shows
  // "+16% Damage to Chthonics" (Crystallum, item level 84); the target race name isn't
  // carried into data/skill-items.json (racialBonusRace), so the line is dropped rather
  // than rendering "+16% Damage to".
  const ctx = {
    tagOf: (s: string) => (s === "racialBonusPercentDamage" ? "RacialBonusPercentDamage" : undefined),
    templateOf: (t: string) => (t === "RacialBonusPercentDamage" ? "{%+.0f0}% Damage to {%s1}" : undefined),
    nameOf: () => undefined,
  };
  const loc = makeLocalization({}, {}, "en", {}, {});
  expect(effectLines([{ stat: "racialBonusPercentDamage", value: 16 }], ctx).map((t) => resolveText(loc, t))).toEqual(
    [],
  );
});

test("sparkChance is suppressed rather than truncated with no target count", () => {
  // Real template: "{%.0f0}% Chance of affecting up to {%d1} targets". The target count
  // (sparkMaxNumber) isn't carried into data/skill-items.json, so the line is dropped
  // rather than rendering "30% Chance of affecting up to".
  const ctx = {
    tagOf: (s: string) => (s === "sparkChance" ? "tagSparkMaxNumberChance" : undefined),
    templateOf: (t: string) =>
      t === "tagSparkMaxNumberChance" ? "{%.0f0}% Chance of affecting up to {%d1} targets" : undefined,
    nameOf: () => undefined,
  };
  const loc = makeLocalization({}, {}, "en", {}, {});
  expect(effectLines([{ stat: "sparkChance", value: 30 }], ctx).map((t) => resolveText(loc, t))).toEqual([]);
});
