# Backlog

Planned enhancements for the web planner that are not yet started. Each item
includes implementation pointers for whoever picks it up.

## UI: surface what changed

### 1. Highlight changed Benefit values on add/remove
When a star or constellation is selected or deselected, the Benefits panel (left
sidebar) should make the delta obvious: highlight values that increased (for
example yellow text) and values that decreased (for example red text), ideally
fading after a moment.

Notes:
- `web/src/adapters/sidebarView.ts` `renderBenefits` rebuilds innerHTML on every
  refresh. To show deltas, diff the previous summed bonuses against the new ones,
  keyed on the raw stat id (not the formatted label), and tag changed rows.
- Previous totals need to persist between refreshes (hold them in `app/main.ts`
  or in the adapter).
- Decide: transient flash (CSS animation that clears on the next change) vs.
  persistent highlight until the next selection.

### 2. Highlight changed Affinity numbers on add/remove
Same treatment for the Affinity panel (right sidebar): when a pick changes
affinity totals, color the numbers that went up or down.

Notes:
- `renderAffinities` in the same file; diff previous vs. new `affinityTotals`.
- Share the diff and highlight helper with item 1.

## UI: celestial powers

### 3. Mark celestial-power stars and show full descriptions
Celestial-power stars should look special on the map (for example diamonds
instead of circles). Hovering one should show the power's full description.
Hovering a celestial power's name in the left Benefits list should also show the
full description.

Notes:
- The full text is already in `data/devotions.json`
  (`celestial_power.description`, `skill_class`), but `web/src/core/model.ts`
  maps only `{ name }`. Extend `Star.celestialPower` to carry `description` (and
  maybe `skill_class`).
- `web/src/adapters/svgRenderer.ts` renders every star as a `<circle>`. Render
  power stars as a rotated square or `<polygon>` diamond, keeping the hit target
  and gradient logic.
- `tooltipView.ts` should include the description for a power star.
- The sidebar power rows in `renderBenefits` need hover descriptions (a title
  attribute, or route them through the shared tooltip).

## UI: benefits organization

### 4. Group Benefits by type instead of alphabetical
The Benefits list should be grouped by category (for example: attributes and core
stats like Physique, Spirit, speeds, energy; resistances; damage types) rather
than one flat alphabetical list.

Notes:
- `web/src/core/statFormat.ts` `classify` could return a `group` per stat;
  `formatBonusRows` currently sorts alphabetically by label. Group rows under
  headings and order the groups deliberately.
- Suggested groups: Attributes and core stats; Offense (damage by type); Defense
  (resistances, armor, duration reductions); Other.
- Consider whether to apply the same grouping to the constellation tooltip union
  or keep that flat.

## Minor cleanups noted during review

- `justfile` build still copies `data/stat_labels.json` into `dist`, but the app
  no longer fetches it (the parser still emits it as a documented dataset). The
  copy can be dropped.
- CI logs a Node 20 deprecation warning from the pinned GitHub Actions. Harmless
  today; bump the action versions when convenient.
- `racialBonusPercentDamage` aggregation in the sidebar uses the union of all
  selected stars' `racial_target`; if different races are mixed it lumps them
  together. Acceptable given how rare these stars are.
