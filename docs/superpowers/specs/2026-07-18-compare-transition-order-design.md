# Compare-mode transition build order

Point-in-time design record. In compare mode the build-order panel currently
shows how to assemble the current build from scratch. This feature makes it
show how to get from the baseline build to the current build: a sequence of
legal refunds and adds a player can execute in-game. The transition-order
spike (2026-07-18-transition-order-spike-design.md, Findings) established
viability: on realistic small-delta pairs the incremental path exists about
96 percent of the time, beats teardown+rebuild on moved points 96 percent of
the time, is churn-free by construction, and computed at roughly half the
cost of the from-scratch order of its day (the ratio must be re-measured;
see Performance).

Resumed 2026-07-20. Three efforts shipped while this was parked and are now
substrate this design builds on rather than work it contains: Phase 0
shipped as the build-order validity effort (see below); the panel gained a
per-step affinity popup fed by the verifying replay's states (one walk, two
outputs); and from-scratch orders became churn-minimized (best-of-both:
need-driven greedy versus sampled witness, selected by fewer `churnPoints`
then fewer steps). The phases below are edited in place to match.

## The hard invariant: verified or absent

No order is better than an illegal order. Every order the build-order panel
renders - transition, full-respec fallback, and the existing from-scratch
order alike - must pass an independent legality replay before display, per
click, in production. For from-scratch orders this shipped as
web/src/core/orderLegality.ts (`replayBuildOrder`/`gateBuildOrder`); the
transition oracle joins that module, following its rules (type-only imports
from reachability, no shared engine code). A candidate
that fails verification is discarded and the panel degrades to the next
rung; the last resort is the honest empty state. Displaying an unverified
order is structurally impossible, not merely tested against. The check is a
linear replay measured well under a millisecond.

The game rule behind the oracle was confirmed in-game during design: a star
cannot be refunded when the refund would leave any standing constellation
(including the one being torn down, mid-teardown) with unmet affinity
requirements. This is the strict reading of the "removal cannot strand a
dependent" rule in docs/devotion-system.md.

## Phase 0: shipped (build-order validity effort, 2026-07-19)

The refund-ordering bug this phase described was fixed and deployed as its
own effort while this design was parked. What landed, and what this feature
now builds on: legality-ordered refund draining in `buildOrderPath`
(`drainRefunds`); the independent oracle module web/src/core/orderLegality.ts
(`replayBuildOrder`, `verifyBuildOrder`, `gateBuildOrder`) with per-step
`StepState`s from the same verifying walk; the verified-or-absent gate in
`selectionView` (the panel renders only oracle-proven orders); permanent
regression nets (the 150-seed sweep and repro URL in
web/test/build-order-oracle.test.ts, the tight-cap corpus, the offline
`just build-order-validate` harness); and the documentation set (strict
rule 5 in docs/devotion-system.md, the enforcement invariant in
docs/reachability-engine.md, the CLAUDE.md invariant entry).

## Phase 1: test harness first

Promote the spike's pure pieces into permanent test infrastructure and
close the realism gaps its final review measured:

- Promote `verifyTransition` (the oracle) and the pair generators out of
  web/scripts/transition-spike.ts. The oracle joins
  web/src/core/orderLegality.ts, matching the shipped module's idioms: a
  replay that returns both the verdict and per-step `StepState`s (one walk,
  two outputs - the popup needs the states, see phase 2), a thin
  verdict-only wrapper, and a verified-or-absent gate; type-only imports
  from reachability. The pair generators go to the test-support harness.
  The oracle is the exact legality bar, not a conservative proxy.
- Star-level mutations: pairs where shared constellations differ in star
  count (partials and resizes). The spike corpus was whole-constellation
  only; the resize path had effectively zero coverage.
- Load-bearing swap pairs: mutations that remove a granting member and
  regrow around the hole. The spike's keep-valid mutation filter biased
  away from this hardest realistic shape.
- Real-URL fixture pairs: selections decoded from actual planner links
  (`decodeHash` then `selectionSummary`), the way the spike's Eel fixture
  works, including near-cap and zero-slack cases.
- Count oracle rejections per rung in the harness report. The spike's
  zero-failures headline was enforced by construction; the informative
  signals are the rung distribution and rejection-driven demotions.

## Phase 2: engine entry point

