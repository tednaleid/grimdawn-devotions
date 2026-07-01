# i18n Phase 1b: game-data tags + gameText Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Stop baking English game text into `data/devotions.json`; the parser preserves the game's tag keys and emits a per-language English table `data/i18n/game.en.json`, and the web resolves constellation/power/pet/weapon text through a new `gameText(tag)` seam, with zero visible change to the English UI.

**Architecture:** `devotions.json` carries `*_tag` references instead of English. The parser emits `data/i18n/game.en.json` (`{tag: text}`, filtered to referenced tags). The web `Localization` port gains `gameText(tag)` resolving against a game table with an English fallback, mirroring `translate`. Built on Phase 1a's seam.

**Tech Stack:** Python 3 (stdlib) parser, TypeScript + Bun web, `just`.

## Global Constraints

- English output byte-for-byte identical to before this phase (pure refactor of where text comes from).
- The parser resolves game tags to English at parse time (it already loads the tag table) but writes the TAG into `devotions.json` and the resolved English into `data/i18n/game.en.json`. It never writes English display text into `devotions.json`.
- Every referenced tag MUST resolve in `game.en.json` (the validator enforces completeness). For a text field with no game tag (a `FileDescription` or stem fallback), the parser synthesizes a stable key and still records the English under it.
- Constellation `id` stays derived from the English name (language independent, URL-stable). Never regenerate ids from localized text.
- `gameText(tag)` fallback chain per tag: active locale game table, then English game table, then the raw tag. Never throws.
- Build green at each task: land parser changes additively first, flip the web to tags, then remove the redundant English fields.
- Regenerate committed data with `just parse` (records + `text_en` are already extracted). Do not run the heavy `just extract`.
- Two `// ABOUTME:` lines on new files; docs have no emojis/emdashes/hyperbole. Run `just check`.

---

### Task 1: Parser emits tags + game.en.json (additive, English kept)

**Files:**
- Modify: `scripts/parse_devotions.py`
- Test: `scripts/test_parse_devotions.py`
- Regenerate (committed): `data/devotions.json`, `data/i18n/game.en.json`

**Interfaces:**
- Produces: `data/i18n/game.en.json` = `{ key: english }`. In `devotions.json`, each translatable field gains a sibling `*_tag` key: constellation `name_tag`; power `name_tag`/`description_tag`; `weapon_requirement.description_tag`; `pet.name_tag`; and `proc.trigger` also gains `proc.trigger_key` (the raw GD enum, e.g. `AttackEnemy`). The existing English fields (`name`, `description`, etc.) are KEPT in this task for backward compatibility; they are removed in Task 5.

- [ ] **Step 1: Write failing parser tests**

Add tests to `scripts/test_parse_devotions.py` (same hand-rolled `check(name, got, want)` harness already in the file). Build a tiny fake tag table and records, or (simpler and consistent with the repo) run the real parse over the extracted tree and assert structural properties. Concretely add checks that, after parsing a constellation:
- the constellation dict has a `name_tag` whose value starts with `tag` OR is a synthesized `x:` key, and `game_en[name_tag] == <english name>`.
- a celestial power has `name_tag` and `description_tag` present, both resolvable in the emitted `game_en` table.
- `proc.trigger_key` holds the raw enum (e.g. `AttackEnemy`) while `proc.trigger` still holds the English word.
Write a helper in the parser (see Step 3) `emit_game_table()` and test it maps every referenced key to a non-empty English string.

- [ ] **Step 2: Run tests to confirm they fail**

Run: `uv run scripts/test_parse_devotions.py`
Expected: FAIL (new assertions reference fields/functions not yet present).

- [ ] **Step 3: Implement the additive tag preservation**

