// ABOUTME: Offline harness for baseline-to-current transition build orders (compare mode): runs the
// ABOUTME: core two-rung engine (src/core/transitionOrder.ts) over generated pairs, checks every order
// ABOUTME: against the independent legality oracle, and reports go/no-go numbers plus per-rung metrics.
// ABOUTME: Run via `just spike-transition [--pairs N] [--seed S]`.
// ABOUTME: Spec: docs/superpowers/specs/2026-07-18-transition-order-spike-design.md
import { buildOrderPath, type ReachCon, type Vec } from "../src/core/reachability";
import { verifyTransition as coreVerifyTransition, type TransStep } from "../src/core/orderLegality";
import { transitionOrderPath, teardownRebuild, incrementalTransition } from "../src/core/transitionOrder";
import { cons, table, mulberry32 } from "./reachability-fuzz";
import { mutatePair, randomPair } from "../test/support/transition-pairs";

const covers = (g: Vec, d: Vec): boolean =>
  g[0] >= d[0] && g[1] >= d[1] && g[2] >= d[2] && g[3] >= d[3] && g[4] >= d[4];

export const verifyTransition = (base: ReachCon[], cur: ReachCon[], steps: TransStep[], cap: number) =>
  coreVerifyTransition(cons, base, cur, steps, cap);

const BUDGET = 55;

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
  incRejected: boolean; // incrementalTransition produced steps, but the ladder settled on full-respec/none
}

function measure(corpus: PairResult["corpus"], base: ReachCon[], cur: ReachCon[], cap: number): PairResult {
  const t0 = Bun.nanoseconds();
  const res = transitionOrderPath(cons, table, base, cur, cap);
  const t1 = Bun.nanoseconds();
  buildOrderPath(cons, table, cur, cap, 16); // the live from-scratch cost on the same input
  const t2 = Bun.nanoseconds();
  const moved = res ? res.steps.reduce((a, s) => a + Math.abs(s.to - s.from), 0) : 0;
  const td = teardownRebuild(cons, table, base, cur, cap);
  const movedTeardown = td ? td.reduce((a, s) => a + Math.abs(s.to - s.from), 0) : null;
  // Per-rung oracle rejections: when the ladder did not settle on incremental, ask whether the
  // incremental rung alone had produced a (self-validated, but not oracle-verified here) candidate
  // anyway - a demotion the ladder's own oracle gate silently absorbed.
  const incRejected =
    (!res || res.rung === "full-respec") && incrementalTransition(cons, table, base, cur, cap) !== null;
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
    incRejected,
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

const RUNGS = ["incremental", "full-respec", "none"];

/** Up to `n` non-trivial small-delta orders, biased to cover every rung seen before padding with more. */
function pickSamples(rs: PairResult[], n: number): PairResult[] {
  const withSteps = rs.filter((r) => r.steps && r.steps.length > 0);
  const picked: PairResult[] = [];
  for (const rung of ["full-respec", "incremental"]) {
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
    const incRej = rs.filter((r) => r.incRejected).length;
    console.log(`  incremental oracle rejections (demotions): ${incRej}`);
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
