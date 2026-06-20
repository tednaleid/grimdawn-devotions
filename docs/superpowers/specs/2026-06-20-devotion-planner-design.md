# Devotion Planner: static HTML constellation map (v1)

> Design spec, approved 2026-06-20. Source of truth for the v1 implementation plan.

## Context

`grimdawn-devotions` produces `data/devotions.json` (86 constellations, 438 stars,
with per-star `position`, `predecessors`, `bonuses`, `celestial_power`,
`weapon_requirement`, and per-constellation `affinity_required` / `affinity_bonus`
/ `background`). The next milestone is a **static, single-page web app**,
deployable to GitHub Pages with no server, that lets a player plan a devotion
build on an interactive constellation map: pick valid stars, see what's
selectable, and read cumulative benefits + affinity totals on the side.

This is the foundation for a later **optimizer** (given N points and weighted
target stats, find the best star paths). v1 deliberately does NOT build the
optimizer. It builds the interactive planner plus a clean, testable rules core the
optimizer will reuse.

## Decisions locked (from brainstorming)

1. **Validity = full Grim Dawn rules.** A star is selectable iff (a) its
   in-constellation `predecessors` are selected AND (b) the player's accumulated
   affinity meets the constellation's `affinity_required` to enter it. Affinity is
   earned only by **completing** a whole constellation (`affinity_bonus`).
   Crossroads (no requirement) bootstraps.
2. **Data layer = in-memory typed JSON graph** loaded from `devotions.json`. No
   DuckDB. (Optimizer phase may revisit its own data structures later.)
3. **Rendering = SVG + CSS.** Stars/links/art as SVG nodes; states via CSS
   classes; pan/zoom via `viewBox`. Renderer is a thin adapter over the pure core.
4. **Removal = guarded (leaf-valid), not cascade.** A deselection is allowed only
   if it leaves every remaining star valid (no selected dependents, and no other
   constellation's affinity requirement broken); otherwise the click is **rejected**
   (matches grimtools). Implemented by reusing the valid-closure recompute as the
   guard: removable iff `validClosure(selected − star)` does not shrink.
5. **Artwork = real but optimized + git-ignored.** `just assets` extracts +
   converts + optimizes to WebP targeting ~15 MB (incl. downscaled nebulas) or
   ~5-8 MB without. App loads art via a manifest and **falls back to SVG dots** if
   absent. No images committed in v1.
6. **Toolchain = bun** (dependencies, bundling, `bun test`, local serve), added to
   the justfile and `just doctor`.

## Architecture (hexagonal)

Pure domain core with zero DOM/IO, surrounded by thin adapters. Tests target the
core almost exclusively.

```
web/
  index.html              # app shell (slider, map container, two sidebars, tooltip)
  src/
    core/                 # PURE domain — no DOM, no fetch, fully unit-tested
      types.ts            # Affinity, Star, Constellation, DevotionModel, SelectionState
      model.ts            # buildModel(json): index stars by global id, links, membership
      rules.ts            # validClosure, selectableStars, toggleStar, affinityTotals
      aggregate.ts        # sumBonuses (per stat id), powersGained, weaponReqs
      labels.ts           # stat id -> human label (from stat_labels.json)
    ports/
      DataSource.ts       # interface: load model + labels + asset manifest
      AssetResolver.ts    # interface: background.image -> resolved asset URL | null
    adapters/
      httpDataSource.ts   # fetch devotions.json / stat_labels.json / manifest.json
      svgRenderer.ts      # render(model, state) -> SVG; emits star click/hover events
      navController.ts    # pan/zoom (grimtools-style); view-only state
      sidebarView.ts      # render affinity totals + cumulative benefits
      tooltipView.ts      # hover tooltip: star bonuses + constellation affinity req
    app/
      main.ts             # wire adapters to core; hold SelectionState; re-render on change
    styles.css
  test/
    rules.test.ts         # validity, gating, guarded removal, crossroads, point cap
    aggregate.test.ts     # additive summation, powers, edge cases
    model.test.ts         # graph build / indexing integrity vs real devotions.json
  dist/                   # bun build output (git-ignored)
assets/devotions/         # git-ignored optimized art + manifest.json (just assets)
```

### Core data model (`core/`)

- `buildModel(json)` produces: a flat map `starId -> Star` (global id =
  `constellationId + ":" + index`), each star carrying its constellation id,
  `predecessors` (as global ids), `position`, `bonuses`, `celestial_power`,
  `weapon_requirement`; and a map `constellationId -> Constellation` with
  `affinity_required`, `affinity_bonus`, member star ids, `background`.
- `SelectionState = { selected: Set<starId>, pointCap: number }`.

### Core algorithms (`rules.ts`, `aggregate.ts`): all pure

- `completedConstellations(model, selected)` → set of constellations whose every
  member star is selected.
- `affinityTotals(model, selected)` → `{ascendant,chaos,eldritch,order,primordial}`
  summed from completed constellations' `affinity_bonus`.
- `validClosure(model, selected)` → largest subset of `selected` that is
  self-consistent: iterate to fixpoint dropping any star whose predecessors aren't
  all present, or (for an entry star) whose constellation's `affinity_required`
  isn't met by the pool from **all completed constellations, including its own
  once complete**. An incomplete constellation contributes 0, so a partial
  constellation still needs external affinity; a completed one can satisfy its own
  requirement, which is why **Crossroads bootstrap stars can be refunded** once a
  constellation is self-sustaining (e.g. Crossroads `primordial:1` opens Eel;
  completing Eel grants `primordial:5`; remove the Crossroads and Eel stays valid).
  Used as the **removal guard**, not an auto-applier.
- `canRemove(model, state, starId)` → true iff the star is selected and
  `validClosure(selected − star)` doesn't shrink (no selected dependents, no
  affinity another constellation requires is broken).
