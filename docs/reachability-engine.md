# Reachability engine: current state and the two-engine comparison

Status: the shipped engine is the memoized branch-and-bound resolver in
`web/src/core/reachability.ts` (ported to `data/reach.wasm`). This document records
how it compares to the costed-scaffolding alternate, why the shipped engine is the
default, and what its known gaps are. For the decision problem itself (what makes
reachability hard, and the dead ends we rejected) see
[reachability-performance.md](reachability-performance.md); for the domain rules see
[devotion-system.md](devotion-system.md).

Date: 2026-06-24.

## The measurement

Run the new test suite and harness against each engine (the shipped one, and the
costed-scaffolding resolver on branch `reachability-costed-scaffolding`):

| Metric (TS unless noted)                                  | shipped (main) engine        | costed-scaffolding engine     |
| --------------------------------------------------------- | ---------------------------- | ----------------------------- |
| Neutral false-dim rate (harvest, real model)              | 0.0% (0/186)                 | 91.8% (123/134)               |
| Soundness: false-reach vs BFS oracle (random models)      | 43 (UNSOUND)                 | 0 (sound)                     |
| Per-click freeze: demanding singletons >400ms             | 0/30 (worst 89ms)            | 8/30 (worst 11.6s WASM, ~38s TS) |
| Per-click sweep max                                       | ~1.1s                        | ~49.6s (WASM)                 |
| Curated walk fixtures wrongly dimmed (branch-generated)   | 42/152 (incl. a real forum build) | 0/152                    |
| Full new suite                                            | 5 fail                       | 0 fail (own suite)            |

How to reproduce: `just harvest-false-dims --ts` (neutral false-dim rate),
`just perf --ts` (per-click cost), the BFS-oracle and walk tests in `web/test/`, and
`just validate-reach` (heavy). The curated-fixture row is `just gen-reach-fixtures`
regenerated against each engine, so it favors whichever engine generated it (the
neutral harvest row is the unbiased correctness comparison).

## What the numbers mean

The two engines make opposite error-bias trades. For a planner, the two error
classes are not symmetric: a false-reach claims an unbuildable build is achievable
(it lies), while a false-dim hides an achievable build (it omits). Both are bad.

- The shipped engine errs toward "reachable": near-zero false-dims in normal play and
  no per-click freeze, but it is UNSOUND on random models (it false-reaches on a few
  dozen of the sampled small models). Whether that unsoundness manifests on the real
  109-constellation model is unverified: no BFS oracle scales to the real model, which
  is why the costed engine was built sound by construction in the first place. The
  shipped engine also wrongly dims some tight near-55-point builds (a real forum
  "Thunder Warder" build, Oklaine's Lantern), rare in normal additive play but readily
  found among random self-covering 55-point builds.
- The costed-scaffolding engine errs toward "dim": sound by construction (every
  "reachable" verdict comes with a real construction witness, so it never false-reaches)
  and it produces the construction order needed for guided build order. But it
  false-dims ~92% of neutral picks and freezes 6-49s per click. Both flow from one root
  cause: when its randomized-order prover cannot find a witness fast, the per-node
  construction-peak proofs (`minPeakSampled`/`minPeakCost`/`peakToReach`) flail past a
  leaky work cap and it bails to dim. The freeze and the false-dims are the same bug.

The per-click freeze is specifically the validity-floor search (`selectionMinCost`),
which binary-searches tight budgets where those peak proofs flail; the dimming sweep at
the default cap is fast on both engines. The shipped engine has no such floor-search
freeze.

## Decision

Keep the shipped engine as the per-click default: for the metrics users feel (speed,
and not hiding achievable builds) it is clearly better, and its unsoundness is so far
only demonstrated on synthetic models. Keep the costed-scaffolding engine (branch
`reachability-costed-scaffolding`) as an alternate, not the default, for two jobs it is
uniquely suited to: a sound-by-construction oracle to audit the shipped engine's
real-model soundness, and the substrate for guided build order (it returns witnesses;
the shipped engine returns only a boolean). The `setExactResolver` seam in
`web/src/core/reachability.ts` lets either resolver be swapped in.

## Known gaps (guarded, locked in as `test.failing`)

- Soundness: `web/test/reachability-oracle.test.ts` (false-reach vs the BFS oracle).
- Tight-build false-dims: the false-dim half of `web/test/reachability-walk.test.ts`
  and the Oklaine case in `web/test/reachability.test.ts`.
- The downward-closure invariant (`web/test/reachability-monotonicity.test.ts`) PASSES
  on the shipped engine; it is gated behind the `REACH_SLOW` slow tier because the
  metamorphic walk is heavy (`just test-slow`).

See BACKLOG "Reachability engine: current state and known gaps" for the follow-up work
(audit real-model soundness with the costed oracle; surgical fix for the tight-build
false-dims).
