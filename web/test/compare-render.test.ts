// ABOUTME: renderBenefits emits one row per value in both modes; compare adds Base/Now/Delta and the
// ABOUTME: Keep / Update Baseline controls. Tag attributes stay on the subject name and value cells.
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

test("off mode renders the Set baseline button and value rows, no compare controls", () => {
  const html = render(new Set([starGranting("offensiveTotalDamageModifier")]), null);
  expect(html).toContain('id="set-baseline"');
  expect(html).not.toContain("cmp-bar");
  expect(html).toContain("brow"); // a benefit row
  expect(html).toContain('data-vid="offensiveTotalDamageModifier"');
});

test("compare mode renders the bar, Revert / Update Baseline controls, and Base/Now/Delta cells", () => {
  const html = render(new Set([starGranting("offensiveTotalDamageModifier")]), new Set());
  expect(html).toContain("cmp-bar");
  expect(html).toContain('id="cmp-revert"');
  expect(html).toContain('id="cmp-update"');
  expect(html).not.toContain('id="cmp-clear"');
  expect(html).toContain("brow-v base"); // the Base cell
});

test("the subject name carries the group toggle and a value cell carries data-vid", () => {
  const html = render(new Set([starGranting("offensiveTotalDamageModifier")]), new Set());
  expect(html).toContain("data-gtoggle");
  expect(html).toMatch(/data-gkey="[^"]+"/);
  expect(html).toContain('data-vid="offensiveTotalDamageModifier"');
});
