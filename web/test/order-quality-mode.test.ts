// ABOUTME: Quality-mode contract for the guided build-order search: deterministic, and the climb
// ABOUTME: never loses to its heuristic starts; the real corpus by default, both under `just test-slow`.
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

// Asserts determinism and per-build climb-never-worse; returns churn totals with the climb off and on.
function sweep(corpus: ReachCon[][]): { off: number; on: number } {
  let off = 0;
  let on = 0;
  for (const B of corpus) {
    const cOn = buildOrderCandidates(cons, table, B, BUDGET, 32).sampler;
    const cOnAgain = buildOrderCandidates(cons, table, B, BUDGET, 32).sampler;
    expect(cOnAgain).toEqual(cOn); // pure function of the build set
    const cOff = buildOrderCandidates(cons, table, B, BUDGET, 32, 3000, 0).sampler;
    if (cOff) expect(cOn).not.toBeNull(); // the climb never loses an order
    if (cOff && cOn) {
      // A pin over the corpus, not an invariant: the argmin is picked on sampled-cap schedules
      // and the winner is re-emitted at REPLAY_CAP, so a failure here means re-measure, not broken.
      expect(churnPoints(cOn)).toBeLessThanOrEqual(churnPoints(cOff));
      off += churnPoints(cOff);
      on += churnPoints(cOn);
    }
  }
  return { off, on };
}

// The guided climb must actually buy churn back over the heuristic starts. If this fails after a
// search change, the climb has no headroom here: STOP and report rather than weakening it.
test("quality search is deterministic and the climb buys churn back on the real corpus", () => {
  const { off, on } = sweep(realMembers());
  expect(on).toBeLessThan(off);
}, 60_000);

test.skipIf(process.env.REACH_SLOW !== "1")(
  "slow tier: the same holds over 150 synthetic builds plus the real corpus",
  () => {
    // <= not <: the synthetic corpus is already near zero churn, so the climb may only tie there.
    const { off, on } = sweep([...syntheticMembers(), ...realMembers()]);
    expect(on).toBeLessThanOrEqual(off);
  },
  120_000,
);

test("samplerStepsFirst is a fitting schedule with no more steps than the churn pick", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const B = generateValidBuild(mulberry32(seed));
    const c = buildOrderCandidates(cons, table, B, BUDGET, 32);
    if (!c.sampler) continue;
    expect(c.samplerStepsFirst).not.toBeNull();
    // Also a pin over this corpus: samplerStepsFirst is the sampled-cap steps minimizer while
    // sampler is re-emitted at REPLAY_CAP, so treat a failure as re-measure, not broken.
    expect(c.samplerStepsFirst!.length).toBeLessThanOrEqual(c.sampler.length);
  }
});
