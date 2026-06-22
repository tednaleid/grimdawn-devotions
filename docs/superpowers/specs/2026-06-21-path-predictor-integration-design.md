# Path Predictor Integration - Design

Date: 2026-06-21
Status: Draft for review
Builds on: [the reachability engine spec](2026-06-21-path-predictor-reachability-design.md)
and the engine in `web/src/core/reachability.ts` (the prototype is proven; this
wires it into the running app).

## Summary

This spec takes the proven reachability engine and makes it the planner's
selection model. The user claims constellations in any order, including distant
capstones first. The map continuously shows what is still achievable within the
point budget and dims the rest. The strict bottom-up gating (claim only what your
current affinity already allows, with blocked-removal flashing) is removed.

The validity question for every action is a single function:
`reachable(selection) iff minCost(selection) <= budget`, bracketed by the cover
lower bound (proves dim), the refund-aware greedy (proves reachable), and the
exact resolver (settles the rest). The engine already computes this and is
validated against a brute oracle.

## Decisions taken during design

These were settled with Ted during brainstorming and are not open:

1. **Replace, do not add a mode.** Reachability becomes the only selection model.
   No capability is lost: bottom-up building is just claiming low constellations
   first. The strict gating in `rules.ts` is replaced.
2. **Preserve partial picks.** Individual stars remain clickable, including
   partial constellations (the leftover-points case), not only whole-constellation
   claims.
3. **Partials are honest immediately.** Starting a constellation (even one star)
   imposes its affinity requirement at once; only a fully completed constellation
   grants affinity. A partial pick can therefore make other things unreachable, as
   it would in game.
4. **Precompute the cover-table blob as a build artifact, not a committed file.**
   The 4.6 s build runs from `data/devotions.json` via a justfile recipe locally
   and in the Pages CI, exactly as `web/dist` is built from source. The blob is
   gitignored. Because CI regenerates it from the committed data on every deploy,
   production cannot ship a stale blob, so no committed-artifact fingerprint guard
   is needed.

## Measured facts (real data, this machine)

- Cover-table build: 4.6 s for the full 916,839-cell grid. Too slow for the main
  thread, hence the shipped blob.
- minCost: Leviathan completes in a minimum of 26 stars, Tree of Life in 27.
- A full 109-candidate classify sweep (the cheap bracket) is 5 to 9 ms. Running
  the exact resolver on the leftover unknowns pushes the worst observed state
  (Leviathan and Tree of Life both claimed, 13 unknowns) to about 46 ms. This is
  per click, not per frame.
- From an empty map: at budget 26 Leviathan is exactly reachable; at 20 the map
  dims 21 constellations; at 15 it dims 27. Lowering the slider reveals the floor.

## The model

### State

State stays exactly `SelectionState { selected: Set<StarId>; pointCap: number }`.
No new persisted shape. Everything below is derived from `selected` on each change:

- **started** = constellations with at least one selected star.
- **completed** = constellations with all stars selected.
- **supply** = elementwise sum of `affinityBonus` over completed. This is the
  current affinity total the app already shows.
- **target** = elementwise max of `affinityRequired` over started. Partial and
  complete both contribute (decision 3).

### minCost and reachable

`minCost(selection) = |selected| + (cheapest scaffolding that lifts supply to
target)`. Scaffolding means completing further constellations not yet started, or
finishing a started-but-incomplete one. `reachable(selection) iff minCost <=
budget`, where `budget = pointCap` (Infinity when uncapped, in which case nothing
dims and the sweep is skipped).

The engine brackets minCost: cover lower bound (sound for dim), greedy upper bound
(sound for reachable), exact resolver (settles unknowns). All three already exist.

### Two gates, judged per star

Selectability is judged per star by the resulting selection, not per whole
constellation. The two gates can and do disagree:

- **Star clickable** iff placing it (its predecessors must already be selected)
  yields a reachable selection.
- **Constellation completable** iff `minCost(selected union all-stars-of-X) <=
  budget`.

