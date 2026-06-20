# Backlog

Planned enhancements for the web planner that are not yet started. Each item
should include implementation pointers for whoever picks it up.

## UI: map readability

### 1. Make celestial-power diamonds 50% larger
The celestial-power diamonds should stand out more from the ordinary star dots;
grow them by about 50%.

Notes:
- `web/src/adapters/svgRenderer.ts` `POWER_RADIUS` is 15 (ordinary stars are
  `STAR_RADIUS` 12). Bump it ~50% (to ~22-23).
- Watch `HIT_RADIUS` (22): at the new size the visible diamond is about as large
  as the invisible hit circle. Consider growing the power star's hit target too so
  the click/hover area still exceeds the visible shape, or accept parity.
- Sanity-check that the bigger diamond does not visually collide with adjacent
  stars/lines on a dense constellation.
- `web/test/svgRenderer.test.ts` asserts the polygon class, not its size, so no
  test change is required (could add a size assertion).

## UI: benefits panel

### 2. Filter/highlight the map by benefit (tag) — needs design
Not ready to build; capture the idea first. Show ALL benefits in the left panel,
with the ones the current selection already grants at the top and the rest below.
Clicking a benefit (for example "Elemental Resistance") acts like a tag: the
stars/constellations that grant it get highlighted on the map so the user can see
where to pick up more of it.

Open design questions (resolve before building):
- Which benefits to list and how to label them: the union of every stat id across
  all stars, formatted/grouped via `statFormat`. Decide the granularity (one tag
  per raw stat id, or per ability family - see item 3).
- How multiple selected tags combine (AND vs OR), and how to clear them.
- How the highlight reads on the map and how it coexists with the existing
  affinity-requirement coloring and the unmet fade (outline the matching stars?
  dim everything else?).

Pointers:
- Enumerating all benefits: scan `model.stars` for `bonuses` keys;
  `web/src/core/statFormat.ts` (`classify`, `groupedBonusRows`) already formats
  and groups stat ids.
- `web/src/adapters/sidebarView.ts` `renderBenefits` currently shows only the
  summed bonuses of the current selection, not the full catalog.
- Highlighting would mean passing a set of "matching" star ids (stars whose
  `bonuses` include the tagged id) into `renderSvgMarkup` plus a CSS highlight
  state. Depends on item 3 for whether a tag maps to one id or a family.

### 3. Condense related benefit dimensions onto one line
Many benefit rows are different dimensions of the same ability and clutter the
list. Example: Frostburn appears as +N% damage, +N-M flat damage, +N flat
duration, and +N% duration; a Frostburn user wants all of those, so show them
together (one "Frostburn" line carrying its damage and duration values) instead
of four separate rows. There are likely several such groupings worth trying;
widening the left sidebar is acceptable.

Notes:
- `web/src/core/statFormat.ts` is where stat ids are classified and labeled
  (`DOT_DAMAGE`, `INSTANT_DAMAGE`, `RESIST`, the `offensive*` / `offensiveSlow*`
  + `Duration` parsing); `groupedBonusRows` builds the rows. A condensed mode
  would merge rows that share a damage type (for example all
  `offensiveSlowFrostburn*` plus its duration) into one labeled line with several
  values.
- `web/src/adapters/sidebarView.ts` `renderBenefits` renders the rows; the change
  highlight (`changeClass`) keys on the raw stat id, so a merged line needs a
  rule for how it flashes when one of its values changes.
- Sidebar width is `main { grid-template-columns: 240px 1fr 200px }` in
  `web/src/styles.css`.
- This also sets the tag granularity for item 2 (a tag would be the ability,
  expanding to its set of stat ids). Experimental: try a few groupings.

## UI: controls

### 4. Style the top-bar points and reset controls
The header controls (the Points slider + count, "Reset points", "Reset view")
use default browser styling and look unpolished.

Notes:
- Header markup is in `web/index.html` (the `<header>`: `#point-slider`,
  `#point-count`, `#reset-points`, `#reset-view`).
- `web/src/styles.css` only styles `header` itself (flex row) with no rules for
  the slider or buttons. Add button + range styling consistent with the dark
  theme (backgrounds around #161b22, borders #30363d, text #e6edf3), with spacing
  and hover/active states.

## Known limitations (accepted)

- `racialBonusPercentDamage` aggregation in the sidebar uses the union of all
  selected stars' `racial_target`; if different races are mixed it lumps them
  together. Acceptable given how rare these stars are.
