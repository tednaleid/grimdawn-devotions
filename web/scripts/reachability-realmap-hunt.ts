// ABOUTME: Real-map false-reach hunt. Generates tight near-budget self-covering REAL Grim Dawn builds biased
// ABOUTME: toward the Affliction-like shape (multi-color requirement that grants those colors back but not
// ABOUTME: enough to self-pay), asks the SHIPPED engine (classifyForSelection) whether it lights them, then
// ABOUTME: decides construction feasibility two-stage: minPeakSampled is a SOUND reachable-witness filter (a
// ABOUTME: <=55 sampled order is a real construction), and only no-witness suspects hit the order-exact
// ABOUTME: min-peak DP minPeakCost (vendored from branch reachability-costed-scaffolding). A build the engine
// ABOUTME: lights whose exact min-peak exceeds 55 is a confirmed real-map false-reach. Run `just realmap-hunt`
// ABOUTME: [--seeds N] [--start S] [--dump K] | --probe SEEDS [--tries N] | --url SEEDS].
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import {
  buildReachCons,
  buildCoverTable,
  classifyForSelection,
  minPeakSampled,
  minPeakSampledOrder,
  peakToReach,
  INF,
  type CoverTable,
  type ReachCon,
  type Vec,
} from "../src/core/reachability";
import { canonicalStarIds, encodeHash } from "../src/core/urlState";
import { stateFromCounts, mulberry32, type Counts } from "../test/support/reach-oracle";
import { genSelfCovering } from "../test/support/walk-fuzzer";

const argNum = (flag: string, def: number): number => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] !== undefined ? Number(process.argv[i + 1]) : def;
};
const SEEDS = argNum("--seeds", 20000);
const START = argNum("--start", 1);
const DUMP = argNum("--dump", 5);
const BUDGET = 55;

// Affinity helpers shared by the exact oracle below (definitions mirror the module-private ones in
// web/src/core/reachability.ts; CAP_MAX is the per-color affinity cap).
const CAP_MAX: Vec = [20, 8, 20, 10, 20];
const zero = (): Vec => [0, 0, 0, 0, 0];
const covers = (g: Vec, d: Vec): boolean => g[0] >= d[0] && g[1] >= d[1] && g[2] >= d[2] && g[3] >= d[3] && g[4] >= d[4];
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

