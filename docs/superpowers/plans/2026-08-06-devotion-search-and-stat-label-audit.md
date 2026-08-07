# Devotion Search and Stat-Label Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct two stat labels that disagree with Grim Dawn's own wording, audit the rest of the app-authored stat nouns for the same drift, and add a text search that highlights matching constellations and stars on the devotion map.

**Architecture:** The planner is hexagonal — `web/src/core/` is pure domain logic, `web/src/adapters/` does I/O and rendering, `web/src/app/main.ts` wires them. Search follows that split exactly: `core/search.ts` builds a language-independent corpus of `Text` descriptors and matches queries against resolved strings, while `adapters/searchIndex.ts` is the only place text is resolved, because `core/` is forbidden from resolving. Map highlighting reuses the existing "emphasis" display channel, giving it a constellation-level expression it never had.

**Tech Stack:** TypeScript (no framework, vanilla TS + SVG), Bun (bundler and test runner), Python 3 with `uv` (parsers), `just` (task runner), Biome (lint/format), ruff (Python lint).

## Global Constraints

- `just check` is the gate. It runs `fmt-check test lint lint-py typecheck` and must pass before every commit. A git pre-commit hook runs it if installed (`just install-hooks`).
- NEVER use `--no-verify` when committing.
- All code files start with a two-line `// ABOUTME: ` (or `# ABOUTME: `) comment.
- No user-facing string is ever hardcoded in app code. `core/` returns `Text` descriptors; adapters resolve them through the `Localization` port. Guarded by `web/test/i18nBoundary.test.ts`.
- `core/` must never call `translate`, `gameText`, or `resolveText`. The only exception in the codebase is `core/localization.ts` itself, which *is* the resolution module.
- Every new app catalog key must be added to all 13 catalogs (`web/src/i18n/app.{en,de,fr,es,ru,zh,pl,it,cs,ja,ko,pt,vi}.json`) and to the `REQUIRED` array in `web/test/appCatalog.test.ts`.
- All planner view state lives in the URL hash and must round-trip through `web/src/core/urlState.ts`, tolerating stale or malformed values without throwing.
- Python scripts use a `uv` shebang: `#!/usr/bin/env -S uv run --script` with an inline `# /// script` metadata block.
- Never use emojis, em dashes, or hyperbole in documentation.
- Make the smallest reasonable change. Do not fix unrelated things you notice; record them in `BACKLOG.md`.
- Reference spec: `docs/superpowers/specs/2026-08-06-devotion-search-and-stat-label-audit-design.md`.

## File Structure

**Part A — relabel**
- Modify: `web/src/i18n/app.{en,de,fr,es,ru,zh,pl,it,cs,ja,ko,pt,vi}.json` — two values each
- Create: `web/test/gtLabelSpotCheck.test.ts` — pins our English nouns against the committed GrimTools fixture
- Modify: `web/test/__snapshots__/i18nCharacterization.test.ts.snap` — regenerated

**Part B — audit**
- Create: `scripts/audit_stat_labels.py` — candidate-tag report over the 64 app-authored nouns
- Create: `scripts/test_audit_stat_labels.py` — pins its pure helpers
- Modify: `data/stat-tags.json`, catalogs, `web/test/gtLabelSpotCheck.test.ts` — as findings dictate

**Part C — search**
- Modify: `scripts/parse_devotions.py` — emit `description_tag`
- Modify: `scripts/test_parse_devotions.py` — cover it
- Modify: `web/src/core/model.ts` — plumb `description_tag` to `descriptionTag`
- Modify: `web/src/core/types.ts` — `Constellation.descriptionTag`
- Create: `web/src/core/search.ts` — `searchCorpus`, `matchQuery`, `normalize` (pure)
- Create: `web/src/adapters/searchIndex.ts` — `resolveIndex` (the only text-resolving piece)
- Create: `web/src/adapters/searchPanel.ts` — the input and count line
- Modify: `web/src/core/displayState.ts` — `conMatch` setting, `emphasis` output
- Modify: `web/src/adapters/svgRenderer.ts` — options-object `update`, `#search-glow` halo
- Modify: `web/src/core/urlState.ts` — `q=` encode/decode
- Modify: `web/index.html` — stable sidebar sub-containers
- Modify: `web/src/adapters/sidebarView.ts` — render into `#affinity-panel`
- Modify: `web/src/app/main.ts` — `repaint()`, wiring, debounce
- Modify: `web/src/styles.css` — `.search-glow`, search panel styles
- Create: `web/test/search.test.ts`
- Modify: `web/test/urlState.test.ts`, `web/test/displayState.test.ts`, `web/test/appCatalog.test.ts`

---

## Part A: the relabel

### Task 1: Correct the two stat nouns across all 13 catalogs

The planner labels `offensiveTotalDamageModifier` as "Total Damage". Grim Dawn calls it "All Damage", and the two are different stats: "All Damage" scales every damage type including damage over time, while "Total Damage" is an item-borne skill modifier devotions never grant. `retaliationTotalDamageModifier` has the same defect.

Every replacement value comes from the game's own translation of `tagDamageModifierTotalDamage` / `tagRetaliationModifierTotalDamage`, with the value token, the `{^E}` colour code, and the leading connector word stripped. Do not translate the English; follow the game.

**Files:**
- Modify: `web/src/i18n/app.en.json:142,151` and the same two keys in the other 12 catalogs
- Create: `web/test/gtLabelSpotCheck.test.ts`
- Modify: `web/test/__snapshots__/i18nCharacterization.test.ts.snap` (regenerated, not hand-edited)

**Interfaces:**
- Consumes: nothing
- Produces: `GT_CONFIRMED` in `web/test/gtLabelSpotCheck.test.ts`, a `Record<string, string>` mapping an app catalog key to the exact English noun the GrimTools fixture must contain. Task 4 extends this table.

- [ ] **Step 1: Write the failing test**

Create `web/test/gtLabelSpotCheck.test.ts`. `scripts/fixtures/gt-devotions-infiltrator.json` is a committed capture of GrimTools' `dumpDevotion()` for a 55-point build; its `details` strings are the fully rendered stat lines a player reads. The fixture covers only the stars that build takes, so this is a curated spot check, not a sweep — `scripts/audit_stat_labels.py` (Task 2) is where coverage comes from.

```ts
// ABOUTME: Pins our English stat nouns against GrimTools' rendered devotion text.
// ABOUTME: Fixture is a committed dumpDevotion() capture; it covers one build, so the table is curated.
import { test, expect } from "bun:test";
import en from "../src/i18n/app.en.json";
import fixture from "../../scripts/fixtures/gt-devotions-infiltrator.json";

const gtText: string = (fixture as { devotions: { details: string }[] }).devotions
  .map((d) => d.details)
  .join("\n");

// app catalog key -> the exact noun GrimTools renders for that stat.
// Extend this as the audit (Task 4) confirms more labels against the fixture.
const GT_CONFIRMED: Record<string, string> = {
  "stat.override.offensiveTotalDamageModifier": "All Damage",
};

// Wordings we deliberately retired. Present here as evidence, so a future edit that
// reintroduces one has to argue with a failing test rather than slip through review.
const RETIRED = ["Total Damage"];

test("our English noun matches what GrimTools renders", () => {
  const catalog = en as Record<string, string>;
  for (const [key, noun] of Object.entries(GT_CONFIRMED)) {
    expect(catalog[key]).toBe(noun);
    expect(gtText).toContain(noun);
  }
});

test("retired wordings appear neither in our catalog nor in GrimTools text", () => {
  const catalog = en as Record<string, string>;
  for (const stale of RETIRED) {
    expect(gtText).not.toContain(stale);
    expect(Object.values(catalog)).not.toContain(stale);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && bunx bun test test/gtLabelSpotCheck.test.ts`

Expected: FAIL. The first test fails on `expect(catalog[key]).toBe("All Damage")` receiving `"Total Damage"`. The second fails on `expect(Object.values(catalog)).not.toContain("Total Damage")`.

- [ ] **Step 3: Apply the two corrections to all 13 catalogs**

In each `web/src/i18n/app.<locale>.json`, replace the values of `stat.override.offensiveTotalDamageModifier` and `stat.override.retaliationTotalDamageModifier` with the row for that locale. Keys must not change.

| locale | `stat.override.offensiveTotalDamageModifier` | `stat.override.retaliationTotalDamageModifier` |
| --- | --- | --- |
| en | `All Damage` | `All Retaliation Damage` |
| de | `alle Schadenstypen` | `alle Vergeltungsschadenstypen` |
| fr | `tous les dégâts` | `tous les dégâts de représailles` |
| es | `todo el daño` | `todo el daño de contrataque` |
| ru | `общего урона` | `общего ответного урона` |
| zh | `所有类型伤害` | `所有类型反击伤害` |
| pl | `wszystkich obrażeń` | `całkowitych odbitych obrażeń` |
| it | `Tutto il Danno` | `Tutto il Danno di Ritorsione` |
| cs | `celkovému zranění` | `všem zraněním odplatou` |
| ja | `全ダメージ` | `全報復ダメージ` |
| ko | `모든 데미지` | `전체 보복 데미지` |
| pt | `Todos os Danos` | `Todos os Danos de Retaliação` |
| vi | `Tất Cả Các Loại Sát Thương` | `Tất Cả Sát Thương Phản Lại` |

