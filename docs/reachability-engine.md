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

## Update 2026-06-25: the tight-build false-dim peak witness

The tight-build false-dim gap (gap B) is essentially closed by a sound peak witness in the TS layer
(`minPeakSampled`, ported from the costed branch and wired into `classifyForSelection`). When the
cheap bracket and the exact resolver both dim a state that is a complete self-covering build within
a few points of the budget, `minPeakSampled` samples real construction orders (a bootstrap-order
heuristic plus a bounded number of seeded shuffles) and early-exits the moment one has a peak at or
under budget. That peak is a genuine build order, so it only ever flips a false-dim to reachable -
never a false-reach. It is gated to near-budget self-covering states (additive play never
false-dims). A redundant late-game re-classification of already-complete constellations was also
collapsed.

The witness is a DECISION (early-exit on the first valid order), not a minimum-peak computation. An
earlier attempt used `peakCost` (the exact construction-peak min), which on a real near-budget sweep
ran ~100ms per candidate over dozens of candidates - a 4.5s hang on completing Affliction from a
47-point build. `minPeakSampled` does the same sweep in ~10ms because reachable candidates early-exit
in one or two orders, and it is also MORE accurate (it finds valid orders the exact min's heuristic
branch capped out on).

Measured (TS layer, so it applies to both the WASM and TS resolver paths):

- Real-model false-dims (`just validate-reach` Part B): 119/6618 -> 1/6618.
- The 42 tight self-covering walk fixtures all classify reachable; `reachability-walk.test.ts` is no
  longer `test.failing`. The named Thunder Warder and Affliction builds are reachable.
- Soundness unchanged: false-reach stays 705/12000 vs the BFS oracle (the witness is sound).
- Per-click WASM perf unchanged from baseline: p99 ~200ms, max ~300ms, no >400ms clicks. The hang
  state (complete Affliction from a 47-point build) went 4564ms -> 85ms.
- Guard: `web/test/reachability-perf-guard.test.ts` times `selectionView` on the tight-build class the
  seeded harness under-samples, so a regression that makes the witness expensive again is caught.

Residual: the Oklaine case (`reachability.test.ts`, still `test.failing`) is a DIFFERENT gap - it asks
whether a non-self-covering 26-point selection can be EXTENDED with filler to a 55-point build
containing Oklaine. That is a filler-search gap in the exact resolver, not a tight-build construction
order, so the self-covering peak witness does not apply. The Gap A soundness (false-reach 705) gap is
also untouched - it is the opposite error direction and needs the expensive dim-proving search.

## Update 2026-06-25: false-reach audit (Gap A does not manifest on the real model)

`just audit-false-reach` (`web/scripts/audit-false-reach.ts`) probes the soundness gap three ways:

1. Mechanism (which classify path emits the unsound "reachable", at the oracle test's small scale):
   of 43 false-reaches, 34 came from `greedyFrom` and 9 from the exact resolver; the peak witness
   emitted ZERO. Both unsound paths model the crossroads seed as a free, always-held `[1,1,1,1,1]`,
   so they ignore that holding scaffolding during construction costs budget at the PEAK - they call a
   build reachable whose only real construction order overflows the budget. The witness is sound
   because it scores a real, peak-charged order.

2. Budget scaling (random k=8 models, BFS oracle): the false-reach rate is FLAT at ~5-6% from budget
   8 to 40. So it is not a small-budget artifact - the mechanism is budget-independent on these
   adversarial random models, which is why the oracle test stays `test.failing`.

3. Real-model upper bound (no BFS oracle scales to 109 constellations): over 4000 generated
   self-covering real-model builds, greedy called 3102 reachable, and the sound peak witness (400
   sampled orders each) CONFIRMED a real peak-bounded construction for ALL of them - 0 suspects,
   upper-bound false-reach rate 0.000%. The real model's affinity abundance (per-color supply is 4-9x
   the caps, 22-33 providers per color) means the construction peak effectively never binds, so the
   free-seed shortcut never lies here.

Conclusion: the false-reach gap is real in MECHANISM but is a synthetic-random-model artifact - it
does not appear to manifest on the real model (at least for self-covering builds; the witness is a
sampler, so this is a strong upper bound, not a formal proof). We therefore do NOT invest in the
expensive sound dim-proving fix. The oracle test (`reachability-oracle.test.ts`) stays `test.failing`
as a guard on the small-model mechanism; re-run `just audit-false-reach` after any resolver change.

## Update 2026-06-25: affinity-bootstrap / filler-extension false-dims FIXED (and the engine got faster)

