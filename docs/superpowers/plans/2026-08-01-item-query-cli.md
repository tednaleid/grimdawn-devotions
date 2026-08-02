# Item Query CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone CLI over the derived item database that a Claude Code instance drives to answer multi-criteria Grim Dawn build questions, returning ranked candidates with grimtools links.

**Architecture:** Two new derived parquet tables promote conversion and skill/mastery bonuses out of the raw deposit. A Python CLI reads only derived parquet through DuckDB, with a pure core (`gditems_core.py`) behind a query-level repository port, a DuckDB adapter that owns all SQL, and table/JSON output adapters over shared result objects.

**Tech Stack:** Python 3.10+, uv single-file scripts, DuckDB, lzstring 1.0.4. No new runtime beyond what `scripts/build_deposit.py` already uses.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-01-item-query-cli-design.md`. Read it before Task 1.
- Every code file starts with two `# ABOUTME: ` lines.
- NO emdashes, NO emojis, no hyperbole in code comments, docs, or commit messages.
- Tests are standalone uv-shebang scripts named `scripts/test_*.py`, using the repo's hand-rolled `check(name, got, want)` helper and ending with `print("FAILURES:", failures)` then `raise SystemExit(1 if failures else 0)`. Do NOT introduce pytest. `just test-scripts` globs `scripts/test_*.py`.
- Acceptance SQL lives in `scripts/derived_queries/*.sql`, gates its output on a `checks` CTE so an empty result means failure, and carries pinned counts with a comment saying a game patch should fail the recipe deliberately. Pins are EXACT equalities, matching the sibling queries (`count(*) = 97` in AE2, `= 284` in AE8, `446 of 447` in AE9). Never pin an inequality such as `> 7000`: a threshold with headroom passes a build that silently lost a chunk of its rows, which is the one thing these recipes exist to catch.
- `scripts/gditems_core.py` imports no database driver and no I/O. Purity is enforced by Task 3's test.
- The CLI resolves data directories from an explicit flag, then `GDITEMS_DERIVED_DIR` / `GDITEMS_DEPOSIT_DIR`, then repo-relative defaults. It never reads justfile variables.
- Source values render only as `vendor`, `crafted`, or `unknown`. Never "world drop".
- Pinned oracle counts in this plan were measured against deposit build 19149150. If `just derive` reports different numbers, STOP and report rather than editing the pin to match.
- Never use `--no-verify` when committing.

## File Structure

| File | Responsibility |
| --- | --- |
| `scripts/build_derived.py` (modify) | Gains `build_boosts` and `build_conversions`, plus new `WIDE_KEYS` entries |
| `scripts/derived_queries/ae10_skill_mastery_boosts.sql` (create) | Pinned acceptance for the boosts table |
| `scripts/derived_queries/ae11_damage_conversion.sql` (create) | Pinned acceptance for the conversions table |
| `scripts/gditems_core.py` (create) | Pure: `Criteria`, `Candidate`, `ScoredItem`, scoring, tier collapse, link building |
| `scripts/gditems_duckdb.py` (create) | Repository adapter: `Criteria` to SQL over derived parquet |
| `scripts/gditems.py` (create) | CLI entry: argparse, `search`/`vocab`/`show`, output adapters, browser port |
| `scripts/test_gditems_core.py` (create) | Fast core tests via a fake repository |
| `scripts/test_gditems_cli.py` (create) | End-to-end tests over the real derived parquet |
| `docs/item-schema.md` (modify) | Documents the two new tables |
| `docs/item-cli.md` (create) | CLI reference |
| `justfile` (modify) | `items` passthrough recipe, `q-ae10`, `q-ae11`, added to `q-ae-all` |
| `.claude/skills/gd-item-search/SKILL.md` (create) | Packages the workflow |

---

### Task 1: Boosts table (per-skill and per-mastery bonuses)

**Files:**
- Modify: `scripts/build_derived.py` (`WIDE_KEYS` around line 188, new `build_boosts` after `build_relations`, call site in the build entry point)
- Create: `scripts/derived_queries/ae10_skill_mastery_boosts.sql`
- Modify: `justfile` (new `q-ae10-skill-mastery-boosts` recipe, add to `q-ae-all`)
- Modify: `docs/item-schema.md`

**Interfaces:**
- Consumes: the existing `scoped` temp table and `facts` view inside `build_derived.py`.
- Produces: `data/derived/boosts.parquet` with columns `record VARCHAR`, `kind VARCHAR`, `target VARCHAR`, `mastery_record VARCHAR`, `level INTEGER`. `kind` is `'skill'` or `'mastery'`. For `kind='mastery'`, `target` equals `mastery_record`. Later tasks join this table and rely on those exact names.

Background the implementer needs: an item can boost a single named skill (`augmentSkillName1` naming `records/skills/playerclass04/shadowstrike.dbr`, paired with `augmentSkillLevel1`) or an entire mastery (`augmentMasteryName1` naming `records/skills/playerclass03/_classtraining_class03.dbr`, paired with `augmentMasteryLevel1`). The suffix number pairs a name key with its level key. The `playerclassNN` path segment is what links a skill back to its mastery, and the mastery's own record is always `records/skills/playerclassNN/_classtraining_classNN.dbr`.

- [ ] **Step 1: Write the failing acceptance query**

Create `scripts/derived_queries/ae10_skill_mastery_boosts.sql`:

```sql
-- ABOUTME: AE10 acceptance: the boosts table carries both kinds of skill bonus, with every
-- ABOUTME: skill boost resolving to the mastery its playerclass path names.
-- Empty result = failure. Counts pinned to build 19149150; a game patch that shifts them
-- should fail this recipe so the pins are re-checked deliberately.
WITH k AS (
    SELECT kind, count(*) AS n FROM boosts GROUP BY kind
),
sample AS (
    SELECT b.record, b.kind, b.target, b.mastery_record, b.level
    FROM boosts b
    WHERE b.kind = 'mastery'
),
checks AS (
    SELECT
        (SELECT n FROM k WHERE kind = 'skill') = 13896 AS skill_rows_exact,
        (SELECT n FROM k WHERE kind = 'mastery') = 1146 AS mastery_rows_exact,
        (SELECT count(*) FROM boosts WHERE mastery_record IS NULL) = 0 AS every_boost_has_mastery,
        (SELECT count(*) FROM boosts WHERE level <= 0) = 0 AS levels_positive,
        (SELECT count(*) FROM boosts WHERE kind = 'mastery' AND target != mastery_record) = 0 AS mastery_target_is_self
)
SELECT s.record, s.kind, s.target, s.mastery_record, s.level
FROM sample s CROSS JOIN checks c
WHERE c.skill_rows_exact AND c.mastery_rows_exact AND c.every_boost_has_mastery
  AND c.levels_positive AND c.mastery_target_is_self
ORDER BY s.record
LIMIT 20;
```

