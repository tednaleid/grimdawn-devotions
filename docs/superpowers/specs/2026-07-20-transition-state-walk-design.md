# Transition state walk: the build unbuilds itself

Point-in-time design record. The compare-transition feature (spec
2026-07-18-compare-transition-order-design.md) is complete on its branch but
held from merge: on zero-slack pairs its incremental rung deadlocks and the
panel falls back to a full respec. The project owner's real pair made it
concrete: a hand-written 9-step, 32-moved-point transition passes the
oracle, while the panel shows 39 steps moving 130 points.

Diagnosed before this design (scratch diagnostics against the pre-port
spike, which still had the teardown-1 rung):

- Candidate selection was not the flaw: teardown-1 tried the right shared
  member (Yugol) first and still failed.
- The forward pass was not the flaw: with Yugol torn down the deficits are
  small and coverable at every step.
- The emission scheduler is the flaw, structurally: its two refund policies
  (refund at last use; refund eagerly when the next need-set drops it)
  cannot express "refund now purely for cap room and re-buy later". Under
  zero slack every add needs room first, so no member ordering can save
  it - all 4096 sampled orderings fail.

Decided during design:

- **Approach B**: replace the failing emission with a greedy walk over
  actual game states, every move legal by the oracle's own rule. Approach A
  (more policies bolted onto the two-pass scheduler) rejected as
  whack-a-mole. Approach C (truncated respec) deferred: revisit only if the
  full-respec tail stays fat after the walk lands.
- **Selection, not a ladder**: compute all candidate schedules and return
  the best verified one. Today's candidates stay in the pool, so no pair
  can get worse than the current branch by construction.
- **The merge gate is measured, both kinds**: the owner's pair pinned at or
  below 32 moved points in CI, plus aggregate moved-points pins across the
  generated corpora. Failing either means no merge.
- **Constellation-level granularity stands** (the parent spec's non-goal).
  Star-level moves (the owner's "only need 1 point from Yugol" refinement)
  would save more but explode the search space; out of scope.

## The state walk

A new pure function in web/src/core/transitionOrder.ts:

    stateWalkTransition(cons, table, base, cur, cap):
      TransStep[] | null

It walks forward from the baseline's standing board, emitting one legal
move at a time until the board equals the current build. A move is legal
exactly when the transition oracle's rule says so (grants of complete
standing constellations cover every started constellation's requirement at
the conservative mid-step point; adds land at or under cap; refunds may
pass through over-cap totals). The move vocabulary, in strict priority
order at every step:

1. **Complete a target member.** Add a constellation of `cur` (not yet at
   its target count) whose requirement is covered and whose points fit the
   cap. Among candidates, pick the densest contributor to the remaining
   deficits per star (the need-driven scoring that already orders
   from-scratch builds), ties by id.
2. **Free points.** Refund a standing non-target constellation (baseline
   leftover or scaffold) that is legally refundable, preferring zero-grant
   members first (they are free flexibility - the Ghoul observation), then
   the one whose grant matters least for the remaining deficits; ties by
   id.
3. **Scaffold.** Add the scaffold set peakToReach picks (crossroads-biased,
   minimal) for the binding deficit, when it fits the cap.
4. **Teardown (only when stuck).** When no move above exists, refund the
   standing shared member that unblocks progress: the smallest one whose
   removal either legalizes a blocked refund or frees enough cap for the
   next needed add; ties by id. A torn-down member rejoins the to-place
   pool and is re-added by move 1 later.

Termination is bounded, not assumed: each constellation may be torn down at
most once per walk, and the walk carries a hard step budget (four times
the theoretical minimum moved points, the bound full respec never exceeds
in practice); exceeding either returns null. Deterministic throughout - no randomness, id tie-breaks everywhere,
byte-identical output for identical inputs.

The walk returns raw steps; it is not its own authority. Its output goes
through `verifyTransition` like every other candidate, and the display
boundary keeps `gateTransition`. Verified or absent is unchanged.

## Selection replaces the ladder

`transitionOrderPath` becomes: compute the candidates - the state walk,
the existing two-pass incremental replay, the full-respec reversal - verify
each, and return the best verified schedule by fewest moved points, then
fewest steps, then candidate order (walk first) for determinism. The
`TransitionRung` tag survives for the panel: a winning walk or two-pass
schedule reports "incremental", a winning full respec reports
"full-respec" (the panel's rebuild notice keys off it). Public signature
and honest-null semantics unchanged; `selectionView`, the panel, the
popup, and i18n need no changes.

Because today's two candidates remain in the pool, the selection is never
worse than the current branch on any pair - the no-regression half of the
gate is structural, and the corpus comparison verifies it empirically.

## The merge gate (hard, both kinds)

- **The owner's pair, pinned:** a CI test decodes the real pair's two
  hashes and asserts the returned transition moves at most 32 points in
  the owner's direction (the hand path's bound), with the exact measured
  values pinned once the walk lands; the swapped direction gets its own
  measured pin.
- **Aggregates, pinned:** the offline harness and the four-corpus CI sweep
  (small-delta, resize, swap, real-URL) record total moved points before
  and after; CI pins the after-totals with small slack, exactly like the
  ordering effort's churn pins. Zero oracle failures remains the legality
  bar.
- **No pair worse:** the harness compares per-pair moved points against the
  pre-walk branch; any regression is a launch blocker (expected zero, by
  construction).
- Full gate, `just e2e`, `just perf` green; per-click cost at or below the
  current branch's (the walk replaces sampling loops with one deterministic
  pass; the two-pass replay still runs as a candidate).

## Testing

- Walk unit tests on synthetic constellations: the free-refund priority
  (zero-grant refunds first), the stuck-teardown trigger (a zero-slack pair
  needing a shared teardown resolves), the teardown-once and step-budget
  termination bounds, determinism (byte-identical repeat runs), and the
  oracle-legality of every emitted prefix.
- The owner's pair as a real fixture (both directions), asserted through
  `transitionOrderPath` so selection is covered, not just the walk.
- Existing transition suites unchanged and green: the oracle unit tests,
  the four-corpus sweeps, selection-transition, the view tests, e2e.
- The offline harness gains the per-pair before/after comparison and
  reports which candidate won per pair (walk / two-pass / full-respec
  distribution), so the walk's actual coverage is visible, not assumed.

## Non-goals

- No star-level moves (partial teardown of a shared member).
- No truncated-respec rung (approach C) in this effort; it is the recorded
  next step if the full-respec tail remains fat after the walk.
- No changes to web/src/core/orderLegality.ts, the panel, i18n, or URL
  state.
- No changes to the from-scratch build-order machinery.
