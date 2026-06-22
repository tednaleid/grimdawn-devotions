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

## Known limitations (accepted)

- `racialBonusPercentDamage` aggregation in the sidebar uses the union of all
  selected stars' `racial_target`; if different races are mixed it lumps them
  together. Acceptable given how rare these stars are.
