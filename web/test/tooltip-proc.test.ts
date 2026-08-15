// ABOUTME: A star's proc qualifier ("25% Chance on Attack") must render through translate("trigger." + triggerKey)
// ABOUTME: into the tooltip, phrased per trigger exactly as the game's tagAutoSkillCondition text.
import { test, expect, beforeEach } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { tooltipView } from "../src/adapters/tooltipView";
import { enLoc } from "./helpers/localizeEn";

const model = buildModel(doc as any);

beforeEach(() => {
  global.window = {
    innerWidth: 1024,
    innerHeight: 768,
  } as any;
});

function renderPower(name: string): string {
  const star = [...model.stars.values()].find(
    (s) => s.celestialPower?.nameTag && enLoc.gameText(s.celestialPower.nameTag) === name,
  )!;
  const el = { style: {}, innerHTML: "", offsetWidth: 0, offsetHeight: 0 } as any as HTMLElement;
  tooltipView(el).show(enLoc, model, star.id, 0, 0);
  return (el as any).innerHTML;
}

test("proc trigger resolves through the view to its English display word", () => {
  // Same star used in model.test.ts to confirm the celestial power's proc shape:
  // Scorpion Sting procs at 25% chance on the "AttackEnemy" trigger key.
  const scorpion = [...model.stars.values()].find(
    (s) => s.celestialPower?.nameTag && enLoc.gameText(s.celestialPower.nameTag) === "Scorpion Sting",
  )!;
  expect(scorpion.celestialPower?.proc?.triggerKey).toBe("AttackEnemy");

  // Proves translate("trigger." + triggerKey) actually resolved and landed in the
  // qualifier, not just that the key exists somewhere.
  expect(renderPower("Scorpion Sting")).toContain("(25% Chance on Attack)");
});

// The preposition is part of the trigger, not a shared template: the game says "on Attack" but
// "when Hit" (a user reported "Chance on Hit" as a confusing reversal). Expected text is the
// game's own tagAutoSkillCondition string for each trigger that occurs in the devotion data.
const GAME_QUALIFIERS: [power: string, trigger: string, qualifier: string][] = [
  ["Scorpion Sting", "AttackEnemy", "(25% Chance on Attack)"],
  ["Blizzard", "AttackEnemyCrit", "(100% Chance on Critical Attack)"],
  ["Targo's Hammer", "Block", "(50% Chance on Block)"],
  ["Wayward Soul", "HitByEnemy", "(20% Chance when Hit)"],
  ["Messenger of War", "HitByMelee", "(20% Chance when Hit by Melee Attacks)"],
];

for (const [power, trigger, qualifier] of GAME_QUALIFIERS) {
  test(`${power} renders the game's qualifier for ${trigger}`, () => {
    const html = renderPower(power);
    expect(html).toContain(qualifier);
  });
}

// The game phrases these as "(100% Chance at 33% Health)"; the low-health threshold is not in the
// devotion data, so the qualifier names the trigger the way the game's guide does instead.
test("a low-health proc reads 'on Low Health', never 'on Hit'", () => {
  const html = renderPower("Ghoulish Hunger");
  expect(html).toContain("(100% Chance on Low Health)");
});
