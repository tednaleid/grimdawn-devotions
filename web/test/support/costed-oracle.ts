// ABOUTME: The exact minimum construction-peak oracle (minPeakCost), shared by the real-map false-reach hunt
// ABOUTME: and the build-order validation harness. A DP over the placement order of a build's granting members
// ABOUTME: (2^k, k small); the transient scaffold to cover each shortfall is the exact peakToReach. Returns the
// ABOUTME: true min peak when <= budget, INF when it provably exceeds the budget (or the build is not
// ABOUTME: self-covering), and NaN when there are too many granting members to enumerate (bail).
import { peakToReach, INF, BUDGET, type CoverTable, type ReachCon, type Vec } from "../../src/core/reachability";

const CAP_MAX: Vec = [20, 8, 20, 10, 20]; // per-color affinity cap
const zero = (): Vec => [0, 0, 0, 0, 0];
const covers = (g: Vec, d: Vec): boolean =>
  g[0] >= d[0] && g[1] >= d[1] && g[2] >= d[2] && g[3] >= d[3] && g[4] >= d[4];
const addCap = (g: Vec, x: Vec): Vec => [
  Math.min(g[0] + x[0], CAP_MAX[0]),
  Math.min(g[1] + x[1], CAP_MAX[1]),
  Math.min(g[2] + x[2], CAP_MAX[2]),
  Math.min(g[3] + x[3], CAP_MAX[3]),
  Math.min(g[4] + x[4], CAP_MAX[4]),
];
const maxV = (a: Vec, b: Vec): Vec => [
  Math.max(a[0], b[0]),
  Math.max(a[1], b[1]),
  Math.max(a[2], b[2]),
  Math.max(a[3], b[3]),
  Math.max(a[4], b[4]),
];

const DP_MAX = 18;

export function minPeakCost(cons: ReachCon[], table: CoverTable, B: ReachCon[], budget = BUDGET): number {
  let tot = zero();
  let mreq = zero();
  let totalSize = 0;
  for (const m of B) {
    tot = addCap(tot, m.grant);
    mreq = maxV(mreq, m.req);
    totalSize += m.size;
  }
  if (!covers(tot, mreq)) return INF; // not self-covering
  const grants = (c: ReachCon) => c.grant[0] || c.grant[1] || c.grant[2] || c.grant[3] || c.grant[4];
  const G = B.filter(grants);
  const n = G.length;
  if (n === 0) return totalSize;
  if (n > DP_MAX) return NaN; // pathological; bail rather than vendor the greedy fallback
  const inB = new Set(B.map((b) => b.id));
  const scaffoldPool = cons.filter((c) => !inB.has(c.id));
  const size = 1 << n;
  const gMask: Vec[] = new Array(size);
  const rMask: Vec[] = new Array(size);
  const sMask = new Int32Array(size);
  gMask[0] = zero();
  rMask[0] = zero();
  for (let mask = 1; mask < size; mask++) {
    const b = 31 - Math.clz32(mask & -mask);
    const pred = mask ^ (1 << b);
    gMask[mask] = addCap(gMask[pred]!, G[b]!.grant);
    rMask[mask] = maxV(rMask[pred]!, G[b]!.req);
    sMask[mask] = sMask[pred]! + G[b]!.size;
  }
  const pcache = new Map<string, number>();
  const ptr = (def: Vec, base: Vec): number => {
    if (def[0] <= 0 && def[1] <= 0 && def[2] <= 0 && def[3] <= 0 && def[4] <= 0) return 0;
    const k = `${def[0]},${def[1]},${def[2]},${def[3]},${def[4]}|${base[0]},${base[1]},${base[2]},${base[3]},${base[4]}`;
    let v = pcache.get(k);
    if (v === undefined) {
      v = peakToReach(scaffoldPool, table, def, base);
      pcache.set(k, v);
    }
    return v;
  };
  const dp = new Float64Array(size).fill(INF);
  dp[0] = 0;
  for (let mask = 1; mask < size; mask++) {
    const mr = rMask[mask]!;
    const sz = sMask[mask]!;
    let best = INF;
    let m = mask;
    while (m) {
      const b = 31 - Math.clz32(m & -m);
      m &= m - 1;
      const pred = mask ^ (1 << b);
      if (dp[pred]! >= INF) continue;
      const gp = gMask[pred]!;
      const def: Vec = [
        Math.max(0, mr[0] - gp[0]),
        Math.max(0, mr[1] - gp[1]),
        Math.max(0, mr[2] - gp[2]),
        Math.max(0, mr[3] - gp[3]),
        Math.max(0, mr[4] - gp[4]),
      ];
      const sc = ptr(def, gp);
      if (sc >= INF) continue;
      const peak = Math.max(dp[pred]!, sz + sc);
      if (peak < best) best = peak;
    }
    dp[mask] = best > budget ? INF : best;
  }
  return Math.max(dp[size - 1]!, totalSize);
}
