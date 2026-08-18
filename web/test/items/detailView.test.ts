// ABOUTME: Tests for detailMarkup: per-skill grouping (level grants + modifier blocks stay
// ABOUTME: correctly attributed, never flattened across skills), and the grimtools link.
import { test, expect } from "bun:test";
import { gameT, litT, makeLocalization } from "../../src/core/localization";
import { detailMarkup, type DetailContext } from "../../src/items/adapters/detailView";
import { parseCatalogue } from "../../src/items/core/model";
import type { Item } from "../../src/items/core/model";
import doc from "../../../data/skill-items.json";
import statItemTags from "../../../data/stat-item-tags.json";
import gameEn from "../../../data/i18n/game.en.json";
import appEn from "../../src/i18n/app.en.json";

// --- Real-data fixtures, mirroring effectText.test.ts's cardCtx / model.test.ts's committed
// catalogue: exercises the real tag/template catalogs so a real-data drift (a stat losing its
// tag mapping, a template changing shape) fails a test here, not just in the browser.
const catalogue = parseCatalogue(doc);
const tags = statItemTags as Record<string, string>;
const game = gameEn as Record<string, string>;
const skillByRecord = new Map(catalogue.skills.map((s) => [s.record, s]));
const masteryByRecord = new Map(catalogue.masteries.map((m) => [m.record, m]));
const loc = makeLocalization(appEn as Record<string, string>, appEn as Record<string, string>, "en", game, game);
const realCtx: DetailContext = {
  tagOf: (s) => tags[s],
  templateOf: (t) => game[t],
  nameOf: (r) => {
    const s = skillByRecord.get(r);
    return s?.nameTag ? gameT(s.nameTag) : undefined;
  },
  masteryNameOf: (r) => {
    const m = masteryByRecord.get(r);
    return m?.nameTag ? gameT(m.nameTag) : undefined;
  },
  loc,
};

// Extracts each <section class="skill-detail">...heading...lines...</section> as {heading, body}
// pairs, in document order - lets a test assert not just that a line is present ANYWHERE in the
// detail, but that it is attributed to the RIGHT skill's own section, so a bug that merges two
// skills' blocks under one heading (the grouping-key half of the golden rule) fails a test even
// though rowEffectLines itself still calls effectLines once per block.
function sections(html: string): { heading: string; body: string }[] {
  const out: { heading: string; body: string }[] = [];
  const re = /<section class="skill-detail">\s*<h4 class="skill-detail-name">(.*?)<\/h4>([\s\S]*?)<\/section>/g;
  for (const m of html.matchAll(re)) out.push({ heading: m[1]!, body: m[2]! });
  return out;
}

// Task 14 Step 3's explicit check: Badge of the Crimson Company has exactly a Cadence block and
// a Leap block, plus four level grants (two of which land on records the modifiers never touch -
// cadence2/passive2/passive01 - and one, Leap, that carries both a modifier AND a level grant on
// the SAME record).

test("Badge of the Crimson Company: both the Cadence and Leap blocks render, alongside all four level grants", () => {
  const medal = catalogue.items.find((i) => i.record.endsWith("c010_medal.dbr"))!;
  const html = detailMarkup(medal, realCtx);
  const bySection = new Map(sections(html).map((s) => [s.heading, s.body]));
  expect([...bySection.keys()].sort()).toEqual(
    ["Anatomy of Murder", "Cadence", "Fighting Form", "Implements of War", "Leap"].sort(),
  );
  // Cadence's block (cadence1.dbr) is its own section: a DoT line and a refresh line naming Leap,
  // but none of Leap's own content.
  const cadence = bySection.get("Cadence")!;
  expect(cadence).toContain("300 Bleeding Damage over 2 Seconds");
  expect(cadence).toContain("25% Chance on Attack to reduce cooldown of Leap by 1 Second");
  expect(cadence).not.toContain("Piercing Damage");
  // Leap's section carries both its own modifier block (a lone Min renders as a single value) AND
  // its +2 level grant (a DIFFERENT skill record, cadence2.dbr, carries the +3 Cadence grant) -
  // but none of Cadence's content.
  const leap = bySection.get("Leap")!;
  expect(leap).toContain("200 Piercing Damage");
  expect(leap).toContain("+2 to Leap");
  expect(leap).not.toContain("Bleeding Damage");
  // The other three level grants land on skill records the modifiers never touch, each its own
  // section with nothing else in it.
  expect(bySection.get("Fighting Form")).toContain("+3 to Fighting Form");
  expect(bySection.get("Anatomy of Murder")).toContain("+3 to Anatomy of Murder");
  expect(bySection.get("Implements of War")).toContain("+2 to Implements of War");
  // Step 2: the grimtools link, in a new tab, catalog-labelled.
  expect(html).toContain('target="_blank"');
  expect(html).toContain(">View on Grimtools<");
});

