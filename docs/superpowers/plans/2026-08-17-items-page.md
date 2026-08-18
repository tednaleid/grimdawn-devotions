# /items/ Skill Item Finder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/items/`, a page that answers "I am building this skill, which items should I hunt and what do they do to it", with effect text that reproduces the in-game card in all 13 locales.

**Architecture:** Three legs. The pipeline (Python, DuckDB over the pinned deposit) gains the refresh qualifier fields it currently drops. The i18n tables widen to carry the game's own format-composition tags. The page (`web/src/items/`, vanilla TS + SVG, hexagonal) renders through a new pure formatter that reproduces the game's template grammar rather than inventing wording.

**Tech Stack:** Python 3.10+ with duckdb (via `uv run`), TypeScript on Bun, Biome, `bun:test`, raw-CDP e2e.

**Spec:** [docs/superpowers/specs/2026-08-17-items-page-design.md](../specs/2026-08-17-items-page-design.md)

## Global Constraints

- Branch: `feat/skill-item-dataset`. Do not merge to main as part of this plan.
- **No phase requires Grim Dawn to be closed.** Everything reads `data/deposit/*.parquet` (pinned) and `extracted/text_*` (on disk). Never run `just deposit`, `just extract`, or the extraction half of `just i18n-tables`. Task 7 exists specifically to keep this true.
- **NEVER use `--no-verify` when committing.** No exceptions. If the hook fails, fix the cause.
- All new code files start with two `# ABOUTME: ` or `// ABOUTME: ` lines.
- No user-facing string is hardcoded. Core returns `Text` descriptors; adapters resolve through the `Localization` port. Guarded by `web/test/i18nBoundary.test.ts` and `web/test/appCatalog.test.ts`.
- No emojis, em dashes, or hyperbole in documentation or comments.
- Use `just` recipes rather than invoking tools directly. `just check` is the gate.
- Prefer the smallest reasonable change. Do not refactor unrelated code.
- Game version pinned at 1.3.0.7, steam build 24756825. Every count in this plan is measured there; if a count moves, diff the evidence before re-pinning it.
- An acceptance check is assumed vacuous until proven otherwise. Prove a gate by breaking the code and watching it fail.

---

## Phase 1: Pipeline fields

### Task 1: Carry the refresh qualifiers into skill_modifiers.parquet

`refreshCooldownAmount` and `refreshCooldownChance` already reach the table as numeric stats. The qualifiers that make them renderable (which skill, which trigger) are string keys that the numeric gate drops. They ride along on the row exactly as `from_type` / `to_type` already do for conversions.

**Files:**
- Modify: `scripts/build_derived.py:1385-1508` (`build_skill_modifiers`)
- Test: `scripts/test_build_derived.py`

**Interfaces:**
- Produces: `skill_modifiers.parquet` gains two columns, `refresh_skill VARCHAR` and `refresh_trigger VARCHAR`, both NULL on every row whose `stat_id` is not in the refresh families. Column order: `item_record, modified_skill, modifier_record, stat_id, value, from_type, to_type, refresh_skill, refresh_trigger`.

- [ ] **Step 1: Write the failing test**

Add to `scripts/test_build_derived.py`:

```python
def test_refresh_qualifiers_ride_along_on_refresh_stats():
    """Badge of the Crimson Company's Cadence block reduces LEAP's cooldown.

    Pinned to the grimtools card "25% Chance on Attack to reduce cooldown of
    Leap by 1 Second". The target is a different skill from the modified skill,
    so a reader that assumes self-targeting mislabels it.
    """
    con = duckdb.connect()
    rows = con.execute("""
        SELECT stat_id, value, refresh_skill, refresh_trigger
        FROM read_parquet('data/derived/skill_modifiers.parquet')
        WHERE item_record = 'records/items/awakened/gearaccessories/medals/c010_medal.dbr'
          AND modified_skill = 'records/skills/playerclass01/cadence1.dbr'
          AND stat_id LIKE 'refreshCooldown%'
        ORDER BY stat_id""").fetchall()
    assert rows == [
        ("refreshCooldownAmount", 1.0,
         "records/skills/playerclass10/leap1.dbr", "AttackEnemy"),
        ("refreshCooldownChance", 25.0,
         "records/skills/playerclass10/leap1.dbr", "AttackEnemy"),
    ], rows


def test_defaulted_trigger_enum_is_not_a_trigger():
    """851 of 964 refreshCooldownTrigger values are the full 13-token enum, which
    means the record made no choice. Storing it verbatim prints the enum on the card."""
    con = duckdb.connect()
    n = con.execute("""
        SELECT count(*) FROM read_parquet('data/derived/skill_modifiers.parquet')
        WHERE refresh_trigger LIKE '%;%'""").fetchone()[0]
    assert n == 0, f"{n} rows carry a multi-token trigger enum as if it were a choice"


def test_refresh_qualifiers_absent_on_unrelated_stats():
    con = duckdb.connect()
    n = con.execute("""
        SELECT count(*) FROM read_parquet('data/derived/skill_modifiers.parquet')
        WHERE stat_id NOT LIKE 'refresh%'
          AND (refresh_skill IS NOT NULL OR refresh_trigger IS NOT NULL)""").fetchone()[0]
    assert n == 0, f"{n} non-refresh rows carry a refresh qualifier"
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `uv run scripts/test_build_derived.py`
Expected: FAIL with a duckdb binder error, `Referenced column "refresh_skill" not found`.

- [ ] **Step 3: Add the qualifier CTE and the join**

In `build_skill_modifiers`, after the `conv` CTE and before `paired`, add:

```sql
        -- The refresh families name a target skill and a trigger in sibling string
        -- keys that the numeric stat gate drops. They ride along on the rows that
        -- have them, matched on the family prefix, exactly as conv does for
        -- conversions.
        --
        -- A trigger holding more than one token is the template's untouched default
        -- (the full 13-value enum, on 851 of 964 records), not a selection, so it is
        -- read as absent. Only 117 records name a real trigger.
        refresh_qual AS (
            SELECT record,
                   regexp_extract(key, '^(refreshCooldown|refreshDuration)', 1) AS family,
                   max(CASE WHEN key LIKE '%Skill' THEN trim(value) END) AS refresh_skill,
                   max(CASE WHEN key LIKE '%Trigger' AND trim(value) NOT LIKE '%;%'
                            THEN trim(value) END) AS refresh_trigger
            FROM facts
            WHERE (key IN ('refreshCooldownSkill', 'refreshCooldownTrigger',
                           'refreshDurationSkill', 'refreshDurationTrigger'))
              AND trim(value) != ''
            GROUP BY 1, 2
        ),
```

Then in the final SELECT add the columns and the join:

```sql
               c.from_type,
               c.to_type,
               rq.refresh_skill,
               rq.refresh_trigger
        FROM paired p
        JOIN stat_record sr ON sr.root = p.modifier_record
        JOIN facts f ON f.record = sr.cur
```

and alongside the existing `LEFT JOIN conv`:

```sql
        LEFT JOIN refresh_qual rq ON rq.record = sr.cur
                                 AND rq.family = regexp_extract(
                                       f.key, '^(refreshCooldown|refreshDuration)', 1)