- [ ] **Step 2: Wire the recipe and run it to verify it fails**

In `justfile`, after the `q-ae9-applies-to` recipe, add:

```just
# AE10: skill and mastery boosts, every boost resolving to its mastery
[group("deposit")]
q-ae10-skill-mastery-boosts: (_q-derived "ae10_skill_mastery_boosts.sql")
```

Add `q-ae10-skill-mastery-boosts` to the `q-ae-all` recipe's list.

Run: `just q-ae10-skill-mastery-boosts`
Expected: FAIL, because the `boosts` view does not exist yet.

- [ ] **Step 3: Add the new keys to the wide pivot**

In `scripts/build_derived.py`, add to the `WIDE_KEYS` list (around line 188):

```python
    "augmentSkillName1", "augmentSkillName2", "augmentSkillLevel1", "augmentSkillLevel2",
    "augmentMasteryName1", "augmentMasteryName2", "augmentMasteryLevel1", "augmentMasteryLevel2",
```

- [ ] **Step 4: Implement build_boosts**

Add after `build_relations` in `scripts/build_derived.py`:

```python
def build_boosts(con: duckdb.DuckDBPyConnection, out_dir: Path) -> int:
    """Per-skill and per-mastery level bonuses, each resolved to its mastery record.

    An item boosts either one named skill (augmentSkillName<N>) or a whole mastery
    (augmentMasteryName<N>); the trailing number pairs a name key with its level key.
    The playerclassNN segment of the target path is what ties a skill to its mastery,
    whose own record is always _classtraining_class<NN> in the same directory.
    """
    con.execute("CREATE TEMP TABLE boosts (record VARCHAR, kind VARCHAR, target VARCHAR, "
                "mastery_record VARCHAR, level INTEGER)")
    for kind, name_key, level_key in (("skill", "augmentSkillName", "augmentSkillLevel"),
                                      ("mastery", "augmentMasteryName", "augmentMasteryLevel")):
        con.execute(f"""
            INSERT INTO boosts
            WITH paired AS (
                SELECT s.record AS rec,
                       lower(trim(n.value)) AS target,
                       CAST(lv.value_num AS INTEGER) AS lvl
                FROM scoped s
                JOIN facts n ON n.record = s.record
                            AND n.key LIKE '{name_key}%' AND trim(n.value) != ''
                JOIN facts lv ON lv.record = s.record
                             AND lv.key = '{level_key}'
                                          || regexp_extract(n.key, '{name_key}(\\d+)', 1)
                             AND lv.value_num > 0
            ),
            classed AS (
                SELECT rec, target, lvl,
                       regexp_extract(target, 'playerclass(\\d+)', 1) AS cls
                FROM paired
            )
            SELECT rec, '{kind}', target,
                   'records/skills/playerclass' || cls
                   || '/_classtraining_class' || cls || '.dbr',
                   lvl
            FROM classed
            WHERE cls != ''""")
    out = out_dir / "boosts.parquet"
    con.execute(f"COPY (SELECT * FROM boosts ORDER BY record, kind, target) "
                f"TO {sql_str(out.as_posix())} (FORMAT parquet, COMPRESSION zstd)")
    return con.execute("SELECT count(*) FROM boosts").fetchone()[0]
```

Call it from the build entry point beside the other `build_*` calls, and include its row count in the diagnostics the builder prints, matching how `build_relations` and `build_sources` report.

- [ ] **Step 5: Register the view in the query tool**

In `scripts/build_deposit.py`, find where derived views are registered (`entities`, `stats`, `relations`, `families`, `sources`) and add `boosts` to that list so `just q` and `_q-derived` can see it.

- [ ] **Step 6: Rebuild and verify the acceptance passes**

Run: `just derive` then `just q-ae10-skill-mastery-boosts`
Expected: PASS, printing up to 20 mastery-boost rows.

Then run `just q-ae-all`.
Expected: all recipes pass, proving the new table did not disturb the existing ones.

- [ ] **Step 7: Document the table**

In `docs/item-schema.md`, add `boosts.parquet` to the table listing with its columns and the two kinds, in the same present-tense style as the neighbouring entries. State that a skill boost and a mastery boost differ structurally rather than by heuristic.

- [ ] **Step 8: Commit**

```bash
git add scripts/build_derived.py scripts/build_deposit.py scripts/derived_queries/ae10_skill_mastery_boosts.sql justfile docs/item-schema.md
git commit -m "feat(derive): boosts table for per-skill and per-mastery bonuses"
```

---

### Task 2: Conversions table (damage conversion)

**Files:**
- Modify: `scripts/build_derived.py` (new `build_conversions`, call site)
- Create: `scripts/derived_queries/ae11_damage_conversion.sql`
- Modify: `justfile`, `docs/item-schema.md`

**Interfaces:**
- Produces: `data/derived/conversions.parquet` with columns `record VARCHAR`, `from_type VARCHAR`, `to_type VARCHAR`, `percent DOUBLE`. Later tasks rely on those exact names.

Background: conversion is a triple, not a scalar, so it cannot ride in `stats.parquet`. A record may carry several conversions, keyed `conversionInType`, `conversionOutType`, `conversionPercentage`, and numbered variants such as `conversionInType2`. Because a record can hold more than one, do NOT pivot these into `WIDE_KEYS`, which would collapse them with `max()`. Join `facts` directly and pair by the trailing number, treating the unnumbered key as index 1.

- [ ] **Step 1: Write the failing acceptance query**

Create `scripts/derived_queries/ae11_damage_conversion.sql`:

