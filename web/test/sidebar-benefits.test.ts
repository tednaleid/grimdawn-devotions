// ABOUTME: The Benefits panel's "Available to get" list is filtered to obtainable subjects.
// ABOUTME: A subject shows only when one of its stat ids is in the supplied availableIds set.
import { test, expect } from "bun:test";
import { renderBenefits, powersListHtml } from "../src/adapters/sidebarView";
import type { CondensedGroup } from "../src/core/statFormat";
import type { DevotionModel } from "../src/core/types";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { enLoc } from "./helpers/localizeEn";
import { litT } from "../src/core/localization";

const emptyModel = { stars: new Map(), constellations: new Map() } as unknown as DevotionModel;
const catalog: CondensedGroup[] = [
  {
    group: "Offense",
    subjects: [
      {
        subject: litT("Fire Damage"),
        key: "Offense:Fire Damage",
        parts: [{ dim: "flat", value: litT("+10"), id: "offensiveFireMin" }],
      },
      {
        subject: litT("Cold Damage"),
        key: "Offense:Cold Damage",
        parts: [{ dim: "flat", value: litT("+10"), id: "offensiveColdMin" }],
      },
    ],
  },
];

function availOf(availableIds?: Set<string>): string {
  const el = { innerHTML: "" } as unknown as HTMLElement;
  return renderBenefits(enLoc, el, emptyModel, new Set(), undefined, new Set(), catalog, availableIds).availHtml;
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
    enLoc,
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
        subject: litT("Fire Resistance"),
        key: "Defense:Fire Resistance",
        parts: [{ dim: "pct", value: litT("+10%"), id: "defensiveFire" }],
      },
      {
        subject: litT("Cold Resistance"),
        key: "Defense:Cold Resistance",
        parts: [{ dim: "pct", value: litT("+10%"), id: "defensiveCold" }],
      },
    ],
  },
];
function petAvailOf(keys?: Set<string>, tags: Set<string> = new Set()): string {
  const el = { innerHTML: "" } as unknown as HTMLElement;
  return renderBenefits(enLoc, el, emptyModel, new Set(), undefined, tags, [], undefined, undefined, petCat, keys)
    .petAvailHtml;
}

test("the active 'Bonus to All Pets' section is taggable with pet: scoped ids", () => {
  const el = { innerHTML: "" } as unknown as HTMLElement;
  renderBenefits(
    enLoc,
    el,
    realModel,
    new Set([petStar.id]),
    undefined,
    new Set(),
    [],
    undefined,
    undefined,
    [],
    undefined,
  );
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
    {
      starId: "bat:4",
      power: { nameTag: "Twin Fangs", descriptionTag: "x", proc: null, level: 1, stats: {}, pet: null },
    },
  ];
  const html = powersListHtml(enLoc, powers as any);
  expect(html).toContain('data-star-id="bat:4"');
  expect(html).toContain("Twin Fangs");
  expect(html).toContain('class="power"');
});

test("powersListHtml sorts rows by power name, not input/constellation order", () => {
  const mk = (starId: string, name: string) => ({
    starId,
    power: { nameTag: name, descriptionTag: null, proc: null, level: 1, stats: {}, pet: null },
  });
  // Input ordered by constellation/star id; output must read alphabetically by power name.
  const html = powersListHtml(enLoc, [mk("aaa:1", "Wendigo's Mark"), mk("bbb:1", "Arcane Bomb")] as any);
  expect(html.indexOf("Arcane Bomb")).toBeLessThan(html.indexOf("Wendigo's Mark"));
});

test("a selected benefit row is outlined in its search's hand color", () => {
  const bonusStar = [...realModel.stars.values()].find((s) => Object.keys(s.bonuses).length > 0)!;
  const statId = Object.keys(bonusStar.bonuses)[0]!;
  const el = { innerHTML: "" } as unknown as HTMLElement;
  renderBenefits(
    enLoc,
    el,
    realModel,
    new Set([bonusStar.id]),
    undefined,
    new Set([statId]),
    [],
    undefined,
    undefined,
    [],
    undefined,
    null,
    new Map([[statId, { angle: 90, color: "#3ee6d8" }]]),
  );
  const html = (el as unknown as { innerHTML: string }).innerHTML;
  expect(html).toMatch(/class="brow[^"]*vsel[^"]*"[^>]*style="--hand:#3ee6d8"/);
  // The row also carries a mini-star swatch wearing its hand (90 degrees: pointing right).
  const row = html.match(/<div class="brow[^"]*vsel[^"]*"[^>]*>.*?<\/div>/)![0];
  expect(row).toContain('<svg class="hand-swatch"');
  expect(row).toContain('<line x1="10.8" y1="8" x2="14.8" y2="8" stroke="#3ee6d8"');
});

test("a tagged 'available to get' chip is outlined in its first selected id's hand color", () => {
  const el = { innerHTML: "" } as unknown as HTMLElement;
  const html = renderBenefits(
    enLoc,
    el,
    emptyModel,
    new Set(),
    undefined,
    new Set(["offensiveFireMin"]),
    catalog,
    new Set(["offensiveFireMin"]),
    undefined,
    [],
    undefined,
    null,
    new Map([["offensiveFireMin", { angle: 180, color: "#ff9440" }]]),
  ).availHtml;
  expect(html).toMatch(/class="bgroup avail gsel"[^>]*style="--hand:#ff9440"/);
  // The chip wears the search's swatch too, its hand pointing the slot's way (180: straight down).
  expect(html).toContain('<svg class="hand-swatch"');
  expect(html).toContain('<line x1="8" y1="10.8" x2="8" y2="14.8" stroke="#ff9440"');
});
