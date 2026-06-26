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

### A. Soundness gap (false-reach on the resolver) - real-map status NOT established as zero (revised)
Against the independent BFS oracle on random small models, the resolver false-reaches on some sampled
models - it calls some unreachable selections reachable. The audit (`just audit-false-reach`) localized
it: `greedyFrom` (~79%) and the exact resolver (~21%) both treat the crossroads seed as free and
always-held, so they ignore that scaffolding costs budget at the construction PEAK; the peak witness
emits zero false-reaches. On random models the rate is budget-independent (~5-6%), so the oracle test
stays `test.failing` as a guard on the mechanism. A first real-model upper bound (4000 self-covering
COMPLETE builds, 0 suspects) suggested the rate was ~0% on the real model.

REVISED 2026-06-25 (`just shape-fuzz`): that "synthetic-only" conclusion is too strong. The shape-biased
fuzzer shows the SAME free-seed mechanism fires in the ABUNDANCE regime (every requirement achievable,
not scarce) whenever two multi-color partial-self-payback constellations - the Affliction/Vulture shape -
are stacked in a tight budget: their combined permanent + bootstrap scaffold overflows the construction
peak, but the engine (final-totals reasoning) lights the build. The earlier audit missed this because it
checked complete self-covering builds, not partial-selection stackings, and did not compute an exact
min-peak. So the real-map false-reach rate is "none found yet, NOT established as zero for this pattern".
The decisive next step is a targeted real-map hunt over tight builds that stack Affliction-like
constellations, using the costed engine's exact `exactMinPeak` as the oracle (the BFS oracle does not
scale to the real model). If it manifests, the fix is the expensive sound dim-proving (exact min-peak in
the resolver) we previously deferred. See `docs/reachability-engine.md` "Update 2026-06-25: shape-biased
fuzz". Re-run the audit + shape-fuzz after any resolver change.

### B. Tight-build false-dims (FIXED 2026-06-25)
The resolver wrongly dimmed some constructor-confirmed-reachable TIGHT near-55-point builds. A sound
peak witness (`minPeakSampled` in `web/src/core/reachability.ts`, wired into `classifyForSelection`)
closes this: it samples real construction orders for a near-budget self-covering build and flips it
reachable on the first order whose peak fits the budget. Real-model false-dims dropped 119 -> 1
(`just validate-reach` Part B), all 42 tight walk fixtures classify reachable
(`web/test/reachability-walk.test.ts` is no longer `test.failing`), soundness is unchanged
(false-reach 705), and per-click p99 is unchanged from baseline (the hang state went 4.5s -> 85ms).
See `docs/reachability-engine.md` "Update 2026-06-25" and the perf guard
`web/test/reachability-perf-guard.test.ts`.

### C. Affinity-bootstrap / filler-extension false-dims (FIXED 2026-06-25)
The deeper gap behind B, Oklaine, and the 1/6618 residual: the exact resolver gated every covering
build on `constructible()` - the seed-only fixpoint that cannot model holding transient refundable
scaffolding (scaffold-then-refund) to bootstrap a build's own affinity. So builds reachable only via
that move were dimmed even after filler was added (the Jackal/Vulture case: a self-covering build whose
capstone needs chaos the build only supplies after a refundable crossroads bootstraps it; and Oklaine's
filler-extension case). Fixed by gating the covering build on the peak witness instead
(`reachableExactFrom` in `web/src/core/reachability.ts` and its Rust port `web/wasm/src/lib.rs`):
`constructible()` stays the cheap fast path, falling back to `minPeakSampled() <= budget`, which models
scaffold-then-refund. The gate uses the deterministic heuristic order (`GATE_WITNESS_TRIES=0`) so the
Rust port is RNG-free and bit-for-bit verdict-equivalent (`just validate-wasm`: 0 mismatches). Two
supporting fixes: finished partials count at full size in the witness members (a latent inconsistency
that would otherwise undercount the peak and false-reach), and witness calls are capped per resolver
invocation. Results: real-model false-dims 0 (`just validate-reach` Part B), the bootstrap-bug adds zero
false-reaches (synthetic false-reach unchanged at 414 baseline), Vulture/Ghoul + Oklaine
`test.failing` flipped to passing, and per-click p99 IMPROVED 199ms -> 35ms (the witness short-circuits
the previously-exhaustive dim searches). The remaining synthetic-model false-reach is gap A, untouched.

## Guided build order ("pick these in this order")

Tell the user a legal click order that reaches their target build, including the non-obvious
temporary scaffolding (e.g. add the Eldritch Crossroads + Quill to break the Affliction asc4/eld4
lock, then refund them once the build covers its own requirement). These orders are not obvious by
hand. This needs a resolver that finds a real CONSTRUCTION ORDER (a witness), not just a boolean - the
shipped engine returns only reachable/dim. The costed-scaffolding resolver on branch
`reachability-costed-scaffolding` produces witnesses (`minPeakSampled`/`orderPeak`/`peakToReach`); the
work is to wire that resolver in for this feature (on demand, not per click) and capture+return the
witness it already finds. Build on top of the costed engine when this is picked up.

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