Russian keeps "общего" because that is the word the game's own Russian text uses.

- [ ] **Step 4: Run the spot check to verify it passes**

Run: `cd web && bunx bun test test/gtLabelSpotCheck.test.ts`

Expected: PASS, both tests.

- [ ] **Step 5: Regenerate the characterization snapshot**

"Total Damage" appears 14 times in `web/test/__snapshots__/i18nCharacterization.test.ts.snap`.

Run: `cd web && bunx bun test test/i18nCharacterization.test.ts --update-snapshots`

Then run `git diff web/test/__snapshots__/` and read it. Every changed line must be a "Total Damage" to "All Damage" or "Total Retaliation Damage" to "All Retaliation Damage" substitution, in the English or Chinese blocks. Anything else means something unintended moved — stop and investigate rather than committing.

- [ ] **Step 6: Run the full gate**

Run: `just check`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/i18n/ web/test/gtLabelSpotCheck.test.ts web/test/__snapshots__/
git commit -m "fix(i18n): label total-damage stats All Damage, matching the game

A forum report flagged that the planner says % Total Damage where Grim Dawn
says % All Damage. They are different stats: All Damage scales every damage
type including damage over time, while Total Damage is an item-borne skill
modifier devotions never grant. retaliationTotalDamageModifier had the same
defect.

Every replacement comes from the game's own translation of
tagDamageModifierTotalDamage / tagRetaliationModifierTotalDamage rather than
being authored, so all 13 locales match in-game wording.

Reported-by: Crate forums"
```

---

## Part B: the audit

### Task 2: Build the stat-label audit report script

The game hardcodes its stat-id to display-tag mapping in its engine and never ships it as data. That is why `data/stat-tags.json` is hand-curated, and why this audit cannot be a diff: there is no authoritative answer to compare against. The script's job is to put good candidate tags in front of a human.

Scope is the 64 app-authored stat *nouns*: the 50 `stat.override.*` keys and the 14 `stat.subject.*` keys. `stat.attr.*`, `stat.damage.*`, `stat.dot.*`, and `stat.resist.*` already resolve from the game and cannot drift. `stat.template.*`, `stat.power.*`, `stat.group.*`, `stat.race.*`, and `stat.pet.*` are composed phrases, not nouns.

**Files:**
- Create: `scripts/audit_stat_labels.py`
- Create: `scripts/test_audit_stat_labels.py`

**Interfaces:**
- Consumes: nothing
- Produces: `strip_tokens(s: str) -> str`, `head_noun(label: str) -> str`, and `candidates(label: str, tags: dict[str, str]) -> list[tuple[str, str]]` in `scripts/audit_stat_labels.py`. Task 3 does not import these; Task 4 runs the script.

- [ ] **Step 1: Write the failing test**

Create `scripts/test_audit_stat_labels.py`, discovered by `just test-scripts` as `scripts/test_*.py`.

**Read `scripts/test_parse_devotions.py` and one other sibling suite in full before writing, and follow what they actually do.** All four existing suites share one shape, and the new test must match it: load the module under test via `importlib.util.spec_from_file_location` + `module_from_spec` + `exec_module` (never a plain top-level import — that only resolves because `uv run` happens to put the script's directory on `sys.path[0]`, and it trips static analysers), accumulate a `failures` counter through a `check(...)` helper that prints per-check results, and end with an explicit `"ALL PASSED"` / `"FAILURES: N"` summary plus `raise SystemExit(1 if failures else 0)`.

The assertions below are what the test must cover; express them through that harness rather than as bare `assert` statements in `def test_*()` functions.

```python
#!/usr/bin/env -S uv run --script
# ABOUTME: Pins the pure helpers in audit_stat_labels.py so they need no game install to test.
# ABOUTME: Run via `just test-scripts`, or directly with `uv run scripts/test_audit_stat_labels.py`.
# /// script
# requires-python = ">=3.10"
# ///
from audit_stat_labels import strip_tokens, head_noun, candidates


def test_strip_tokens():
    assert strip_tokens("{%+.0f0}% {^E}to All Damage") == "to All Damage"
    assert strip_tokens("{%.0f0}% Resistance to Life Reduction") == "Resistance to Life Reduction"
    assert strip_tokens("Armor Rating") == "Armor Rating"


def test_head_noun():
    assert head_noun("All Damage") == "damage"
    assert head_noun("Shield Block Chance") == "chance"
    assert head_noun("") == ""


def test_candidates_matches_on_head_noun():
    tags = {
        "tagDamageModifierTotalDamage": "{%+.0f0}% {^E}to All Damage",
        "tagCharStatsArmorTotal": "Armor Rating",
    }
    found = candidates("Total Damage", tags)
    assert ("tagDamageModifierTotalDamage", "to All Damage") in found
    assert all(tag != "tagCharStatsArmorTotal" for tag, _ in found)


test_strip_tokens()
test_head_noun()
test_candidates_matches_on_head_noun()
print("ok")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run scripts/test_audit_stat_labels.py`

Expected: FAIL with `ModuleNotFoundError: No module named 'audit_stat_labels'`.

- [ ] **Step 3: Write the script**

Create `scripts/audit_stat_labels.py`.

```python
#!/usr/bin/env -S uv run --script
# ABOUTME: Reports candidate Grim Dawn tags for each app-authored stat noun, for hand audit.
# ABOUTME: The game hardcodes stat-id to tag in its engine, so this suggests, it does not decide.
# /// script
# requires-python = ">=3.10"
# ///
"""Put candidate game tags in front of a human for each app-authored stat noun.

Scope is the 64 nouns the app authors itself: stat.override.* and stat.subject.*.
Everything under stat.attr/damage/dot/resist already resolves from the game via
data/stat-tags.json and cannot drift; stat.template/power/group/race/pet are
composed phrases with no single game string to compare against.

Output is a report on stdout. Nothing is written and nothing is committed.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

AUDITED_PREFIXES = ("stat.override.", "stat.subject.")
VALUE_TOKEN = re.compile(r"\{%[^}]*\}")
COLOUR_TOKEN = re.compile(r"\{\^[A-Za-z]\}")
# Words too common to identify a stat; a head noun of "damage" is useful, "of" is not.
STOPWORDS = {"to", "of", "the", "a", "and", "for", "with", "by", "s"}


def strip_tokens(s: str) -> str:
    """Reduce a game format string to its prose: drop value and colour tokens."""
    s = VALUE_TOKEN.sub("", s)
    s = COLOUR_TOKEN.sub("", s)
    s = re.sub(r"^[\s%\-]+|[\s%\-]+$", "", s)
    return re.sub(r"\s{2,}", " ", s).strip()


def head_noun(label: str) -> str:
    """The last significant word of a label, lowercased. "All Damage" -> "damage"."""
    words = [w for w in re.findall(r"[A-Za-z']+", label.lower()) if w not in STOPWORDS]
    return words[-1] if words else ""


def candidates(label: str, tags: dict[str, str]) -> list[tuple[str, str]]:
    """Every (tag, prose) whose text shares the label's head noun, shortest first.

    Shortest first because a bare noun tag is a better label source than a
    sentence that happens to mention the same word.
    """
    noun = head_noun(label)
    if not noun:
        return []
    out: list[tuple[str, str]] = []
    for tag, raw in tags.items():
        prose = strip_tokens(raw)
        if noun in head_noun(prose) or re.search(rf"\b{re.escape(noun)}\b", prose.lower()):
            out.append((tag, prose))
    out.sort(key=lambda p: (len(p[1]), p[0]))
    return out


def load_tags(text_dir: Path) -> dict[str, str]:
    """Every tag=text pair in a language's extracted text directory."""
    tags: dict[str, str] = {}
    for path in sorted(text_dir.rglob("*.txt")):
        for line in path.read_text(encoding="utf-8-sig", errors="replace").splitlines():
            if "=" not in line or line.startswith("//"):
                continue
            tag, _, value = line.partition("=")
            tag = tag.strip()
            if tag:
                tags[tag] = value.strip()
    return tags


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--catalog", type=Path, default=root / "web/src/i18n/app.en.json")
    ap.add_argument("--text-dir", type=Path, default=root / "extracted/text_en")
    ap.add_argument("--max", type=int, default=5, help="candidates shown per label")
    args = ap.parse_args()

    if not args.text_dir.exists():
        print(f"no extracted text at {args.text_dir}; run `just extract` on a machine with the game",
              file=sys.stderr)
        return 2

    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    tags = load_tags(args.text_dir)
    audited = {k: v for k, v in catalog.items() if k.startswith(AUDITED_PREFIXES)}

    print(f"# {len(audited)} app-authored stat nouns against {len(tags)} game tags\n")
    exact = 0
    for key, label in sorted(audited.items()):
        found = candidates(label, tags)
        agree = any(prose.lower() == label.lower() for _, prose in found)
        if agree:
            exact += 1
        mark = "OK " if agree else "?? "
        print(f"{mark}{key}\n    ours: {label!r}")
        for tag, prose in found[: args.max]:
            flag = "==" if prose.lower() == label.lower() else "  "
            print(f"    {flag} {tag}: {prose!r}")
        if not found:
            print("       (no candidate tag shares this head noun)")
        print()
    print(f"# {exact} of {len(audited)} nouns exactly match some game tag's prose")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run scripts/test_audit_stat_labels.py`

Expected: `ok`

- [ ] **Step 5: Run the report and save it for Task 4**

Run: `uv run scripts/audit_stat_labels.py > /tmp/stat-label-audit.txt; wc -l /tmp/stat-label-audit.txt`

Expected: a report. If it exits 2 with "no extracted text", the machine has no game install — this step and Task 4 must run on Ted's Windows box. Say so and stop rather than guessing at labels.

- [ ] **Step 6: Run the gate**

Run: `just check && just test-scripts`

Expected: PASS. `just check` includes `lint-py` (ruff), which must be clean.

- [ ] **Step 7: Commit**

```bash
git add scripts/audit_stat_labels.py scripts/test_audit_stat_labels.py
git commit -m "test(audit): report candidate game tags for app-authored stat nouns

