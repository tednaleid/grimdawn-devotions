// ABOUTME: Reads every rendered effect line in the shipped dataset, in all 13 locales - every
// ABOUTME: modifier block and every pet panel - and fails on the shapes that mean a value was lost.
import { test, expect } from "bun:test";
import { gameT, makeLocalization, resolveText } from "../../src/core/localization";
import type { Localization } from "../../src/ports/Localization";
import { detailMarkup, type DetailContext } from "../../src/items/adapters/detailView";
import { effectLines } from "../../src/items/core/effectText";
import { skillCardMarkup } from "../../src/items/adapters/skillCard";
import { parseCatalogue, type Item } from "../../src/items/core/model";
import doc from "../../../data/skill-items.json";
import statItemTags from "../../../data/stat-item-tags.json";
import gameEn from "../../../data/i18n/game.en.json";
import gameCs from "../../../data/i18n/game.cs.json";
import gameDe from "../../../data/i18n/game.de.json";
import gameEs from "../../../data/i18n/game.es.json";
import gameFr from "../../../data/i18n/game.fr.json";
import gameIt from "../../../data/i18n/game.it.json";
import gameJa from "../../../data/i18n/game.ja.json";
import gameKo from "../../../data/i18n/game.ko.json";
import gamePl from "../../../data/i18n/game.pl.json";
import gamePt from "../../../data/i18n/game.pt.json";
import gameRu from "../../../data/i18n/game.ru.json";
import gameVi from "../../../data/i18n/game.vi.json";
import gameZh from "../../../data/i18n/game.zh.json";
import appEn from "../../src/i18n/app.en.json";
import appCs from "../../src/i18n/app.cs.json";
import appDe from "../../src/i18n/app.de.json";
import appEs from "../../src/i18n/app.es.json";
import appFr from "../../src/i18n/app.fr.json";
import appIt from "../../src/i18n/app.it.json";
import appJa from "../../src/i18n/app.ja.json";
import appKo from "../../src/i18n/app.ko.json";
import appPl from "../../src/i18n/app.pl.json";
import appPt from "../../src/i18n/app.pt.json";
import appRu from "../../src/i18n/app.ru.json";
import appVi from "../../src/i18n/app.vi.json";
import appZh from "../../src/i18n/app.zh.json";

// The whole real path: the committed catalogue, the committed stat -> tag map, the committed
// game text, and the app catalog. Nothing synthetic. Every other test in this directory asserts
// a handful of lines it chose; this one reads all of them, in every language the page serves.
//
// It exists because nothing else in the suite ever looked at a rendered line against the real
// data, which is why "Petrify target10", "+1% Attack Speed" for a x0.79 multiplier and "10
// Elemental Damage" above "100 Elemental Damage" all shipped green.
//
// WHAT IT CANNOT SEE, stated plainly so nobody over-trusts it:
//   * WRONG ARITHMETIC. Flip effectText.ts's `isDamage` to false and the whole damage-over-time
//     family prints per-second values instead of totals - hundreds of wrong numbers - and every
//     shape check below still passes, because every one of those lines is well formed. The only
//     arithmetic this file pins is the three oracle cards at the bottom. A new composition rule
//     needs a new oracle of its own; it does not inherit coverage from this sweep.
//   * A WRONG LABEL. A stat mapped to the wrong game tag renders a perfectly well-formed line.
//   * A MISSING LINE, beyond the crude count floors below. A stat silently dropped by a new
//     branch leaves no trace in the lines that remain.
// It is a shape check: it catches a line that has visibly lost or mangled a value. Pair it with
// the per-card oracle tests, never instead of them.
const catalogue = parseCatalogue(doc);
const tags = statItemTags as Record<string, string>;
const skillByRecord = new Map(catalogue.skills.map((s) => [s.record, s]));

const GAME: Record<string, Record<string, string>> = {
  en: gameEn,
  cs: gameCs,
  de: gameDe,
  es: gameEs,
  fr: gameFr,
  it: gameIt,
  ja: gameJa,
  ko: gameKo,
  pl: gamePl,
  pt: gamePt,
  ru: gameRu,
  vi: gameVi,
  zh: gameZh,
};
const APP: Record<string, Record<string, string>> = {
  en: appEn,
  cs: appCs,
  de: appDe,
  es: appEs,
  fr: appFr,
  it: appIt,
  ja: appJa,
  ko: appKo,
  pl: appPl,
  pt: appPt,
  ru: appRu,
  vi: appVi,
  zh: appZh,
};
const LOCALES = Object.keys(GAME);

