// ABOUTME: Reachability engine for path-predictor mode (claim a set, see what stays achievable).
// ABOUTME: A build is valid iff its total affinity covers every member's requirement (the
// ABOUTME: self-sustaining rule the app already uses; crossroads are transient, refundable
// ABOUTME: bootstraps). minCost is bracketed by a fast cover-table lower bound (sound for "dim")
// ABOUTME: and a refund-aware greedy upper bound (sound for "reachable").
import { AFFINITIES, type DevotionModel } from "./types";

export type Vec = [number, number, number, number, number]; // order = AFFINITIES
// Hard per-color cap: the max requirement that gates anything; affinity beyond this is worthless.
const CAP_MAX: Vec = [20, 8, 20, 10, 20];
const NOCOST = 65535;
export const INF = 1e9;
export const BUDGET = 55;
// Crossroads supply 1 affinity of each color and are refundable, so any build can be seeded
// with one point per color for free while bootstrapping.
const SEED: Vec = [1, 1, 1, 1, 1];

/** A constellation reduced to what reachability needs: its cost and affinity vectors. */
export interface ReachCon { id: string; size: number; req: Vec; grant: Vec }
/** A cover table carries its own grid dimensions (sized to the model's max requirements). */
export interface CoverTable { cost: Uint16Array; caps: Vec; strides: Vec }

const zero = (): Vec => [0, 0, 0, 0, 0];
const covers = (g: Vec, d: Vec): boolean => g[0] >= d[0] && g[1] >= d[1] && g[2] >= d[2] && g[3] >= d[3] && g[4] >= d[4];
const addCap = (g: Vec, x: Vec): Vec => [Math.min(g[0] + x[0], CAP_MAX[0]!), Math.min(g[1] + x[1], CAP_MAX[1]!), Math.min(g[2] + x[2], CAP_MAX[2]!), Math.min(g[3] + x[3], CAP_MAX[3]!), Math.min(g[4] + x[4], CAP_MAX[4]!)];
const maxV = (a: Vec, b: Vec): Vec => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3]), Math.max(a[4], b[4])];

function vecOf(m: Partial<Record<(typeof AFFINITIES)[number], number>>): Vec {
  return AFFINITIES.map((a) => m[a] ?? 0) as Vec;
}

/** Reduce a DevotionModel to the compact per-constellation data the search needs. */
export function buildReachCons(model: DevotionModel): ReachCon[] {
  const out: ReachCon[] = [];
  for (const c of model.constellations.values()) {
    out.push({ id: c.id, size: c.starIds.length, req: vecOf(c.affinityRequired), grant: vecOf(c.affinityBonus) });
  }
  return out;
}

/**
 * The crossroads-refund cover table. `cost[D]` = the minimum stars of a SUBSET of distinct
 * constellations whose summed (capped) affinity reaches at least `D`. Orderability-free: because
 * bootstraps are refundable, the cheapest way to reach an affinity vector is just the cheapest
 * subset that sums to it. Built once with an in-place 0/1 knapsack DP (descending so no
 * constellation is reused), then a 5D suffix-min so a lookup answers ">= D".
 *
 * The grid is capped per color at the model's maximum requirement (affinity beyond what anything
 * requires is useless), so a small model yields a tiny grid and the real model the full one.
 *
 * This is a LOWER BOUND on the true minCost (it ignores that filler must also be self-sustaining),
 * so it is sound for dimming: if `coverLowerBound > 55`, the claim is genuinely unreachable.
 */
export function buildCoverTable(cons: ReachCon[]): CoverTable {
  const caps: Vec = zero();
  for (const c of cons) for (let i = 0; i < 5; i++) caps[i] = Math.max(caps[i]!, c.req[i]!);
  for (let i = 0; i < 5; i++) caps[i] = Math.min(caps[i]!, CAP_MAX[i]!);
  const sizes = caps.map((c) => c + 1);
  const strides = sizes.map((_, i) => sizes.slice(i + 1).reduce((a, b) => a * b, 1)) as Vec;
  const maxKey = sizes.reduce((a, b) => a * b, 1);
  const cost = new Uint16Array(maxKey).fill(NOCOST);
  cost[0] = 0;
  for (const c of cons) {
    if (!(c.grant[0] || c.grant[1] || c.grant[2] || c.grant[3] || c.grant[4])) continue;
    const [g0, g1, g2, g3, g4] = c.grant;
    for (let a = caps[0]!; a >= 0; a--) for (let ch = caps[1]!; ch >= 0; ch--) for (let e = caps[2]!; e >= 0; e--) for (let o = caps[3]!; o >= 0; o--) for (let p = caps[4]!; p >= 0; p--) {
      const k = a * strides[0]! + ch * strides[1]! + e * strides[2]! + o * strides[3]! + p;
      const pc = cost[k]!;
      if (pc === NOCOST) continue;
      const nc = pc + c.size;
      if (nc > BUDGET) continue;
      const nk = Math.min(a + g0, caps[0]!) * strides[0]! + Math.min(ch + g1, caps[1]!) * strides[1]! + Math.min(e + g2, caps[2]!) * strides[2]! + Math.min(o + g3, caps[3]!) * strides[3]! + Math.min(p + g4, caps[4]!);
      if (nc < cost[nk]!) cost[nk] = nc;
    }
  }
  for (let i = 0; i < 5; i++) { const st = strides[i]!; for (let k = maxKey - 1; k >= 0; k--) if (Math.floor(k / st) % sizes[i]! < caps[i]!) { const up = cost[k + st]!; if (up < cost[k]!) cost[k] = up; } }
  return { cost, caps, strides };
}

