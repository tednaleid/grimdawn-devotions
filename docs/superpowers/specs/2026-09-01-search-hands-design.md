# Search hands: replacing split search rings with fixed-angle clock hands

Status: design, ready to implement. Point-in-time record; when shipped, rewrite the
"Search rings" bullet in `docs/display-model.md` in place (do not append a changelog).

## Problem

A star matched by one or more active searches (benefit tags plus the text query) currently
wears a ring outside its dot. One match draws a full ring; several split it into equal arcs.
Each search's identity is a color plus a stroke-dash pattern; magnitude is 1-4x stroke width.
See `web/src/adapters/svgRenderer.ts` `ringMarkup` and `web/src/adapters/ringPalette.ts`.

Three things don't work:

1. **Arc position carries no identity.** Arcs are laid out by canonical order among the
   matches *on that star*, so the same search sits at 12 o'clock on one star and 4 o'clock on
   the next. Angular position is the strongest visual channel that survives color-vision
   deficiency and zoom-out, and it's currently thrown away.
2. **Dash patterns don't survive splitting.** A 90-degree arc of the "dotted" style holds two
   dots; the "dash-dot" style holds one dash. The redundant channel is unreadable exactly
   when it's needed.
3. **Width is a weak magnitude channel.** Readers estimate length from a fixed baseline far
   better than stroke width (Cleveland and McGill), and the current arcs change radius as
   they thicken, confounding the two.

Empirically, a highlighted star almost always has one or two matches (rarely up to four),
even with 20 filters active. The design below is optimized for that case and degrades
gracefully for the rest.

## Design

### Marker: hands, not rings

Each search that matches a star draws one **hand**: a straight, round-capped line radiating
from the star at that search's fixed angle. The star dot itself is untouched (it keeps its
affinity gradient fill).

- **Identity = angle (primary) + color (secondary).** Both are pure functions of the search's
  slot number (see Slot styles). Dash patterns are removed entirely.
- **Magnitude = hand length** from a fixed inner radius. Width is constant.
- A faint full-circle **track** at the hand's root radius is drawn on every matched star so a
  lone hand reads as "a clock with one hand" and an empty sector reads as "no".
- Hands get a dark underlay outline (the map background color, hand width plus 2 units)
  rather than the luminous `#self-glow` filter the rings used, so a hand lying along a
  constellation edge or reaching a neighbouring star still reads as a crisp separate object
  attached to its own star. Swapping back to the glow is one CSS rule if the flat look
  disappoints in review.

Geometry in map user units (existing `STAR_RADIUS` is 12, `POWER_RADIUS` for power stars):

```
HAND_ROOT   = STAR_RADIUS + 4          // hub gap so the hand "points" rather than "attaches"
HAND_MIN    = 8                        // weight 0 still shows direction
HAND_SPAN   = 22                       // added length at weight 1
HAND_WIDTH  = 7                        // ~half the dot radius; must stay < ~9 so 45-degree
                                       //   neighbours never fuse at the hub
TRACK_R     = HAND_ROOT + 2
STACK_GAP   = 3                        // between end-to-end segments (see Collisions)
length(w)   = HAND_MIN + HAND_SPAN * w
```

Power stars (diamond) use `POWER_RADIUS` in place of `STAR_RADIUS` exactly as today.

Weights come unchanged from `magnitudeWeights` (0 = smallest grant in the search, 1 = largest,
single match = 0). Text-query matches have no magnitude and use weight 0.

### Slot styles: eight angles, five colors, farthest-point order

Slots are assigned by the existing slot reconciliation (unchanged). A slot maps to a style:

```ts
// handPalette.ts
export const HAND_ANGLES = [90, 270, 180, 225, 135, 315, 45, 0] as const; // degrees, 0 = up, clockwise
export const HAND_COLORS = ["#f0f4ff", "#3ee6d8", "#ff9440", "#ff5e8a", "#a78bff"] as const;
// white, cyan, orange, pink, lavender - the existing palette, reordered.

export interface HandStyle { angle: number; color: string; }
export function handStyle(slot: number): HandStyle {
  return { angle: HAND_ANGLES[slot % 8]!, color: HAND_COLORS[slot % 5]! };
}
export const HAND_STYLE_COUNT = 40; // lcm(8, 5): unique (angle, color) pairs before repeating
```

Why this table:

- **Angles**: cardinals first, then diagonals. People name straight-up/down/left/right most
  precisely, 45-degree diagonals next; nothing finer is worth a slot. 45-degree spacing also
  means hands never fuse at the hub.
