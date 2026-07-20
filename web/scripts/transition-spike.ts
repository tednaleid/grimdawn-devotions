// ABOUTME: Spike harness for baseline-to-current transition build orders (compare mode). Prototypes a
// ABOUTME: seeded replay with two-pass refund scheduling and a shared-teardown escalation ladder, checks
// ABOUTME: every order against an independent legality oracle, and reports go/no-go numbers.
// ABOUTME: Run via `just spike-transition [--pairs N] [--seed S]`. Zero product-code changes; the pure
// ABOUTME: pieces are exported so web/test/transition-spike.test.ts can guard them in CI.
// ABOUTME: Spec: docs/superpowers/specs/2026-07-18-transition-order-spike-design.md
import {
  peakToReach,
  buildOrderPath,
  INF,
  type ReachCon,
  type Vec,
  type BuildStep,
} from "../src/core/reachability";
import { verifyTransition as coreVerifyTransition, type TransStep } from "../src/core/orderLegality";
import { cons, table, mulberry32 } from "./reachability-fuzz";
import { mutatePair, randomPair } from "../test/support/transition-pairs";

const zero = (): Vec => [0, 0, 0, 0, 0];
const covers = (g: Vec, d: Vec): boolean =>
  g[0] >= d[0] && g[1] >= d[1] && g[2] >= d[2] && g[3] >= d[3] && g[4] >= d[4];
const add = (g: Vec, x: Vec): Vec => [g[0] + x[0], g[1] + x[1], g[2] + x[2], g[3] + x[3], g[4] + x[4]];
const maxV = (a: Vec, b: Vec): Vec => [
  Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3]), Math.max(a[4], b[4]),
];

export { type TransStep };
export const verifyTransition = (base: ReachCon[], cur: ReachCon[], steps: TransStep[], cap: number) =>
  coreVerifyTransition(cons, base, cur, steps, cap);
export { mutatePair, randomPair };

const BUDGET = 55;

// --- Task 3: the prototype (seeded replay, two-pass refunds, escalation ladder) -----------------

const CAP_MAX: Vec = [20, 8, 20, 10, 20]; // per-color affinity cap (nothing requires more)
const addCap = (g: Vec, x: Vec): Vec => [
  Math.min(g[0] + x[0], CAP_MAX[0]!), Math.min(g[1] + x[1], CAP_MAX[1]!), Math.min(g[2] + x[2], CAP_MAX[2]!),
  Math.min(g[3] + x[3], CAP_MAX[3]!), Math.min(g[4] + x[4], CAP_MAX[4]!),
];
const deficit = (req: Vec, grant: Vec): Vec => [
  Math.max(0, req[0] - grant[0]), Math.max(0, req[1] - grant[1]), Math.max(0, req[2] - grant[2]),
  Math.max(0, req[3] - grant[3]), Math.max(0, req[4] - grant[4]),
];
const reqSum = (c: ReachCon) => c.req[0] + c.req[1] + c.req[2] + c.req[3] + c.req[4];
const grantRatio = (c: ReachCon) => (c.grant[0] + c.grant[1] + c.grant[2] + c.grant[3] + c.grant[4]) / c.size;
const conById = new Map(cons.map((c) => [c.id, c]));
const REPLAY_CAP = 300_000; // cold-path node cap for peakToReach (exact min subset, like buildOrderPath)

interface Delta {
  sharedFull: ReachCon[]; // same id, complete in both (grant counts throughout)
  baseOnly: ReachCon[]; // in base, absent from cur: must be refunded, usable as pre-paid scaffolds meanwhile
  curOnly: ReachCon[]; // in cur, absent from base: must be added
  resize: { con: ReachCon; from: number; to: number }[]; // same id, different star count
}

