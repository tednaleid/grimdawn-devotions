# Partial-constellation reachability (deep-star attainability)

Point-in-time design record. Reaching a celestial power without completing its
constellation is a common Grim Dawn build technique (4 points into Korvaak for
Eye of Korvaak, for example). The planner allows it - a user can hand-click a
path of stars into a dimmed constellation - but nothing shows them it is
possible: only the frontier star lights, deep stars render locked-grey, and the
"Available to get" panel omits powers and bonuses that are genuinely reachable
this way. This design lights the reachable part of every constellation, lists
what it offers, and lets one click claim a whole path.

Reference states (from the motivating report):

- 55/55 with 4 points in Korvaak reaching Eye of Korvaak:
  `#p=55&s=AAAAAAEHAAAAOAAAOAA8PAA8APgHAAB4AHwAAAAAAAAAAAAAAAAAAAB8AAAAAAAAAAAAAAAAAAAAAOACAADAHw`
- The same build with those 4 stars deselected (51/55). Korvaak shows only its
  first star lit; Eye of Korvaak and Turtle Shell (Tortoise) are absent from
  "Available to get" despite both being reachable with the 4 spare points:
  `#p=55&s=AAAAAAEHAAAAOAAAOAA8PAA8APgHAAB4AHwAAAAAAAAAAAAAAAAAAAB8AAAAAAAAAAAAAAAAAAAAAAAAAADAHw`

## Goal

For a constellation that cannot be fully completed within budget but can be
partially entered:

1. Light every star whose path fits the remaining budget, and the edges between
   them, at normal attainable brightness. The constellation art stays dimmed.
2. Count bonuses and celestial powers on those stars as "available to get."
3. Let a click on any reachable star claim it plus its unselected predecessors
   in one action.
4. Represent a deliberate partial constellation honestly in the guided build
   order: as the partial pick it is (with a star-count marker), placed at the
   end of the order, never as the full constellation.
5. Do not meaningfully slow the per-click sweep; extend the perf harness and
   guards to cover the new work.

## Why the engine is already close

Three existing facts make this cheap:

1. **`classifyForSelection` already decides arbitrary partial selections
   exactly.** A partial constellation imposes its requirement, counts its stars
   against budget, and grants nothing until finished (`selectionSummary`,
   `partialFinish`). "Is selection + 4 stars of Korvaak reachable" is a question
   the engine answers correctly today, through the same entry point the WASM
   resolver sits beneath. No Rust changes.
2. **The verdict depends only on the per-constellation star count**, not which
   stars: `selectionSummary` reduces a selection to counts. So "star X is
   attainable" is equivalent to "selection + |closure(X)| stars of its
   constellation is reachable," where closure(X) is X plus its predecessors.
3. **The verdict is monotone in that count** for proper prefixes: a bigger
   prefix costs more and grants nothing until complete, and reachability is
   downward-closed (the property the metamorphic walk tests already rely on).

Together: one number per constellation (`maxK`, the largest star count that
stays reachable) determines every star's attainability, and a binary search
finds it in at most 3 classify calls (constellations have at most 8 stars).

## The new signal: `reachableStars`

`ReachView` gains `reachableStars: Set<StarId>`: every unselected star such
that selecting it plus its unselected predecessors keeps the selection
reachable at the sweep budget. It **replaces** `clickable` - the frontier
signal becomes a strict semantic subset, and every consumer (display, rules,
commit button, renderer styling, aggregation) wants the new meaning, so keeping
both would leave a dead signal. `completable` is unchanged.

Computation, per constellation, in `reachabilityForSelection`:

- **Completable**: all its unselected stars join `reachableStars` (uniform with
  today, where completable lights everything).
- **Not completable**: binary search `maxK` over k in
  [selectedCount+1, size-1]; classify "selection + k stars of this
  constellation" (counts only, so the state is synthesized without picking
  stars). An unselected star X joins `reachableStars` iff
  `selectedCount + |closure(X) \ selected| <= maxK`.
