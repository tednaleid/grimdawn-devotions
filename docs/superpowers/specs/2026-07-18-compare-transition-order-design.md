# Compare-mode transition build order

Point-in-time design record. In compare mode the build-order panel currently
shows how to assemble the current build from scratch. This feature makes it
show how to get from the baseline build to the current build: a sequence of
legal refunds and adds a player can execute in-game. The transition-order
spike (2026-07-18-transition-order-spike-design.md, Findings) established
viability: on realistic small-delta pairs the incremental path exists about
96 percent of the time, beats teardown+rebuild on moved points 96 percent of
the time, is churn-free by construction, and computes at roughly half the
cost of the from-scratch order already run per click.

## The hard invariant: verified or absent

No order is better than an illegal order. Every order the build-order panel
renders - transition, full-respec fallback, and the existing from-scratch
order alike - must pass the independent legality replay (the spike's oracle,
promoted into core) before display, per click, in production. A candidate
that fails verification is discarded and the panel degrades to the next
rung; the last resort is the honest empty state. Displaying an unverified
order is structurally impossible, not merely tested against. The check is a
linear replay measured well under a millisecond.

The game rule behind the oracle was confirmed in-game during design: a star
cannot be refunded when the refund would leave any standing constellation
(including the one being torn down, mid-teardown) with unmet affinity
requirements. This is the strict reading of the "removal cannot strand a
dependent" rule in docs/devotion-system.md.

## Phase 0: fix the live refund-ordering bug (independently shippable)

The spike discovered that `buildOrderPath` (web/src/core/reachability.ts)
emits scaffold-refund batches in held-array order, not dependency order. On
43 of 999 sampled builds (4.3 percent) the emitted order refunds a
constellation whose grant still sustains another standing member - for
example completing Bard's Harp and then refunding Panther, stranding Bard's
Harp's requirement. Under the confirmed strict rule these orders are not
executable in-game past the stranding step. Reproduction links (seeds 86,
97, 113 of the diagnostic search) are recorded in the session ledger.

The fix: order each refund batch so that no refund strands a standing
requirement - refund only members whose grant is not load-bearing for what
remains, iterating until the batch drains (the spike's `drain()` in
web/scripts/transition-spike.ts is the reference pattern). This corrects
the panel for the affected builds today and is what the transition
fallback rung later relies on.

Guard: a CI test replays seeded from-scratch orders through the promoted
oracle and asserts zero rejections, converting the spike's discovery into a
permanent regression net.

Documentation in the same change: docs/devotion-system.md gains the
strict-reading clarification of the refund rule (confirmed in-game);
docs/reachability-engine.md gains the verified-or-absent enforcement
invariant; CLAUDE.md gains a short invariant entry alongside the URL-state
and i18n invariants so future sessions inherit the rule.

Phase 0 ships on its own before the rest of the feature.

## Phase 1: test harness first

Promote the spike's pure pieces into permanent test infrastructure and
close the realism gaps its final review measured:

- Promote `verifyTransition` (the oracle) and the pair generators out of
  web/scripts/transition-spike.ts into the harness the feature's tests use.
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
  current build's from-scratch order). Every rung's output is
  oracle-verified before it is returned.
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
  keeping the per-click cost roughly flat (the spike measured the
  incremental rung at 0.5 to 0.6 times the from-scratch cost).

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
- The stale "Find valid order" ABOUTME line in buildOrderView.ts is
  corrected while the file is open.
- E2e smoke: enter compare, diverge the build, assert the panel shows a
  transition beginning with a refund step; press Swap and assert the
  direction flips; exit compare and assert the from-scratch order returns.

## Performance

The spike's numbers, which phase 2 inherits and the perf harness should
confirm: incremental rung about 0.7 ms per pair (0.5 to 0.6 times the live
from-scratch cost), zero-slack tail cured by dropping teardown-1. The
existing per-click budget (`just perf`, selectionView) is the bar; compare
mode replaces one order computation with another rather than adding one.

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
because trust in the panel precedes adding to it.
