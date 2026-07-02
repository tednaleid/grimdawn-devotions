# i18n hexagonal boundary: core returns descriptors, adapters resolve

Date: 2026-07-02
Status: approved design, not yet implemented
Branch: `i18n-hexagonal-boundary` (worktree), evaluated before merge

## Problem

`core/localization.ts` defines the `Localization` port, then undercuts it with a
module-level mutable singleton (`setLocalization` / global `translate` /
`gameText`). Core formatting modules (`statFormat`, `benefitRows`,
`commitAction`) call the singleton and return resolved display strings. Two
concrete defects follow:

1. **Locale-dependent identity.** `CondensedSubject.key` is
   `"<group>:<translated subject>"`, so grouping identity changes with the
   active locale. Two subjects whose labels collide in some locale silently
   merge; the same build groups differently per language. Two merges in the
   current data are intentional and rely on this accident: `defensiveProtection`
   plus `defensiveProtectionModifier` (both labeled "Armor") and
   `retaliationFearMin` plus `retaliationFearChance` (both labeled "Fear").
2. **Stale caches by default.** Structures that cache formatted output bake in
   the locale, so `main.ts` needs a manual `buildCatalogs()` call on language
   switch, and every future cached structure must remember to do the same.

## Decision

Core stops producing display strings. Core formatting returns locale
independent **descriptors**; view adapters resolve them through the
`Localization` port at render time. The singleton is deleted at the end of the
migration. This was chosen over the cheaper alternatives (threading the port
through signatures while still returning strings, or only fixing subject keys
and catalog lifecycle) because it makes locale independence of core output true
by construction rather than by discipline.

## The `Text` descriptor

Defined in `core/localization.ts`, beside `makeLocalization`, so resolution
semantics stay in one module:

```ts
export type Text =
  | { k: "app"; key: string; params?: Record<string, string | number | Text> } // translate(key, params)
  | { k: "game"; tag: string }                                                 // gameText(tag)
  | { k: "gameStripped"; tag: string } // stripValueTokens(gameText(tag)), for value-embedded format tags
  | { k: "lit"; s: string }            // locale-independent literal: numbers, "+5%", "+3-7"
  | { k: "join"; parts: Text[] };      // concatenation, e.g. debuff name + duration suffix

export function resolveText(loc: Localization, t: Text): string;
```

- Params may nest `Text`, covering the existing
  `translate("stat.template.damage", { type: gameText(tag) })` pattern.
- `resolveText` lives in core: it is a pure function over the port interface,
  so core owns resolution semantics (the active-then-English-then-key fallback
  stays in `makeLocalization`); adapters supply the port instance.
- `gameStripped` keeps the `stripValueTokens` rule (domain knowledge about Grim
  Dawn format strings) in core while deferring the text to resolution time.
- Values become `Text` too, not only labels. Most are `lit`, but some embed
  catalog text today (`ui.benefit.seconds`, the "max " prefix), so `StatRow`
  becomes `{ label: Text; value: Text }`. Uniform beats `string | Text`.
- Sorting by label is presentation and moves out of core. Core returns stable
  structural order (group order, then subject key); adapters sort by resolved
  label via a `sortByResolved(loc, items, labelOf)` helper. Per-locale
  alphabetical ordering is preserved as behavior.

## Structural subject identity

`decompose()` returns `{ group, subjectKey, subjectLabel: Text, dim }` where
`subjectKey` is derived from the match arm, never from display text:

- Family arms: `"damage:Fire"`, `"dot:Bleeding"`, `"resist:Fire"`,
  `"attr:Life"` (family plus raw segment).
- Standalone stats: the raw stat id.
- The two intentional merges get explicit shared keys: `"armor"`
  (`defensiveProtection`, `defensiveProtectionModifier`) and
  `"retaliation-fear"` (`retaliationFearMin`, `retaliationFearChance`). They
  become visible decisions instead of catalog accidents.

