# Pure display-state model for the devotion map

Point-in-time design record. A refactor (with a deliberate retune) of how the
map decides what each constellation, star, and edge looks like. Today that logic
is split between `svgRenderer.ts` (which CSS classes an element gets) and
`styles.css` (what each class means, and which one wins when two set the same
property). No single place computes an element's final appearance, so
independent signals collide. This replaces that with a pure `core` module that
resolves all signals into a per-element record, which the adapter maps to SVG.

## Goal

A clean model that supports a display "visual language" which is easy to tweak,
reason about, and which clearly communicates each element's status to users.
Concretely:

1. One pure, headless-testable place computes every element's appearance.
2. Independent signals can never collide on a single property again.
3. The visual language uses distinct perceptual channels for distinct meanings,
   so two different statuses never look alike.

This is a refactor **and** a retune: the current values were iterated into an
incoherent state, and we fix them as part of moving to the new model.

## Background: the muddiness we are removing

`opacity` is a single property, and several independent concerns each set it via
equal-specificity CSS class rules. The cascade then picks one (by source order)
instead of composing. Symptoms found in the current code:

- Reachability dim (`con-dim` 0.15) and the affinity-filter fade (`aff-dim` 0.5)
  are both two-class rules on `opacity`; the later, lighter one won, so an
  unreachable non-matching constellation read **brighter** once a filter turned
  on. (Patched directly by making reachability dominate; the structural cause
  remains.)
- The constellation art base is 0.25, but `art.aff-dim` is 0.45 - so a reachable
  non-matching constellation's art got **brighter** under a filter.
- `unmet` art (0.06) is darker than `unreachable` art (0.10): the constellation
  you *can* start is dimmer than the one you can't.
- "locked" stars conflate "next on a path I'm building" with "cannot reach at
  all," because both are just "not clickable right now."

These are all the same root cause: no element has its final state computed in one
place, and meaning is encoded in the implicit ordering of a stylesheet.

## The core principle: independent axes, each owning a channel

Each element resolves three things independently. Two are **axes** that each pick
a single outcome, so they cannot collide within themselves; the third is a true
union of additive cues.

- **Brightness (opacity) <- attainability.** Answers exactly one question: "can I
  get this within my remaining points?" A tri-state: `active` (have it) ->
  `attainable` (can get it) -> `unattainable` (cannot, within budget). Owns the
  opacity scalar; nothing else moves it.
- **Color <- filter relevance.** Owns saturation and the match halo. A
  priority-resolved outcome: `mute` (filtered out) > `match` (matches a filter) >
  `identity` (no filter). Like opacity, exactly one outcome - the same discipline
  generalized to the color channel.
- **Emphasis <- a union of additive cues.** Active self-glow, selection styling,
  taken gold, and the compare-diff outline genuinely stack, so these are a union
  (a selected star that is also a compare-add, for example).

Because the axes own different channels, they combine freely instead of fighting.
An active constellation that does not match an active filter stays at opacity 1.0
with its active self-glow (brightness) **and** desaturates (`mute`, color) - it
reads as "active, but off-filter." No exemptions are needed; the channels just
coexist. That is the property that cures the original muddiness: reachability and
filtering can never look like each other, because they live in different
channels.

## The model

Values below are starting points for the retune, not frozen requirements.

### Constellation (art image)

Brightness - attainability:

| state | condition | opacity |
| --- | --- | --- |
| active | all stars selected | 1.0 |
| attainable | `completable` (whole constellation fits budget), not yet complete | ~0.25 |
| unattainable | not completable within budget (old `unmet` + `unreachable` fold in here) | ~0.12 |

Color - affinity-filter relevance (priority-resolved):

| outcome | condition | treatment |
| --- | --- | --- |
| mute | affinity filter on, does not provide a filtered color | desaturate |
| match | provides a filtered color | colored halo, from the matched colors |
| identity | no affinity filter | gradient tint (its granted colors) |

Emphasis (union): `active` -> self-glow.

### Star

Brightness - attainability:

| state | condition | opacity |
| --- | --- | --- |
| active | selected | 1.0 |
| attainable | `clickable` **or** its constellation is `completable` | 1.0 |
| unattainable | otherwise | ~0.30 |

`active` and `attainable` share brightness; "have it" vs "can get it" is carried
by the color and emphasis channels, not opacity.

Color - filter relevance, benefit + affinity (priority-resolved):

| outcome | condition | treatment |
| --- | --- | --- |
| mute | a filter is on and the star is relevant to none (not a benefit-match, not in an affinity-matching constellation) | desaturate |
| match | grants a filtered benefit | enlarge + halo, rendered as its own full-opacity layer |
| identity | no filter, or saved from mute by an affinity-matching constellation | colored when `clickable`, grey when locked |

`mute` means "irrelevant to *every* active filter"; matching *any* filter wins,
so a benefit-match in a constellation that lacks the filtered affinity is
emphasized, not muted.

Emphasis (union): `selected` -> white fill + gradient stroke; compare add /
remove -> outline.

### Edge

Brightness - attainability:

| state | condition | opacity |
| --- | --- | --- |
| active | taken (both endpoints selected) | 1.0 |
| attainable | in an attainable/completable constellation | 1.0 |
| unattainable | in an unattainable constellation | ~0.30 |

Color - affinity-filter relevance (priority-resolved):