- **Straight up is last.** The text query keeps its reserved style outside the benefit table:
  angle 0 (up), color `QUERY_HAND_COLOR` (`#d4e157`, the former `QUERY_RING_COLOR`). Putting 0
  at the end of the benefit table means the first seven benefit tags never fight the query for
  the top spot; the eighth shares its direction (and stacks, see Collisions) but not its color.
- **Same-color separation**: slots `k` and `k+5` share a color, so `HAND_ANGLES[k % 8]` and
  `HAND_ANGLES[(k+5) % 8]` must be far apart. With this table every such pair is at least 135
  degrees apart across the entire 40-slot cycle: (90,315) (270,45) (180,0) (225,90) (135,270)
  (315,180) (45,225) (0,135). An earlier draft used `[0,180,90,270,45,135,315,225]` rotated by
  one to keep 0 out of the low slots; that rotation put slots 4 and 9 (both lavender) at 135 and
  90, only 45 degrees apart. This table was found by exhausting all orderings with 0 last and
  three cardinals first; a unit test pins the property so no reordering can quietly lose it.
- **Colors**: white first (lightness survives every color deficiency), cyan and orange next
  (near-complements), pink and lavender last (the closest pair to each other and to the
  ascendant affinity hue). These are the existing palette hues, chosen to sit between the
  five affinity colors; do not swap in Okabe-Ito or similar, whose blue/yellow/purple collide
  with primordial/order/ascendant.
- **Five colors, not four or six**: 4 shares a factor with 8 (slot 8 would exactly repeat
  slot 0); a 6th usable hue that avoids the affinity colors doesn't exist. Coprime 5 and 8
  give 40 unique styles, well past the 20-filter ceiling.

### Collisions: same angle on one star

Two searches on one star can share an angle only if their slots differ by a multiple of 8,
which by construction means they differ in color (8 mod 5 = 3), or if one of them is the
query (angle 0, its own color). Render them **stacked end to end** along the ray: the lower
slot draws from `HAND_ROOT`, the next starts `STACK_GAP` beyond the previous tip. Each
segment's length still encodes its own magnitude (a stacked bar). Order within a stack is by
slot number, low to high, with the query at the root.

