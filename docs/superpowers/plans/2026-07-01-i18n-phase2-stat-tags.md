# i18n Phase 2: stat-tag mapping + game-table builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Source the app's high-frequency stat names (attributes, damage types, resistances, and other clean matches) from the game's own translation tags, so they become authoritative across languages, WITHOUT changing the English the app shows today.

**Architecture:** A curated `data/stat-tags.json` maps a stat catalog key to a game tag. A language-independent `scripts/build_game_tables.py` emits `data/i18n/game.<lang>.json` for the union of (devotion `*_tag` references from `devotions.json`) + (stat tags from `stat-tags.json`), resolved against an extracted text dir. `statFormat` resolves a mapped stat via `gameText(tag)`, else `translate(key)`. Built on Phase 1b's `gameText` seam.

**Tech Stack:** Python 3 (stdlib) build script, TypeScript + Bun web, `just`. Game extraction via Crate's ArchiveTool (Windows).

## Global Constraints

- English output byte-for-byte identical. A stat key is mapped to a tag ONLY when the tag's cleaned English in `extracted/text_en` EXACTLY equals the app catalog's current English value for that key. `web/test/statFormat.test.ts` (exact-string assertions, unchanged) is the gate.
- Only map tags we are confident are the canonical, genuinely-localized game term. Verify each chosen tag also resolves in at least one non-English extract (German) as evidence it is localized, not English-only. When uncertain, leave the stat app-authored (no foreign-language risk).
- `game.<lang>.json` is a strict function of the tag set + a language text table; it never affects `devotions.json` or ids.
- ArchiveTool must be invoked with stdin redirected: `"$GD/ArchiveTool.exe" "$GD/resources/Text_XX.arc" -extract "<dir>" < /dev/null` (it blocks on stdin otherwise). Output lands at `<dir>/text_xx/*.txt`.
- Two `// ABOUTME:` lines on new files; docs evergreen, no emojis/emdashes/hyperbole. Run `just check`.

---

### Task 1: Curate `data/stat-tags.json`

**Files:**
- Create: `data/stat-tags.json`
- Reference (read-only): `.llm/stat-tags-candidates.json` (spike output), `web/src/i18n/app.en.json`, `extracted/text_en/text_en/*.txt`

**Interfaces:**
- Produces: `data/stat-tags.json` = `{ "<statCatalogKey>": "<gameTag>", ... }` (a flat map, sorted keys). Only high-confidence, EN-exact-match, canonical, DE-verified entries.

- [ ] **Step 1: Extract German for the localization cross-check**

Run (from repo root):
```bash
GD="C:/Program Files (x86)/Steam/steamapps/common/Grim Dawn"
rm -rf /tmp/tde && mkdir -p /tmp/tde
"$GD/ArchiveTool.exe" "$GD/resources/Text_DE.arc" -extract "/tmp/tde" < /dev/null
```
Confirm `/tmp/tde/text_de/tags_ui.txt` exists.

- [ ] **Step 2: Build the curated map**

Write a throwaway curation script (in `.llm/`, not committed) OR work by grep. For each `stat.*` key in `app.en.json`:
- Find game tags in `extracted/text_en` whose cleaned English (strip `{\^[a-zA-Z]}` and `\^[a-zA-Z]`, trim) EXACTLY equals the app value.
- Accept a mapping ONLY if you can identify a single canonical tag. Preference order for the ambiguous element/damage/resist/attribute families (per the spike): the character-sheet stat tag `tagCharStats<Element>` (e.g. `tagCharStatsFire`), or the bare attribute tag (`Strength`/`Dexterity`/...), over loot-filter (`tagLootFilter*`), retaliation (`*Ret`), or qualifying-damage (`tagQualifyingDamage*`) variants.
- REJECT coincidental matches where the tag is clearly from an unrelated context (e.g. `stat.subject.ccStun -> tagItemSkillA013`, a skill tag). When in doubt, leave unmapped.
- Verify the chosen tag ALSO exists in `/tmp/tde/text_de` (localized evidence). Drop any tag that is English-only.
- Target families: attributes (`stat.attr.*`), damage (`stat.damage.*`), resistances (`stat.resist.*`), DoT (`stat.dot.*` only if a confident canonical tag exists), and the vetted subset of the 27 clean matches. Explicitly EXCLUDE `stat.template.*`, `stat.group.*`, `stat.pet.*` and composed `stat.override.*`/`stat.subject.*` phrases (permanently app-owned).