// Same wiring as web/src/items/app/main.ts: the locale's game table over English, the locale's
// app catalog over English, and templateOf restoring the "undefined for an unknown tag" contract
// that gameText's tag-name fallback would otherwise hide. Rendering through anything simpler
// would not be the page's own text.
function contextFor(locale: string): DetailContext {
  const loc: Localization = makeLocalization(APP[locale]!, appEn, locale, GAME[locale]!, gameEn);
  return {
    tagOf: (s) => tags[s],
    templateOf: (t) => {
      const text = loc.gameText(t);
      return text === t ? undefined : text;
    },
    nameOf: (r) => {
      const s = skillByRecord.get(r);
      return s?.nameTag ? gameT(s.nameTag) : undefined;
    },
    masteryNameOf: () => undefined,
    skillOf: (r) => skillByRecord.get(r),
    setOf: () => undefined,
    loc,
  };
}

function unescapeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

// Every line the page can put in front of a reader, each tagged with where it came from so a
// failure names the block rather than just the string.
function allRenderedLines(ctx: DetailContext): { where: string; line: string; source: "mod" | "pet" | "card" }[] {
  const out: { where: string; line: string; source: "mod" | "pet" | "card" }[] = [];
  for (const item of catalogue.items) {
    for (const block of item.modifiers) {
      for (const l of effectLines(block.stats, ctx)) {
        out.push({ where: `${item.record} / ${block.skill}`, line: resolveText(ctx.loc, l.text), source: "mod" });
      }
    }
  }
  // Pet panels go through detailMarkup, not effectLines directly: the pet path has its own
  // value mapping (PetStat.max, and the multiplier stats) that a raw effectLines call would
  // skip - exactly the layer C1's wrong numbers lived in.
  for (const skill of catalogue.skills) {
    if (!skill.pets.length) continue;
    const probe: Item = {
      record: "sweep-probe",
      nameTag: null,
      domain: "gear",
      slots: [],
      gearType: "head",
      rarity: "Legendary",
      itemLevel: 1,
      tiers: [],
      grimtools: null,
      boosts: [{ skill: skill.record, level: 1 }],
      masteryBoosts: [],
      modifiers: [],
      set: null,
    };
    const html = detailMarkup(probe, ctx);
    // The panel's own <li>s only: the probe's "+1 to <skill>" grant is the first line of the
    // section, outside the <details>. Fail loudly if that marker ever moves - a silent -1 here
    // slices from the END of the string, drops all 654 pet lines out of the sweep, and leaves
    // most of the assertions below passing on the modifier blocks alone.
    const at = html.indexOf("<details");
    if (at < 0) throw new Error(`pet panel markup changed: no <details> in ${skill.record}'s detail`);
    for (const m of html.slice(at).matchAll(/<li>(.*?)<\/li>/g)) {
      out.push({ where: `${skill.record} (pet panel)`, line: unescapeHtml(m[1]!), source: "pet" });
    }
  }
  // The tree's hover card. It runs the same rank rows through effectLines that the item blocks
  // use, but at a different arity (a whole skill's stats at once, not one modifier block), so it
  // composes pairs the item path never puts side by side. Swept for the same shapes.
  for (const skill of catalogue.skills) {
    const html = skillCardMarkup(skill, ctx.loc, ctx);
    for (const m of html.matchAll(/<li>(.*?)<\/li>/g)) {
      out.push({ where: `${skill.record} (hover card)`, line: unescapeHtml(m[1]!), source: "card" });
    }
  }
  return out;
}

const BY_LOCALE = new Map(LOCALES.map((l) => [l, allRenderedLines(contextFor(l))]));
const LINES = BY_LOCALE.get("en")!;

// One documented exemption, and it is the game's own text rather than anything composed here:
// Portuguese ships BeamAngle as "Feixe com arco de {%.1f0}graus", with no space before the unit,
// so that line reads "25graus" in pt and "25 Degree Beam Arc" everywhere else. Same category as
// the game's own "for 1 Seconds" plural. Scoped to the locale and to that one wording, so a real
// jam in Portuguese still fails.
const GAME_TEXT_DEFECT: Record<string, RegExp> = { pt: /^Feixe com arco de [\d.]+graus$/ };

