// ABOUTME: Tests for effectLines: single-stat rendering, min/max range collapse,
// ABOUTME: damage-over-time/debuff duration composition, refresh, and conversion lines.
import { test, expect } from "bun:test";
import { litT, makeLocalization, resolveText } from "../../src/core/localization";
import { effectLines } from "../../src/items/core/effectText";

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
  DamageSingleFormatTime: "over {%.1f0} Seconds",
  DamageFixedSingleFormatTime: "for {%.1f0} Seconds",
  tagDamageConversion: "{%.0f0}% {%s1} converted to {%s2}",
  tagCharStatsVitality: "Vitality",
  tagCharStatsFire: "Fire",
  tagSkillCooldownRefreshName: "{%t0} to reduce cooldown of {%s1} by {%.1f2} {%z3}",
  tagSkillCooldownRefresh: "{%t0} to reduce cooldown by {%.1f1} {%z2}",
  tagRefreshSkillCondition07: "{%d0}% Chance on Attack",
  tagSecond: "Second",
  tagSeconds: "Seconds",
};
const CARD_TAGS: Record<string, string> = {
  ...TAGS,
  offensiveSlowBleedingMin: "DamageDurationBleeding",
  offensiveSlowBleedingDurationMin: "DamageDurationBleeding",
  offensiveSlowPoisonMin: "DamageDurationPoison",
  offensiveSlowPoisonDurationMin: "DamageDurationPoison",
  offensiveSlowLightningMin: "DamageDurationLightning",
  offensiveSlowLightningDurationMin: "DamageDurationLightning",
  offensiveSlowTotalSpeedMin: "DamageDurationTotalSpeed",
  offensiveSlowTotalSpeedDurationMin: "DamageDurationTotalSpeed",
  offensiveSlowDefensiveAbilityMin: "DamageDurationDefensiveAbility",
  offensiveSlowDefensiveAbilityDurationMin: "DamageDurationDefensiveAbility",
  conversionPercentage: "tagDamageConversion",
  conversionPercentage2: "tagDamageConversion",
  refreshCooldownAmount: "tagSkillCooldownRefresh",
  refreshCooldownChance: "tagSkillCooldownRefresh",
};
const SKILL_NAMES: Record<string, string> = {
  "records/skills/playerclass10/leap1.dbr": "Leap",
};
const cardCtx = {
  tagOf: (s: string) => CARD_TAGS[s],
  templateOf: (t: string) => CARD_GAME[t],
  nameOf: (r: string) => (SKILL_NAMES[r] ? litT(SKILL_NAMES[r]) : undefined),
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
