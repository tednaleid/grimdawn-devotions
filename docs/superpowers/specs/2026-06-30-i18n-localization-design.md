# Internationalization (i18n): localizing the devotion planner

Date: 2026-06-30
Status: Approved (design)

## Problem

The planner is English only. A Crate forum request asked about support for other
languages. Grim Dawn itself ships 13 languages, so most of the planner's text can
be localized authoritatively from the game's own translations rather than authored
by us.

Text in the planner comes from two separate sources, and they need different
strategies:

1. **Game data** (constellation names, celestial power names and descriptions,
   racial targets, weapon requirements, pet names). The game stores these as tag
   keys (for example `tagDevotion_A01`) and resolves them against a per-language
   text table (`Text_XX.arc` extracted to `tags_*.txt` lines of `tag=Display
   Text`). The parser (`scripts/parse_devotions.py`) resolves those tags to English
   at parse time and bakes English into `data/devotions.json`, discarding the tag
   keys. The validator even treats a surviving `tag...` string as an error. So the
   committed dataset cannot be re-localized after the fact: the localization keys
   are gone.

2. **App-owned text** (no game source). Two kinds:
   - UI chrome, roughly 60 strings across `web/index.html`, `main.ts`,
     `sidebarView.ts`, `tooltipView.ts`, `buildOrderView.ts`, `commitAction.ts`,
     `benefitRows.ts` (for example "Benefits", "Build order", "have"/"need",
     "Reset", "Loading the devotion map...").
   - `web/src/core/statFormat.ts`, roughly 150 strings that are the app's own
     English names for the game's internal stat ids (for example "Physique",
     "Cunning", "Frostburn", "Armor Absorption"), plus section headers and
     editorial groupings.

## Goals

- Robust i18n where every user-facing string is treated as translatable: tags in
  the data, keys in the app, resolved through a single seam with an English
  fallback.
- Preserve the hexagonal architecture: `core/` stays language independent; only
  rendering adapters resolve to display text, through an injected port.
- Source translations authoritatively. Where the game has a term, use the game's
  own translation (look it up, do not guess). Author only what the app itself adds
  and has no game source for. Fall back to English when a translation is missing.
- Support all 13 languages the install ships; partial coverage is fine because of
  the fallback.

## Non-goals (backlog, not built here)

- A visible language picker. v1 auto-detects from the browser. Adding a picker
  later is non-breaking because locale is not in the URL hash.
- ICU-style plural rules. v1 uses simple named-placeholder interpolation. Plural
  handling is added narrowly only if a target language needs it.
- Game-tag sourcing for stat labels that the spike finds have no clean tag. Those
  use authored fallback in v1; upgrading them later does not touch the
  architecture.

## Decisions

| Topic | Decision |
| --- | --- |
| Data sourcing | Preserve tags/keys and resolve through a port against per-language string tables. Same mechanism for game data and app strings. English is the fallback. (Rejected: baking one fully resolved JSON per language.) |
| Translation source | Game text extracted from the game's own `Text_XX.arc` (authoritative). App-added strings authored by us. English fallback when missing. |
| Stat labels | Map the app's internal stat ids to game tags where a clean tag exists (resolved from the game table, authoritative across all languages), gated on a spike. Author section headers, editorial composites, and any stat the spike finds unmappable. |
| Locale in URL hash | No. Locale is a viewer preference. A shared build link renders in each viewer's language. Selection ids in the hash stay language independent. |
| Locale selection | Auto-detect from `navigator.languages` (ordered), first shipped match, else English. No picker in v1. |
| Languages | All 13 in the install. Fallback covers gaps. |

## Available languages

The install ships these as official Steam content in
`<GD>/resources/Text_XX.arc`: EN (base), CS, DE, ES, FR, IT, JA, KO, PL, PT, RU,
VI, ZH. Non-English packs are a single consolidated `resources/Text_XX.arc`
covering base plus expansions; only `Text_EN.arc` is split across `gdx1`/`gdx2`.
Some packs may lag on expansion devotion content; the per-tag English fallback
covers any gap.

