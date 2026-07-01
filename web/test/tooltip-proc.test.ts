// ABOUTME: A star's proc trigger (e.g. "Attack") must render through translate("trigger." + triggerKey)
// ABOUTME: into the tooltip's proc qualifier, not just exist as an isolated catalog key.
import { test, expect, beforeEach } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { gameText } from "../src/core/localization";
import { tooltipView } from "../src/adapters/tooltipView";
import { installEnglish } from "./helpers/localizeEn";

installEnglish();

const model = buildModel(doc as any);

beforeEach(() => {
  global.window = {
    innerWidth: 1024,
    innerHeight: 768,
  } as any;
});

test("proc trigger resolves through the view to its English display word", () => {
  // Same star used in model.test.ts to confirm the celestial power's proc shape:
  // Scorpion Sting procs at 25% chance on the "AttackEnemy" trigger key.
  const scorpion = [...model.stars.values()].find(
    (s) => s.celestialPower?.nameTag && gameText(s.celestialPower.nameTag) === "Scorpion Sting",
  )!;
  expect(scorpion.celestialPower?.proc?.triggerKey).toBe("AttackEnemy");

  const el = { style: {}, innerHTML: "", offsetWidth: 0, offsetHeight: 0 } as any as HTMLElement;
  const tip = tooltipView(el);
  tip.show(model, scorpion.id, 0, 0);

  // Proves translate("trigger." + triggerKey) actually resolved and landed in the
  // "({chance}% Chance on {trigger})" qualifier, not just that the key exists somewhere.
  expect((el as any).innerHTML).toContain("Chance on Attack");
});
