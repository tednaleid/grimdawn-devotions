// ABOUTME: Tests the tree's hover card against the real catalogue: the values it reads, the rank
// ABOUTME: it reads them at, and the label-less lines it suppresses.
import { test, expect } from "bun:test";
import { gameT, makeLocalization, resolveText } from "../../src/core/localization";
import type { Localization } from "../../src/ports/Localization";
import { rankStats, skillCardMarkup, ultimateDiffers } from "../../src/items/adapters/skillCard";
import type { EffectContext } from "../../src/items/core/effectText";
import { parseCatalogue } from "../../src/items/core/model";
import doc from "../../../data/skill-items.json";
import statItemTags from "../../../data/stat-item-tags.json";
import gameEn from "../../../data/i18n/game.en.json";
import gameJa from "../../../data/i18n/game.ja.json";
import appEn from "../../src/i18n/app.en.json";

const catalogue = parseCatalogue(doc);
const tags = statItemTags as Record<string, string>;
const byRecord = new Map(catalogue.skills.map((s) => [s.record, s]));

function contextFor(locale: string, game: Record<string, string>): { loc: Localization; ctx: EffectContext } {
  const loc = makeLocalization(appEn, appEn, locale, game, gameEn);
  return {
    loc,
    ctx: {
      tagOf: (s) => tags[s],
      templateOf: (t) => {
        const text = loc.gameText(t);
        return text === t ? undefined : text;
      },
      nameOf: (r) => {
        const s = byRecord.get(r);
        return s?.nameTag ? gameT(s.nameTag) : undefined;
      },
    },
  };
}

const en = contextFor("en", gameEn);
const skill = (frag: string) => catalogue.skills.find((s) => s.record.includes(frag))!;
const lines = (html: string) => [...html.matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1]!);

// The oracle. Grimtools' own Summon Hellhound tooltip (the game's card) reads "150 Energy Cost",
// "18 Second Skill Recharge", "+1 Summon" and "1 Summon Limit" at rank 1. Our card reads the same
// stats at max rank, where the cost has scaled to 225 and the recharge has not moved - which is
// the whole point of showing it: an item's "-1 Second Skill Recharge" is judged against the 18.
test("Summon Hellhound's card reads the game's own card, at max rank", () => {
  const hellhound = skill("hellhound");
  const html = skillCardMarkup(hellhound, en.loc, en.ctx);
  expect(html).toContain("<h4>Summon Hellhound</h4>");
  expect(html).toContain("At rank 16");
  const ls = lines(html);
  expect(ls).toContain("18 Second Skill Recharge");
  expect(ls).toContain("225 Energy Cost");
  expect(ls).toContain("1 Summon Limit");
  // Ultimate rank is where item-granted ranks land, and only the cost moves.
  expect(html).toContain("At rank 26 (item-granted)");
  expect(ls).toContain("275 Energy Cost");
});

test("rankStats reads the requested rank, not whichever column is first", () => {
  const hellhound = skill("hellhound");
  const cost = (at: "max" | "ultimate") =>
    rankStats(hellhound.ranks, at).find((s) => s.stat === "skillManaCost")!.value;
  expect(cost("max")).toBe(225);
  expect(cost("ultimate")).toBe(275);
});

test("a skill whose ranks all read the same shows one block, not two identical ones", () => {
  const flat = catalogue.skills.find((s) => !ultimateDiffers(s.ranks) && s.ranks.length > 0);
  if (!flat) throw new Error("no skill with identical max/ultimate ranks: fixture assumption broken");
  const html = skillCardMarkup(flat, en.loc, en.ctx);
  expect(html).not.toContain("item-granted");
});

// skillChargeLevel's game template is the bare "{%d0}%", so Cadence's card would carry a "2%"
// line that names nothing. Six lines across the whole catalogue are this shape.
test("a value whose label the game never supplies is dropped, not shown bare", () => {
  const cadence = skill("cadence1.dbr");
  const ls = lines(skillCardMarkup(cadence, en.loc, en.ctx));
  expect(ls).not.toContain("2%");
  expect(ls.every((l) => /\p{L}/u.test(l))).toBe(true);
  // The rest of the card is intact: dropping the bare line must not drop its neighbours.
  expect(ls).toContain("4 Energy Cost");
  expect(ls).toContain("430% Weapon Damage");
});

// The suppression tests for a letter in ANY script. An [A-Za-z] test would pass every assertion
// above and silently empty every card in Japanese, Chinese, Korean and Russian.
test("Japanese cards keep their lines: the label check is not ASCII-only", () => {
  const ja = contextFor("ja", gameJa as Record<string, string>);
  const hellhound = skill("hellhound");
  const ls = lines(skillCardMarkup(hellhound, ja.loc, ja.ctx));
  expect(ls.length).toBeGreaterThanOrEqual(4);
  expect(ls.some((l) => /[぀-ヿ一-鿿]/.test(l))).toBe(true);
});

test("every skill in the catalogue renders a card with a name and no empty list", () => {
  for (const s of catalogue.skills) {
    const html = skillCardMarkup(s, en.loc, en.ctx);
    expect(html).toStartWith("<h4>");
    expect(html).not.toContain("<ul></ul>");
    for (const line of lines(html)) expect(resolveText(en.loc, { k: "lit", s: line })).not.toBe("");
  }
});

// Manifestation is the case that motivated carrying the description: every one of its rank stats
// is an engine internal the tag table does not name, so before this its card was a bare heading.
test("a skill with no renderable stat line still has its own prose", () => {
  const manifestation = skill("elementalinfusion1b.dbr");
  const html = skillCardMarkup(manifestation, en.loc, en.ctx);
  expect(html).toContain("<h4>Manifestation</h4>");
  expect(html).toContain("skill-card-desc");
  expect(html).toContain("Arcane energies manifest in many forms");
});

test("no skill renders a card that is only a heading", () => {
  const bare = catalogue.skills.filter((s) => {
    const html = skillCardMarkup(s, en.loc, en.ctx);
    return !html.includes("<li>") && !html.includes("skill-card-desc");
  });
  expect(bare.map((s) => s.record)).toEqual([]);
});

test("an unresolved description tag is dropped rather than printed as its own tag name", () => {
  // gameText falls back to the tag string for an unknown tag, which would put
  // "tagClass05SkillDescription02D" on the card as if it were prose.
  const ghost = { ...skill("cadence1.dbr"), descriptionTag: "tagNoSuchDescription" };
  const html = skillCardMarkup(ghost, en.loc, en.ctx);
  expect(html).not.toContain("tagNoSuchDescription");
  expect(html).not.toContain("skill-card-desc");
});
