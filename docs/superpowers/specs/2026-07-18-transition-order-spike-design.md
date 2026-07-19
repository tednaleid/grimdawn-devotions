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

## Findings (2026-07-18)

Commands run, in order:

```
just spike-transition --pairs 20 --seed 1     # smoke run
just spike-transition --pairs 500 --seed 1    # full run, seed 1
just spike-transition --pairs 500 --seed 2    # full run, seed 2 (stability check)
```

Each full run generates 875 pairs total (500 small-delta, 125 random, 125
near-cap, 125 tight-cap) and completed in about 5 seconds wall-clock (not
minutes). Combined across both seeds: 1750 pairs, **zero oracle failures**.

### Per-corpus results, seed 1

| corpus | pairs | incremental | teardown-1 | full-respec | none | beats teardown+rebuild | moved/theoreticalMin (median, p95) | churn readd (pairs, events) | churn uncovered-add (pairs, events) | runtime transition p50/p95 | runtime from-scratch p50/p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| small-delta | 500 | 480 (96.0%) | 0 | 16 (3.2%) | 4 (0.8%) | 96.8% (480/496) | 1.00x, 1.10x | 16 (3.2%), 221 | 19 (3.8%), 30 | 0.044ms / 0.178ms | 0.075ms / 0.279ms |
| random | 125 | 117 (93.6%) | 0 | 7 (5.6%) | 1 (0.8%) | 92.7% (115/124) | 1.02x, 1.25x | 7 (5.6%), 36 | 63 (50.4%), 98 | 0.115ms / 9.167ms | 0.081ms / 0.302ms |
| near-cap | 125 | 122 (97.6%) | 0 | 2 (1.6%) | 1 (0.8%) | 98.4% (122/124) | 1.00x, 1.07x | 2 (1.6%), 28 | 3 (2.4%), 4 | 0.034ms / 0.087ms | 0.069ms / 0.205ms |
| tight-cap | 125 | 118 (94.4%) | 0 | 4 (3.2%) | 3 (2.4%) | 96.7% (116/120) | 1.00x, 1.11x | 4 (3.2%), 55 | 5 (4.0%), 6 | 0.033ms / 4.334ms | 0.069ms / 0.154ms |

### Per-corpus results, seed 2

| corpus | pairs | incremental | teardown-1 | full-respec | none | beats teardown+rebuild | moved/theoreticalMin (median, p95) | churn readd (pairs, events) | churn uncovered-add (pairs, events) | runtime transition p50/p95 | runtime from-scratch p50/p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| small-delta | 500 | 484 (96.8%) | 0 | 15 (3.0%) | 1 (0.2%) | 97.0% (484/499) | 1.00x, 1.08x | 15 (3.0%), 211 | 15 (3.0%), 28 | 0.043ms / 0.150ms | 0.068ms / 0.282ms |
| random | 125 | 112 (89.6%) | 0 | 13 (10.4%) | 0 | 88.8% (111/125) | 1.02x, 1.31x | 13 (10.4%), 66 | 64 (51.2%), 107 | 0.113ms / 14.799ms | 0.071ms / 0.190ms |
| near-cap | 125 | 120 (96.0%) | 0 | 3 (2.4%) | 2 (1.6%) | 97.6% (120/123) | 1.00x, 1.07x | 3 (2.4%), 39 | 2 (1.6%), 2 | 0.036ms / 0.078ms | 0.066ms / 0.150ms |
| tight-cap | 125 | 116 (92.8%) | 0 | 7 (5.6%) | 2 (1.6%) | 94.1% (112/119) | 1.00x, 3.63x | 7 (5.6%), 99 | 7 (5.6%), 8 | 0.034ms / 3.843ms | 0.079ms / 0.858ms |

"beats teardown+rebuild" is counted over pairs that produced an order (rung
!= none) and for which `teardownRebuild` also succeeded; "churn" percentages
are of all pairs in the corpus. A cross-tab of rung against "beats
teardown+rebuild" (small-delta, both seeds) shows the split is exact: every
incremental resolution beats teardown+rebuild (480/480 seed 1, 484/484 seed
2), and no full-respec resolution does (0/16 seed 1, 0/15 seed 2) — full
respec costs about the same as the teardown+rebuild fallback, as expected
since both tear the whole thing down.