function diffBuilds(base: ReachCon[], cur: ReachCon[]): Delta {
  const b = new Map(base.map((c) => [c.id, c]));
  const c2 = new Map(cur.map((c) => [c.id, c]));
  const sharedFull: ReachCon[] = [];
  const baseOnly: ReachCon[] = [];
  const curOnly: ReachCon[] = [];
  const resize: Delta["resize"] = [];
  for (const [id, bc] of b) {
    const cc = c2.get(id);
    if (!cc) baseOnly.push(bc);
    else if (bc.size === cc.size) sharedFull.push(bc);
    else resize.push({ con: cons.find((x) => x.id === id)!, from: bc.size, to: cc.size });
  }
  for (const [id, cc] of c2) if (!b.has(id)) curOnly.push(cc);
  return { sharedFull, baseOnly, curOnly, resize };
}

/** A member the add order places, from its baseline star count to its current one. */
interface PlaceEntry {
  con: ReachCon; // the FULL constellation (grant/req/size)
  from: number; // baseline star count (0 for a fresh or torn-down member)
  to: number; // current star count (== con.size when it completes)
  grants: boolean; // whether it reaches full size (its grant then joins the standing supply)
}

/**
 * The seeded replay for one ladder rung (the spike's subject; the oracle is its correctness authority).
 *
 * `kept` are the shared members standing throughout - their grants seed the permanent supply. `held` are
 * pre-paid scaffolds standing at step zero (baseline-only members, plus any shared members this rung tears
 * down). `toPlace` are the members to add (current-only, torn-down shared members re-added, grow-resizes);
 * shrink-resizes and spent held scaffolds leave via refunds the backward pass schedules.
 *
 * FORWARD PASS: order `toPlace` by lowest requirement then grant density (seeded shuffles when the first
 * order does not fit, mirroring sampledConstruction). Replay it, and at each step ask peakToReach for the
 * minimal scaffold set that covers the standing deficit, with `base` = the PERMANENT supply only (kept +
 * placed members) so held scaffolds are candidates it can choose or drop. The pool is held-first, so
 * peakToReach's stable sort keeps a pre-paid baseline scaffold ahead of a fresh one of equal shape
 * (prefer-held). This records each step's need-set.
 *
 * BACKWARD PASS: a held scaffold refunds right after the LAST step whose need-set contains it (step zero
 * when never needed) - so a never-needed baseline member's points return up front and a still-useful one
 * is not churned. Every emitted step is validated against the same standing-state rule the oracle uses
 * (grants of complete members cover the max requirement of started ones, at the conservative mid-step),
 * and unsafe refunds are deferred until a later add makes them safe. If the two-pass schedule cannot place
 * a member under the cap (holding scaffolds longer costs budget), the rung retries with the EAGER schedule
 * (drop a scaffold the moment the need-set does, re-adding it if a later step needs it again) before
 * giving up. Returns oracle-shaped TransSteps, or null when no sampled order fits.
 */