| outcome | condition | treatment |
| --- | --- | --- |
| mute | affinity filter on, its constellation does not provide a filtered color | desaturate |
| identity | otherwise | normal stroke |

Emphasis (union): `taken` -> gold stroke + glow.

## How attainability is determined (no reachability-engine changes)

The existing `ReachView` already carries everything the brightness axis needs, so
this work does not touch the reachability perf path:

- `clickable` (per star): frontier stars whose predecessors are all selected and
  that stay within budget if taken - already a per-star, budget-aware signal.
- `completable` (per constellation): whether finishing the whole constellation
  fits in budget.

Star attainability resolves as `selected` -> active; `clickable` **or**
constellation `completable` -> attainable; else unattainable. The
`or completable` clause is a free win: a constellation you can fully finish
lights all its stars (all attainable), with only the frontier *colored*
(clickable). A constellation you cannot complete falls back to the frontier
only, so the lead star is bright and the next brightens as you pick - an accepted
approximation. Computing true attainability for *deep* (non-frontier) stars in an
incompletable constellation would need a per-star resolver run, which we
deliberately avoid. Constellation and edge attainability come directly from
`completable` / taken.

## Effects detail

- **`mute`**: drain color toward grey while keeping brightness. An SVG-native
  `feColorMatrix` saturate at a low value (WebKit-safe, like our other filters).
  It replaces every place we currently de-emphasize *for a filter* by dropping
  opacity. Because it lives in the saturation channel, it coexists with the
  brightness and emphasis channels: an `active` or selected element that is
  filtered out stays bright and glowing yet desaturated, reading as "active,
  off-filter" - so nothing is exempt from `mute`. A star relevant to *any* active
  filter (a benefit-match whose constellation lacks the filtered affinity) is
  resolved as `match`, not `mute`. If desaturate-alone reads too weakly, we push
  further **within the color channel** (more desaturation, lower contrast, slight
  scale-down) rather than borrowing opacity back - keeping the channels clean.
- **Halos as their own layer**: SVG `opacity` dims an element's entire output,
  glow included. So a benefit-match halo on an unattainable (dim) star is drawn
  as its own full-opacity element at the star, not as a filter on the dim dot.
  The dot stays dim ("you cannot get this yet") while the bright halo says "but
  it matches your filter." The existing `aff-glow` rect is the precedent.
- **Immediacy color**: a star is colored when `clickable`, grey otherwise; this
  is the click affordance, independent of its attainability brightness.

## Architecture (hexagonal)

- **Pure `core`** (new module, e.g. `core/displayState.ts`): given the model and
  the current settings (selection, `ReachView`, active filters, compare diff),
  emits a per-element record: a resolved `opacity` number, a resolved color
  outcome (`mute` / `match` / `identity`, the match carrying its matched
  `Affinity[]`), and a union of emphasis cues. These are semantic, not
  presentational - the halo carries affinities, never hex; `mute` is a flag.
  Headless-testable.
- **Adapter** (`svgRenderer.ts` + `styles.css`): maps records to SVG. Applies the
  computed opacity directly (data-driven, not via colliding CSS rules), maps
  effect flags to the SVG filter defs / classes, and resolves affinities to
  colors. CSS loses its opacity-collision rules and gets thinner; the actual look
  of each effect (blur radii, hex, stroke widths) still lives here, so the
  *look* stays tweakable in CSS while the *logic* is pure.
- **Untouched**: the reachability engine and its perf path, the `ReachView`
  shape, the `ports` boundary, the URL/`b=` format, and the tooltip/sidebar.

## Evergreen documentation

A new living reference under `docs/` (e.g. `docs/display-model.md`) explains the
architecture in broad strokes: the axis principle (brightness <- attainability,
color <- filter relevance, plus an emphasis union), why each axis owns its own
channel so they combine without colliding (the collision history that motivated
it), the per-element responsibilities, and the pure-core/adapter split. It
documents the *reasoning and structure*, not the specific tuned values (which
change). It follows the project's evergreen-doc rule (kept current in place, not
a change log).

## Testing

- **Pure `core` (`displayState`)**: the heart of the work. Assert each element's
  brightness tri-state, color outcome, and emphasis union across signal
  combinations - reach states, each filter alone and together, selection, compare
  diff. Specifically lock in: brightness only ever reflects attainability (a
  filter never changes opacity); the color axis resolves `mute` > `match` >
  `identity`; a benefit-match on an unattainable star still resolves to `match`
  (halo), and a benefit-match in an affinity-non-matching constellation is
  `match`, not `mute`; an `active`/selected element that is filtered out still
  resolves to `mute` while keeping its brightness and emphasis; match halos carry
  the matched affinities, not colors.
- **Adapter**: the record-to-SVG mapping - opacity applied as a value, effects to
  the right filters/classes, affinity resolved to color.
- **e2e**: the existing affinity/benefit-filter smoke checks, retargeted from the
  old `aff-dim`/`con-dim` opacity classes to the new mapping.

## Non-goals

- No changes to the reachability engine or its performance path; no per-deep-star
  attainability computation.
- No change to the URL/`b=` format, the `ports` boundary, or the tooltip/sidebar.
- Freezing exact opacity / saturation values: those are retuned with visual
  verification and live in CSS/constants, not in this spec.
- Restyling anything outside the map's element rendering.
