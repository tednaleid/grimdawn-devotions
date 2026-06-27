# Affinity filter visuals refinement

Point-in-time design record. A visual pass over the shipped
`tooltip-filter-highlighting` feature (still on its branch, not yet merged):
unify the "selected filter" styling, make the active affinity obvious in the
desktop tooltip, and replace the affinity-filter constellation dimming with a
colored glow on matching constellations.

## Goal

Three changes, all visual, no change to what the filters select:

1. Make an active affinity filter obviously highlighted in the desktop tooltip
   (today the highlight is applied but nearly invisible).
2. Unify every "this filter tag is selected" affordance on one standard: a light
   blue rounded (squircle) outline plus a hover text highlight, matching the
   "Available to get" panel that already reads well.
3. Replace the affinity-filter fade of non-matching constellations (which looks
   like the unrelated "not enough points" reachability dimming) with a diffuse
   colored glow on matching constellations, keeping only a much milder fade on
   the rest.

## Background: current state

- The "Available to get" subjects use the affordance we want everywhere:
  `.bgroup` is a rounded pill (`border-radius: 12px`); `.bgroup.gsel` (selected)
  adds a faint blue fill `rgba(108,182,255,0.08)` and a 1.5px blue squircle
  outline `rgba(108,182,255,0.6)` (the blue is `#6cb6ff`); `.bsubj:hover` turns
  the label `#6cb6ff`.
- The other selected states diverge from that and read poorly:
  - Left benefits `.brow.vsel`: `background: #20313f` + a gold left edge
    (`box-shadow: inset 3px 0 0 #e3c97a`). Hard to see, does not match.
  - Affinity panel `.affinity.vsel`: the same gold left edge.
  - Tooltip `.tip-bonus.vsel` / `.aff.vsel`: `background: #20313f`, which is
    nearly the tooltip's own background (`#1c2330`), so on desktop the active
    affinity tag looks unhighlighted. This is the root of item 1; the `vsel`
    class is already applied (the wiring is correct), it just is not visible.
- The renderer fades non-matching constellations hard under an affinity filter
  (`aff-off`: art/art-tint ~0.06, links ~0.05, stars ~0.08), which is heavier
  than the reachability fade (`con-dim`: ~0.15/0.1) and reads as the same
  "unavailable" signal. Matching constellations get no positive emphasis.

## Decisions (resolved during brainstorming)

- One selected standard: the blue squircle + hover text highlight, applied to
  left benefits, the affinity panel rows (wrapping the color dot and name), the
  tooltip bonus rows, and the tooltip affinity lines.
- Affinity match glow color: only the matched filter colors (the filter
  affinities the constellation actually provides), as a gradient when several
  match, not the constellation's full identity gradient.
- Non-matching constellations keep a much milder fade (clearly lighter than the
  reachability dim), not a full removal of the fade.
- The glow is the cheap zoom-scaling SVG variant (blur in user units, so it
  grows as you zoom in, like the existing star glows). A screen-constant glow
  (recomputing the blur radius on each viewBox change) is a deferred follow-up
  if the zoom-scaling look is unsatisfying.

## Part 1: unified selected + hover styling

Define the selected affordance once and apply it to every filter-tag element:

- Selected: `border-radius` around 12px (scaled per element where a full pill
  does not fit a dense row), faint fill `rgba(108,182,255,0.08)`, and a 1.5px
  outline `rgba(108,182,255,0.6)`.
- Hover (desktop): the row/label text turns `#6cb6ff`.

Replacements:

- `.brow.vsel`: remove the `#20313f` fill and gold inset edge; use the blue
  squircle. Hover lights `.brow-lbl.subj`. (The dense table row keeps its
  existing `border-radius: 4px`; the squircle reads as a rounded outline, not a
  large pill.)
- `.affinity.vsel`: replace the gold inset edge with the squircle wrapping the
  whole row (orb dot + name + have/need cells). Hover lights the affinity name.
- `.tip-bonus.vsel` and `.aff.vsel`: replace the `#20313f` background with the
  squircle. This makes item 1's active affinity tag obviously outlined in the
  desktop tooltip.

The squircle declaration is factored into one shared rule (a selector list
covering `.bgroup.gsel`, `.brow.vsel`, `.affinity.vsel`, `.tip-bonus.vsel`,
`.aff.vsel`) so the four sites cannot drift; `.bgroup.gsel` keeps its current
look by joining that rule.

## Part 2: affinity match glow (renderer)

### Renderer input

`RenderOpts.affinityMatch?: Set<string>` (constellation ids) is replaced by
`RenderOpts.affinityFilter?: { grants: Set<Affinity>; requires: Set<Affinity> }`.
Its presence means an affinity filter is active.

