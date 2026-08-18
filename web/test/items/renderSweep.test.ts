// ABOUTME: Reads every rendered effect line in the shipped dataset - every modifier block and
// ABOUTME: every pet panel - and fails on the shapes that mean a value was lost or jammed.
import { test, expect } from "bun:test";
import { gameT, makeLocalization, resolveText } from "../../src/core/localization";
import { detailMarkup, type DetailContext } from "../../src/items/adapters/detailView";
import { effectLines } from "../../src/items/core/effectText";
import { parseCatalogue, type Item } from "../../src/items/core/model";
import doc from "../../../data/skill-items.json";
import statItemTags from "../../../data/stat-item-tags.json";
import gameEn from "../../../data/i18n/game.en.json";
import appEn from "../../src/i18n/app.en.json";

// The whole real path: the committed catalogue, the committed stat -> tag map, the committed
// English game text, and the app catalog. Nothing synthetic. Every other test in this directory
// asserts a handful of lines it chose; this one reads all of them.
//
// It exists because nothing else in the suite ever looked at a rendered line against the real
// data, which is why "Petrify target10", "+1% Attack Speed" for a x0.79 multiplier and "10
// Elemental Damage" above "100 Elemental Damage" all shipped green. It is a shape check, not an
// oracle: it cannot tell a right number from a wrong one, only a line that has visibly lost or
// mangled one. Pair it with the per-card oracle tests, never instead of them.
const catalogue = parseCatalogue(doc);
const tags = statItemTags as Record<string, string>;
const game = gameEn as Record<string, string>;
const app = appEn as Record<string, string>;
const skillByRecord = new Map(catalogue.skills.map((s) => [s.record, s]));
const loc = makeLocalization(app, app, "en", game, game);
const ctx: DetailContext = {
  tagOf: (s) => tags[s],
  templateOf: (t) => game[t],
  nameOf: (r) => {
    const s = skillByRecord.get(r);
    return s?.nameTag ? gameT(s.nameTag) : undefined;
  },
  masteryNameOf: () => undefined,
  skillOf: (r) => skillByRecord.get(r),
  loc,
};

function unescapeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

// Every line the page can put in front of a reader, each tagged with where it came from so a
// failure names the block rather than just the string.
function allRenderedLines(): { where: string; line: string; isModBlock: boolean }[] {
  const out: { where: string; line: string; isModBlock: boolean }[] = [];
  for (const item of catalogue.items) {
    for (const block of item.modifiers) {
      for (const t of effectLines(block.stats, ctx)) {
        out.push({ where: `${item.record} / ${block.skill}`, line: resolveText(loc, t), isModBlock: true });
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
      rarity: "Legendary",
      itemLevel: 1,
      tiers: [],
      grimtools: null,
      boosts: [{ skill: skill.record, level: 1 }],
      masteryBoosts: [],
      modifiers: [],
    };
    const html = detailMarkup(probe, ctx);
    // The panel's own <li>s only: the probe's "+1 to <skill>" grant is the first line of the
    // section, outside the <details>, and is not what this sweeps.
    const panel = html.slice(html.indexOf("<details"));
    for (const m of panel.matchAll(/<li>(.*?)<\/li>/g)) {
      out.push({ where: `${skill.record} (pet panel)`, line: unescapeHtml(m[1]!), isModBlock: false });
    }
  }
  return out;
}

const LINES = allRenderedLines();

// A floor, not a target: if a refactor renders half the dataset into nothing, every shape
// assertion below passes vacuously. 4,000 is comfortably under the ~5,000 lines that ship.
test("the sweep actually reads the dataset", () => {
  expect(LINES.length).toBeGreaterThan(4000);
});

function offenders(bad: (line: string) => boolean): string[] {
  return [...new Set(LINES.filter((l) => bad(l.line)).map((l) => `${l.line}   <- ${l.where}`))].slice(0, 10);
}

// "Petrify target10": a value substituted where the template wanted a nested clause, so the
// number is jammed onto the last word of the label.
test("no rendered line jams a value onto a word", () => {
  expect(offenders((l) => /[a-z]\d/.test(l))).toEqual([]);
});

// The format layer handed a number-shaped argument something that is not a number.
test("no rendered line contains NaN", () => {
  expect(offenders((l) => l.includes("NaN"))).toEqual([]);
});

// A brace survives only when a template's placeholder was never substituted, or an app catalog
// key was resolved with the wrong parameter names.
test("no rendered line leaks an unsubstituted template", () => {
  expect(offenders((l) => /[{}]/.test(l))).toEqual([]);
});

// A line that renders to nothing is a line whose value and label both vanished; the renderer
// must drop it instead, so the reader never sees an empty bullet.
test("no rendered line is empty", () => {
  expect(offenders((l) => l.trim() === "")).toEqual([]);
});

// "+16% Damage to": a template argument the payload does not carry was dropped, leaving the
// literal text around it standing.
test("no rendered line ends in a dangling preposition", () => {
  expect(offenders((l) => /\b(to|of|by|for)\s*$/.test(l))).toEqual([]);
});

// The shape of a stat rendered twice on one card because a chance, a duration or a second
// carrier's value was read as another magnitude: two lines under one label that differ only in
// their numbers. This is the shape of I1 ("+100%" and "+20% Skill Cooldown Reduction"), of I2
// ("10 Elemental Damage" above "100 Elemental Damage") and of C2 ("Petrify target10" above
// "Petrify target2"); none of those three is detectable from a single line in isolation.
//
// Modifier blocks only. A pet panel groups several abilities under one <details>, and two
// abilities genuinely can carry the same stat at the same value (the Skeletal Warrior's charge
// and innate attacks both add 20 Vitality Damage), so the same rule there would be a false alarm.
test("no modifier block renders two lines that differ only in their numbers", () => {
  const dupes: string[] = [];
  const byBlock = new Map<string, string[]>();
  for (const { where, line, isModBlock } of LINES) {
    if (!isModBlock) continue;
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

// --- The three cards the final fix round was measured against, read off the real dataset
// rather than a fixture. These are oracles: they pin the NUMBERS, which no shape check can.
function linesFor(itemMatch: string, skillMatch: string): string[] {
  const item = catalogue.items.find((i) => i.record.endsWith(itemMatch))!;
  const block = item.modifiers.find((m) => m.skill.endsWith(skillMatch))!;
  return effectLines(block.stats, ctx).map((t) => resolveText(loc, t));
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