Neighbouring stars: measured on the shipped data, the closest star pairs sit 40 units apart
(Aeon's Hourglass), 14 stars have a neighbour within 60, and the median nearest-neighbour gap
is 110. A full-length hand reaches 46 units, so a hand pointed within about 15 degrees of a
close neighbour touches its dot. Today's widest rings (outer radius 35) already overlap those
same pairs. Simplest rule: clamp total reach to
`HAND_ROOT + HAND_MIN + HAND_SPAN + STACK_GAP + HAND_MIN` and accept the rare overlap. Only
implement geometric clamping if dense constellations (Toad, Amatok, Aeon's Hourglass) look bad
in review.

### Legend swatch

Replace the ring swatch with a mini star: a **neutral gray** disc (this is a placeholder for
"a star", not an affinity), a faint track, and one hand at the slot's angle in the slot's
color at a fixed length. 14-16 px, e.g.

```
<svg width="16" height="16" viewBox="0 0 16 16">
  <circle cx="8" cy="8" r="6.2" fill="none" stroke="#fff" stroke-opacity=".18"/>
  <circle cx="8" cy="8" r="3" fill="#3a4556"/>
  <line x1=.. y1=.. x2=.. y2=.. stroke="{color}" stroke-width="2.6" stroke-linecap="round"/>
</svg>
```

Used everywhere the ring swatch is used today: selected Benefits rows (`sidebarView.ts`),
the search box (`searchPanel.ts`), tagged bonus rows in the tooltip (`tooltipView.ts`). Keep
the existing row outline in the slot color (the `--ring` box-shadow variable becomes `--hand`).

### Hover pulse (small, high value)

Hovering a selected Benefits row (or the query box) pulses every hand of that slot on the
map: opacity, not size, ~600 ms, one cycle. This teaches "this row = that angle" faster than
any legend and turns the conjunction search ("which star has a *big* Frostburn hand") into a
single-feature pop-out. Implement as a CSS class toggled on `.search-hand[data-slot=N]`
elements; respect `prefers-reduced-motion`. Ships as its own commit after the hands. Hold to
"solo" (other slots to 20% opacity while hovered) stays in the backlog.

### Zoom level of detail (deferred)

Below a zoom threshold where the track circle would render under ~20 px, hands aren't
readable. Collapse to a single presence halo (white, or the highest-weight slot's color).
Only do this if whole-map zoom looks noisy after the main change; ship the main change first.

## Stability and URL state

No change to slot reconciliation: removing a tag frees only its slot, everything else keeps
its slot, a new tag takes the least-used free slot (lowest index on ties). Because angle and
color are both derived from the slot integer, the clock inherits this stability for free, and
reusing freed slots keeps the live set as the lowest N slots, which by construction are the
most separated.

Known gap (pre-existing, more visible now): a fresh page load reseeds slots in canonical
order, so a shared link may show the same searches with different hands than the sender saw.
"3 o'clock pink" is something people will say to each other. Decision for this change:
**document it in `display-model.md`; do not encode slot order in the URL yet.** If it comes up
in practice, it's ~5 bits per tag through `hashCodec.ts` / `urlState.ts`, and the URL-state
invariant in `CLAUDE.md` applies.

## Code touchpoints

- `web/src/core/searchRings.ts` becomes `web/src/core/searchMarks.ts`: same behavior, with
  `benefitRingOrder`, `reconcileRingSlots`, `ringMap` renamed `benefitMarkOrder`,
  `reconcileMarkSlots`, `markMap`. "Mark" is the presentation-neutral word; "ring" would be a
  stale name in core once the marker is a hand. `core/` stays presentation-free: no angles or
  colors here.
- `web/src/adapters/ringPalette.ts` becomes `web/src/adapters/handPalette.ts`: `HAND_ANGLES`,
  `HAND_COLORS`, `handStyle`, `HAND_STYLE_COUNT`, `QUERY_HAND_COLOR`, `QUERY_HAND_STYLE`, and
  `handSwatchSvg`; the dash cycle, `scaleDash`, and `QUERY_RING_DASH` are gone.
- `web/src/adapters/svgRenderer.ts`: replace `ringMarkup` (and `ringArc`, `RING_*` constants)
  with hand markup: per star, group marks by angle, stack same-angle marks, emit the track
  circle and one `<line>` (plus outline) per segment. `RingMark` becomes `HandMark`
  `{ style: HandStyle; weight: number; slot: number }` and the `rings` option becomes `hands`.
  Keep it in the same full-opacity layer with the same `#mute-wide` wrapping when the
  constellation is off-filter.
- `web/src/styles.css`: `.search-ring` -> `.search-hand` (constant stroke widths live here);
  `.ring-swatch` -> `.hand-swatch`; add the hover-pulse keyframes.
- `web/src/adapters/{sidebarView,searchPanel,tooltipView}.ts`: swap swatch call; nothing else.
- `web/src/app/main.ts`: wherever marks are built from slots, call `handStyle(slot)` and pass
  `slot` through; wire the row-hover pulse.
- `web/e2e/smoke.ts`: the pet-tag check waits for `.search-hand`.
- `docs/display-model.md`: rewrite the "Search rings" emphasis bullet as "Search hands".
- `BACKLOG.md`: the "Search rings" follow-ups section becomes "Search hands"; the
  hover-to-isolate idea narrows to hold-to-solo, and zoom level of detail joins it.

## Tests

- `handStyle`: first 40 slots produce 40 distinct (angle, color) pairs; slot 40 equals slot 0.
- Same-color separation: for every slot `k` in 0..39, angular distance between
  `HAND_ANGLES[k % 8]` and `HAND_ANGLES[(k+5) % 8]` is >= 90 (the table achieves 135).
- Renderer: a star with marks at slots 0 and 8 emits two segments on the same angle, the
  second starting beyond the first's tip plus `STACK_GAP`; a star with slots 0 and 1 emits
  two hands at 90 and 270.
- Renderer: weight 0 still emits a hand of length `HAND_MIN`; weight 1 reaches
  `HAND_MIN + HAND_SPAN`.
- Existing slot reconciliation tests unchanged (renamed) and still green.
- `just check` passes.

## Acceptance (eyeball on real data)

Load a build with Frostburn, Offensive ability, Cold, and Pierce tagged plus a text query,
and check Amatok (three matches on one star), Toad, Hawk, and the Hammer:

- Every Frostburn hand on the map points the same way and matches the sidebar swatch.
- The affinity color of each star's dot is unobstructed.
- The longest and shortest Frostburn hands are visibly different in length, not width.
- Set all colors to gray in devtools: identity is still readable from angle alone.
- Remove Frostburn, add Lightning: nothing else moves; Lightning takes Frostburn's old hand.

## References (why, for the curious)

- Healey and Enns, "Attention and Visual Memory in Visualization and Computer Graphics",
  IEEE TVCG 2012: preattentive features; conjunction search is serial.
- Burlinson, Subramanian, Goolkasian, "Open vs. Closed Shapes", IEEE TVCG 2018: closed
  shapes outperform open/textured marks; mixing hurts.
- Smart and Szafir, "Measuring the Separability of Shape, Size, and Color in Scatterplots",
  CHI 2019: shape biases size and color reads; keep magnitude on one clean channel.
- Cleveland and McGill (1984): length on a common baseline beats width/area for magnitude.