- [ ] **Step 3: Write and self-verify `data/stat-tags.json`**

Write the flat sorted map to `data/stat-tags.json` (two-line comment header not applicable to JSON; add a top-level note is not possible in JSON, so document the file in `docs/i18n.md` in Task 4). Self-verify with a script: for every entry, assert `clean(text_en[tag]) == app.en.json[statKey]` (byte-exact) AND `tag in text_de`. Print the count and any failures. Fix or drop failures.

- [ ] **Step 4: Commit**

```bash
git add data/stat-tags.json
git commit -m "feat(i18n): curated stat-id to game-tag map (english-exact, de-verified)"
```

Report the final mapped count and which families are covered.

---

### Task 2: `build_game_tables.py` + move game-table emission out of the parser

**Files:**
- Create: `scripts/build_game_tables.py`, `scripts/test_build_game_tables.py`
- Modify: `scripts/parse_devotions.py` (stop WRITING `game.en.json`; keep the completeness validation), `justfile` (the `parse` recipe runs the builder for EN)
- Regenerate: `data/i18n/game.en.json` (now also includes stat tags)

**Interfaces:**
- Produces: `build_game_tables.py --devotions data/devotions.json --stat-tags data/stat-tags.json --text-dir <dir> --lang <xx> --out data/i18n/game.<xx>.json`. It collects the referenced tag set = every `*_tag` value in `devotions.json` (constellation/power/pet/weapon) + every tag value in `stat-tags.json`, loads the text table from `--text-dir` (same `tag=text` parse + `clean_text` as the parser), and writes `{tag: cleaned_text}` for every referenced tag that RESOLVES (missing tags are omitted; `gameText` falls back to English at runtime).

- [ ] **Step 1: Write failing tests**

`scripts/test_build_game_tables.py` (hand-rolled `check` harness like the parser test, run via `uv run`): feed a tiny fake devotions doc + stat-tags + text table and assert the emitted table contains exactly the resolvable referenced tags with cleaned text; a referenced-but-unresolved tag is omitted.

- [ ] **Step 2: Run to confirm fail** — `uv run scripts/test_build_game_tables.py` (FAIL: module missing).

