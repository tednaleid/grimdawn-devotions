# Search arcs: directional half rings replace the clock hands

Status: design, implemented from this record. Point-in-time record; the living description is
the "Search arcs" bullet in `docs/display-model.md`. Supersedes the marker in
`2026-09-01-search-hands-design.md`, whose slot styles, stability rules, legend, and hover pulse
carry over unchanged.

## Problem

The clock hands were hard to see. Rooted just outside the dot they were a few pixels long at the
default zoom; enlarged and rooted at the star's centre they still painted far less than the split
rings they replaced, even though their direction was easier to read. A marker needs both: the
paint area of a ring and the fixed direction of a hand.

## Design

### Marker: a half ring centred on the search's angle

Each search that matches a star draws an **arc** on a track ring just outside the dot: the half
circle centred on that search's angle (the same slot angles as the hands), in its color.

- Alone, an arc runs its whole half: east is 0 to 180 degrees, north is 270 through 0 to 90.
- Where two half circles on one star overlap, each is cut back to the bisector between the two
  angles, less a seam of 3 degrees a side. East white and west teal split at 0 and 180; west teal
  and southwest magenta split at 247.5, so teal runs about 250 to 360 and magenta 135 to 245.
- With more searches the rule applies on each side independently: an arc extends toward each
  neighbour by half the angular gap, capped at 90 degrees. East, southwest, and west give east 3
  to 154.5, southwest 160.5 to 244.5, west 250.5 to 357.
- Searches sharing an angle (slots eight apart) stack outward in slot order, 2 units apart.

Geometry in map user units (`STAR_RADIUS` 12, `POWER_RADIUS` 19 for power stars):

```
ARC_RADIUS       = STAR_RADIUS + 15     // 27; power stars POWER_RADIUS + 14
ARC_WIDTH        = 16                   // base stroke; the inner edge (19) is fixed
width(w)         = ARC_WIDTH * (1 + 2w) // triple at the search's largest grant, growing outward
ARC_SEAM_DEG     = 6                    // split across a seam where two arcs meet
```

Magnitude is stroke width growing outward from the fixed inner edge, as the split rings did it;
width is the channel that keeps the paint area large. Ends are round caps; because a cap reaches
half the width past a path's end, each path stops one cap short of its extent (asin(w/2 / r)
degrees) and the cap fills it, so a lone half stays a half and seams keep their gap at any
width. A faint track ring under the arcs shows where no arc is. Review history: the first cut
had a dark outline and flat ends at base width 8; with the affinity palette the base arcs were
small and blended into same-hued dots and art, so the floor doubled (8 to 16) and the ceiling
rose by half (32 to 48); a light outline was tried and rejected, and the outline went away in
favour of round ends.

### The query is a regular search

The hands reserved straight up in lime for the text query. There was no good reason: while a
query is active it now claims the lowest free slot under its own key (`QUERY_MARK_KEY` in
`core/searchMarks.ts`), appended after the canonical tags, and holds it while active, so typing
never moves it and clearing frees it. Its color comes from the palette like any tag's, and the
constellation halo, search-box outline, and swatch follow that color (`queryColor` on the
renderer's per-render options). Like the tags, a reloaded link may give it a different style.

With north free, the angle table is north, south, east, west, then northwest, southwest,
northeast, southeast: `[0, 180, 90, 270, 315, 225, 45, 135]`. North and south lead because one or
two concurrent searches is the common case (a damage type's flat and percent lines) and opposite
halves read far better than two halves split at a bisector. That choice costs the whole-cycle
same-color guarantee: exhausting the orderings with north then south first and the cardinals
before the diagonals, the best keeps every same-color pair (slots five apart) at least 135
degrees apart through seven concurrent searches, and the eighth search is the first to share a
color with a 45-degree neighbour (east and southeast). The palette test pins exactly that.

### Colors: the affinity palette

Direction now carries identity, so the mark colors only need to tell neighbours apart, and the
review found the between-affinity hues (white, cyan, orange, pink, lavender) busy next to the
affinity-colored dots. The marks take the five affinity orb colors instead, from
`affinityColors.ts`, in the order gold, blue, red, green, purple: gold leads as the lightest,
blue is its opposite, and red and green sit east and west so the pair red-green color vision
deficiency merges is always parted by direction. Known cost: with an affinity filter and a text
query both active, the query's constellation halo can match a filter halo's hue; the star arcs
the query always adds tell them apart, and the combination is uncommon.

### Legend swatch

The mini star's hand becomes a 90-degree arc centred on the slot's angle. A quarter, not a half,
so the direction reads from where the arc sits rather than from where a neighbour cut it.

### What stays

Slot reconciliation and its stability rules, the five-second legend hover pulse (now on
`.search-arc[data-slot=N]`), the affinity-mute wrapping, arcs painted under the dots so a close
neighbour's dot stays on top.

## Code touchpoints

- `web/src/adapters/markPalette.ts` (was `handPalette.ts`): `MARK_ANGLES`, `MARK_COLORS`,
  `markStyle`, `MARK_STYLE_COUNT`, `arcPath`, `markSwatchSvg`. No query constants.
- `web/src/core/searchMarks.ts`: `QUERY_MARK_KEY`.
- `web/src/adapters/svgRenderer.ts`: `StarMark`, `arcExtents`, `arcMarkup`, the `marks` and
  `queryColor` options, `pulseMarks` on the handle.
- `web/src/adapters/searchPanel.ts`: `setCount(match, style)` takes the query's style.
- `web/src/adapters/{sidebarView,tooltipView}.ts`, `web/src/app/main.ts`, `web/src/styles.css`
  (`.search-arcs`, `.search-arc`, `.arc-track`, `.mark-swatch`, `--mark`), `web/e2e/smoke.ts`.

## Tests

- Palette: 40 distinct styles; same-color separation >= 90 over the cycle; north first, cardinals
  before diagonals; `arcPath` direction and large-arc flag; swatch arc for east and north.
- Core: the query key reconciles like a tag and never appears in the canonical benefit order.
- Renderer: a lone half ring; opposite searches parted by the seam; 45-degree neighbours split
  at the bisector; three searches partitioned; width 8 to 32 outward from the fixed inner edge
  with the outline 4 wider; same-angle stacking; power-star radius; arcs under the dot; the halo
  floods in the render's query color.
- Panel: the search box outlines and swatches in the style it is given.
- e2e: tagging marks stars with `.search-arcs`; hovering the tagged chip pulses `.search-arc`.