```sql
-- ABOUTME: AE11 acceptance: damage conversion is modelled as from/to/percent triples, with
-- ABOUTME: multiple conversions per record preserved rather than collapsed.
-- Empty result = failure. Counts pinned to build 19149150; a game patch that shifts them
-- should fail this recipe so the pins are re-checked deliberately.
WITH multi AS (
    SELECT record, count(*) AS n FROM conversions GROUP BY record HAVING count(*) > 1
),
checks AS (
    SELECT
        (SELECT count(*) FROM conversions) = :TOTAL_ROWS AS rows_present,
        (SELECT count(*) FROM conversions WHERE from_type IS NULL OR to_type IS NULL) = 0 AS types_present,
        (SELECT count(*) FROM conversions WHERE percent <= 0) = 0 AS percent_positive,
        (SELECT count(*) FROM multi) = :MULTI_RECORDS AS multi_conversion_preserved
)
SELECT c.record, c.from_type, c.to_type, c.percent
FROM conversions c CROSS JOIN checks k
WHERE k.rows_present AND k.types_present AND k.percent_positive AND k.multi_conversion_preserved
ORDER BY c.record, c.from_type, c.to_type
LIMIT 20;
```

`:TOTAL_ROWS` and `:MULTI_RECORDS` are the two numbers you cannot know until the table exists.
Write the file with those literal placeholders, and replace them with the exact counts your
first successful `just derive` reports, in Step 5. Do NOT substitute an inequality such as
`> 2000`: Task 1's review proved a threshold with headroom passes a build that silently lost
16 percent of its rows, which defeats the purpose of the recipe. If you cannot obtain a real
count, STOP and report rather than loosening the check.

- [ ] **Step 2: Wire the recipe and run it to verify it fails**

In `justfile`, after `q-ae10-skill-mastery-boosts`, add:

```just
# AE11: damage conversion triples, multiple conversions per record preserved
[group("deposit")]
q-ae11-damage-conversion: (_q-derived "ae11_damage_conversion.sql")
```

Add it to `q-ae-all`.

Run: `just q-ae11-damage-conversion`
Expected: FAIL, because the `conversions` view does not exist.

- [ ] **Step 3: Implement build_conversions**

Add to `scripts/build_derived.py`:

```python
def build_conversions(con: duckdb.DuckDBPyConnection, out_dir: Path) -> int:
    """Damage conversion as from/to/percent triples.

    A record can carry several conversions, numbered by a trailing digit on the key
    (the unnumbered key is index 1), so these are joined from facts rather than pivoted
    wide, which would collapse them to one per record.
    """
    con.execute("CREATE TEMP TABLE conversions (record VARCHAR, from_type VARCHAR, "
                "to_type VARCHAR, percent DOUBLE)")
    con.execute("""
        WITH idx AS (
            SELECT record, key, value, value_num,
                   COALESCE(NULLIF(regexp_extract(key, '(\\d+)$', 1), ''), '1') AS n,
                   regexp_replace(key, '\\d+$', '') AS base
            FROM facts
            WHERE regexp_replace(key, '\\d+$', '') IN
                  ('conversionInType', 'conversionOutType', 'conversionPercentage')
        )
        INSERT INTO conversions
        SELECT s.record, trim(i.value), trim(o.value), p.value_num
        FROM scoped s
        JOIN idx i ON i.record = s.record AND i.base = 'conversionInType'  AND trim(i.value) != ''
        JOIN idx o ON o.record = s.record AND o.base = 'conversionOutType' AND o.n = i.n
                                          AND trim(o.value) != ''
        JOIN idx p ON p.record = s.record AND p.base = 'conversionPercentage' AND p.n = i.n
                                          AND p.value_num > 0""")
    out = out_dir / "conversions.parquet"
    con.execute(f"COPY (SELECT * FROM conversions ORDER BY record, from_type, to_type) "
                f"TO {sql_str(out.as_posix())} (FORMAT parquet, COMPRESSION zstd)")
    return con.execute("SELECT count(*) FROM conversions").fetchone()[0]
```

Call it from the build entry point and report its row count in diagnostics.

- [ ] **Step 4: Register the view**

In `scripts/build_deposit.py`, add `conversions` to the derived view registration list alongside `boosts`.

- [ ] **Step 5: Rebuild, pin the exact counts, and verify**

Run: `just derive`. Note the conversions row count it reports.

Obtain the two exact numbers:

```bash
just q "SELECT count(*) AS total_rows FROM conversions"
just q "SELECT count(*) AS multi_records FROM (SELECT record FROM conversions GROUP BY record HAVING count(*) > 1)"
```

Replace `:TOTAL_ROWS` and `:MULTI_RECORDS` in `ae11_damage_conversion.sql` with those exact
integers, and state in the file's comment that both are pinned to build 19149150.

Run: `just q-ae11-damage-conversion`
Expected: PASS.

Then deliberately prove the pin bites: temporarily change `:TOTAL_ROWS` to one less than the
real count, re-run the recipe, and confirm it returns zero rows and fails. Restore the correct
value afterwards. A pin nobody has seen fail is not known to be a pin.

Run: `just q-ae-all`
Expected: all pass.

- [ ] **Step 6: Document and commit**

Add `conversions.parquet` to `docs/item-schema.md` with its columns, noting that multiple conversions per record are preserved and why the keys are not pivoted wide.

```bash
git add scripts/build_derived.py scripts/build_deposit.py scripts/derived_queries/ae11_damage_conversion.sql justfile docs/item-schema.md
git commit -m "feat(derive): conversions table for damage conversion triples"
```

---

### Task 3: Core value objects, vocabulary, tier collapse

**Files:**
- Create: `scripts/gditems_core.py`
- Create: `scripts/test_gditems_core.py`

**Interfaces:**
- Produces, all imported by later tasks:
  - `@dataclass(frozen=True) class StatCriterion: family: str; minimum: float | None`
  - `@dataclass(frozen=True) class Criteria` with fields `domains: tuple[str, ...]`, `slots: tuple[str, ...]`, `gear_types: tuple[str, ...]`, `rarities: tuple[str, ...]`, `expansions: tuple[str, ...]`, `sources: tuple[str, ...]`, `fits: str | None`, `level: int | None`, `all_tiers: bool`, `stats: tuple[StatCriterion, ...]`, `converts_to: str | None`, `min_convert: float | None`, `grants_skills: tuple[str, ...]`, `boosts_skills: tuple[str, ...]`, `boosts_masteries: tuple[str, ...]`, `masteries: tuple[str, ...]`, `limit: int`
  - `@dataclass(frozen=True) class Candidate` with fields `record: str`, `group_key: str`, `name: str`, `item_level: int`, `req_level: int`, `rarity: str`, `slots: tuple[str, ...]`, `source: str`, `stat_values: dict[str, float]`, `skill_boosts: dict[str, int]`, `mastery_boosts: dict[str, int]`, `granted_skills: tuple[str, ...]`, `conversions: tuple[tuple[str, str, float], ...]`
  - `def collapse_tiers(candidates: list[Candidate], level: int | None) -> list[list[Candidate]]` returning one inner list per family, each ordered strongest-usable first. It takes no `all_tiers` flag: rendering one tier or all of them is the caller's decision in Task 7, and both modes read the same structure.
  - `def criteria_criterion_names(c: Criteria) -> list[str]` returning a stable label per criterion the caller passed, used by scoring and by the per-criterion empty-match report.