// Exact minimum construction peak, vendored from `minPeakCost` on branch reachability-costed-scaffolding
// (web/src/core/reachability.ts). A DP over the placement ORDER of the build's granting members (2^k, k
// small); for the last member added to a subset, the transient scaffold to cover the shortfall is the
// exact peakToReach (which is exported from main). Returns the true min peak when it is <= budget, and a
// value > budget (INF) when the min peak provably exceeds the budget - the rigorous decision a sampler
// cannot give. Returns NaN for the pathological case of more than DP_MAX granting members (bail).
const DP_MAX = 18;
function minPeakCost(cons: ReachCon[], table: CoverTable, B: ReachCon[], budget = BUDGET): number {
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

// ---------------------------------------------------------------------------------------------------
// Real model + the Affliction-like target shape.
// ---------------------------------------------------------------------------------------------------
const model = buildModel(doc as any);
const cons = buildReachCons(model);
const table = buildCoverTable(cons);
const nameOf = new Map([...model.constellations.values()].map((c) => [c.id, c.name]));

const reqColorsOf = (c: ReachCon): number[] => c.req.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
const isTargetShape = (c: ReachCon): boolean => {
  const rc = reqColorsOf(c);
  if (rc.length < 2) return false;
  if (c.grant.every((g, i) => g >= c.req[i]!)) return false; // self-covers: not the shape
  return rc.every((i) => c.grant[i]! > 0); // grants back something on every required color
};
const targetIdx = cons.map((c, i) => (isTargetShape(c) ? i : -1)).filter((i) => i >= 0);

const affinityOf = (c: Counts): Vec => {
  let a = zero();
  for (let i = 0; i < cons.length; i++) if (c[i] === cons[i]!.size) a = addCap(a, cons[i]!.grant);
  return a;
};
const maxReqOf = (c: Counts): Vec => {
  let m = zero();
  for (let i = 0; i < cons.length; i++) if (c[i]! > 0) m = maxV(m, cons[i]!.req);
  return m;
};

// Generate a tight, near-budget self-covering REAL build seeded by 2-4 target-shape constellations, then
// deficit-filled with real granters until it covers its own requirement. The tight stack of partial-self-
// payback constellations is exactly the regime where a final build that fits 55 can still need transient
// bootstrap scaffold that overflows the construction peak.
function genTargetStack(rng: () => number): Counts | null {
  const c: Counts = cons.map(() => 0);
  const total = () => c.reduce((a, b) => a + b, 0);
  const shuffled = [...targetIdx];
  for (let s = shuffled.length - 1; s > 0; s--) {
    const j = Math.floor(rng() * (s + 1));
    [shuffled[s], shuffled[j]] = [shuffled[j]!, shuffled[s]!];
  }
  const k = 2 + Math.floor(rng() * 3); // 2-4 target-shape constellations
  for (let n = 0; n < k && n < shuffled.length; n++) {
    const i = shuffled[n]!;
    if (total() + cons[i]!.size <= BUDGET) c[i] = cons[i]!.size;
  }
  if (total() === 0 || c.filter((v, i) => v > 0 && isTargetShape(cons[i]!)).length < 2) return null;
  for (let it = 0; it < 120; it++) {
    const a = affinityOf(c);
    const mreq = maxReqOf(c);
    const def = mreq.map((v, j) => Math.max(0, v - a[j]!));
    if (def.every((d) => d === 0)) return c.slice();
    let col = 0;
    for (let j = 1; j < 5; j++) if (def[j]! > def[col]!) col = j;
    const g = cons
      .map((_, i) => i)
      .filter((i) => c[i] === 0 && cons[i]!.grant[col]! > 0 && total() + cons[i]!.size <= BUDGET);
    if (!g.length) return null; // cannot self-cover within budget
    const pick = g[Math.floor(rng() * g.length)]!;
    c[pick] = cons[pick]!.size;
  }
  return null;
}

const membersOf = (c: Counts): ReachCon[] => cons.filter((_, i) => c[i] === cons[i]!.size);
const fmtBuild = (c: Counts): string =>
  cons.map((cc, i) => (c[i] ? `${nameOf.get(cc.id) ?? cc.id}(${c[i]})` : "")).filter(Boolean).join(" + ");

// Measure the cost of PRODUCING A BUILD PATH for a single build (the guided-build-order engine cost),
// over typical user-like self-covering builds and over the pathological tight Affliction-stacks. For each
// reachable build it times the cheap sampled order (minPeakSampledOrder) and the exact min-peak DP
// (minPeakCost), and counts how often the sampled order fails to find a path that the exact DP proves
// exists (the cliff misses). Answers: is this always cheap, or hang-prone on pathological cases?
// `--perf [--seeds N]`.
if (process.argv.includes("--perf")) {
  const N = argNum("--seeds", 4000);
  const pct = (arr: number[], p: number) => arr.length ? arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))]! : 0;
  const summarize = (label: string, ts: number[]) =>
    console.log(`    ${label.padEnd(26)} median ${pct(ts, 50).toFixed(2)}ms  p95 ${pct(ts, 95).toFixed(2)}ms  p99 ${pct(ts, 99).toFixed(2)}ms  max ${Math.max(0, ...ts).toFixed(2)}ms  (n=${ts.length})`);
  const EXACT_CAP = argNum("--exact-cap", 120); // bound the multi-second exact-DP tail per set
  const run = (label: string, gen: (rng: () => number) => Counts | null) => {
    const sampledT: number[] = [];
    const exactT: number[] = [];
    let reach = 0;
    let cliffMiss = 0;
    let exactCalls = 0;
    for (let seed = 1; seed <= N; seed++) {
      const b = gen(mulberry32(seed * 2654435761));
      if (!b) continue;
      if (classifyForSelection(cons, table, stateFromCounts(b, cons), BUDGET) !== "reachable") continue;
      const members = membersOf(b);
      let t0 = performance.now();
      const order = minPeakSampledOrder(cons, table, members, BUDGET, 16);
      sampledT.push(performance.now() - t0);
      if (exactCalls < EXACT_CAP) {
        exactCalls++;
        t0 = performance.now();
        const exact = minPeakCost(cons, table, members, BUDGET);
        exactT.push(performance.now() - t0);
        if (exact <= BUDGET) {
          reach++;
          if (!order) cliffMiss++; // exact proves a path exists, but the cheap sampler did not find one
        }
      }
    }
    console.log(`\n  ${label}:`);
    summarize("sampled order (tries=16)", sampledT);
    summarize("exact min-peak DP", exactT);
    console.log(`    sampler cliff-misses (exact says reachable, sampled found no path): ${cliffMiss}/${reach}`);
  };
  console.log(`Build-path engine cost over ${N} seeds each (single-build timings):`);
  run("typical user-like self-covering builds", (rng) => genSelfCovering(cons, BUDGET, rng));
  run("pathological tight Affliction-stacks", (rng) => genTargetStack(rng));
  process.exit(0);
}