New module `web/src/core/transitionOrder.ts` (a focused file rather than
growing the 1,100-line reachability.ts), depending on reachability.ts
exports:

- `transitionOrderPath(cons, table, base, cur, cap, tries)` ported from the
  spike with two rungs: incremental (seeded replay, prefer-held bias,
  two-pass refund scheduling with the eager-schedule budget fallback), else
  full-respec (reverse of the baseline's from-scratch order, then the
  current build's from-scratch order - both now the churn-minimized
  best-of-both orders `buildOrderPath` ships, inherited for free). Every
  rung's output is oracle-verified before it is returned.
- The panel's per-step affinity popup works in compare mode: the verifying
  replay's `StepState`s ride along with whichever rung's order is shown
  (the gate returns steps and states together, as `gateBuildOrder` does
  today), so hovering a transition step - refunds of baseline members
  included - shows the have/need standing at that point. Popup numbers are
  the judge's numbers by construction, never a second computation.
- The teardown-1 rung is dropped. The spike measured it winning about 1 in
  5,400 pairs, and its candidate search is the sole cause of the runtime
  tail on zero-slack pairs (build size equals cap, a common mid-leveling
  shape) - removing it cures the one failed runtime bar. The oracle harness
  makes reintroducing it later safe if real usage disagrees.
- When both rungs fail (rare "none" pairs), the panel falls back to the
  current build's from-scratch order, so compare mode never shows less than
  today. The identity edge (base equals cur while over cap) returns the
  empty transition only when the build fits the cap; otherwise it is
  treated as a none pair.
- `selectionView` gains an optional baseline parameter. When comparing, the
  transition computation replaces the from-scratch `buildOrderPath` call,
  keeping the per-click cost roughly flat (see Performance for the
  re-measurement caveat).

## Phase 3: panel rendering and internationalization

- `buildOrderView` renders transition steps with the existing step-row
  vocabulary (`bo-add`/`bo-refund` classes, Add/Refund labels,
  constellation art on completions, the running held total). New rendering:
  a compare-mode panel heading naming the direction (baseline to current),
  a plain notice when the shown order is the full-respec fallback, and the
  none-case framing when only the from-scratch order is available. Each new
  string is a catalog key in web/src/i18n/app.en.json plus the 12 other
  locales and the appCatalog guard; no hardcoded user-facing text.
- Direction follows the compare roles, so pressing Swap flips the
  transition automatically (it always reads baseline to current).
- No new URL state: the baseline already rides in `cs=`/`cp=`, and every
  rendered state round-trips through the existing hash.
- E2e smoke: enter compare, diverge the build, assert the panel shows a
  transition beginning with a refund step; press Swap and assert the
  direction flips; exit compare and assert the from-scratch order returns.

## Performance

The spike measured the incremental rung at about 0.7 ms per pair, roughly
half the from-scratch cost of its day, with the zero-slack tail cured by
dropping teardown-1. The from-scratch baseline has since changed
(best-of-both runs two emissions per click), so the ratio is stale and the
absolute numbers must be re-measured, not assumed. The bar is unchanged:
the existing per-click budget (`just perf`, selectionView) shows no
regression; compare mode replaces one order computation with another
rather than adding one. Note the fallback rungs call `buildOrderPath`,
which now pays the two-emission cost itself.

## Non-goals

- No teardown-1 rung in v1 (data-driven; see phase 2).
- No star-level step granularity: steps remain constellation-level
  (size-delta steps for partials), matching the existing panel.
- No respec-cost (aether crystal) estimates in the panel.
- No new URL parameters, and no change to how comparisons start or end.
- No WASM work: build order runs in the TS core on all paths today.

## Decision log

Recorded from the design conversation: the panel becomes the transition
order while comparing (no toggle, no stacking); the fallback shows the
labeled full-respec order; v1 drops teardown-1; the refund rule's strict
reading was confirmed in-game, making the oracle the exact legality bar and
the live panel's refund ordering a real bug; verified-or-absent is the
feature's hard invariant, stated by the project owner as "I'd rather not
ship the feature than have it suggest an illegal path"; phase 0 ships first
because trust in the panel precedes adding to it. Resumed 2026-07-20 by the
project owner after phase 0 (the validity effort), the step popup, and
need-driven ordering all shipped; the spec was edited in place to build on
that substrate, and the branch was rebased onto the deployed main (spike
code and tests pass the full gate unchanged).
