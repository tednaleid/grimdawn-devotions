// ABOUTME: Quality-mode contract for the sampled construction search: deterministic, monotone
// ABOUTME: in the work budget, and strictly better than first-fit somewhere across both corpora.
import { test, expect } from "bun:test";
import { buildOrderCandidates, churnPoints, selectionSummary, BUDGET, type ReachCon } from "../src/core/reachability";
import { model, cons, table, generateValidBuild, mulberry32 } from "../scripts/reachability-fuzz";
import realJson from "./fixtures/real-builds.json";

const real = realJson as unknown as { builds: { starIds: string[] }[] };

function corpusMembers(): ReachCon[][] {
  const out: ReachCon[][] = [];
  for (let seed = 1; seed <= 150; seed++) out.push(generateValidBuild(mulberry32(seed)));
  for (const b of real.builds) out.push(selectionSummary(model, new Set(b.starIds)).built);
  return out;
}

test("quality search is deterministic and monotone in the work budget", () => {
  let low = 0;
  let high = 0;
  for (const B of corpusMembers()) {
    const c16 = buildOrderCandidates(cons, table, B, BUDGET, 16).sampler;
    const c16again = buildOrderCandidates(cons, table, B, BUDGET, 16).sampler;
    expect(c16again).toEqual(c16); // pure function of the build set
    const c256 = buildOrderCandidates(cons, table, B, BUDGET, 256).sampler;
    if (c16) expect(c256).not.toBeNull(); // more work never loses an order
    if (c16 && c256) {
      // A pin over both corpora, not an invariant: the argmin is picked on sampled-cap schedules
      // and the winner is re-emitted at REPLAY_CAP, so a failure here means re-measure, not broken.
      expect(churnPoints(c256)).toBeLessThanOrEqual(churnPoints(c16)); // monotone
      low += churnPoints(c16);
      high += churnPoints(c256);
    }
  }
  // The early exit was leaving churn on the table; a bigger budget must actually buy some
  // of it back across 150 synthetic + the real corpus. If this fails after the mode lands,
  // the sampler has no headroom here and the phase-2 premise needs re-examination: STOP and
  // report rather than weakening the assertion.
  expect(high).toBeLessThan(low);
}, 120_000);

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