- [ ] **Step 3: Implement the builder**; reuse `clean_text`/`load_translations` logic (import from the parser module or duplicate minimally). Then remove the `game.en.json` WRITE from `parse_devotions.py` (the `--game-out` arg and the write), keeping the inverted completeness validator (it still checks every referenced tag resolves in the parser's own `tags` dict). Update the `justfile` `parse` recipe to run, after the parser, `uv run scripts/build_game_tables.py --devotions {{out}} --stat-tags data/stat-tags.json --text-dir {{text_dir}} --lang en --out data/i18n/game.en.json`.

- [ ] **Step 4: Run tests + regenerate + verify**

`uv run scripts/test_build_game_tables.py` (PASS), then `just parse`. Confirm `data/i18n/game.en.json` now includes the stat tags (e.g. `tagCharStatsFire`) in addition to the devotion tags, and still resolves every devotion tag. Then `cd web && bun test` (web still green: gameText resolves the same English for devotion tags; stat tags not yet consumed by statFormat until Task 3).

- [ ] **Step 5: Commit**

```bash
git add scripts/build_game_tables.py scripts/test_build_game_tables.py scripts/parse_devotions.py justfile data/i18n/game.en.json
git commit -m "feat(i18n): build_game_tables emits game tables (devotion + stat tags)"
```

---

### Task 3: Wire `statFormat` to resolve mapped stats via `gameText`

**Files:**
- Modify: `web/src/core/statFormat.ts`, and its build-time import of the map
- Create: `web/src/core/statTags.ts` (or import `data/stat-tags.json` directly) — expose the `{ statKey: tag }` map
- Test: `web/test/statFormat.test.ts` stays as the gate (assertions unchanged)

**Interfaces:**
- Consumes: `gameText` (Phase 1b), `data/stat-tags.json`, `game.en.json` (now includes stat tags, loaded by `installEnglish`).
- Produces: for a stat catalog key `k`, statFormat now resolves `STAT_TAGS[k] ? gameText(STAT_TAGS[k]) : translate(k)`.

- [ ] **Step 1: Expose the map to the web**

Import `data/stat-tags.json` (bundled; it is small). Add a helper `statTag(key: string): string | undefined` (or a `Record`), in `statFormat.ts` or a small `statTags.ts`.

- [ ] **Step 2: Route mapped keys through gameText**

At each statFormat read site that currently does `translate("stat....")` for a key that CAN be mapped, change to: `const tag = STAT_TAGS[key]; return tag ? gameText(tag) : translate(key);` Centralize this in a single helper `statLabel(key)` used by all the read sites, so the mapping check is not duplicated. Keep the module-load-safety rule (resolution at call time).

- [ ] **Step 3: Run the gate**

`cd web && bun test test/statFormat.test.ts` — assertions UNCHANGED must pass (English identical: for a mapped key, `gameText(tag)` returns `game.en.json[tag]` which equals the old app English by Task 1's exact-match construction; for an unmapped key, `translate` returns the same as before). Then `cd web && bun test && bunx tsc --noEmit`.

- [ ] **Step 4: Commit**

```bash
git add web/src/core/statFormat.ts web/src/core/statTags.ts
git commit -m "feat(i18n): statFormat resolves mapped stats via gameText (english identical)"
```

---

### Task 4: Ship, verify, docs

**Files:**
- Modify: `justfile` (build recipe already copies `data/i18n/*.json`; confirm `stat-tags.json` is available to the web bundle), `docs/i18n.md`, `BACKLOG.md`

- [ ] **Step 1: Confirm the map ships**

`stat-tags.json` is imported into the bundle (Task 3), so no runtime fetch is needed; confirm `just build` succeeds and the bundle includes it. `game.en.json` already ships (Phase 1b Task 4).

- [ ] **Step 2: Full gate** — `just check` (green).

- [ ] **Step 3: Docs**

`docs/i18n.md`: document `data/stat-tags.json` (the third artifact, now populated), `build_game_tables.py`, and that mapped stat names resolve via `gameText` while unmapped stats + composed phrases + section headers stay app-authored. Mark Phase 2 done. `BACKLOG.md`: note the ambiguous/unmapped stats left app-authored and that `Text_ES.arc` is unreadable on the current machine (Steam verify-integrity to add Spanish later).

- [ ] **Step 4: Commit**

```bash
git add docs/i18n.md BACKLOG.md justfile
git commit -m "docs(i18n): document stat-tags.json and the game-table builder (phase 2)"
```

---

## Self-Review

- Stat-tag mapping curated with EN-exact-match + DE-verified, canonical-tag preference, dubious rejected: Task 1. English identity preserved by construction + statFormat.test.ts gate: Tasks 1, 3.
- Language-independent game-table builder (does not touch ids): Task 2. game.en.json now includes stat tags. Parser keeps completeness validation, stops writing the table.
- statFormat routes mapped keys via gameText, unmapped via translate, centralized helper (DRY, no module-load capture): Task 3.
- Permanently app-owned families (templates, section headers, composed phrases, pet) explicitly excluded: Task 1 Step 2.
- Placeholder scan: none. Type consistency: `STAT_TAGS`/`statLabel` used consistently in Task 3; builder CLI flags consistent in Task 2.