Worked example (Ted's): budget 6, Crook claimed (5 stars, grants ascendant 5),
one point left. Anvil requires ascendant 1.

- Anvil first star: supply ascendant 5 already covers target ascendant 1, deficit
  0, minCost = 6 <= 6, so the star is clickable.
- Anvil whole (4 stars): minCost = 5 + 4 = 9 > 6, so the constellation is not
  completable.

The first star is a valid target even though the whole constellation cannot be
finished. This is correct and matches the current model's feel.

### The partial-start nuance

Because a partial pick owes its requirement but a constellation only grants
affinity once completed, starting a self-satisfying constellation one star at a
time can be momentarily unreachable (you owe the requirement without yet holding
the grant). This is honest, not a bug. Clicking the constellation region to claim
it whole is always the escape hatch, and is exactly the headline "click Leviathan
to activate it" interaction.

### Free deselection

Removing any selected star or constellation is always allowed. minCost is
monotone under removal, so nothing is ever stranded. `canRemove`,
`removalBlockers`, and the blocked-removal flash are deleted. This supersedes
backlog item 1 (the forward-flash), which is no longer needed.

## Interaction

- **Click an unstarted constellation region** completes it (claims all stars) iff
  it is completable. Otherwise it is a no-op; the user can still click an
  individual reachable star.
- **Click an individual star** places it (bottom-up: predecessors must be in) iff
  the result is reachable. Clicking an interior star fills bottom-up to it.
- **Click any selected star or constellation** removes it (and its dependents)
  freely.

## Map dimming

Two layers replace the current single "requirement unmet now" fade
(`svgRenderer.ts:119`):

- **Un-completable**: `minCost(selected union complete-X) > budget`. Faded art.
  This is the "watch it narrow" and "Anvil cannot be fully activated" signal.
- **Un-startable**: even the next reachable star cannot be placed. Fully dark,
  nothing clickable here.

A constellation can be un-completable yet startable (faded art, a live first
star). Star visual states become: selected, clickable (the per-star gate),
locked. The benefit-filter highlight (`.star.match` / `.star.dim`) is orthogonal
and unchanged.

## Affinity panel

The right panel grows from one number per color to two (`sidebarView.ts`
`renderAffinities`):

| color | have | need |
|-------|------|------|
| ascendant | 5 | 13 (red) |
| eldritch | 0 | 13 (red) |
| order | 7 | 7 (green) |

- **have** = supply (completed grants). Unchanged from today.
- **need** = target (max requirement over started). Red when have < need, green
  when met, blank when nothing started needs that color.
- Hovering **need** names the started constellation(s) defining that maximum
  (ties list all), for example "Leviathan needs 13".

Ted's walkthrough falls out directly: claim Leviathan, ascendant and eldritch read
have 0 / need 13 red; add Owl (grants ascendant 5), ascendant reads 5 / 13 still
red; add Crab instead (grants ascendant 3, needs ascendant 6 and order 4),
ascendant reads 3 / 13 red and an order row appears at need 4, red until supplied.

## Tooltip

The required-affinity red/green already exists (`tooltipView.ts:17`) and stays.
For a faded (un-completable) constellation, add one line with the completion
minimum, for example "needs 26 of your 55". This answers "how many stars to pick
Leviathan" directly instead of by slider hunting. The number is the exact minCost
to complete X from the current selection, computed by the engine.

## Slider and budget

Reachability uses `budget = pointCap`. Lowering the slider re-runs the sweep and
dims more; the empty-map case reveals the minimum cost of each capstone as the
floor where it goes dark. Uncapped (Infinity) skips the sweep and dims nothing.
The existing floor (the cap cannot drop below points already spent) is unchanged.

## Engine extension (core/reachability.ts)

The existing functions take a list of completed constellations. Add a
selection-aware layer alongside them (do not remove the proven whole-constellation
functions; they stay covered by tests):

- `selectionSummary(model, selected) -> { own, supply, target, startedIds,
  partialFinish }` where `partialFinish` lists each started-but-incomplete
  granting constellation as `{ remaining, grant, req }`.
- `classifyForSelection(model, table, selected, budget)` and a sweep variant that
  returns, per constellation, `completable` and the clickable frontier stars, plus
  the have/need vectors for the panel. It brackets minCost from the summary using
  the existing cover lower bound, greedy, and resolver.
- `completionMinCost(model, table, selected, X, budget)` for the tooltip number
  (exact minCost to complete X, via the resolver or a budget search).

### Soundness with partials

A started granting constellation can be finished as cheap scaffolding (its sunk
stars are already paid). The cover lower bound must credit this or it can falsely
dim. The correction is a minimum over the small set of started granting partials
of `own + sum(remaining) + cover[deficit after their grants]`. It is bounded
(usually zero to two partials) and preserves the "never falsely dim" guarantee.
The brute oracle, extended to understand partial selections, validates it.

## Cover-table blob

The blob is a build artifact derived from `data/devotions.json`, treated exactly
like `web/dist`: regenerated from committed source, never committed itself.

### Not committed

`data/cover-table.bin` is gitignored. The deploy already rebuilds the whole site
from source on every push (`.github/workflows/deploy.yml` runs the bun build and
copies `data/` into `dist/`; `web/dist` itself is gitignored), so the blob joins
that flow. Committing it would add a churning 1.8 MB binary to history
(devotions.json is actively changing) and reintroduce the staleness problem a
guard would then have to police. Building it in CI sidesteps both: production is
fresh by construction.

### Generator

A justfile recipe (for example `cover-table`) imports `buildReachCons` and
`buildCoverTable`, builds the table from `data/devotions.json`, and writes
`data/cover-table.bin`: a small header (a magic byte and the `buildId` below)
followed by the raw `Uint16Array` cost grid (916,839 cells, about 1.8 MB; gzip and
brotli at serve time bring it well down). The recipe rebuilds only when the blob is
missing or older than `data/devotions.json`, so a normal build does not pay the
4.6 s unless the data changed. `just build` and `just serve` depend on it; the CI
workflow gains the same generate-then-copy step.

### Loader

The data adapter fetches both `./data/devotions.json` and `./data/cover-table.bin`
with a shared `?v=<buildId>` query (see Cache coherence). The grid dimensions
(`caps`, `strides`) are a deterministic function of the model, so the loader
derives them the way `buildCoverTable` does and wraps the body as
`{ cost, caps, strides }` (the existing `CoverTable`). It checks the body length
against the expected cell count and the header `buildId` against the bundle's; on a
mismatch or a missing file it logs and degrades to dimming-disabled, since a wrong
blob in production is a deploy bug to fix, not to mask with a 4.6 s in-browser
build.

### Cache coherence across versions

`devotions.json` and `cover-table.bin` are independent requests, so without care a
returning visitor could get an incoherent pair (old data, new blob) after a data
update and see a wrong map, not merely an old one. GitHub Pages caches assets for
about ten minutes, which is the window. To close it:

- The build computes a `buildId`: a short content hash of `data/devotions.json`. A
  content hash is used rather than `meta.game_version` or `meta.steam_buildid`
  because parser changes alter the data without a game patch. The `buildId` is
  baked into the JS bundle (a generated `version.ts` or a bun `--define`).
- The loader fetches both files with the same `?v=<buildId>`. They always carry the
  same id from the same bundle, so they are a matched pair by construction, and any
  data update produces new URLs that bypass a stale cache. This also fixes the
  pre-existing staleness on `devotions.json` itself.
- The generator embeds the same `buildId` in the blob header, and the loader checks
  it, as defense in depth against a proxy that strips query strings.

## URL state

State stays star-level encoded (`urlState.ts`, `canonicalStarIds`); the format
does not change, so old links still parse. On restore, replace the strict
`validClosure` repair with a reachability check: if `minCost(selected) > cap`
(only possible for a stale or hand-edited link), raise the cap toward 55 if that
resolves it, otherwise drop the most expensive started constellations until
reachable. Every state the app itself produces is reachable by construction, so
this only guards malformed links. The CLAUDE.md shareable-URL invariant is
preserved, and more states are now shareable (mid-construction builds with
unsatisfied capstones).

## Hexagonal placement and files touched

Core (pure):

- `core/reachability.ts`: add the selection-aware layer and partial soundness
  correction (above).
- `core/rules.ts`: replace strict gating with reachability-driven toggles. Remove
  `selectableStars` as a gate, `canRemove`, `removalBlockers`. `toggleStar` and
  `toggleConstellation` consult the reach map.
- `core/urlState.ts`: reachability-based restore repair.

Adapters and app:

- `adapters/svgRenderer.ts`: consume the reach map (completable, clickable) for
  two-layer dimming instead of `selectableStars` plus the unmet fade.
- `adapters/sidebarView.ts`: two-column have/need affinity panel with hover
  sourcing.
- `adapters/tooltipView.ts`: completion-minimum line for faded constellations.
- `adapters/httpDataSource.ts` (or a sibling loader): fetch and parse the blob,
  and append the shared `?v=<buildId>` to the data fetches.
- `app/main.ts`: load the blob, run the sweep in `refresh()`, gate clicks on the
  reach map, drop the flash paths.
- New: the generator script and a justfile recipe; `.gitignore` gains the blob;
  `.github/workflows/deploy.yml` gains the generate-and-copy step; the build bakes
  the `buildId` into the bundle.

Coordination note: `styles.css` needs rules for the two-column panel and the
two-layer dimming, and another instance is currently editing `styles.css`,
`data/devotions.json`, the parser, and `statFormat`. Implementation must sequence
around that (land after their changes, or coordinate the CSS additions) and must
not modify those files out from under them.

## Testing

- Extend the brute oracle to understand partial selections (started, completed,
  supply, target) and validate `classifyForSelection` against it on random models
  that include partial picks: no false dim, no false reachable.
- Scenario tests on real data: Crook then Anvil first star is clickable while
  whole Anvil is not completable at budget 6; Leviathan is un-startable below
  budget 20 and reports a completion minimum of 26; empty map at 55 dims nothing;
  Leviathan and Tree of Life together dim about 48; deselection is monotone.
- Property tests: monotonicity (deselect never lowers reachability), determinism,
  have/need vectors match a direct recomputation.
- A generator round-trip test: the blob the recipe writes, reloaded, reconstructs
  the same `CoverTable` an in-process `buildCoverTable` produces.

## Performance

- Blob load is a fetch plus a typed-array wrap, effectively instant, replacing the
  4.6 s build at runtime.
- Per-refresh sweep is 5 to 9 ms for the cheap bracket, up to about 46 ms when the
  resolver fires on a multi-capstone state. Per click, not per frame. Acceptable
  for v1 on the main thread. If a hitch shows in practice, moving the sweep into a
  worker is a localized follow-up that does not change the core.

## Out of scope

- A worker for the sweep (only if main-thread hitches prove noticeable).
- An IndexedDB cache (the shipped blob makes it unnecessary).
- Any change to the benefit-tagging or pet-bonus features.

## Risks and open questions

- Blob staleness: production is rebuilt from committed data by CI on every deploy,
  so it cannot go stale; locally the recipe rebuilds when `devotions.json` is
  newer. No committed artifact to police.
- Runtime cache coherence between `devotions.json` and the blob across a data
  update. Closed by the shared `?v=<buildId>` fetch and the blob's embedded id.
- CSS coordination with the other instance editing `styles.css`.
- The 46 ms resolver spike on the heaviest states. Tolerable per click; worker is
  the escape hatch if needed.
- Exact visual treatment of the two dimming layers (faded vs dark) is a UI detail
  to settle during implementation against the real map.
