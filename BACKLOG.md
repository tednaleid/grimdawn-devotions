# Backlog

Planned enhancements for the web planner that are not yet started. Each item
should include implementation pointers for whoever picks it up.

(The path-predictor / reachability mode, its WASM resolver, and the reachability
correctness fuzzer have shipped; see `docs/reachability-performance.md` and the
`docs/superpowers/specs/` path-predictor designs. The old "blocked-activation
flash" idea was superseded by claim-anywhere reachability and is dropped.
Pet-bonus filtering and tagging has also shipped: clickable pet benefit chips, a
pet "Available to get" list, and scoped highlight keys. Conditional bonus qualifiers
have shipped too: a star's weapon requirement now shows on the star and constellation
tooltips, verbatim when the whole constellation shares one requirement; see
`docs/superpowers/specs/2026-06-24-conditional-bonus-qualifiers-design.md`. Baseline
build comparison has shipped: snapshot a build, see a live Base/Now/Delta against it,
added/removed marks on the map, bookmarkable via `cs=`/`cp=`; the Benefits panel was then
unified to one row per value in both modes. See the
`docs/superpowers/specs/2026-06-24-baseline-build-comparison-design.md` and
`docs/superpowers/specs/2026-06-24-unified-benefits-layout-design.md` designs.)

## Reachability engine: current state and known gaps

The shipped engine (the memoized branch-and-bound resolver in `web/src/core/reachability.ts`,
ported to `data/reach.wasm`) is FAST and rarely false-dims in normal play, but it has two
measured gaps. A re-runnable test suite now guards both; the gaps are locked in as `test.failing`
so they flip to passing - alerting us to drop `test.failing` - once fixed. Measure with
`just harvest-false-dims`, `just fuzz`, `just validate-reach`, and `just perf`.

Engine comparison that produced this (worktree experiment, see git history): on the neutral
downward-closure harvest the shipped engine reveals ~0% false-dims vs the costed-scaffolding
alternate's ~92%, and its per-click `selectionView` stays ~1ms-1.1s vs the alternate's multi-second
freezes. The shipped engine is the right default; the costed alternate (branch
`reachability-costed-scaffolding`) is kept as a SOUND-by-construction oracle and as the substrate
for guided build order, not as the per-click engine.

### A. Construction-peak false-reach - FIXED 2026-06-26 (residual synthetic-model gap still open)
Against the independent BFS oracle on random small models, the resolver false-reaches on some sampled
models - it calls some unreachable selections reachable. The audit (`just audit-false-reach`) localized
it: `greedyFrom` (~79%) and the exact resolver (~21%) both treat the crossroads seed as free and
always-held, so they ignore that scaffolding costs budget at the construction PEAK; the peak witness
emits zero false-reaches. On random models the rate is budget-independent (~5-6%), so the oracle test
stays `test.failing` as a guard on the mechanism. A first real-model upper bound (4000 self-covering
COMPLETE builds, 0 suspects) suggested the rate was ~0% on the real model - but that audit was too weak
(complete builds only, no exact min-peak).

CONFIRMED 2026-06-25 (`just realmap-hunt`): the gap IS real on the Grim Dawn map, not synthetic-only.
The hunt generates tight near-55-point self-covering real builds that stack the 8 Affliction-like target
shapes (multi-color requirement, partial self-payback: Amatok, Assassin, Dire Bear, Rhowan's Crown,
Rhowan's Scepter, Shieldmaiden, Solael's Witchblade, Ulo), checks which the shipped engine lights, and
proves construction feasibility with the order-exact min-peak DP `minPeakCost` (vendored from branch
`reachability-costed-scaffolding`). Over 50k seeds: 44,361 lit builds, 44,359 with a real <=55
construction order (sound witnesses), and 2 CONFIRMED false-reaches - 55-point builds the engine lights
whose exact min construction peak is 56 (off by one). Reproducible: `just realmap-hunt --probe 5563` and
`--probe 41966`. Mechanism: the build is self-covering and fits 55 permanently, but every construction
order must transiently hold one extra scaffold point to bootstrap the multi-color reqs, overflowing the
peak; the engine lights it via the seed-only `constructible()` fast path that ignores the peak. Rate is
low (~2 / 44k lit tight-stacks) but real and in-game-relevant.

FIXED 2026-06-26: reachability is now decided on the construction peak, not the post-refund cost.
`greedyFrom` charges the colors it bootstraps a crossroads for (`greedyCost + lastGreedyBootColors`), the
sampled peak witness proves real orders, and the exact resolver (and its Rust port `web/wasm/src/lib.rs`)
decides at every self-covering node and returns - pruning the post-covering filler search, so witnessing
each covering node is affordable and TS/WASM stay verdict-equivalent. The two confirmed seeds and the
eight tier-1 constellations at budget 3 now dim; `just realmap-hunt` reports 0. See
`docs/reachability-engine.md`.

