# Pet-Bonus Filtering - Design

Date: 2026-06-22
Status: Draft for review
Builds on: the benefit-tagging and "Available to get" features already in
`web/src/adapters/sidebarView.ts`, `web/src/core/aggregate.ts`, and
`web/src/core/urlState.ts`. Closes backlog item 1.

## Summary

The sidebar's "Bonus to All Pets" section is read-only. Player benefits can be
clicked to highlight the map stars that grant them and to discover unheld ones in
"Available to get", but pet benefits cannot. Korvaak, the Eldritch Sun is the
motivating case: it grants several pet stats that show on the left when selected
but cannot be filtered for.

This spec makes pet bonuses first-class taggable benefits with full parity to
player benefits (highlight on the map, and their own "Available to get" list),
without changing the data model. The mechanism is a scoped tag id: a pet bonus is
keyed as `pet:<statId>` so it flows through the same catalog, tag, highlight, and
availability pipeline as any player benefit, distinguished only by an id prefix.

## Decisions taken during design

Settled with Ted during brainstorming; not open:

1. **Full parity, not highlight-only.** Pet bonuses become taggable (map
   highlight) and also appear in their own "Available to get" list.
2. **Scoped tag id, not parallel plumbing and not a model refactor.** The data
   model already separates the two cases cleanly (`star.bonuses` and
   `star.petBonuses` are distinct maps). The gap was the tag layer, which keys on
   a bare stat id with no room for the player/pet distinction. A `pet:` id prefix
   closes that gap with one unified pipeline. A model change to a unified
   `grants[]` with a scope field was considered and rejected: it is a large
   invasive rewrite of the parser and every consumer for no functional gain.
3. **Same-stat tags are independent.** Tagging player Elemental Resistance and
   pet Elemental Resistance are separate toggles; this falls out of scoped ids.
4. **Pet "Available to get" sits below the player list**, under its own "Bonus to
   All Pets" subheading, and renders only when at least one pet bonus is actually
   still available.
5. **One map highlight style for v1.** A star that grants a tagged pet bonus uses
   the same `.match` emphasis as a player match. A distinct pet color is out of
   scope (a one-class follow-up if wanted).

## The scoped-key convention

A benefit tag key is a string in the existing `selectedBenefits: Set<string>`:

- a player bonus stays its bare stat id, for example `defensiveElementalResistance`
- a pet bonus is prefixed, for example `pet:defensiveElementalResistance`

The prefix is the only new concept. `onBenefitClick` in `main.ts` already treats
`data-vid` and `data-ids` as opaque strings and toggles them into
`selectedBenefits`, so it needs no change: a pet chip simply carries
`data-vid="pet:<id>"`.

Formatting and grouping (`condensedRows`, `classify`, `decompose` in
`statFormat.ts`) must see raw stat ids, because the prefix would break the regex
families that map ids to labels and groups. So the pet catalog is built from raw
pet ids and its resulting part ids are prefixed afterward. The player catalog is
untouched.

## Core changes (`core/aggregate.ts`, `core/urlState.ts`)

- `starsGrantingPet(model, rawIds)`: the mirror of `starsGranting` that scans
  `star.petBonuses` instead of `star.bonuses`. Returns the set of star ids that
  grant any of the given raw pet stat ids.
- `availablePetKeys(model, selected, completable)`: the mirror of
  `availableBonusIds` that scans `petBonuses` and returns `pet:`-prefixed keys for
  the pet bonuses still obtainable (carried by unselected stars in completable
  constellations).
- `canonicalStatIds(model)` stays as is (sorted player stat ids); it still feeds
  the player catalog in `main.ts`, which must see raw ids.
- `canonicalPetStatIds(model)`: sorted raw pet stat ids (the keys across every
  `star.petBonuses`); feeds the pet catalog.
- `canonicalBenefitIds(model)`: the URL bitset ordering, composed as
  `[...canonicalStatIds(model), ...canonicalPetStatIds(model).map(id => "pet:" + id)]`
  (player block then `pet:`-prefixed pet block). Player ids keep their existing
  positions, so the `b=` bitset is byte-identical for player-only state and
  extends with pet bits only when pet tags exist. No new URL parameter. This is
  the only list handed to the hash codec.

## URL state and back-compat (the shareable-URL invariant)

The `b=` benefit bitset (`encodeBitset` / `decodeBitset`) is positional over the
canonical id list. Because the pet block is appended after the unchanged player
block, an old shared link (player bits only, trailing-trimmed) decodes to exactly
the same player tags it always did; its absent pet bits decode to no pet tags. A
new link with pet tags simply extends the bitset. The CLAUDE.md shareable-URL
invariant is preserved, and pet tags now round-trip. `encodeHash` / `decodeHash`
keep their shape; only the canonical list they are handed changes.

## Rendering (`adapters/sidebarView.ts`)

