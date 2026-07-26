// ABOUTME: Tests for the ranking statistics: mean, median, bucket edges, and the shared peak.
// ABOUTME: The empty-set case is pinned here because a NaN mean would render as a broken chart.
import { test, expect } from "bun:test";
import { BUCKETS, rankTypes } from "../../src/monsters/core/stats";
import { DAMAGE_TYPES } from "../../src/monsters/core/facets";
import type { Monster, Resistances } from "../../src/monsters/core/model";

const ZERO = Object.fromEntries(DAMAGE_TYPES.map((t) => [t, 0])) as Resistances;

function mon(res: Partial<Resistances>, over: Partial<Monster> = {}): Monster {
  return {
    id: "enemies.x",
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

test("there are thirteen buckets in the specified order", () => {
  expect(BUCKETS.map((b) => b.key)).toEqual([
    "<0",
    "0",
    "1-9",
    "10-19",
    "20-29",
    "30-39",
    "40-49",
    "50-59",
    "60-69",
    "70-79",
    "80-89",
    "90-99",
    "100+",
  ]);
});

test("bucket edges are contiguous and cover every real value exactly once", () => {
  const probes = [-50, -1, 0, 1, 9, 10, 55, 99, 100, 500];
  for (const v of probes) {
    const hits = BUCKETS.filter((b) => v >= b.lo && v < b.hi);
    expect(hits).toHaveLength(1);
  }
});

test("rankTypes orders by mean ascending, weakest first", () => {
  const rows = [mon({ fire: 90, cold: 10 }), mon({ fire: 70, cold: 0 })];
  const r = rankTypes(rows, ZERO, false)!;
  expect(r.stats[0]!.type).toBe("physical"); // all zero, so it ties at the bottom
  const fire = r.stats.find((s) => s.type === "fire")!;
  const cold = r.stats.find((s) => s.type === "cold")!;
  expect(fire.mean).toBe(80);
  expect(cold.mean).toBe(5);
  expect(r.stats.indexOf(cold)).toBeLessThan(r.stats.indexOf(fire));
});

test("median is the middle value for odd counts and the midpoint for even", () => {
  const odd = rankTypes([mon({ fire: 10 }), mon({ fire: 20 }), mon({ fire: 90 })], ZERO, false)!;
  expect(odd.stats.find((s) => s.type === "fire")!.median).toBe(20);
  const even = rankTypes([mon({ fire: 10 }), mon({ fire: 20 })], ZERO, false)!;
  expect(even.stats.find((s) => s.type === "fire")!.median).toBe(15);
});

test("counts land in the right buckets, including negative and 100+", () => {
  const rows = [mon({ fire: -20 }), mon({ fire: 0 }), mon({ fire: 5 }), mon({ fire: 95 }), mon({ fire: 250 })];
  const fire = rankTypes(rows, ZERO, false)!.stats.find((s) => s.type === "fire")!;
  const byKey = Object.fromEntries(BUCKETS.map((b, i) => [b.key, fire.counts[i]]));
  expect(byKey["<0"]).toBe(1);
  expect(byKey["0"]).toBe(1);
  expect(byKey["1-9"]).toBe(1);
  expect(byKey["90-99"]).toBe(1);
  expect(byKey["100+"]).toBe(1);
});

test("every type's counts sum to the row count", () => {
  const rows = [mon({ fire: 10 }), mon({ cold: -5 }), mon({ vitality: 300 })];
  const r = rankTypes(rows, ZERO, false)!;
  for (const s of r.stats) {
    expect(s.counts.reduce((a, b) => a + b, 0)).toBe(rows.length);
  }
});

test("peak is the tallest bucket across all ten types, not per type", () => {
  // Every type must be spread across at least two buckets for this to discriminate. An
  // all-zero type puts all N rows in the "0" bucket, which is the largest count possible,
  // so peak would equal N however it was computed and the test would pass against a
  // per-type-peak bug. Here fire alone reaches 3 while every other type maxes at 2.
  const all = (v: number) => Object.fromEntries(DAMAGE_TYPES.map((t) => [t, v])) as Resistances;
  const rows = [mon(all(10)), mon(all(10)), mon({ ...all(30), fire: 10 }), mon({ ...all(30), fire: 50 })];
  const r = rankTypes(rows, ZERO, false)!;

  const maxOf = (type: string) => Math.max(...r.stats.find((s) => s.type === type)!.counts);
  expect(maxOf("fire")).toBe(3); // 10,10,10 in "10-19", then 50 alone
  expect(maxOf("cold")).toBe(2); // 10,10 then 30,30: two buckets of two
  expect(r.peak).toBe(3); // the global maximum, contributed by fire only

  // Nothing else ties fire, so a peak taken from any single other type would read 2.
  for (const s of r.stats) {
    if (s.type !== "fire") expect(Math.max(...s.counts)).toBeLessThan(3);
  }
});

// The explicit `DAMAGE_TYPES.indexOf` tie-break in rankTypes is deliberately not tested.
// stats are built in canonical order and Array.prototype.sort has been stable since ES2019,
// so a tie group already arrives in canonical order and resolves correctly with or without
// the tie-break. No test driving rankTypes can distinguish the two, and a test asserting
// something that holds either way would assert nothing. The clause stays as documentation of
// intent and as insurance against a future non-stable sort.

test("the difficulty offset shifts values into different buckets", () => {
  const rows = [mon({ fire: 0 })];
  const shifted = rankTypes(rows, { ...ZERO, fire: 8 } as Resistances, false)!;
  const fire = shifted.stats.find((s) => s.type === "fire")!;
  const byKey = Object.fromEntries(BUCKETS.map((b, i) => [b.key, fire.counts[i]]));
  expect(byKey["0"]).toBe(0);
  expect(byKey["1-9"]).toBe(1);
});

test("including auras changes the mean", () => {
  const rows = [mon({ cold: 10 }, { aura: { cold: 20 } })];
  expect(rankTypes(rows, ZERO, false)!.stats.find((s) => s.type === "cold")!.mean).toBe(10);
  expect(rankTypes(rows, ZERO, true)!.stats.find((s) => s.type === "cold")!.mean).toBe(30);
});

test("an empty row set returns null rather than NaN statistics", () => {
  expect(rankTypes([], ZERO, false)).toBeNull();
});
