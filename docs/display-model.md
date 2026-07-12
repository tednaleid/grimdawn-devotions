# Display Model

How the devotion map decides what each constellation, star, and edge looks like.

## The Problem We Solved

Before this model, the map's visual logic was split between the SVG renderer (which CSS classes an element gets) and the stylesheet (what each class means). With multiple independent signals all setting the same property, the CSS cascade would pick one winner instead of composing them. This led to collisions where a signal was silently overwritten:

- Reachability dimming and affinity-filter fading both set `opacity`, so whichever CSS rule came last would hide the other's meaning.
- A constellation that was unreachable but matched an affinity filter could appear *brighter* than an unreachable non-match, because the lighter fade won.
- A star that was "next in my build" (attainable) looked identical to one that was "cannot reach at all" (unattainable), because both just meant "not clickable right now."

The root cause: no place computed an element's final state as a whole. Meaning was encoded in stylesheet rule ordering, which is fragile and invisible.

## The Solution: Three Independent Channels

Each element resolves three independent dimensions:

1. **Brightness** (opacity) <- attainability: "Can I get this within my remaining points?" A tri-state: active (have it), attainable (can get it), or unattainable. This channel answers that one question, so it owns the opacity property and nothing else touches it.

2. **Color** (saturation) <- affinity-filter relevance: "Does this match the active affinity filter?" Also a tri-state outcome: mute (off-filter, desaturate), match (provides a filtered color, glow in matched colors), or identity (no filter active). Color and saturation are their own channel, separate from brightness.

3. **Emphasis** (a union of additive effects) <- independent cues that genuinely stack. Active elements glow, selected elements get special styling, taken edges glow gold, benefit-match stars enlarge and glow, compare-diff shows outlines. These are not competing for a single property; they are additive layers that coexist.

Because brightness, color, and emphasis own different channels, they combine freely. An active constellation that fails an affinity filter stays fully opaque (brightness) and self-glows (emphasis) *while* desaturating (color). You can see it is both active and off-filter. Neither signal overrides the other.

## Brightness: Attainability

Sourced from the ReachView (completable per constellation, reachableStars per star) with no changes to the resolver beneath the reachability engine.

### Constellations

- **Active**: all stars selected.
- **Attainable**: at least one star selected, OR the whole constellation fits in your remaining point budget (`completable`).
- **Unattainable**: neither of the above.

### Stars

- **Active**: selected.
- **Attainable**: in `reachableStars` - the star plus its unselected predecessors fits the remaining
  budget. This covers every unselected star of a completable constellation and the in-reach stars of
  a partially enterable one (a constellation too expensive to finish can still light the stars whose
  path fits, computed exactly by the engine's per-constellation maxK search).
- **Unattainable**: otherwise.

### Edges

- **Active**: both endpoints selected (taken).
- **Attainable**: the deeper endpoint is selected or in `reachableStars` (its path contains the
  shallower endpoint, so the whole edge sits on a reachable path).
- **Unattainable**: otherwise. Edge brightness is endpoint-level, so the lit path through a dimmed
  constellation reads star-to-star while the constellation art stays dim.

## Color: Affinity Filter

Driven by the affinity-filter signal alone. The filter is a set of desired affinities (what you want to grant or require). A constellation or star either matches the filter or it does not.

### Constellations

- **Match**: constellation provides at least one of the filtered affinities. Renders with a halo in the matched affinity colors, so the map highlights constellations that contribute to your target.
- **Mute**: constellation is active but provides none of the filtered affinities. Desaturates (loses color but keeps brightness), signaling "off your filter." Desaturation happens via SVG `feColorMatrix` saturate, not opacity, so it coexists with brightness and emphasis.
- **Identity**: no affinity filter is active. Constellation renders in its granted affinity colors (a gradient tint of what it contributes to your pool).

### Stars

Stars carry no affinity halo of their own (that is the constellation's responsibility). The affinity axis only:

- **Identity**: constellation matches the filter, OR no filter is active. Star renders normally (colored when clickable, grey when locked).
- **Mute**: constellation fails the filter. Star desaturates along with its constellation, so it reads as part of an off-filter region.

### Edges

Like stars:

- **Identity**: constellation provides a filtered color, OR no filter is active.
- **Mute**: constellation fails the filter. Edge desaturates.

## Emphasis: Additive Cues

Independent signals that stack. Never opacity:

- **Active self-glow**: an active (fully selected) constellation or edge glows in its own color, lifting the visual weight so it stands out as "I have this."
- **Selection styling**: a selected star renders with a white fill and gradient stroke, the immediate visual feedback of a click.
- **Benefit-match enlarge and glow**: a star that grants a filtered benefit (one you want) enlarges and glows. Rendered as its own full-opacity layer so the glow reads even on an unattainable (dim) star. When the star's constellation fails the affinity filter, the glow is wrapped in a desaturate filter so the whole effect reads as "benefit match, off-filter" without the star's opacity bleeding through.
- **Compare-diff outlines**: a star added or removed in a comparison shows an outline, marking the change.
- **Taken gold**: an edge whose both endpoints are selected renders gold (the traditional grimtools style), distinct from the normal edge color.

Crucially, the affinity filter only *emphasizes* matches. It does not de-emphasize non-matches. A benefit-matching star in an off-filter constellation glows (benefit cue) and desaturates (affinity cue) *at the same time*, so you can still see it matches your target even though it is off-filter.

The halo brightness also respects the brightness channel: a matching constellation that is unattainable glows dimmer than a reachable one, so reachability still reads under an active filter.

## Architecture: Pure Core, Thin Adapter

- **Core** (`web/src/core/displayState.ts`): a pure, headless-testable module that resolves all signals for each element into a semantic record. The record carries a brightness enum (the attainability tri-state), a color outcome (the mute/match/identity flag, with match carrying its matched affinities as semantic data, not colors), and a union of emphasis flags. No presentation logic; no CSS class names; affinities as `Affinity[]` values, not hex colors; the adapter maps the brightness enum to an opacity value. No pixel numbers in the core.

- **Adapter** (`web/src/adapters/svgRenderer.ts` + `styles.css`): maps semantic records to SVG. Applies computed opacity directly as an attribute (data-driven, not via colliding CSS rules). Maps emphasis flags to SVG filter defs and classes. Resolves affinities to colors. The SVG engine rasterizes the filters. CSS applies tunable visual properties (opacity ramps, saturation strength, blur radii, stroke widths, halo colors) but no collision-prone logic.

The split ensures the map's *logic* (brightness only from attainability, affinity filter only mutes or matches, emphasis is a union) is pure and testable, while the *look* (exact opacity maps, desaturation strength, glow size) stays tweakable in CSS and the adapter without touching the core.

## What Did Not Change

- The reachability engine and its performance path.
- The reachability resolver and its performance path. The ReachView gained reachableStars (per-star attainability) and dropped the frontier-only clickable signal.
- The URL hash format or the `b=` selection encoding.
- The ports boundary or how the core exports data.
- Tooltips, the sidebar, or any UI outside the map rendering.