The game hardcodes stat-id to display-tag in its engine and never ships it as
data, so a label audit cannot be a diff. This suggests candidates for the 64
nouns the app authors itself and leaves the judgment to a human."
```

### Task 3: Apply the audit findings

**This task's size is unknown until Task 2's report is read.** If it surfaces a handful of mismatches, fix them here. If it surfaces dozens, fix the clear-cut ones, and record the rest in `BACKLOG.md` under a "Stat-label audit remainder" heading with the report attached — scaling the work down is Ted's call, so tell him the count rather than silently finishing or silently stopping.

**Files:**
- Modify: `data/stat-tags.json` (preferred resolution)
- Modify: `web/src/i18n/app.*.json` (fallback resolution)
- Modify: `web/test/gtLabelSpotCheck.test.ts` — extend `GT_CONFIRMED`
- Modify: `BACKLOG.md` — if any findings are deferred

**Interfaces:**
- Consumes: `GT_CONFIRMED` from Task 1; the report from Task 2
- Produces: nothing later tasks depend on

- [ ] **Step 1: Triage the report**

For each `??` entry, decide one of three outcomes:

1. **Not a defect.** Our noun is a reasonable label with no cleaner game term. Most `??` lines will be this — the head-noun heuristic is deliberately loose. Move on.
2. **Defect with a clean bare-noun tag.** Prefer this resolution: add the key to `data/stat-tags.json` so the game supplies all 13 translations and it can never drift again. Only valid when the tag's prose is a bare noun, byte-identical in intent to what we want to show, and resolves in a non-English table too (spot-check German).
3. **Defect with no clean tag.** Correct the English and hand-author the other 12 from the game's translation of the closest tag, exactly as Task 1 did.

A tag whose prose is a sentence, carries a trailing value ("Healing Effects Increased by {v}%"), or needs a language-specific connector stripped is *not* clean. Those stay app-authored — that is the whole reason `data/stat-format-tags.json` holds only two entries.

- [ ] **Step 2: Write the failing test for each confirmed defect**

For each defect, add its key to `GT_CONFIRMED` in `web/test/gtLabelSpotCheck.test.ts` if the GrimTools fixture text covers it, and add any stale wording to `RETIRED`. If the fixture does not cover it (likely — the fixture is 55 stars), add a case to `web/test/statFormat.test.ts` asserting the resolved label instead. Do not skip the test because the fixture lacks coverage.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd web && bunx bun test test/gtLabelSpotCheck.test.ts test/statFormat.test.ts`

Expected: FAIL, one failure per confirmed defect.

- [ ] **Step 4: Apply the fixes**

Resolution 2: add `"stat.override.<id>": "<tagName>"` to `data/stat-tags.json`, and delete nothing from the catalogs — `statLabel` prefers `STAT_TAGS` and falls back to `appT`, so the catalog entry becomes dead but harmless, and `appCatalog.test.ts` still requires it to exist. Then run `just i18n-tables` so `data/i18n/game.*.json` includes the newly referenced tag (Windows-only; if unavailable, `gameText` falls back to English for the missing languages, which is degraded but not broken — note it in the commit message).

Resolution 3: edit the value in all 13 catalogs.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && bunx bun test test/gtLabelSpotCheck.test.ts test/statFormat.test.ts`

Expected: PASS.

- [ ] **Step 6: Regenerate the snapshot if any label changed**

Run: `cd web && bunx bun test test/i18nCharacterization.test.ts --update-snapshots`

Read `git diff web/test/__snapshots__/`. Every changed line must correspond to a label you deliberately changed.

- [ ] **Step 7: Run the gate and commit**

```bash
just check
git add data/stat-tags.json data/i18n/ web/src/i18n/ web/test/ BACKLOG.md
git commit -m "fix(i18n): correct stat nouns the audit found disagreeing with the game

Prefers moving keys into data/stat-tags.json so the game supplies every
translation, over hand-authoring 13 catalogs."
```

---

## Part C: devotion search

### Task 4: Emit constellation descriptions from the parser

Grim Dawn gives every constellation flavour text (`constellationInfoTag`, e.g. `tagDevotion_A05Desc` = "The anvil absorbs the hammer's blows, an indispensable tool in Targo's celestial forge."), but the parser never extracted it. Search needs it, and later the tooltip can use it.

`data/devotions.json` is committed, so the regeneration must run on a machine with Grim Dawn installed. The web side treats the field as optional, so every later task works whether or not the regen has happened.

**Files:**
- Modify: `scripts/parse_devotions.py:388-460`
- Modify: `scripts/test_parse_devotions.py`
- Modify: `web/src/core/types.ts:43-51`
- Modify: `web/src/core/model.ts:27-35,82-91`
- Regenerate: `data/devotions.json`, `data/i18n/game.*.json`

**Interfaces:**
- Consumes: nothing
- Produces: `Constellation.descriptionTag: string | null` on the model built by `buildModel`. Task 5 reads it.

- [ ] **Step 1: Write the failing test**

In `scripts/test_parse_devotions.py`, follow the existing fixture style in that file. Add a case asserting the constellation record carries `description_tag` resolved from `constellationInfoTag`.

```python
def test_constellation_carries_description_tag():
    rec = {
        "templateName": "devotionconstellation.tpl",
        "devotionButton1": "records/ui/skills/devotion/tier1_01a.dbr",
        "constellationDisplayTag": "tagDevotion_A05",
        "constellationInfoTag": "tagDevotion_A05Desc",
    }
    tags = {"tagDevotion_A05": "Anvil", "tagDevotion_A05Desc": "The anvil absorbs the hammer's blows."}
    con = parse_constellation_record(rec, tags)
    assert con["name_tag"] == "tagDevotion_A05"
    assert con["description_tag"] == "tagDevotion_A05Desc"
```

If `parse_constellation_record` is not separable from disk reads in the current file, add the assertion to the existing end-to-end constellation test instead rather than restructuring the parser — the smallest change wins.

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run scripts/test_parse_devotions.py`

Expected: FAIL with `KeyError: 'description_tag'`.

- [ ] **Step 3: Emit the field from the parser**

In `scripts/parse_devotions.py`, next to the existing name-tag read (around line 388):

```python
    name_tag = rec.get("constellationDisplayTag", "").strip()
    name = clean_text(tags.get(name_tag, name_tag)) or rec.get("FileDescription", con_path.stem)
    if name_tag and name_tag not in tags:
        warnings.append(f"{con_path.name}: unresolved name tag {name_tag}")

    desc_tag = rec.get("constellationInfoTag", "").strip()
    if desc_tag and desc_tag not in tags:
        warnings.append(f"{con_path.name}: unresolved description tag {desc_tag}")
```

In the returned dict (around line 452), after `"name_tag"`:

```python
        "description_tag": register(desc_tag, clean_text(tags.get(desc_tag, "")), game_en) if desc_tag else None,
```

And in the validation block near line 522, so a broken tag fails the parse rather than shipping:

```python
        if c["description_tag"]:
            referenced_tags.append((f"constellation {c['id']} desc", c["description_tag"]))
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run scripts/test_parse_devotions.py && just test-scripts`

Expected: PASS.

- [ ] **Step 5: Plumb the field through the model**

In `web/src/core/types.ts`, add to `Constellation` after `nameTag`:

```ts
  descriptionTag: string | null;
```

In `web/src/core/model.ts`, add to `RawConstellation` after `name_tag`:

```ts
  description_tag?: string | null;
```

and to the `constellations.set(...)` call after `nameTag: c.name_tag,`:

```ts
      descriptionTag: c.description_tag ?? null,
```

The `?? null` is what makes every later task work before the dataset regen lands.

- [ ] **Step 6: Regenerate the datasets (Windows, game installed)**

Run: `just parse && just i18n-tables`

Then `git diff --stat data/` — expect `data/devotions.json` to gain one `description_tag` per constellation and each `data/i18n/game.*.json` to gain the corresponding `tagDevotion_*Desc` entries. If this machine has no game install, skip this step, say so explicitly, and commit the parser and model changes alone; `descriptionTag` stays `null` everywhere and search simply has no description text until the regen runs.