- [ ] **Step 1: Write the failing test**

Create `scripts/test_gditems_core.py`:

```python
#!/usr/bin/env -S uv run --script
# ABOUTME: Tests for gditems_core pure logic. Run: uv run scripts/test_gditems_core.py
# ABOUTME: Covers tier collapse, level filtering, scoring, and grimtools link construction.
# /// script
# requires-python = ">=3.10"
# dependencies = ["lzstring"]
# ///
import importlib.util
from pathlib import Path

here = Path(__file__).parent
spec = importlib.util.spec_from_file_location("core", here / "gditems_core.py")
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)

failures = 0
def check(name, got, want):
    global failures
    if got != want:
        failures += 1
        print(f"  FAIL {name}: got {got!r}, want {want!r}")
    else:
        print(f"  ok   {name}")

def cand(record, group_key, name, item_level, req_level, **kw):
    return core.Candidate(
        record=record, group_key=group_key, name=name, item_level=item_level,
        req_level=req_level, rarity=kw.get("rarity", "Epic"),
        slots=kw.get("slots", ("feet",)), source=kw.get("source", "unknown"),
        stat_values=kw.get("stat_values", {}), skill_boosts=kw.get("skill_boosts", {}),
        mastery_boosts=kw.get("mastery_boosts", {}),
        granted_skills=kw.get("granted_skills", ()), conversions=kw.get("conversions", ()))

# The three Sellecor's March records are one family at three levels.
base = cand("r/base", "fam1", "Sellecor's March", 30, 25)
emp = cand("r/emp", "fam1", "Empowered Sellecor's March", 65, 60)
myth = cand("r/myth", "fam1", "Mythical Sellecor's March", 84, 80)
fam = [base, emp, myth]

groups = core.collapse_tiers(fam, level=None)
check("collapse yields one family", len(groups), 1)
check("family carries every tier, strongest first",
      [c.record for c in groups[0]], ["r/myth", "r/emp", "r/base"])

groups = core.collapse_tiers(fam, level=70)
check("level 70 makes the empowered tier the headline", groups[0][0].record, "r/emp")
check("level 70 drops the tier the character cannot equip",
      "r/myth" in [c.record for c in groups[0]], False)

groups = core.collapse_tiers(fam, level=20)
check("level below every requirement drops the family entirely", groups, [])

print("FAILURES:", failures)
raise SystemExit(1 if failures else 0)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run scripts/test_gditems_core.py`
Expected: FAIL, because `gditems_core.py` does not exist.

- [ ] **Step 3: Implement the module**

Create `scripts/gditems_core.py` starting with:

```python
# ABOUTME: Pure query model, scoring, tier collapse, and grimtools link building for the item CLI.
# ABOUTME: Imports no database driver and performs no I/O, so every rule here is unit testable.
```

Define the dataclasses exactly as listed in the Interfaces block, then:

```python
def collapse_tiers(candidates, level):
    """Group records into item families, strongest usable tier first.

    A family is one item that exists at several levels (base, Empowered, Mythical),
    sharing a group_key. When a level is given, tiers requiring a higher level are
    dropped entirely, so a family with no usable tier disappears rather than
    suggesting gear the character cannot equip.
    """
    families: dict[str, list[Candidate]] = {}
    for c in candidates:
        if level is not None and c.req_level > level:
            continue
        families.setdefault(c.group_key, []).append(c)
    out = []
    for members in families.values():
        members.sort(key=lambda c: c.item_level, reverse=True)
        out.append(members)
    return out
```

The returned inner list is always ordered strongest first. Callers take `group[0]` for the
headline tier and the rest for the ladder, which is why this function needs no `all_tiers`
flag: Task 7 renders one tier or all of them from the same structure.

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run scripts/test_gditems_core.py`
Expected: PASS, `FAILURES: 0`.

- [ ] **Step 5: Add a purity guard test**

Append to `scripts/test_gditems_core.py` before the summary lines:

```python
src = (here / "gditems_core.py").read_text(encoding="utf-8")
for banned in ("import duckdb", "import argparse", "open(", "requests"):
    check(f"core stays pure: no {banned}", banned in src, False)
```

Run: `uv run scripts/test_gditems_core.py`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/gditems_core.py scripts/test_gditems_core.py
git commit -m "feat(cli): pure query model and tier collapse for the item CLI"
```

---

### Task 4: Scoring

**Files:**
- Modify: `scripts/gditems_core.py`
- Modify: `scripts/test_gditems_core.py`

**Interfaces:**
- Consumes: `Criteria`, `Candidate` from Task 3.
- Produces:
  - `@dataclass(frozen=True) class CriterionScore: name: str; raw: float; normalised: float; weight: float; note: str`
  - `@dataclass(frozen=True) class ScoredItem: candidate: Candidate; total: float; parts: tuple[CriterionScore, ...]`
  - `def score(candidates: list[Candidate], c: Criteria, weights: dict[str, float] | None) -> list[ScoredItem]` returning items sorted by `total` descending.

Rules this must implement, from the spec: each criterion is normalised against the best value among matching candidates, so a score is relative to what is available. Sub-scores sum with weights defaulting to 1.0 each. An item missing a criterion scores zero for it rather than being dropped, unless that criterion carried a minimum. A mastery-wide boost contributes to every skill criterion belonging to that mastery, at `MASTERY_FALLBACK_WEIGHT = 0.5` of a direct hit, and its `note` says so.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/test_gditems_core.py`:

```python
crit = core.Criteria(
    domains=("gear",), slots=(), gear_types=(), rarities=(), expansions=(), sources=(),
    fits=None, level=None, all_tiers=False,
    stats=(core.StatCriterion(family="damage.pierce", minimum=None),),
    converts_to=None, min_convert=None, grants_skills=(),
    boosts_skills=("records/skills/playerclass04/shadowstrike.dbr",),
    boosts_masteries=(), masteries=(), limit=10)

