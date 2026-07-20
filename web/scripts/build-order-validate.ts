// ABOUTME: Build-order validation harness. Measures whether buildOrderPath (the shipped guided-build-order
// ABOUTME: engine) gives correct answers across many builds, judged against the exact minPeakCost oracle. For
// ABOUTME: each sampled selection it runs the live (tries=16) and escalated (tries=4096) search, checks any
// ABOUTME: order with the strict legality oracle (core/orderLegality); on no witness the cost oracle decides: an order it proves
// ABOUTME: exists but the search missed is a FALSE-NEGATIVE (the viability number); an order that replays
// ABOUTME: illegally is a FALSE-POSITIVE (must be zero). Run `just build-order-validate [--seeds N]`.
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import {
  buildReachCons,
  buildCoverTable,
  buildOrderPath,
  type ReachCon,
  type Vec,
} from "../src/core/reachability";
import { mulberry32 } from "../test/support/reach-oracle";
import { genSelfCovering } from "../test/support/walk-fuzzer";
import { minPeakCost } from "../test/support/costed-oracle";
import { verifyBuildOrder } from "../src/core/orderLegality";
import { churnPoints } from "../test/support/order-metrics";

const argNum = (flag: string, def: number): number => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] !== undefined ? Number(process.argv[i + 1]) : def;
};
const TYPICAL = argNum("--seeds", 3000);
const SUBSETS = argNum("--subsets", 1500);
const BUDGET = 55;
const LIVE_TRIES = 16;
const ESC_TRIES = 4096;

const model = buildModel(doc as any);
const cons = buildReachCons(model);
const table = buildCoverTable(cons);
const nameOf = new Map([...model.constellations.values()].map((c) => [c.id, c.name]));

const CAP_MAX: Vec = [20, 8, 20, 10, 20];
const addCap = (g: Vec, x: Vec): Vec => g.map((v, i) => Math.min(v + x[i]!, CAP_MAX[i]!)) as Vec;
const maxV = (a: Vec, b: Vec): Vec => a.map((v, i) => Math.max(v, b[i]!)) as Vec;
const covers = (g: Vec, d: Vec): boolean => g.every((v, i) => v >= d[i]!);

// summed (capped) grant >= elementwise-max requirement: the selection covers its own affinity.
function selfCovers(B: ReachCon[]): boolean {
  let g: Vec = [0, 0, 0, 0, 0];
  let r: Vec = [0, 0, 0, 0, 0];
  for (const m of B) {
    g = addCap(g, m.grant);
    r = maxV(r, m.req);
  }
  return covers(g, r);
}

type Cat = "live-found" | "recoverable" | "false-negative" | "no-order-partial" | "no-order-peak" | "bail";
interface Tally {
  total: number;
  liveFound: number;
  recoverable: number;
  falseNeg: number;
  noOrderPartial: number; // correct null: selection not self-covering (needs other constellations)
  noOrderPeak: number; // correct null: self-covering but min construction peak > cap (false-reach-like)
  bail: number; // oracle could not decide (too many granting members)
  illegal: number; // a produced order failed replay (FALSE-POSITIVE; must be 0)
  selfCov: number;
  churn: number; // scaffold churn points across accepted orders (quality, not legality)
  stepsTotal: number; // total steps across accepted orders
  examples: { fn: string[]; falseNeg: string[] };
}
const fresh = (): Tally => ({
  total: 0,
  liveFound: 0,
  recoverable: 0,
  falseNeg: 0,
  noOrderPartial: 0,
  noOrderPeak: 0,
  bail: 0,
  illegal: 0,
  selfCov: 0,
  churn: 0,
  stepsTotal: 0,
  examples: { fn: [], falseNeg: [] },
});

const fmt = (B: ReachCon[]): string => B.map((c) => `${nameOf.get(c.id) ?? c.id}`).join(" + ");

