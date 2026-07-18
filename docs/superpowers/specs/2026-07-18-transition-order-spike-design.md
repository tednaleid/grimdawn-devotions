# Transition build order spike (baseline to current, in compare mode)

Point-in-time design record. In compare mode the build-order panel still shows
how to assemble the current build from scratch. The idea under test: show
instead how to get from the baseline build to the current build, as a sequence
of legal refunds and adds. The engine analysis says this is mechanically
viable; what is unproven is the quality of the produced orders and how often an
incremental path exists at all. This spike produces those numbers headlessly,
with zero product-code changes, and the numbers decide whether the real
feature gets built.

## Why viability is plausible (engine analysis)

The from-scratch order (`buildOrderPath` in `web/src/core/reachability.ts`)
samples an order for the build's granting constellations, replays it while
computing at each step the cheapest transient scaffold set that keeps every
standing constellation valid (`peakToReach`), and diffs consecutive scaffold
sets into add and refund steps. Three properties transfer directly:

- `peakToReach` already accepts a `base` affinity: permanently held affinity
  that bootstraps scaffolds. It was built for mid-construction states.
- The replay loop is seeded state (grants so far, max requirement, held
  scaffolds, running points). A transition is the same loop seeded with:
  grants = the shared constellations (baseline intersect current), held = the
  baseline-only constellations treated as pre-paid scaffolds, running =
  baseline size. The loop already refunds held scaffolds the moment the
  need-set drops them, which is exactly "refund baseline pieces you no longer
  need, as late as they are useful".
- Refund legality falls out: a refund happens only when the recomputed
  need-set covers every standing requirement without the refunded piece (the
  "removal cannot strand a dependent" rule). The honest-null philosophy also
  carries over: no order found means null, never a bad order.

## Definitions

- **Transition order**: a sequence of constellation-level refund and add steps
  from the baseline selection to the current selection where every
  intermediate state is valid and at or under the budget. Constellation
  granularity matches the existing panel; a constellation whose star count
  differs between the two builds contributes a size-delta step (partials are
  already modeled as zero-grant members).
- **Budget**: the live cap (`p=`). A baseline larger than the live cap is
  legal input; the replay's refund-before-add step order accommodates it (the
  first steps are refunds).
- **Moved points**: the sum of absolute step points across an order (adds
  plus refunds), the total effort of executing it.
- **Theoretical minimum**: the pure delta, sum over constellations of the
  absolute star-count difference between baseline and current. No transition
  can move fewer points.
- **Teardown+rebuild**: refund the baseline in the exact reverse of its own
  from-scratch construction order, then run the current build's from-scratch
  order. Reversing a valid construction is legal (every prefix of a valid
  construction is a valid state), so this fallback is constructively
  available whenever both endpoints have from-scratch orders. It is the
  worst acceptable output and the bar the incremental order must beat.
- **Churn**: legal but wasteful steps. Two counted forms: refunding a
  baseline constellation and later re-adding that same constellation, and
  adding a fresh scaffold while a still-held baseline constellation already
  supplies the needed affinity. Churn is never invalid; it is what a human
  reads as "why did you do that?".

## The spike

One script, `web/scripts/transition-spike.ts`, run via a new `just
spike-transition` recipe. Zero product-code changes: every engine primitive it
needs is already exported (`peakToReach` with `base`, `buildOrderPath`,
`selectionSummary`, `buildReachCons`, `buildCoverTable`, classification); the
few one-line vector helpers it needs (`zero`, `covers`, `addCap`, `maxV`) are
re-declared locally in the script. Three parts:

1. **Prototype**: `transitionOrderPath(cons, table, baseline, current, cap,
   tries)` implementing the seeded sampler and replay described above, with
   three refinements:
   - **Prefer-held bias**: held baseline constellations sort ahead of fresh
     scaffolds of equal usefulness in scaffold selection.
   - **Two-pass refund scheduling**: a forward pass computes each step's need
     set, then a backward pass schedules each held constellation's refund
     after its last use (immediately, if it is never needed). Refunds happen
     when the points are wanted, not eagerly, which structurally eliminates
     refund-then-readd churn rather than merely biasing against it. A
     never-needed baseline-only constellation (supply comfortably above the
     standing need) refunds at step zero and its points return up front.
   - **Escalation ladder over shared teardowns**: the search chooses a subset
     S of shared constellations to temporarily tear down, seeds the replay
     with (shared minus S), and moves S into the add order (refund emitted
     early, re-add sequenced by the sampler). S empty is the pure incremental
     path, tried first. If it yields nothing, singleton S candidates are
     tried in order of how much they relax the binding deficit (highest
     dominating requirement, then most budget freed). S equal to all shared
     members IS teardown+rebuild, so the fallback is the ladder's last rung
     rather than a special case, and quality degrades gracefully from
     surgical to full respec.
2. **Oracle**: an independent legality checker that replays an emitted order
   step by step, recomputing from scratch at each step that every standing
   constellation's requirement is covered by standing grants (the engine's
   covers semantics), that the running total never exceeds the budget, and
   that the final state equals the current build. Independent means it shares
   no bookkeeping with the prototype's replay. The oracle survives the spike
   as the test harness for the real feature.
3. **Corpus and report**. Corpus:
   - Small-delta pairs (the realistic compare case): a valid build generated
     by forward construction (the fuzzer's approach), plus a legally mutated
     copy: refund one to three constellations, grow or add different ones
     within cap, keep the result valid.
   - Random pairs: two independently generated valid builds (stress case,
     reported for information, not gated).
   - Near-cap cases: deliberate 55-of-55 to 55-of-55 pairs, plus some pairs
     under tighter caps and pairs where the baseline exceeds the live cap.

   Report, per corpus: ladder-rung distribution (pure incremental, singleton
   teardown, full respec — every pair resolves to some rung, so the question
   is how often the surgical rungs win), percentage of pairs where the
   produced order strictly beats teardown+rebuild on moved points, moved
   points relative to the theoretical minimum, churn frequency by both forms,
   runtime percentiles alongside the live `buildOrderPath` cost on the same
   inputs, and ten sample orders printed human-readably for eyeballing.

## Go/no-go bar

- **Hard invariant**: zero oracle failures on emitted orders. A single
  failure is a prototype bug; it gets fixed or the answer is no-go. Invalid
  output is never acceptable, in the spike or the feature.
- **Quality gate** (small-delta pairs): at least 90 percent produce an
  incremental order that strictly beats teardown+rebuild on moved points;
  same-constellation refund-then-readd churn in under 5 percent of produced
  orders with the prefer-held bias on.
- **Runtime**: p95 within roughly 2x the live from-scratch `buildOrderPath`
  cost on the same inputs, since the feature would sit on the per-click path.

## Outcome

Findings (the numbers, sample orders worth keeping, and the go/no-go call)
get recorded in a Findings section appended to this spec when the spike runs;
this document is the dated record of both the plan and the result. If the
call is go, the real feature (engine entry point, `selectionView` wiring,
compare-mode panel copy, fallback presentation) gets its own spec and plan;
nothing in this spike commits to UI decisions. The spike script stays in
`web/scripts/` afterward as the transition fuzz harness.

## Non-goals

- No product-code changes of any kind: no engine edits, no UI, no URL state,
  no i18n keys.
- No star-level ordering within a constellation (the existing panel is
  constellation-level; the feature would be too).
- No decision on compare-mode UI copy or layout; that belongs to the
  follow-up feature spec if the spike says go.