// The shape checks, run against every locale. English alone would not do: the CLAUSE_SLOT /
// QUANTITY_SLOT split in effectText.ts exists precisely BECAUSE a template-shape rule
// misclassifies the retaliation tags in Italian and Vietnamese, where they end in {%t0} exactly
// as the crowd-control tags do. A rule pinned per tag is either right in all 13 locales or wrong
// in some, and only a 13-locale sweep can tell which: the failure mode is a doubled preposition,
// which an English run would never show.
const SHAPE_CHECKS: { name: string; bad: (line: string) => boolean }[] = [
  // "Petrify target10": a value substituted where the template wanted a nested clause, so the
  // number is jammed onto the last word of the label.
  { name: "jams a value onto the end of a word", bad: (l) => /[a-z]\d/.test(l) },
  // The same fault with the operands swapped: "213-265Electrocute Damage", which is what a lost
  // separator between a value and its label looks like.
  { name: "jams a word onto the end of a value", bad: (l) => /\d[A-Za-z]/.test(l) },
  // The format layer handed a number-shaped argument something that is not a number.
  { name: "contains NaN", bad: (l) => l.includes("NaN") },
  // A brace survives only when a template's placeholder was never substituted, or an app catalog
  // key was resolved with the wrong parameter names.
  { name: "leaks an unsubstituted template", bad: (l) => /[{}]/.test(l) },
  // A line that renders to nothing is a line whose value and label both vanished; the renderer
  // must drop it instead, so the reader never sees an empty bullet.
  { name: "is empty", bad: (l) => l.trim() === "" },
  // "+16% Damage to": a template argument the payload does not carry was dropped, leaving the
  // literal text around it standing.
  { name: "ends in a dangling preposition", bad: (l) => /\b(to|of|by|for)\s*$/.test(l) },
];

for (const locale of LOCALES) {
  const lines = BY_LOCALE.get(locale)!;
  const exempt = GAME_TEXT_DEFECT[locale];
  for (const { name, bad } of SHAPE_CHECKS) {
    test(`${locale}: no rendered line ${name}`, () => {
      const offenders = [
        ...new Set(lines.filter((l) => bad(l.line) && !exempt?.test(l.line)).map((l) => `${l.line}   <- ${l.where}`)),
      ];
      expect(offenders.slice(0, 10)).toEqual([]);
    });
  }

  // Floors, not targets, and deliberately close to the real counts: every shape assertion above
  // passes vacuously on a dataset rendered into nothing, and a loose floor is no floor at all.
  // 4,358 modifier-block lines and 654 pet-panel lines ship today; conversion lines alone are 795
  // of the former, so a floor with more slack than that would not notice every one of them
  // disappearing. A dataset rebuild that legitimately adds or removes content moves these.
  test(`${locale}: the sweep reads the whole dataset`, () => {
    expect(lines.filter((l) => l.source === "mod").length).toBeGreaterThanOrEqual(4300);
    expect(lines.filter((l) => l.source === "pet").length).toBeGreaterThanOrEqual(640);
    expect(lines.filter((l) => l.source === "card").length).toBeGreaterThanOrEqual(1800);
  });
}

// The shape of a stat rendered twice on one card because a chance, a duration or a second
// carrier's value was read as another magnitude: two lines under one label that differ only in
// their numbers. This is the shape of I1 ("+100%" and "+20% Skill Cooldown Reduction"), of I2
// ("10 Elemental Damage" above "100 Elemental Damage") and of C2 ("Petrify target10" above
// "Petrify target2"); none of those three is detectable from a single line in isolation.
//
// English only, unlike the shape checks: two DIFFERENT tags can translate to one wording in some
// locale, which is a translation quirk rather than a rendering fault.
//
// Modifier blocks only. A pet panel groups several abilities under one <details>, and two
// abilities genuinely can carry the same stat at the same value (the Skeletal Warrior's charge
// and innate attacks both add 20 Vitality Damage), so the same rule there would be a false alarm.
test("no modifier block renders two lines that differ only in their numbers", () => {
  const dupes: string[] = [];
  const byBlock = new Map<string, string[]>();
  for (const { where, line, source } of LINES) {
    if (source !== "mod") continue;
    byBlock.set(where, [...(byBlock.get(where) ?? []), line]);
  }
  for (const [where, lines] of byBlock) {
    const bySkeleton = new Map<string, string[]>();
    for (const line of lines) {
      const skeleton = line.replace(/[\d.]+/g, "#");
      bySkeleton.set(skeleton, [...(bySkeleton.get(skeleton) ?? []), line]);
    }
    for (const group of bySkeleton.values()) {
      if (group.length > 1) dupes.push(`${group.join(" | ")}   <- ${where}`);
    }
  }
  expect(dupes.slice(0, 10)).toEqual([]);
});

