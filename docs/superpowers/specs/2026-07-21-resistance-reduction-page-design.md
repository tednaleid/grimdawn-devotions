# Resistance Reduction Page

Point-in-time design record. Dated 2026-07-21. Sub-project 2 of the
resistance-reduction (RR) initiative: the `/resistance-reduction` planner page
that consumes the committed `data/resistance-reduction.json` (produced by
sub-project 1, `scripts/parse_rr.py`) and presents it as a mechanics primer, a
filterable/sortable source table, and a live "debuff ledger" that resolves final
enemy resistance per damage type.

It reproduces the desktop prototype (`.llm/grim-dawn-rr_1.html`) faithfully in
layout and behavior, but adapts it to authoritative data, this app's
architecture, and its two invariants: strict i18n and fully shareable URL state.

## Goals

- A new page served at `/resistance-reduction/`, bundled from this repo, sharing
  the app's i18n infrastructure and base styling but otherwise independent of the
  starmap planner.
- **Faithful port** of the prototype's three parts (primer, table, ledger), with
  the table reshaped for our exhaustive dataset (see Table below).
- **Every view-changing action round-trips through the URL hash** with full
  push/replace history, exactly like the planner: search, all filters, sort,
  group-by, ledger selection, and the enemy starting-resistance value. Back /
  Forward / bookmark / share restore the exact view. No view state lives only in
  memory or the DOM.
- **No hardcoded user-facing strings.** UI copy resolves through the existing
  `Localization` port; source names resolve from the per-language game tag tables.
- Ships on the `resistance-reduction-pipeline` branch alongside the pipeline.

## Non-goals

