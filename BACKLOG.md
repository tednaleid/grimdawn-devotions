# Backlog

Planned enhancements for the web planner that are not yet started. Each item
should include implementation pointers for whoever picks it up.

(The path-predictor / reachability mode, its WASM resolver, and the reachability
correctness fuzzer have shipped; see `docs/reachability-performance.md` and the
`docs/superpowers/specs/` path-predictor designs. The old "blocked-activation
flash" idea was superseded by claim-anywhere reachability and is dropped.)

## UI: benefits panel

### 1. Make "Bonus to All Pets" benefits taggable / highlightable
The Benefits sidebar's "Bonus to All Pets" section (and the pet rows in tooltips)
are read-only. Unlike player benefits, you cannot click a pet benefit to highlight
the stars that grant it on the map. The blocker: pet stat ids are the SAME ids as
player bonuses (e.g. `defensiveElementalResistance` is both a player bonus and a
pet bonus), so the existing tag/highlight system - which keys on the raw stat id
via `data-vid` and `starsGranting(model, ids)` over `star.bonuses` - would conflate
the two sources and highlight the wrong stars.

To lift it, add a parallel pet-keyed path:
- `starsGrantingPet(model, ids)` in `web/src/core/aggregate.ts` scanning
  `star.petBonuses` instead of `star.bonuses`.
- A separate selected-pet-benefit set plus a distinct attribute (e.g.
  `data-pet-vid`) on the pet chips in `web/src/adapters/sidebarView.ts`, so a pet
  tag cannot collide with a player tag of the same stat id.
- Thread a pet highlight set into the map render (`handle.update` in `main.ts` ->
  `svgRenderer.ts`), with its own CSS state if it should read differently from the
  player-benefit highlight.
- Decide how a player tag and a pet tag for the same stat coexist (two independent
  toggles, or a combined view).

Pointers: pet bonuses are already parsed (`star.petBonuses`, summed by
`sumPetBonuses`) and rendered read-only in `sidebarView.ts` (the "Bonus to All
Pets" section) and `tooltipView.ts` (`petBonusHtml`).

## Performance

### 2. Monotone dim-cache for the reachability sweep
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