## Design

### 1. The seam: one Localization port

`core/` remains language independent (ids and tags only). Rendering adapters
resolve to text through a single injected port, wired in `main.ts` like the
existing data and wasm ports.

```ts
// web/src/ports/Localization.ts
interface Localization {
  translate(key: string, params?: Record<string, string | number>): string  // app-authored
  gameText(tag: string): string                                              // extracted game text
  locale: string
}
```

Names are spelled out (`translate`, `gameText`), not the i18n-conventional `t()`,
to avoid abbreviations.

Resolution is a per-key fallback chain: active locale, then English, then the raw
key or tag. It never returns blank and never throws, so a partially translated
language or a stale link degrades to English (worst case a visible key), never a
broken UI.

Call patterns:

- App strings: `translate('ui.panel.benefits')`
- Game text: `gameText('tagDevotion_A01')`
- Stat labels: `statFormat` looks the stat id up in the stat-tag map; if mapped,
  `gameText(tag)`; if not, `translate('stat.<key>')`.

### 2. Data pipeline (parser and extraction)

Three committed artifacts instead of one:

1. `data/devotions.json` becomes language independent. Translatable fields hold a
   tag reference with an explicit `_tag` suffix so a value is never mistaken for
   display text:
   - constellation `name` becomes `name_tag`
   - power `name`/`description` become `name_tag`/`description_tag`
   - `racial_target` becomes race tags
   - `weapon_requirement.description` becomes its tag
   - `pet.name` becomes its tag

   Structural fields (tiers, costs, positions, raw stat ids, affinity) are
   unchanged. `proc.trigger` moves from today's baked English (`TRIGGER_DISPLAY`)
   to an app-catalog key, since it is app-owned vocabulary (a fixed set of roughly
   10).

   `id` stays English derived and stable. The parser still extracts English, so
   the id remains the slug of the English name. It must never be regenerated from a
   localized name, or shared URLs break.