A new pure core helper, `matchedAffinities(con, grants, requires): Affinity[]`,
returns the filter affinities a constellation provides: an affinity in `grants`
with `affinityBonus > 0`, or in `requires` with `affinityRequired > 0`, in
canonical order. A constellation is matching when this list is non-empty.

`app/main.ts` parses the active `aff:grant:`/`aff:req:` tags into the two sets
(replacing `affinityMatchCons`) and passes them to `handle.update`. The old
`constellationsMatchingAffinity` core helper is superseded by `matchedAffinities`
and removed along with its test and call site.

### Matching constellations glow

For each matching constellation with art, draw a diffuse colored halo behind its
art image:

- A per-constellation gradient `aff-grad-<id>` is built from only its matched
  affinity colors (`affinityColor`), using the same left-to-right stop
  construction as the existing `grad-<id>` (one color renders solid).
- A `<rect class="aff-glow">` at the art bounds, `fill="url(#aff-grad-<id>)"`,
  `mask="url(#mask-<id>)"` (the art silhouette), `filter="url(#aff-glow)"`, drawn
  in a layer beneath the art image so the blurred color bleeds out around it.
- `#aff-glow` is a WebKit-safe SVG `<filter>` (a feGaussianBlur with an expanded
  filter region so the blur is not clipped, plus a brightness lift so the halo is
  brighter and more spread than the PNG tint). The blur `stdDeviation` is in user
  units, sized to read as a soft halo (~20px at the fit zoom); it scales with
  zoom. The exact value is tuned during implementation.

The art mask is currently built only for constellations with an affinity
requirement (for the tint). It is generalized so a `mask-<id>` exists for any
constellation that has art and either has a requirement or matches the active
filter, shared by the tint and the glow without duplicate ids.

All constellations that can match an affinity filter in the current data have
art (Crossroads, which have no art, grant no affinity and so never match). A
matching constellation without art therefore does not occur in practice; if one
ever did it would get no halo and no fade (it still reads as present). No
star-level glow fallback is built.

### Non-matching constellations

When an affinity filter is active, a non-matching constellation gets a mild fade
(`aff-dim`) on its art, links, and stars at roughly 0.5 opacity, clearly lighter
than both today's `aff-off` (~0.06) and the reachability `con-dim` (~0.15). A
benefit-`match` star stays exempt (keeps its blue glow), the same invariant the
current renderer enforces.

### Independence and layering

- The benefit filter (per-star blue `match` glow + per-star `dim`) is unchanged
  and independent of the affinity layer.
- Selected (complete) constellations keep their brighter white `self-glow-art`,
  drawn on the art image above the colored halo, so an active build still stands
  out as the brightest thing on the map.

## Architecture (hexagonal)

- Pure `core`: `matchedAffinities` (the match + matched-color logic), tested
  headless. `affinityTagId` and the `b=` tag model are unchanged.
- `adapters`: `svgRenderer` builds the gradient/mask/glow and the `aff-dim`
  fade; `styles.css` carries the shared squircle rule and the glow/fade classes.
- Composition root `app/main.ts`: parses `aff:` tags into the grant/require sets
  and passes them to the renderer.
- The `b=` URL format, the `ports` boundary, and the benefit-filter path are
  untouched.

## Testing

- core `affinity`: `matchedAffinities` returns the intersection for grant and
  require tags (e.g. a Chaos grant filter on a Chaos+Order constellation returns
  `[chaos]` only; a require filter keys off `affinityRequired`).
- adapter `svgRenderer`: with `affinityFilter` present, a matching constellation
  emits a `.aff-glow` rect referencing an `aff-grad-<id>` gradient built from
  only its matched colors; a non-matching constellation's art/links/stars carry
  `aff-dim`; a benefit-`match` star does not carry `aff-dim`; no filter emits
  neither class. The previous heavy-`aff-off` tests are retuned to the new
  classes.
- adapter styling: the existing `vsel`/`data-vid` class-application tests still
  hold (the class names are unchanged; only their CSS changes). CSS values stay
  verified visually and via e2e, as before.
- e2e (`web/e2e/smoke.ts`): the desktop affinity-panel toggle asserts the glow
  is present on matching constellations and the mild fade on the rest, then
  clears on toggle off (replacing the current `.star.aff-off` assertions).

## Non-goals

- A screen-constant glow (constant size regardless of zoom). Deferred; revisit
  only if the zoom-scaling glow reads poorly. It would recompute the filter
  `stdDeviation` on each viewBox change via a navController hook.
- Any change to the benefit filter's star glow/dim, to the tag model, or to the
  URL format.
- Restyling unrelated selected states (only the filter-tag affordances change).