- If k = selectedCount+1 is already dim, `maxK = selectedCount` and the
  constellation contributes nothing - the same proof the sweep pays for today
  via the per-frontier-star classify.

The maxK search **replaces** the per-frontier-star classify for non-completable
constellations (all frontier stars of one constellation share one
count-determined verdict, so today's per-star calls were redundant for
branching constellations). Net extra cost is roughly +2 classify calls per
enterable-but-not-completable constellation, and only those.

Fallback, documented but not built: for a non-completable constellation,
"selection + k stars at budget B" decides like "selection + 1 star at budget
B-(k-1)" (a witness that finishes the constellation would make it completable,
a contradiction). This budget-shift can cut the search to about one call if
`just perf` demands it.

## Interaction rules

Star click (`toggleStar` in `rules.ts`):

- Unselected star, in `reachableStars`: add it plus its unselected
  predecessors (predecessors never cross constellations). For a frontier star
  the closure is itself, so today's behavior is preserved exactly.
- Unselected star, not in `reachableStars`: no-op.
- Selected star: `removeWithDependents`, unchanged.

Constellation background click (`toggleConstellation`), all-in or all-out:

- Any of its stars selected (partial or full): remove all of them.
- None selected and completable: add all.
- None selected and not completable: **no-op**, even when some stars are
  individually reachable - there is no deterministic path to pick (Korvaak has
  3 possible ways to spend 4 points). Partial entry always goes through a star
  click.

This drops today's "background click completes a started constellation"; deep
star click replaces it (click the remaining star instead of the background).

`commitButton` (`commitAction.ts`, touch popover) mirrors both: star Add
enabled iff in `reachableStars`; constellation shows Remove (enabled) when any
star is selected, else Add gated on completable.

`permissiveReach` (uncapped / no-cover-table path in `main.ts`):
`reachableStars` = every unselected star, matching its current permissive
spirit; deep click-to-path works uncapped.

`repairSelection` and the URL hash format are untouched: arbitrary partial
selections already round-trip (the reference links above are the proof).

## Display (within the existing three-channel model)

Only the **source** of the brightness channel changes; the channel structure
(brightness <- attainability, color <- affinity filter, emphasis union) and the
pure-core/adapter split are preserved. `display-model.md` currently calls star
brightness "a practical approximation" that avoids deep-star attainability;
this replaces the approximation with the true signal it approximated.

- **Stars** (`starDisplay`): active when selected; attainable iff in
  `reachableStars`; else unattainable. The "or constellation completable"
  clause disappears (subsumed). The clickable styling flag (colored vs
  locked-grey) also reads `reachableStars`, so a deep reachable star renders
  colored and clickable.
- **Edges** (`edgeDisplay`): active when taken (both endpoints selected);
  attainable iff the deeper endpoint is in `reachableStars` (its path includes
  the shallower endpoint); else unattainable. Brightness moves from
  constellation-level to endpoint-level; this lights the path through a dimmed
  constellation.
- **Constellations**: brightness logic unchanged (active when complete,
  attainable when started or completable, else unattainable). A dimmed
  enterable constellation stays dimmed while its reachable stars and edges
  light; it brightens once started, as today.
- **Tooltip**: an unselected reachable star whose path cost is 2 or more gets a
  cost line ("4 points to reach"; the count includes the star and its
  unselected predecessors). Frontier stars show no line, matching today. New
  i18n catalog key added to the `appCatalog` guard; the core returns a `Text`
  descriptor and the adapter resolves it through the `Localization` port.
- **Color and emphasis channels**: untouched.

## "Available to get" panel

`availableBonusIds`, `availablePetKeys`, and `availablePowers`
(`aggregate.ts`) switch their parameter from `completable: Set<string>` to
`reachableStars: Set<StarId>` and iterate it directly (simpler, no
constellation loop). Results are a strict superset of today's: everything from
completable constellations remains, plus bonuses and powers on deep reachable
stars. At the 51-point reference state, Eye of Korvaak and Turtle Shell appear
under Celestial Powers.

## Build order

