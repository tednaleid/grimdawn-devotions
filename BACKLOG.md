# Backlog

Planned enhancements for the web planner that are not yet started. Each item
should include implementation pointers for whoever picks it up.

## UI: feedback

### 1. Flash the constellations that grant a missing affinity on a blocked activation
Note: partly either/or with item 3 ("Path predictor"). If the map instead shows
every reachable constellation up front, the user already sees how to unlock a
blocked one, so this forward-flash may be redundant. Decide which approach we
want before building either; don't build both without revisiting this.

When clicking a constellation you cannot yet activate because its affinity
requirement is unmet, flash the unselected constellations that would grant points
toward the missing affinities, so the user can see how to unlock it. This mirrors
the blocked-deselection flash, but points "forward" (what to pick up) instead of
"backward" (what to remove first).

Notes:
- `web/src/core/rules.ts` `toggleConstellation` already rejects the add when the
  requirement is unmet (returns the same state); `main.ts` `onConstellationClick`
  already detects the rejection (`next === state`). Today the add-rejection path
  does nothing.
- Compute the missing affinities: `con.affinityRequired` minus the current totals
  (from completed constellations, excluding this one). For each affinity still
  short, find the unselected/incomplete constellations whose `affinityBonus`
  includes it. A small pure helper in `rules.ts` (or `affinity.ts`) keeps it
  testable.
- Reuse the flash machinery: `flashEl` + the `data-con-id` art images in
  `main.ts`/`svgRenderer.ts`. Consider a distinct color from the red
  blocked-deselection flash (this is "go get these", e.g. the affinity color or a
  helpful hue) and decide whether to also flash their stars.
- Watch for flashing too many constellations if a missing affinity is widely
  granted; consider limiting or just accept it.

## Map: reachability / path-predictor mode

### 2. "Path predictor" mode - highlight every constellation still reachable (needs spec + brainstorming)
Large feature; do the brainstorming skill and write a `docs/specs/` proposal
before building. Capture the idea here first.

Note: partly either/or with item 1 (blocked-activation flash). Showing all
reachable constellations up front may make the forward-flash redundant; settle
which one we want as part of this spec.

Instead of only highlighting the stars immediately takeable from the current
selection, this mode highlights every star/constellation for which a *viable path
to acquire it still exists* given the user's remaining points (and the affinity
bootstrap rules). The user can then click a far-out target (say Leviathan) to
commit it, the points are deducted, and anything that is no longer reachable as a
result darkens - so the user picks the constellations they most want and backs
into a valid path. Worked examples from the request:
- 1 point, nothing picked: only the 5 Crossroads stars highlight (Crossroads is
  the only constellation with no affinity requirement - the bootstrap).
- 55 points (and likely fewer), nothing picked: the whole map lights up, since
  everything is still reachable.
- After committing Leviathan, constellations with no remaining viable path darken
  (the user believes Tree of Life becomes unreachable once Leviathan is taken -
  verify against the data).

Why this is hard (resolve in the spec):
- "Reachable" is a forward feasibility question, not the one-step
  `selectableStars` answers. A target may require first completing cheaper
  constellations to earn the affinity that unlocks it, all within the point
  budget. That is a search over which constellations to complete, constrained by
  affinity requirements/bonuses and the budget.
- Affinity bonuses come only from *completed* constellations, while points are
  spent per star - so partial picks cost budget without advancing affinity. The
  feasibility model has to account for that.
- Define precisely what "reachable" means when some stars are already selected
  (paths must extend the current valid selection, not replace it).

Pointers:
- `web/src/core/rules.ts` (`validClosure`, `selectableStars`) and
  `web/src/core/affinity.ts` (`affinityFrom`, `meetsRequirement`,
  `completedConstellations`) hold the existing validity/affinity logic to build on.
- Highlighting/darkening reuses the map render path: `handle.update(state, ...)`
  in `main.ts` -> `web/src/adapters/svgRenderer.ts`, plus a CSS reachable/faded
  state (compare with the existing unmet-affinity fade).
- Feasibility precompute idea worth analyzing: the constellation count is small,
  so it may be possible to brute-force all reachable sets (or a reachability
  table keyed by remaining budget + earned affinity) as a build step and ship it
  as a data file. Do the combinatorics analysis first - it may or may not be
  tractable; if not, fall back to an on-the-fly search.

## UI: benefits panel

### 3. Make "Bonus to All Pets" benefits taggable / highlightable
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

## Known limitations (accepted)

- `racialBonusPercentDamage` aggregation in the sidebar uses the union of all
  selected stars' `racial_target`; if different races are mixed it lumps them
  together. Acceptable given how rare these stars are.