function seededReplay(delta: Delta, teardown: ReachCon[], cap: number, tries: number): TransStep[] | null {
  const teardownIds = new Set(teardown.map((c) => c.id));
  const kept = delta.sharedFull.filter((c) => !teardownIds.has(c.id));
  const grows = delta.resize.filter((r) => r.to > r.from);
  const shrinks = delta.resize.filter((r) => r.to < r.from);

  // Members added over time. Torn-down shared members are refunded early (below) and re-added here.
  const toPlace: PlaceEntry[] = [
    ...delta.curOnly.map((c) => ({ con: c, from: 0, to: c.size, grants: true })),
    ...teardown.map((c) => ({ con: c, from: 0, to: c.size, grants: true })),
    ...grows.map((r) => ({ con: r.con, from: r.from, to: r.to, grants: r.to === r.con.size })),
  ];

  // Standing counts at each endpoint (drives from/to bookkeeping and the validity mirror).
  const baseCounts = new Map<string, number>();
  const curCounts = new Map<string, number>();
  for (const c of delta.sharedFull) { baseCounts.set(c.id, c.size); curCounts.set(c.id, c.size); }
  for (const c of delta.baseOnly) baseCounts.set(c.id, c.size);
  for (const c of delta.curOnly) curCounts.set(c.id, c.size);
  for (const r of delta.resize) { baseCounts.set(r.con.id, r.from); curCounts.set(r.con.id, r.to); }

  // Scaffold pool for peakToReach: baseline-only members first (prefer-held), then external scaffolds.
  // Torn-down shared members are refunded at step zero rather than leaned on, so they stay out of the pool.
  const heldIds = new Set([...delta.baseOnly, ...teardown].map((c) => c.id));
  const fresh = cons.filter((c) => !curCounts.has(c.id) && !baseCounts.has(c.id) && !heldIds.has(c.id));
  const pool = [...delta.baseOnly, ...fresh];

  // Refund targets for every transient support (what star count it must end at). Fresh scaffolds added
  // mid-replay register a target of 0 when placed.
  const refundTarget = new Map<string, number>();
  for (const c of delta.baseOnly) refundTarget.set(c.id, 0);
  for (const c of teardown) refundTarget.set(c.id, 0);
  for (const r of shrinks) refundTarget.set(r.con.id, r.to);

  let keptGrant: Vec = zero();
  for (const c of kept) keptGrant = addCap(keptGrant, c.grant);
  let seedMreq: Vec = zero();
  for (const c of kept) seedMreq = maxV(seedMreq, c.req);
  for (const r of delta.resize) seedMreq = maxV(seedMreq, r.con.req);

  // Forward pass: the per-step scaffold need-sets for one add order (null if a member cannot be supported).
  const forward = (order: PlaceEntry[]): ReachCon[][] | null => {
    let permGrant = keptGrant;
    let mreq = seedMreq;
    const needHistory: ReachCon[][] = [];
    for (const p of order) {
      mreq = maxV(mreq, p.con.req);
      const need: ReachCon[] = [];
      const sz = peakToReach(pool, table, deficit(mreq, permGrant), permGrant, REPLAY_CAP, {
        collect: need,
        preferSmall: true,
      });
      if (sz >= INF) return null;
      needHistory.push(need);
      if (p.grants) permGrant = addCap(permGrant, p.con.grant);
    }
    return needHistory;
  };

  // Emit steps for one add order under a refund policy (two-pass or eager). Every step is validated with
  // the oracle's standing-state rule, so a returned sequence is oracle-clean by construction.
  const emit = (order: PlaceEntry[], needHistory: ReachCon[][], eager: boolean): TransStep[] | null => {
    const standing = new Map(baseCounts);
    let running = [...standing.values()].reduce((a, b) => a + b, 0);
    const steps: TransStep[] = [];

    // Standing-state validity, mirroring verifyTransition.check: grants from COMPLETE members (excluding an
    // optional `pending` whose grant is not yet / no longer counted) must cover the max requirement of every
    // started member (including `pending`'s).
    const valid = (pending: string | null): boolean => {
      let grant = zero();
      let req = zero();
      for (const [id, n] of standing) {
        if (n <= 0) continue;
        const c = conById.get(id)!;
        req = maxV(req, c.req);
        if (n >= c.size && id !== pending) grant = add(grant, c.grant);
      }
      if (pending) { const pc = conById.get(pending); if (pc) req = maxV(req, pc.req); }
      return covers(grant, req);
    };
    const emitAdd = (id: string, to: number): boolean => {
      const from = standing.get(id) ?? 0;
      if (to <= from) return false;
      standing.set(id, to);
      if (!valid(id) || !valid(null) || running + (to - from) > cap) {
        if (from === 0) standing.delete(id);
        else standing.set(id, from);
        return false;
      }
      running += to - from;
      steps.push({ kind: "add", conId: id, from, to, heldAfter: running });
      return true;
    };
    const emitRefund = (id: string, to: number): boolean => {
      const from = standing.get(id) ?? 0;
      if (to >= from) return false;
      standing.set(id, to);
      if (!valid(id) || !valid(null)) {
        standing.set(id, from);
        return false;
      }
      running -= from - to;
      steps.push({ kind: "refund", conId: id, from, to, heldAfter: running });
      if (to === 0) standing.delete(id);
      return true;
    };

    const needIdSets = needHistory.map((ns) => new Set(ns.map((s) => s.id)));
    const lastUse = new Map<string, number>();
    for (let i = 0; i < needHistory.length; i++) for (const s of needHistory[i]!) lastUse.set(s.id, i);

    const pending = new Set<string>();
    const drain = () => {
      for (let progress = true; progress; ) {
        progress = false;
        for (const id of [...pending]) {
          const target = refundTarget.get(id) ?? 0;
          if ((standing.get(id) ?? 0) <= target) { pending.delete(id); continue; }
          if (emitRefund(id, target)) { pending.delete(id); progress = true; }
        }
      }
    };
    // Schedule (then safely drain) refunds for supports whose usefulness ends at step `i` (-1 = pre-add).
    const scheduleAndDrain = (i: number) => {
      const next = i + 1 < needIdSets.length ? needIdSets[i + 1]! : new Set<string>();
      for (const id of refundTarget.keys()) {
        if ((standing.get(id) ?? 0) <= (refundTarget.get(id) ?? 0)) continue;
        const done = eager ? !next.has(id) : i >= (lastUse.get(id) ?? -1);
        if (done) pending.add(id);
      }
      drain();
    };

    scheduleAndDrain(-1); // free never-needed baseline members (and torn-down shared members) up front
    for (let i = 0; i < order.length; i++) {
      for (const s of needHistory[i]!) {
        if ((standing.get(s.id) ?? 0) <= 0) {
          if (!emitAdd(s.id, s.size)) return null; // fresh scaffold / re-added held member
          if (!refundTarget.has(s.id)) refundTarget.set(s.id, 0);
        }
      }
      const p = order[i]!;
      if (p.to > (standing.get(p.con.id) ?? 0) && !emitAdd(p.con.id, p.to)) return null;
      scheduleAndDrain(i);
    }
    for (const id of refundTarget.keys()) pending.add(id);
    drain();

    if (standing.size !== curCounts.size) return null;
    for (const [id, n] of curCounts) if (standing.get(id) !== n) return null;
    return steps;
  };

  // Order candidates: the deterministic heuristic, then seeded shuffles (LCG seeded from sizes, like
  // sampledConstruction) - tried until one produces a valid two-pass or eager schedule.
  const heuristic = [...toPlace].sort(
    (a, b) => reqSum(a.con) - reqSum(b.con) || grantRatio(b.con) - grantRatio(a.con),
  );
  const orders: PlaceEntry[][] = [heuristic];
  let seed = ((toPlace.reduce((a, p) => a + p.con.size, 0) * 2654435761 + toPlace.length * 40503) >>> 0) || 1;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let a = 0; a < tries; a++) {
    const o = [...heuristic];
    for (let i = o.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = o[i]!;
      o[i] = o[j]!;
      o[j] = tmp;
    }
    orders.push(o);
  }
  for (const order of orders) {
    const needHistory = forward(order);
    if (!needHistory) continue;
    const twoPass = emit(order, needHistory, false);
    if (twoPass) return twoPass;
    const eager = emit(order, needHistory, true);
    if (eager) return eager;
  }
  return null;
}

