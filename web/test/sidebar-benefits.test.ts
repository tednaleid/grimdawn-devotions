// ABOUTME: The Benefits panel's "Available to get" list is filtered to obtainable subjects.
// ABOUTME: A subject shows only when one of its stat ids is in the supplied availableIds set.
import { test, expect } from "bun:test";
import { renderBenefits } from "../src/adapters/sidebarView";
import type { CondensedGroup } from "../src/core/statFormat";
import type { DevotionModel } from "../src/core/types";

const emptyModel = { stars: new Map(), constellations: new Map() } as unknown as DevotionModel;
const catalog: CondensedGroup[] = [{
  group: "Offense",
  subjects: [
    { subject: "Fire Damage", key: "Offense:Fire Damage", parts: [{ dim: "flat", value: "+10", id: "offensiveFireMin" }] },
    { subject: "Cold Damage", key: "Offense:Cold Damage", parts: [{ dim: "flat", value: "+10", id: "offensiveColdMin" }] },
  ],
}];

function availOf(availableIds?: Set<string>): string {
  const el = { innerHTML: "" } as unknown as HTMLElement;
  return renderBenefits(el, emptyModel, new Set(), undefined, new Set(), catalog, availableIds).availHtml;
}

test("'available to get' lists only subjects with an obtainable stat id", () => {
  const html = availOf(new Set(["offensiveFireMin"]));
  expect(html).toContain("Fire Damage");
  expect(html).not.toContain("Cold Damage");
});

test("'available to get' is empty when nothing is obtainable", () => {
  expect(availOf(new Set())).toBe("");
});

test("without an availability filter, all inactive subjects are listed", () => {
  const html = availOf(undefined);
  expect(html).toContain("Fire Damage");
  expect(html).toContain("Cold Damage");
});

test("a tagged subject stays listed even when it is no longer obtainable (so it can be untagged)", () => {
  const el = { innerHTML: "" } as unknown as HTMLElement;
  // Cold is absent from availableIds (unobtainable) but tagged; it must remain in the list.
  const html = renderBenefits(el, emptyModel, new Set(), undefined, new Set(["offensiveColdMin"]), catalog, new Set(["offensiveFireMin"])).availHtml;
  expect(html).toContain("Cold Damage");
  expect(html).toContain("Fire Damage");
});