// --- The three cards the final fix round was measured against, read off the real dataset rather
// than a fixture. These are oracles: they pin the NUMBERS, which no shape check can, and they are
// the ONLY arithmetic this file verifies. See the header.
function linesFor(itemMatch: string, skillMatch: string): string[] {
  const ctx = contextFor("en");
  const item = catalogue.items.find((i) => i.record.endsWith(itemMatch))!;
  const block = item.modifiers.find((m) => m.skill.endsWith(skillMatch))!;
  return effectLines(block.stats, ctx).map((l) => resolveText(ctx.loc, l.text));
}

// C2's oracle. grimtools, Mythical Mark of Anathema, the Callidor's Tempest block:
// offensivePetrifyChance 10 + offensivePetrifyMin 2 read "10% Chance to Petrify target for
// 2 Seconds", one line, not the two jammed ones ("Petrify target10", "Petrify target2").
test("Mark of Anathema's Callidor's Tempest block matches its grimtools card", () => {
  expect(linesFor("upgraded/gearaccessories/medals/d010_medal.dbr", "razorwind1.dbr")).toEqual([
    "100% Lightning converted to Aether",
    "40 Aether Damage",
    "10% Chance to Petrify target for 2 Seconds",
  ]);
});

// C3. Stormrend's Werewolf block carries TWO complete refresh carriers, one targeting Primal
// Strike and one Stun Jacks. It rendered one line, naming the wrong target.
test("Stormrend's Werewolf block renders both refresh carriers, each with its own target", () => {
  expect(linesFor("gearweapons/axe1h/d205_axe.dbr", "werewolf1.dbr")).toEqual([
    "+10% Attack Speed",
    "100% Physical converted to Lightning",
    "100% Pierce converted to Lightning",
    "+150% Bleeding Damage",
    "+150% Electrocute Damage",
    "30% Chance on Critical Attack to reduce cooldown of Primal Strike by 2 Seconds",
    "30% Chance on Critical Attack to reduce cooldown of Stun Jacks by 2 Seconds",
  ]);
});

// C1. The Skeletal Warrior's own three speed stats are multipliers: x0.79, x1.35, x0.9. Every
// one of them read "+1%" before, with the sign wrong on two of the three.
test("the Skeletal Warrior pet panel reads its speed multipliers as multipliers", () => {
  const skill = catalogue.skills.find((s) => s.pets.some((p) => p.record.endsWith("skeleton_01.dbr")))!;
  const own = LINES.filter((l) => l.where === `${skill.record} (pet panel)`).map((l) => l.line);
  expect(own.slice(0, 3)).toEqual(["-21% Attack Speed", "+35% Movement Speed", "-10% Casting Speed"]);
});

// C2's other half, and the reason the locale loop above is worth its runtime. The retaliation
// tags are NOT the crowd-control clause: their slot takes a bare "N Seconds" quantity because
// the preposition is already in the label. Italian and Vietnamese are where a template-shape
// rule would have got that wrong - in those two the retaliation templates end in {%t0} exactly
// as the crowd-control ones do, so classifying by shape would push "for N Seconds" into a slot
// that already reads "per"/"trong" and double the preposition. That doubling is not a shape any
// of the checks above can see, so it is pinned here instead. Uroboruuk's Visage, Spectral
// Binding, retaliationFearMin 0.8.
test("the retaliation duration slot reads correctly in the two locales a shape rule would break", () => {
  const rendered = (locale: string): string[] => {
    const ctx = contextFor(locale);
    const item = catalogue.items.find((i) => i.record.endsWith("gearhead/d121_head.dbr"))!;
    const block = item.modifiers.find((m) => m.skill.endsWith("spectralarmor1.dbr"))!;
    return effectLines(block.stats, ctx).map((l) => resolveText(ctx.loc, l.text));
  };
  expect(rendered("en")).toEqual(["0.8 Seconds of Terrify Retaliation"]);
  expect(rendered("it")).toEqual(["Ritorsione che Spaventa per 0.8 Secondi"]);
  expect(rendered("vi")).toEqual(["Phản Đòn Hoảng Sợ trong 0.8 giây"]);
});
