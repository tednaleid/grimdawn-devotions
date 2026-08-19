// ABOUTME: Tests for detailMarkup: per-skill grouping (level grants + modifier blocks stay
// ABOUTME: correctly attributed, never flattened across skills), the pet panel, and the grimtools link.
import { test, expect } from "bun:test";
import { gameT, litT, makeLocalization } from "../../src/core/localization";
import { detailMarkup, type DetailContext } from "../../src/items/adapters/detailView";
import { parseCatalogue } from "../../src/items/core/model";
import type { Item, Skill } from "../../src/items/core/model";
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
  skillOf: (r) => skillByRecord.get(r),
  setOf: () => undefined,
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

// Wind Devil (records/skills/playerclass06/squall1.dbr): the Task 16 Step 3 check. 5 pet-own-stat
// rows (no attribution), 31 pet-ability rows across 3 distinct source records - one named
// ("Howling Wind"), two unnamed (petskill_totem_immunities, petskill_winddevil_radius).
test("Wind Devil: the pet panel renders the pet's own stats and groups ability rows by name", () => {
  const skill = catalogue.skills.find((s) => s.record.endsWith("squall1.dbr"))!;
  expect(skill.pets.length).toBe(1);
  expect(skill.pets[0]!.stats.length).toBe(36);
  const item: Item = {
    record: "test-item",
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
  const html = detailMarkup(item, realCtx);
  expect(html).toContain("<summary>Wind Devil</summary>");
  expect(html).toContain('pet-ability-name">Howling Wind<');
  expect(html).toContain('class="pet-ability-plain"');
  // The pet's own 5 stats render with no per-row attribution. Two of them
  // (characterAttackSpeed and characterSpellCastSpeed) are engine MULTIPLIERS sitting at
  // exactly 1.0, the neutral value, so they carry no bonus to show and no line: 3 <li>s.
  const ownMatch = html.match(/<ul class="pet-own-stats">(.*?)<\/ul>/s);
  expect(ownMatch).not.toBeNull();
  expect((ownMatch![1]!.match(/<li>/g) ?? []).length).toBe(3);
  // characterRunSpeed 1.2 is a x1.2 multiplier, i.e. +20%, not "+1% Movement Speed".
  expect(ownMatch![1]).toContain("+20% Movement Speed");
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
  skillOf: () => undefined,
  setOf: () => undefined,
  loc: synLoc,
};

function synItem(overrides: Partial<Item>): Item {
  return {
    record: "test-item",
    nameTag: null,
    domain: "gear",
    slots: [],
    gearType: "head",
    rarity: "Legendary",
    itemLevel: 1,
    tiers: [],
    grimtools: null,
    boosts: [],
    masteryBoosts: [],
    modifiers: [],
    set: null,
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

// --- Pet panel: value choice and per-source safety, using synthetic PetStat fixtures so the
// first/max/ultimate choice and the golden-rule-for-pets grouping are pinned independently of
// the real dataset's current shape.
const PET_GAME: Record<string, string> = {
  ...SYN_GAME,
  DamageFire: "{%t0} Fire Damage",
  DamagePoison: "{%t0} Poison Damage",
  tagCharAttackSpeed: "{%+.0f0}% Attack Speed",
  tagCharRunSpeed: "{%+.0f0}% Movement Speed",
  tagCharSpellCastSpeed: "{%+.0f0}% Casting Speed",
};
const PET_TAGS: Record<string, string> = {
  ...SYN_TAGS,
  offensiveFireMin: "DamageFire",
  offensiveFireMax: "DamageFire",
  offensivePoisonMin: "DamagePoison",
  characterAttackSpeed: "tagCharAttackSpeed",
  characterRunSpeed: "tagCharRunSpeed",
  characterSpellCastSpeed: "tagCharSpellCastSpeed",
};
const petSkill: Skill = {
  record: "skills/pet-carrier.dbr",
  mastery: "masteries/shaman.dbr",
  group: "skills/pet-carrier.dbr",
  nodeKind: "base",
  uiX: 0,
  uiY: 0,
  nameTag: null,
  descriptionTag: null,
  icon: "",
  maxLevel: 12,
  ultimateLevel: 22,
  ranks: [],
  pets: [
    {
      record: "pets/testpet.dbr",
      nameTag: "petName",
      stats: [
        // own stats: first/max/ultimate all equal. These three are engine MULTIPLIERS, not
        // percentages - x1.05 is +5%, x0.8 is -20%, and x1.0 is no modifier at all.
        {
          sourceKind: "pet",
          source: "pets/testpet.dbr",
          sourceNameTag: null,
          stat: "characterAttackSpeed",
          first: 1.05,
          max: 1.05,
          ultimate: 1.05,
        },
        {
          sourceKind: "pet",
          source: "pets/testpet.dbr",
          sourceNameTag: null,
          stat: "characterRunSpeed",
          first: 0.8,
          max: 0.8,
          ultimate: 0.8,
        },
        {
          sourceKind: "pet",
          source: "pets/testpet.dbr",
          sourceNameTag: null,
          stat: "characterSpellCastSpeed",
          first: 1,
          max: 1,
          ultimate: 1,
        },
        // ability A (named "Firebomb"): differing first/max/ultimate.
        {
          sourceKind: "pet_skill",
          source: "pets/ability-a.dbr",
          sourceNameTag: "abilityAName",
          stat: "offensiveFireMin",
          first: 10,
          max: 50,
          ultimate: 90,
        },
        // ability B (unnamed): a flat Min, no Max sibling.
        {
          sourceKind: "pet_skill",
          source: "pets/ability-b.dbr",
          sourceNameTag: null,
          stat: "offensiveFireMin",
          first: 1,
          max: 20,
          ultimate: 20,
        },
        // ability C (unnamed, a DIFFERENT source than B): a real Min/Max pair on the SAME stat id
        // as ability B - the pet-panel analogue of Krieg's Mask. Must not pair with B's Min.
        {
          sourceKind: "pet_skill",
          source: "pets/ability-c.dbr",
          sourceNameTag: null,
          stat: "offensiveFireMin",
          first: 1,
          max: 30,
          ultimate: 30,
        },
        {
          sourceKind: "pet_skill",
          source: "pets/ability-c.dbr",
          sourceNameTag: null,
          stat: "offensiveFireMax",
          first: 2,
          max: 60,
          ultimate: 60,
        },
      ],
    },
  ],
};
const petCtx: DetailContext = {
  tagOf: (s) => PET_TAGS[s],
  templateOf: (t) => PET_GAME[t],
  nameOf: () => undefined,
  masteryNameOf: () => undefined,
  skillOf: (r) => (r === petSkill.record ? petSkill : undefined),
  setOf: () => undefined,
  loc: makeLocalization(
    {},
    {},
    "en",
    { ...PET_GAME, petName: "Test Pet", abilityAName: "Firebomb" },
    {
      ...PET_GAME,
      petName: "Test Pet",
      abilityAName: "Firebomb",
    },
  ),
};

test("pet panel: the pet's own stat renders under its name with no attribution", () => {
  const item = synItem({ boosts: [{ skill: petSkill.record, level: 1 }] });
  const html = detailMarkup(item, petCtx);
  expect(html).toContain("<summary>Test Pet</summary>");
  expect(html).toContain("+5% Attack Speed");
});

// Final fix round, C1. characterAttackSpeed/characterRunSpeed/characterSpellCastSpeed are
// engine multipliers that occur ONLY on pet records (56 rows; 0 item modifier blocks), while
// their tags are ordinary percentage templates. Passing the raw record value through printed
// the wrong magnitude on all 56 and the wrong SIGN on every sub-1.0 value, because
// "{%+.0f0}%" rounds 0.79 and 1.35 alike to "+1%".
test("pet panel: a multiplier below 1.0 renders as a penalty, not a +1% bonus", () => {
  const item = synItem({ boosts: [{ skill: petSkill.record, level: 1 }] });
  expect(detailMarkup(item, petCtx)).toContain("-20% Movement Speed");
});

test("pet panel: a multiplier of exactly 1.0 renders no line at all", () => {
  const item = synItem({ boosts: [{ skill: petSkill.record, level: 1 }] });
  expect(detailMarkup(item, petCtx)).not.toContain("Casting Speed");
});

test("pet panel: an ability row with a source name renders under its own heading", () => {
  const item = synItem({ boosts: [{ skill: petSkill.record, level: 1 }] });
  const html = detailMarkup(item, petCtx);
  expect(html).toContain('pet-ability-name">Firebomb<');
});

test("pet panel: uses the max value, not first or ultimate", () => {
  const item = synItem({ boosts: [{ skill: petSkill.record, level: 1 }] });
  const html = detailMarkup(item, petCtx);
  // Ability A: first 10, max 50, ultimate 90 - only max should appear.
  expect(html).toContain("50 Fire Damage");
  expect(html).not.toContain("10 Fire Damage");
  expect(html).not.toContain("90 Fire Damage");
});

test("pet panel: two different unnamed sources on the same stat id never fabricate a range", () => {
  const item = synItem({ boosts: [{ skill: petSkill.record, level: 1 }] });
  const html = detailMarkup(item, petCtx);
  // Ability B (max 20, no Max sibling) stays a lone value; ability C (max 30/60) collapses to
  // its own range. Neither may pair with the other's stats.
  expect(html).toContain("20 Fire Damage");
  expect(html).toContain("30-60 Fire Damage");
  expect(html).not.toContain("20-60");
  expect(html).not.toContain("20-30");
});

// --- set bonuses ------------------------------------------------------------
// The whole point of the block: a set bonus is not something the player has by equipping this
// piece, so it renders apart from the item's own lines and says how many pieces it needs.
// Pinned to the grimtools card for Mythical Ultos' Gem, which reads "(4) Set: +2 to all skills in
// Shaman" and, under "(5) Set", a Savagery block of "33 Lightning Damage".
const SET_GAME: Record<string, string> = {
  ...SYN_GAME,
  tagUltos: "Ultos' Tempest",
  DamageLightning: "{%t0} Lightning Damage",
};
const setLoc = makeLocalization(
  appEn as Record<string, string>,
  appEn as Record<string, string>,
  "en",
  SET_GAME,
  SET_GAME,
);
const ultos = {
  record: "sets/ultos",
  nameTag: "tagUltos",
  members: 5,
  modifiers: [{ pieces: 5, skill: "skills/blitz.dbr", stats: [{ stat: "offensiveLightningMin", value: 33 }] }],
  boosts: [],
  masteryBoosts: [{ pieces: 4, mastery: "masteries/soldier.dbr", level: 2 }],
};
const setCtx: DetailContext = {
  ...synCtx,
  tagOf: (s) => ({ ...SYN_TAGS, offensiveLightningMin: "DamageLightning" })[s],
  templateOf: (t) => SET_GAME[t],
  setOf: (r) => (r === "sets/ultos" ? (ultos as never) : undefined),
  loc: setLoc,
};

test("a set's bonuses render in their own block, one heading per piece count", () => {
  const html = detailMarkup(synItem({ set: "sets/ultos" }), setCtx);
  expect(html).toContain("Ultos' Tempest (4 pieces)");
  expect(html).toContain("Ultos' Tempest (5 pieces)");
  expect(html).toContain("+2 to all skills in Soldier");
  expect(html).toContain(">33 Lightning Damage<");
  // The lower count comes first, so the block reads the way the game's own card does.
  expect(html.indexOf("(4 pieces)")).toBeLessThan(html.indexOf("(5 pieces)"));
});

// A set block can name several skills, and its lines are useless without saying which is which
// (the item's own sections have a heading per skill; this one is grouped by piece count instead).
test("a set modifier line names the skill it belongs to", () => {
  const html = detailMarkup(synItem({ set: "sets/ultos" }), setCtx);
  // The line is tinted by its damage type here as everywhere else (see effectMarkup.ts), so the
  // set block cannot quietly stop matching the item's own sections.
  expect(html).toContain(
    '<span class="set-detail-skill">Blitz</span> <span class="dmg dmg-lightning">33 Lightning Damage</span>',
  );
});

test("an item in no set renders no set block", () => {
  const html = detailMarkup(synItem({ boosts: [{ skill: "skills/blitz.dbr", level: 2 }] }), setCtx);
  expect(html).not.toContain("set-detail");
});

// A set the catalogue does not carry (one with no skill wiring is never emitted) must read as no
// set rather than throw or render an empty heading.
test("an item naming a set the catalogue does not carry renders no set block", () => {
  const html = detailMarkup(synItem({ set: "sets/missing" }), setCtx);
  expect(html).not.toContain("set-detail");
});