`CondensedSubject.key` becomes `"<group>:<subjectKey>"`. The `data-gkey` DOM
attributes and the sidebar catalog/active matching switch to structural keys
(ephemeral, no compatibility concern). The URL `b=` bitset is untouched; it
already uses raw stat ids. In locales where two different subjects happen to
translate to the same string, they now correctly stay separate rows. That is
the only user-visible behavior change and is limited to accidental non-English
collisions.

## Module changes

Core:

- `core/localization.ts`: keeps `makeLocalization`; gains `Text`, `resolveText`,
  `sortByResolved`; the singleton (`current`, `setLocalization`, global
  `translate` / `gameText`) is deleted at the end of the migration. Nothing in
  `core/` may resolve text except through a passed-in `Localization`.
- `core/statFormat.ts`: every label-producing site (`classify`, `statRow`,
  `formatBonusRows*`, `formatPowerStats`, `formatPet`, `condensedRows`,
  `groupedBonusRows`) returns `Text`. The regex families and OVERRIDES table
  are untouched; only label materialization changes. `humanize()` fallback
  output becomes `lit` (synthesized English, not catalog text; the
  humanize-coverage guard already pins how rarely it fires).
- `core/benefitRows.ts`: `now`/`base`/`delta`/`subLabel` become `Text`; the
  base/now union skeleton keys off structural subject keys, removing its
  dependence on both sides resolving under one locale.
- `core/commitAction.ts`: `label` becomes `Text`.
- `core/urlState.ts`: no change (`isFilterableStat` never translated; benefit
  bits are raw ids).

Adapters: `sidebarView`, `tooltipView`, `buildOrderView`, `languagePicker` each
take `loc: Localization` (plain argument or constructor capture, matching each
module's current shape) and call `resolveText` where HTML is assembled.

`main.ts`: holds the `Localization` instance it already loads and passes it
down. Language switch collapses to reload localization, `applyChrome()`,
`refresh()`. `buildCatalogs()` is deleted; `benefitCatalog` / `petCatalog` are
computed once at boot and never rebuilt, because they no longer contain
resolved text.

## Migration staging

The singleton stays alive during the migration as a compatibility shim so
conversion goes bottom-up, one landable green stage at a time:

1. Characterization snapshot before any refactor: a test renders the resolved
   benefits panel rows, tooltip rows, and build-order rows for a representative
   selection (touching powers, pets, racial, weapon requirement, max-resist,
   durations) under `en` and `zh`, and writes the fixture. Every later stage
   must reproduce it byte-identical.
2. Add `Text`, `resolveText`, `sortByResolved` with unit tests.
3. Convert `commitAction` (smallest; proves the adapter-resolve pattern end to
   end through the touch popover).
4. Convert `statFormat` family by family (overrides, then damage/dot/resist/
   attr arms, then power stats, then pet, then condensed). Unconverted callers
   wrap converted output with `resolveText(singleton)` so nothing downstream
   changes until it converts.
5. Convert `benefitRows` plus structural subject keys.
6. Adapters take `loc`; label sorting moves to the render side.
7. Delete the singleton and `buildCatalogs()`; add a grep-guard test asserting
   no `core/` file imports the deleted names.

## Testing

- Existing tests survive via composition: they currently install the singleton
  in setup and assert English strings. They switch to building a real
  `Localization` from the checked-in `en` catalog and asserting on
  `resolveText(loc, ...)` output; expected strings unchanged.
- New cross-locale guard: build `condensedRows` / `benefitRows` structures
  under two locales and assert subject keys and structure are identical (the
  invariant English output cannot test, since all en labels are distinct).
- The stage 1 snapshot is the merge gate: byte-identical output plus green
  `just check` and `just e2e` means nothing observable changed except the
  intended non-English de-merge fix.

## Worth-it evaluation before merge

The branch is merged only after an explicit evaluation:

- snapshot diff is empty and `just check` / `just e2e` are green,
- `git diff --stat` against main is reviewed for total churn,
- a side-by-side readability read of two or three converted `statFormat`
  families against their string-returning originals.

If the descriptor version reads worse than the string version, abandon the
branch; the cost of the experiment is only the branch.
