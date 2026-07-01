// ABOUTME: The conditional weapon-requirement qualifier shows on the star tooltip (and constellation
// ABOUTME: tooltip, Task 4), and is absent for ungated stars/constellations. Mirrors tooltip-dim.test.ts.
import { test, expect, beforeEach } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { tooltipView } from "../src/adapters/tooltipView";
import { installEnglish } from "./helpers/localizeEn";

installEnglish();

const model = buildModel(doc as any);

beforeEach(() => {
  global.window = { innerWidth: 1024, innerHeight: 768 } as any;
});

function render(fn: (tip: ReturnType<typeof tooltipView>) => void): string {
  const el = { style: {}, innerHTML: "", offsetWidth: 0, offsetHeight: 0 } as any as HTMLElement;
  fn(tooltipView(el));
  return (el as any).innerHTML as string;
}

test("star tooltip shows the weapon-requirement description for a gated star", () => {
  const html = render((tip) => tip.show(model, "kraken:0", 0, 0));
  expect(html).toContain("tip-weapon-req");
  expect(html).toContain("Requires a two-handed melee or two-handed ranged weapon.");
});

test("star tooltip omits the qualifier for an ungated star", () => {
  const html = render((tip) => tip.show(model, "anvil:0", 0, 0));
  expect(html).not.toContain("tip-weapon-req");
});

test("constellation tooltip shows the verbatim requirement when every star shares it", () => {
  // Every gated constellation in the data is fully gated by one requirement (Kraken: all 5 stars
  // need a two-handed weapon), so the line is unqualified - not hedged with "Some" - and deduped.
  const html = render((tip) => tip.showConstellation(model, "kraken", 0, 0));
  expect(html).toContain("Requires a two-handed melee or two-handed ranged weapon.");
  expect(html).not.toContain("Some bonuses require");
  expect(html.match(/tip-weapon-req/g)?.length).toBe(1);
});

test("constellation tooltip hedges with 'Some bonuses require' when only some stars are gated", () => {
  // No real constellation is partially gated, so build a minimal one: a gated star plus an
  // ungated one. The line must hedge (the requirement does not cover the whole constellation).
  const partial = buildModel({
    constellations: [
      {
        id: "partialcon",
        name: "Partial",
        tier: 1,
        affinity_required: {},
        affinity_bonus: {},
        background: null,
        stars: [
          {
            index: 0,
            predecessors: [],
            position: { x: 0, y: 0 },
            bonuses: { offensiveFireModifier: 10 },
            celestial_power: null,
            weapon_requirement: { weapons: ["Sword"], description: "Requires a sword." },
          },
          {
            index: 1,
            predecessors: [0],
            position: { x: 1, y: 1 },
            bonuses: { characterLife: 50 },
            celestial_power: null,
            weapon_requirement: null,
          },
        ],
      },
    ],
  } as any);
  const html = render((tip) => tip.showConstellation(partial, "partialcon", 0, 0));
  expect(html).toContain("Some bonuses require a sword.");
  expect(html.match(/tip-weapon-req/g)?.length).toBe(1);
});

test("constellation tooltip omits the qualifier when no star is gated", () => {
  const html = render((tip) => tip.showConstellation(model, "anvil", 0, 0));
  expect(html).not.toContain("tip-weapon-req");
});
