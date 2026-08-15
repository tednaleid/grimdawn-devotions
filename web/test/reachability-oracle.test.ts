// ABOUTME: The classifier vs the independent BFS oracle on random models: it must never false-reach (call an
// ABOUTME: unreachable selection reachable), and its conservative false-dim residual stays bounded. The
// ABOUTME: random models are far stingier than the real map (two or three sources per color), so this is
// ABOUTME: the adversarial soundness check; see docs/reachability-engine.md "Known limits".
import { test, expect } from "bun:test";
import { reachableSet, extendableReachable, randModel, mulberry32, stateFromCounts } from "./support/reach-oracle";
import { buildCoverTable, classifyForSelection } from "../src/core/reachability";

test("classifier agrees with the BFS oracle: never false-reach", () => {
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
  // SOUNDNESS is absolute: the classifier must never call an unreachable selection reachable (a
  // wrongly-reachable build cannot actually be built; a wrongly-dim one only hides a valid option). The
  // crossroads seed is honest (a crossroads counts once, as the transient seed OR as a placed member or
  // filler), which is what closed the last false-reach mechanism here.
  expect(falseReach).toBe(0);
  // The residual false-dim (well under 1%) is conservative: partial selections reachable only by
  // transiently OVER-completing a kept-partial constellation to bootstrap a lock, then refunding it (a
  // star-level move the whole-build resolver does not model), plus builds whose only in-budget order the
  // deterministic witness candidates miss at a covering node. Neither occurs on the real map's
  // whole-constellation builds (`just validate-reach` Part B). Guarded here against regression.
  expect(falseDim).toBeLessThanOrEqual(Math.ceil(checked * 0.01));
}, 45_000);