// --- Golden-rule regression: the same Krieg's Mask shape as tableView.test.ts, but through
// detailMarkup's per-skill grouping rather than a single row's in-scope modBlocks. Two DIFFERENT
// skills - one with a flat Min, the other with a real Min/Max pair on the same stat id - must
// never cross-pollinate into a fabricated range, even though they sit in the same item's detail.
const SYN_GAME: Record<string, string> = {
  DamageAether: "{%t0} Aether Damage",
  ItemSkillIncrement: "{+%d0} to {%s1}",
  ItemMasteryIncrement: "{+%d0} to all skills in {%s1}",
};
const SYN_TAGS: Record<string, string> = {
  offensiveAetherMin: "DamageAether",
  offensiveAetherMax: "DamageAether",
};
const synSkillNames: Record<string, string> = {
  "skills/blitz.dbr": "Blitz",
  "skills/warcry.dbr": "War Cry",
};
const synLoc = makeLocalization({}, {}, "en", SYN_GAME, SYN_GAME);
const synCtx: DetailContext = {
  tagOf: (s) => SYN_TAGS[s],
  templateOf: (t) => SYN_GAME[t],
  nameOf: (r) => (synSkillNames[r] ? litT(synSkillNames[r]!) : undefined),
  masteryNameOf: (r) => (r === "masteries/soldier.dbr" ? litT("Soldier") : undefined),
  loc: synLoc,
};

function synItem(overrides: Partial<Item>): Item {
  return {
    record: "test-item",
    nameTag: null,
    domain: "gear",
    slots: [],
    rarity: "Legendary",
    itemLevel: 1,
    tiers: [],
    grimtools: null,
    boosts: [],
    masteryBoosts: [],
    modifiers: [],
    ...overrides,
  };
}

// A single skill can carry TWO modifier blocks (matches Row.modBlocks: "one entry per in-scope
// modifier block" - a base skill and its transmuter sometimes both appear in item.modifiers).
// That routes both blocks into ONE skillSectionHtml call, so this - unlike two blocks on two
// DIFFERENT skills, which land in separate sections regardless - is the one place inside
// detailView.ts itself that could reproduce the Krieg's Mask shape if rowEffectLines were ever
// bypassed for a flattened effectLines call.
test("a skill with two modifier blocks (flat Min in one, a real Min/Max pair in the other) never cross-pollinates", () => {
  const item = synItem({
    modifiers: [
      { skill: "skills/blitz.dbr", stats: [{ stat: "offensiveAetherMin", value: 140 }] },
      {
        skill: "skills/blitz.dbr",
        stats: [
          { stat: "offensiveAetherMax", value: 300 },
          { stat: "offensiveAetherMin", value: 180 },
        ],
      },
    ],
  });
  const html = detailMarkup(item, synCtx);
  expect(html).toContain("140 Aether Damage");
  expect(html).toContain("180-300 Aether Damage");
  expect(html).not.toContain("140-300");
});

test("a level grant renders through the game's own ItemSkillIncrement template", () => {
  const item = synItem({ boosts: [{ skill: "skills/blitz.dbr", level: 3 }] });
  expect(detailMarkup(item, synCtx)).toContain("+3 to Blitz");
});

test("a mastery-wide grant renders through ItemMasteryIncrement, resolved via masteryNameOf", () => {
  const item = synItem({ masteryBoosts: [{ mastery: "masteries/soldier.dbr", level: 2 }] });
  expect(detailMarkup(item, synCtx)).toContain("+2 to all skills in Soldier");
});

test("the grimtools link is omitted when the item carries none", () => {
  const item = synItem({});
  expect(detailMarkup(item, synCtx)).not.toContain('class="item-detail-grimtools"');
});

test("the grimtools link points at item.grimtools and opens in a new tab", () => {
  const item = synItem({ grimtools: "https://www.grimtools.com/db/items/1" });
  const html = detailMarkup(item, synCtx);
  expect(html).toContain('href="https://www.grimtools.com/db/items/1"');
  expect(html).toContain('target="_blank"');
});