In `scripts/parse_devotions.py`:
- Add a module-level accumulator pattern: a `register(key, text, table)` helper that records `table[key] = clean_text(text)` when `text` is truthy and returns `key`. The `key` is the game tag when one exists, else a synthesized stable key: `f"x:con:{con_id}:name"`, `f"x:pow:{skill_ref}:name"`, `f"x:pow:{skill_ref}:desc"`, etc. (stable across runs).
- Constellation (`parse_constellation`, ~495-565): keep computing English `name` (for `slugify(name)` -> `id`, unchanged). Compute `name_tag = register(name_tag_or_synth, name, game_en)` and add `"name_tag": name_tag` to the output dict. Keep `"name": name`.
- Power (`resolve_power_name` ~452-474 and the celestial_power dict ~436-448): return the tag(s) alongside the English so the caller can `register(...)`. Add `name_tag` and `description_tag` to the `celestial_power` dict; keep `name`/`description`.
- Weapon requirement (`extract_weapon_requirement` ~355-361): add `description_tag` (the `skillBaseDescription` tag) registered with its English; keep `description`.
- Pet (`extract_pet` ~319-352): add `name_tag` (the creature `description` tag) registered with its English; keep `name`.
- Proc (`extract_proc` ~296): add `"trigger_key": trig` (the raw enum) beside the existing `"trigger": TRIGGER_DISPLAY.get(trig, trig)`.
- After parsing all constellations in `main`, write `game_en` to `data/i18n/game.en.json` (create the dir), filtered to only keys referenced by the dataset (it already is, since register is only called on referenced fields). Add a `--game-out` arg defaulting to `data/i18n/game.en.json`.

- [ ] **Step 4: Run tests + regenerate committed data**

Run: `uv run scripts/test_parse_devotions.py` (expect PASS), then `just parse` (regenerates `data/devotions.json` and writes `data/i18n/game.en.json`).
Verify: `data/i18n/game.en.json` exists and is non-empty; `data/devotions.json` now contains `name_tag`/`description_tag`/`trigger_key`; `git diff --stat data/devotions.json` shows the additive change.

- [ ] **Step 5: Commit**

```bash
git add scripts/parse_devotions.py scripts/test_parse_devotions.py data/devotions.json data/i18n/game.en.json
git commit -m "feat(i18n): parser preserves game tags and emits game.en.json (additive)"
```

---

### Task 2: gameText seam (port + resolver + adapter + test helper)

**Files:**
- Modify: `web/src/ports/Localization.ts`, `web/src/core/localization.ts`, `web/src/adapters/localizationAdapter.ts`, `web/test/helpers/localizeEn.ts`
- Test: `web/test/localization.test.ts`, `web/test/localizationAdapter.test.ts`

**Interfaces:**
- Produces: `Localization` gains `gameText(tag: string): string`. `makeLocalization(appActive, appFallback, locale, gameActive?, gameFallback?)` (game maps optional, default `{}`). Module singleton exports `gameText(tag)` (returns the tag itself before install). `loadLocalization` also fetches `${base}/data/i18n/game.<locale>.json` and `game.en.json` and passes them in. `installEnglish()` also loads `data/i18n/game.en.json` and installs it as both game maps.

- [ ] **Step 1: Write failing tests**

In `web/test/localization.test.ts` add: `gameText` resolves active game map, then English game map, then the raw tag; before install, the singleton `gameText("tagX")` returns `"tagX"`. In `web/test/localizationAdapter.test.ts` extend the fake-fetch map so `loadLocalization` also loads `data/i18n/game.en.json` and `gameText` resolves an entry.

- [ ] **Step 2: Run to confirm fail**

Run: `cd web && bun test test/localization.test.ts test/localizationAdapter.test.ts`  Expected: FAIL.

- [ ] **Step 3: Implement**

- `ports/Localization.ts`: add `gameText(tag: string): string`.
- `core/localization.ts`: extend `makeLocalization` to accept optional `gameActive`/`gameFallback` (default `{}`), implement `gameText(tag) = gameActive[tag] ?? gameFallback[tag] ?? tag`. Add module singleton `gameText(tag)` delegating to `current` (returns `tag` if not installed).
- `adapters/localizationAdapter.ts`: fetch `${base}/data/i18n/game.en.json` and (if locale != en) `game.<locale>.json`, degrade to `{}` on failure; pass into `makeLocalization`.
- `test/helpers/localizeEn.ts`: import `data/i18n/game.en.json` and install it as both game maps alongside the app catalog.

