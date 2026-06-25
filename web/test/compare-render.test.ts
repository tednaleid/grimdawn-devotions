// ABOUTME: renderBenefits compare mode emits the Base/Now/Delta table, keeps tag attributes on labels,
// ABOUTME: and shows the compare control bar; off mode is unchanged. Uses real model data.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { renderBenefits } from "../src/adapters/sidebarView";

const model = buildModel(doc as any);

function starGranting(stat: string): string {
  for (const s of model.stars.values()) if (s.bonuses[stat] !== undefined) return s.id;
  throw new Error(`no star grants ${stat}`);
}
function render(selected: Set<string>, baseline: Set<string> | null): string {
  const el = { innerHTML: "" } as any as HTMLElement;
  renderBenefits(el, model, selected, undefined, new Set(), [], undefined, undefined, [], undefined, baseline);
  return (el as any).innerHTML as string;
}

test("off mode (no baseline) renders the Set baseline button, no compare bar", () => {
  const html = render(new Set([starGranting("offensiveTotalDamageModifier")]), null);
  expect(html).toContain('id="set-baseline"');
  expect(html).not.toContain("cmp-bar");
});

test("compare mode renders the compare bar and Base/Now/Delta columns", () => {
  const star = starGranting("offensiveTotalDamageModifier");
  const html = render(new Set([star]), new Set());
  expect(html).toContain("cmp-bar");
  expect(html).toContain('id="cmp-update"');
  expect(html).toContain('id="cmp-clear"');
  expect(html).toContain("cmp-col"); // the Base/Now/Delta cells
});

test("compare mode keeps the part tag attribute on the clickable label", () => {
  const star = starGranting("offensiveTotalDamageModifier");
  const html = render(new Set([star]), new Set());
  expect(html).toContain('data-vid="offensiveTotalDamageModifier"');
});
