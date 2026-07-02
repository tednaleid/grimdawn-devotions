// ABOUTME: Data-driven guard that no devotion stat renders through statFormat's mechanical humanize()
// ABOUTME: fallback in any view. Drives the real render functions, so a coverage regression fails CI.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { groupedBonusRows, formatPowerStats } from "../src/core/statFormat";
import { resolveText } from "../src/core/localization";
import { enLoc } from "./helpers/localizeEn";

// Exact copy of statFormat.ts humanize(): the mechanical id->words fallback we never want a user to see.
function humanize(id: string): string {
  const s = id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._]/g, " ")
    .replace(/^character /i, "")
    .replace(/\bStrength\b/g, "Physique")
    .replace(/\bDexterity\b/g, "Cunning")
    .replace(/\bIntelligence\b/g, "Spirit")
    .replace(/\bMana\b/g, "Energy")
    .trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Some ids resolve to a correct label that coincidentally equals humanize(id), so their real render is
// not a leak and must be excluded from the forbidden set: the attribute family (characterStrength ->
// "Physique") and damageAbsorption (stat.power.damageAbsorption is literally "Damage Absorption").
const ATTR_RESOLVED =
  /^character(Strength|Dexterity|Intelligence|Life|Mana|OffensiveAbility|DefensiveAbility|LifeRegen|ManaRegen)(Modifier)?$/;
const COINCIDENTAL_LABELS = new Set(["damageAbsorption"]);

type StatMap = Record<string, number>;
const starMaps: StatMap[] = []; // bonuses / pet_bonuses -> groupedBonusRows (classify)
const powerMaps: StatMap[] = []; // celestial power + pet attack stats -> formatPowerStats
const allIds = new Set<string>();

function record(map: unknown, into: StatMap[]): void {
  if (!map || typeof map !== "object") return;
  const m = map as StatMap;
  into.push(m);
  for (const [k, v] of Object.entries(m)) if (typeof v === "number") allIds.add(k);
}

for (const c of (doc as any).constellations ?? []) {
  for (const s of c.stars ?? []) {
    record(s.bonuses, starMaps);
    record(s.pet_bonuses, starMaps);
    const cp = s.celestial_power;
    if (cp) {
      record(cp.stats, powerMaps);
      if (cp.pet) record(cp.pet.attack_stats, powerMaps);
    }
  }
}

// Labels that would only appear if a stat fell through to humanize(). Weapon tokens (capitalized) are
// not stats; attribute-resolved ids are excluded (their real label coincides with humanize).
const forbidden = new Set<string>();
for (const id of allIds) {
  if (/^[A-Z]/.test(id) || ATTR_RESOLVED.test(id) || COINCIDENTAL_LABELS.has(id)) continue;
  forbidden.add(humanize(id));
}

// Scope, deliberately: this catches humanize() leaks specifically, not raw-tag leaks. A
// STAT_FORMAT_TAGS tag that resolves nowhere would render its raw tag ("DefenseConvert"), which is not
// a humanize(id) output and so is not in `forbidden` - statFormat.test.ts pins those English labels
// instead. Driving groupedBonusRows + formatPowerStats covers every path: the condensed view's
// decompose() reuses classify().label (already exercised by groupedBonusRows), and every other
// decompose subject uses translate(), never humanize().
test("no devotion stat renders via humanize() in any view", () => {
  const leaks: string[] = [];
  const scan = (label: string) => {
    if (forbidden.has(label)) leaks.push(label);
  };
  for (const map of starMaps)
    for (const g of groupedBonusRows(map)) for (const r of g.rows) scan(resolveText(enLoc, r.label));
  for (const map of powerMaps) {
    const p = formatPowerStats(map);
    for (const r of [...p.rows, ...p.fallthrough]) scan(resolveText(enLoc, r.label));
  }
  // Deduplicate for a readable failure listing the raw labels that leaked.
  expect([...new Set(leaks)]).toEqual([]);
});