function classify(B: ReachCon[], t: Tally): Cat {
  t.total++;
  const sc = selfCovers(B);
  if (sc) t.selfCov++;

  const live = buildOrderPath(cons, table, B, BUDGET, LIVE_TRIES);
  if (live && verifyBuildOrder(cons, B, live, BUDGET) !== null) {
    t.illegal++;
    if (t.examples.fn.length < 8) t.examples.fn.push("ILLEGAL@live: " + fmt(B));
  } else if (live) {
    t.liveFound++;
    t.churn += churnPoints(live);
    t.stepsTotal += live.length;
    return "live-found";
  }
  // live missed (or was illegal): try the escalated search
  const esc = buildOrderPath(cons, table, B, BUDGET, ESC_TRIES);
  if (esc && verifyBuildOrder(cons, B, esc, BUDGET) !== null) {
    t.illegal++;
    if (t.examples.fn.length < 8) t.examples.fn.push("ILLEGAL@esc: " + fmt(B));
  } else if (esc) {
    t.recoverable++;
    t.churn += churnPoints(esc);
    t.stepsTotal += esc.length;
    return "recoverable";
  }
  // no witness at any tries: the oracle decides whether one provably exists
  const oracle = minPeakCost(cons, table, B, BUDGET);
  if (Number.isNaN(oracle)) {
    t.bail++;
    return "bail";
  }
  if (oracle <= BUDGET) {
    t.falseNeg++;
    if (t.examples.falseNeg.length < 12) t.examples.falseNeg.push(`peak=${oracle}: ${fmt(B)}`);
    return "false-negative";
  }
  if (sc) {
    t.noOrderPeak++;
    return "no-order-peak";
  }
  t.noOrderPartial++;
  return "no-order-partial";
}

function report(label: string, t: Tally): void {
  const exists = t.liveFound + t.recoverable + t.falseNeg; // builds with a provable order at cap
  const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "n/a");
  console.log(`\n=== ${label} (${t.total} builds, ${t.selfCov} self-covering) ===`);
  console.log(`  order exists (oracle/witness):     ${exists}`);
  console.log(`    live (tries=16) found:           ${t.liveFound}  (${pct(t.liveFound, exists)} of existing)`);
  console.log(`    needed escalation (recoverable): ${t.recoverable}  (${pct(t.recoverable, exists)})`);
  console.log(`    FALSE-NEGATIVE (missed entirely):${t.falseNeg}  (${pct(t.falseNeg, exists)})  <-- viability`);
  console.log(`  correct "no order":`);
  console.log(`    not self-covering (partial):     ${t.noOrderPartial}`);
  console.log(`    self-covering, peak>55:          ${t.noOrderPeak}`);
  console.log(`  oracle bailed (>18 granters):      ${t.bail}`);
  console.log(`  FALSE-POSITIVE (illegal path):     ${t.illegal}  <-- must be 0`);
  const found = t.liveFound + t.recoverable;
  console.log(`  quality: churn=${t.churn} pts, steps=${t.stepsTotal} across ${found} orders`);
  if (t.examples.falseNeg.length) {
    console.log(`  false-negative examples:`);
    for (const e of t.examples.falseNeg) console.log(`    ${e}`);
  }
  if (t.examples.fn.length) {
    console.log(`  illegal-path examples:`);
    for (const e of t.examples.fn) console.log(`    ${e}`);
  }
}

// --- Group 1: typical self-covering builds (what the feature is for) ---
const typ = fresh();
{
  const rng = mulberry32(0x9e3779b1);
  let made = 0;
  for (let i = 0; made < TYPICAL && i < TYPICAL * 4; i++) {
    const c = genSelfCovering(cons, BUDGET, rng);
    if (!c) continue;
    const B = cons.filter((_, j) => c[j] === cons[j]!.size);
    if (!B.length) continue;
    classify(B, typ);
    made++;
  }
}
report("typical self-covering builds (genSelfCovering)", typ);

// --- Group 2: every constellation selected alone (the Oleron-class partial probe) ---
const single = fresh();
for (const c of cons) {
  if (c.id.startsWith("crossroads_")) continue;
  classify([c], single);
}
report("single constellation alone (partial probe)", single);

// --- Group 3: random small subsets of 2-4 real constellations (mixed) ---
const sub = fresh();
{
  const rng = mulberry32(0x85ebca6b);
  const real = cons.filter((c) => !c.id.startsWith("crossroads_"));
  for (let i = 0; i < SUBSETS; i++) {
    const k = 2 + Math.floor(rng() * 3);
    const picks = new Set<number>();
    while (picks.size < k) picks.add(Math.floor(rng() * real.length));
    const B = [...picks].map((j) => real[j]!);
    if (B.reduce((a, c) => a + c.size, 0) > BUDGET) continue;
    classify(B, sub);
  }
}
report("random 2-4 constellation subsets (mixed)", sub);

console.log("\nNote: 'false-negative' = the search returned no order but minPeakCost proves one exists within 55.");
console.log("'not self-covering (partial)' is the Oleron class: correct to find no self-only order, but the");
console.log("build IS buildable in-game by ALSO selecting supporting constellations - out of the feature's model.");