- `selectableStars(model, state)` → set of currently-unselected star ids that
  could be added next: predecessors satisfied, constellation affinity requirement
  met, and `selected.size < pointCap`.
- `toggleStar(model, state, starId)` → new state. If selectable → add. If selected
  **and `canRemove`** → remove. Otherwise (would invalidate others, or neither)
  → unchanged. Removal is **rejected, never cascaded**.
- `sumBonuses(model, selected)` → `{ statId: number }` additive across all
  selected stars (Grim Dawn devotion like-stats stack additively; verify edge
  cases). `powersGained` → list of `celestial_power.name`. `weaponReqs` collected.

### Adapters

- **httpDataSource**: `fetch()` the JSON assets via relative paths (works on any
  static host / GitHub Pages). Build copies `data/*.json` into `dist/data/`.
- **svgRenderer**: three SVG layers: (1) optional `<image>` art layer (per
  `background`, only if manifest has it), (2) `<line>` links, (3) `<circle>` stars.
  Star CSS classes: `selected | selectable | locked`. Affinity-tinted by
  constellation. Coordinates normalized from the shared negative-origin canvas
  (compute bbox over all star + background positions).
- **Navigation/interaction adapter** (grimtools-style; first-class v1):
  - **Click a star** → toggle via core (add if selectable; remove only if the
    removal is valid, else the click is a no-op).
  - **Click-drag empty space** → pan. Mousedown on a non-star area starts a grab;
    moving the pointer translates the `viewBox`. Cursor switches `grab` →
    `grabbing`. A small movement threshold distinguishes a click from a drag, so a
    slightly-imperfect star click still selects rather than panning.
  - **Scroll wheel** → zoom in/out, anchored at the cursor position (the point
    under the cursor stays put), with sensible min/max zoom clamps.
  - **Reset/fit view** control to recenter the whole map.
  - Touch (pinch-zoom / drag-pan) is a nice-to-have, not required for v1.
  - The nav state (pan offset + zoom) is view-only and lives in the adapter,
    separate from the core `SelectionState`.
- **sidebar/tooltip views**: plain DOM render from core outputs.

## UI (v1 success criteria)

- **Point slider** (top): default **55**, max 55 (GD cap); label
  "Allocated X / N". Lowering below current allocation triggers `validClosure`.
- **Map**: SVG with grimtools-style navigation: **click a star** to toggle (add /
  remove if valid), **click-drag empty space** to pan (grab cursor), **scroll wheel**
  to zoom at the cursor, plus a reset/fit-view control. Selectable stars visibly
  highlighted; locked stars greyed/dimmed so it's obvious what can be picked.
- **Sidebar A, Cumulative benefits**: additive stat totals (human-labeled, e.g.
  "+50% Fire Damage") + list of celestial power names gained. No long
  descriptions.
- **Sidebar B, Affinity totals**: running count per affinity (chaos, eldritch,
  order, primordial, ascendant) from completed constellations.
