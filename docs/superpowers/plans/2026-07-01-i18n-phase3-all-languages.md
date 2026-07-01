# i18n Phase 3: all languages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Light up the 11 additional languages the game ships and the planner can extract (DE, FR, RU, ZH, PL, IT, CS, JA, KO, PT, VI), by building their game tables, authoring their app catalogs, and turning them on in locale detection. English stays the default and the universal fallback.

**Architecture:** For each language, `build_game_tables.py` (Phase 2) emits `data/i18n/game.<lang>.json` from the extracted `Text_<LANG>.arc`; an authored `web/src/i18n/app.<lang>.json` carries the app-owned strings; `loadLocalization` includes the language in its available set and picks it from `navigator.languages`. Missing keys/tags fall back to English per key.

**Tech Stack:** TypeScript + Bun web, Python builder, `just`, ArchiveTool (Windows).

## Global Constraints

- English (`en`) stays the default and the per-key fallback everywhere. No English output changes.
- Locale is a viewer preference from `navigator.languages`; never in the URL hash. Selection ids stay language independent.
- A missing app key or game tag in a language falls back to English (never blank, never a raw key/tag). The `translate` resolver must treat an empty-string catalog value as ABSENT (fall back to English) - this is the Phase-3 blocker fixed in Task 1.
- Languages in scope: `de fr ru zh pl it cs ja ko pt vi` (plus `en`). `es` is EXCLUDED: `Text_ES.arc` is unreadable by ArchiveTool on the current machine. Note it in BACKLOG for later (Steam verify integrity, then add).
- ArchiveTool must be invoked with `< /dev/null` (it blocks on stdin otherwise); output lands at `<outdir>/text_<lang>/*.txt`.
- App-catalog translations preserve `{placeholder}` tokens exactly and keep the same keys as `app.en.json`. The 36 game-sourced stat keys (attr/damage/dot/resist) need NOT be translated (resolved via `gameText`); other app strings should be.
- Two `// ABOUTME:` lines on new source files; docs evergreen, no emojis/emdashes/hyperbole. Run `just check`.

---

### Task 1: Fix the empty-value fallback (Phase-3 blocker)

**Files:**
- Modify: `web/src/core/localization.ts`
- Test: `web/test/localization.test.ts`

**Interfaces:**
- Produces: `translate`/`gameText` treat an empty-string catalog/game value as ABSENT and fall back (active empty -> English -> key/tag). No signature change.

- [ ] **Step 1: Write failing tests** — in `localization.test.ts`: a `makeLocalization` where the ACTIVE app catalog has `"ui.x": ""` but the fallback has `"ui.x": "Hello"` resolves `translate("ui.x")` to `"Hello"` (not `""`). Same for `gameText` with an empty active game value. And an empty value in BOTH active and fallback resolves to the key/tag (never `""`).

- [ ] **Step 2: Run to confirm fail** — `cd web && bun test test/localization.test.ts` (the current `?? ` chain returns `""`).

- [ ] **Step 3: Implement** — change the resolution so empty strings are skipped: e.g. `const v = active[key]; return (v !== undefined && v !== "") ? v : (fb !== undefined && fb !== "" ? fb : key)` (or a small `firstNonEmpty` helper used by both `translate` and `gameText`). Keep it clean and shared.

- [ ] **Step 4: Run to confirm pass + full suite** — `cd web && bun test` (all green; existing behavior unchanged for non-empty values).

- [ ] **Step 5: Commit** — `git add web/src/core/localization.ts web/test/localization.test.ts` ; `git commit -m "fix(i18n): treat empty catalog value as absent, fall back to english"`.

---

### Task 2: Build the 11 game tables

**Files:**
- Modify: `justfile` (add an `i18n-tables` recipe)
- Create (committed): `data/i18n/game.<lang>.json` for the 11 languages