### teardown-1 essentially never wins

Across both official runs (1750 pairs, all four corpora) the **teardown-1**
rung produced zero winning orders. A broader diagnostic sweep (not part of
the official corpus: 15 seeds x 300 mutated pairs + 15 seeds x 60 random
pairs = 5400 pairs) found exactly one: rate ~0.02%. The escalation ladder's
middle rung is real and oracle-clean when it fires, but on this corpus the
search essentially always resolves at the two ends — either the pure
incremental replay finds an order, or none of the up-to-8 singleton
teardown candidates unstick it and the search falls through to full respec.

### Sample orders (verbatim)

**Incremental** (seed 1, small-delta pair, moved=14, theoreticalMin=14):

```
1. -7 tempest (held 48)
2. +1 crossroads_chaos (held 49)
3. +1 crossroads_order (held 50)
4. +1 crossroads_primordial (held 51)
5. +4 gallows (held 55)
```

**teardown-1** (from the diagnostic sweep above, mulberry32 seed 3,
mutatePair small-delta pair; oracle-clean, moved=36 vs theoreticalMin=26 —
`base` = tortoise, falcon, spider, quill, fox, magi, ghoul,
crossroads_primordial, rhowan_s_crown, gallows, stag, messenger_of_war;
`cur` = tortoise, falcon, spider, magi, ghoul, crossroads_primordial,
gallows, stag, messenger_of_war, wretch, sailor_s_guide, tsunami — falcon is
the shared member torn down and re-added):

```
1. -4 fox (held 51)
2. -5 rhowan_s_crown (held 46)
3. -5 falcon (held 41)
4. +4 wretch (held 45)
5. +4 sailor_s_guide (held 49)
6. +5 falcon (held 54)
7. -4 quill (held 50)
8. +5 tsunami (held 55)
```

**full-respec** (seed 1, small-delta pair, moved=120, theoreticalMin=16 —
the widest quality gap between rungs, as expected: a full teardown+rebuild
of an unrelated build moves far more than the pure delta):

```
1. -6 hyrian_guardian_of_the_celestial_gates (held 49)
2. -6 widow (held 43)
3. -3 hawk (held 40)
4. -5 shepherd_s_crook (held 35)
5. -5 akeron_s_scorpion (held 30)
6. -5 imp (held 25)
7. -5 spider (held 20)
8. -4 fox (held 16)
9. +1 crossroads_chaos (held 17)
10. -4 wretch (held 13)
11. -1 crossroads_chaos (held 12)
12. -4 sailor_s_guide (held 8)
13. +1 crossroads_primordial (held 9)
14. -4 gallows (held 5)
15. -1 crossroads_primordial (held 4)
16. +1 crossroads_eldritch (held 5)
17. -3 scholar_s_light (held 2)
18. -1 crossroads_eldritch (held 1)
19. -1 crossroads_ascendant (held 0)
20. +1 crossroads_ascendant (held 1)
21. +1 crossroads_order (held 2)
22. +1 crossroads_eldritch (held 3)
23. +3 scholar_s_light (held 6)
24. -1 crossroads_eldritch (held 5)
25. +1 crossroads_primordial (held 6)
26. +3 hound (held 9)
27. -1 crossroads_primordial (held 8)
28. +4 fox (held 12)
29. +4 gallows (held 16)
30. +4 harpy (held 20)
31. +5 spider (held 25)
32. +5 imp (held 30)
33. +5 akeron_s_scorpion (held 35)
34. +5 shepherd_s_crook (held 40)
35. +3 hawk (held 43)
36. +6 widow (held 49)
37. +6 hyrian_guardian_of_the_celestial_gates (held 55)
```

### Runtime vs the live from-scratch cost