- [ ] **Step 7: Run the gate and commit**

```bash
just check
git add scripts/parse_devotions.py scripts/test_parse_devotions.py web/src/core/types.ts web/src/core/model.ts data/
git commit -m "feat(data): emit constellation description tags

The game gives every constellation flavour text via constellationInfoTag; the
parser never read it. Needed for text search, and available to the tooltip later."
```

### Task 5: Build the search corpus and matcher

Pure core module. No `Localization`, no DOM. `web/test/i18nBoundary.test.ts` greps `core/` for resolver use, so this file must not call `translate`, `gameText`, or `resolveText`.

**Files:**
- Create: `web/src/core/search.ts`
- Create: `web/test/search.test.ts`

**Interfaces:**
- Consumes: `Constellation.descriptionTag` (Task 4)
- Produces:
  - `normalize(s: string): string`
  - `searchCorpus(model: DevotionModel): SearchCorpus` where `SearchCorpus = { constellations: Map<string, Text[]>; stars: Map<StarId, Text[]> }`
  - `matchQuery(index: SearchIndex, query: string): SearchMatch` where `SearchIndex = { constellations: Map<string, string>; stars: Map<StarId, string> }` and `SearchMatch = { constellations: Set<string>; stars: Set<StarId> }`

  Task 6 imports `normalize` and the `SearchCorpus`/`SearchIndex` types. Tasks 8 and 14 import `SearchMatch`.

- [ ] **Step 1: Write the failing test**

Create `web/test/search.test.ts`.

```ts
// ABOUTME: Unit tests for the pure devotion search corpus and matcher.
// ABOUTME: Uses the real dataset for corpus shape and synthetic indexes for match semantics.
import { test, expect } from "bun:test";
import devotions from "../../data/devotions.json";
import { buildModel, type DevotionsDoc } from "../src/core/model";
import { searchCorpus, matchQuery, normalize, type SearchIndex } from "../src/core/search";
import { makeLocalization, resolveText } from "../src/core/localization";
import appEn from "../src/i18n/app.en.json";

const model = buildModel(devotions as unknown as DevotionsDoc);
const loc = makeLocalization(appEn as Record<string, string>, {}, "en");

test("normalize lowercases and folds diacritics", () => {
  expect(normalize("Dégâts")).toBe("degats");
  expect(normalize("ALL Damage")).toBe("all damage");
});

test("every constellation and star has a corpus entry", () => {
  const corpus = searchCorpus(model);
  expect(corpus.constellations.size).toBe(model.constellations.size);
  expect(corpus.stars.size).toBe(model.stars.size);
});

test("a star with a celestial power carries its power name", () => {
  const corpus = searchCorpus(model);
  const star = [...model.stars.values()].find((s) => s.celestialPower !== null)!;
  const parts = corpus.stars.get(star.id)!;
  const tags = parts.filter((p) => p.k === "game").map((p) => (p as { tag: string }).tag);
  expect(tags).toContain(star.celestialPower!.nameTag);
});

test("a star with pet bonuses carries the pet section label so \"pet\" matches", () => {
  const corpus = searchCorpus(model);
  const star = [...model.stars.values()].find((s) => s.petBonuses !== undefined)!;
  const text = normalize(corpus.stars.get(star.id)!.map((t) => resolveText(loc, t)).join(" "));
  expect(text).toContain("pet");
});

function idx(stars: Record<string, string>, cons: Record<string, string> = {}): SearchIndex {
  return {
    constellations: new Map(Object.entries(cons).map(([k, v]) => [k, normalize(v)])),
    stars: new Map(Object.entries(stars).map(([k, v]) => [k, normalize(v)])),
  };
}

test("terms are ANDed, not ORed", () => {
  const i = idx({ a: "Fire Resistance", b: "Fire Damage" });
  expect([...matchQuery(i, "fire res").stars]).toEqual(["a"]);
  expect([...matchQuery(i, "fire").stars].sort()).toEqual(["a", "b"]);
});

test("matching is case and diacritic insensitive", () => {
  const i = idx({ a: "Dégâts de Feu" });
  expect(matchQuery(i, "DEGATS").stars.has("a")).toBe(true);
});

test("an empty or whitespace query matches nothing", () => {
  const i = idx({ a: "Fire Resistance" }, { c: "Owl" });
  expect(matchQuery(i, "").stars.size).toBe(0);
  expect(matchQuery(i, "   ").constellations.size).toBe(0);
});

test("constellation and star matches are reported separately", () => {
  const i = idx({ a: "Fire Damage" }, { owl: "Owl" });
  const m = matchQuery(i, "owl");
  expect([...m.constellations]).toEqual(["owl"]);
  expect(m.stars.size).toBe(0);
});
```

Note the unused `gameEn`/`gameLoc` bindings above are a drafting artifact — delete them and import only what the assertions use, or Biome's lint will fail the gate.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && bunx bun test test/search.test.ts`

Expected: FAIL — `Cannot find module '../src/core/search'`.

- [ ] **Step 3: Write the module**

Create `web/src/core/search.ts`.

```ts
// ABOUTME: Pure text-search corpus and matcher for the devotion map.
// ABOUTME: Builds language-independent Text recipes; an adapter resolves them (core never resolves).
import type { DevotionModel, StarId } from "./types";
import { appT, gameT, joinT, type Text } from "./localization";
import { condensedRows, formatPowerStats } from "./statFormat";

export interface SearchCorpus {
  constellations: Map<string, Text[]>;
  stars: Map<StarId, Text[]>;
}

export interface SearchIndex {
  constellations: Map<string, string>;
  stars: Map<StarId, string>;
}

export interface SearchMatch {
  constellations: Set<string>;
  stars: Set<StarId>;
}

/**
 * Fold text for comparison: lowercase, then drop combining marks so "degats" finds
 * "dégâts". Applied to BOTH corpus and query, so neither side is more lenient.
 */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/**
 * Every searchable Text per constellation and per star. Constellation-level text
 * (name, flavour) is kept separate from star-level text (stats, power, weapon
 * requirement) because the two highlight at different granularities: a constellation
 * hit glows the art, a star hit glows the star, and neither implies the other.
 *
 * Values are deliberately not indexed - searching "15" matches noise, not intent.
 */
export function searchCorpus(model: DevotionModel): SearchCorpus {
  const constellations = new Map<string, Text[]>();
  for (const c of model.constellations.values()) {
    const parts: Text[] = [gameT(c.nameTag)];
    if (c.descriptionTag) parts.push(gameT(c.descriptionTag));
    constellations.set(c.id, parts);
  }

  const stars = new Map<StarId, Text[]>();
  for (const s of model.stars.values()) {
    const parts: Text[] = [];
    const opts = s.racialTarget ? { racialTarget: s.racialTarget } : {};
    for (const g of condensedRows(s.bonuses, opts)) for (const sub of g.subjects) parts.push(sub.subject);
    // Pet rows render as bare stat nouns ("Fire Damage"); "Bonus to All Pets" is only a
    // section header. Fold it in so typing "pet" finds them, in every language.
    if (s.petBonuses)
      for (const g of condensedRows(s.petBonuses))
        for (const sub of g.subjects) parts.push(joinT(appT("ui.panel.petBonus"), " ", sub.subject));
    const p = s.celestialPower;
    if (p) {
      parts.push(gameT(p.nameTag));
      if (p.descriptionTag) parts.push(gameT(p.descriptionTag));
      const rows = formatPowerStats(p.stats);
      for (const r of [...rows.rows, ...rows.fallthrough]) parts.push(r.label);
    }
    if (s.weaponRequirement?.descriptionTag) parts.push(gameT(s.weaponRequirement.descriptionTag));
    stars.set(s.id, parts);
  }

  return { constellations, stars };
}

/**
 * Case- and diacritic-insensitive substring match with terms ANDed, so a second word
 * narrows rather than widens. An empty query matches nothing (not everything): with no
 * query there is nothing to emphasize.
 */
export function matchQuery(index: SearchIndex, query: string): SearchMatch {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const empty: SearchMatch = { constellations: new Set(), stars: new Set() };
  if (terms.length === 0) return empty;
  const hit = (text: string) => terms.every((t) => text.includes(t));
  const constellations = new Set<string>();
  for (const [id, text] of index.constellations) if (hit(text)) constellations.add(id);
  const stars = new Set<StarId>();
  for (const [id, text] of index.stars) if (hit(text)) stars.add(id);
  return { constellations, stars };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && bunx bun test test/search.test.ts`

Expected: PASS, all eight tests.

- [ ] **Step 5: Verify the i18n boundary guard still passes**

Run: `cd web && bunx bun test test/i18nBoundary.test.ts`

Expected: PASS. If it fails, `core/search.ts` is resolving text — move that work to Task 6's adapter.

- [ ] **Step 6: Run the gate and commit**

```bash
just check
git add web/src/core/search.ts web/test/search.test.ts
git commit -m "feat(search): pure devotion search corpus and matcher

Terms are ANDed so a second word narrows. Pet bonuses carry the section label
so \"pet\" matches them, which bare stat nouns would not."
```

### Task 6: Resolve the corpus into a searchable index