**Interfaces:**
- Produces: `just i18n-tables` extracts each in-scope `Text_<LANG>.arc` to a temp dir and runs `build_game_tables.py` to write `data/i18n/game.<lang>.json` (Windows-only, like `extract`; the committed outputs build anywhere).

- [ ] **Step 1: Add the recipe**

Add to `justfile` (bash recipe, match style):
```
# Extract each shipped language's Text_<LANG>.arc and build its game.<lang>.json (Windows-only; ArchiveTool)
i18n-tables:
    #!/usr/bin/env bash
    set -euo pipefail
    GD="{{gd_dir}}"
    AT="$GD/ArchiveTool.exe"
    for L in de fr ru zh pl it cs ja ko pt vi; do
      U=$(echo "$L" | tr '[:lower:]' '[:upper:]')
      arc="$GD/resources/Text_$U.arc"
      [ -f "$arc" ] || { echo "skip $L (no $arc)"; continue; }
      tmp="{{justfile_directory()}}/extracted/text_$L"
      rm -rf "$tmp" && mkdir -p "$tmp"
      echo "extracting $U ..."
      "$AT" "$arc" -extract "$tmp" < /dev/null >/dev/null
      uv run scripts/build_game_tables.py --devotions data/devotions.json --stat-tags data/stat-tags.json \
        --text-dir "$tmp/text_$L" --lang "$L" --out "data/i18n/game.$L.json"
    done
    echo "built game tables for all in-scope languages"
```
(Note: `extracted/` is gitignored; the `data/i18n/game.<lang>.json` outputs are committed. `< /dev/null` is required.)

- [ ] **Step 2: Run it** — `just i18n-tables`. Confirm 11 `data/i18n/game.<lang>.json` files were created, each non-trivially populated (a few hundred entries; some tags may be omitted where a language lacks them - that is expected, English fallback covers them). Print per-language resolved/omitted counts.

- [ ] **Step 3: Sanity-check** — spot-check that e.g. `game.de.json` has real German for a known devotion tag (constellation name) and a stat tag, and that `game.<lang>.json` keys are a subset of `game.en.json` keys.

- [ ] **Step 4: Commit** — `git add justfile data/i18n/game.*.json` ; `git commit -m "feat(i18n): build game tables for 11 languages"`.

---

### Task 3: Author the 11 app catalogs (controller fan-out)

**Files:**
- Create: `web/src/i18n/app.<lang>.json` for the 11 languages
- Test: `web/test/appCatalog.test.ts` (add a structural completeness/validity check)

**Note for the controller:** execute this task as a parallel fan-out of one authoring subagent per language (each translates `app.en.json` into `app.<lang>.json`), then a single completeness/validity check. Each subagent's contract:
- Keep the EXACT same keys as `app.en.json` (may omit the 36 game-sourced stat keys `stat.attr.*`/`stat.damage.*`/`stat.dot.*`/`stat.resist.*` since those resolve via `gameText`; translate everything else, especially `ui.*`, `trigger.*`, `aff.*`, `stat.group.*`, `stat.override.*`, `stat.subject.*`, `stat.template.*`, `stat.race.*`, `stat.power.*`, `stat.pet.*`).
- Preserve every `{placeholder}` token verbatim.
- Use natural, idiomatic translations; where Grim Dawn has an established term (affinity names, "Devotion", stat concepts), prefer it.
- Output valid JSON, two-space indented, sorted keys, UTF-8.

- [ ] **Step 1: Author each `app.<lang>.json`** (11 subagents, one per language).

- [ ] **Step 2: Add a validity/coverage test** to `web/test/appCatalog.test.ts`: for each shipped non-English locale, `app.<lang>.json` parses as an object, every key it contains is also a key in `app.en.json` (no stray keys), and every `{placeholder}` present in the English value for a translated key is also present in the translation (catch dropped params). Missing keys are ALLOWED (English fallback), stray keys or dropped placeholders are FAILURES.