On small-delta pairs (the realistic compare case, the only corpus the
runtime bar is meaningfully load-bearing for) the transition order is
consistently at or below the live `buildOrderPath` cost on the same input:
p95 0.178ms vs 0.279ms (seed 1, 0.64x) and 0.150ms vs 0.282ms (seed 2,
0.53x). near-cap is similar (0.42x-0.52x). random and tight-cap both show
p95 tail outliers well past 2x from-scratch cost (random: 30.4x seed 1,
77.9x seed 2; tight-cap: 28.1x seed 1, 4.5x seed 2). For tight-cap
specifically, re-running the seed-1 corpus with per-pair instrumentation
shows the tail traces to ZERO-SLACK pairs (both builds' size equals the
cap — a common mid-leveling compare scenario, not the deliberate
baseline-over-cap case the corpus was built to exercise): the corpus's 2
baseline-over-cap pairs both resolved incremental in roughly 0.1ms, while
every pair past a few milliseconds is zero-slack and burns the teardown-1
candidate search (8 candidates x 17 sampled orders each) before falling
through to full-respec or none. Removing or time-boxing teardown-1 is
therefore expected to cure the runtime tail. random is the spec's declared
stress corpus ("reported for information, not gated"); tight-cap is not
declared non-gated and its p95 outlier is a real go/no-go-relevant number,
not just informational.

### The teardown+rebuild fallback's oracle rejections trace to a live-engine ordering bug

The spike's most consequential discovery is not about the prototype at all: it is that the LIVE
engine's own from-scratch order generator, `buildOrderPath` in `web/src/core/reachability.ts`, can
itself emit an illegal refund sequence. At each construction step it diffs the previous scaffold
set against the new one and pushes a refund for every scaffold dropped from `held`, in the
iteration order of the `held` array — not in dependency order. When two scaffolds are refunded in
the same batch and the second one's own requirement was covered by the first one's grant, the
first refund strands the second mid-batch (observed pattern: refund `crossroads_chaos` then
`viper`, where viper's own requirement needs the chaos affinity crossroads_chaos was supplying).

Replaying 999 live from-scratch orders (one generated build per seed 1-999, `buildOrderPath` at
its default tries=16) through the spike's independent oracle (`verifyTransition`, from an empty
build to the generated selection): 43 (4.3%) fail, all at a refund step's conservative mid-point,
none at an add step. This is a real product-facing bug candidate in the shipped guided-build-order
panel, not a spike-only artifact — `buildOrderPath` is the same function the compare-mode panel
calls today for the current build's from-scratch order.

Two readings are currently unresolved, and only checking against the game can settle which: (a)
the game genuinely forbids refunding a constellation whose own requirement was met by something
also being refunded in the same pass, in which case today's build-order panel is printing
unexecutable refund sequences for roughly 4% of builds — a real product bug the spike found as a
side effect; or (b) the game exempts the constellation being refunded from needing its own
requirement covered while it is itself being removed, in which case the spike's oracle is
over-strict on this point and the spike's `none`/`full-respec` counts are conservative (some of
those pairs may have a legal order the oracle wrongly rejected). Either reading is fixed the same
way: dependency-order the refund batch so a scaffold refunds only after nothing still-standing
needs it — exactly the pattern `seededReplay`'s backward-pass `drain()` already implements in this
file.

