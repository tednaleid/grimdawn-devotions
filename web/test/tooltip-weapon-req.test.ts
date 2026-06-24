// ABOUTME: The conditional weapon-requirement qualifier shows on the star tooltip (and constellation
// ABOUTME: tooltip, Task 4), and is absent for ungated stars/constellations. Mirrors tooltip-dim.test.ts.
import { test, expect, beforeEach } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { tooltipView } from "../src/adapters/tooltipView";

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

test("constellation tooltip shows one deduped 'Some bonuses require' line", () => {
  const html = render((tip) => tip.showConstellation(model, "kraken", 0, 0));
  expect(html).toContain("Some bonuses require a two-handed melee or two-handed ranged weapon.");
  // Kraken's stars share one description, so it collapses to a single line.
  expect(html.match(/tip-weapon-req/g)?.length).toBe(1);
});

test("constellation tooltip omits the qualifier when no star is gated", () => {
  const html = render((tip) => tip.showConstellation(model, "anvil", 0, 0));
  expect(html).not.toContain("tip-weapon-req");
});