The one place text is resolved. It lives in `adapters/` because `core/` may not resolve.

**Files:**
- Create: `web/src/adapters/searchIndex.ts`
- Modify: `web/test/search.test.ts`

**Interfaces:**
- Consumes: `SearchCorpus`, `SearchIndex`, `normalize` (Task 5)
- Produces: `resolveIndex(loc: Localization, corpus: SearchCorpus): SearchIndex`. Task 14 calls it.

- [ ] **Step 1: Write the failing test**

Append to `web/test/search.test.ts`:

```ts
test("resolveIndex produces normalized text findable by matchQuery", async () => {
  const { resolveIndex } = await import("../src/adapters/searchIndex");
  const corpus = searchCorpus(model);
  const index = resolveIndex(loc, corpus);
  expect(index.stars.size).toBe(model.stars.size);
  // The Owl constellation carries offensiveTotalDamageModifier, relabelled "All Damage".
  const m = matchQuery(index, "all damage");
  expect(m.stars.size).toBeGreaterThan(0);
});
```

The `resolveText` import in this file is already present from the pet-bonus test above.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && bunx bun test test/search.test.ts`

Expected: FAIL — `Cannot find module '../src/adapters/searchIndex'`.

- [ ] **Step 3: Write the adapter**

Create `web/src/adapters/searchIndex.ts`.

```ts
// ABOUTME: Resolves the pure search corpus into normalized strings for the active locale.
// ABOUTME: The only text-resolving piece of search; core/search.ts stays language independent.
import { resolveText, type Text } from "../core/localization";
import { normalize, type SearchCorpus, type SearchIndex } from "../core/search";
import type { Localization } from "../ports/Localization";

/**
 * Flatten each corpus entry to one normalized string. Rebuild this on a language
 * switch: the corpus is locale-independent, the index is not.
 */