The chip and subject rendering currently used for active player benefits is
factored into shared helpers so player and pet sections do not duplicate it (per
the reduce-duplication rule). Using those helpers:

- The active "Bonus to All Pets" section (left panel) becomes interactive: each
  pet subject renders with `data-vid="pet:<id>"` chips and `data-ids="pet:a,pet:b"`
  groups, with the same `vsel` (value selected) and `gsel` (group selected)
  states player benefits use. Read-only `petChip` is replaced.
- A pet "Available to get" list is built from a separate pet catalog
  (`condensedRows` over all pet stat ids, with part ids then prefixed `pet:`),
  filtered by `availablePetKeys`, and returned as `petAvailHtml`.

`renderBenefits` returns `{ bonuses, petBonuses, availHtml, petAvailHtml }`. A pet
subject is shown in the pet available list when it is not already active and is
obtainable (its `pet:` key is in `availablePetKeys`), with the same tagged-stays-
listed rule that keeps a tagged-but-unobtainable subject clickable.

`main.ts` places `petAvailHtml` under the player "Available to get", with its own
"Bonus to All Pets" subheading, only when `petAvailHtml` is non-empty.

## Map highlight (`app/main.ts` -> `adapters/svgRenderer.ts`)

`refresh` currently highlights `starsGranting(model, selectedBenefits)`. It now
partitions `selectedBenefits` into bare player ids and `pet:`-stripped pet ids and
highlights the union `starsGranting(model, player)` joined with
`starsGrantingPet(model, pet)`. `handle.update` already takes a single highlight
set, so `svgRenderer.ts` is unchanged: a star granting any tagged benefit, player
or pet, gets `.match`; the rest get `.dim` while filtering.

## Hexagonal placement and files touched

Core (pure):

- `core/aggregate.ts`: add `starsGrantingPet`, `availablePetKeys`.
- `core/urlState.ts`: add `canonicalPetStatIds` and `canonicalBenefitIds` (player
  block then `pet:` block); `canonicalStatIds` is unchanged.

Adapters and app:

- `adapters/sidebarView.ts`: factor shared chip/subject helpers; make the pet
  active section interactive; build and return `petAvailHtml`.
- `app/main.ts`: build the pet catalog once; compute `availablePetKeys` per
  refresh; pass them to `renderBenefits`; place `petAvailHtml`; partition the tag
  set and union the two highlight sources; hand `canonicalBenefitIds` to the
  hash codec.
- `styles.css`: only if the pet available subheading needs a rule; reuse existing
  benefit classes otherwise.
- `e2e/smoke.ts`: a pet-tag highlight assertion and a pet available-list
  assertion.

No change to `svgRenderer.ts`, `tooltipView.ts` (pet rows stay read-only there),
the parser, or `data/devotions.json`.

## Testing (TDD throughout)

Core unit tests (`test/aggregate.test.ts`, `test/urlState.test.ts`):

- `starsGrantingPet` returns exactly the stars whose `petBonuses` include a given
  id, unions multiple ids, and is empty for an empty set (mirrors the
  `starsGranting` tests, using a known pet star such as a Korvaak pet stat).
- `availablePetKeys` returns `pet:`-prefixed keys for unselected stars in
  completable constellations, skips selected stars, and is empty when nothing is
  completable.
- `canonicalBenefitIds` keeps every player id at its prior index and appends the
  pet block.
- Back-compat: an old player-only `b=` payload decodes to the same player tags
  under the extended canonical list, and a round-trip with mixed player and pet
  tags restores both.

Adapter tests (`test/sidebar-benefits.test.ts`):

- `renderBenefits` emits taggable pet chips (`data-vid="pet:..."`) for the active
  pet section.
- `petAvailHtml` lists only obtainable pet subjects, is empty when none are
  obtainable, and keeps a tagged-but-unobtainable pet subject listed.

End-to-end (`e2e/smoke.ts`):

- Tag one of Korvaak's pet bonuses and assert the map marks the stars that grant
  it as a pet bonus (`.star.match`), independent of any player tag of the same
  stat.
- Assert the pet "Available to get" subheading appears with items while budget
  remains and is absent once points are spent.

## Out of scope

- A distinct map color for pet matches (one-class follow-up if wanted).
- Tagging pet rows inside tooltips (only the sidebar pet sections become taggable).
- Any model or parser change.

## Risks and open questions

- Subject-key collision: a pet subject and a player subject share the same
  `group:subject` key. Toggling and selection are driven by the scoped `data-ids`,
  not the key, so the collision is harmless; the pet catalog and the active pet
  section produce matching keys so the active-exclusion filter still works.
- `renderBenefits` growth: mitigated by factoring the shared chip/subject helpers
  rather than copying them.
- Highlight ambiguity when a stat is tagged for both scopes: a star granting
  either is emphasized, consistent with how multiple player tags already union.
  Acceptable for v1; a distinct pet style is the escape hatch.