- The monster resistance survey (sub-project 3, BACKLOG.md).
- Changing the ledger's resolution mechanics from the prototype's (they are
  correct per docs/devotion-system.md's cousin rules and the in-game formula).
- Server-side routing or a SPA router: this is a second static entry point, not a
  route inside the planner (which owns the hash for build state).
- Perfect trigger/duration/cooldown data: the pipeline emits what the records
  cheaply yield; the page shows that and does not fabricate precision.

## Architecture and files

A second bundle mirroring the app's hexagonal layout, under `web/src/rr/`:

- `web/src/rr/core/` - pure domain logic, no DOM:
  - `model.ts` - the `RrSource` type and `loadCatalogue()` (parse + validate the JSON doc).
  - `aggregate.ts` - collapse atomic rows into display `LogicalSource`s (see Data model).
  - `ledger.ts` - the resolution math (see Ledger core).
  - `filter.ts` - pure filter/sort/group over logical sources from a `ViewState`.
  - `urlState.ts` - `encodeHash(view)` / `decodeHash(hash)`; the single source of view state.
- `web/src/rr/adapters/` - I/O and rendering:
  - `catalogueSource.ts` - fetch `data/resistance-reduction.json` + `game.<locale>.json`.
  - `tableView.ts` - render the source table (rows, headers, group sections).
  - `ledgerView.ts` - render the debuff-ledger sidebar.
  - `primerView.ts` - render the mechanics primer + controls.
- `web/src/rr/app/main.ts` - entry point: wires adapters to core, owns the render loop
  and the hashchange/pushState plumbing (mirrors `web/src/app/main.ts`'s `refresh`/`applyHash`).
- `web/resistance-reduction.html` - the page's HTML shell (parallel to `web/index.html`).
- Reuses without modification: `web/src/ports/Localization.ts`,
  `web/src/adapters/localizationAdapter.ts`, `web/src/adapters/languagePicker.ts`,
  and the base `web/src/styles.css` (RR-specific CSS lives in a scoped block or
  `web/src/rr/rr.css`).

`web/scripts/bundle.ts` gains a second entrypoint (`src/rr/app/main.ts` ->
`resistance-reduction/main-<hash>.js`) and rewrites `resistance-reduction.html`'s
asset refs the same way it does `index.html`. `just build` copies
`data/resistance-reduction.json` and `data/i18n/game.*.json` into
`dist/resistance-reduction/`. The page is reachable at `/resistance-reduction/`
(a subfolder `index.html`), and the two pages cross-link in their headers.

## Data model and aggregation

The committed dataset is **atomic**: one row per (record x resistance), 472 rows
over 304 logical sources. The page keeps the dataset atomic and aggregates for
display in `aggregate.ts`:

- A `LogicalSource` groups atomic rows by `(record_path, rr_type)`; its
  `resistances` is the union of the group's resistance tokens (kept as tokens:
  `"All"`, `"Elemental"`, and single labels - never pre-expanded), and it retains
  per-resistance `value_at_max`/`value_at_ultimate` when they differ (from the
  atomic rows), else a single value.
- Item level-versioning is already collapsed upstream (sources key on the shared
  skill/modifier record), so no per-item dedup is needed here.
- Ticking a logical source in the ledger selects all its atomic rows; the ledger
  reads each atomic row's own value for its own resistance.

`Elemental` -> Fire/Cold/Lightning and `All` -> every resistance are expanded
**only inside the ledger**, per the prototype.

## Ledger core (pure, tested)

Port the prototype's resolution verbatim into `ledger.ts` as a pure function over
the selected sources and a starting resistance `R0`, per affected resistance:

```
sumStack = Σ |value| over selected stacking sources hitting this resistance
maxMult  = max value over selected multiplicative sources hitting it (single highest)
maxFlat  = max value over selected flat sources hitting it (single highest)
base     = R0 - sumStack
final    = base * (1 - sign(base) * maxMult/100) - maxFlat
```

Order is stack -> mult -> flat; the multiplicative step is sign-aware and cannot
cross zero on its own. The function returns, per resistance, the final value and
the contributing sources (for the ledger's per-resistance breakdown and bar).
Uses **base max-rank values** (overcap excluded), matching the prototype's ledger
note; the table can still surface overcap. Unit tests cover: stacking sums,
single-highest mult/flat, sign-aware mult near zero, Elemental/All expansion, and
a multi-source worked example from the prototype.

## URL state (hash, all view state, full history)

`rr/core/urlState.ts` encodes the entire `ViewState` into the hash and decodes it
back, tolerating stale/malformed links (an undecodable hash is the default view):

- `q` (search text), `fType` (damage type), `fRR` (RR type), `fCat` (category),
  `fPar` (parent), `fTrig` (trigger) - the filter controls.
- `sort` (column key + direction), `group` (none | mastery | constellation | item).
- `sel` - the set of selected logical-source ids for the ledger.
- `r0` - the enemy starting-resistance value.

Selection ids are language-independent (derived from `record_path` + `rr_type`),
so a shared link restores identically across locales. `main.ts` mirrors the
planner's history discipline: render reads from the decoded hash; a view change
computes the next hash and `pushState`s it (or `replaceState` for coalesced bursts
like typing in search); a `hashchange` listener (Back/Forward/bookmark) re-decodes
and re-renders with `replace`. Our own pushState never fires hashchange, so there
is no feedback loop. Locale is never in the hash (viewer preference).

## Internationalization

- **UI copy**: new `rr.*` keys in every `web/src/i18n/app.<locale>.json`, resolved
  via `loc.translate("rr.key", params?)`. Added to the `web/test/appCatalog.test.ts`
  guard so a missing key fails CI. English authored; other locales fall back to
  English per the existing per-key fallback.
- **Source names / parents**: resolved from the per-language game tables
  (`data/i18n/game.<locale>.json`) by the tag keys the dataset carries. Those
  tables currently cover only devotion tags, so `scripts/build_game_tables.py`
  is extended to also collect the tags referenced by `resistance-reduction.json`
  (name + parent), and the tables are rebuilt for all 13 already-extracted
  languages. Unresolved tags fall back to English, then the raw tag, as today.
- The `web/test/i18nBoundary.test.ts` boundary (core returns descriptors, adapters
  resolve) is respected: `rr/core/` returns `Text`/keys, `rr/adapters/` resolve them.

## Pipeline enrichment (small loop-back to sub-project 1)

To make the parent column, its filter, and the group-by meaningful, the pipeline's
`parent` must be the real mastery / constellation / item name, not the skill's own
name (its current placeholder):

- **Item sources**: already the item name (from `attribute_items`).
- **Devotion sources**: the constellation name. Resolve via the devotion linkage
  (the constellation whose skill tree contains the record); may reuse
  `devotions.json` / the devotion records the devotions parser already reads.
- **Class skill/modifier sources**: the mastery name for the record's
  `playerclassNN`, resolved from the class's mastery name tag.

The exact resolution is worked out in the plan; the guard is that
`parent != name` for a representative class skill, devotion, and item source.

## Table, primer, and ledger UI

- **Primer**: the prototype's three-type mechanics explanation and the formula,
  fully localized.
- **Table**: one row per logical source with a resistance list. Columns: source
  (name + parent), category, RR type (badge), damage types, value (base / overcap),
  trigger, duration/CD. **Selection is whole-row click** (not a checkbox column):
  clicking anywhere on a row toggles its ledger selection, selected rows get the
  highlighted `selrow` treatment, and rows are keyboard-accessible (focusable, with
  Enter/Space toggling and `aria-pressed` for state). Our rows carry no other
  interactive element, so a full-row target is unambiguous. Controls: search + the
  five filters + sort (click headers) + a group-by selector (none / mastery /
  constellation / item). **Dropped** (all prototype artifacts of reconciling
  unreliable community sources; we read the source of truth): the `Cite`/src-link
  column, the `Conf.` confidence column, and the `Conflicts` column. Conflict
  behavior is not per-row data - it is determined by `rr_type` (multiplicative and
  flat take the single highest; stacking is additive), explained once in the
  primer and shown live in the ledger (winning source vs. struck-through losers).
  A small marker instead flags the ~41 sources carrying a verify-note.
  **Simplified**: the trigger column shows the coarse classification we have rather
  than the prototype's rich text.
- **Ledger**: the prototype's sidebar - starting-resistance input, per-resistance
  lines with the stack/mult/flat breakdown, the chain, and the comparison bar -
  ported and localized, reading its selection and `R0` from the URL state.

## Build, serve, test wiring

- `bundle.ts`: second entrypoint + HTML rewrite for the RR page.
- `just build`: copy `resistance-reduction.json` and `game.*.json` into
  `dist/resistance-reduction/`; the page loads them relative to itself.
- `just serve` continues to serve `dist/`; the page is at
  `http://localhost:5173/resistance-reduction/`.
- **Tests**: unit tests for `aggregate.ts`, `ledger.ts` (the worked example),
  `filter.ts`, and `urlState.ts` round-trip (encode∘decode = identity over a
  representative `ViewState`); the i18n guard extension; and a headless smoke test
  (extending `web/e2e/smoke.ts` or a sibling) that loads the page, applies a
  filter and ticks a ledger row, and asserts the hash round-trips and the ledger
  recomputes.

## Verification

- `urlState` round-trip and history: a decoded-then-encoded hash is stable; a
  filter/sort/select/r0 change pushes exactly one history entry; Back restores the
  prior view (asserted in the smoke test).
- Ledger math matches the prototype on a shared worked example (unit test).
- No hardcoded strings: the appCatalog guard passes with the new `rr.*` keys; a
  spot check that a source name renders localized (resolves from the game table).
- Shareable: a copied hash restores the exact table view + ledger in a fresh load.

## Open questions to resolve while building (do not change the architecture)

- **Group-by is the optional-polish lever.** If we want to ship sooner, group-by
  can land after the filterable flat table; everything else is core.
- **Cross-page navigation**: the exact header link/affordance between the planner
  and the RR page (a header link is enough; final placement is a UI detail).
- **Mastery/constellation parent resolution** may need a small shared helper if
  the class/devotion name tags are not trivially derivable from the record path.