export function resolveIndex(loc: Localization, corpus: SearchCorpus): SearchIndex {
  const flatten = (parts: Text[]) => normalize(parts.map((t) => resolveText(loc, t)).join(" "));
  const constellations = new Map<string, string>();
  for (const [id, parts] of corpus.constellations) constellations.set(id, flatten(parts));
  const stars = new Map<string, string>();
  for (const [id, parts] of corpus.stars) stars.set(id, flatten(parts));
  return { constellations, stars };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && bunx bun test test/search.test.ts`

Expected: PASS.

- [ ] **Step 5: Run the gate and commit**

```bash
just check
git add web/src/adapters/searchIndex.ts web/test/search.test.ts
git commit -m "feat(search): resolve the search corpus per locale in an adapter"
```

### Task 7: Give the emphasis channel a constellation-level expression

`web/src/core/displayState.ts` documents three orthogonal channels: brightness (attainability), colour (affinity filter), emphasis. Emphasis only ever had a star-level expression (`benefitMatch`). This adds its constellation-level counterpart. It is not a fourth channel.

**Files:**
- Modify: `web/src/core/displayState.ts:10-22,42-45`
- Modify: `web/test/displayState.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `DisplaySettings.conMatch?: Set<string>` and `ConstellationDisplay.emphasis: boolean`. Task 9 reads both.

- [ ] **Step 1: Write the failing test**

Append to `web/test/displayState.test.ts`, using the file's existing `con`, `reach`, and `settings` helpers:

```ts
test("a constellation in conMatch is emphasized", () => {
  const c = con("owl", ["owl:0", "owl:1"]);
  const on = constellationDisplay(c, settings({ conMatch: new Set(["owl"]) }));
  expect(on.emphasis).toBe(true);
  const off = constellationDisplay(c, settings({ conMatch: new Set(["crane"]) }));
  expect(off.emphasis).toBe(false);
});

test("emphasis defaults to false with no conMatch", () => {
  const c = con("owl", ["owl:0"]);
  expect(constellationDisplay(c, settings()).emphasis).toBe(false);
});

test("emphasis is independent of brightness and colour", () => {
  const c = con("owl", ["owl:0"], { chaos: 1 });
  const d = constellationDisplay(
    c,
    settings({
      conMatch: new Set(["owl"]),
      reach: reach({ completable: new Set() }),
      affinityFilter: { grants: new Set(["order" as Affinity]), requires: new Set() },
    }),
  );
  expect(d.emphasis).toBe(true);
  expect(d.brightness).toBe("unattainable");
  expect(d.color.kind).toBe("mute");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && bunx bun test test/displayState.test.ts`

Expected: FAIL — `emphasis` is `undefined`.

- [ ] **Step 3: Add the channel**

In `web/src/core/displayState.ts`, add to `DisplaySettings` after `benefitMatch`:

```ts
  /** Constellations emphasized by the text search; the constellation-level half of the emphasis channel. */
  conMatch?: Set<string>;
```

Add to `ConstellationDisplay`:

```ts
  emphasis: boolean;
```

And in `constellationDisplay`, extend the returned object:

```ts
export function constellationDisplay(con: Constellation, s: DisplaySettings): ConstellationDisplay {
  const brightness = constellationBrightness(con, s);
  return {
    brightness,
    color: constellationColor(con, s),
    selfGlow: brightness === "active",
    emphasis: s.conMatch?.has(con.id) ?? false,
  };
}
```

Update the file's second ABOUTME line so it stays true: emphasis now has both a star-level (`benefitMatch`) and a constellation-level (`conMatch`) expression.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && bunx bun test test/displayState.test.ts`

Expected: PASS.

- [ ] **Step 5: Run the gate and commit**

```bash
just check
git add web/src/core/displayState.ts web/test/displayState.test.ts
git commit -m "feat(display): give the emphasis channel a constellation-level expression

benefitMatch was emphasis's only expression, and it is star-level. conMatch is
its constellation-level counterpart, for search hits on a name or description."
```

### Task 8: Convert SvgHandle.update to an options object

Pure refactor, no behaviour change. `update` already takes five positional parameters and Task 9 would make it six. `RenderOpts` is already an options object, so `update` should match. One call site.

**Files:**
- Modify: `web/src/adapters/svgRenderer.ts:347-355,372-390`
- Modify: `web/src/app/main.ts:708`

**Interfaces:**
- Consumes: nothing
- Produces: `UpdateOpts` exported from `web/src/adapters/svgRenderer.ts`, and `SvgHandle.update(state: SelectionState, opts?: UpdateOpts): void`. Task 9 adds a field to `UpdateOpts`; Task 14 calls the new form.

- [ ] **Step 1: Confirm the existing tests pass before touching anything**

Run: `cd web && bunx bun test test/svgRenderer.test.ts`

Expected: PASS. These tests call `renderSvgMarkup` directly, which is unaffected — that is what makes this refactor safe with no new test.

- [ ] **Step 2: Change the interface and the internal render**

In `web/src/adapters/svgRenderer.ts`, add above `SvgHandle`:

```ts
/** Per-render inputs for a mounted map, mirroring RenderOpts minus the boot-time manifest. */
export interface UpdateOpts {
  highlight?: Set<StarId>;
  reach?: ReachView;
  diff?: { added: Set<StarId>; removed: Set<StarId> } | null;
  affinityFilter?: { grants: Set<Affinity>; requires: Set<Affinity> };
}
```

Change `SvgHandle.update` to:

```ts
  update(state: SelectionState, opts?: UpdateOpts): void;
```

And in `mountSvg`, change the internal `render` to:

```ts
  function render(state: SelectionState, opts: UpdateOpts = {}) {
    container.innerHTML = renderSvgMarkup(model, state, { manifest: deps.manifest, ...opts });
  }
```

The boot call at the end of `mountSvg` becomes `render({ selected: new Set(), pointCap: 55 })`, unchanged. Update the `update:` property in the returned handle to forward `(state, opts)`.

- [ ] **Step 3: Update the one call site**

In `web/src/app/main.ts:708`:

```ts
    handle.update(state, {
      highlight: taggedStars(),
      reach,
      diff,
      affinityFilter: affinityFilterSets(),
    });
```

- [ ] **Step 4: Run the full suite to verify nothing moved**

Run: `cd web && bunx bun test`

Expected: PASS, same counts as before (600 pass, 2 skip at time of writing).

- [ ] **Step 5: Run the gate and commit**

```bash
just check
git add web/src/adapters/svgRenderer.ts web/src/app/main.ts
git commit -m "refactor(render): take SvgHandle.update inputs as an options object

Five positional parameters was already at the limit and search adds a sixth.
RenderOpts is an options object; update now matches. No behaviour change."
```

### Task 9: Draw the search halo on matching constellation art

The affinity halo already solves this exact problem — glow an art silhouette without touching brightness or colour — so copy its construction rather than inventing one. The palette is `#match-glow`'s neutral blue/white, so "match" reads as one thing at both granularities and is never confused with an affinity colour.

**Files:**
- Modify: `web/src/adapters/svgRenderer.ts:60-69,140-160,187-260,347-355`
- Modify: `web/src/styles.css`
- Modify: `web/test/svgRenderer.test.ts`

**Interfaces:**
- Consumes: `ConstellationDisplay.emphasis` (Task 7), `UpdateOpts` (Task 8)
- Produces: `RenderOpts.conHighlight?: Set<string>` and `UpdateOpts.conHighlight?: Set<string>`. Task 14 passes it.

- [ ] **Step 1: Write the failing test**

Append to `web/test/svgRenderer.test.ts`, following that file's existing `model`/`manifest` setup:

```ts
test("no search-glow layer when no query is active", () => {
  const markup = renderSvgMarkup(model, { selected: new Set(), pointCap: 55 }, { manifest });
  expect(markup).not.toContain("search-glow");
});

test("a matched constellation with art gets a search-glow halo", () => {
  const withArt = [...model.constellations.values()].find((c) => c.background?.image)!;
  const markup = renderSvgMarkup(
    model,
    { selected: new Set(), pointCap: 55 },
    { manifest, conHighlight: new Set([withArt.id]) },
  );
  expect(markup).toContain('filter id="search-glow"');
  expect(markup).toContain(`class="search-glow"`);
  expect(markup).toContain(`mask="url(#mask-${withArt.id})"`);
});

test("an unmatched constellation gets no halo", () => {
  const cons = [...model.constellations.values()].filter((c) => c.background?.image);
  const markup = renderSvgMarkup(
    model,
    { selected: new Set(), pointCap: 55 },
    { manifest, conHighlight: new Set([cons[0]!.id]) },
  );
  // Scope the assertion to the search-glow rect. A bare
  // `not.toContain('mask="url(#mask-<id>)"')` false-fails on a CORRECT implementation,
  // because the art-tint layer independently emits the same mask reference for every
  // constellation that has an affinity requirement.
  expect(markup).not.toMatch(new RegExp(`<rect class="search-glow"[^>]*mask="url\\(#mask-${cons[1]!.id}\\)"`));
});
```

Add a fourth test the halo's trickiest case needs: a matched constellation that an active affinity filter has muted still gets its halo, wrapped in `#mute-wide`. Nothing else pins that interaction.

These tests need a manifest covering every constellation's art, not just one, so the "unmatched gets no halo" case can genuinely catch an over-broad loop. Add a shared module-level `manifest` fixture if the file does not already have one.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && bunx bun test test/svgRenderer.test.ts`

Expected: FAIL — `conHighlight` is not a known property and no `search-glow` is emitted.

- [ ] **Step 3: Add the option and the filter def**

In `RenderOpts` (line ~60), after `affinityFilter`:

```ts
  // When present, a text search is active; these constellations matched on name or description
  // and glow via the search-glow halo. Star-level matches arrive folded into `highlight`.
  conHighlight?: Set<string>;
```

Add the same field to `UpdateOpts` from Task 8.

In `renderSvgMarkup`, add `conMatch: opts.conHighlight` to the `settings` object beside `benefitMatch`.

After the `#aff-glow` block, emit the search filter only when a search is active:

```ts
  const conMatched = opts.conHighlight;
  if (conMatched && conMatched.size > 0) {
    // Same construction as #aff-glow (wide blur, stacked merge for alpha density) but flooded
    // with #match-glow's neutral blue/white, so a search match reads identically whether it
    // lands on a star or a whole constellation, and never reads as an affinity colour.
    defs.push(
      `<filter id="search-glow" x="-100%" y="-100%" width="300%" height="300%" color-interpolation-filters="sRGB">` +
        `<feGaussianBlur in="SourceAlpha" stdDeviation="45" result="b"/>` +
        `<feFlood flood-color="#6cb6ff" result="c"/><feComposite in="c" in2="b" operator="in" result="g"/>` +
        `<feMerge><feMergeNode in="g"/><feMergeNode in="g"/><feMergeNode in="g"/></feMerge>` +
        `</filter>`,
    );
  }
```

- [ ] **Step 4: Emit the halo rects**

Immediately after the affinity `haloParts` loop, add a second loop pushing into the same array, so both flush on top of the art together:

```ts
  if (opts.manifest && conMatched && conMatched.size > 0) {
    for (const c of model.constellations.values()) {
      const cd0 = constellationDisplay(c, settings);
      if (!cd0.emphasis) continue;
      const name = c.background?.image?.split("/").pop() ?? "";
      const art = opts.manifest.images[name];
      if (!(art && c.background && c.background.x != null && c.background.y != null)) continue;
      const { x, y } = c.background;
      ensureMask(c.id, art.url, x, y, art.w, art.h);
      // Feels the brightness channel like the affinity halo: a matched constellation you cannot
      // reach still glows, but dimmer, so reachability keeps reading under a search.
      const op = cd0.brightness === "unattainable" ? HALO_UNREACHABLE_OPACITY : 1;
      const glow =
        `<rect class="search-glow" opacity="${op}" x="${x}" y="${y}" width="${art.w}" height="${art.h}" ` +
        `fill="#6cb6ff" mask="url(#mask-${c.id})" filter="url(#search-glow)"/>`;
      // Off-filter constellations desaturate like an off-filter star's benefit glow does, so the
      // halo reads as "matched, off-filter" instead of vanishing.
      haloParts.push(cd0.color.kind === "mute" ? `<g filter="url(#mute-wide)">${glow}</g>` : glow);
    }
  }
```

`#mute-wide` is currently only defined under `if (affFilter)`. Since `cd0.color.kind` can only be `"mute"` when an affinity filter is active, that guard already holds — but add a brief comment at the `#mute-wide` def noting search also consumes it, so a later edit does not move it.

- [ ] **Step 5: Add the CSS rule**

In `web/src/styles.css`, beside the existing `.aff-glow` rule:

```css
/* Search-match halo on constellation art. The colour and blur live in the SVG filter
   (#search-glow); this only controls how the masked source rect participates. */
.search-glow {
  pointer-events: none;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd web && bunx bun test test/svgRenderer.test.ts`

Expected: PASS.

- [ ] **Step 7: Run the gate and commit**

```bash
just check
git add web/src/adapters/svgRenderer.ts web/src/styles.css web/test/svgRenderer.test.ts
git commit -m "feat(render): glow constellation art for text-search matches

Built like the affinity halo but flooded with #match-glow's neutral blue, so a
search hit reads the same on a star and on a whole constellation."
```

### Task 10: Round-trip the query through the URL hash

Every planner view state lives in the hash. Search is no exception.

**Files:**
- Modify: `web/src/core/urlState.ts:106-173`
- Modify: `web/test/urlState.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `encodeHash(..., query: string = "")` as a new trailing parameter, and `decodeHash` returning `query: string` in its result object. Task 14 uses both.

- [ ] **Step 1: Write the failing test**

Append to `web/test/urlState.test.ts`, matching its existing `canonical`/`statCanonical` setup:

```ts
test("a query round-trips through the hash", () => {
  const h = encodeHash(new Set(), 55, canonical, new Set(), statCanonical, null, "fire res");
  expect(h).toContain("q=fire%20res");
  expect(decodeHash(h, canonical, statCanonical)!.query).toBe("fire res");
});

test("an empty query emits no q param", () => {
  expect(encodeHash(new Set(), 55, canonical, new Set(), statCanonical, null, "")).not.toContain("q=");
});

test("a missing q decodes to an empty query", () => {
  expect(decodeHash("p=55&s=", canonical, statCanonical)!.query).toBe("");
});

test("an overlong query is truncated, not rejected", () => {
  const long = "x".repeat(500);
  const decoded = decodeHash(`p=55&s=&q=${long}`, canonical, statCanonical)!;
  expect(decoded.query.length).toBe(100);
});

test("a malformed percent-escape decodes to an empty query rather than throwing", () => {
  expect(() => decodeHash("p=55&s=&q=%E0%A4%A", canonical, statCanonical)).not.toThrow();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && bunx bun test test/urlState.test.ts`

Expected: FAIL — `encodeHash` takes six parameters and the decoded object has no `query`.

- [ ] **Step 3: Extend encode and decode**

In `web/src/core/urlState.ts`, add a constant beside `MAX_CAP`:

```ts
const MAX_QUERY = 100; // a shared link carries a search box's worth of text, not a document
```

Add a trailing parameter to `encodeHash`:

```ts
  baseline: { selected: Set<StarId>; pointCap: number } | null = null,
  query: string = "",
): string {
```

and before `return out`:

```ts
  // Only when a search is active, same as b=; an empty box leaves the hash as it was.
  const q = query.trim().slice(0, MAX_QUERY);
  if (q) out += `&q=${encodeURIComponent(q)}`;
```

In `decodeHash`, widen the return type with `query: string` and, before the return:

```ts
  // URLSearchParams throws on a malformed escape; a bad q means "no search", like every
  // other param's tolerance, never a broken page.
  let query = "";
  try {
    query = (params.get("q") ?? "").trim().slice(0, MAX_QUERY);
  } catch {
    query = "";
  }
```

Then include `query` in the returned object.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && bunx bun test test/urlState.test.ts`

Expected: PASS.

- [ ] **Step 5: Run the gate and commit**

```bash
just check
git add web/src/core/urlState.ts web/test/urlState.test.ts
git commit -m "feat(url): carry the search query in the hash

Emitted only when non-empty, trimmed and capped at 100 chars, and tolerant of
malformed escapes like every other param."
```

### Task 11: Add the search panel's catalog keys

**Files:**
- Modify: all 13 `web/src/i18n/app.<locale>.json`
- Modify: `web/test/appCatalog.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: catalog keys `ui.search.label`, `ui.search.placeholder`, `ui.search.clear`, `ui.search.count`, `ui.search.none`. Task 12 resolves them.

- [ ] **Step 1: Write the failing test**

Add the five keys to the `REQUIRED` array in `web/test/appCatalog.test.ts`:

```ts
  "ui.search.label",
  "ui.search.placeholder",
  "ui.search.clear",
  "ui.search.count",
  "ui.search.none",
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && bunx bun test test/appCatalog.test.ts`

Expected: FAIL — the keys are missing from `app.en.json`.

- [ ] **Step 3: Add the English keys**

In `web/src/i18n/app.en.json`, beside the other `ui.panel.*` entries:

```json
  "ui.search.label": "Search",
  "ui.search.placeholder": "Name, stat, or power",
  "ui.search.clear": "Clear search",
  "ui.search.count": "Constellations: {cons} · Stars: {stars}",
  "ui.search.none": "No matches"
```

`ui.search.count` uses a label-and-count form rather than "7 constellations, 23 stars" on purpose: the app has no plural machinery, and Russian, Polish, and Czech plural rules would mangle "1 constellations". `ui.search.none` is a separate key rather than a zero count because "Constellations: 0 · Stars: 0" reads like a bug.

- [ ] **Step 4: Add the other 12 locales**

Translate the same five keys into each of `app.{de,fr,es,ru,zh,pl,it,cs,ja,ko,pt,vi}.json`. The `{cons}` and `{stars}` placeholders must appear verbatim in every `ui.search.count` value — `appCatalog.test.ts` compares placeholder sets across locales and fails if they differ.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && bunx bun test test/appCatalog.test.ts`

Expected: PASS.

- [ ] **Step 6: Run the gate and commit**

```bash
just check
git add web/src/i18n/ web/test/appCatalog.test.ts
git commit -m "feat(i18n): catalog keys for the search panel

Count uses a label-and-count form; the app has no plural machinery and ru/pl/cs
plural rules would mangle a bare count."
```

### Task 12: Build the search panel and stabilise the right sidebar

`renderAffinities` assigns `el.innerHTML` on the whole `#affinity` aside. An input nested inside it would be destroyed and rebuilt on every render, losing focus, caret, and typed text on the first map click. The aside therefore needs stable sub-containers. No CSS selector targets the sidebars by direct child, so wrappers are safe.

**Files:**
- Modify: `web/index.html:41`
- Create: `web/src/adapters/searchPanel.ts`
- Modify: `web/src/adapters/sidebarView.ts:207-248`
- Modify: `web/src/app/main.ts:710-736`
- Modify: `web/src/styles.css`

**Interfaces:**
- Consumes: catalog keys (Task 11), `SearchMatch` (Task 5)
- Produces: `mountSearchPanel(el: HTMLElement, loc: Localization, opts: { initial: string; onInput(q: string): void }): SearchPanelHandle` where `SearchPanelHandle = { setCount(m: SearchMatch | null): void; relocalize(loc: Localization): void; value(): string; setValue(q: string): void }`. Task 13 drives all four methods.

- [ ] **Step 1: Split the aside in index.html**

Replace line 41:

```html
    <aside id="affinity" class="sidebar">
      <div id="affinity-panel"></div>
      <div id="search-panel"></div>
      <div id="avail-panel"></div>
    </aside>
```

- [ ] **Step 2: Retarget the two renderers in main.ts**

Add element lookups beside the existing ones (~line 139):

```ts
  const affinityPanelEl = document.getElementById("affinity-panel") as HTMLElement;
  const availPanelEl = document.getElementById("avail-panel") as HTMLElement;
```

Do **not** add a `searchPanelEl` lookup here. Nothing consumes it until Task 13, and
Biome's `correctness/noUnusedVariables` is a warning, which `biome lint
--error-on-warnings` turns into a failure — this task's own `just check` in Step 6
would fail. Task 13 adds that lookup at the point of use.

In `refresh()`, pass `affinityPanelEl` to `renderAffinities` instead of `affinityEl`, and replace the three `affinityEl.insertAdjacentHTML("beforeend", ...)` blocks (lines 721-736) with a single assignment that builds the same HTML into `availPanelEl`:

```ts
    let availParts = "";
    if (availHtml)
      availParts += `<hr class="panel-sep"/><h2>${localization.translate("ui.panel.availableToGet")}</h2>${availHtml}`;
    if (petAvailHtml)
      availParts += `<hr class="panel-sep"/><h2>${localization.translate("ui.panel.petBonus")}</h2>${petAvailHtml}`;
    const availPowers = availablePowers(model, reach.reachableStars);
    if (availPowers.length)
      availParts += `<hr class="panel-sep"/><h2>${localization.translate("ui.panel.celestialPowers")}</h2>${powersListHtml(localization, availPowers)}`;
    availPanelEl.innerHTML = availParts;
```

The delegated listeners on `affinityEl` (`click`, `mousemove`, `mouseleave` at lines 386-437) keep working: they are on the aside and events from the new children still bubble to it.

- [ ] **Step 3: Verify existing behaviour is unchanged before adding the panel**

Run: `cd web && bunx bun test`

Expected: PASS. `web/test/sidebar-affinity.test.ts` and `web/test/sidebar-benefits.test.ts` exercise these renderers; if either fails, the retarget broke something — fix before continuing.

- [ ] **Step 4: Write the search panel adapter**

Create `web/src/adapters/searchPanel.ts`.

```ts
// ABOUTME: DOM adapter for the map search box and its match count.
// ABOUTME: Mounted once into a stable container, because the affinity panel rewrites its own innerHTML.
import type { SearchMatch } from "../core/search";
import type { Localization } from "../ports/Localization";

export interface SearchPanelHandle {
  /** null clears the line (empty query); a match renders counts or the empty state. */
  setCount(m: SearchMatch | null): void;
  relocalize(loc: Localization): void;
  value(): string;
  setValue(q: string): void;
}

export function mountSearchPanel(
  el: HTMLElement,
  loc: Localization,
  opts: { initial: string; onInput(q: string): void },
): SearchPanelHandle {
  let localization = loc;
  let last: SearchMatch | null = null;

  el.innerHTML =
    `<hr class="panel-sep"/><h2 id="search-h"></h2>` +
    `<div class="search-row">` +
    `<input id="search-input" type="search" autocomplete="off" spellcheck="false"/>` +
    `<button id="search-clear" type="button"></button>` +
    `</div><div id="search-count" aria-live="polite"></div>`;

  const head = el.querySelector("#search-h") as HTMLElement;
  const input = el.querySelector("#search-input") as HTMLInputElement;
  const clear = el.querySelector("#search-clear") as HTMLButtonElement;
  const count = el.querySelector("#search-count") as HTMLElement;

  function applyChrome() {
    head.textContent = localization.translate("ui.search.label");
    input.placeholder = localization.translate("ui.search.placeholder");
    input.setAttribute("aria-label", localization.translate("ui.search.label"));
    clear.setAttribute("aria-label", localization.translate("ui.search.clear"));
    clear.textContent = "✕";
  }

  function paintCount() {
    if (!last) {
      count.textContent = "";
      return;
    }
    const cons = last.constellations.size;
    const stars = last.stars.size;
    count.textContent =
      cons === 0 && stars === 0
        ? localization.translate("ui.search.none")
        : localization.translate("ui.search.count", { cons, stars });
  }

  input.value = opts.initial;
  applyChrome();
  input.addEventListener("input", () => opts.onInput(input.value));
  input.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key !== "Escape") return;
    input.value = "";
    opts.onInput("");
  });
  clear.addEventListener("click", () => {
    input.value = "";
    opts.onInput("");
    input.focus();
  });

  return {
    setCount(m) {
      last = m;
      paintCount();
    },
    relocalize(next) {
      localization = next;
      applyChrome();
      paintCount();
    },
    value: () => input.value,
    setValue(q) {
      if (input.value !== q) input.value = q;
    },
  };
}
```

- [ ] **Step 5: Add the panel styles**

In `web/src/styles.css`, beside the other sidebar rules:

```css
.search-row {
  display: flex;
  gap: 4px;
  align-items: center;
}
#search-input {
  flex: 1;
  min-width: 0;
}
#search-count {
  margin-top: 4px;
  opacity: 0.75;
  font-size: 0.9em;
}
```

Match the surrounding file's formatting conventions rather than these exact declarations if it differs.

- [ ] **Step 6: Run the gate and commit**

```bash
just check
git add web/index.html web/src/adapters/searchPanel.ts web/src/app/main.ts web/src/styles.css
git commit -m "feat(search): search panel, and stable right-sidebar containers

