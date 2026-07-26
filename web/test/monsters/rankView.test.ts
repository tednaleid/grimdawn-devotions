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
  // Three divisors must be told apart, so three numbers must differ: the shared peak, the
  // row's own tallest bucket, and rows.length. Four rows where fire is spread one-per-bucket
  // while every other type doubles up gives fire's own max 1, a shared peak of 2, and
  // rows.length 4. Fire's populated bars are then 50% under the correct implementation,
  // 100% if scaled to fire's own peak, and 25% if scaled to the row count.
  const all = (v: number) => Object.fromEntries(DAMAGE_TYPES.map((t) => [t, v])) as Resistances;
  const rows = [
    mon({ ...all(10), fire: 10 }),
    mon({ ...all(10), fire: 30 }),
    mon({ ...all(30), fire: 50 }),
    mon({ ...all(30), fire: 70 }),
  ];
  const html = rankMarkup(loc, rows, ZERO, false);

  const barsOf = (type: string) =>
    [
      ...html
        .split(`data-type="${type}"`)[1]!
        .split("</div>")[0]!
        .matchAll(/height:([\d.]+)%/g),
    ]
      .map((m) => Number(m[1]))
      .filter((h) => h > 0);

  // Fire holds one row in each of four buckets; half the shared peak of 2.
  expect(barsOf("fire")).toEqual([50, 50, 50, 50]);
  // Cold holds two rows in each of two buckets, which is the shared peak itself.
  expect(barsOf("cold")).toEqual([100, 100]);
});

test("mean and median render in their own columns and are not interchangeable", () => {
  // The two must differ numerically or a swap is undetectable. A two-value fixture always has
  // mean equal to median, so this uses three skewed values: mean 40, median 20.
  const rows = [mon({ fire: 10 }), mon({ fire: 20 }), mon({ fire: 90 })];
  const fireRow = rankMarkup(loc, rows, ZERO, false).split('data-type="fire"')[1]!;
  expect(fireRow).toContain('class="rank-mean">40.0<');
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