The build-order engine needs no change: `selectionSummary` commits a partial
constellation as a zero-grant member sized at its selected star count, so
`buildOrderPath` already places it in the schedule's tail (zero-grant members go
last, after every granting member and scaffold refund) with the partial point
count on its step. The panel shows an order whenever the selection is
self-covering (have at least need), which is exactly when a deliberate partial
is a valid final state.

The display must represent that step as the partial pick it is, not as the full
constellation: a "complete" step whose points are less than its constellation's
star count renders a partial-count marker, "(4/6)", from a new catalog key
(`web/src/adapters/buildOrderView.ts` compares step points to the model's star
count; the `BuildStep` type is untouched).

## What does not change

- `classifyForSelection` and everything beneath it: the cover-table lower
  bound, greedy gate, peak witness, exact resolver, and the Rust/WASM port.
- `selectionMinCost`, `buildOrderPath`, the cover table and its builder.
- The URL hash format and `urlState.ts`.
- The color and emphasis display channels, tooltips beyond the one new line,
  and the sidebar layout.

## Performance

The extra classify calls target the near-budget regime where dim proofs are
expensive, but the sweep already pays a full-constellation dim proof for each
of these constellations, so this is a bounded multiplier on a small slice (the
enterable-but-not-completable constellations, typically a handful), not a new
cost class.

The bar, as agreed:

- Extend `web/test/reachability-perf-guard.test.ts` with near-budget states
  containing several enterable-but-not-completable constellations (the
  51-point reference state is the archetype), under the same coarse 1500ms
  bound (deliberately coarse; tight wall-clock CI tests flake).
- Manual gate before merge: `just perf` before/after on the same seeds; the
  distribution must stay the same order of magnitude (p95 ~19ms today, no
  click over 400ms). The budget-shift fallback above is the lever if it
  regresses.

## Architecture (hexagonal)

All new behavior is pure `core` logic: `reachableStars` in `reachability.ts`,
brightness resolution in `displayState.ts`, path-add and background-click in
`rules.ts`, projections in `aggregate.ts`, popover mapping in
`commitAction.ts`. Adapters only re-map what they already map: `svgRenderer`
reads the same semantic records, `tooltipView` resolves a new `Text`
descriptor, `main.ts` remains a thin caller of `selectionView` (whose cost is
still "the per-click cost," so the perf harness measures the new work
automatically).

## Testing

- **Real-map fixtures** from the reference links: decode the 51-point hash;
  assert Eye of Korvaak's star and Turtle Shell's star are in `reachableStars`
  and both powers are listed by `availablePowers`; after path-adding Eye of
  Korvaak (55/55), assert the Korvaak siblings leave `reachableStars`.
- **Property tests** beside the existing metamorphic suite: `reachableStars`
  is downward-closed along the predecessor DAG; every unselected star of a
  completable constellation is present; membership agrees with a direct
  `classifyForSelection` of selection + closure (checks the count-monotonicity
  claim the binary search rests on, against the engine itself, on the real map
  and the small random models).
- **Rules**: path-add closure, the background-click truth table including the
  no-op case. **Display**: star and edge brightness from `reachableStars`.
  **Commit button**: the new Remove-when-partial mapping. **Build order**: a
  complete step smaller than its constellation renders the partial marker; a
  partial member's step lands in the order's tail with its partial point count.
- **i18n**: the new tooltip key in the `appCatalog` guard.
- **Regression gates**: `just test`, `just test-slow`, `just fuzz`,
  `just validate-wasm` (no WASM change, but the sweep's callers changed),
  `just perf`.

## Docs to update

- `docs/display-model.md`: the deep-star-attainability approximation paragraph
  and the "What Did Not Change" list are superseded; rewrite in place.
- `docs/reachability-engine.md`: the sweep now emits `reachableStars` via the
  per-constellation maxK search.

## Non-goals

- No new reachability algorithm and no WASM/Rust changes.
- No path preview highlight on hover (tooltip cost line only; the emphasis
  channel is untouched).
- No URL format changes.
- No change to how completable constellations are decided or displayed.