- [ ] **Step 4: Run to confirm pass**

Run: `cd web && bun test`  Expected: PASS (existing suite still green; game maps default empty so nothing else changes yet).

- [ ] **Step 5: Commit**

```bash
git add web/src/ports/Localization.ts web/src/core/localization.ts web/src/adapters/localizationAdapter.ts web/test/helpers/localizeEn.ts web/test/localization.test.ts web/test/localizationAdapter.test.ts
git commit -m "feat(i18n): add gameText resolution to the localization seam"
```

---

### Task 3: Model carries tags + views resolve game text

**Files:**
- Modify: `web/src/core/model.ts`, `web/src/core/types.ts`, `web/src/adapters/tooltipView.ts`, `web/src/adapters/sidebarView.ts`, `web/src/adapters/buildOrderView.ts`, `web/src/adapters/svgRenderer.ts` (if it renders constellation/power text), `web/src/i18n/app.en.json`, `web/test/appCatalog.test.ts`
- Test: touch affected view/model tests

**Interfaces:**
- Consumes: `gameText` (Task 2), the `*_tag` fields (Task 1).
- Produces: model types gain `nameTag`, `descriptionTag`, pet `nameTag`, weaponRequirement `descriptionTag`, proc `triggerKey`. Views render display text via `gameText(...)`. Constellation/power/pet/weapon English display now flows from `game.en.json`.

- [ ] **Step 1: Write/adjust failing tests**

Model test (`web/test/model.test.ts`) asserts English names today (e.g. "Leviathan"). Change those assertions to resolve through `gameText` (call `installEnglish()` then assert `gameText(model.constellations.get(id).nameTag) === "Leviathan"`), OR assert the `nameTag` value. The tooltip/sidebar tests that assert power/constellation names must `installEnglish()` (which now loads the game table) and keep asserting the same English strings — those strings now resolve via `gameText`. Add proc trigger keys `trigger.<enum>` to `app.en.json` and REQUIRED (values equal the old `TRIGGER_DISPLAY` English, e.g. `"trigger.AttackEnemy": "Attack"`).

- [ ] **Step 2: Run to confirm fail**

Run: `cd web && bun test`  Expected: FAIL on the newly-adjusted assertions / missing model fields.

- [ ] **Step 3: Implement**

- `model.ts`/`types.ts`: add the `*Tag` fields to `RawStar`/`RawConstellation` and the model interfaces; map them through `buildModel`. Keep the existing English fields readable for now (Task 5 removes them from data; the model can stop copying them once views no longer use them — prefer stopping now, reading only tags).
- Views: replace `con.name` -> `gameText(con.nameTag)`, `power.name` -> `gameText(power.nameTag)`, `power.description` -> `gameText(power.descriptionTag)` (guard null), `weaponRequirement.description` -> `gameText(...descriptionTag)`, `pet.name` -> `gameText(pet.nameTag)`, and the proc trigger -> `translate("trigger." + power.proc.triggerKey)`. Sites: `tooltipView.ts:78,86,152,170`, `sidebarView.ts:18-19` (sort + list), `buildOrderView.ts` (constellation names), `svgRenderer.ts` (if it draws names), `statFormat.ts:493` pet name, `aggregate.ts:169` weapon description passthrough (it stores the description for the tooltip; switch to storing/forwarding the tag or resolving at render — keep the resolution in the view, forward the tag).
- Do all `gameText`/`translate` at render time (no module-load capture).

- [ ] **Step 4: Run to confirm pass + English identical**