renderAffinities rewrites the whole aside's innerHTML, which would eat an
input's focus and text on every render, so the aside now has fixed children."
```

### Task 13: Wire search into the app

The last task: connect the index, the panel, the map, and the hash. The key constraint is that `refresh()` calls `selectionView` — the full per-click cost of the reachability engine. Typing must not pay it, so search gets its own `repaint()` that reuses the cached `reach`.

**Files:**
- Modify: `web/src/app/main.ts`

**Interfaces:**
- Consumes: everything from Tasks 4-12
- Produces: nothing

- [ ] **Step 1: Extract hash writing from refresh()**

`refresh()` currently ends by building and writing the hash (lines 760-766). Pull that into a function both paths call:

```ts
  function writeHash(urlMode: "push" | "replace") {
    const next = `#${encodeHash(state.selected, state.pointCap, canonical, selectedBenefits, benefitCanonical, baseline, query)}`;
    // Only touch history when the hash actually changed: no-op refreshes (language switch,
    // popover re-renders) must create no entry and leave the current one alone.
    if (next === location.hash) return;
    if (urlMode === "push") history.pushState(null, "", next);
    else history.replaceState(null, "", next);
  }
```

Replace the tail of `refresh()` with `writeHash(urlMode);`.

- [ ] **Step 2: Add the query state, index, and match**

Beside `selectedBenefits` (~line 104):

```ts
  // The live search query. Emphasizes matching map nodes and rides in the URL so a shared
  // link restores it, like the benefit tags.
  let query = "";
