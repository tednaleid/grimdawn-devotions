// ABOUTME: Ranking statistics for the monster page: mean, median, and the shared-scale histogram.
// ABOUTME: Pure; returns null for an empty population so the view can show an honest empty state.
import { DAMAGE_TYPES } from "./facets";
import { effective, type DamageType, type Monster, type Resistances } from "./model";

export interface Bucket {
  /** Inclusive lower edge. */
  lo: number;
  /** Exclusive upper edge. */
  hi: number;
  key: string;
}

/** Thirteen contiguous buckets over the effective value.
 *
 *  `<0` is kept separate from `0` because a negative resistance means the monster takes
 *  extra damage, which is the opposite conclusion from merely having none.
 */
export const BUCKETS: Bucket[] = [
  { lo: -Infinity, hi: 0, key: "<0" },
  { lo: 0, hi: 1, key: "0" },
  { lo: 1, hi: 10, key: "1-9" },
  { lo: 10, hi: 20, key: "10-19" },
  { lo: 20, hi: 30, key: "20-29" },
  { lo: 30, hi: 40, key: "30-39" },
  { lo: 40, hi: 50, key: "40-49" },
  { lo: 50, hi: 60, key: "50-59" },
  { lo: 60, hi: 70, key: "60-69" },
  { lo: 70, hi: 80, key: "70-79" },
  { lo: 80, hi: 90, key: "80-89" },
  { lo: 90, hi: 100, key: "90-99" },
  { lo: 100, hi: Infinity, key: "100+" },
];

export interface TypeStats {
  type: DamageType;
  mean: number;
  median: number;
  /** One count per entry of BUCKETS, same order. */
  counts: number[];
}

function bucketIndex(v: number): number {
  for (let i = 0; i < BUCKETS.length; i++) {
    const b = BUCKETS[i]!;
    if (v >= b.lo && v < b.hi) return i;
  }
  // Unreachable: the edges are contiguous from -Infinity to Infinity.
  return BUCKETS.length - 1;
}

/** Per-type statistics over a population, sorted by mean ascending, plus the shared bar scale.
 *
 *  `peak` is the tallest bucket across ALL types, not per type: the ten histograms share one
 *  vertical scale so their shapes compare directly, which is the point of showing them together.
 *
 *  Returns null for an empty population, because a mean over zero rows is not a number and a
 *  zero-filled chart would read as "no resistance" rather than "no data".
 */
export function rankTypes(
  rows: Monster[],
  offsets: Resistances,
  includeAuras: boolean,
): { stats: TypeStats[]; peak: number } | null {
  if (!rows.length) return null;

  // One pass over the rows building every type's values at once, rather than ten passes.
  const values: number[][] = DAMAGE_TYPES.map(() => []);
  for (const m of rows) {
    const e = effective(m, offsets, includeAuras);
    for (let i = 0; i < DAMAGE_TYPES.length; i++) values[i]!.push(e[DAMAGE_TYPES[i]!]);
  }

  let peak = 0;
  const stats: TypeStats[] = DAMAGE_TYPES.map((type, i) => {
    const vals = values[i]!;
    const counts = BUCKETS.map(() => 0);
    let sum = 0;
    for (const v of vals) {
      sum += v;
      counts[bucketIndex(v)]!++;
    }
    for (const n of counts) if (n > peak) peak = n;
    const sorted = [...vals].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    return { type, mean: sum / vals.length, median, counts };
  });

  // Ties break on the canonical type order so the ranking is deterministic run to run.
  stats.sort((a, b) => a.mean - b.mean || DAMAGE_TYPES.indexOf(a.type) - DAMAGE_TYPES.indexOf(b.type));
  return { stats, peak };
}
