// ABOUTME: Audits the engine's known false-reach (soundness) gap against the independent BFS oracle, which
// ABOUTME: only scales to small models. Two questions: (1) WHICH classify path (greedy / peak witness /
// ABOUTME: exact resolver) emits the unsound "reachable", and (2) does the false-reach RATE shrink as the
// ABOUTME: budget grows toward the real model's 55 (evidence for whether the real model is affected).
// ABOUTME: Run: just audit-false-reach   (pure TS; no wasm). Findings written to docs by the author.
import {
  buildCoverTable,
  classifyForSelection,
  greedyFrom,
  minPeakSampled,
  reachableExactFrom,
  type ReachCon,
} from "../src/core/reachability";
import { reachableSet, extendableReachable, randModel, mulberry32, stateFromCounts } from "../test/support/reach-oracle";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { buildReachCons } from "../src/core/reachability";
import { genSelfCovering } from "../test/support/walk-fuzzer";

// A larger-model variant of the oracle's randModel: k constellations + the 5 crossroads, with a caller-set
// budget. More constellations + higher budget is the direction of the real model; BFS caps how far we go.
function randModelK(rng: () => number, k: number): ReachCon[] {
  const cons: ReachCon[] = [];
  for (let i = 0; i < k; i++) {
    const size = 1 + Math.floor(rng() * 4);
    const req = [0, 0, 0, 0, 0] as ReachCon["req"];
    const grant = [0, 0, 0, 0, 0] as ReachCon["grant"];
    const nReq = Math.floor(rng() * 3);
    const nGr = 1 + Math.floor(rng() * 2);
    for (let r = 0; r < nReq; r++) req[Math.floor(rng() * 3)] = 1 + Math.floor(rng() * 4);
    for (let g = 0; g < nGr; g++) grant[Math.floor(rng() * 3)] = 1 + Math.floor(rng() * 3);
    cons.push({ id: `c${i}`, size, req, grant });
  }
  for (let i = 0; i < 5; i++) {
    const g = [0, 0, 0, 0, 0] as ReachCon["grant"];
    g[i] = 1;
    cons.push({ id: `x${i}`, size: 1, req: [0, 0, 0, 0, 0], grant: g });
  }
  return cons;
}

// Classify, but report which sound-for-reachable path fired first (mirrors classifyForSelection's order).
function reachPath(cons: ReachCon[], table: ReturnType<typeof buildCoverTable>, S: number[], budget: number): string {
  const st = stateFromCounts(S, cons);
  if (greedyFrom(cons, st, budget) <= budget) return "greedy";
  if (st.partialFinish.length === 0 && minPeakSampled(cons, table, st.built, budget, 8, 3000) <= budget)
    return "witness";
  if (reachableExactFrom(cons, table, st, budget)) return "resolver";
  return "dim";
}

function sampleSelections(rng: () => number, cons: ReachCon[], budget: number): number[][] {
  const out: number[][] = [];
  for (let t = 0; t < 4; t++) {
    const S = cons.map(() => 0);
    const nStart = 1 + Math.floor(rng() * 3);
    let total = 0;
    for (let n = 0; n < nStart; n++) {
      const i = Math.floor(rng() * cons.length);
      if (S[i]! > 0) continue;
      const want = 1 + Math.floor(rng() * cons[i]!.size);
      if (total + want > budget) continue;
      S[i] = want;
      total += want;
    }
    if (S.some((v) => v > 0)) out.push(S);
  }
  return out;
}