/** Reverse of the baseline's own from-scratch order, then the current build's from-scratch order. */
export function teardownRebuild(base: ReachCon[], cur: ReachCon[], cap: number): TransStep[] | null {
  const down: BuildStep[] | null = buildOrderPath(cons, table, base, cap, 64);
  const up: BuildStep[] | null = buildOrderPath(cons, table, cur, cap, 64);
  if (!down || !up) return null;
  const steps: TransStep[] = [];
  let held = base.reduce((a, c) => a + c.size, 0);
  for (const s of [...down].reverse()) {
    // Reversing a construction: complete/scaffold-add become refunds, scaffold-refund becomes an add.
    const size = Math.abs(s.points);
    const wasAdd = s.kind === "complete" || s.kind === "scaffold-add";
    held += wasAdd ? -size : size;
    steps.push(
      wasAdd
        ? { kind: "refund", conId: s.conId, from: size, to: 0, heldAfter: held }
        : { kind: "add", conId: s.conId, from: 0, to: size, heldAfter: held },
    );
  }
  for (const s of up) {
    const size = Math.abs(s.points);
    const isAdd = s.kind === "complete" || s.kind === "scaffold-add";
    held += isAdd ? size : -size;
    steps.push(
      isAdd
        ? { kind: "add", conId: s.conId, from: 0, to: size, heldAfter: held }
        : { kind: "refund", conId: s.conId, from: size, to: 0, heldAfter: held },
    );
  }
  return steps;
}