strong = cand("r/strong", "f1", "Strong", 84, 80,
              stat_values={"damage.pierce": 40.0},
              skill_boosts={"records/skills/playerclass04/shadowstrike.dbr": 3})
weak = cand("r/weak", "f2", "Weak", 84, 80,
            stat_values={"damage.pierce": 20.0},
            skill_boosts={"records/skills/playerclass04/shadowstrike.dbr": 1})
generalist = cand("r/gen", "f3", "Generalist", 84, 80,
                  stat_values={"damage.pierce": 20.0},
                  mastery_boosts={"records/skills/playerclass04/_classtraining_class04.dbr": 3})
nostat = cand("r/none", "f4", "Nothing", 84, 80)

ranked = core.score([weak, strong, generalist, nostat], crit, None)
check("best item ranks first", ranked[0].candidate.record, "r/strong")
check("item matching nothing is kept, not dropped", "r/none" in [r.candidate.record for r in ranked], True)
check("item matching nothing scores zero", ranked[-1].total, 0.0)

by_rec = {r.candidate.record: r for r in ranked}
check("normalisation is relative to the best candidate",
      by_rec["r/strong"].parts[0].normalised, 1.0)
check("half the best value normalises to half",
      by_rec["r/weak"].parts[0].normalised, 0.5)

gen_skill = [p for p in by_rec["r/gen"].parts if p.name.startswith("boosts_skill")][0]
check("mastery boost counts toward a skill criterion", gen_skill.raw > 0, True)
check("mastery boost is discounted against a direct hit",
      gen_skill.normalised < by_rec["r/strong"].parts[1].normalised, True)
check("mastery fallback explains itself", "mastery" in gen_skill.note.lower(), True)
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run scripts/test_gditems_core.py`
Expected: FAIL with `AttributeError` on `core.score`.

- [ ] **Step 3: Implement scoring**

Add to `scripts/gditems_core.py`:

```python
MASTERY_FALLBACK_WEIGHT = 0.5


def score(candidates, c, weights=None):
    """Rank candidates by how well they satisfy the criteria the caller passed.

    Each criterion normalises against the best value present among the candidates, so a
    total answers "how good is this relative to what exists" rather than against an
    invented absolute scale. An item that misses a criterion scores zero for it and stays
    in the list, which is what lets a strong partial match outrank a weak complete one.
    """
    weights = weights or {}
    names = criteria_criterion_names(c)
    raw: dict[str, dict[str, float]] = {n: {} for n in names}
    notes: dict[str, dict[str, str]] = {n: {} for n in names}
    for cand_ in candidates:
        for name in names:
            value, note = _raw_value(cand_, c, name)
            raw[name][cand_.record] = value
            notes[name][cand_.record] = note
    best = {n: max(v.values(), default=0.0) for n, v in raw.items()}
    out = []
    for cand_ in candidates:
        parts = []
        for name in names:
            value = raw[name][cand_.record]
            top = best[name]
            normalised = (value / top) if top > 0 else 0.0
            weight = weights.get(name, 1.0)
            parts.append(CriterionScore(name=name, raw=value, normalised=normalised,
                                        weight=weight, note=notes[name][cand_.record]))
        total = sum(p.normalised * p.weight for p in parts)
        out.append(ScoredItem(candidate=cand_, total=total, parts=tuple(parts)))
    out.sort(key=lambda s: s.total, reverse=True)
    return out
```

Implement `_raw_value(candidate, criteria, criterion_name)` returning `(value, note)`.

The criterion label strings are already fixed by `criteria_criterion_names` in
`gditems_core.py`, which Task 3 shipped. They use UNDERSCORES, not hyphens. Read that
function and match it exactly rather than inventing labels: the real prefixes are
`stat:`, `converts_to:`, `grants_skill:`, `boosts_skill:`, `boosts_mastery:`, and
`mastery:`. A label mismatch produces a silent zero for every candidate on that
criterion, which looks exactly like "nothing matched" rather than like a bug.

For a `boosts_skill:<record>` criterion, return the direct boost level with an empty note
when present; otherwise, if the candidate carries a mastery boost whose `mastery_record`
matches that skill's mastery, return `level * MASTERY_FALLBACK_WEIGHT` with the note
`"via +N to the mastery, not the skill directly"`. For `stat:<family>` return the stat
value. For `converts_to:<type>` return the summed percent converting to that type. For
`grants_skill:<record>` return 1.0 when granted. For `boosts_mastery:<record>` return the
mastery boost level. For `mastery:<record>` return the larger of a direct mastery boost
and any skill boost belonging to that mastery, since the flag is the union of both.

- [ ] **Step 4: Run to verify it passes**

Run: `uv run scripts/test_gditems_core.py`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/gditems_core.py scripts/test_gditems_core.py
git commit -m "feat(cli): relative scoring with mastery fallback for skill criteria"
```

---

### Task 5: Grimtools link building

**Files:**
- Modify: `scripts/gditems_core.py`, `scripts/test_gditems_core.py`

**Interfaces:**
- Produces: `def grimtools_url(name: str, item_level: int) -> str`.

Background: grimtools item ids are internal and cannot be derived, and are not needed. A search query of exact name plus an exact `itemLevel` isolates one item. The query is JSON, compressed with lz-string's `compressToEncodedURIComponent`, appended to `https://www.grimtools.com/db/advsearch?query=`. The Python `lzstring` package produces byte-identical output to the JavaScript implementation, verified 2026-08-01.

The query carries the NESTED `raw` object only. Verified live against grimtools on 2026-08-01: the name alone returns all three Sellecor's March tiers, and the nested-only form returns exactly one, identically to a query that also carries a flat `raw/itemLevel` key. The flat key is what grimtools' own UI happens to emit alongside the nested one, but its parser reads the nested form, so adding it here buys nothing. Note this differs from SKILL filters, where a flat `skill/sk####` key is not merely redundant but actively ignored, which is the defect that shipped in this repository's item-search page and returned 144 items where 3 were correct.

- [ ] **Step 1: Write the failing test**

Add to `scripts/test_gditems_core.py`:

```python
# Byte-for-byte fixture: this blob was produced by the JavaScript lz-string implementation
# and verified against grimtools, returning exactly one item (the base Sellecor's March).
EXPECTED = ("https://www.grimtools.com/db/advsearch?query="
            "N4IgdghgtgpiBcIDKMA2qYGMD2AnA5AM4AEAshLpgBYgA0IuEA7gqAJYAuMUAMjAG5pWIKGzAIAzAAZ6UCAA9JUgL6qgA")
check("grimtools url matches the verified fixture",
      core.grimtools_url("Sellecor's March", 30), EXPECTED)

import json, lzstring
blob = core.grimtools_url("Sellecor's March", 30).split("query=", 1)[1]
decoded = json.loads(lzstring.LZString().decompressFromEncodedURIComponent(blob))
check("query pins the exact item level", decoded["raw"]["itemLevel"], {"min": 30, "max": 30})
check("query carries the item name", decoded["name"], "Sellecor's March")
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run scripts/test_gditems_core.py`
Expected: FAIL on `core.grimtools_url`.

- [ ] **Step 3: Implement**

Add to `scripts/gditems_core.py`:

```python
import json
import lzstring

GRIMTOOLS_SEARCH = "https://www.grimtools.com/db/advsearch?query="


def grimtools_url(name, item_level):
    """Deep link that isolates one item on grimtools.

    grimtools item ids are internal to their site and cannot be derived from game data,
    so the link pins the item by name plus an exact itemLevel instead, which resolves the
    base, Empowered and Mythical tiers of a name to the single intended record.
    """
    query = {"name": name,
             "raw": {"itemLevel": {"min": item_level, "max": item_level}}}
    blob = lzstring.LZString().compressToEncodedURIComponent(
        json.dumps(query, separators=(",", ":")))
    return GRIMTOOLS_SEARCH + blob
```

Add `lzstring` to the script dependency block of `scripts/gditems_core.py` consumers. Because the module is imported by uv scripts, declare `dependencies = ["lzstring", "duckdb"]` in `scripts/gditems.py` and `dependencies = ["lzstring"]` in `scripts/test_gditems_core.py`.

- [ ] **Step 4: Run to verify it passes**

Run: `uv run scripts/test_gditems_core.py`
Expected: PASS.

Note: if the fixture assertion fails, the JSON key order or separators changed. Do NOT edit the expected blob to match your output. The blob is verified against the live site; a mismatch means the query changed shape.

- [ ] **Step 5: Commit**

```bash
git add scripts/gditems_core.py scripts/test_gditems_core.py
git commit -m "feat(cli): grimtools deep links pinned by name and item level"
```

---

### Task 6: DuckDB repository adapter

**Files:**
- Create: `scripts/gditems_duckdb.py`

**Interfaces:**
- Consumes: `Criteria`, `Candidate` from `gditems_core`.
- Produces:
  - `class DuckDbRepository` with `__init__(self, derived_dir: Path)` and `def fetch(self, c: Criteria) -> list[Candidate]`
  - `def vocabulary(self) -> dict[str, list[str]]` with keys `masteries`, `gear_types`, `slots`, `stat_families`, `domains`, `rarities`, `expansions`, `skills`
  - `def find(self, name_or_record: str) -> list[Candidate]` for the `show` command
- The repository port is structural: any object with `fetch`, `vocabulary`, and `find` satisfies it. Tests supply a fake.

This module owns every SQL string in the project's CLI. `gditems_core` must not import it.

- [ ] **Step 1: Implement the adapter**

Create `scripts/gditems_duckdb.py` with the two ABOUTME lines, then a class that opens a DuckDB connection, registers views over the derived parquet (`entities`, `stats`, `relations`, `families`, `sources`, `boosts`, `conversions`), and translates a `Criteria` into one query.

Translation rules, each mapping to a real column:
- `domains` to `entities.domain`; `slots` to `entities.slots` via `list_contains`; `gear_types` to `entities.gear_type`; `rarities` to `entities.rarity`; `expansions` to `entities.expansion`.
- `fits` to `relations.kind = 'applies_to' AND relations.dst = :fits`.
- `sources` to `sources.kind`, where the token `unknown` means no `sources` row exists.
- `stats` to `stats` joined through `families` on `families.stat_id = stats.stat_id AND families.family = :family`, using `stats.value_min`, with `minimum` applied as a filter.
- `converts_to` to `conversions.to_type`, with `min_convert` filtering `conversions.percent`.
- `grants_skills` to `relations.kind = 'grants_skill'`.
- `boosts_skills` to `boosts.kind = 'skill' AND boosts.target IN (...)`.
- `boosts_masteries` to `boosts.kind = 'mastery' AND boosts.mastery_record IN (...)`.
- `masteries` to `boosts.mastery_record IN (...)` regardless of kind, which is the union the spec requires.
- Name comes from `labels.text` joined on `labels.tag = entities.name_tag AND labels.locale = 'en'`.
- `level` is NOT applied here. Tier selection belongs to `collapse_tiers` in the core so it stays testable.

Use parameter binding for every value. Never interpolate a caller-supplied string into SQL.

- [ ] **Step 2: Verify against the real database by hand**

Run:

```bash
uv run scripts/gditems_duckdb.py --selftest
```

Add a small `--selftest` entry point that fetches with a `Criteria` for domain `augment` and `fits='chest'` and prints the row count. Expected: a non-zero count. This is a smoke check, not the real test; Task 9 adds the pinned end-to-end assertions.

- [ ] **Step 3: Commit**

```bash
git add scripts/gditems_duckdb.py
git commit -m "feat(cli): duckdb repository adapter translating criteria to sql"
```

---

### Task 7: CLI entry, vocab command, table output

**Files:**
- Create: `scripts/gditems.py`
- Modify: `justfile`

**Interfaces:**
- Consumes: `gditems_core`, `gditems_duckdb`.
- Produces: the executable CLI. Subcommands `search`, `vocab`, `show`.

- [ ] **Step 1: Implement the entry point**

Create `scripts/gditems.py` with a uv shebang, the two ABOUTME lines, and `dependencies = ["duckdb", "lzstring"]`.