// Emit a shareable planner URL for specific seeds, so a confirmed false-reach can be opened in the
// running app and seen directly. A fully-completed constellation selects all of its stars. `--url 5563`.
const urlArg = (() => {
  const i = process.argv.indexOf("--url");
  return i >= 0 ? process.argv[i + 1] : null;
})();
if (urlArg) {
  const canonical = canonicalStarIds(model);
  for (const s of urlArg.split(",").map(Number)) {
    const b = genTargetStack(mulberry32(s * 2654435761));
    if (!b) {
      console.log(`seed ${s}: did not regenerate; skipping`);
      continue;
    }
    const selected = new Set<string>();
    for (let i = 0; i < cons.length; i++)
      if (b[i]) for (const sid of model.constellations.get(cons[i]!.id)!.starIds) selected.add(sid);
    const tot = b.reduce((a, x) => a + x, 0);
    console.log(`\nseed ${s} (${tot} pts): ${fmtBuild(b)}`);
    console.log(`  http://localhost:5173/#${encodeHash(selected, BUDGET, canonical)}`);
  }
  process.exit(0);
}

// Deep probe of specific suspect seeds: regenerate the build and hammer the SOUND witness finder
// (minPeakSampled samples real construction orders; peak <= 55 is a genuine construction). Resolves a
// suspect to "reachable" the moment any order fits the budget. `--probe 5563,41966 [--tries N]`.
const probeArg = (() => {
  const i = process.argv.indexOf("--probe");
  return i >= 0 ? process.argv[i + 1] : null;
})();
if (probeArg) {
  const tries = argNum("--tries", 40000);
  for (const s of probeArg.split(",").map(Number)) {
    const b = genTargetStack(mulberry32(s * 2654435761));
    if (!b) {
      console.log(`seed ${s}: did not regenerate (generator is order-sensitive); skipping`);
      continue;
    }
    const members = membersOf(b);
    const tot = b.reduce((a, x) => a + x, 0);
    const granting = members.filter((c) => c.grant.some((g) => g > 0)).length;
    console.log(`\n=== seed ${s} (${tot} pts, ${members.length} members, ${granting} granting) ===\n  ${fmtBuild(b)}`);
    const shipped = classifyForSelection(cons, table, stateFromCounts(b, cons), BUDGET);
    console.log(`  shipped engine verdict: ${shipped}`);
    const exact = minPeakCost(cons, table, members, BUDGET);
    if (Number.isNaN(exact)) {
      console.log(`  EXACT min-peak: BAILED (more than ${DP_MAX} granting members).`);
    } else if (exact <= BUDGET) {
      const order = minPeakSampledOrder(cons, table, members, BUDGET, tries);
      console.log(`  EXACT min construction peak = ${exact} <= 55 -> REACHABLE (engine correct, NOT a false-reach).`);
      if (order) console.log(`    a witness order: ${order.map((c) => nameOf.get(c.id) ?? c.id).join(" -> ")}`);
    } else {
      const sampled = minPeakSampled(cons, table, members, BUDGET, tries);
      console.log(`  EXACT min construction peak > 55 (DP=${exact === INF ? "INF" : exact}, best sampled=${sampled}).`);
      console.log(`  *** CONFIRMED REAL-MAP FALSE-REACH: engine LIT this build, but it cannot be constructed within 55. ***`);
    }
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------------
// Hunt.
// ---------------------------------------------------------------------------------------------------
console.log(`Real map: ${cons.length} constellations, ${targetIdx.length} of the Affliction-like target shape:`);
for (const i of targetIdx) {
  const c = cons[i]!;
  const fmt = (v: readonly number[]) =>
    `{${v.map((x, k) => (x > 0 ? `${["chaos", "eldritch", "order", "ascendant", "primordial"][k]}:${x}` : "")).filter(Boolean).join(" ")}}`;
  console.log(`  ${(nameOf.get(c.id) ?? c.id).padEnd(22)} size ${c.size}  needs ${fmt(c.req).padEnd(34)} grants ${fmt(c.grant)}`);
}
console.log(`\nHunting seeds ${START}..${START + SEEDS - 1} for tight self-covering stacks...`);

// Two stages. STAGE 1 (fast, every lit build): minPeakSampled samples real add/refund construction
// orders; a peak <= 55 is a SOUND witness (an actual construction exists), so the build is reachable and
// the engine is correct - it can never be a false-reach. Builds where no sampled order fits in
// WITNESS_TRIES are SUSPECTS (the heuristic sampler may simply have missed a good order). STAGE 2 (exact,
// suspects only - a handful): the order-exact min-peak DP (minPeakCost) decides each one. A peak <= 55
// means the sampler just missed it (recovered, engine correct); a peak > 55 means NO order builds it
// within budget, so the engine lit an unreachable build - a CONFIRMED false-reach. (The engine lights
// these via the seed-only constructible() fast path, which ignores the construction peak.)
const WITNESS_TRIES = 128;
let generated = 0;
let litByEngine = 0;
let litWitnessed = 0;
const suspects: { seed: number; b: Counts }[] = [];
const suspectKeys = new Set<string>();
const keyOf = (b: Counts) => cons.map((_, i) => (b[i] ? i : "")).filter((x) => x !== "").join(",");

for (let seed = START; seed < START + SEEDS; seed++) {
  const rng = mulberry32(seed * 2654435761);
  const b = genTargetStack(rng);
  if (!b) continue;
  generated++;
  if (classifyForSelection(cons, table, stateFromCounts(b, cons), BUDGET) !== "reachable") continue;
  litByEngine++;
  if (minPeakSampled(cons, table, membersOf(b), BUDGET, WITNESS_TRIES) <= BUDGET) {
    litWitnessed++;
    continue;
  }
  const key = keyOf(b);
  if (!suspectKeys.has(key)) {
    suspectKeys.add(key);
    suspects.push({ seed, b });
  }
}

console.log(`\n  generated tight target-stacks:          ${generated}`);
console.log(`  lit by shipped engine:                  ${litByEngine}`);
console.log(`  lit AND a sampled order witnessed <=55: ${litWitnessed}  (engine correct)`);
console.log(`  SUSPECTS (lit, no sampled order <=55):  ${suspects.length} distinct -> exact min-peak arbiter\n`);

let recovered = 0;
let falseReach = 0;
let bailed = 0;
const dumps: string[] = [];
for (const { seed, b } of suspects) {
  const exact = minPeakCost(cons, table, membersOf(b), BUDGET);
  const tot = b.reduce((a, x) => a + x, 0);
  if (Number.isNaN(exact)) bailed++;
  else if (exact <= BUDGET) recovered++;
  else {
    falseReach++;
    const sampled = minPeakSampled(cons, table, membersOf(b), BUDGET, 4000);
    dumps.push(
      `\n*** CONFIRMED FALSE-REACH (seed ${seed}, ${tot} pts) ***\n  ${fmtBuild(b)}\n  -> shipped engine: REACHABLE (lit)   exact min construction peak: ${exact === INF ? ">55 (INF)" : exact} (best sampled ${sampled}) - UNREACHABLE within 55`,
    );
  }
}

console.log(`  exact arbiter on ${suspects.length} suspects:`);
console.log(`    recovered (sampler missed, actually reachable): ${recovered}`);
console.log(`    CONFIRMED FALSE-REACH (exact min-peak > 55):    ${falseReach}`);
console.log(`    DP bailed (>18 granting members):               ${bailed}`);
for (const d of dumps.slice(0, DUMP)) console.log(d);
if (falseReach === 0 && bailed === 0)
  console.log(`\nNo real-map false-reach found: every lit build had a sound construction order within 55.`);
