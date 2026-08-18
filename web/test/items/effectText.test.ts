// ABOUTME: Tests for effectLines: single-stat rendering and min/max range collapse.
// ABOUTME: Unknown stats are dropped, not rendered raw.
import { test, expect } from "bun:test";
import { makeLocalization, resolveText } from "../../src/core/localization";
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