Directory resolution covers TWO directories, because item display names live in
`labels.parquet` under `data/deposit/` while everything else is under `data/derived/`. For
each, the order is: explicit flag (`--derived-dir`, `--deposit-dir`), then environment
variable (`GDITEMS_DERIVED_DIR`, `GDITEMS_DEPOSIT_DIR`), then a repo-relative default
computed from the script's own location (`<repo root>/data/derived`, `<repo root>/data/deposit`).
Never read justfile variables. `DuckDbRepository` already takes `deposit_dir` as an optional
second argument defaulting to `derived_dir.parent / "deposit"`; pass both explicitly from the
CLI rather than relying on that fallback, so a caller who moves one directory is not silently
given the wrong other one.

`search` flags, exactly as the spec lists them. Scope: `--domain`, `--slot`, `--gear-type`, `--rarity`, `--expansion`, `--all-tiers`, `--source`, `--fits`, `--level`. Criteria: `--stat` (repeatable, accepting `family` or `family:min`), `--resist`, `--converts-to`, `--min-convert`, `--grants-skill`, `--boosts-skill`, `--boosts-mastery`, `--mastery`. Output: `--limit` (default 20), `--json`, `--explain`, `--weights`, `--open`.

`--resist pierce` is sugar expanding to the corresponding defensive stat family, resolved through the vocabulary rather than hardcoded.

Skill and mastery flags accept human names and resolve to record paths through the vocabulary, so a caller writes `--boosts-skill "Shadow Strike"` rather than a path. Three rules govern that resolution, each forced by something measured in the data:

Resolve a name against the vocabulary key belonging to the flag it came from, never against all keys with the first hit winning. `skills` and `granted_skills` share nine display names (Canister Bomb, Flashbang, Overguard, Panetti's Replicating Missile, Phantasmal Blades, Rebuke, Storm Surge, Stun Jacks, Wind Devil), and eight of those point at genuinely different records depending on the key. So `--boosts-skill` reads `skills`, `--grants-skill` reads `granted_skills`, and `--mastery` and `--boosts-mastery` read `masteries`.

Handle names that collide inside a single key. 47 display names within `granted_skills` are each shared by several distinct records, covering 109 of its 724 entries, because a base skill and its legendary or component variant can carry the same name. The repository keeps every one of them by keying collided entries as `"name (record)"`. A caller cannot realistically type that. So when an exact lookup fails, gather every key of the form `<name> (<anything>)`: if exactly one matches, use it; if several match, exit non-zero listing each candidate with its record so the caller can pick. Never silently choose one.

A record path is always accepted directly, for any of these flags. That is the escape hatch for the 46 skills and 108 granted skills that carry no display name at all, and it must keep working, since telling a caller a skill does not exist when it merely lacks a label would be a lie.

- [ ] **Step 2: Implement `vocab`**

`vocab` prints every valid token by category. With `--json` it prints the same as an object. This exists so an agent composes correct calls instead of guessing at spelling, since a wrong token would otherwise look like an honest empty result.

- [ ] **Step 3: Implement table output**

The table prints rank, name, total score, the matched criteria summary, the tier and item level, the source label, and the grimtools URL on its own line beneath each row. Beneath the table print the honesty line: `Score reflects only the criteria you passed. It ranks candidates and does not judge builds.`

Where a family has more than one tier, print the ladder on its own line, for example `tiers: base 30 / Empowered 65 / Mythical 84`.

- [ ] **Step 4: Add the justfile passthrough**

```just
# Query the derived item database (see docs/item-cli.md). Standalone: scripts/gditems.py
[group("deposit")]
[doc("Query the item database: just items search --domain augment --fits chest --resist pierce")]
items *ARGS:
    uv run "{{justfile_directory()}}/scripts/gditems.py" {{ARGS}}
```

- [ ] **Step 5: Verify by hand**

Run: `uv run scripts/gditems.py vocab | head -20`
Expected: token lists including masteries and gear types.

Run: `just items search --domain augment,component --fits chest --resist pierce --limit 5`
Expected: a ranked table whose top rows include `Titan Plating` at 24 pierce resistance, sourced `crafted`, each with a grimtools URL.

- [ ] **Step 6: Commit**

```bash
git add scripts/gditems.py justfile
git commit -m "feat(cli): item search command with vocab and table output"
```

---

### Task 8: JSON output, show, and the browser port

**Files:**
- Modify: `scripts/gditems.py`

**Interfaces:**
- Produces: `--json` output, the `show` subcommand, and `def open_url(url: str) -> None` as the browser port, injectable so tests assert the URL without launching anything.

- [ ] **Step 1: Implement `--json`**

JSON output is an object with keys `criteria` (echoing what was parsed, so a caller can confirm intent), `results` (a list, each with `rank`, `name`, `record`, `item_level`, `req_level`, `rarity`, `slots`, `source`, `score`, `parts`, `tiers`, `url`), `unmatched_criteria` (the per-criterion list from Task 9), and `disclaimer` carrying the same honesty sentence as the table.

Both renderers consume the same `ScoredItem` list. Do not build a second query path for JSON.

- [ ] **Step 2: Implement `show`**

`show` accepts an `entities.record` path or an exact item name, and prints every stat, boost, conversion, source and set membership for it. When a name matches more than one family it lists the matches and exits non-zero rather than guessing.

- [ ] **Step 3: Implement `--open N`**

`--open N` opens the Nth result's grimtools URL through a module-level `open_url` that defaults to `webbrowser.open`. Tests replace it.

- [ ] **Step 4: Verify by hand**

Run: `just items search --domain augment --fits chest --resist pierce --limit 3 --json`
Expected: valid JSON. Confirm with `| jq '.results[0].url'` that a URL is present.

Run: `just items show "Titan Plating"`
Expected: full detail for that component.

- [ ] **Step 5: Commit**

```bash
git add scripts/gditems.py
git commit -m "feat(cli): json output, show command, and browser handoff"
```

---

### Task 9: Errors, per-criterion reporting, end-to-end tests

**Files:**
- Modify: `scripts/gditems.py`
- Create: `scripts/test_gditems_cli.py`

**Interfaces:**
- Produces: `unmatched_criteria`, a list naming each criterion that matched nothing, surfaced in both renderers.

- [ ] **Step 1: Write the failing end-to-end test**

Create `scripts/test_gditems_cli.py` following the repo's test-script convention, with `dependencies = ["duckdb", "lzstring"]`. It runs the CLI as a subprocess against the real `data/derived` and asserts:

```python
# The chest-augment query is the spec's worked example and is pinned to build 19149150.
out = run_cli("search", "--domain", "augment,component", "--fits", "chest",
              "--resist", "pierce", "--limit", "5", "--json")
data = json.loads(out)
names = [r["name"] for r in data["results"]]
check("titan plating is the strongest chest pierce component", names[0], "Titan Plating")
check("every result carries a grimtools url",
      all(r["url"].startswith("https://www.grimtools.com/db/advsearch?query=") for r in data["results"]), True)
check("sources never claim world drop",
      {r["source"] for r in data["results"]} <= {"vendor", "crafted", "unknown"}, True)
check("json carries the honesty disclaimer", "does not judge builds" in data["disclaimer"], True)

# An unknown token fails loudly with suggestions rather than returning nothing.
code, err = run_cli_expect_failure("search", "--mastery", "nightblad")
check("unknown token exits non-zero", code != 0, True)
check("unknown token suggests the real one", "nightblade" in err, True)

# A criterion nobody can satisfy is named, so an empty result is not mistaken for absence.
out = run_cli("search", "--domain", "gear", "--stat", "damage.pierce:99999", "--json")
data = json.loads(out)
check("impossible criterion is named", "damage.pierce" in " ".join(data["unmatched_criteria"]), True)

# The two renderers must not drift.
table = run_cli("search", "--domain", "augment", "--fits", "chest", "--resist", "pierce", "--limit", "5")
data = json.loads(run_cli("search", "--domain", "augment", "--fits", "chest",
                          "--resist", "pierce", "--limit", "5", "--json"))
for r in data["results"]:
    check(f"table shows {r['name']}", r["name"] in table, True)
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run scripts/test_gditems_cli.py`
Expected: FAIL on the unknown-token and unmatched-criteria assertions.

- [ ] **Step 3: Implement the error paths**

An unrecognised token for any vocabulary-backed flag exits non-zero with the near matches, computed with `difflib.get_close_matches` against that flag's vocabulary.

A missing derived directory exits non-zero with `data/derived not found. Run: just fetch-deposit` and nothing else.

`unmatched_criteria` is computed after scoring by naming any criterion whose raw value is zero for every candidate, and appears in both renderers.

- [ ] **Step 4: Run to verify it passes**

Run: `uv run scripts/test_gditems_cli.py`
Expected: PASS.

- [ ] **Step 5: Exercise the repository port with a fake**

The end-to-end test above proves the SQL, and the core tests prove the logic, but nothing yet
proves the CLI wires collapse, scoring and rendering together correctly without a database.
Add to `scripts/test_gditems_cli.py`:

```python
class FakeRepo:
    """Structural stand-in for DuckDbRepository: same three methods, fixed rows."""
    def __init__(self, candidates):
        self._candidates = candidates
    def fetch(self, criteria):
        return list(self._candidates)
    def vocabulary(self):
        return {"masteries": ["nightblade"], "gear_types": ["boots"], "slots": ["feet"],
                "stat_families": ["damage.pierce"], "domains": ["gear"],
                "rarities": ["Epic"], "expansions": ["fg"], "skills": []}
    def find(self, name_or_record):
        return [c for c in self._candidates if c.name == name_or_record]

repo = FakeRepo([
    core.Candidate(record="r/myth", group_key="f1", name="Mythical Thing", item_level=84,
                   req_level=80, rarity="Epic", slots=("feet",), source="unknown",
                   stat_values={"damage.pierce": 40.0}, skill_boosts={}, mastery_boosts={},
                   granted_skills=(), conversions=()),
    core.Candidate(record="r/base", group_key="f1", name="Thing", item_level=30,
                   req_level=25, rarity="Epic", slots=("feet",), source="unknown",
                   stat_values={"damage.pierce": 10.0}, skill_boosts={}, mastery_boosts={},
                   granted_skills=(), conversions=()),
])
payload = cli.run_search(repo, cli.parse_args([
    "search", "--domain", "gear", "--stat", "damage.pierce", "--level", "50", "--json"]))
check("fake repo needs no database", payload["results"][0]["name"], "Thing")
check("level filtering applies through the CLI path", len(payload["results"]), 1)
```

This requires `run_search(repo, args)` and `parse_args(argv)` to be importable from
`scripts/gditems.py`, with the repository passed in rather than constructed inside. If they
are not, refactor `gditems.py` so the composition root builds the repository and hands it to
`run_search`. That injection point is the whole reason the port exists.

- [ ] **Step 6: Run the full suite**

Run: `uv run scripts/test_gditems_cli.py`
Expected: PASS.

Run: `just test-scripts`
Expected: every script test passes, including the pre-existing ones.

- [ ] **Step 7: Commit**

```bash
git add scripts/gditems.py scripts/test_gditems_cli.py
git commit -m "feat(cli): loud errors, per-criterion reporting, end-to-end tests"
```

---

### Task 10: Documentation and the workflow skill

**Files:**
- Create: `docs/item-cli.md`, `.claude/skills/gd-item-search/SKILL.md`
- Modify: `BACKLOG.md`

- [ ] **Step 1: Write the CLI reference**

Create `docs/item-cli.md` documenting every subcommand and flag, the directory resolution order, the two worked examples from the spec, and the honesty rules. Present tense, evergreen, no emdashes, no emojis.

- [ ] **Step 2: Write the skill**

Create `.claude/skills/gd-item-search/SKILL.md` with frontmatter `name: gd-item-search` and a description covering Grim Dawn item and build questions. The body teaches the workflow: call `vocab` before composing flags so tokens are real; run `search` with `--json`; read `unmatched_criteria` before concluding nothing matches; never describe an `unknown` source as a world drop; publish the recommendations as an artifact page carrying per-item justification, source labels and the grimtools links.

- [ ] **Step 3: Record what is deferred**

In `BACKLOG.md`, under the item-database section, note that farmability and monster-infrequent affix applicability both wait on the reverse loot-table graph, that gear source coverage is 7.2% and affix coverage 0% as of build 19149150, and that the CLI's `source` field resolves automatically once that work lands, with no interface change.

- [ ] **Step 4: Full verification**

Run: `just derive`, `just q-ae-all`, `just test-scripts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add docs/item-cli.md .claude/skills/gd-item-search/SKILL.md BACKLOG.md
git commit -m "docs(cli): item CLI reference, workflow skill, deferred loot graph note"
```
