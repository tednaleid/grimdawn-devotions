// ABOUTME: P1 prototype - reachability engine for the path-predictor mode (claim a set, see what stays achievable).
// ABOUTME: minCost = cheapest orderable build placing every claimed constellation. Exact is correct but
// ABOUTME: intractable on real data (NP-hard 0/1 cover); greedy is fast and sound only for "reachable".
// See docs/superpowers/specs/2026-06-21-path-predictor-reachability-design.md (P1 findings) before using.
import { AFFINITIES, type DevotionModel } from "./types";

export type Vec = [number, number, number, number, number]; // order = AFFINITIES
// Per-color cap: the max requirement that gates anything; affinity beyond this is worthless.
const CAP: Vec = [20, 8, 20, 10, 20];
const SIZES = CAP.map((c) => c + 1);
const MAXKEY = SIZES.reduce((a, b) => a * b, 1);
const STRIDE = SIZES.map((_, i) => SIZES.slice(i + 1).reduce((a, b) => a * b, 1));
export const INF = 1e9;

/** A constellation reduced to what reachability needs: its cost and affinity vectors. */
export interface ReachCon { id: string; size: number; req: Vec; grant: Vec }

const zero = (): Vec => [0, 0, 0, 0, 0];
const cap = (v: Vec): Vec => v.map((x, i) => Math.min(x, CAP[i]!)) as Vec;
const covers = (g: Vec, d: Vec): boolean => g[0]! >= d[0]! && g[1]! >= d[1]! && g[2]! >= d[2]! && g[3]! >= d[3]! && g[4]! >= d[4]!;
const packV = (v: Vec): number => v.reduce((k, x, i) => k + Math.min(Math.max(x, 0), CAP[i]!) * STRIDE[i]!, 0);
const addCap = (g: Vec, x: Vec): Vec => [Math.min(g[0]! + x[0]!, CAP[0]!), Math.min(g[1]! + x[1]!, CAP[1]!), Math.min(g[2]! + x[2]!, CAP[2]!), Math.min(g[3]! + x[3]!, CAP[3]!), Math.min(g[4]! + x[4]!, CAP[4]!)];
const maxV = (a: Vec, b: Vec): Vec => [Math.max(a[0]!, b[0]!), Math.max(a[1]!, b[1]!), Math.max(a[2]!, b[2]!), Math.max(a[3]!, b[3]!), Math.max(a[4]!, b[4]!)];

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
 * Exact min-cost: the cheapest orderable build that completes every claimed constellation
 * (plus optional affinity "filler"). A* over placed-sets (bitmask = true 0/1), a constellation
 * may be placed only once affinity already meets its requirement (orderability built in), with
 * an admissible per-color ratio heuristic.
 *
 * CORRECT (validated against a brute-force oracle) but NP-hard: on the real 109-constellation
 * data it explores ~550K nodes for a single capstone and exceeds nodeCap for two. Not for the
 * interactive hot path without WASM or approximation. Returns capped:true when it gives up.
 */
export function exactMinCost(cons: ReachCon[], claimedIds: string[], budget = 55, nodeCap = 3_000_000): { cost: number; explored: number; capped: boolean } {
  const byId = new Map(cons.map((c) => [c.id, c]));
  const claimed = claimedIds.map((id) => byId.get(id)!);
  const claimedSet = new Set(claimedIds);
  const filler = cons.filter((c) => !claimedSet.has(c.id) && c.grant.some((x) => x > 0));
  const relevant = [...claimed, ...filler];
  const n = relevant.length;
  const goal = (1n << BigInt(claimed.length)) - 1n;
  const maxReq = claimed.reduce((r, c) => maxV(r, c.req), zero());
  const maxRatio = zero();
  for (const c of relevant) for (let i = 0; i < 5; i++) if (c.grant[i]! > 0) maxRatio[i] = Math.max(maxRatio[i]!, c.grant[i]! / c.size);
  const heuristic = (mask: bigint, gain: Vec): number => {
    let lb1 = 0;
    for (let i = 0; i < claimed.length; i++) if (!(mask & (1n << BigInt(i)))) lb1 += claimed[i]!.size;
    let lb2 = 0;
    for (let i = 0; i < 5; i++) { const d = maxReq[i]! - gain[i]!; if (d > 0) { if (maxRatio[i]! === 0) return INF; lb2 = Math.max(lb2, Math.ceil(d / maxRatio[i]!)); } }
    return Math.max(lb1, lb2);
  };
  const h0 = heuristic(0n, zero());
  if (h0 > budget) return { cost: INF, explored: 0, capped: false };
  const buckets: { mask: bigint; gain: Vec; cost: number }[][] = Array.from({ length: budget + 1 }, () => []);
  buckets[h0]!.push({ mask: 0n, gain: zero(), cost: 0 });
  const seen = new Set<bigint>();
  let explored = 0;
  for (let f = 0; f <= budget; f++) {
    const bucket = buckets[f]!;
    for (let bi = 0; bi < bucket.length; bi++) {
      const node = bucket[bi]!;
      if (seen.has(node.mask)) continue;
      seen.add(node.mask);
      if (++explored > nodeCap) return { cost: INF, explored, capped: true };
      if ((node.mask & goal) === goal) return { cost: node.cost, explored, capped: false };
      for (let i = 0; i < n; i++) {
        const bit = 1n << BigInt(i);
        if (node.mask & bit) continue;
        const c = relevant[i]!;
        if (!covers(node.gain, c.req)) continue;
        const nc = node.cost + c.size;
        if (nc > budget) continue;
        const nmask = node.mask | bit;
        if (seen.has(nmask)) continue;
        const ng = addCap(node.gain, c.grant);
        const nf = nc + heuristic(nmask, ng);
        if (nf > budget) continue;
        buckets[nf]!.push({ mask: nmask, gain: ng, cost: nc });
      }
    }
  }
  return { cost: INF, explored, capped: false };
}