- [ ] **Step 3: Run** — `cd web && bun test && bunx tsc --noEmit` (green).

- [ ] **Step 4: Commit** — `git add web/src/i18n/app.*.json web/test/appCatalog.test.ts` ; `git commit -m "feat(i18n): author app catalogs for 11 languages"`.

---

### Task 4: Turn the languages on + ship

**Files:**
- Modify: `web/src/adapters/localizationAdapter.ts` (the available-locale set), `web/src/app/main.ts` (pass the available set), `justfile` (build already copies `data/i18n/*.json` and `web/src/i18n/`; confirm all ship)
- Test: `web/test/localizationAdapter.test.ts`

**Interfaces:**
- Produces: `loadLocalization` default `available` = `["en","de","fr","ru","zh","pl","it","cs","ja","ko","pt","vi"]`; `main.ts` calls it with that set (or the adapter defaults to it). Detection picks the first `navigator.languages` entry that matches.

- [ ] **Step 1: Write failing test** — extend `localizationAdapter.test.ts`: with `available` including `de` and `preferred: ["de"]`, `loadLocalization` fetches `app.de.json` + `game.de.json` and resolves a German app key and a German game tag through the port (inject the fake fetch with those files).

- [ ] **Step 2: Run to confirm fail** — `cd web && bun test test/localizationAdapter.test.ts`.

- [ ] **Step 3: Implement** — set the 12-locale available set as the default in `loadLocalization` (and/or pass it from `main.ts`). Nothing else changes (fetch/degrade already handle per-locale files).

- [ ] **Step 4: Confirm ship** — `just build`; confirm `web/dist/i18n/app.de.json` and `web/dist/data/i18n/game.de.json` exist. (The build already copies `web/src/i18n` -> `dist/i18n` and `data/i18n/*.json` -> `dist/data/i18n`.)

- [ ] **Step 5: Run + commit** — `cd web && bun test && bunx tsc --noEmit`; `git add web/src/adapters/localizationAdapter.ts web/src/app/main.ts web/test/localizationAdapter.test.ts` ; `git commit -m "feat(i18n): enable 12 locales in detection and loading"`.

---

### Task 5: Verify + docs + backlog

**Files:**
- Modify: `docs/i18n.md`, `BACKLOG.md`, `CLAUDE.md` (only if the invariant wording needs updating)

- [ ] **Step 1: Full gate** — `just check` (green).

- [ ] **Step 2: Manual smoke (optional, controller/human)** — `just serve`, set the browser language to German, confirm the app renders German chrome + German constellation/power names, and English for anything untranslated. (Automated tests already cover resolution; this is a confidence check.)

- [ ] **Step 3: Docs** — `docs/i18n.md`: list the supported locales (12), how detection works, that game tables are built by `just i18n-tables` and app catalogs are authored under `web/src/i18n/`; mark Phase 3 done. `BACKLOG.md`: fix the stale "Phase 1b" status bullet; record that `es` awaits a `Text_ES.arc` repair (Steam verify integrity) + a rerun of `just i18n-tables` and an authored `app.es.json`; note app-catalog translations are LLM-authored and welcome community correction (per-language PRs).

- [ ] **Step 4: Commit** — `git add docs/i18n.md BACKLOG.md CLAUDE.md` ; `git commit -m "docs(i18n): document the 12 supported locales (phase 3)"`.

---

## Self-Review

- Empty-value fallback blocker fixed with tests: Task 1.
- 11 game tables built from extraction, committed, English-subset: Task 2.
- 11 app catalogs authored, placeholders preserved, structural test guards stray keys/dropped params: Task 3.
- Locale set enabled + detection + ship, with a resolution test: Task 4.
- Docs/backlog, es deferral, community-correction note: Task 5.
- English default + per-key fallback preserved throughout; es excluded with a clear path to add later.
- Placeholder scan: none. Type consistency: available-locale array consistent across Task 4 sites.
