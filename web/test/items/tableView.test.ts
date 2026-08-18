// ABOUTME: Regression tests for rowEffectLines: per-block effectLines calls concatenated as
// ABOUTME: lines, never as stats (fix round 1, C1 - see task-12-13-fix-1.md for the Krieg's Mask case).
import { test, expect } from "bun:test";
import { makeLocalization, resolveText } from "../../src/core/localization";
import { rowEffectLines, type EffectContext } from "../../src/items/core/effectText";
import type { Localization } from "../../src/ports/Localization";

// Real tags/templates for the two stat families in play (data/stat-item-tags.json,
// data/i18n/game.en.json), matching effectText.test.ts's fixture shape.
const GAME: Record<string, string> = {
  DamageAether: "{%t0} Aether Damage",
  CooldownTime: "Skill Recharge",
  SkillSecondFormat: "{%.1f0 Second %s1}",
};
const TAGS: Record<string, string> = {
  offensiveAetherMin: "DamageAether",
  offensiveAetherMax: "DamageAether",
  skillCooldownTime: "CooldownTime",
};
const ctx: EffectContext = {
  tagOf: (s) => TAGS[s],
  templateOf: (t) => GAME[t],
  nameOf: () => undefined,
};
const loc: Localization = makeLocalization({}, {}, "en", GAME, GAME);
const render = (blocks: { stat: string; value: number }[][]) =>
  rowEffectLines(blocks, ctx).map((t) => resolveText(loc, t));

// Krieg's Mask under Soldier scope (records/items/gearhead/d112_head.dbr): Blitz's block
// carries a flat offensiveAetherMin with no Max sibling; War Cry's block carries a real
// Min/Max pair on the SAME stat id. Flattening both blocks into one effectLines call (the
// pre-fix behavior) lets Blitz's 140 pair with War Cry's 300 into a fabricated "140-300"
// range that belongs to neither skill, and silently drops War Cry's own cooldown line
// (its stat id collides with Blitz's and loses the shared `used` race).
test("Krieg's Mask shape: a flat Min in one block and a Min/Max pair in another never cross-pollinate", () => {
  const blitz = [
    { stat: "offensiveAetherMin", value: 140 },
    { stat: "skillCooldownTime", value: -0.4 },
  ];
  const warCry = [
    { stat: "offensiveAetherMax", value: 300 },
    { stat: "offensiveAetherMin", value: 180 },
    { stat: "skillCooldownTime", value: -1 },
  ];
  expect(render([blitz, warCry])).toEqual([
    "140 Aether Damage",
    "-0.4 Second Skill Recharge",
    "180-300 Aether Damage",
    "-1 Second Skill Recharge",
  ]);
});

// A base skill and its transmuter sometimes carry the literally identical modifier block
// (same stats, same values - e.g. Blackwater's conversion block on both blackwater1 and
// blackwater1b). Per-block effectLines calls must not turn that into two identical lines;
// only genuinely repeated (structurally identical) lines collapse, never lines that merely
// resolve to the same string by coincidence.
test("two blocks carrying the identical modifier collapse to one line, not two", () => {
  const sharedBlock = [{ stat: "skillCooldownTime", value: -0.4 }];
  expect(render([sharedBlock, sharedBlock])).toEqual(["-0.4 Second Skill Recharge"]);
});
