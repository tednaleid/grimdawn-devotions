# Guided Build-Order Search

Date: 2026-08-24
Status: approved design, spike-validated

## Problem

The build-order panel's quality search (shipped 2026-08-23) spends a fixed budget of
blind seeded shuffles and keeps the least-churn fitting schedule. On the 99-build real
corpus (`web/test/fixtures/real-builds.json`) it ships 334 wasted points at the live
budget of 32 tries. Brute force at 4096 tries reaches 255 at roughly 2 seconds per
build, which shows the orders exist but blind sampling has no direction toward them.

## Objective and success bar

The ordering objective is unchanged: fewest churn points (`churnPoints`, non-crossroads
scaffold stars bought then refunded), then fewest steps, greedy on a full tie. The
ratified bar for shipping this project: corpus churn of 295 or better within the
existing per-click envelope (p95 <= 45 ms, p99 <= 190 ms). The spike (below) measured
265 at p95 5.7 ms, so the bar is expected to be met with margin.

## Spike results

A throwaway prototype (copy of `reachability.ts`, deleted once the plan transcribes
the move logic) was measured over the 99-build corpus. Every schedule produced by
every variant was verified legal by the independent oracle (`verifyBuildOrder`),
with zero failures and zero nulls. The shipped `buildOrderPath` reproduced its
baseline in every run.

| variant | churn | steps | p50 ms | p95 ms | max ms |
|---|---|---|---|---|---|
| shipped (32 blind tries) | 334 | 1943 | 14.8 | 30.5 | 35.2 |
| climb after 32 tries, 64 evals | 283 | 1911 | 15.3 | 32.1 | 43.8 |
| climb after 8 tries, 64 evals | 272 | 1899 | 4.7 | 13.7 | 20.4 |
| climb after 0 tries, 64 evals | 265 | 1895 | 0.7 | 5.7 | 13.0 |
| reference: brute force 4096 tries | 255 | - | - | ~2000 | - |

Findings the design rests on:

- Guided local search from the deterministic heuristic starts alone beats every
  blind-sampling configuration on both churn and latency. More blind shuffles make
  the final result worse: the best-of-shuffles incumbent is a poor starting point
  for the climb.
- The climb converges in under 32 evaluations; raising the eval cap to 128 or 256
  changed nothing.
- A second prototype, a churn-aware scaffold objective inside `peakToReach`
  (lexicographic non-crossroads points then size), was rejected: it improved corpus
  churn by 1 point and multiplied latency roughly 40x because the weighted objective
  invalidates most of the DFS pruning.
- Adaptive deeper sampling was rejected without prototyping: the measured curve
  (about 10 points per doubling of tries, doubling latency each time) cannot reach
  the bar inside the envelope.

## Design

### Search restructure

All changes live in `sampledConstruction`'s quality mode in
`web/src/core/reachability.ts`. Witness mode is untouched by construction: the new
code paths are gated on `mode === "quality"`.

1. Score the three deterministic heuristic starts exactly as today: the bootstrap
   order (lowest requirement first, then grant density) and both `peelOrder`
   variants.
2. Hill-climb from the incumbent best. Read the incumbent's schedule and take its
   first two non-crossroads `scaffold-add` steps. For each such step:
   - identify the triggering member: the first `complete` step after the add whose
     constellation is in the granting order;
   - propose, in a fixed deterministic sequence: for each later member whose grant
     overlaps the scaffold's granted colors, a candidate order with that member
     moved immediately before the triggering member; a candidate with the
     triggering member moved to the end; a candidate with the triggering member
     swapped with its predecessor.
   Score each candidate with `emitSchedule`, accept on churn-then-steps
   improvement, regenerate moves from the new incumbent, and stop at convergence
   (a full move sweep with no improvement) or at the eval cap, a module constant
   of 64.
3. Blind shuffles become a fallback only: when steps 1 and 2 produce no fitting
   schedule, run seeded shuffles witness-style (stop at the first fit, capped by
   `tries`), then climb once more from that fit. Typical builds never enter this
   branch.

One design lever is resolved by a measured task in the plan: climbing each of the
three heuristic starts separately (roughly 3x the cost of one climb, still around
1 ms) versus climbing only the argmin. Adopt the separate climbs when they improve
corpus churn by 2 or more points with p95 inside the envelope; otherwise keep the
argmin climb.

### API, determinism, performance

- Public surface unchanged. `buildOrderPath(cons, table, B, budget, tries,
  peakNodeCap)` keeps its signature and its default `tries = 32`. The meaning of
  `tries` narrows to the fallback shuffle cap; on the happy path its value no
  longer affects the result.
- The eval cap is a module constant (`CLIMB_EVALS = 64`) applied per climb.
  `buildOrderPath` does not expose it; `buildOrderCandidates` takes an optional
  trailing `climbEvals` override so the harness can measure climb-off against
  climb-on. If the separate-climbs lever is adopted, the constant stays the
  per-climb cap.
- Determinism: move enumeration is a fixed sequence derived from the incumbent
  schedule, which is itself deterministic; the seeded RNG remains for the fallback
  branch only. `buildOrderPath` stays a pure function of the build set. No
  wall-clock, no `Math.random`.
- The final pick is still re-emitted at the cold-path cap (`REPLAY_CAP`), and
  `samplerStepsFirst` is still tracked for the divergence harness (the climb
  updates it through the same scoring path).
- `buildOrderEscalated` keeps its harness-only role and inherits the climber.
- Expected performance: corpus p95 around 6 ms against the 45 ms envelope. The
  existing perf-guard test is unchanged.

### Testing and gates

- Hard gates carried forward: the real-build gate (99 of 99 oracle-legal at the
  shipped configuration, expectations re-recorded), the witness snapshot
  byte-identical, `just fuzz` and `just build-order-validate` green, the
  perf-guard test unchanged.
- Overfitting guard: an explicit plan task runs the 150-build synthetic corpus.
  The climber must improve or hold its churn there (19 on main today); a
  regression stops the work until explained.
- Corpus pins in `web/test/build-order-oracle.test.ts` (CHURN_PIN, STEPS_PIN,
  ORDER_FLOOR, the repro build) are re-recorded with before and after noted in
  the plan. They are pins, not invariants.
- Harness rework: `web/scripts/order-quality.ts` drops the tries ladder (tries no
  longer scales quality by design) in favor of a climb-off versus climb-on
  comparison at the shipped configuration, same CSV shape, divergence counter
  kept. `web/test/order-quality-mode.test.ts` loses the more-tries-is-better
  assertions and gains determinism and climber-never-worse-than-heuristics
  assertions.

### Documentation and follow-ups

- `docs/reachability-engine.md`'s quality-mode section is rewritten in place.
- BACKLOG: retire the hill-climbing item as done; re-baseline the steps-first and
  T3-earlier tiebreak items against the new numbers; downgrade the
  background-escalation item, since the remaining gap (265 to 255) likely no
  longer justifies a worker.
- After shipping, regenerate the `.llm` comparison page so the new orders can be
  clicked through against the live site.
