// ABOUTME: Quality-mode contract for the sampled construction search: deterministic, monotone in the work
// ABOUTME: budget, better than first-fit; the real corpus by default, both corpora under `just test-slow`.
import { test, expect } from "bun:test";
import { buildOrderCandidates, churnPoints, selectionSummary, BUDGET, type ReachCon } from "../src/core/reachability";
import { model, cons, table, generateValidBuild, mulberry32 } from "../scripts/reachability-fuzz";
import realJson from "./fixtures/real-builds.json";

const real = realJson as unknown as { builds: { starIds: string[] }[] };

const realMembers = (): ReachCon[][] => real.builds.map((b) => selectionSummary(model, new Set(b.starIds)).built);
const syntheticMembers = (): ReachCon[][] => {
  const out: ReachCon[][] = [];
  for (let seed = 1; seed <= 150; seed++) out.push(generateValidBuild(mulberry32(seed)));
  return out;
};

// Asserts determinism and per-build monotonicity across the corpus; returns the churn totals at each budget.
function sweep(corpus: ReachCon[][], lowTries: number, highTries: number): { low: number; high: number } {
  let low = 0;
  let high = 0;
  for (const B of corpus) {
    const cLow = buildOrderCandidates(cons, table, B, BUDGET, lowTries).sampler;
    const cLowAgain = buildOrderCandidates(cons, table, B, BUDGET, lowTries).sampler;
    expect(cLowAgain).toEqual(cLow); // pure function of the build set
    const cHigh = buildOrderCandidates(cons, table, B, BUDGET, highTries).sampler;
    if (cLow) expect(cHigh).not.toBeNull(); // more work never loses an order
    if (cLow && cHigh) {
      // A pin over the corpus, not an invariant: the argmin is picked on sampled-cap schedules
      // and the winner is re-emitted at REPLAY_CAP, so a failure here means re-measure, not broken.
      expect(churnPoints(cHigh)).toBeLessThanOrEqual(churnPoints(cLow)); // monotone
      low += churnPoints(cLow);
      high += churnPoints(cHigh);
    }
  }
  return { low, high };
}

// The early exit was leaving churn on the table; a bigger budget must actually buy some of it back.
// If this fails after a search change, the sampler has no headroom here and the phase-2 premise needs
// re-examination: STOP and report rather than weakening the assertion.
test("quality search is deterministic and monotone, and buys churn back on the real corpus (tries 16 vs 64)", () => {
  const { low, high } = sweep(realMembers(), 16, 64);
  expect(high).toBeLessThan(low);
}, 60_000);

test.skipIf(process.env.REACH_SLOW !== "1")(
  "slow tier: the same holds over 150 synthetic builds plus the real corpus (tries 16 vs 256)",
  () => {
    const { low, high } = sweep([...syntheticMembers(), ...realMembers()], 16, 256);
    expect(high).toBeLessThan(low);
  },
  120_000,
);

test("samplerStepsFirst is a fitting schedule with no more steps than the churn pick", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const B = generateValidBuild(mulberry32(seed));
    const c = buildOrderCandidates(cons, table, B, BUDGET, 64);
    if (!c.sampler) continue;
    expect(c.samplerStepsFirst).not.toBeNull();
    // Also a pin over this corpus: samplerStepsFirst is the sampled-cap steps minimizer while
    // sampler is re-emitted at REPLAY_CAP, so treat a failure as re-measure, not broken.
    expect(c.samplerStepsFirst!.length).toBeLessThanOrEqual(c.sampler.length);
  }
});