/**
 * Greedy min-cost upper bound: build an orderable set placing all claimed, repeatedly adding the
 * unlocked constellation that most reduces the remaining claimed deficit per star. FAST (a full
 * 109-candidate sweep is a few ms) and SOUND for "reachable": if it returns <= budget the build
 * genuinely exists. NOT sound for "dim": returning > budget does not prove infeasibility
 * (measured ~8% false dims vs the exact oracle on random models).
 */
export function greedyMinCost(cons: ReachCon[], claimedIds: string[], budget = 55): number {
  const byId = new Map(cons.map((c) => [c.id, c]));
  const claimed = claimedIds.map((id) => byId.get(id)!);
  const claimedSet = new Set(claimedIds);
  const maxReq = claimed.reduce((r, c) => maxV(r, c.req), zero());
  const filler = cons.filter((c) => !claimedSet.has(c.id) && c.grant.some((x) => x > 0));
  const need = [...claimed, ...filler];
  const placed = new Array(need.length).fill(false);
  let gain = zero(), cost = 0, claimedLeft = claimed.length;
  for (;;) {
    let did = false;
    for (let i = 0; i < claimed.length; i++) if (!placed[i] && covers(gain, need[i]!.req)) { placed[i] = true; claimedLeft--; cost += need[i]!.size; gain = addCap(gain, need[i]!.grant); did = true; }
    if (claimedLeft === 0) return cost <= budget ? cost : INF;
    if (did) continue;
    const deficit = maxReq.map((x, i) => Math.max(0, x - gain[i]!)) as Vec;
    let best = -1, bestScore = 0;
    for (let i = claimed.length; i < need.length; i++) {
      if (placed[i] || !covers(gain, need[i]!.req)) continue;
      let red = 0; for (let j = 0; j < 5; j++) red += Math.min(need[i]!.grant[j]!, deficit[j]!);
      const score = red / need[i]!.size;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0 || bestScore === 0) return INF;
    placed[best] = true; cost += need[best]!.size; gain = addCap(gain, need[best]!.grant);
    if (cost > budget) return INF;
  }
}

/**
 * Dense reuse-relaxation lower bound: min cost (reuse allowed, requirements respected) to reach
 * each affinity vector, as a 5D suffix-min cover table. An admissible lower bound on the exact
 * minCost: if even this exceeds the budget the set definitely dims. On real data it stays under
 * budget for the borderline cases, so it confirms few dims on its own. ~900 KB, built once.
 */
export function buildReuseCover(cons: ReachCon[]): Uint16Array {
  const granting = cons.filter((c) => c.grant.some((x) => x > 0));
  const cost = new Uint16Array(MAXKEY).fill(65535);
  cost[0] = 0;
  const buckets: number[][] = Array.from({ length: 56 }, () => []);
  buckets[0]!.push(0);
  for (let d = 0; d <= 55; d++) {
    for (const k of buckets[d]!) {
      if (cost[k]! !== d) continue;
      const s0 = Math.floor(k / STRIDE[0]!) % SIZES[0]!, s1 = Math.floor(k / STRIDE[1]!) % SIZES[1]!, s2 = Math.floor(k / STRIDE[2]!) % SIZES[2]!, s3 = Math.floor(k / STRIDE[3]!) % SIZES[3]!, s4 = k % SIZES[4]!;
      for (const c of granting) {
        if (s0 < c.req[0]! || s1 < c.req[1]! || s2 < c.req[2]! || s3 < c.req[3]! || s4 < c.req[4]!) continue;
        const nc = d + c.size; if (nc > 55) continue;
        const nk = Math.min(s0 + c.grant[0]!, CAP[0]!) * STRIDE[0]! + Math.min(s1 + c.grant[1]!, CAP[1]!) * STRIDE[1]! + Math.min(s2 + c.grant[2]!, CAP[2]!) * STRIDE[2]! + Math.min(s3 + c.grant[3]!, CAP[3]!) * STRIDE[3]! + Math.min(s4 + c.grant[4]!, CAP[4]!);
        if (nc < cost[nk]!) { cost[nk] = nc; buckets[nc]!.push(nk); }
      }
    }
  }
  for (let i = 0; i < 5; i++) { const st = STRIDE[i]!; for (let k = MAXKEY - 1; k >= 0; k--) if (Math.floor(k / st) % SIZES[i]! < CAP[i]!) { const up = cost[k + st]!; if (up < cost[k]!) cost[k] = up; } }
  return cost;
}

/** Lower bound on the cost to gain `deficit` more affinity, via the reuse cover table. */
export function reuseLowerBound(cover: Uint16Array, deficit: Vec): number {
  const v = cover[packV(deficit)]!;
  return v === 65535 ? INF : v;
}