// --- Part 1: mechanism (which path emits the unsound reachable), at the oracle test's scale -----------
console.log("Part 1: false-reach mechanism (k=5-6 constellations, budget 8-12, 200 seeds)");
{
  const byPath: Record<string, number> = { greedy: 0, witness: 0, resolver: 0 };
  let checked = 0;
  let falseReach = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const rng = mulberry32(seed);
    const { cons, budget } = randModel(rng);
    const R = reachableSet(cons, budget, 80_000);
    if (!R) continue;
    const table = buildCoverTable(cons);
    for (const S of sampleSelections(rng, cons, budget)) {
      checked++;
      const truth = extendableReachable(S, R);
      const reach = classifyForSelection(cons, table, stateFromCounts(S, cons), budget) === "reachable";
      if (reach && !truth) {
        falseReach++;
        byPath[reachPath(cons, table, S, budget)] = (byPath[reachPath(cons, table, S, budget)] ?? 0) + 1;
      }
    }
  }
  console.log(`  checked=${checked}  falseReach=${falseReach}  by path: ${JSON.stringify(byPath)}`);
}

// --- Part 2: does the false-reach RATE shrink as the budget grows toward 55? --------------------------
// Hold model size moderate (k=8) and vary budget; BFS caps the state space, so skip models it cannot finish.
console.log("\nPart 2: false-reach rate vs budget (k=8 constellations; '-' = BFS too large at that budget)");
for (const budget of [8, 12, 16, 20, 26, 32, 40]) {
  let checked = 0;
  let falseReach = 0;
  let skipped = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const rng = mulberry32(seed * 13 + budget);
    const cons = randModelK(rng, 8);
    const R = reachableSet(cons, budget, 1_500_000);
    if (!R) {
      skipped++;
      continue;
    }
    const table = buildCoverTable(cons);
    for (const S of sampleSelections(rng, cons, budget)) {
      checked++;
      const truth = extendableReachable(S, R);
      const reach = classifyForSelection(cons, table, stateFromCounts(S, cons), budget) === "reachable";
      if (reach && !truth) falseReach++;
    }
  }
  const rate = checked ? ((100 * falseReach) / checked).toFixed(2) : "-";
  console.log(`  budget=${String(budget).padStart(2)}  checked=${String(checked).padStart(5)}  falseReach=${String(falseReach).padStart(4)}  rate=${rate}%  (BFS-skipped models: ${skipped})`);
}

// --- Part 3: REAL-model upper bound (no BFS oracle scales here) ----------------------------------------
// Generate real-model self-covering builds within budget. greedy calls any such build reachable (it
// self-covers and fits 55), but a build with an unbreakable construction lock is self-covering yet
// UNREACHABLE. The sound peak witness (minPeakSampled with many tries) finds a real peak-bounded order if
// one exists; when greedy/resolver say reachable but even 400 sampled orders fail, that build is a
// false-reach SUSPECT (the count over-estimates - some are sampler misses, not true false-reaches - so it
// is an UPPER BOUND on the real-model false-reach rate among self-covering builds).
console.log("\nPart 3: real-model false-reach UPPER BOUND (self-covering builds, peak witness @ 400 tries)");
{
  const model = buildModel(doc as any);
  const cons = buildReachCons(model);
  const table = buildCoverTable(cons);
  let selfCovering = 0;
  let greedyReach = 0;
  let suspects = 0;
  for (let seed = 1; seed <= 8000 && selfCovering < 4000; seed++) {
    const b = genSelfCovering(cons, 55, mulberry32(seed * 7 + 1));
    if (!b) continue;
    const own = b.reduce((a, x) => a + x, 0);
    if (own > 55) continue;
    selfCovering++;
    const st = stateFromCounts(b, cons);
    if (greedyFrom(cons, st, 55) > 55) continue; // greedy did not call it reachable
    greedyReach++;
    // sound, high-effort witness: if even 400 orders find no peak-bounded build, suspect a false-reach
    if (minPeakSampled(cons, table, st.built, 55, 400, 5000) > 55) suspects++;
  }
  const rate = greedyReach ? ((100 * suspects) / greedyReach).toFixed(3) : "-";
  console.log(`  self-covering=${selfCovering}  greedy-reachable=${greedyReach}  witness-cannot-confirm=${suspects}  upper-bound rate=${rate}%`);
}