/** The escalation ladder: pure incremental, then singleton shared teardowns, then full respec. */
export function transitionOrderPath(
  base: ReachCon[],
  cur: ReachCon[],
  cap: number,
  tries = 16,
): { steps: TransStep[]; rung: "incremental" | "teardown-1" | "full-respec" } | null {
  const delta = diffBuilds(base, cur);
  if (!delta.baseOnly.length && !delta.curOnly.length && !delta.resize.length) return { steps: [], rung: "incremental" };
  const clean = (steps: TransStep[] | null) => steps && verifyTransition(base, cur, steps, cap) === null;
  const s0 = seededReplay(delta, [], cap, tries);
  if (clean(s0)) return { steps: s0!, rung: "incremental" };
  // Singleton teardown candidates: shared members by how much they relax the binding deficit
  // (highest dominating requirement first, then most points freed).
  const cands = [...delta.sharedFull]
    .sort((a, b) => b.req.reduce((x, y) => x + y, 0) - a.req.reduce((x, y) => x + y, 0) || b.size - a.size)
    .slice(0, 8);
  for (const t of cands) {
    const s1 = seededReplay(delta, [t], cap, tries);
    if (clean(s1)) return { steps: s1!, rung: "teardown-1" };
  }
  const s2 = teardownRebuild(base, cur, cap);
  if (clean(s2)) return { steps: s2!, rung: "full-respec" };
  return null;
}

// --- Task 4: metrics, report, CLI --------------------------------------------------------------

interface PairResult {
  corpus: "small-delta" | "random" | "near-cap" | "tight-cap";
  rung: string | "none";
  oracleError: string | null;
  moved: number;
  movedTeardown: number | null;
  theoreticalMin: number;
  churnReaddCons: number; // constellations refunded then later re-added in the same order
  churnCoveredAdds: number; // scaffold adds whose affinity an earlier-refunded baseline member supplied
  usNanos: number;
  usNanosFromScratch: number;
  steps: TransStep[] | null; // kept only so report() can print sample orders; not part of the metrics
}

function measure(corpus: PairResult["corpus"], base: ReachCon[], cur: ReachCon[], cap: number): PairResult {
  const t0 = Bun.nanoseconds();
  const res = transitionOrderPath(base, cur, cap);
  const t1 = Bun.nanoseconds();
  buildOrderPath(cons, table, cur, cap, 16); // the live from-scratch cost on the same input
  const t2 = Bun.nanoseconds();
  const moved = res ? res.steps.reduce((a, s) => a + Math.abs(s.to - s.from), 0) : 0;
  const td = teardownRebuild(base, cur, cap);
  const movedTeardown = td ? td.reduce((a, s) => a + Math.abs(s.to - s.from), 0) : null;
  const bc = new Map(base.map((c) => [c.id, c.size]));
  const cc = new Map(cur.map((c) => [c.id, c.size]));
  let theoreticalMin = 0;
  for (const [id, n] of bc) theoreticalMin += Math.abs(n - (cc.get(id) ?? 0));
  for (const [id, n] of cc) if (!bc.has(id)) theoreticalMin += n;
  let churnReaddCons = 0;
  let churnCoveredAdds = 0;
  if (res) {
    const refunded = new Map<string, number>(); // conId -> step index of full refund
    const baseIds = new Set(base.map((c) => c.id));
    res.steps.forEach((s, i) => {
      if (s.kind === "refund" && s.to === 0) refunded.set(s.conId, i);
      if (s.kind === "add" && refunded.has(s.conId) && refunded.get(s.conId)! < i) churnReaddCons++;
      if (s.kind === "add" && !cc.has(s.conId)) {
        // a scaffold add; covered if some earlier-refunded baseline member grants at least as much
        const scaffold = cons.find((c) => c.id === s.conId)!;
        for (const [rid, ri] of refunded) {
          if (ri >= i || !baseIds.has(rid) || cc.has(rid)) continue;
          const rcon = cons.find((c) => c.id === rid)!;
          if (covers(rcon.grant, scaffold.grant)) { churnCoveredAdds++; break; }
        }
      }
    });
  }
  return {
    corpus, rung: res?.rung ?? "none",
    oracleError: res ? verifyTransition(base, cur, res.steps, cap) : null,
    moved, movedTeardown, theoreticalMin, churnReaddCons, churnCoveredAdds,
    usNanos: t1 - t0, usNanosFromScratch: t2 - t1,
    steps: res?.steps ?? null,
  };
}