function claimSummary(claimed: ReachCon[]) {
  let req = zero(), grant = zero(), own = 0;
  for (const c of claimed) { req = maxV(req, c.req); grant = addCap(grant, c.grant); own += c.size; }
  return { req, grant, own };
}

/** Lower bound on minCost(claimed): own stars + cheapest filler to cover the claimed deficit. */
export function coverLowerBound(table: CoverTable, claimed: ReachCon[]): number {
  const { req, grant, own } = claimSummary(claimed);
  let k = 0;
  for (let i = 0; i < 5; i++) k += Math.min(Math.max(0, req[i]! - grant[i]!), table.caps[i]!) * table.strides[i]!;
  const cov = table.cost[k]!;
  return cov === NOCOST ? INF : own + cov;
}

/**
 * Refund-aware greedy: construct a valid build placing every claimed constellation, seeded by
 * the free crossroads, repeatedly adding the unlocked constellation that best closes the affinity
 * deficit per star. Once the claimed are placed and the build's own affinity covers every placed
 * member's requirement, the crossroads are refunded and the cost excludes them.
 *
 * SOUND for "reachable": a returned cost <= budget means a genuine valid build exists. It is an
 * upper bound on minCost (it does not always find the cheapest build).
 */
export function greedyMinCost(cons: ReachCon[], claimedIds: string[], budget = BUDGET): number {
  const byId = new Map(cons.map((c) => [c.id, c]));
  const claimed = claimedIds.map((id) => byId.get(id)!);
  const claimedSet = new Set(claimedIds);
  const filler = cons.filter((c) => !claimedSet.has(c.id) && (c.grant[0] || c.grant[1] || c.grant[2] || c.grant[3] || c.grant[4]));
  const pool = [...claimed, ...filler];
  const reqClaimed = claimSummary(claimed).req;
  const placed = new Array(pool.length).fill(false);
  let build = zero(); // affinity from placed constellations (excludes the transient seed)
  let maxReqPlaced = zero(); // every placed constellation must stand under this once seed is gone
  let cost = 0, claimedLeft = claimed.length;
  for (;;) {
    const gain = addCap(SEED, build);
    let did = false;
    // Auto-place only the claimed constellations as they unlock; filler is added selectively below.
    for (let i = 0; i < claimed.length; i++) {
      if (placed[i] || !covers(gain, claimed[i]!.req)) continue;
      placed[i] = true; cost += claimed[i]!.size; build = addCap(build, claimed[i]!.grant); maxReqPlaced = maxV(maxReqPlaced, claimed[i]!.req); claimedLeft--; did = true;
    }
    if (claimedLeft === 0 && covers(build, maxReqPlaced)) return cost <= budget ? cost : INF;
    if (did) continue;
    const g2 = addCap(SEED, build);
    const target = covers(build, maxReqPlaced) ? reqClaimed : maxReqPlaced; // close self-sustain first, then claims
    const deficit: Vec = [Math.max(0, target[0]! - build[0]), Math.max(0, target[1]! - build[1]), Math.max(0, target[2]! - build[2]), Math.max(0, target[3]! - build[3]), Math.max(0, target[4]! - build[4])];
    let best = -1, bestScore = 0;
    for (let i = claimed.length; i < pool.length; i++) {
      if (placed[i] || !covers(g2, pool[i]!.req)) continue;
      let red = 0; for (let j = 0; j < 5; j++) red += Math.min(pool[i]!.grant[j]!, deficit[j]!);
      const score = red / pool[i]!.size;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0 || bestScore === 0) return INF;
    placed[best] = true; cost += pool[best]!.size; build = addCap(build, pool[best]!.grant); maxReqPlaced = maxV(maxReqPlaced, pool[best]!.req);
    if (cost > budget) return INF;
  }
}

export type Reach = "reachable" | "dim" | "unknown";

/**
 * Classify a candidate claim by bracketing minCost. The cover lower bound soundly proves "dim";
 * the greedy upper bound soundly proves "reachable". The (rare) gap between is "unknown".
 */
export function classify(cons: ReachCon[], table: CoverTable, claimedIds: string[], budget = BUDGET): Reach {
  const byId = new Map(cons.map((c) => [c.id, c]));
  const claimed = claimedIds.map((id) => byId.get(id)!);
  if (coverLowerBound(table, claimed) > budget) return "dim";
  if (greedyMinCost(cons, claimedIds, budget) <= budget) return "reachable";
  return "unknown";
}

/** For a current claimed set S, classify every other constellation as a candidate next claim. */
export function reachabilitySweep(cons: ReachCon[], table: CoverTable, claimedIds: string[], budget = BUDGET): Map<string, Reach> {
  const out = new Map<string, Reach>();
  const claimedSet = new Set(claimedIds);
  for (const c of cons) {
    if (claimedSet.has(c.id)) continue;
    out.set(c.id, classify(cons, table, [...claimedIds, c.id], budget));
  }
  return out;
}
