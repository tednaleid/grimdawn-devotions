# Tooltip filter highlighting + affinity filters

Point-in-time design record. Backlog items 2 ("Filtered benefits highlighted
and toggleable in the tooltip/popover") and 3 ("Affinities as filter values"),
designed together because they share the tooltip and tag plumbing.

## Goal

Two related additions to the planner's filter system:

1. In the star/constellation tooltip, mark the bonus rows that belong to the
   active benefit filter with the same selected styling the sidebar uses, and
   on touch let the user tap those rows to toggle filter membership.
2. Let affinities be filter values: a constellation's granted and required
   affinities become filterable. Granted affinities are settable on desktop by
   clicking the Affinity panel rows; on touch, the tooltip's Grants:/Requires:
   lines are tappable. Active affinity tags are highlighted in tooltips like the
   benefit rows.

## Background: how filtering works today

- A filter tag is a raw stat id (for example `offensiveFireMin`), `pet:`-scoped
  for pet bonuses (`pet:characterLife`). Tags live in `selectedBenefits`
  (`Set<string>` in `main.ts`) and round-trip in the `b=` URL bitset over the
  canonical id order from `canonicalBenefitIds(model)` (`core/urlState.ts`).
- `main.ts` `taggedStars()` turns the active tags into a `Set<StarId>` of stars
  that grant a tagged benefit; that set is the map `highlight`.
- The renderer (`adapters/svgRenderer.ts`) emphasizes matching stars and dims
  the rest: `filtering = highlight.size > 0`; a matching star gets `.match`
  (the `#match-glow` SVG filter), every other star gets `.dim`.
- A separate, pre-existing fade exists for reachability: `dimCons` collects
  constellations that cannot be activated and fades their art, links, and stars
  together via the `.con-dim` class (svgRenderer.ts:153-154, 225, 252). The
  affinity fade below is a parallel, stronger version of this same pattern.
- The sidebar marks a selected benefit row with the `vsel` class and tags each
  per-value row with `data-vid="<scoped id>"` (`adapters/sidebarView.ts`). The
  tooltip's bonus rows and the sidebar's benefit rows both derive their stat ids
  from the same `bonusEntries` (`core/statFormat.ts`), including the flat
  Min/Max merge that keys a damage-range row by its `...Min` id, so a tooltip
  row id matches the sidebar tag id exactly.

## Decisions (resolved during brainstorming)

- Both items ship in one spec/plan.
- Affinity filtering targets whole constellations, not individual stars.
- Affinity filtering de-emphasizes non-matching constellations (a strong fade
  of art, links, and stars) rather than glowing matching ones.
- Benefit and affinity filters are independent visual layers. When both are
  active, the affinity layer fades non-matching constellations and the benefit
  layer still glows its matching stars on top, even inside a faded constellation.
- Desktop sets granted-affinity filters by clicking Affinity panel rows.
  Required-affinity filters are settable only via the touch tooltip or a shared
  URL (the desktop tooltip is hover-only and non-interactive); they still
  highlight in tooltips on every device.
- Tooltip benefit rows toggle a single stat id (per-value), not the sidebar's
  subject-group set. This is intentional; the sidebar `vsel` on a subject row
  already lights per-part, so the two stay visually consistent.

## Tag model (core/urlState.ts)

Extend `canonicalBenefitIds` with an affinity namespace appended after the pet
tags: for each affinity in `AFFINITIES` order, `aff:grant:<affinity>` and
`aff:req:<affinity>` (10 ids total). Appending strictly at the tail preserves
backward compatibility the same way `pet:` did: earlier bit positions are
unchanged, so an old `b=` payload decodes identically, and a state with no
affinity tags encodes to the same short, trailing-trimmed hash.

No new URL parameter. The shareable-URL invariant holds through the existing
bitset.

`urlState.test.ts` currently asserts that everything after the player block
starts with `pet:`. That becomes false once `aff:` ids follow the pet block, so
the test is updated to assert the three-block shape: player ids, then `pet:`
ids, then exactly 10 `aff:` ids at the tail.

## Matching (core)

Two distinct match computations, because the two filter kinds have different
granularity:

- Benefit/pet tags keep producing a `Set<StarId>` via the existing
  `taggedStars()` (unchanged). `aff:` tags are skipped in `taggedStars()` (they
  are not stat ids; routing them to `starsGranting` would silently match
  nothing).
- A new pure helper in `core/affinity.ts`,
  `constellationsMatchingAffinity(model, grants: Set<Affinity>, requires: Set<Affinity>): Set<string>`,
  returns the ids of constellations that grant any affinity in `grants`
  (`affinityBonus[a] > 0`) or require any in `requires` (`affinityRequired[a] > 0`).
  `main.ts` parses the active `aff:grant:` / `aff:req:` tags out of
  `selectedBenefits` into the two affinity sets and calls this helper.

## Highlight model (adapters/svgRenderer.ts)

`RenderOpts` gains `affinityMatch?: Set<string>` (matching constellation ids).
Its presence (not `undefined`) means an affinity filter is active; an empty set
means a filter is active but nothing matches, so every constellation fades.

A constellation is affinity-off-target when `affinityMatch` is present and does
not contain its id. Off-target constellations get a new `aff-off` class on:

- the art image and the art-tint rect (Layer 1),
- the link segments (Layer 2),
- the star symbols (Layer 3).

`aff-off` fades more strongly than `con-dim`; the two classes may co-occur on an
unreachable, off-target constellation, and `aff-off` dominates.

The benefit layer is unchanged and independent: `filtering = highlight.size > 0`
still drives per-star `.match` / `.dim` from the benefit/pet `highlight` set.
The one interaction: a star that is a benefit `.match` does not also get
`aff-off`, so a matching star keeps its full glow even inside a faded
constellation. Concretely, the star class precedence becomes: `match` (benefit
hit, full glow, no fade) > `aff-off` (affinity off-target, strong fade) > `dim`
(benefit filtering and not a hit) > normal. `con-dim` (reachability) and the
compare-diff classes still stack as today.

CSS adds `.art.aff-off`, `.art-tint.aff-off`, `.link.aff-off`, and
`.star.aff-off` rules (a strong opacity reduction), with `.star.match` keeping
precedence over `.star.aff-off`.

## Tooltip rendering (adapters/tooltipView.ts)

`show` and `showConstellation` take a new trailing parameter
`selectedBenefits: Set<string>` (default `new Set()` so existing tooltip tests
keep compiling).

- Bonus rows render through a new id-carrying flat formatter (added to
  `core/statFormat.ts`) that mirrors `formatBonusRows` but keeps each row's stat
  id from the shared `bonusEntries`. The formatter takes a `scope: (id) => string`
  argument: identity for player bonuses, a `pet:` prefix for the "Bonus to All
  Pets" block. Each `.tip-bonus` row gets `data-vid="<scoped id>"` and a selected
  class when `selectedBenefits.has(scopedId)`.
- The summon-pet attack lines (`petHtml`) stay untagged; they are ability lines,
  not pet-bonus tags, even though they also render as `.tip-bonus`.
- Power and ability stat lines stay untagged (not in the tag space).
- The `Grants:` affinity spans (`affinityLine`) get `data-vid="aff:grant:<a>"`
  and the selected class; the `Requires:` spans (`requiresLine`) get
  `data-vid="aff:req:<a>"` and the selected class.
- The selected styling reuses or mirrors the sidebar's `vsel` look so tooltip
  and sidebar read identically.

`data-vid` is always emitted. It is inert on a passive desktop tooltip
(`#tooltip` is `pointer-events:none` except in the touch popover, where it is set
to `auto`), so highlighting works everywhere while clicking only acts in the
touch popover.

## Affinity panel (adapters/sidebarView.ts)

`renderAffinities` takes a new trailing parameter `selectedBenefits = new Set()`
(keeps its existing call signature working). Each `.affinity` row gets
`data-vid="aff:grant:<a>"` and the selected class when that grant tag is active.
`onBenefitClick` is already bound to `affinityEl` and already toggles any
`closest("[data-vid]")` before its group branch, so panel rows become
grant-filter toggles with no new handler. Required-affinity filtering is not
offered in the panel (touch/URL only, per the decisions).

## Click wiring (app/main.ts)

- Thread `selectedBenefits` into all three `tip.show` / `tip.showConstellation`
  call sites: the map `onHover`, the sidebar power-hover (`benefitsEl`
  `mousemove`), and `showCommitPopover`.
- Add `affinityMatchCons()` (parses `aff:` tags, calls
  `constellationsMatchingAffinity`, returns the set or `undefined` when no
  affinity tag is active) and pass its result to `handle.update` as the new
  `affinityMatch` option.
- Touch popover tag toggling: the existing `tooltipEl` `pointerup` delegate
  gains a branch. `.tip-commit` still commits and closes. A `[data-vid]` row
  (guarded by `popoverTarget` being set, so it only acts in popover mode)
  toggles that tag in `selectedBenefits`, calls `refresh()`, then re-shows the
  popover in place so it stays open with the updated highlight. The popover's
  last `x`/`y` are stored alongside `popoverTarget` for the re-show; `place()`
  re-clamps, so the popover may nudge slightly, which is acceptable.
- The `document` `pointerdown` dismiss handler already ignores taps inside
  `tooltipEl`, so a tag tap does not dismiss the popover.

## Architecture (hexagonal boundaries)

- Pure `core`: the `canonicalBenefitIds` extension, the id-carrying bonus
  formatter, and `constellationsMatchingAffinity`. All testable headless.
- `adapters`: `svgRenderer` gains the `aff-off` fade, `tooltipView` and
  `sidebarView` emit `data-vid` and selected state. No DOM logic leaks into core.
- Composition root (`main.ts`): parses tags into the two match computations,
  threads `selectedBenefits`, and owns the touch click wiring.
- The URL hash format, the `ports` boundary, and the `core` selection/reach
  engine are untouched except for the additive canonical extension.

## Testing

- core `urlState`: round-trip a mix of a player tag, a `pet:` tag, and an `aff:`
  tag; an old player-only payload still decodes unchanged; the three-block shape
  of `canonicalBenefitIds` (updated existing assertion).
- core `affinity`: `constellationsMatchingAffinity` returns the right
  constellation set for a grant tag and for a require tag.
- adapter `tooltipView`: given a `selectedBenefits` set, the right bonus rows
  carry `data-vid` and the selected class (player and pet scoped correctly), the
  Grants:/Requires: spans carry the `aff:` ids and selected state, and power
  lines stay untagged.
- adapter `sidebarView`: `renderAffinities` marks the matching panel rows with
  `data-vid` and the selected class.
- adapter `svgRenderer`: with `affinityMatch` present, non-matching
  constellations' art, links, and stars carry `aff-off`; a benefit `match` star
  in an off-target constellation keeps `match` and does not carry `aff-off`.
- e2e (`web/e2e/smoke.ts`): on touch, open a popover, tap a benefit row and
  assert the tag toggles (URL `b=` changes, the map updates, the popover stays
  open); tap a Grants:/Requires: line and assert the affinity tag toggles and
  non-matching constellations fade. On desktop, click an Affinity panel row and
  assert the grant tag toggles.

## Non-goals

- Group-level (subject) toggles in the tooltip; per-value only.
- A required-affinity control on desktop.
- List view and the other backlog items.
- Changing the existing benefit-only filter behavior (glow matches, dim the
  rest) when no affinity filter is active.