STILL OPEN - residual synthetic false-reach: `just validate-reach` Part A shows ~450 false-reaches per
12k random small models vs the BFS oracle (down from 705). The real-map hunt finds 0, but only for the
Affliction-stack shape it generates. Open work: characterize the residual as synthetic-only, or broaden
`just realmap-hunt` to other shapes. `reachability-oracle.test.ts` stays `test.failing` on the
small-model mechanism; re-run `just realmap-hunt` + `just validate-reach` + `just validate-wasm` after
any resolver change.

### B. Tight-build and affinity-bootstrap false-dims - FIXED
The resolver once dimmed some constructor-confirmed tight near-55-point builds and filler-extension
builds (the Oklaine and Vulture/Ghoul cases), because it gated covering builds on the seed-only
`constructible()` fixpoint, which cannot model holding refundable scaffolding to bootstrap a build's own
affinity. The sampled peak witness (`minPeakSampled`) and the construction-peak resolver (gap A) close
these; real-model false-dims are now ~2/6,618 (the sampler tail, the safe direction). See
`docs/reachability-engine.md`.

## Guided build order ("pick these in this order")

Tell the user a legal click order that reaches their target build, including the non-obvious
temporary scaffolding (e.g. add the Eldritch Crossroads + Quill to break the Affliction asc4/eld4
lock, then refund them once the build covers its own requirement). These orders are not obvious by
hand.

v1 SHIPPED (branch `guided-build-order`, tiers 1-2): `buildOrderPath`/`buildOrderEscalated` in
`web/src/core/reachability.ts` emit a constellation-level `BuildStep[]` schedule with scaffold
add/refund; `selectionView` computes it live at tries=16 (folded into the perf-guard-timed throat);
`buildOrderView.ts` renders the right-sidebar step list with art and a "Find valid order" escalation
button; `main.ts` wires it with map hover-sync. A replay-legality invariant guarantees any path shown
is a legal construction. The two confirmed false-reaches show the honest "no quick build order" empty
state and escalation also returns null.

Shipped after v1: a validation harness (`just build-order-validate`) measured buildOrderPath against the
exact `minPeakCost` oracle (now shared in `web/test/support/costed-oracle.ts`): 0 false-negatives and 0
false-positives across 12k self-covering builds, all 104 single-constellation partials, and 6k subsets, so
the engine is sound and complete in practice where it applies. Honest empty-state copy was added: a
not-self-covering selection (the Oleron class - 57% of single constellations) now reads "Incomplete build:
needs N more <affinity>. Add supporting constellations." instead of a misleading "no legal path".

Remaining follow-ups:
- Supporting-set suggester (the principled Oleron fix): for a not-self-covering selection, suggest the
  cheapest supporting constellations that complete it and order the whole build, turning "Incomplete build"
  into actionable guidance. A spike proved this viable: an exact min-stars knapsack DP over the affinity
  deficit (the capped affinity space is only ~917k states, so it is tractable, not NP-hard at our scale)
  gives optimal, sensible support sets when correct (Oleron -> +24 support, 31-point total, matching the
  engine `minCost` floor; same for Light of Empyrion, Ultos, Tsunami). TWO real problems to solve first:
  (1) the deficit-DP ignores that a support constellation has its OWN affinity requirement, so it
  undercounts when support needs support (Ulo, Blind Sage, Crab, Hydra came in below the engine floor) -
  make it self-consistent (iterate: add support, fold in its requirement, re-solve) or extract the witness
  from the engine's own `minCost` machinery, which already computes the correct total. (2) reconcile a
  discrepancy the spike surfaced: for Ulo the deficit-DP says 9, `selectionMinCost` says 11, AND
  `buildOrderPath` returned an order for the 9-point set - those three must agree; investigate whether the
  9-point final state is genuinely self-covering (minCost loose) or not (buildOrderPath returning an order
  for a non-self-covering final state would be a real bug). Also decide cheapest-vs-"productive" support
  (a player wants support that grants stats they want, not just minimal stars - a heuristic layer on the
  feasibility DP). This needs its own brainstorm/spec/plan.
- Tier 3 (bounded exact verify): port `minPeakCost` (branch `reachability-costed-scaffolding`, vendored
  in `web/scripts/reachability-realmap-hunt.ts`) into `web/src/core` and run it from the "Find valid
  order" button with a work/time cap, to turn "couldn't find" into a definitive "not buildable at N
  points" and make the false-reaches provably so. Out of v1 by design. NOTE: `minPeakCost` is now shared
  in `web/test/support/costed-oracle.ts`; a core port can build on that.
