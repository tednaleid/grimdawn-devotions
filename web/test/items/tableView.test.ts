// ABOUTME: Regression tests for rowEffectLines (per-block effectLines calls concatenated as lines,
// ABOUTME: never as stats - fix round 1, C1) and for bodyMarkup's Skills column pick buttons.
import { test, expect } from "bun:test";
import { litT, makeLocalization, resolveText } from "../../src/core/localization";
import { bodyMarkup } from "../../src/items/adapters/tableView";
import { rowEffectLines, type EffectContext } from "../../src/items/core/effectText";
import type { Row } from "../../src/items/core/filter";
import type { Item } from "../../src/items/core/model";
import { DEFAULT_VIEW, type ViewState } from "../../src/items/core/urlState";
import type { Localization } from "../../src/ports/Localization";
import appEn from "../../src/i18n/app.en.json";

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
  rowEffectLines(blocks, ctx).map((l) => resolveText(loc, l.text));

// The Skills column resolves its names through the same EffectContext.nameOf the effect lines
// use, so this ctx is the row-rendering one with two named skills in it.
const SKILL_NAMES: Record<string, string> = { sk1: "Cadence", sk2: "Blitz" };
const namedCtx: EffectContext = { ...ctx, nameOf: (r) => (SKILL_NAMES[r] ? litT(SKILL_NAMES[r]!) : undefined) };

const ITEM: Item = {
  record: "records/items/x.dbr",
  nameTag: null,
  domain: "gear",
  slots: ["head"],
  gearType: "head",
  rarity: "epic",
  itemLevel: 70,
  tiers: [],
  grimtools: null,
  boosts: [],
  masteryBoosts: [],
  modifiers: [],
  set: null,
};
const row = (skills: string[]): Row => ({ item: ITEM, levels: 1, modBlocks: [], skills, set: null });

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

// The Skills column is the row's answer to "why is this here", and its names are the page's
// second skill picker: each is a button carrying the same data-record the tree node does, so
// hovering shows that skill's card and clicking toggles it. Plain text (the pre-change markup)
// can do neither.
test("every skill in the Skills column is a pick button naming its record", () => {
  const view: ViewState = { ...DEFAULT_VIEW, mastery: "m1", skills: new Set(["sk1"]) };
  const html = bodyMarkup(loc, [row(["sk1", "sk2"])], namedCtx, view);
  expect(html).toContain(
    '<button type="button" class="skill-pick" data-record="sk1" aria-pressed="true">Cadence</button>',
  );
  expect(html).toContain(
    '<button type="button" class="skill-pick" data-record="sk2" aria-pressed="false">Blitz</button>',
  );
});

// aria-pressed is the only thing that says which of the listed names are actually picked, and
// the column is where a reader with no matching tree node sees the selection at all.
test("an unpicked mastery-wide scope renders every name unpressed", () => {
  const view: ViewState = { ...DEFAULT_VIEW, mastery: "m1" };
  const html = bodyMarkup(loc, [row(["sk1", "sk2"])], namedCtx, view);
  expect(html).not.toContain('aria-pressed="true"');
  expect((html.match(/class="skill-pick"/g) ?? []).length).toBe(2);
});

// A skill the game never named falls back to its raw record, matching nameOf's convention
// elsewhere in the file - it must still be pickable, not rendered as bare text.
test("a nameless skill still renders as a pick button, labelled by its record", () => {
  const html = bodyMarkup(loc, [row(["sk9"])], namedCtx, { ...DEFAULT_VIEW, mastery: "m1" });
  expect(html).toContain('data-record="sk9" aria-pressed="false">sk9</button>');
});

// An item in scope for its level grants alone touches no named skill line, and an em dash is not
// something to click.
test("a row matching no named skill renders no pick button", () => {
  const html = bodyMarkup(loc, [row([])], namedCtx, { ...DEFAULT_VIEW, mastery: "m1" });
  expect(html).not.toContain("skill-pick");
});

// A row can be in the table because of its SET rather than because of anything the item itself
// does, and the Effect column has nothing to say in that case. The badge on the skill name is the
// only thing that explains the row without expanding it, so it has to be exactly on the names the
// set is responsible for.
// The real app catalog, so the badge test also proves items.set.badge exists rather than
// asserting the raw key a fixture-empty catalog would echo back.
const APP = appEn as Record<string, string>;
const appLoc: Localization = makeLocalization(APP, APP, "en", GAME, GAME);

const SET = {
  record: "sets/ultos",
  nameTag: "tagUltos",
  members: 5,
  modifiers: [],
  boosts: [],
  masteryBoosts: [],
} as never;
const setRow = (skills: string[], fromSet: string[]): Row => ({
  item: ITEM,
  levels: 0,
  modBlocks: [],
  skills,
  set: { set: SET, modBlocks: [], boosts: [], skills: fromSet },
});

test("a skill reached only through the set is badged, and one the item touches itself is not", () => {
  const html = bodyMarkup(appLoc, [setRow(["sk1", "sk2"], ["sk2"])], namedCtx, { ...DEFAULT_VIEW, mastery: "m1" });
  const cadence = html.slice(html.indexOf("Cadence"), html.indexOf("Blitz"));
  expect(cadence).not.toContain("set-badge");
  expect(html.slice(html.indexOf("Blitz"))).toContain('<span class="set-badge">Set</span>');
});

test("a row with no set carries no badge at all", () => {
  const html = bodyMarkup(appLoc, [row(["sk1", "sk2"])], namedCtx, { ...DEFAULT_VIEW, mastery: "m1" });
  expect(html).not.toContain("set-badge");
});