```

In `applyHash`, after the benefits restore:

```ts
    query = restored?.query ?? "";
```

After the benefit catalogs are built (~line 135):

```ts
  // The search corpus is locale-independent and built once; the index is per-locale and
  // rebuilt on a language switch (see the picker's onSelect).
  const corpus = searchCorpus(model);
  let searchIndex = resolveIndex(localization, corpus);
  let searchMatch: SearchMatch = { constellations: new Set(), stars: new Set() };
  function recomputeSearch() {
    searchMatch = matchQuery(searchIndex, query);
  }
  recomputeSearch();
```

Add the imports:

```ts
import { searchCorpus, matchQuery, type SearchMatch } from "../core/search";
import { resolveIndex } from "../adapters/searchIndex";
import { mountSearchPanel } from "../adapters/searchPanel";
```

- [ ] **Step 3: Fold search into the map's emphasis inputs**

Replace the `handle.update(...)` call in `refresh()` (the options-object form from Task 8):

```ts
    handle.update(state, {
      highlight: emphasizedStars(),
      reach,
      diff,
      affinityFilter: affinityFilterSets(),
      conHighlight: searchMatch.constellations,
    });
```

and add beside `taggedStars`:

```ts
  // Benefit tags and search share one glow: both mean "this node matches what you asked for".
  function emphasizedStars(): Set<StarId> {
    const out = taggedStars();
    for (const id of searchMatch.stars) out.add(id);
    return out;
  }
```

- [ ] **Step 4: Add the repaint path**

After `refresh()`:

```ts
  // The search-only render path. refresh() re-runs selectionView (the full per-click engine
  // cost); a keystroke must not pay that, so this reuses the cached `reach` and only redraws
  // what a query can change: map emphasis, the count line, and the hash.
  function repaint() {
    recomputeSearch();
    const diff = baseline
      ? {
          added: new Set([...state.selected].filter((s) => !baseline!.selected.has(s))),
          removed: new Set([...baseline.selected].filter((s) => !state.selected.has(s))),
        }
      : null;
    handle.update(state, {
      highlight: emphasizedStars(),
      reach,
      diff,
      affinityFilter: affinityFilterSets(),
      conHighlight: searchMatch.constellations,
    });
    searchPanel.setCount(query.trim() ? searchMatch : null);
    writeHash("replace"); // replace, so typing never floods the back button
  }
```

- [ ] **Step 5: Mount the panel with a debounce**

Add the container lookup here (Task 12 deliberately left it out, so that task's lint gate would pass), beside the other element lookups:

```ts
  const searchPanelEl = document.getElementById("search-panel") as HTMLElement;
```

Then, after the element lookups and before the first `refresh()`:

```ts
  // replaceState (in repaint) is what keeps history clean; this debounce only avoids
  // re-rendering the map on every keystroke.
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  const searchPanel = mountSearchPanel(searchPanelEl, localization, {
    initial: query,
    onInput(q) {
      query = q;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(repaint, 120);
    },
  });
```

Declare `searchPanel` before `repaint` references it, or hoist with `let searchPanel: ReturnType<typeof mountSearchPanel>;` — `tsc` will tell you which ordering it wants.

- [ ] **Step 6: Handle language switch and hashchange**

In the language picker's `onSelect` (~line 204) and the app menu's `onSelect`, after `localization` is reassigned and before `refresh()`:

```ts
      searchIndex = resolveIndex(localization, corpus);
      searchPanel.relocalize(localization);
```

In the `hashchange` handler (~line 901), after `applyHash(location.hash)`:

```ts
    searchPanel.setValue(query);
```

`refresh()` on that path recomputes the match via the `recomputeSearch()` call you add at the top of `refresh()` — add it there so both paths stay in sync:

```ts
  function refresh(urlMode: "push" | "replace" = "push") {
    completionCache.clear();
    recomputeSearch();
```

- [ ] **Step 7: Verify by hand in the browser**

Run: `just serve` and open http://localhost:5173

Check each of these:
- Typing "fire" glows stars; the count line appears; the URL gains `q=fire`.
- Typing "owl" glows the Owl constellation's art, not its individual stars.
- Typing "pet" glows stars that carry pet bonuses.
- Typing "all damage" glows stars — confirms Task 1's relabel end to end.
- Clicking a star while a query is active keeps the typed text and the caret.
- Typing eight characters then pressing Back once returns to the pre-search page, not through eight query states.
- Copying the URL into a new tab restores the query, the text in the box, and the glow.
- Switching language via the globe re-resolves matches (search "feuer" in German).
- Clearing the box removes all glow and the count line, and drops `q=` from the URL.

- [ ] **Step 8: Run the gate and commit**

```bash
just check
git add web/src/app/main.ts
git commit -m "feat(search): wire text search into the planner

Typing takes a repaint path that reuses the cached reach view rather than
re-running selectionView, and writes the hash with replaceState so a query
never adds history entries."
```

### Task 14: Document the feature

The living docs in `docs/` describe how the system works now. Update them in place; do not append a dated section.

**Files:**
- Modify: `docs/display-model.md`
- Modify: `docs/i18n.md`
- Modify: `ONBOARDING.md`

**Interfaces:**
- Consumes: everything
- Produces: nothing

- [ ] **Step 1: Update the display model doc**

In `docs/display-model.md`, extend the emphasis channel's description to cover both expressions: `benefitMatch` (star-level, fed by benefit tags and star-level search hits) and `conMatch` (constellation-level, fed by search hits on a name or description). Describe the `#search-glow` halo beside the affinity halo.

- [ ] **Step 2: Update the i18n doc**

In `docs/i18n.md`, add the search index to the list of things rebuilt on a language switch, and note that `core/search.ts` returns `Text` while `adapters/searchIndex.ts` resolves — one more instance of the pattern that section already describes.

- [ ] **Step 3: Update onboarding**

In `ONBOARDING.md`, add `web/src/core/search.ts` to the key-paths list.

- [ ] **Step 4: Verify no stale claims remain**

Run: `grep -rn "three orthogonal channels\|Total Damage" docs/ ONBOARDING.md README.md`

Expected: no hit that is now false. Fix any that are.

- [ ] **Step 5: Run the gate and commit**

```bash
just check
git add docs/ ONBOARDING.md
git commit -m "docs: describe devotion search and the constellation emphasis channel"
```

---

## Self-Review

**Spec coverage.** Part 1 relabel → Task 1. Part 2 audit scope and script → Task 2; findings applied → Task 3; the GrimTools spot check → Task 1 (fixture test) extended by Task 3. Part 3: data change → Task 4; corpus and matcher → Task 5; normalization → Task 5; resolveIndex → Task 6; display channel → Task 7; renderer halo and mute interaction → Task 9; update signature tidy → Task 8; sidebar structure → Task 12; render paths and history → Task 13; URL state → Task 10; localization → Task 11; interaction (input, clear, Escape, applyHash) → Tasks 12 and 13; testing → distributed per task. Out-of-scope items are not implemented anywhere.

**Known gaps, deliberate.** Task 3's size is unknowable before Task 2 runs; the task says so and names the fallback. Tasks 2, 3, and 4 need a Windows machine with Grim Dawn installed for their regeneration steps; each says so and states what happens if it is unavailable rather than assuming.

**Type consistency.** `SearchCorpus`, `SearchIndex`, `SearchMatch`, and `normalize` are defined in Task 5 and used under those exact names in Tasks 6, 9, 12, and 13. `UpdateOpts` is introduced in Task 8 and extended with `conHighlight` in Task 9, matching `RenderOpts.conHighlight`. `DisplaySettings.conMatch` (Task 7) is fed from `RenderOpts.conHighlight` (Task 9); the deliberate name difference mirrors the existing `RenderOpts.highlight` to `DisplaySettings.benefitMatch` pairing and is called out in the spec. `SearchPanelHandle`'s four methods (Task 12) are each driven in Task 13. `encodeHash`'s new trailing `query` parameter and `decodeHash`'s new `query` field (Task 10) are used in Task 13's `writeHash` and `applyHash`.