This also explains a result that otherwise looks surprising against this spec's own Definitions
claim that teardown+rebuild is "constructively available whenever both endpoints have from-scratch
orders": in the seed-1 small-delta corpus, all 4 `none` pairs had both `buildOrderPath(base)` and
`buildOrderPath(cur)` succeed (checked directly, tries=64 matching `teardownRebuild`'s own call),
yet `transitionOrderPath` still returned null. The ladder fell through because `teardownRebuild`'s
REVERSED baseline order hit this exact refund-ordering hazard and the oracle correctly rejected
it. The fallback is not unconditionally available the way the Definitions section describes; this
note supersedes that claim.

### Go/no-go bar, verdict

- **Hard invariant — zero oracle failures on emitted orders**: PASS. 0
  failures across 1750 pairs (both seeds, all four corpora) plus 0 across
  the 35-pair smoke run (`--pairs 20`, all four corpora) and a 5400-pair
  diagnostic sweep run to hunt for a teardown-1 sample (below) — 7185 pairs
  checked, 0 failures.
- **Quality gate — at least 90% of small-delta pairs produce an incremental
  order that strictly beats teardown+rebuild on moved points**: PASS. Seed
  1: 480/500 = 96.0%. Seed 2: 484/500 = 96.8%. (Every incremental resolution
  beats teardown+rebuild; no full-respec resolution does, per the cross-tab
  above.)
- **Quality gate — same-constellation refund-then-readd churn under 5% of
  produced small-delta orders**: PASS. Seed 1: 16/496 = 3.2%. Seed 2:
  15/499 = 3.0%.
- **Runtime — p95 within roughly 2x the live from-scratch cost**: PASS on
  small-delta (0.53x-0.64x) and near-cap (0.42x-0.52x). FAILS on random
  (30.4x-77.9x) and tight-cap (4.5x-28.1x) — see the runtime section above
  for the numbers and cause.

### What "zero oracle failures" does and doesn't mean

Two disclosures on reading the numbers above. First, the headline "zero oracle failures across
1750+ pairs" is true BY CONSTRUCTION, not by luck: every rung the escalation ladder tries is
filtered through `clean()` (the same `verifyTransition` oracle) before `transitionOrderPath`
returns it, and a rejected rung is silently retried at the next rung down rather than surfaced. An
emitted order can never fail the oracle; the informative signals are instead the rung distribution
(how often the surgical rungs win vs. falling to full-respec) and the rejection-driven demotions
(how often a rung was tried and rejected before the next one succeeded, or before falling to
`none`) — and the harness does not currently count the latter. The teardown+rebuild rejections
found in the previous section are exactly this uncounted signal; they surfaced only through extra
instrumentation, not from anything the shipped report prints.

Second, corpus scope: every pair in all four corpora is built from WHOLE constellations only (the
fuzzer's forward-generation rule adds a constellation at its full size or not at all). No corpus
exercises a partial-constellation resize except the Eel fixture pair (a single hand-picked real
compare-URL), and that pair resolves via the full-respec rung, not incrementally. The mutation
step (`mutatePair`) also filters candidate removals through `isValidBuild`, which biases away from
load-bearing swaps (a removal that strands a dependent is discarded and retried rather than kept
as a harder case). So the synthetic 96% incremental-resolution number may overstate quality on
real inputs, where partial-constellation resizes and load-bearing swaps are common.

### Recommendation

The hard invariant and both small-delta quality-gate numbers clear their
bars with margin on both seeds, and the escalation ladder's shape holds up
at scale: incremental resolves 89.6%-97.6% of pairs across every corpus and
seed (small-delta, near-cap, and tight-cap all stay at 92.8%+; random's
89.6% is the one outlier, and random is the spec's declared stress corpus),
the rare non-incremental cases are legal and no worse than the existing
teardown+rebuild fallback, and moved points track the theoretical minimum
closely (median 1.00x-1.02x, p95 1.07x-1.31x) everywhere except tight-cap's
seed-2 p95 (3.63x). The open question is the runtime bar: small-delta and
near-cap are comfortably inside 2x, but random and tight-cap post p95
outliers of 4.5x to 78x on a per-click-path budget. The tight-cap tail
traces specifically to zero-slack pairs (build size at the cap) burning the
teardown-1 candidate search before falling through, not to the
baseline-over-cap scenario the corpus was built to exercise (those pairs
resolve incrementally in roughly 0.1ms) — so removing or time-boxing
teardown-1 is the expected fix, not a scope question about which
transitions the interactive path must handle. Separately, the
teardown+rebuild fallback itself has an unresolved legality question (the
refund-ordering bug described above), so the `none`/`full-respec` counts
and the "beats teardown+rebuild" comparisons above should be read with that
caveat rather than as fully settled numbers. Whether the runtime tail is
fully cured by bounding teardown-1, or whether some cases should still fall
back to a cheaper rung past a search-time budget, is a call for Ted, not a
number this spike can resolve on its own.