Run: `cd web && bun test && bunx tsc --noEmit`  Expected: PASS with the same English strings.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/model.ts web/src/core/types.ts web/src/adapters/ web/src/core/statFormat.ts web/src/core/aggregate.ts web/src/i18n/app.en.json web/test/
git commit -m "feat(i18n): model carries tags; views resolve game text via gameText"
```

---

### Task 4: Ship game tables in the build

**Files:**
- Modify: `justfile` (the `build` recipe)

**Interfaces:**
- Produces: `data/i18n/game.<locale>.json` is copied to `web/dist/data/i18n/` so the adapter can fetch it at runtime.

- [ ] **Step 1: Add the copy**

In the `build` recipe, next to the `cp .../data/devotions.json dist/data/...` lines, add: `mkdir -p dist/data/i18n && cp "{{justfile_directory()}}/data/i18n/"*.json dist/data/i18n/`.

- [ ] **Step 2: Verify**

Run: `just build`  Expected: `web/dist/data/i18n/game.en.json` exists.

- [ ] **Step 3: Commit**

```bash
git add justfile
git commit -m "build(i18n): ship data/i18n game tables to dist"
```

---

### Task 5: Parser cleanup + validator inversion + regenerate

**Files:**
- Modify: `scripts/parse_devotions.py`, `scripts/test_parse_devotions.py`
- Regenerate: `data/devotions.json`

**Interfaces:**
- Produces: `devotions.json` no longer contains the English display fields (`name`, power `name`/`description`, weapon `description`, pet `name`, `proc.trigger`) - only the `*_tag`/`*_key` references remain (plus structural fields and the English-derived `id`). The validator asserts every referenced tag resolves in `game.en.json` instead of erroring on leaked `tag...`.

- [ ] **Step 1: Adjust tests**

Update `scripts/test_parse_devotions.py`: assert the English display fields are ABSENT from the constellation/power dicts, and add a validator test that a referenced tag missing from `game_en` is reported as an error (completeness), while a present one is OK.

- [ ] **Step 2: Run to confirm fail**

Run: `uv run scripts/test_parse_devotions.py`  Expected: FAIL (fields still present; validator not inverted).

- [ ] **Step 3: Implement**

Remove the English fields from the output dicts (keep computing English internally only for `id` slug and for the `game_en` table). Invert `validate` (~589-659): drop the "leaking tag" counter; instead iterate every referenced `*_tag`/key and assert it exists in `game_en`, counting misses as the error. Keep the report line format style.

- [ ] **Step 4: Run + regenerate**

Run: `uv run scripts/test_parse_devotions.py` (PASS), then `just parse`. Then `cd web && bun test` to confirm the web (already on tags) is still green against the slimmed data.

- [ ] **Step 5: Commit**

```bash
git add scripts/parse_devotions.py scripts/test_parse_devotions.py data/devotions.json
git commit -m "feat(i18n): drop baked English from devotions.json; validator checks tag completeness"
```

---

### Task 6: Verify + docs

**Files:**
- Modify: `docs/i18n.md`, `docs/dbr-format.md` (if it describes the output shape), `README.md` (if it documents the `devotions.json` schema)

- [ ] **Step 1: Full gate**

Run: `just check`  Expected: green.

- [ ] **Step 2: Update docs**

`docs/i18n.md`: mark game-data text as now resolved via `gameText` from `data/i18n/game.<locale>.json` (Phase 1b done). Update `README.md`/`docs/dbr-format.md` where they describe `devotions.json` holding names/descriptions to note the `*_tag` references + the `game.en.json` table. Keep evergreen; no emdashes/emojis.

- [ ] **Step 3: Commit**

```bash
git add docs/i18n.md docs/dbr-format.md README.md
git commit -m "docs(i18n): document game-tag references and game.en.json (phase 1b)"
```

---

## Self-Review

- Parser preserves tags + emits game.en.json: Tasks 1, 5. English-derived id kept: Task 1 Step 3. Validator inversion: Task 5.
- gameText seam + English fallback: Task 2. Views resolve game text: Task 3. Trigger localized: Task 3. Build ships tables: Task 4.
- Racial targets: unchanged (already app-catalogued via `stat.race.*` in Phase 1a) - intentionally out of scope.
- Build-green sequencing: additive parser (T1) -> web flip (T2-3) -> parser cleanup (T5). Every task commits green.
- English byte-identity gate: the view/model tests assert the same English strings, now resolved via gameText/game.en.json.
- Placeholder scan: none. Type consistency: `gameText`, `makeLocalization` extended signature, `*Tag` field names consistent across Tasks 2-3.
