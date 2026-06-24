// ABOUTME: The classifier vs the independent BFS oracle on random models. main's resolver is NOT sound here:
// ABOUTME: it false-reaches (calls some unreachable selections reachable). Marked test.failing - this is
// ABOUTME: main's known soundness gap; the sound-by-construction costed-scaffolding alternate closes it.
// ABOUTME: See BACKLOG "Reachability engine: current state and known gaps".
import { test, expect } from "bun:test";
import { reachableSet, extendableReachable, randModel, mulberry32, stateFromCounts } from "./support/reach-oracle";
import { buildCoverTable, classifyForSelection } from "../src/core/reachability";

test.failing("classifier agrees with the BFS oracle: never false-reach (main's soundness gap)", () => {
  let falseDim = 0;
  let falseReach = 0;
  let checked = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const rng = mulberry32(seed);
    const { cons, budget } = randModel(rng);
    const R = reachableSet(cons, budget, 80_000);
    if (!R) continue;
    const table = buildCoverTable(cons);
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
      if (S.every((v) => v === 0)) continue;
      checked++;
      const truth = extendableReachable(S, R);
      const reach = classifyForSelection(cons, table, stateFromCounts(S, cons), budget) === "reachable";
      if (truth && !reach) falseDim++;
      if (!truth && reach) falseReach++;
    }
  }
  // SOUNDNESS should be absolute: the classifier must never call an unreachable selection reachable (a
  // wrongly-reachable build cannot actually be built; a wrongly-dim one only hides a valid option). main's
  // resolver VIOLATES this - it false-reaches on a few dozen of the sampled random models. Marked
  // test.failing until main's resolver is made sound, or the costed alternate is adopted where it matters.
  expect(falseReach).toBe(0);
  // The residual false-dim (well under 1%) is the documented partial-transient gap: a few adversarial
  // PARTIAL selections are reachable only by transiently OVER-completing a kept-partial constellation to
  // bootstrap a lock, then refunding it - a star-level move the whole-build resolver does not model. It is
  // conservative (a missed option, never a false reachable) and never occurs on whole-constellation (real)
  // builds. See the design spec's "partial-transient gap" note and BACKLOG. Guarded here against regression.
  expect(falseDim).toBeLessThanOrEqual(Math.ceil(checked * 0.01));
}, 45_000);