- **Hover tooltip**: the star's bonuses + the constellation's affinity requirement
  to enter (the "points it requires").

## Asset pipeline (`just assets`): optimized, git-ignored

Extend the existing `scripts/tex2png.py` work into an optimization step (new
`scripts/build_assets.py` or flags): extract devotion `.tex` from `UI.arc` via
`ArchiveTool` → decode → **downscale to display size + encode WebP** → write to
`assets/devotions/` with a `manifest.json` (which `background.image` names exist).
Tunable to hit a size target (~15 MB with downscaled nebulas, or drop nebulas for
~5-8 MB). Output dir is git-ignored. App degrades gracefully to SVG dots when the
manifest/art is absent.

## justfile + bun

- `install` / `doctor`: add **bun** (winget `Oven-sh.Bun` if available, else the
  official installer) and verify it.
- `web-install` → `bun install` in `web/`.
- `test` → `bun test` (core).
- `build` → `bun build web/src/app/main.ts --outdir web/dist` + copy
  `index.html`, `styles.css`, `data/*.json`, and `assets/` (if present).
- `serve` → static-serve `web/dist` (bun) for local dev.
- `assets` → the optimized art pipeline above.

## Testing strategy

Almost all logic lives in `core/` as pure functions → `bun test` covers: entering
a constellation requires affinity; predecessor ordering; completing grants
affinity that unlocks others; Crossroads bootstrap; self-sustaining constellations
(bootstrap removable); point-cap limiting; guarded-removal correctness (leaf-valid
only, no cascade); additive bonus summation; graph-build integrity against the real
`devotions.json`. Adapters stay thin; minimal/no DOM tests in v1.

## Deployment (end-goal deliverable)

The **end goal is a GitHub Pages pipeline** (GitHub Actions) that builds the static
site and publishes it, so anyone can use the planner at a public URL. The app uses
only **relative** asset paths, so it works unchanged under a Pages project subpath
(`https://<user>.github.io/<repo>/`).

The CI builds with `oven-sh/setup-bun` → `bun build` → `actions/upload-pages-artifact`
→ `actions/deploy-pages`. Two milestones:

1. **SVG-only Pages (no decision needed):** deploy immediately; the map renders as
   affinity-colored dots/lines from `devotions.json` (committed). Works today.
2. **Art on Pages (gated on an image-commit decision):** CI **cannot** regenerate
   art. `just assets` needs the local game install + `ArchiveTool.exe`, which isn't
   available in Actions. So for the real artwork to appear on the public site, a
   chosen, optimized subset of WebP images **must be committed** to the repo (e.g.
   un-ignore `assets/devotions/` for the committed set, or a dedicated `web/public/`
   path). **This is the intermediate decision**: scope (constellations only? +
   nebulas?) and size/copyright trade-off (see grimtools precedent + Crate's
   copyright), to be made before milestone 2. Until then Pages ships SVG-only via
   the graceful fallback.

## Out of scope (v1)

- The optimizer/solver (separate later milestone; reuses this core).
- Committing image assets **by default**: deferred to the gated decision above.
- Persisting/sharing builds via URL (nice future add).

## Verification

1. `just test` → all core tests green.
2. `just build && just serve` → open the page; with no `assets/`, map renders as
   affinity-colored dots; slider defaults to 55. Wheel zooms at the cursor;
   click-dragging empty space pans (grab cursor); clicking a star selects without
   panning; reset/fit recenters.
3. Manual: pick a Crossroads star → affinity sidebar increments; a gated
   constellation's stars become selectable only after its requirement is met;
   hover shows bonuses + requirement; cumulative stats sum additively; clicking a
   relied-upon star is rejected (remove leaf stars first); once a constellation is
   self-sustaining, its bootstrap Crossroads star becomes removable.
4. `just assets` (optional, local) → re-open; real constellation art renders
   behind the dots; check `du -sh assets/` is at/under target.
5. Push to `main` → the Pages workflow builds and deploys; the public URL serves
   the working SVG-only planner. (Art appears only after the image-commit decision.)

## Notes / minor confirmables

- WebP vs optimized PNG for web art (recommend WebP for size).
- Include downscaled nebula backdrops (~15 MB) vs CSS-gradient background (~5-8 MB).
- Affinity color palette (sensible defaults, refine later).
- Confirm Grim Dawn devotion like-stat stacking is additive (assumed) during
  implementation.