```

Note `regexp_extract` returns `''` for a non-refresh key, and no `refresh_qual` row has an empty family, so the join finds nothing on unrelated stats without needing a guard.

- [ ] **Step 4: Rebuild and run the tests**

Run: `just derive && uv run scripts/test_build_derived.py`
Expected: PASS, all three tests.

- [ ] **Step 5: Prove the trigger gate is not vacuous**

Temporarily delete `AND trim(value) NOT LIKE '%;%'` from the `refresh_qual` CTE, run `just derive`, and confirm `test_defaulted_trigger_enum_is_not_a_trigger` FAILS with a non-zero count. Restore the line and re-run to green. A gate that cannot fail is not a gate.

- [ ] **Step 6: Commit**

```bash
git add scripts/build_derived.py scripts/test_build_derived.py data/derived/skill_modifiers.parquet
git commit -m "feat(derive): carry refresh target and trigger onto modifier rows"
```

---

### Task 2: Emit the qualifiers in skill-items.json

**Files:**
- Modify: `scripts/build_skill_items.py:172-176` (the `mods` query) and `:198-211` (the stat assembly)
- Test: `scripts/test_build_skill_items.py`

**Interfaces:**
- Consumes: `refresh_skill`, `refresh_trigger` from Task 1.
- Produces: a modifier stat entry may now carry `refresh_skill` (a skill record path) and `refresh_trigger` (one of `AttackEnemy`, `AttackEnemyCrit`, `Block`, `HitByEnemy`, `OnKill`). Both are absent, not null, when they do not apply, matching how `from_tag` / `to_tag` behave.

- [ ] **Step 1: Write the failing test**

```python
def test_refresh_qualifiers_reach_the_payload():
    doc = json.loads(Path("data/skill-items.json").read_text(encoding="utf-8"))
    item = next(i for i in doc["items"]
                if i["record"].endswith("awakened/gearaccessories/medals/c010_medal.dbr"))
    block = next(m for m in item["modifiers"]
                 if m["skill"] == "records/skills/playerclass01/cadence1.dbr")
    amount = next(s for s in block["stats"] if s["stat"] == "refreshCooldownAmount")
    assert amount["refresh_skill"] == "records/skills/playerclass10/leap1.dbr"
    assert amount["refresh_trigger"] == "AttackEnemy"
    bleed = next(s for s in block["stats"] if s["stat"] == "offensiveSlowBleedingMin")
    assert "refresh_skill" not in bleed
    assert "refresh_trigger" not in bleed
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `uv run scripts/test_build_skill_items.py`
Expected: FAIL with `KeyError: 'refresh_skill'`.

- [ ] **Step 3: Widen the query and the assembly**

In the `mods = group(...)` call, add the two columns to the SELECT list:

```python
    mods = group("""SELECT m.item_record, m.modified_skill, m.stat_id, m.value,
                           m.from_type, m.to_type, m.refresh_skill, m.refresh_trigger
                    FROM skill_modifiers m JOIN top t ON t.record = m.item_record
                    ORDER BY m.item_record, m.modified_skill, m.modifier_record,
                             m.stat_id""", "item_record")
```

In the per-stat loop, after the conversion block:

```python
            # A refresh amount reads as a bare number without the skill it targets
            # and the trigger that fires it. The target is frequently a different
            # skill from the block's own (Badge of the Crimson Company sits on
            # Cadence and reduces Leap), so it cannot be inferred at read time.
            if m["refresh_skill"] is not None:
                stat["refresh_skill"] = m["refresh_skill"]
            if m["refresh_trigger"] is not None:
                stat["refresh_trigger"] = m["refresh_trigger"]
```

- [ ] **Step 4: Rebuild and run the tests**

Run: `just skill-items && uv run scripts/test_build_skill_items.py`
Expected: PASS.

- [ ] **Step 5: Check the payload size warning did not trip**

The emitter prints `first load: N KB gzipped` and warns above 400. Confirm the printed number is still near 257 KB. If it jumped, stop and investigate before committing.

- [ ] **Step 6: Commit**

```bash
git add scripts/build_skill_items.py scripts/test_build_skill_items.py data/skill-items.json
git commit -m "feat(items): emit refresh target and trigger on modifier stats"
```

---

### Task 3: Give the composed stat ids their tags

Twelve ids sit in `NON_DISPLAY` marked "composed into ...". They are real card lines (281 occurrences across 108 items) and now have the data to render.

**Files:**
- Modify: `scripts/build_stat_item_tags.py:135-187` (`NON_DISPLAY`) and the `ALIASES` table above it
- Test: `scripts/test_build_stat_item_tags.py`

**Interfaces:**
- Produces: `data/stat-item-tags.json` gains entries for `refreshCooldownAmount`, `refreshCooldownChance`, `refreshDurationAmount`, `refreshDurationChance`, `refreshDurationMax`. The other seven composed ids stay in `NON_DISPLAY` with their reasons unchanged; they are chance and duration facets the formatter reads off a sibling, not lines of their own.

- [ ] **Step 1: Write the failing test**

```python
def test_refresh_ids_resolve_to_their_composed_tags():
    tags = json.loads(Path("data/stat-item-tags.json").read_text(encoding="utf-8"))
    assert tags["refreshCooldownAmount"] == "tagSkillCooldownRefresh"
    assert tags["refreshCooldownChance"] == "tagSkillCooldownRefresh"
    assert tags["refreshDurationAmount"] == "tagSkillDurationRefresh"
    assert tags["refreshDurationChance"] == "tagSkillDurationRefresh"
    assert tags["refreshDurationMax"] == "tagSkillDurationRefreshMax"


def test_remaining_non_display_ids_stay_excluded():
    tags = json.loads(Path("data/stat-item-tags.json").read_text(encoding="utf-8"))
    for sid in ("onHitActivationChance", "skillProcChance", "offensiveGlobalChance",
                "defensiveManaBurn", "defensiveProtectionChance",
                "skillLifeBonusBuffDuration", "skillLifePercentBuffDuration"):
        assert sid not in tags, f"{sid} should still be declared non-display"
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `uv run scripts/test_build_stat_item_tags.py`
Expected: FAIL with `KeyError: 'refreshCooldownAmount'`.

- [ ] **Step 3: Move the five ids from NON_DISPLAY to ALIASES**

Delete these five entries from `NON_DISPLAY` and add to `ALIASES`:

```python
    # The refresh families compose one card line from an amount, a chance, and the
    # target/trigger qualifiers carried alongside them since 2026-08-17. Amount and
    # chance share the family's tag; the formatter reads both off the block and
    # renders a single line. Pinned to Badge of the Crimson Company, whose card reads
    # "25% Chance on Attack to reduce cooldown of Leap by 1 Second".
    "refreshCooldownAmount": "tagSkillCooldownRefresh",
    "refreshCooldownChance": "tagSkillCooldownRefresh",
    "refreshDurationAmount": "tagSkillDurationRefresh",
    "refreshDurationChance": "tagSkillDurationRefresh",
    "refreshDurationMax": "tagSkillDurationRefreshMax",
```

Note `tagSkillCooldownRefreshName` is the variant used when a target skill is named. It is not in this map because it is selected by the formatter from the presence of `refresh_skill`, not by the stat id. Task 8 pulls it into the tag tables directly.

- [ ] **Step 4: Rebuild and run the tests**

Run: `just stat-item-tags && uv run scripts/test_build_stat_item_tags.py`
Expected: PASS. The run also prints its unresolved count; confirm it is still 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/build_stat_item_tags.py scripts/test_build_stat_item_tags.py data/stat-item-tags.json
git commit -m "feat(tags): label the refresh families instead of declaring them non-display"
```

---

## Phase 2: Tag tables

### Task 4: Split extraction out of `i18n-tables`

`just i18n-tables` is `rm -rf`-then-re-extract, so it is guarded by `_require-game-closed`. The table build itself only reads `extracted/text_<lang>/`. Splitting them lets the tables be rebuilt while the game is running, which every later task needs.

**Files:**
- Modify: `justfile:281-324`

**Interfaces:**
- Produces: `just i18n-tables` keeps its current behaviour and its guard. A new `just i18n-tables-rebuild *LANGS` rebuilds `data/i18n/game.<lang>.json` from the already-extracted trees with no guard and no archive access.

- [ ] **Step 1: Extract the build loop into its own recipe**

Add below `i18n-tables`:

```make
# Rebuild data/i18n/game.<lang>.json from the trees `i18n-tables` already extracted.
# Unguarded on purpose: this reads extracted/text_<lang>/ and never touches the game's
# archives, so it is safe while Grim Dawn is running. Use it whenever only the tag
# SELECTION changed (a new tag referenced by a dataset) rather than the game's text.
[group("devotions")]
[doc("Rebuild game.<lang>.json from already-extracted text, without the game")]
i18n-tables-rebuild *LANGS:
    #!/usr/bin/env bash
    set -euo pipefail
    langs="{{LANGS}}"
    if [ -z "$langs" ]; then
      langs=$(ls -d "{{justfile_directory()}}"/extracted/text_* 2>/dev/null \
        | sed -E 's#.*/text_##' | sort | tr '\n' ' ')
    fi
    built=""; skipped=""
    for L in $langs; do
      if [ "$L" = "en" ]; then tdir="{{text_dir}}"; else tdir="{{justfile_directory()}}/extracted/text_$L"; fi
      if [ "$(find "$tdir" -name '*.txt' 2>/dev/null | wc -l)" -eq 0 ]; then
        echo "skip $L (no extracted text at $tdir)"; skipped="$skipped $L"; continue
      fi
      uv run scripts/build_game_tables.py --devotions "{{out}}" --stat-tags data/stat-tags.json \
        --stat-format-tags data/stat-format-tags.json --rr "{{out_rr}}" --monsters "{{out_mon}}" \
        --skill-items "data/skill-items.json" --stat-item-tags "data/stat-item-tags.json" \
        --text-dir "$tdir" --lang "$L" --out "data/i18n/game.$L.json"
      built="$built $L"
    done
    echo "built:$built"
    [ -n "$skipped" ] && echo "skipped:$skipped" || true
```

- [ ] **Step 2: Verify it runs with the game open and changes nothing yet**

Run: `git status --short data/i18n/ && just i18n-tables-rebuild && git status --short data/i18n/`
Expected: 13 languages reported under `built:`, and no file content changes, because the tag selection has not moved yet. This is the proof that the recipe is a faithful rebuild rather than a different computation.

- [ ] **Step 3: Commit**

```bash
git add justfile
git commit -m "build: add i18n-tables-rebuild, which needs no game access"
```

---

### Task 5: Widen the tag selection to the composers

**Files:**
- Modify: `scripts/build_game_tables.py:31-86`
- Test: `scripts/test_build_game_tables.py`

**Interfaces:**
- Produces: `data/i18n/game.<lang>.json` gains the composition tags. `collect_referenced_tags` gains no new parameter; the set is a module constant, because these tags are referenced by the formatter's grammar rather than by any dataset.

- [ ] **Step 1: Write the failing test**

```python
def test_composer_tags_reach_the_english_table():
    g = json.loads(Path("data/i18n/game.en.json").read_text(encoding="utf-8"))
    for tag in ("DamageSingleFormatTime", "DamageRangeFormatTime", "SkillSecondFormat",
                "SkillDistanceFormat", "SkillCostFormat", "SkillPercentFormat",
                "SkillIntFormat", "tagSecond", "tagSeconds",
                "tagSkillCooldownRefresh", "tagSkillCooldownRefreshName",
                "tagSkillDurationRefresh"):
        assert tag in g, f"{tag} missing from game.en.json"
    assert g["DamageSingleFormatTime"] == "over {%.1f0} Seconds"
    assert g["tagSkillCooldownRefreshName"] == \
        "{%t0} to reduce cooldown of {%s1} by {%.1f2} {%z3}"


def test_every_used_trigger_has_a_condition_tag():
    g = json.loads(Path("data/i18n/game.en.json").read_text(encoding="utf-8"))
    for tag in ("tagRefreshSkillCondition03", "tagRefreshSkillCondition07",
                "tagRefreshSkillCondition10", "tagRefreshSkillCondition11",
                "tagRefreshSkillCondition12"):
        assert tag in g, f"{tag} missing; a trigger would render unlabelled"
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `uv run scripts/test_build_game_tables.py`
Expected: FAIL, `DamageSingleFormatTime missing from game.en.json`.

- [ ] **Step 3: Add the constant and union it in**

Above `collect_referenced_tags`:

```python
# Tags the /items/ effect formatter composes with, rather than any dataset naming them.
# The game builds a stat line from a label tag plus one of these, so reproducing its
# wording means shipping them to every locale. See the effect-text section of
# docs/superpowers/specs/2026-08-17-items-page-design.md.
COMPOSER_TAGS = frozenset({
    # Damage-over-time and range suffixes ("over 2 Seconds").
    "DamageSingleFormatTime", "DamageRangeFormatTime",
    "DamageFixedSingleFormatTime", "DamageFixedRangeFormatTime",
    # Value-plus-label composers for the 32 tags that carry no template of their own.
    "SkillSecondFormat", "SkillDistanceFormat", "SkillCostFormat",
    "SkillPercentFormat", "SkillIntFormat", "SkillFloatFormat",
    # Pluralized units, selected by the composition site against its value.
    "tagSecond", "tagSeconds",
    # The refresh families' composed lines. The *Name variant is chosen when the
    # record names a target skill.
    "tagSkillCooldownRefresh", "tagSkillCooldownRefreshName",
    "tagSkillDurationRefresh", "tagSkillDurationRefreshMax",
} | {f"tagRefreshSkillCondition{n:02d}" for n in range(1, 13)})
```

At the end of `collect_referenced_tags`, beside the other `tags.update(...)` calls:

```python
    tags.update(COMPOSER_TAGS)
```

- [ ] **Step 4: Rebuild all 13 locales and run the tests**

Run: `just i18n-tables-rebuild && uv run scripts/test_build_game_tables.py`
Expected: PASS. `built:` lists 13 languages.

- [ ] **Step 5: Re-run the staleness guard**

Run: `uv run scripts/test_dataset_i18n_fresh.py`
Expected: FAILURES: 0. Per-locale shortfalls report as notes, not failures, because Crate's tables are sparse.

- [ ] **Step 6: Commit**

```bash
git add scripts/build_game_tables.py scripts/test_build_game_tables.py data/i18n/
git commit -m "feat(i18n): ship the game's format-composition tags to every locale"
```

---

## Phase 3: The effect formatter

This phase carries the risk. Nothing in phase 4 or later starts before its oracles pass.

### Task 6: The `gameFormat` text descriptor

The game's format string is a sequence of literal text and brace groups. Inside a group, `%<spec><index>` substitutes an argument and every other character is literal. That single rule covers `{%.0f0}`, `{%.1f0 Second %s1}` (literal text between two substitutions), `{-%.0f0}` (a literal minus), and `{%.0f0%}` (a literal percent).

**Files:**
- Modify: `web/src/core/localization.ts:41-90`
- Test: `web/test/localization.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type FormatArg = number | [number, number] | string | Text;
  // added to the Text union:
  | { k: "gameFormat"; tag: string; args: FormatArg[] }
  export const gameFormatT = (tag: string, args: FormatArg[]): Text =>
    ({ k: "gameFormat", tag, args });
  export function applyGameFormat(
    template: string, args: FormatArg[], resolve: (t: Text) => string): string;
  ```
  Conversion letters: `f` fixed-point at the given precision, `d` rounded integer, `s` and `z` a resolved string or `Text`, `t` a nested `Text`, a `[min, max]` pair rendered `min-max`, or a bare number. A `+` in the spec forces the sign on a non-negative value.

- [ ] **Step 1: Write the failing test**

```ts
import { applyGameFormat, gameFormatT, resolveText, makeLocalization } from "../src/core/localization";

// makeLocalization(active, fallback, locale, gameActive, gameFallback)
const loc = makeLocalization({}, {}, "en", {}, {});