// --- report formatting helpers ------------------------------------------------------------------

const percentile = (xs: number[], p: number): number => {
  if (!xs.length) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
};
const median = (xs: number[]): number => percentile(xs, 0.5);
const toMs = (ns: number): number => ns / 1e6;
const pctStr = (n: number, d: number): string => (d ? `${((n / d) * 100).toFixed(1)}%` : "n/a");
const fmtRatio = (xs: number[]): string =>
  xs.length ? `median ${median(xs).toFixed(2)}x  p95 ${percentile(xs, 0.95).toFixed(2)}x  (n=${xs.length})` : "n/a (n=0)";
const red = (s: string): string => `\x1b[31m${s}\x1b[0m`;

/** e.g. "+3 eel (held 42)" for an add, "-3 eel (held 42)" for a refund. */
function formatStep(s: TransStep): string {
  const delta = Math.abs(s.to - s.from);
  return `${s.kind === "add" ? "+" : "-"}${delta} ${s.conId} (held ${s.heldAfter})`;
}

const RUNGS = ["incremental", "teardown-1", "full-respec", "none"];

/** Up to `n` non-trivial small-delta orders, biased to cover every rung seen before padding with more. */
function pickSamples(rs: PairResult[], n: number): PairResult[] {
  const withSteps = rs.filter((r) => r.steps && r.steps.length > 0);
  const picked: PairResult[] = [];
  for (const rung of ["teardown-1", "full-respec", "incremental"]) {
    const first = withSteps.find((r) => r.rung === rung);
    if (first) picked.push(first);
  }
  for (const r of withSteps) {
    if (picked.length >= n) break;
    if (!picked.includes(r)) picked.push(r);
  }
  return picked.slice(0, n);
}

