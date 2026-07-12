# Header info popover (game version, GitHub link, description)

Point-in-time design record. The planner shows no provenance today: nothing says
which game version the data was extracted from, what the site is, or where the
source lives. This adds a small (i) button to the header that opens a popover
with exactly that, and nothing else.

## Goal

An (i) icon button in the header. Clicking or tapping it opens a small popover
containing three lines:

1. A succinct description of the planner ("A fan-made build planner for Grim
   Dawn's devotion system").
2. The game data provenance: "Game data: v1.2.1.x (extracted 2026-07-01)", with
   both values read from the dataset at runtime, never hardcoded.
3. A "View on GitHub" link to https://github.com/tednaleid/grimdawn-devotions
   opening in a new tab.

Escape and outside-click dismiss it. It behaves like the existing language
picker, the established pattern for header chrome.

## Data

`data/devotions.json` already carries a `meta` block stamped by the parser:
`game_version` ("1.2.1.x"), `generated_utc` ("2026-07-01T05:46:25Z"), and
others. None of it reaches the app today.

`httpDataSource.load()` (web/src/adapters/httpDataSource.ts) additionally
returns `meta: { gameVersion: string; generatedUtc: string }`, read from the
JSON it already fetches. Missing fields fall back to empty strings so a stale
or hand-built dataset cannot break boot; the popover omits the parenthetical
date (or the whole game-data line) when the value is empty. No model, engine,
or URL-state changes: this is viewer chrome, like the locale.

The extract date shown is the date portion of `generated_utc` (YYYY-MM-DD), cut
from the string rather than run through Date formatting, so it is stable and
timezone-free.

## Adapter

New `web/src/adapters/infoPopover.ts`, a pure DOM adapter mirroring
`languagePicker.ts` (mount into the header element, return a handle with a
re-label method for language switches):

- The button renders a circled-i glyph, carries `aria-label` (from the catalog),
  `aria-expanded`, and `aria-haspopup="true"`.
- The popover is a positioned panel under the button with the three lines. The
  GitHub link uses `target="_blank" rel="noopener"`.
- Toggle on click; dismiss on Escape, on outside pointerdown, and on selecting
  the link. Only one of the header popovers (language picker, info) needs to be
  open at a time, but no coordination is required beyond each dismissing on
  outside interaction, which both already do.
- Placement: immediately left of the language picker globe, right-aligned in
  the header.

`web/src/app/main.ts` mounts it at boot with the meta values and the GitHub
URL (a constant in main.ts; a repository URL is configuration, not translatable
text), and re-applies the localized strings on language switch alongside
`applyChrome`.

## Internationalization

Five new catalog keys in `web/src/i18n/app.en.json` and all 12 other locale
files, plus entries in the `REQUIRED` list of `web/test/appCatalog.test.ts`:

- `ui.info.aria` - the button's accessible label ("About this planner").
- `ui.info.description` - the one-line description.
- `ui.info.gameData` - "Game data: v{version} (extracted {date})".
- `ui.info.gameDataNoDate` - "Game data: v{version}", used when the dataset
  carries no extraction timestamp, so the no-date fallback never needs string
  surgery on a translated value.
- `ui.info.github` - "View on GitHub".

The version and date are parameters, never baked into the strings. The glyph on
the button is a symbol, not text, following the cap-toggle precedent.

## Testing

- Adapter unit test (new `web/test/infoPopover.test.ts`, following the
  languagePicker test pattern): the pure content helper renders the three
  lines with the given text, the correct href with `target`/`rel`, omits the
  game-data line when null, and escapes text. The DOM mount is thin glue
  verified in the browser, the same convention the language picker test
  documents (the test suite has no DOM harness).
- Data test: the meta mapping falls back to empty strings on absent or
  partial `meta`, and reads the real dataset's values.
- `appCatalog` guard covers the five keys and their placeholder sets across
  locales.
- Browser check via `just serve`: toggle, Escape and outside-click dismiss,
  link href, and re-rendered text after a language switch.

## Non-goals

- No steam buildid or extraction-path display (available in meta, deliberately
  omitted for succinctness).
- No URL-state, engine, model, or parser changes.
- No footer, changelog, or help content beyond the three lines.
