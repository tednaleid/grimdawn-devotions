// ABOUTME: Guards that keys referenced by the app exist in app.en.json, so a missing key fails CI not runtime.
// ABOUTME: Grows as more views migrate; each migration adds its keys here.
import { test, expect } from "bun:test";
import en from "../src/i18n/app.en.json";
import cs from "../src/i18n/app.cs.json";
import de from "../src/i18n/app.de.json";
import es from "../src/i18n/app.es.json";
import fr from "../src/i18n/app.fr.json";
import it from "../src/i18n/app.it.json";
import ja from "../src/i18n/app.ja.json";
import ko from "../src/i18n/app.ko.json";
import pl from "../src/i18n/app.pl.json";
import pt from "../src/i18n/app.pt.json";
import ru from "../src/i18n/app.ru.json";
import vi from "../src/i18n/app.vi.json";
import zh from "../src/i18n/app.zh.json";

const LOCALE_CATALOGS: Record<string, Record<string, string>> = {
  cs,
  de,
  es,
  fr,
  it,
  ja,
  ko,
  pl,
  pt,
  ru,
  vi,
  zh,
};

const GAME_SOURCED_PREFIXES = ["stat.attr.", "stat.damage.", "stat.dot.", "stat.resist."];

function placeholders(value: string): Set<string> {
  const names: string[] = [];
  for (const match of value.matchAll(/\{(\w+)\}/g)) {
    const name = match[1];
    if (name !== undefined) names.push(name);
  }
  return new Set(names);
}

const REQUIRED = [
  "ui.title",
  "ui.lang.label",
  "ui.info.aria",
  "ui.info.build",
  "ui.info.description",
  "ui.info.gameData",
  "ui.info.gameDataNoDate",
  "ui.info.github",
  "ui.boot.failed",
  "ui.boot.reload",
  "ui.boot.loading",
  "ui.points.label",
  "ui.points.budgetAria",
  "ui.points.capRemoveTitle",
  "ui.points.capRestoreTitle",
  "ui.points.total",
  "ui.points.reset",
  "ui.points.used",
  "ui.points.min",
  "ui.drawer.benefitsAria",
  "ui.drawer.benefits",
  "ui.drawer.affinityAria",
  "ui.drawer.affinity",
  "ui.panel.availableToGet",
  "ui.panel.petBonus",
  "ui.panel.celestialPowers",
  "ui.panel.benefits",
  "ui.panel.affinity",
  "ui.compare.banner",
  "ui.compare.revert",
  "ui.compare.updateBaseline",
  "ui.compare.setBaseline",
  "ui.compare.swap",
  "ui.compare.base",
  "ui.compare.now",
  "ui.compare.delta",
  "ui.benefits.empty",
  "ui.affinity.have",
  "ui.affinity.need",
  "ui.affinity.neededBy",
  "ui.tooltip.petBonus",
  "ui.tooltip.currentLevel",
  "ui.tooltip.procQualifier",
  "ui.tooltip.requires",
  "ui.tooltip.grants",
  "ui.tooltip.pts",
  "ui.tooltip.needsPoints",
  "ui.tooltip.cannotComplete",
  "ui.tooltip.partialGate",
  "ui.tooltip.pointsToReach",
  "ui.panel.buildOrder",
  "ui.buildOrder.crossroads",
  "ui.buildOrder.dir.n",
  "ui.buildOrder.dir.nw",
  "ui.buildOrder.dir.ne",
  "ui.buildOrder.dir.sw",
  "ui.buildOrder.dir.se",
  "ui.buildOrder.add",
  "ui.buildOrder.refund",
  "ui.buildOrder.deficitMore",
  "ui.buildOrder.deficitJoin",
  "ui.buildOrder.incompleteAffinity",
  "ui.buildOrder.addSupporting",
  "ui.buildOrder.noPathCap",
  "ui.buildOrder.scaffoldingNote",
  "ui.buildOrder.noLegalPath",
  "ui.buildOrder.selectPrompt",
  "ui.buildOrder.partial",
  "ui.buildOrder.transitionHeading",
  "ui.buildOrder.fullRespecNote",
  "ui.buildOrder.transitionIdentical",
  "ui.buildOrder.transitionUnavailable",
  "aff.ascendant",
  "aff.chaos",
  "aff.eldritch",
  "aff.order",
  "aff.primordial",
  "ui.commit.add",
  "ui.commit.remove",
  "ui.benefit.max",
  "ui.benefit.duration",
  "ui.benefit.maxPrefix",
  "ui.benefit.seconds",
  "stat.group.attributes",
  "stat.group.offense",
  "stat.group.resistanceReduction",
  "stat.group.crowdControl",
  "stat.group.retaliation",
  "stat.group.resistances",
  "stat.group.statusProtection",
  "stat.group.armorAndMitigation",
  "stat.group.other",
  "stat.override.characterHealIncreasePercent",
  "stat.power.ccChanceDuration",
  "stat.power.ccDuration",
  "trigger.AttackEnemy",
  "trigger.AttackEnemyCrit",
  "trigger.Block",
  "trigger.HitByEnemy",
  "trigger.HitByMelee",
  "trigger.HitByProjectile",
  "trigger.HitByCrit",
  "trigger.OnKill",
  "trigger.LowHealth",
  "trigger.LowMana",
  "trigger.CastBuff",
  "trigger.OnEquip",
];

test("every required chrome key exists in app.en.json", () => {
  const cat = en as Record<string, string>;
  for (const key of REQUIRED) expect(cat[key]).toBeDefined();
});

test("stat keys referenced by statFormat exist", () => {
  const cat = en as Record<string, string>;
  for (const key of [
    "stat.dot.Cold",
    "stat.attr.Strength",
    "stat.group.offense",
    "stat.override.defensiveAbsorptionModifier",
  ])
    expect(cat[key]).toBeDefined();
});

for (const [locale, catalog] of Object.entries(LOCALE_CATALOGS)) {
  test(`app.${locale}.json has no stray keys beyond app.en.json`, () => {
    const strayKeys = Object.keys(catalog).filter((key) => !(key in en));
    expect(strayKeys).toEqual([]);
  });

  test(`app.${locale}.json contains no game-sourced keys`, () => {
    const gameKeys = Object.keys(catalog).filter((key) =>
      GAME_SOURCED_PREFIXES.some((prefix) => key.startsWith(prefix)),
    );
    expect(gameKeys).toEqual([]);
  });

  test(`app.${locale}.json placeholder sets match app.en.json`, () => {
    const enCat = en as Record<string, string>;
    const mismatches: string[] = [];
    for (const [key, value] of Object.entries(catalog)) {
      const enValue = enCat[key];
      if (enValue === undefined) continue; // reported as a stray key above
      const enPlaceholders = placeholders(enValue);
      const trPlaceholders = placeholders(value);
      const same =
        enPlaceholders.size === trPlaceholders.size && [...enPlaceholders].every((p) => trPlaceholders.has(p));
      if (!same) mismatches.push(key);
    }
    expect(mismatches).toEqual([]);
  });
}