The exact resolver (`reachableExactFrom`, and its Rust port in `web/wasm/src/lib.rs`) gated every
covering build on `constructible()` - the seed-only fixpoint, which cannot model holding transient
refundable scaffolding to bootstrap a build's own affinity. So builds reachable only via
scaffold-then-refund were dimmed even after filler was added. This was the deeper cause behind the
tight-build false-dims, the Oklaine filler-extension case, the Jackal/Vulture affinity-bootstrap case
(a self-covering build whose capstone needs chaos the build supplies only after a refundable crossroads
bootstraps it), and the 1/6618 real-model residual.

Fix: gate the covering build on the peak witness. `constructible()` stays the cheap fast path, falling
back to `minPeakSampled() <= budget`, which models scaffold-then-refund and is sound (a sampled peak
<= budget is a genuine order, so it only ever flips a false-dim, never invents a false-reach). The gate
uses the deterministic heuristic order only (`GATE_WITNESS_TRIES = 0`), so the Rust port is RNG-free and
bit-for-bit verdict-equivalent to TS (`just validate-wasm`: 0 mismatches over 900 small models + 152
real fixtures).

Two supporting fixes:
- A finished partial in the resolver carried its full grant but its partial (selected) size. The witness
  reads member size for its peak math, so it undercounted the build's point cost and could pass an
  over-budget build (a false-reach). Finished partials now count at full size (selected + remaining).
  This was a latent inconsistency the witness gate exposed; with it, the bootstrap fix adds zero
  false-reaches (`just validate-reach` Part A false-reach unchanged at the 414 baseline).
- The witness is far costlier than `constructible()` and fires at every covering node on dim candidates,
  so witness calls are capped per resolver invocation (best-filler-first order tries the likeliest
  builds first). Capping only makes a verdict conservatively dim, never a false-reach.

Results: real-model false-dims 0 (`just validate-reach` Part B); Vulture/Ghoul and Oklaine
`test.failing` flipped to passing in `reachability.test.ts`; and per-click p99 IMPROVED from 199 ms to
35 ms (max 312 -> 55 ms) on `just perf` - the witness short-circuits the previously-exhaustive dim
searches on now-reachable candidates. The remaining synthetic-model false-reach is the separate
soundness gap A (the greedy/free-seed mechanism), untouched here.

## Update 2026-06-25: shape-biased fuzz - the false-reach is NOT purely a scarcity artifact

Earlier (the false-reach audit above) the working theory was that the engine's false-reach is a
synthetic-random-model artifact that does not manifest on the real model, because the model's affinity
abundance means the construction peak never binds. The shape-biased fuzzer (`just shape-fuzz`,
`web/scripts/reachability-shape-fuzz.ts`) tests that theory directly. It generates small models the
exhaustive BFS oracle can still verify, but biased so most constellations are the shape that caused our
real-world false-DIMS - a MULTI-COLOR requirement that grants those same colors back but not enough to
self-pay (Affliction, Vulture, Ghoul, Oklaine) - and tops up requirement-free providers so every
requirement is genuinely achievable (real-map-like abundance, not scarcity).

Finding: with selections biased to STACK two such constellations near a tight budget, the engine produces
false-reaches that are NOT scarcity artifacts. Example (seed 8, budget 13): `b0` needs {A:4 E:3} gives
{A:1 E:1}; `b1` needs {B:4 D:2 E:3} gives {B:1 D:1 E:2}; every color is abundantly provided. The full
stack `b0+b1` has a valid 12-star completion within 13, but it cannot be CONSTRUCTED within budget: each
constellation permanently needs external affinity it never fully pays back, and you must hold one's
bootstrap scaffold while starting the other, so the construction peak exceeds the budget. The engine's
free-seed model reasons about final totals and misses the peak, so it lights the build. The BFS oracle
(which never exceeds budget at any step) confirms it is unreachable.

So the gap-A false-reach mechanism (free seed / ignoring the construction peak) CAN fire in the abundance
regime, specifically on tight builds that stack multiple multi-color partial-self-payback constellations -
exactly the shape of our hardest real cases. This weakens the "synthetic-only" conclusion: the audit that
reached it checked complete self-covering builds and did not compute an exact min-peak, so it did not
cover partial-selection stackings. The open, decisive question is whether the REAL map has a tight
~55-point build that stacks enough Affliction-like constellations to overflow the peak. Answering it
needs an exact-min-peak oracle (the costed-scaffolding engine's `exactMinPeak`) run over tight real-map
stacks - not the BFS oracle, which does not scale to the real model. Until that hunt runs, treat the
real-map false-reach rate as "none found, but not established as zero for this pattern".

The same fuzz run also shows residual false-DIMS on these stacked synthetic builds (the `tries=0` gate
witness overshooting); real-model false-dims remain 0 (`just validate-reach` Part B), so this is a
synthetic-model conservatism, not a real-map regression.
