// ABOUTME: Markup tests for the ranking view: ordering, bucket bars, shared scale, empty state.
// ABOUTME: The localization stub echoes keys, so assertions never depend on English wording.
import { test, expect } from "bun:test";
import { rankMarkup } from "../../src/monsters/adapters/rankView";
import { DAMAGE_TYPES } from "../../src/monsters/core/facets";
import type { Localization } from "../../src/ports/Localization";
import type { Monster, Resistances } from "../../src/monsters/core/model";

const ZERO = Object.fromEntries(DAMAGE_TYPES.map((t) => [t, 0])) as Resistances;
const loc: Localization = { translate: (k) => k, gameText: (t) => t, locale: "en" };

function mon(res: Partial<Resistances>, over: Partial<Monster> = {}): Monster {
  return {
    id: `enemies.${Object.entries(res)
      .map(([k, v]) => `${k}${v}`)
      .join("_")}`,
    nameTag: "tagX",
    classification: "Hero",
    role: "hero",
    raceTag: null,
    minLevel: 1,
    maxLevel: 100,
    isSummon: false,
    variantCount: 1,
    variantsDisagree: false,
    resistances: { ...ZERO, ...res },
    passive: {},
    aura: {},
    ...over,
  };
}

/** The order type names appear in the markup, which is the ranked order. */
function orderOf(html: string): string[] {
  return [...html.matchAll(/data-type="([a-z]+)"/g)].map((m) => m[1]!);
}

test("renders one row per damage type, ordered by mean ascending", () => {
  const html = rankMarkup(loc, [mon({ fire: 90 }), mon({ cold: 10 })], ZERO, false);
  const order = orderOf(html);
  expect(order).toHaveLength(10);
  expect(order.indexOf("cold")).toBeLessThan(order.indexOf("fire"));
});

test("each row carries one bar per bucket", () => {
  const html = rankMarkup(loc, [mon({ fire: 50 })], ZERO, false);
  const rows = html.split('class="rank-grid rank-row"').slice(1);
  expect(rows).toHaveLength(10);
  expect([...rows[0]!.matchAll(/class="hbar/g)]).toHaveLength(13);
});

test("bar heights scale to the shared peak, not per row and not to the row count", () => {
  // Three rows, every type spread across two buckets (two at 10, one at 30), so each type's
  // tallest bucket holds 2. The peak is therefore 2 while rows.length is 3, which separates
  // three different implementations: scaling to the shared peak gives 100%/50%, scaling per
  // row gives the same here but differs elsewhere, and scaling to rows.length gives 67%/33%.
  // A fixture where peak and rows.length coincide cannot tell the last one apart.
  const all = (v: number) => Object.fromEntries(DAMAGE_TYPES.map((t) => [t, v])) as Resistances;
  const html = rankMarkup(loc, [mon(all(10)), mon(all(10)), mon(all(30))], ZERO, false);
  const fireRow = html.split('data-type="fire"')[1]!.split("</div>")[0]!;
  const heights = [...fireRow.matchAll(/height:([\d.]+)%/g)].map((m) => Number(m[1]));
  const populated = heights.filter((h) => h > 0).sort((a, b) => b - a);
  expect(populated[0]).toBeCloseTo(100, 0); // the bucket holding 2, at the shared peak
  expect(populated[1]).toBeCloseTo(50, 0); // the bucket holding 1, half of it
});

test("mean and median are rendered per row", () => {
  const html = rankMarkup(loc, [mon({ fire: 10 }), mon({ fire: 30 })], ZERO, false);
  const fireRow = html.split('data-type="fire"')[1]!;
  expect(fireRow).toContain('class="rank-mean">20.0<');
  expect(fireRow).toContain('class="rank-median">20<');
});

test("the difficulty offset shifts the rendered mean", () => {
  const html = rankMarkup(loc, [mon({ fire: 10 })], { ...ZERO, fire: 8 } as Resistances, false);
  expect(html.split('data-type="fire"')[1]!).toContain('class="rank-mean">18.0<');
});

test("including auras changes the rendered mean", () => {
  const m = mon({ cold: 10 }, { aura: { cold: 20 } });
  expect(rankMarkup(loc, [m], ZERO, true).split('data-type="cold"')[1]!).toContain('class="rank-mean">30.0<');
  expect(rankMarkup(loc, [m], ZERO, false).split('data-type="cold"')[1]!).toContain('class="rank-mean">10.0<');
});

test("bucket counts are rendered, and an empty bucket shows no number", () => {
  const html = rankMarkup(loc, [mon({ fire: 5 })], ZERO, false);
  const fireRow = html.split('data-type="fire"')[1]!;
  expect(fireRow).toContain('class="hcount">1<');
  expect(fireRow).toContain('class="hcount"><'); // the empty buckets
});

test("an empty population renders an honest empty state, not a zeroed chart", () => {
  const html = rankMarkup(loc, [], ZERO, false);
  expect(html).toContain("monsters.rank.empty");
  expect(html).not.toContain("rank-row");
});

test("the header labels the mean and median columns", () => {
  const html = rankMarkup(loc, [mon({ fire: 1 })], ZERO, false);
  expect(html).toContain("monsters.rank.mean");
  expect(html).toContain("monsters.rank.median");
});