function report(results: PairResult[]): void {
  const corpora: PairResult["corpus"][] = ["small-delta", "random", "near-cap", "tight-cap"];
  let oracleFailures = 0;
  console.log(`\ntransition-order spike report: ${results.length} pairs total\n`);
  for (const corpus of corpora) {
    const rs = results.filter((r) => r.corpus === corpus);
    if (!rs.length) continue;
    console.log(`${corpus} (${rs.length} pairs)`);
    for (const rung of RUNGS) {
      const n = rs.filter((r) => r.rung === rung).length;
      if (n) console.log(`  rung ${rung}: ${n} (${pctStr(n, rs.length)})`);
    }
    const failures = rs.filter((r) => r.oracleError !== null);
    oracleFailures += failures.length;
    if (failures.length) {
      console.log(red(`  ORACLE FAILURES: ${failures.length}`));
      for (const f of failures.slice(0, 5)) console.log(red(`    ${f.oracleError}`));
    } else {
      console.log(`  oracle failures: 0`);
    }
    const beatsElig = rs.filter((r) => r.rung !== "none" && r.movedTeardown !== null);
    const beatsCount = beatsElig.filter((r) => r.moved < r.movedTeardown!).length;
    console.log(`  beats teardown+rebuild: ${pctStr(beatsCount, beatsElig.length)} (${beatsCount}/${beatsElig.length})`);
    const ratios = rs.filter((r) => r.rung !== "none" && r.theoreticalMin > 0).map((r) => r.moved / r.theoreticalMin);
    console.log(`  moved/theoreticalMin: ${fmtRatio(ratios)}`);
    const readdPairs = rs.filter((r) => r.churnReaddCons > 0).length;
    const readdEvents = rs.reduce((a, r) => a + r.churnReaddCons, 0);
    const coveredPairs = rs.filter((r) => r.churnCoveredAdds > 0).length;
    const coveredEvents = rs.reduce((a, r) => a + r.churnCoveredAdds, 0);
    console.log(`  churn refund-then-readd: ${readdPairs} pairs (${pctStr(readdPairs, rs.length)}), ${readdEvents} events`);
    console.log(`  churn uncovered-by-held scaffold add: ${coveredPairs} pairs (${pctStr(coveredPairs, rs.length)}), ${coveredEvents} events`);
    const transNs = rs.map((r) => r.usNanos);
    const scratchNs = rs.map((r) => r.usNanosFromScratch);
    console.log(`  runtime transition:    p50 ${toMs(median(transNs)).toFixed(3)} ms  p95 ${toMs(percentile(transNs, 0.95)).toFixed(3)} ms`);
    console.log(`  runtime from-scratch:  p50 ${toMs(median(scratchNs)).toFixed(3)} ms  p95 ${toMs(percentile(scratchNs, 0.95)).toFixed(3)} ms`);
    console.log("");
  }

  const smallDelta = results.filter((r) => r.corpus === "small-delta");
  const samples = pickSamples(smallDelta, 10);
  console.log(`sample small-delta orders (${samples.length}):`);
  samples.forEach((r, i) => {
    console.log(`  [${i + 1}] rung=${r.rung} moved=${r.moved} theoreticalMin=${r.theoreticalMin}`);
    r.steps!.forEach((s, j) => console.log(`    ${j + 1}. ${formatStep(s)}`));
  });

  if (oracleFailures > 0) {
    console.log(red(`\nFAIL: ${oracleFailures} oracle failure(s) across all corpora.`));
    process.exit(1);
  }
  console.log(`\nOK: zero oracle failures across ${results.length} pairs.`);
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const flag = (name: string, dflt: number) => {
    const i = args.indexOf(name);
    return i >= 0 ? Number(args[i + 1]) : dflt;
  };
  const nPairs = flag("--pairs", 200);
  const seed = flag("--seed", 1);
  const rng = mulberry32(seed);
  const results: PairResult[] = [];
  while (results.filter((r) => r.corpus === "small-delta").length < nPairs) {
    const p = mutatePair(rng);
    if (p) results.push(measure("small-delta", p.base, p.cur, BUDGET));
  }
  for (let i = 0; i < Math.floor(nPairs / 4); i++) {
    const p = randomPair(rng);
    results.push(measure("random", p.base, p.cur, BUDGET));
  }
  // Near-cap: small-delta pairs where both sides are 53+ stars (bounded search; the generator fills
  // toward 55 so hits are common, but log a shortfall instead of spinning). Tight-cap: cap equals the
  // SMALLER build's size, so when the baseline is the larger build the transition starts over cap and
  // must refund before it can add.
  const sz = (b: ReachCon[]) => b.reduce((a, c) => a + c.size, 0);
  const wantQuarter = Math.floor(nPairs / 4);
  for (let tries = 0; tries < 5000 && results.filter((r) => r.corpus === "near-cap").length < wantQuarter; tries++) {
    const p = mutatePair(rng);
    if (p && sz(p.base) >= 53 && sz(p.cur) >= 53) results.push(measure("near-cap", p.base, p.cur, BUDGET));
  }
  const nearCapCount = results.filter((r) => r.corpus === "near-cap").length;
  if (nearCapCount < wantQuarter) console.log(`near-cap corpus short: ${nearCapCount}/${wantQuarter}`);
  for (let got = 0; got < wantQuarter; ) {
    const p = mutatePair(rng);
    if (!p) continue;
    got++;
    results.push(measure("tight-cap", p.base, p.cur, Math.min(sz(p.base), sz(p.cur))));
  }
  report(results);
}