2. `data/i18n/game.<lang>.json`, a `{ tag: text }` table per language, filtered to
   only the tags the dataset references. Filtering keeps each table to a few
   hundred entries instead of the game's full text file. All 13 are committed.
   Extraction is Windows only (Crate's ArchiveTool), but the committed outputs
   build anywhere, as today.

3. `data/stat-tags.json`, a curated stat-id to game-tag map, language independent,
   populated from the spike.

Extraction (`just extract`) discovers languages by globbing `resources/Text_*.arc`
and extracts each; non-English is the single consolidated `Text_XX.arc`.

The validator inverts. Today it errors on a surviving `tag...`. Now tags are
expected, so it asserts every referenced tag resolves in the English table
(completeness). Other languages may be partial; the validator reports coverage
rather than failing.

### 3. Web (resolution, statFormat, locale, fallback)

A new adapter (`web/src/adapters/localizationAdapter.ts`) builds the port by
fetching, for the active locale, four small bundles: authored `app.<lang>.json`
and `app.en.json` (fallback), and extracted `game.<lang>.json` and `game.en.json`
(fallback). English is always loaded so every key has a fallback. Authored
`app.*.json` catalogs live in `web/` as versioned source (English is the source of
truth for which keys exist); `game.*` tables come from `data/`.

`statFormat.ts` refactor: its English literals move into `app.en.json`. What
remains is logic and keys. For a stat id it consults `stat-tags.json`; mapped
resolves via `gameText(tag)`, unmapped via `translate('stat.<key>')`. The `humanize()`
heuristic stays as the last English fallback for a stat id that is neither mapped
nor catalogued, so a brand-new game stat still shows a readable English label
rather than a raw id.

Every rendering adapter (`sidebarView`, `tooltipView`, `buildOrderView`,
`main.ts`, `commitAction`, `benefitRows`) calls the port instead of literals. The
pre-bundle boot strings in `index.html` ("Loading the devotion map...", "Couldn't
load the planner.") render before any bundle loads and stay English; everything
after boot is localized.

Interpolation uses named placeholders, for example `"{count} used"` and `"Needs
{needs} of your {cap} points"`. No ICU plural machinery in v1.

Locale detection reads `navigator.languages` (ordered) and picks the first entry
that matches a shipped locale, else English. No picker in v1. Locale is not in the
URL hash. Because all real state is in the hash and language independent, a future
language switch just swaps bundles and re-renders the current selection.

Error handling is the fallback chain end to end: missing app key resolves to
English then a visible key; missing game tag resolves to English (guaranteed
present by the validator) then a raw tag only in a truly broken build.

### 4. Looking up game terms (the stat spike)

For the named stats (damage types, attributes, resistances), we ship the game's
own translation, not an authored guess. The spike establishes the mapping:

1. Extract `Text_EN.arc` and `Text_ES.arc`.
2. Take the roughly 40 devotion-relevant internal stat ids.
3. Find each one's game tag and confirm it resolves in both languages.

Output is a concrete split: stats that map cleanly go into `data/stat-tags.json`;
stats with no clean tag use authored fallback. If the spike shows the mapping is
messier than hoped, those stats are authored and the architecture is unchanged.
The spike runs early, right after the port lands.

Example of the intended result: "Frostburn" is a real in-game term. The spike
finds its tag, the tag goes in `stat-tags.json`, and `gameText(tag)` then pulls
the exact Spanish, German, Russian, and so on from each extracted table. An
authored draft is only the last-resort fallback for a term the spike cannot map.

## Phasing

This is a large change, landed in regression-safe increments:

1. **Foundation, English only, no visible change.** Port and adapter, parser
   tag-preservation, extraction wired for languages, `game.en.json` and
   `app.en.json` emitted, all views calling the port. Success criterion: an English
   user sees a pixel-identical app. This proves the round-trip before any second
   language exists.
2. **Spike and stat-tag map.** Populate `stat-tags.json`; wire the statFormat
   lookup.
3. **Languages light up.** Extract `game.<lang>.json` for all 13; author the
   `app.<lang>.json` catalogs. Each language appears as its bundles land; partial
   coverage falls back.

## Testing

- Parser: tags preserved (no baked English survives), per-language tables filtered
  to referenced tags, English table complete (the inverted validator), ids stay
  English derived and stable.
- Web: the fallback chain (active, then English, then key); named interpolation;
  statFormat resolves via the map then falls back; a guard test that every app key
  referenced in code exists in `app.en.json` (catches missing keys in CI, not at
  runtime); URL-state ids are language independent.
- Manual: exercise auto-detect by reordering browser language settings. Automated
  tests inject a resolved locale into the port and do not touch the browser.

## Documentation

- Add an i18n invariant to `CLAUDE.md`: no hardcoded user-facing strings; game text
  is authoritative from extraction; app strings are authored with an English
  fallback; ids and URL state stay language independent.
- New evergreen `docs/i18n.md` describing the system: the port, the three
  artifacts, the fallback chain, and how to add a language.

## Affected files (for planning)

- `scripts/parse_devotions.py`: preserve tags, emit filtered per-language game
  tables, keep English-derived ids, invert the validator.
- `justfile`: extract every `resources/Text_*.arc`.
- `data/devotions.json`: schema change (tag references).
- `data/i18n/game.<lang>.json` (new), `data/stat-tags.json` (new).
- `web/src/ports/Localization.ts` (new), `web/src/adapters/localizationAdapter.ts`
  (new), `web/src/i18n/app.<lang>.json` (new).
- `web/src/core/statFormat.ts`: move literals to catalog, resolve via port.
- `web/src/app/main.ts`: wire the port, detect locale.
- `web/index.html`, `web/src/adapters/sidebarView.ts`, `tooltipView.ts`,
  `buildOrderView.ts`, `web/src/core/commitAction.ts`, `benefitRows.ts`: call the
  port.
- `CLAUDE.md`, `docs/i18n.md`, `BACKLOG.md` (picker, ICU plurals, unmappable-stat
  upgrades).
