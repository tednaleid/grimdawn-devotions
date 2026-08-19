// ABOUTME: Tests for effectLines: single-stat rendering, min/max range collapse,
// ABOUTME: damage-over-time/debuff duration composition, refresh, and conversion lines.
import { test, expect } from "bun:test";
import { litT, makeLocalization, resolveText, type Text } from "../../src/core/localization";
import { COMPOSER, effectLines, maxPlaceholderIndex } from "../../src/items/core/effectText";
import { DECLARED_NOT_DAMAGE, damageTypeOfTag, namesADamageToken } from "../../src/items/core/damageTypes";
import statItemTags from "../../../data/stat-item-tags.json";
import gameEn from "../../../data/i18n/game.en.json";
import appEn from "../../src/i18n/app.en.json";
import catalogueDoc from "../../../data/skill-items.json";

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
const render = (stats: any[]) => effectLines(stats, ctx).map((l) => resolveText(loc, l.text));

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
  tagRefreshSkillCondition10: "{%d0}% Chance on Critical Attack",
  SkillCooldownReduction: "+{%.0f0}% Skill Cooldown Reduction",
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
  // Task 8b: Judgment and Winds of Asterkarn, the two DoT families in the oracle test
  // that must keep rendering correctly. Real text, data/i18n/game.en.json.
  DamageDurationFire: "Burn Damage",
  DamageDurationCold: "Frostburn Damage",
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
  offensiveSlowPoisonChance: "DamageDurationPoison",
  offensiveSlowLightningMin: "DamageDurationLightning",
  offensiveSlowLightningMax: "DamageDurationLightning",
  offensiveSlowLightningDurationMin: "DamageDurationLightning",
  offensiveSlowLightningChance: "DamageDurationLightning",
  offensiveSlowFireMin: "DamageDurationFire",
  offensiveSlowFireDurationMin: "DamageDurationFire",
  offensiveSlowColdMin: "DamageDurationCold",
  offensiveSlowColdDurationMin: "DamageDurationCold",
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
  skillCooldownReduction: "SkillCooldownReduction",
  skillCooldownReductionChance: "SkillCooldownReduction",
};
const SKILL_NAMES: Record<string, string> = {
  "records/skills/playerclass10/leap1.dbr": "Leap",
  "records/skills/playerclass06/savagestrike1.dbr": "Primal Strike",
  "records/skills/playerclass02/stunjacks1.dbr": "Stun Jacks",
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
// The real app catalog: effectLines composes the chance prefix from items.effect.chance*, the
// one app-authored piece of grammar on this path (the game's own tagChanceOf/tagChanceTo do not
// survive its table build - see BACKLOG.md), so a fixture with an empty catalog would render
// the raw key and hide what these lines actually say.
const APP = appEn as Record<string, string>;
const cardLoc = makeLocalization(APP, APP, "en", CARD_GAME, CARD_GAME);
const cardRender = (stats: any[]) => effectLines(stats, cardCtx).map((l) => resolveText(cardLoc, l.text));

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

// Task 8b, reverting a fix round 1 mistake: exactly one block in the real data has a lone
// offensiveSlow*DurationMin with no value sibling (Awakened Inscribed Bracers' Wind Devil:
// offensiveSlowLightningDurationMin, paired only with offensiveSlowLightningChance).
// grimtools shows no Wind Devil block at all for that item, so this must render nothing,
// not fall through to the plain fallback and print the duration as a damage amount.
test("a lone duration stat with no value sibling is dropped, not printed as a damage amount", () => {
  expect(cardRender([{ stat: "offensiveSlowLightningDurationMin", value: 2 }])).toEqual([]);
});

// Task 8b: the other half of the same Wind Devil block. offensiveSlowLightningChance is a
// proc chance (180%), but data/stat-item-tags.json maps it to the damage-label tag, so the
// plain fallback would print it as "180 Electrocute Damage". Suppress it when there's no
// Min sibling to attach the chance to.
test("a slow-family chance stat with no Min sibling is dropped, not printed as a damage amount", () => {
  expect(cardRender([{ stat: "offensiveSlowLightningChance", value: 180 }])).toEqual([]);
});

// Ruling R19's oracle, closed in the final fix round. Mythical Viperfang Grips, Blood of Dreeg
// block. grimtools card: "10% Chance of 540 Poison Damage over 5 Seconds". The chance folds into
// the composed DoT line as a leading prefix; it used to print itself as "10 Poison Damage" above
// it, a second line that reads as a damage amount.
test("a slow-family chance stat with a Min sibling folds into the DoT line as a leading chance", () => {
  expect(
    cardRender([
      { stat: "offensiveSlowPoisonChance", value: 10 },
      { stat: "offensiveSlowPoisonDurationMin", value: 5 },
      { stat: "offensiveSlowPoisonMin", value: 108 },
    ]),
  ).toEqual(["10% Chance of 540 Poison Damage over 5 Seconds"]);
});

// Task 8b oracle: Awakened Inscribed Bracers (records/items/awakened/gearhands/c029_hands.dbr)
// across all three of its real modifier blocks. grimtools shows nothing for Wind Devil, and
// still renders Judgment and Winds of Asterkarn correctly - the fix must not disturb those.
test("Awakened Inscribed Bracers: Wind Devil renders nothing, Judgment and Winds of Asterkarn are undisturbed", () => {
  expect(
    cardRender([
      { stat: "offensiveSlowLightningChance", value: 180 },
      { stat: "offensiveSlowLightningDurationMin", value: 2 },
    ]),
  ).toEqual([]);
  expect(
    cardRender([
      { stat: "offensiveSlowFireDurationMin", value: 2 },
      { stat: "offensiveSlowFireMin", value: 120 },
    ]),
  ).toEqual(["240 Burn Damage over 2 Seconds"]);
  expect(
    cardRender([
      { stat: "offensiveSlowColdDurationMin", value: 3 },
      { stat: "offensiveSlowColdMin", value: 120 },
    ]),
  ).toEqual(["360 Frostburn Damage over 3 Seconds"]);
});

// fix-1: the real Wind Devil shape that WAS silently dropping its numbers. Howling Wind
// (records/skills/playerclass06/pets/petskill_whirlwind_whirlwind.dbr) carries
// offensiveSlowLightningMin/Max but no offensiveSlowLightningDurationMin sibling, so the DOT
// branch above can't fire and this falls to the RANGE branch. DamageDurationLightning's real
// template is plain ("Electrocute Damage", no {}), and the RANGE branch used to call
// gameFormatT([[min,max]]) directly, which has nothing to substitute a bracket-less template
// into: the line rendered as the bare label "Electrocute Damage" with both numbers gone. Routing
// through valueLine (as this branch now does) renders the bare "min-max label" shape instead,
// the same way an uncomposed scalar already does. Values are the real max-rank pair (213/265).
test("Wind Devil: a Min/Max pair on a plain shared tag renders as a bare range, not a bare label with no numbers", () => {
  expect(
    cardRender([
      { stat: "offensiveSlowLightningMax", value: 265 },
      { stat: "offensiveSlowLightningMin", value: 213 },
    ]),
  ).toEqual(["213-265 Electrocute Damage"]);
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
    effectLines([{ stat: "characterDefensiveBlockRecoveryReduction", value: 12 }], ctx).map((l) =>
      resolveText(loc, l.text),
    ),
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
  expect(
    effectLines([{ stat: "racialBonusPercentDamage", value: 16 }], ctx).map((l) => resolveText(loc, l.text)),
  ).toEqual([]);
});

test("sparkChance is suppressed rather than truncated with no target count", () => {
  // Real template: "{%.0f0}% Chance of affecting up to {%d1} targets". valueLine supplies one
  // value, so the two-argument template is dropped rather than rendering "30% Chance of
  // affecting up to". Note the target count IS in the payload - sparkMaxNumber rides along on
  // all 8 blocks that carry sparkChance, mapped to tagSparkMaxNumber, and renders its own
  // "Affects up to N targets" line today. Folding the pair into one line is Task 9b's spark
  // half, still deferred, and is an effectText.ts-only change (the plan used to say otherwise).
  const ctx = {
    tagOf: (s: string) => (s === "sparkChance" ? "tagSparkMaxNumberChance" : undefined),
    templateOf: (t: string) =>
      t === "tagSparkMaxNumberChance" ? "{%.0f0}% Chance of affecting up to {%d1} targets" : undefined,
    nameOf: () => undefined,
  };
  const loc = makeLocalization({}, {}, "en", {}, {});
  expect(effectLines([{ stat: "sparkChance", value: 30 }], ctx).map((l) => resolveText(loc, l.text))).toEqual([]);
});

// --- final fix round, C3: a ModBlock is one (item, skill) pair, not one carrier.
// scripts/build_skill_items.py merges every modifier record touching a skill into one stats
// list (ordered by modifier_record then stat id), so one block can name the same stat twice
// and each carrier's stats sit contiguously. Three real blocks do.

// Stormrend (records/items/gearweapons/axe1h/d205_axe.dbr), Werewolf block: TWO complete
// refresh carriers, same amount and chance, different target skills. Keying the used-set by
// stat id rendered ONE line, and that line read the SECOND carrier's refresh_skill even
// though it was entered on the first.
test("Stormrend: two refresh carriers in one block render two lines, each naming its own target", () => {
  const carrier = (skill: string) => [
    { stat: "refreshCooldownAmount", value: 2, refresh_skill: skill, refresh_trigger: "AttackEnemyCrit" },
    { stat: "refreshCooldownChance", value: 30, refresh_skill: skill, refresh_trigger: "AttackEnemyCrit" },
  ];
  expect(
    cardRender([
      ...carrier("records/skills/playerclass06/savagestrike1.dbr"),
      ...carrier("records/skills/playerclass02/stunjacks1.dbr"),
    ]),
  ).toEqual([
    "30% Chance on Critical Attack to reduce cooldown of Primal Strike by 2 Seconds",
    "30% Chance on Critical Attack to reduce cooldown of Stun Jacks by 2 Seconds",
  ]);
});

// Bloodlord's Blade (records/items/gearweapons/swords1h/b013e_sword.dbr), Possession block:
// skillCooldownReduction 100 on the chance-gated carrier and 5 on the flat one - the exact
// pair build_skill_items.py:167-170 documents as deliberately preserved upstream. The 5 was
// silently discarded downstream.
test("a stat id repeated by a second carrier in the same block keeps both values", () => {
  expect(
    cardRender([
      { stat: "skillCooldownReduction", value: 100 },
      { stat: "skillCooldownReduction", value: 5 },
    ]),
  ).toEqual(["+100% Skill Cooldown Reduction", "+5% Skill Cooldown Reduction"]);
});

// --- final fix round, C2/I1/I2: a <X>Chance that shares its family's display tag is a
// probability, and a crowd-control tag's {%t0} is a duration clause, not a number.

const CC_GAME: Record<string, string> = {
  ...CARD_GAME,
  DamagePetrify: "Petrify target{%t0}",
  DamageFreeze: "Freeze target{%t0}",
  DamageTrap: "Immobilize target{%t0}",
  DamageStun: "Stun target{%t0}",
  DamageFixedRangeFormatTime: "for {%.1f0} - {%.1f1} Seconds",
  RetaliationFear: "{%t0} of Terrify Retaliation",
  DamageElemental: "{%t0} Elemental Damage",
};
const CC_TAGS: Record<string, string> = {
  ...CARD_TAGS,
  offensivePetrify: "DamagePetrify",
  offensivePetrifyMin: "DamagePetrify",
  offensivePetrifyChance: "DamagePetrify",
  offensiveFreezeMin: "DamageFreeze",
  offensiveFreezeChance: "DamageFreeze",
  offensiveTrap: "DamageTrap",
  offensiveTrapChance: "DamageTrap",
  offensiveStunMin: "DamageStun",
  offensiveStunMax: "DamageStun",
  retaliationFear: "RetaliationFear",
  retaliationFearMin: "RetaliationFear",
  offensiveElementalMin: "DamageElemental",
  offensiveElementalChance: "DamageElemental",
};
const ccCtx = {
  tagOf: (s: string) => CC_TAGS[s],
  templateOf: (t: string) => CC_GAME[t],
  nameOf: () => undefined,
};
const ccLoc = makeLocalization(APP, APP, "en", CC_GAME, CC_GAME);
const ccRender = (stats: any[]) => effectLines(stats, ccCtx).map((l) => resolveText(ccLoc, l.text));

// The oracle for this whole shape. Mythical Mark of Anathema, Callidor's Tempest block:
// offensivePetrifyChance 10 + offensivePetrifyMin 2. grimtools card:
// "10% Chance to Petrify target for 2 Seconds". It used to render as two jammed lines,
// "Petrify target10" and "Petrify target2".
test("Mark of Anathema: a crowd-control chance and duration compose one line", () => {
  expect(
    ccRender([
      { stat: "offensivePetrifyChance", value: 10 },
      { stat: "offensivePetrifyMin", value: 2 },
    ]),
  ).toEqual(["10% Chance to Petrify target for 2 Seconds"]);
});

// Deathbound Amethyst's Drain Essence block, the same shape at a fractional duration.
test("a fractional crowd-control duration keeps its precision", () => {
  expect(
    ccRender([
      { stat: "offensiveFreezeChance", value: 8 },
      { stat: "offensiveFreezeMin", value: 0.8 },
    ]),
  ).toEqual(["8% Chance to Freeze target for 0.8 Seconds"]);
});

// Witch Moon's Rune of Hagarrad block: a duration with no chance beside it is still a
// duration, not a magnitude jammed onto the label ("Freeze target1").
test("a crowd-control duration with no chance sibling still reads as a duration", () => {
  expect(ccRender([{ stat: "offensiveFreezeMin", value: 1 }])).toEqual(["Freeze target for 1 Seconds"]);
});

// A Min/Max pair on a clause tag fills the range variant of the same clause. No block carries
// one today (offensiveStunMax is in the catalog, unused), so this pins the shape before data
// arrives rather than after.
test("a crowd-control Min/Max pair composes the range duration clause", () => {
  expect(
    ccRender([
      { stat: "offensiveStunMax", value: 2 },
      { stat: "offensiveStunMin", value: 1 },
    ]),
  ).toEqual(["Stun target for 1 - 2 Seconds"]);
});

// The mirror case: a chance with no duration beside it. The clause reads correctly with an
// empty slot, so it keeps its line rather than printing "Immobilize target15".
test("a crowd-control chance with no duration sibling renders the clause with no duration", () => {
  expect(ccRender([{ stat: "offensiveTrapChance", value: 15 }])).toEqual(["15% Chance to Immobilize target"]);
});

// Uroboruuk's Visage, Spectral Binding block: retaliationFearMin 0.8. The retaliation half of
// the crowd-control family does NOT take the "for N Seconds" clause - its label already carries
// the preposition - so its slot holds a bare quantity. It used to render "1 of Terrify
// Retaliation": rounded, and with the unit gone.
test("a retaliation duration slot takes a bare quantity, not the for-N-Seconds clause", () => {
  expect(ccRender([{ stat: "retaliationFearMin", value: 0.8 }])).toEqual(["0.8 Seconds of Terrify Retaliation"]);
});

// I2. Dawnshard Grip, Pneumatic Burst block: offensiveElementalChance 10 shares DamageElemental
// with offensiveElementalMin 100, and printed itself as "10 Elemental Damage" directly above
// the real "100 Elemental Damage".
test("Dawnshard Grip: a chance sharing a damage tag folds in rather than printing as damage", () => {
  expect(
    ccRender([
      { stat: "offensiveElementalChance", value: 10 },
      { stat: "offensiveElementalMin", value: 100 },
    ]),
  ).toEqual(["10% Chance of 100 Elemental Damage"]);
});

// I1. Horns of Ekket'Zul, Blitz block: skillCooldownReduction 100 and
// skillCooldownReductionChance 20 share one tag and rendered as two contradictory lines.
test("Horns of Ekket'Zul: a cooldown-reduction chance and its value are one line", () => {
  expect(
    cardRender([
      { stat: "skillCooldownReduction", value: 100 },
      { stat: "skillCooldownReductionChance", value: 20 },
    ]),
  ).toEqual(["20% Chance of +100% Skill Cooldown Reduction"]);
});

// C3 and the chance rule together, on the real Bloodlord's Blade Possession block: the
// chance belongs to the carrier it was entered on (the 100), not to the flat 5 beside it.
test("Bloodlord's Blade: the chance attaches to its own carrier, not to the second value", () => {
  expect(
    cardRender([
      { stat: "skillCooldownReduction", value: 100 },
      { stat: "skillCooldownReductionChance", value: 12 },
      { stat: "skillCooldownReduction", value: 5 },
    ]),
  ).toEqual(["12% Chance of +100% Skill Cooldown Reduction", "+5% Skill Cooldown Reduction"]);
});

// The four genuinely independent chances (defensiveBlockChance, offensivePhysicalChance,
// projectilePiercingChance, sparkChance) carry their own tag, so the rule must not touch them.
test("a chance stat with its own tag keeps rendering as its own line", () => {
  expect(cardRender([{ stat: "defensiveBlockChance", value: 15 }])).toEqual(["15% Chance to Block"]);
});

// --- The hand-authored NON_DISPLAY table's two wrong calls (2026-08-18) ------------------
// scripts/build_stat_item_tags.py declares which stat ids the game never labels. Two entries
// were guesses that the game contradicts, and each silently cost a real line on every item
// carrying it. These render the block straight out of the committed dataset, so they fail
// again if either the stat stops reaching the page or its label stops resolving.
const realCtx = {
  tagOf: (s: string) => (statItemTags as Record<string, string>)[s],
  templateOf: (t: string) => (gameEn as Record<string, string>)[t],
  nameOf: () => undefined,
};
const realGame = gameEn as Record<string, string>;
const realLoc = makeLocalization(APP, APP, "en", realGame, realGame);
function realBlock(item: string, skill: string): { stat: string; value: number }[] {
  const it = ((catalogueDoc as any).items as any[]).find((i) => i.record === item);
  if (!it) throw new Error(`no such item in the dataset: ${item}`);
  const block = it.modifiers.find((m: any) => m.skill === skill);
  if (!block) throw new Error(`${item} has no modifier block for ${skill}`);
  return block.stats;
}
const realRender = (stats: any[]) => effectLines(stats, realCtx).map((l) => resolveText(realLoc, l.text));

// projectilePiercing was called a "pass-through enable flag" and dropped. It is the percentage
// itself: the skill_modifier template spells the stat projectilePiercingChance carries on a
// skill record. grimtools' card for this item reads "70% Chance to pass through Enemies".
test("Eldritch Storm Emitter: the Storm Spread block keeps its pass-through chance", () => {
  const lines = realRender(
    realBlock("records/items/gearweapons/guns1h/b301f_gun1h.dbr", "records/skills/playerclass07/wpattack03.dbr"),
  );
  expect(lines).toContain("70% Chance to pass through Enemies");
});

// waveDistance was called "wave geometry, never displayed". grimtools' card for this item
// reads "2 Meter Range" between the recharge and the leech line.
test("Ghol's Reach: a wave modifier's reach reads as a range in meters", () => {
  const lines = realRender(
    realBlock("records/items/gearhands/d207_hands.dbr", "records/skills/playerclass08/soulscythe1.dbr"),
  );
  expect(lines).toContain("2 Meter Range");
});

// --- damage-type colouring --------------------------------------------------
// A line is coloured from its TAG, never from its words. The guard: every tag the real dataset
// reaches whose name carries a damage token must be either classified or explicitly declared not
// a damage line. A game patch adding a new one fails here rather than shipping an uncoloured (or
// wrongly coloured) line, the same "declare it or fail" rule build_stat_item_tags.py applies.
test("every damage-token tag in the dataset is classified or declared", () => {
  const tags = statItemTags as Record<string, string>;
  const unclassified = [...new Set(Object.values(tags))]
    .filter((t) => namesADamageToken(t) && !damageTypeOfTag(t) && !DECLARED_NOT_DAMAGE.has(t))
    .sort();
  expect(unclassified).toEqual([]);
});

// The whole point of anchoring on the tag: these three lines never contain their damage type's
// name in any language, so nothing that reads the rendered words could colour them.
test("a damage-over-time line is coloured by its type even though the type is not in the text", () => {
  const game = gameEn as Record<string, string>;
  expect(game.DamageDurationFire).toBe("Burn Damage");
  expect(damageTypeOfTag("DamageDurationFire")).toBe("fire");
  expect(game.DamageDurationCold).toBe("Frostburn Damage");
  expect(damageTypeOfTag("DamageDurationCold")).toBe("cold");
  expect(game.DamageDurationLightning).toBe("Electrocute Damage");
  expect(damageTypeOfTag("DamageDurationLightning")).toBe("lightning");
});

// GD's `Life` means health far more often than it means the Vitality damage type, and painting
// a healing line purple would misread the number outright.
test("health, regeneration and leech lines carry no damage colour", () => {
  for (const tag of ["SkillLifePercent", "tagCharLifeRegen", "DamageLifeLeech", "DamagePercentCurrentLife"]) {
    expect(damageTypeOfTag(tag)).toBeNull();
  }
  expect(damageTypeOfTag("DamageLife")).toBe("vitality");
});

// ProjectilePiercingChance is about projectiles passing through enemies, not pierce damage.
test("the pass-through chance is not a pierce line", () => {
  expect(damageTypeOfTag("ProjectilePiercingChance")).toBeNull();
  expect(damageTypeOfTag("DamagePierce")).toBe("pierce");
});

// A conversion names two types, so the LINE takes no colour and each name carries its own. The
// marks sit on the substituted arguments, which is what makes this safe in every locale.
test("a conversion line reports no type of its own and marks both names", () => {
  const [line] = effectLines(
    [{ stat: "conversionPercentage", value: 100, from_tag: "tagCharStatsCold", to_tag: "tagCharStatsFire" }],
    realCtx,
  );
  expect(line!.damage).toBeNull();
  const marks: string[] = [];
  const walk = (t: Text): void => {
    if (t.k === "marked") {
      marks.push(t.mark);
      walk(t.inner);
    } else if (t.k === "join") t.parts.forEach(walk);
    else if (t.k === "gameFormat") {
      for (const a of t.args) if (typeof a === "object" && !Array.isArray(a)) walk(a);
    }
  };
  walk(line!.text);
  expect(marks).toEqual(["cold", "fire"]);
});