describe("applyGameFormat", () => {
  const r = (t: any) => resolveText(loc, t);
  test("fixed point with precision", () => {
    expect(applyGameFormat("{%.1f0} Seconds", [2], r)).toBe("2.0 Seconds");
  });
  test("forced sign only on non-negative", () => {
    expect(applyGameFormat("{%+.0f0}% Attack Speed", [5], r)).toBe("+5% Attack Speed");
    expect(applyGameFormat("{%+.0f0}% Attack Speed", [-5], r)).toBe("-5% Attack Speed");
  });
  test("integer conversion rounds", () => {
    expect(applyGameFormat("{%d0}% Chance to be Used", [24.6], r)).toBe("25% Chance to be Used");
  });
  test("literal text and two args inside one group", () => {
    expect(applyGameFormat("{%.1f0 Second %s1}", [3, "Skill Recharge"], r))
      .toBe("3.0 Second Skill Recharge");
  });
  test("a literal minus inside the group is printed", () => {
    expect(applyGameFormat("{-%.0f0}% Shield Recovery Time", [20], r))
      .toBe("-20% Shield Recovery Time");
  });
  test("a literal percent inside the group is printed", () => {
    expect(applyGameFormat("{%.0f0%} Weapon Damage", [180], r)).toBe("180% Weapon Damage");
  });
  test("t renders a number pair as a range", () => {
    expect(applyGameFormat("{%t0} Fire Damage", [[120, 180]], r)).toBe("120-180 Fire Damage");
  });
  test("t renders a lone number plainly", () => {
    expect(applyGameFormat("{%t0} Fire Damage", [200], r)).toBe("200 Fire Damage");
  });
  test("an unsupplied argument leaves no token behind", () => {
    expect(applyGameFormat("{%t0} to reduce cooldown by {%.1f1} {%z2}", [], r)).toBe("to reduce cooldown by");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd web && bun test test/localization.test.ts`
Expected: FAIL, `applyGameFormat is not a function`.

- [ ] **Step 3: Implement the grammar**

In `web/src/core/localization.ts`:

```ts
export type FormatArg = number | [number, number] | string | Text;

// One substitution inside a brace group: %[sign][.precision]<conv><index>.
// Everything else inside the group is literal, which is what makes
// "{%.1f0 Second %s1}" and "{-%.0f0}" fall out of the same rule.
const SUBST = /%([+-]?)(?:\.(\d))?([a-z])(\d)/g;

function fmtNumber(n: number, sign: string, precision: string | undefined, conv: string): string {
  const v = conv === "d" ? String(Math.round(n)) : n.toFixed(precision ? Number(precision) : 0);
  return sign === "+" && n >= 0 ? `+${v}` : v;
}

/** Substitute a game format template. `resolve` renders a Text argument. */
export function applyGameFormat(
  template: string,
  args: FormatArg[],
  resolve: (t: Text) => string,
): string {
  const out = template.replace(/\{([^}]*)\}/g, (_all, body: string) =>
    body.replace(SUBST, (_m, sign: string, precision: string | undefined, conv: string, idx: string) => {
      const a = args[Number(idx)];
      if (a === undefined) return "";
      if (conv === "s" || conv === "z") return typeof a === "object" && !Array.isArray(a) ? resolve(a) : String(a);
      if (conv === "t") {
        if (Array.isArray(a)) return `${fmtNumber(a[0], "", "0", "f")}-${fmtNumber(a[1], "", "0", "f")}`;
        if (typeof a === "object") return resolve(a);
        return fmtNumber(Number(a), sign, precision, "f");
      }
      return fmtNumber(Number(a), sign, precision, conv);
    }),
  );
  // Dropping an unsupplied argument can leave doubled or edge whitespace behind.
  return out.replace(/\s{2,}/g, " ").trim();
}
```

Add the union member and constructor beside the others:

```ts
  | { k: "gameFormat"; tag: string; args: FormatArg[] };

export const gameFormatT = (tag: string, args: FormatArg[]): Text => ({ k: "gameFormat", tag, args });
```

and the `resolveText` case:

```ts
    case "gameFormat":
      return applyGameFormat(loc.gameText(t.tag), t.args, (x) => resolveText(loc, x));
```

- [ ] **Step 4: Run the tests**

Run: `cd web && bun test test/localization.test.ts`
Expected: PASS.

- [ ] **Step 5: Teach the i18n boundary guard about the new kind**

Run: `cd web && bun test test/i18nBoundary.test.ts test/appCatalog.test.ts`
If either guard enumerates `Text` kinds, add `gameFormat` to its list. Do not weaken a guard to make it pass; a `gameFormat` descriptor is a legitimate localized descriptor exactly like `game`.

- [ ] **Step 6: Commit**

```bash
git add web/src/core/localization.ts web/test/localization.test.ts
git commit -m "feat(i18n): add the gameFormat descriptor for the game's template grammar"
```

---

### Task 7: The effect formatter, single-stat lines

**Files:**
- Create: `web/src/items/core/effectText.ts`
- Create: `web/test/items/effectText.test.ts`

**Interfaces:**
- Consumes: `gameFormatT`, `gameT`, `joinT` from `web/src/core/localization`.
- Produces:
  ```ts
  export interface ModStat { stat: string; value: number;
    from_tag?: string; to_tag?: string;
    refresh_skill?: string; refresh_trigger?: string; }
  export interface EffectContext { tagOf: (statId: string) => string | undefined;
    templateOf: (tag: string) => string | undefined;
    nameOf: (skillRecord: string) => Text | undefined; }
  export function effectLines(stats: ModStat[], ctx: EffectContext): Text[];
  ```
  `effectLines` returns one `Text` per card line, in a stable order: the input's order, with each composed group taking the position of its first member. A stat whose tag is unknown is dropped, not rendered raw.

- [ ] **Step 1: Write the failing test**

```ts
import { effectLines } from "../../src/items/core/effectText";
import { resolveText, makeLocalization } from "../../src/core/localization";

const GAME: Record<string, string> = {
  DamageFire: "{%t0} Fire Damage",
  tagCharAttackSpeed: "{%+.0f0}% Attack Speed",
  SkillWeaponDamageFormat: "{%.0f0%} Weapon Damage",
};
const TAGS: Record<string, string> = {
  offensiveFireMin: "DamageFire",
  offensiveFireMax: "DamageFire",
  characterAttackSpeed: "tagCharAttackSpeed",
  weaponDamagePct: "SkillWeaponDamageFormat",
};
const ctx = {
  tagOf: (s: string) => TAGS[s],
  templateOf: (t: string) => GAME[t],
  nameOf: () => undefined,
};
const loc = makeLocalization({}, {}, "en", GAME, GAME);
const render = (stats: any[]) => effectLines(stats, ctx).map((t) => resolveText(loc, t));

test("a templated stat renders through its own template", () => {
  expect(render([{ stat: "characterAttackSpeed", value: 5 }])).toEqual(["+5% Attack Speed"]);
});
test("a lone min renders as a single value, not a range", () => {
  expect(render([{ stat: "offensiveFireMin", value: 200 }])).toEqual(["200 Fire Damage"]);
});
test("min and max collapse into one range line", () => {
  expect(render([
    { stat: "offensiveFireMin", value: 120 },
    { stat: "offensiveFireMax", value: 180 },
  ])).toEqual(["120-180 Fire Damage"]);
});
test("an unknown stat is dropped rather than rendered raw", () => {
  expect(render([{ stat: "overwriteBaseSkill", value: 1 }])).toEqual([]);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd web && bun test test/items/effectText.test.ts`
Expected: FAIL, cannot find module `effectText`.

- [ ] **Step 3: Implement the min/max grouping and single-line rendering**

```ts
// ABOUTME: Turns a modifier block's raw stats into the card lines the game would show.
// ABOUTME: Pure and i18n-free: returns Text descriptors built from the game's own tags.
import { type Text, type FormatArg, gameFormatT, gameT } from "../../core/localization";

export interface ModStat {
  stat: string;
  value: number;
  from_tag?: string;
  to_tag?: string;
  refresh_skill?: string;
  refresh_trigger?: string;
}

export interface EffectContext {
  tagOf: (statId: string) => string | undefined;
  templateOf: (tag: string) => string | undefined;
  nameOf: (skillRecord: string) => Text | undefined;
}

const RANGE = /^(.*)(Min|Max)$/;

/** One card line per group, in first-appearance order. */
export function effectLines(stats: ModStat[], ctx: EffectContext): Text[] {
  const byId = new Map(stats.map((s) => [s.stat, s]));
  const used = new Set<string>();
  const out: Text[] = [];

  for (const s of stats) {
    if (used.has(s.stat)) continue;
    const tag = ctx.tagOf(s.stat);
    if (!tag) continue;
    const line = renderOne(s, byId, used, ctx, tag);
    if (line) out.push(line);
  }
  return out;
}

function renderOne(
  s: ModStat, byId: Map<string, ModStat>, used: Set<string>,
  ctx: EffectContext, tag: string,
): Text | null {
  used.add(s.stat);
  const template = ctx.templateOf(tag);
  if (!template) return null;

  // A Min with its Max is one range line; a lone Min is a single value. Min appears
  // alone far more often than paired (1,715 against 80), so the lone case is normal.
  const m = s.stat.match(RANGE);
  if (m && m[2] === "Min") {
    const max = byId.get(`${m[1]}Max`);
    if (max) {
      used.add(max.stat);
      return gameFormatT(tag, [[s.value, max.value] as FormatArg]);
    }
  }
  return gameFormatT(tag, [s.value]);
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && bun test test/items/effectText.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/items/core/effectText.ts web/test/items/effectText.test.ts
git commit -m "feat(items): render single and ranged modifier stat lines"
```

---

### Task 8: Damage over time, conversions, and refresh lines

The three composed families, each pinned to a real grimtools card.

**Files:**
- Modify: `web/src/items/core/effectText.ts`
- Modify: `web/test/items/effectText.test.ts`

**Interfaces:**
- Consumes: `ModStat.refresh_skill`, `ModStat.refresh_trigger` from Task 2; the tags from Task 5.
- Produces: no signature change. `effectLines` gains three grouping rules.

- [ ] **Step 1: Write the failing oracle tests**

```ts
const CARD_GAME: Record<string, string> = {
  ...GAME,
  DamageDurationBleeding: "Bleeding Damage",
  DamageDurationPoison: "Poison Damage",
  DamageSingleFormatTime: "over {%.1f0} Seconds",
  tagDamageConversion: "{%.0f0}% {%s1} converted to {%s2}",
  tagCharStatsVitality: "Vitality",
  tagCharStatsFire: "Fire",
  tagSkillCooldownRefreshName: "{%t0} to reduce cooldown of {%s1} by {%.1f2} {%z3}",
  tagSkillCooldownRefresh: "{%t0} to reduce cooldown by {%.1f1} {%z2}",
  tagRefreshSkillCondition07: "{%d0}% Chance on Attack",
  tagSecond: "Second",
  tagSeconds: "Seconds",
};
// tagOf gains: offensiveSlowBleedingMin/DurationMin -> DamageDurationBleeding,
// offensiveSlowPoisonMin/DurationMin -> DamageDurationPoison,
// conversionPercentage -> tagDamageConversion,
// refreshCooldownAmount/Chance -> tagSkillCooldownRefresh.

test("Badge of the Crimson Company: DoT total is the per-second value times duration", () => {
  // grimtools card: "300 Bleeding Damage over 2 Seconds"
  expect(cardRender([
    { stat: "offensiveSlowBleedingDurationMin", value: 2 },
    { stat: "offensiveSlowBleedingMin", value: 150 },
  ])).toEqual(["300 Bleeding Damage over 2 Seconds"]);
});

test("Scarstone Memento: the same rule at a different duration", () => {
  // grimtools card: "400 Poison Damage over 5 Seconds"
  expect(cardRender([
    { stat: "offensiveSlowPoisonDurationMin", value: 5 },
    { stat: "offensiveSlowPoisonMin", value: 80 },
  ])).toEqual(["400 Poison Damage over 5 Seconds"]);
});

test("Badge of the Crimson Company: the refresh line names its target and trigger", () => {
  // grimtools card: "25% Chance on Attack to reduce cooldown of Leap by 1 Second"
  expect(cardRender([
    { stat: "refreshCooldownAmount", value: 1,
      refresh_skill: "records/skills/playerclass10/leap1.dbr", refresh_trigger: "AttackEnemy" },
    { stat: "refreshCooldownChance", value: 25,
      refresh_skill: "records/skills/playerclass10/leap1.dbr", refresh_trigger: "AttackEnemy" },
  ])).toEqual(["25% Chance on Attack to reduce cooldown of Leap by 1 Second"]);
});

test("a refresh line with no target skill uses the unnamed variant", () => {
  expect(cardRender([
    { stat: "refreshCooldownAmount", value: 2, refresh_trigger: "AttackEnemy" },
    { stat: "refreshCooldownChance", value: 30, refresh_trigger: "AttackEnemy" },
  ])).toEqual(["30% Chance on Attack to reduce cooldown by 2.0 Seconds"]);
});

test("Scarstone Memento: two conversions on one block stay two lines", () => {
  expect(cardRender([
    { stat: "conversionPercentage", value: 100,
      from_tag: "tagCharStatsVitality", to_tag: "tagCharStatsFire" },
    { stat: "conversionPercentage2", value: 20,
      from_tag: "tagCharStatsFire", to_tag: "tagCharStatsVitality" },
  ])).toEqual(["100% Vitality converted to Fire", "20% Fire converted to Vitality"]);
});
```

`cardRender` is `render` bound to `CARD_GAME` and the widened `tagOf`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && bun test test/items/effectText.test.ts`
Expected: FAIL on all five, with the DoT case reporting `["150 Bleeding Damage"]`, which is exactly the silent understatement the spec's oracle caught.

- [ ] **Step 3: Add the three rules**

Add above `renderOne`:

```ts
// The five triggers that actually occur, mapped to the game's condition tags. 851 of
// 964 records carry the untouched 13-token enum instead of a choice; the pipeline
// reads those as absent, so anything arriving here is a real selection.
const TRIGGER_TAG: Record<string, string> = {
  HitByEnemy: "tagRefreshSkillCondition03",
  AttackEnemy: "tagRefreshSkillCondition07",
  AttackEnemyCrit: "tagRefreshSkillCondition10",
  Block: "tagRefreshSkillCondition11",
  OnKill: "tagRefreshSkillCondition12",
};
const DOT = /^offensiveSlow(.+?)(Duration)?Min$/;
const REFRESH = /^(refreshCooldown|refreshDuration)(Amount|Chance)$/;

const unit = (v: number): Text => gameT(v === 1 ? "tagSecond" : "tagSeconds");
```

Inside `renderOne`, before the range rule:

```ts
  // Damage over time. The record stores damage per second and the card shows the
  // total, so the line's value is the product. Pinned to Badge of the Crimson
  // Company (150 over 2s reads 300) and Scarstone Memento (80 over 5s reads 400).
  const dot = s.stat.match(DOT);
  if (dot && !dot[2]) {
    const dur = byId.get(`offensiveSlow${dot[1]}DurationMin`);
    if (dur) {
      used.add(dur.stat);
      const suffix = ctx.templateOf("DamageSingleFormatTime");
      const total = gameFormatT(tag, [s.value * dur.value]);
      return suffix ? joinT(total, " ", gameFormatT("DamageSingleFormatTime", [dur.value])) : total;
    }
  }

  // A refresh family composes one line from its amount, its chance, and the target
  // and trigger the pipeline carries alongside them. The target is frequently a
  // different skill from the block's own, so it is never inferred.
  const ref = s.stat.match(REFRESH);
  if (ref) {
    const family = ref[1];
    const amount = byId.get(`${family}Amount`);
    const chance = byId.get(`${family}Chance`);
    if (!amount) return null;
    used.add(`${family}Amount`);
    used.add(`${family}Chance`);
    const q = amount.refresh_trigger ? TRIGGER_TAG[amount.refresh_trigger] : undefined;
    const cond: FormatArg = q ? gameFormatT(q, [chance?.value ?? 0]) : (chance?.value ?? 0);
    const target = amount.refresh_skill ? ctx.nameOf(amount.refresh_skill) : undefined;
    return target
      ? gameFormatT(`${family === "refreshCooldown" ? "tagSkillCooldownRefreshName" : "tagSkillDurationRefresh"}`,
                    [cond, target, amount.value, unit(amount.value)])
      : gameFormatT(`${family === "refreshCooldown" ? "tagSkillCooldownRefresh" : "tagSkillDurationRefresh"}`,
                    [cond, amount.value, unit(amount.value)]);
  }

  // Each conversion percentage is its own line, carrying its own type pair. They
  // share one tag, so a naive shared-tag merge would wrongly fuse them on 148 blocks.
  if (s.stat.startsWith("conversionPercentage") && s.from_tag && s.to_tag) {
    return gameFormatT(tag, [s.value, gameT(s.from_tag), gameT(s.to_tag)]);
  }
```

Import `joinT` alongside the existing imports.

- [ ] **Step 4: Run the tests**

Run: `cd web && bun test test/items/effectText.test.ts`
Expected: PASS, all nine.

- [ ] **Step 5: Prove the DoT rule is load-bearing**

Change `s.value * dur.value` to `s.value`, re-run, and confirm both DoT oracles FAIL with 150 and 80. Restore and re-run to green.

- [ ] **Step 6: Commit**

```bash
git add web/src/items/core/effectText.ts web/test/items/effectText.test.ts
git commit -m "feat(items): compose DoT, conversion and refresh card lines"
```

---

### Task 9: The 32 plain labels and their composers

**Files:**
- Modify: `web/src/items/core/effectText.ts`
- Modify: `web/test/items/effectText.test.ts`

**Interfaces:**
- Produces: `export const COMPOSER: Record<string, string>` mapping a plain label tag to its composer tag. A plain tag with no entry falls back to a bare value prefix.

- [ ] **Step 1: Write the failing test**

```ts
test("a seconds-unit label composes through SkillSecondFormat", () => {
  // CooldownTime = "Skill Recharge", SkillSecondFormat = "{%.1f0 Second %s1}"
  expect(cardRender([{ stat: "skillCooldownTime", value: 3 }]))
    .toEqual(["3.0 Second Skill Recharge"]);
});
test("a label already carrying its percent takes a bare value prefix", () => {
  // DamageDurationTotalSpeed = "% Slow target"
  expect(cardRender([{ stat: "offensiveSlowTotalSpeedMin", value: 25 }]))
    .toEqual(["25% Slow target"]);
});
test("a radius label composes through SkillDistanceFormat", () => {
  expect(cardRender([{ stat: "skillTargetRadius", value: 4 }]))
    .toEqual(["4.0 Meter Target Area"]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && bun test test/items/effectText.test.ts`
Expected: FAIL. A plain label currently renders through `gameFormatT(tag, [value])`, and a template with no placeholder ignores its argument, so the value vanishes: `["Skill Recharge"]`.

- [ ] **Step 3: Add the composer table and the plain-label branch**

```ts
// The 32 tags that carry no template of their own need a composer and a unit. Each
// row is pinned to a grimtools card rather than guessed. A tag absent from this map
// falls back to a bare value prefix, which is correct for the labels that already
// carry their own "%" ("% Slow target") and for plain counts.
export const COMPOSER: Record<string, string> = {
  CooldownTime: "SkillSecondFormat",          // "Skill Recharge"
  ActiveDuration: "SkillSecondFormat",        // "Duration"
  ComboChargeDuration: "SkillSecondFormat",   // "Onslaught Stack Duration"
  SkillChargeDuration: "SkillSecondFormat",   // "Charge Level Duration"
  TargetRadius: "SkillDistanceFormat",        // "Target Area"
  ExplosionRadius: "SkillDistanceFormat",     // "Radius"
  ManaCost: "SkillCostFormat",                // "Energy Cost"
  ComboChargeLevels: "SkillIntFormat",        // "Onslaught Stacks:"
};
```

At the end of `renderOne`, replacing the unconditional return:

```ts
  // A plain label has no placeholder of its own, so a composer supplies the value
  // and the unit, with the label riding in as the composer's %s1.
  if (!/\{%/.test(template)) {
    const composer = COMPOSER[tag];
    return composer
      ? gameFormatT(composer, [s.value, gameT(tag)])
      : joinT(String(s.value), gameT(tag));
  }
  return gameFormatT(tag, [s.value]);
```

- [ ] **Step 4: Run the tests**

Run: `cd web && bun test test/items/effectText.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the coverage guard**

Add a test that walks every tag reachable from `data/stat-item-tags.json`, and asserts each plain-label tag either appears in `COMPOSER` or is one whose English text starts with `%`:

```ts
test("every plain label has a composer or carries its own percent", () => {
  const tags = require("../../../data/stat-item-tags.json") as Record<string, string>;
  const game = require("../../../data/i18n/game.en.json") as Record<string, string>;
  const unhandled = [...new Set(Object.values(tags))]
    .filter((t) => game[t] && !/\{%/.test(game[t]))
    .filter((t) => !COMPOSER[t] && !game[t].startsWith("%"));
  expect(unhandled).toEqual([]);
});
```

Run it. If it lists tags, look each one up on a grimtools card and add the right composer row. Do not silence it by widening the filter.

- [ ] **Step 6: Commit**

```bash
git add web/src/items/core/effectText.ts web/test/items/effectText.test.ts
git commit -m "feat(items): compose the plain stat labels through their game composers"
```

---

## Phase 4: Page core

### Task 10: Parse the payload

**Files:**
- Create: `web/src/items/core/model.ts`
- Create: `web/test/items/model.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Skill { record: string; mastery: string; group: string;
    nodeKind: "base" | "modifier" | "transmuter" | "pet_modifier";
    uiX: number | null; uiY: number | null; nameTag: string | null; icon: string;
    maxLevel: number; ultimateLevel: number; ranks: RankRow[]; pets: PetBlock[]; }
  export interface Item { record: string; nameTag: string | null; domain: "gear" | "relic";
    slots: string[]; rarity: string; itemLevel: number; tiers: number[];
    grimtools: string | null; boosts: Boost[]; masteryBoosts: MasteryBoost[];
    modifiers: ModBlock[]; }
  export interface Catalogue { meta: Record<string, unknown>; masteries: Mastery[];
    skills: Skill[]; items: Item[]; }
  export function parseCatalogue(doc: unknown): Catalogue;
  ```
  Follows `web/src/rr/core/model.ts`: snake_case in, camelCase out, throws only when the doc is not an object, tolerates missing arrays.

- [ ] **Step 1: Write the failing test**

```ts
test("maps snake_case to camelCase and tolerates a short doc", () => {
  const c = parseCatalogue({ items: [{ record: "r", item_level: 94, name_tag: "t",
    domain: "gear", slots: ["medal"], rarity: "Legendary", tiers: [], grimtools: null,
    boosts: [], mastery_boosts: [], modifiers: [] }] });
  expect(c.items[0]!.itemLevel).toBe(94);
  expect(c.items[0]!.masteryBoosts).toEqual([]);
  expect(c.skills).toEqual([]);
});
test("throws only on a non-object", () => {
  expect(() => parseCatalogue(null)).toThrow();
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `cd web && bun test test/items/model.test.ts`. Expected: module not found.

- [ ] **Step 3: Implement** following `web/src/rr/core/model.ts` exactly: a `Raw*` interface per shape, a `map*` function per shape, and `parseCatalogue` returning `{meta, masteries, skills, items}` with `?? []` on every array.

- [ ] **Step 4: Run the tests.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/items/core/model.ts web/test/items/model.test.ts
git commit -m "feat(items): parse the skill-items catalogue"
```

---

### Task 11: Facets and URL state

**Files:**
- Create: `web/src/items/core/facets.ts`
- Create: `web/src/items/core/urlState.ts`
- Create: `web/test/items/urlState.test.ts`

**Interfaces:**
- Consumes: `putSet` and `readSet` from `web/src/core/hashCodec`.
- Produces:
  ```ts
  export const SLOTS: string[];      // the 13 slot ids, ordered head to feet then jewellery
  export const RARITIES: string[];   // ["Legendary","Epic","Rare","Common"]
  export const DOMAINS: string[];    // ["gear","relic"]
  export const EFFECT_KINDS: string[]; // ["modifies","levels"]
  export const SORT_KEYS: string[];  // ["name","slot","rarity","ilvl","levels"]
  export interface ViewState { mastery: string | null; skill: string | null;
    fSlot: Set<string>; fRarity: Set<string>; fDomain: Set<string>;
    fKind: Set<string>; masteryWide: boolean; q: string;
    sortKey: string; sortDir: 1 | -1; }
  export function decodeHash(hash: string, known: { masteries: Set<string>; skills: Set<string> }): ViewState;
  export function encodeHash(v: ViewState): string;
  ```

- [ ] **Step 1: Write the failing test**

```ts
const known = { masteries: new Set(["m1"]), skills: new Set(["s1"]) };

test("round-trips a non-default state", () => {
  const v = decodeHash("mastery=m1&skill=s1&slot=medal,amulet&rarity=Legendary&sort=ilvl:-1", known);
  expect(v.mastery).toBe("m1");
  expect(v.fSlot).toEqual(new Set(["medal", "amulet"]));
  expect(decodeHash(encodeHash(v), known)).toEqual(v);
});
test("defaults encode as absent so a bare link stays short", () => {
  expect(encodeHash(decodeHash("", known))).toBe("");
});
test("a stale skill id falls back to no selection rather than throwing", () => {
  const v = decodeHash("mastery=m1&skill=deleted-skill", known);
  expect(v.mastery).toBe("m1");
  expect(v.skill).toBeNull();
});
test("unknown slot tokens are dropped, known ones kept", () => {
  expect(decodeHash("slot=medal,teapot", known).fSlot).toEqual(new Set(["medal"]));
});
```

- [ ] **Step 2: Run to verify it fails.** Expected: module not found.

- [ ] **Step 3: Implement** following `web/src/rr/core/urlState.ts`. `decodeHash` validates every id against the `known` sets and the facet constants; `encodeHash` omits a group at its default (empty multi-select, `masteryWide === false`, `sortKey === "name"`, `sortDir === 1`, empty `q`).

- [ ] **Step 4: Run the tests.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/items/core/facets.ts web/src/items/core/urlState.ts web/test/items/urlState.test.ts
git commit -m "feat(items): facet vocabulary and shareable hash state"
```

---

### Task 12: Filter and sort

**Files:**
- Create: `web/src/items/core/filter.ts`
- Create: `web/test/items/filter.test.ts`

**Interfaces:**
- Consumes: `Item`, `Skill` from Task 10; `ViewState` from Task 11.
- Produces:
  ```ts
  export interface Row { item: Item; levels: number; modStats: ModStat[]; }
  export function applyView(items: Item[], skills: Skill[], view: ViewState,
    nameOf: (item: Item) => string): Row[];
  ```
  `levels` is the total skill levels the item grants within the selected scope. `modStats` is the modifier stats for the selected scope, empty when the item only grants levels. Mastery-wide boosts contribute to `levels` only when `view.masteryWide` is true.

- [ ] **Step 1: Write the failing test**

```ts
import { applyView } from "../../src/items/core/filter";
import { SLOTS, RARITIES, DOMAINS, EFFECT_KINDS } from "../../src/items/core/facets";

const skill = (record: string, group: string, mastery: string) =>
  ({ record, group, mastery, nodeKind: "base", uiX: 0, uiY: 0, nameTag: null,
     icon: "", maxLevel: 16, ultimateLevel: 26, ranks: [], pets: [] }) as any;

// Two skills in mastery A (different groups), one in mastery B.
const skills = [
  skill("s/cadence1", "s/cadence1", "m/A"),
  skill("s/blitz1", "s/blitz1", "m/A"),
  skill("s/other1", "s/other1", "m/B"),
];

const item = (record: string, over: Partial<any> = {}) =>
  ({ record, nameTag: `tag${record}`, domain: "gear", slots: ["medal"],
     rarity: "Legendary", itemLevel: 94, tiers: [], grimtools: null,
     boosts: [], masteryBoosts: [], modifiers: [], ...over }) as any;

const badge = item("badge", {
  boosts: [{ skill: "s/cadence1", level: 3 }],
  modifiers: [{ skill: "s/cadence1", stats: [{ stat: "offensiveFireMin", value: 200 }] }],
});
const plainRing = item("ring", { boosts: [{ skill: "s/cadence1", level: 2 }] });
const blitzOnly = item("blitz", { boosts: [{ skill: "s/blitz1", level: 4 }] });
const wideAmulet = item("amulet", { masteryBoosts: [{ mastery: "m/A", level: 1 }] });
const offMastery = item("off", { boosts: [{ skill: "s/other1", level: 5 }] });
const items = [badge, plainRing, blitzOnly, wideAmulet, offMastery];

const base = {
  mastery: "m/A", skill: null as string | null,
  fSlot: new Set<string>(), fRarity: new Set<string>(), fDomain: new Set<string>(),
  fKind: new Set<string>(), masteryWide: false, q: "",
  sortKey: "name", sortDir: 1 as 1 | -1,
};
const nameOf = (i: any) => i.record;
const recs = (v: any) => applyView(items, skills, v, nameOf).map((r) => r.item.record);

test("a skill selection narrows to that node group", () => {
  expect(recs({ ...base, skill: "s/cadence1" }).sort()).toEqual(["badge", "ring"]);
});

test("a mastery selection unions every skill in the mastery", () => {
  expect(recs(base).sort()).toEqual(["badge", "blitz", "ring"]);
});

test("mastery-wide boosts are excluded unless the toggle is on", () => {
  expect(recs(base)).not.toContain("amulet");
  expect(recs({ ...base, masteryWide: true })).toContain("amulet");
});

test("the modifies chip excludes level-only items", () => {
  expect(recs({ ...base, skill: "s/cadence1", fKind: new Set(["modifies"]) }))
    .toEqual(["badge"]);
});

test("levels sums only the selected scope", () => {
  const rows = applyView(items, skills, { ...base, skill: "s/cadence1" }, nameOf);
  expect(rows.find((r) => r.item.record === "badge")!.levels).toBe(3);
});

test("search matches the resolved name, not the raw tag", () => {
  expect(recs({ ...base, q: "blitz" })).toEqual(["blitz"]);
});

test("sort is stable and breaks ties by record", () => {
  const tie = (r: string) => item(r, { boosts: [{ skill: "s/cadence1", level: 1 }] });
  const same = [tie("bbb"), tie("aaa")];
  const out = applyView(same, skills, { ...base, sortKey: "rarity" }, () => "same");
  expect(out.map((r) => r.item.record)).toEqual(["aaa", "bbb"]);
});
```

- [ ] **Step 2: Run to verify it fails.** Expected: module not found.

- [ ] **Step 3: Implement** following `web/src/rr/core/filter.ts`: a `matchesFilters` predicate, a `sortKeyValue` switch, and `applyView` filtering then sorting with an `item.record` tiebreak.

- [ ] **Step 4: Run the tests.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/items/core/filter.ts web/test/items/filter.test.ts
git commit -m "feat(items): filter and sort items for a view state"
```

---

### Task 13: The page renders

**Files:**
- Create: `web/src/items/adapters/dataSource.ts`, `web/src/items/adapters/tableView.ts`, `web/src/items/app/main.ts`
- Create: `web/items.html`
- Modify: `web/scripts/bundle.ts` (register the new entry point)

**Interfaces:**
- Consumes: everything from Tasks 7 to 12.
- Produces: a working page at `/items/` with the chip facets, the table, and hash sync. No tree yet; the skill picker is a plain `<select>` until Task 15 replaces it.

- [ ] **Step 1: Add the entry point and confirm the build**

Copy `web/resistance-reduction.html` to `web/items.html`, change the title and the script path, and register `items` in `web/scripts/bundle.ts` beside the existing pages.

Run: `just build`
Expected: `web/dist/items/index.html` exists.

- [ ] **Step 2: Write dataSource**

```ts
// ABOUTME: Fetches the skill-items catalogue for the /items/ page.
// ABOUTME: The only IO in the page; core stays pure and testable without a server.
import { parseCatalogue, type Catalogue } from "../core/model";

export async function loadCatalogue(url = "../data/skill-items.json"): Promise<Catalogue> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`skill-items.json: ${res.status}`);
  return parseCatalogue(await res.json());
}
```

- [ ] **Step 3: Write tableView and main**

Follow `web/src/rr/adapters/tableView.ts` for the chip rendering and the sortable header, and `web/src/rr/app/main.ts` for the wiring: load, decode the hash, render, and re-render on any facet change while writing the hash back. Every label is `appT("items.<key>")` resolved through the localization port; the effect cell resolves `effectLines(...)` through `resolveText`.

- [ ] **Step 4: Add the catalog keys**

Add every new `items.*` key to `web/src/i18n/app.en.json` and to the `web/test/appCatalog.test.ts` guard list.

Run: `cd web && bun test test/appCatalog.test.ts test/i18nBoundary.test.ts`
Expected: PASS.

- [ ] **Step 5: See it in a browser**

Run: `just serve` and open `http://localhost:PORT/items/`. Pick Soldier, then Cadence. Confirm the table lists items and that Badge of the Crimson Company shows both card lines.

- [ ] **Step 6: Commit**

```bash
git add web/items.html web/src/items/adapters web/src/items/app web/scripts/bundle.ts web/src/i18n/app.en.json web/test/appCatalog.test.ts
git commit -m "feat(items): render the item table with facets and hash state"
```

---

### Task 14: The expanded item row

**Files:**
- Create: `web/src/items/adapters/detailView.ts`
- Modify: `web/src/items/adapters/tableView.ts`

**Interfaces:**
- Produces: `export function renderDetail(item: Item, ctx: DetailContext): HTMLElement` showing every skill the item touches with its lines, plus the grimtools link.

- [ ] **Step 1: Write the row expansion.** Clicking a row toggles a detail row beneath it. Reuse `effectLines` per modifier block, and list level grants separately.
- [ ] **Step 2: Add the grimtools link** from `item.grimtools`, opening in a new tab, labelled with a catalog key.
- [ ] **Step 3: Verify in the browser** that expanding Badge of the Crimson Company shows both the Cadence and the Leap blocks.
- [ ] **Step 4: Commit**

```bash
git add web/src/items/adapters
git commit -m "feat(items): expand a row to every skill the item touches"
```

---

## Phase 5: Tree picker and pets

### Task 15: The SVG skill tree

**Files:**
- Create: `web/src/items/adapters/treeView.ts`
- Modify: `web/src/items/app/main.ts` (replace the `<select>`)

**Interfaces:**
- Produces: `export function renderTree(skills: Skill[], mastery: string, selected: string | null, onPick: (group: string) => void): SVGElement`.

- [ ] **Step 1: Render the nodes.** One fixed `viewBox="246 39 640 420"` serves every mastery; all ten share that box and there are no position collisions. Base skills draw as squares, modifiers and transmuters as circles.
- [ ] **Step 2: Add the icons** from `data/skill-icons.png` via `<image>` with a `clip-path`, indexed by `data/skill-icons.json` (32-pixel cells, 26 columns): `x = (col * 32)`, `y = (row * 32)`.
- [ ] **Step 3: Add the off-tree strip.** The four Fangs of Asterkarn shapeshift abilities have null `uiX`/`uiY`; render them in a labelled row below the tree rather than dropping them.
- [ ] **Step 4: Wire selection** to `onPick`, and reflect `selected` with a highlight.
- [ ] **Step 5: Verify** every mastery renders 30-plus nodes with no overlap and no missing icon.
- [ ] **Step 6: Commit**

```bash
git add web/src/items/adapters/treeView.ts web/src/items/app/main.ts
git commit -m "feat(items): pick a skill from the real in-game tree"
```

---

### Task 16: The pet panel

**Files:**
- Modify: `web/src/items/adapters/detailView.ts` or a new `petView.ts` if detailView exceeds 150 lines

**Interfaces:**
- Produces: a collapsible panel on the selected skill's header, present only for the 20 skills that carry a pet block.

- [ ] **Step 1: Render the pet's own stats** under the pet name. 579 of 743 rows have no source name; render those with no source attribution rather than an empty column.
- [ ] **Step 2: Render the pet ability rows** grouped by `source_name_tag` where one exists.
- [ ] **Step 3: Verify** against Wind Devil (5 pet rows, 31 pet-skill rows).
- [ ] **Step 4: Commit**

```bash
git add web/src/items/adapters
git commit -m "feat(items): show a summon's stat sheet on its skill"
```

---

## Phase 6: Finishing

### Task 17: Styling

**Files:**
- Create: `web/src/items/items.css`

- [ ] **Step 1: Write the stylesheet** following `web/src/rr/rr.css` for the chips, table, and dark palette. The tree needs a fixed-aspect container that scales with the viewport.
- [ ] **Step 2: Check the page at 1280px and at 480px.** The table scrolls horizontally inside its own container; the page body never does.
- [ ] **Step 3: Commit**

```bash
git add web/src/items/items.css
git commit -m "style(items): dark palette, chips and a scaling tree"
```

---

### Task 18: e2e, menu, and docs

**Files:**
- Create: `web/e2e/items-smoke.ts`
- Modify: `justfile` (the `e2e` recipe), the shared app menu, `docs/item-schema.md`, `BACKLOG.md`

- [ ] **Step 1: Write the smoke test** following `web/e2e/rr-smoke.ts`: serve `dist`, drive Chrome over CDP, assert the tree renders, pick a skill, assert the table has rows, assert no console errors.
- [ ] **Step 2: Add it to `just e2e`** beside the other three.
- [ ] **Step 3: Add `/items/` to the app menu** on all four pages.
- [ ] **Step 4: Update the docs.** Record the effect-text model in `docs/item-schema.md` (evergreen, rewritten in place, not appended). Remove the items-page entry from `BACKLOG.md`.
- [ ] **Step 5: Run the full gate**

Run: `just check && just e2e && uv run scripts/test_build_derived.py && uv run scripts/test_build_skill_items.py`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add web/e2e/items-smoke.ts justfile docs/ BACKLOG.md web/
git commit -m "test(items): smoke the page end to end and document the effect model"
```

---

## Self-review notes

**Spec coverage.** Pipeline fields Task 1-2; composed tags Task 3; the offline i18n split Task 4; widened tags Task 5; the formatter Tasks 6-9 with all four grouping rules and the 32 plain labels; page core Tasks 10-13; detail Task 14; tree and the off-tree strip Task 15; pets Task 16; css, e2e, menu and docs Tasks 17-18. The spec's four "known gaps carried, not closed" are deliberately unimplemented and stay listed there.

**Naming consistency.** `effectLines`, `EffectContext`, `ModStat`, `COMPOSER`, `applyGameFormat`, `gameFormatT`, `parseCatalogue`, `applyView`, `decodeHash`, `encodeHash`, `renderTree`, `renderDetail`, `loadCatalogue` are each defined once and used with the same spelling downstream. `refresh_skill` and `refresh_trigger` keep snake_case through the Python and the JSON payload, and are read as such by `ModStat`, which mirrors how `from_tag` and `to_tag` already cross that boundary.

**Two gates are proved non-vacuous by mutation** rather than assumed: the trigger-enum filter in Task 1 Step 5 and the DoT product in Task 8 Step 5. The plain-label coverage guard in Task 9 Step 5 fails loudly by construction, since it enumerates the real tag map.
