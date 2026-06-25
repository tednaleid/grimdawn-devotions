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
`docs/superpowers/specs/2026-06-24-conditional-bonus-qualifiers-design.md`.)

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

### A. Soundness gap (false-reach on the resolver)
Against the independent BFS oracle on random small models, the resolver false-reaches on a few dozen
of the sampled models - it calls some unreachable selections reachable. A false-reach is the worse
error class for a planner (it claims an unbuildable build is buildable). Whether this manifests on
the real 109-constellation model is UNVERIFIED (no BFS oracle scales to it); the costed alternate,
being sound by construction, is the tool to audit it. Guard: `web/test/reachability-oracle.test.ts`
(`test.failing`). FIX: make the resolver sound, or adopt the costed resolver for the cases that need
it. First do the audit (run the sound constructor over the shipped engine's "reachable" verdicts).

### B. Tight-build false-dims
The resolver wrongly dims some constructor-confirmed-reachable TIGHT near-55-point builds (e.g.
`thunder-warder-real-forum-build`, a real forum build, and Oklaine's Lantern). These are rare in
normal additive play (0% on the harvest) but readily found among random self-covering 55-point
builds (`just gen-reach-fixtures` finds 40+). Guards: `web/test/reachability-walk.test.ts`
(`test.failing` half) and the Oklaine case in `web/test/reachability.test.ts`. FIX: a surgical
witness-finder / dim-bound improvement for the tight self-covering region.

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

## Baseline build comparison (delta from a remembered build)

Bigger, and needs a mockup/brainstorm pass before building. Let the user snapshot the
current build as a "baseline", then see a live delta as they change the selection, so
swapping one constellation for another shows at a glance what improved or regressed.

Sketch from Ted (to be mocked up and experimented with, not final):
- A "Baseline" button on the benefits bar remembers the current points, selected
  stars/constellations, and the resulting benefits.
- Pressing it slides out a second column to the right of the benefits, with room for a
  second set of numbers.
- The user then changes the selection; the existing column keeps showing the baseline,
  the new column shows the modified build, with per-stat red/green deltas (better/worse)
  in a table view.
- The new column has an "Update" button (promote the current selection to the new
  baseline, dropping the old one) and a "Cancel" (discard the comparison, keep the
  baseline as-is).
- A visual indication on the map of which stars/constellations were added vs removed
  relative to the baseline.
- Deep-linkable: the whole thing must round-trip through the URL hash like every other
  state-bearing feature.

Implementation pointers:
- Aggregation already takes a selection and returns the totals: `sumBonuses(model,
  selected)` in `web/src/core/aggregate.ts:5-15` (and `sumPetBonuses`). Compute it twice
  (baseline set vs current set) and diff the two `Record<string, number>` maps; render
  the delta column in `renderBenefits()` (`web/src/adapters/sidebarView.ts:30-148`),
  reusing the existing up/down flash classes (`changeClass`, `sidebarView.ts:10-15`).
- State + deep-linking: a baseline is just another star selection (a `Set<StarId>` plus
  its own cap). Encode it as a new field alongside `s=`/`p=`/`b=` in
  `web/src/core/urlState.ts` (`encodeHash`/`decodeHash`, lines 78-118), e.g. a
  `bl=<bitset>` baseline-selection bitset (reuse `encodeBitset`); tolerate its absence
  (no baseline = no comparison panel). Store the SELECTION, not the computed numbers, so
  the link stays small and the numbers recompute - this also keeps it inside the
  URL-state invariant in CLAUDE.md.
- Wiring: hold an optional `baseline: SelectionState | null` next to `state` in
  `web/src/app/main.ts:57`; the Baseline/Update/Cancel buttons mutate it and call
  `refresh()` (the existing render loop at `main.ts:350-383`). The added-vs-removed map
  indication can ride the existing reach/tag plumbing into the renderer
  (`handle.update(...)`, `main.ts:365`) as an extra per-star class keyed by membership in
  baseline vs current.
- Mock up the layout/interaction first (the slide-out column, the table, the
  promote/cancel affordances); treat the above as the data path, not the final UI.

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