- Background-worker search (Ted's idea): move the escalation off the main thread into a Web Worker that
  searches continuously, cancelling/restarting on selection change (generation token), bounded so
  unbuildable selections do not spin forever. Would let the order appear/improve without the manual
  button. Not started; the message + `minBuildableCap` logic move into the worker unchanged.
- Escalation-recovery test coverage (flagged in the v1 final review): the `buildOrderEscalated` path is
  tested only for returning null on the genuine false-reach, never for RECOVERING an order that
  tries=16 missed. Add a synthetic fixture where tries=16 returns null and a higher-tries search
  returns a replay-legal order, so the escalation button is proven to do something beneficial. A crude
  4000-seed random scan did not surface a natural cliff-miss; a constructed synthetic model is the
  likely route.
- Minor cleanups carried from v1 task reviews: extract the duplicated `esc` HTML helper into a shared
  `web/src/adapters/html.ts`; tighten the `expect(frView.reach).toBeDefined()` no-op assertion in
  `reachability.test.ts` to assert the engine actually lit the false-reach reachable.

## Performance

### 1. Monotone dim-cache for the reachability sweep
Reachability is monotone under adding stars: if completing/clicking a candidate is
dim at a given selection and budget, it stays dim for every superset selection (more
commitment only makes a build harder). Cache dim verdicts per session and skip
re-proving them, so repeated clicks while finishing a constellation near a
borderline-infeasible capstone become free. Invalidate the cache on any star
removal (deselect) or budget (slider) change, which are the only moves that can turn
a dim candidate reachable again.

Deferred because the WASM resolver already brings per-click latency to a good place
(median ~1.3ms, p95 ~45ms, p99 ~190ms). It would help the late-game dim tail (it cut
p99 ~190ms -> ~137ms in a harness experiment). NOTE: it does NOT fix the rare ~1.1s
worst case, which is an early multi-capstone state dominated by reachable-but-tight
verdicts (those are not monotone, so they cannot be cached); only dim verdicts are
cacheable. See the "Residual" note in `docs/reachability-performance.md`. The sweep
already accepts an optional cache hook shape (a frontier-star-of-completable
shortcut landed; the dim-cache param did not). Pointers:
`classifyForSelection`/`reachabilityForSelection` in `web/src/core/reachability.ts`,
driven from `main.ts`; key the cache by candidate id + a generation counter bumped
on removal/cap change.

## Baseline build comparison: remaining follow-up

The feature shipped (see the intro). One known edge case is still open: setting a baseline
with zero stars selected encodes `cs=`/`cp=` but does not survive a reload, because
`decodeHash` treats an empty `cs=` as "no comparison" (`urlState.ts`, the `baseSel.size
> 0` guard). The diff would be empty anyway, so it is low impact. Cheapest fix: make
`set-baseline`/`cmp-update` a no-op when `state.selected.size === 0` (or disable the
button when nothing is selected) in `web/src/app/main.ts`, with a test.

## Mobile-friendly responsive pass

Make the single planner page usable on phones. The hexagonal split means this is
almost entirely an adapters + CSS effort; `core/` is untouched. Needs a full
brainstorming pass first - the touch interaction model is the crux. Direction settled
on so far:

- Keep desktop exactly as-is: mouse hover = preview tooltip, click = select. Do NOT
  regress this. Branch on the actual input per interaction (`PointerEvent.pointerType`,
  `@media (hover: hover)` / `(pointer: coarse)`), never a global "mobile mode" - a 2-in-1
  must do the right thing per gesture.
- Input foundation: migrate `web/src/adapters/navController.ts` from mouse events to the
  Pointer Events API (`pointerdown/move/up`), add pinch-zoom by tracking two active
  pointers (feed the distance ratio to the existing `zoomViewBox`), and set
  `touch-action: none` on `#map-container`. The pan/zoom math in `core/viewbox.ts` is
  reused unchanged. Without this the large map cannot be navigated on touch (the actual
  blocker today - tap already synthesizes a click, so selection mostly works).
- Touch detail: hover does not exist on touch, so generalize "show info for X" out of
  `tooltipView.ts` (today a cursor-anchored popover) into a detail panel / bottom-sheet a
  tap fills. Desktop keeps the floating tooltip; touch gets the sheet; share the content
  rendering.
- Touch interaction model (DECIDE FIRST): leaning tap = preview (fills the sheet) + a
  "Take" button to commit, mirroring desktop hover->click. The 438-star map is dense, so
  select-immediately-on-tap risks mis-taps. This decision drives the sheet and the
  tap/drag disambiguation in navController.
- Layout: the `main` grid (`280px 1fr 250px` in `styles.css`) collapses below ~768px to a
  full-width map with the two sidebars as a bottom tab bar or swipe-up drawers. The
  `sidebarView` HTML is reusable verbatim inside a drawer.
- Header: reflow the points control + reset buttons for narrow widths; the new points
  control (current work) should be built mobile-aware so it is not redone.

viewport meta is already in `index.html`; URL-state sharing is device-agnostic.

## Known limitations (accepted)

- `racialBonusPercentDamage` aggregation in the sidebar uses the union of all
  selected stars' `racial_target`; if different races are mixed it lumps them
  together. Acceptable given how rare these stars are.

- The faded-constellation tooltip's completion line ("Needs N of your M points")
  searches `completionMinCost` only up to the current cap (`main.ts` `completionInfo`),
  so a constellation whose true completion cost sits between the current cap and the
  55-point game max shows "Cannot be completed within M points" rather than a real
  "Needs N (raise your cap)". Only affects users who lowered the cap below 55; at cap 55
  the message is exact. Fuller fix: search to `BUDGET` (55) in `completionMinCost` and
  render the cap-raise hint when `cap < N <= 55`. The minimal fix already landed (it
  stopped leaking the INF sentinel as "Needs 1000000000").
