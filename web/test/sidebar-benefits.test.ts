// ABOUTME: The Benefits panel's "Available to get" list is filtered to obtainable subjects.
// ABOUTME: A subject shows only when one of its stat ids is in the supplied availableIds set.
import { test, expect } from "bun:test";
import { renderBenefits, powersListHtml } from "../src/adapters/sidebarView";
import type { CondensedGroup } from "../src/core/statFormat";
import type { DevotionModel } from "../src/core/types";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";

const emptyModel = { stars: new Map(), constellations: new Map() } as unknown as DevotionModel;
const catalog: CondensedGroup[] = [
  {
    group: "Offense",
    subjects: [
      {
        subject: "Fire Damage",
        key: "Offense:Fire Damage",
        parts: [{ dim: "flat", value: "+10", id: "offensiveFireMin" }],
      },
      {
        subject: "Cold Damage",
        key: "Offense:Cold Damage",
        parts: [{ dim: "flat", value: "+10", id: "offensiveColdMin" }],
      },
    ],
  },
];

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
  const html = renderBenefits(
    el,
    emptyModel,
    new Set(),
    undefined,
    new Set(["offensiveColdMin"]),
    catalog,
    new Set(["offensiveFireMin"]),
  ).availHtml;
  expect(html).toContain("Cold Damage");
  expect(html).toContain("Fire Damage");
});

const realModel = buildModel(doc as any);
const petStar = [...realModel.stars.values()].find((s) => s.petBonuses && Object.keys(s.petBonuses).length > 0)!;
const petCat: CondensedGroup[] = [
  {
    group: "Resistances",
    subjects: [
      {
        subject: "Fire Resistance",
        key: "Defense:Fire Resistance",
        parts: [{ dim: "pct", value: "+10%", id: "defensiveFire" }],
      },
      {
        subject: "Cold Resistance",
        key: "Defense:Cold Resistance",
        parts: [{ dim: "pct", value: "+10%", id: "defensiveCold" }],
      },
    ],
  },
];
function petAvailOf(keys?: Set<string>, tags: Set<string> = new Set()): string {
  const el = { innerHTML: "" } as unknown as HTMLElement;
  return renderBenefits(el, emptyModel, new Set(), undefined, tags, [], undefined, undefined, petCat, keys)
    .petAvailHtml;
}

test("the active 'Bonus to All Pets' section is taggable with pet: scoped ids", () => {
  const el = { innerHTML: "" } as unknown as HTMLElement;
  renderBenefits(el, realModel, new Set([petStar.id]), undefined, new Set(), [], undefined, undefined, [], undefined);
  const html = (el as unknown as { innerHTML: string }).innerHTML;
  expect(html).toContain("Bonus to All Pets");
  expect(html).toMatch(/data-vid="pet:/);
});

test("pet 'available to get' lists only obtainable pet subjects, keyed pet:", () => {
  const html = petAvailOf(new Set(["pet:defensiveFire"]));
  expect(html).toContain("Fire Resistance");
  expect(html).not.toContain("Cold Resistance");
  expect(html).toContain('data-ids="pet:defensiveFire"');
});

test("pet 'available to get' is empty when nothing is obtainable", () => {
  expect(petAvailOf(new Set())).toBe("");
});

test("a tagged pet subject stays listed even when it is no longer obtainable", () => {
  const html = petAvailOf(new Set(["pet:defensiveFire"]), new Set(["pet:defensiveCold"]));
  expect(html).toContain("Cold Resistance");
});

test("powersListHtml renders each power with its star-id hook and name", () => {
  const powers = [
    { starId: "bat:4", power: { name: "Twin Fangs", description: "x", proc: null, level: 1, stats: {}, pet: null } },
  ];
  const html = powersListHtml(powers as any);
  expect(html).toContain('data-star-id="bat:4"');
  expect(html).toContain("Twin Fangs");
  expect(html).toContain('class="power"');
});

test("powersListHtml sorts rows by power name, not input/constellation order", () => {
  const mk = (starId: string, name: string) => ({
    starId,
    power: { name, description: null, proc: null, level: 1, stats: {}, pet: null },
  });
  // Input ordered by constellation/star id; output must read alphabetically by power name.
  const html = powersListHtml([mk("aaa:1", "Wendigo's Mark"), mk("bbb:1", "Arcane Bomb")] as any);
  expect(html.indexOf("Arcane Bomb")).toBeLessThan(html.indexOf("Wendigo's Mark"));
});
