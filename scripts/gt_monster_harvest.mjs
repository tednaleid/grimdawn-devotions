// ABOUTME: Harvests grimtools' own displayed boss, nemesis and pinned-entry resistances into the parity fixture.
// ABOUTME: Drives grimtools' minified page internals (yi, D, Ph, Dh, U); re-derive them if the site changes.
//
// Usage: bun scripts/gt_monster_harvest.mjs
//
// Loads one monsterdb page and, inside it, runs grimtools' own stat routine for every Boss and
// SuperBoss entry, every entry named like one of our nemesis rows, and the PINNED_IDS below, at each difficulty the
// entry exists in, 1 player, grimtools' default Monster Level 100. Calling the site's code rather
// than reimplementing it is the point: the fixture records what players see on grimtools.
// Needs Chrome and playwright-core resolvable from here (bun resolves a global install).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "scripts/fixtures/gt-monster-resistances.json");
const PAGE = "https://www.grimtools.com/monsterdb/364";

const monsters = JSON.parse(readFileSync(join(ROOT, "data/monsters.json"), "utf8")).monsters;
const nemesisTags = [...new Set(monsters.filter((m) => m.role === "nemesis").map((m) => m.name_tag))];
// Hero and Quest entries whose fire, cold and lightning include a skill's
// defensiveElementalResistance, pinning that convention below the boss tier.
const PINNED_IDS = [
  84, 85, 86, 212, 276, 286, 304, 316, 764, 801, 849, 890, 987, 995, 996, 1799, 1817, 2028, 2029, 2117, 2118,
  2119, 2120, 2256, 3226, 3227, 3333, 3336, 3589, 3591, 3853, 3854, 3855,
];

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
await page.goto(PAGE, { waitUntil: "networkidle" });
const harvest = await page.evaluate(({ nemesisTags, pinnedIds }) => {
  // grimtools' type names in display order, paired with ours.
  const TYPES = [
    ["Physical", "physical"],
    ["Pierce", "pierce"],
    ["Fire", "fire"],
    ["Cold", "cold"],
    ["Lightning", "lightning"],
    ["Poison", "poison"],
    ["Aether", "aether"],
    ["Chaos", "chaos"],
    ["Life", "vitality"],
    ["Bleeding", "bleeding"],
  ];
  const DIFFS = { 1: "normal", 2: "elite", 3: "ultimate", 4: "ascendant" };
  const nemesis = new Set(nemesisTags);
  const pinned = new Set(pinnedIds);
  const entries = [];
  for (const key of Object.keys(allMonsters)) {
    const m = allMonsters[key];
    const tag = $db.getMonsterNameTag(m);
    const cls = m.monsterClassification;
    if (!(cls === "Boss" || cls === "SuperBoss" || nemesis.has(tag) || pinned.has(Number(key.slice(1))))) continue;
    const resistances = {};
    for (const d of monsterDifficulty[key] || [1, 2, 3, 4]) {
      // Buff toggles off (grimtools' default view), then the page's own character-sheet routine.
      re = false;
      pe = false;
      te = false;
      D = m;
      Ph = d;
      Dh = 1;
      yi();
      resistances[DIFFS[d]] = Object.fromEntries(TYPES.map(([gt, ours]) => [ours, U[`res${gt}Value`]]));
    }
    entries.push({ gt_id: Number(key.slice(1)), name_tag: tag, classification: cls, resistances });
  }
  return { gameVersion: typeof gameVersion === "undefined" ? null : gameVersion, level: globals.charLevel, entries };
}, { nemesisTags, pinnedIds: PINNED_IDS });
await browser.close();

if (harvest.level !== 100) throw new Error(`grimtools Monster Level is ${harvest.level}, expected its default 100`);
harvest.entries.sort((a, b) => a.gt_id - b.gt_id);
const fixture = {
  source: "https://www.grimtools.com/monsterdb/<gt_id>, 1 player, Monster Level 100, buffs off",
  game_version: String(harvest.gameVersion ?? "").replace(/^Version /, ""),
  monster_level: 100,
  players: 1,
  entries: harvest.entries,
};
writeFileSync(OUT, `${JSON.stringify(fixture, null, 1)}\n`);
console.log(`${fixture.game_version}: ${fixture.entries.length} entries -> ${OUT}`);
