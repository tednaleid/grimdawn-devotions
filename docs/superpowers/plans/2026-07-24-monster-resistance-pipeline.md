# Monster Resistance Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract every combat-relevant Grim Dawn monster's base resistances into a committed, re-runnable `data/monsters.json`, alongside the global difficulty offset table.

**Architecture:** A stdlib-only Python parser (`scripts/parse_monsters.py`) reads extracted `.dbr` records through the shared `scripts/gd_dbr.py` helpers, filters creature records down to surveyable monsters, collapses variant records to a logical grain, and writes a committed JSON dataset. It is the third parser in the established pattern (`parse_devotions.py`, `parse_rr.py`), wired into the same `just` recipes, i18n table builder, and data-diff tool.

**Tech Stack:** Python 3.10+ run via `uv` (stdlib only, no dependencies), `just` task runner, existing `scripts/gd_dbr.py` helpers.

**Spec:** `docs/superpowers/specs/2026-07-24-monster-resistance-pipeline-design.md`

## Global Constraints

- **Stdlib only.** No third-party dependencies in `scripts/parse_monsters.py`. The `uv` script header is `requires-python = ">=3.10"` with `dependencies = []`.
- **Reuse `scripts/gd_dbr.py`.** `DB`, `load_translations`, `read_dbr` come from there. Do not reimplement record or translation reading, and do not add to `gd_dbr.py` unless a genuinely shared need appears.
- **Python runs via `uv`.** Bare `python`/`python3` fails on this machine. Every command is `uv run <script>`.
- **Determinism.** Two runs over the same records must produce byte-identical output. All iteration over the filesystem is sorted; all output lists are sorted by a total key.
- **i18n invariant.** No display text is stored in `data/monsters.json`. Names and races are stored as game tags (`name_tag`, `race_tag`) and resolved through `data/i18n/game.<lang>.json`. Ids are language independent.
- **The ten resistance keys are always present** on every monster, absent fields written as an explicit `0`. Keys, in this exact order: `physical`, `pierce`, `fire`, `cold`, `lightning`, `poison`, `aether`, `chaos`, `vitality`, `bleeding`.
- **Field mapping** (output key -> `.dbr` field): vitality maps to `defensiveLife`, poison maps to `defensivePoison` (Poison and Acid). All others map to `defensive<Capitalized key>`. `defensiveElemental` is never stored: elemental is always the three constituent types.
- **Exclusion rules, applied in this order**, first match reported: not `Class,Monster`; `hiddenFromCombat` set; `invincible` set; no resolvable name; `devotion` path role; `monsterClassification` not one of the six valid values.
- **Valid classifications:** `Common`, `Champion`, `Hero`, `Boss`, `SuperBoss`, `Quest`.
- **Grain:** one logical monster per `(resolved name, classification)` pair. Representative chosen by highest `maxLevel`, then highest `minLevel`, then lexicographically lowest record path.
- **Measured targets** (game version 1.3.0.0, for the integration test): 2,728 kept records, 1,637 logical monsters, 608 groups collapsing more than one record, 50 of those with disagreeing resistances. These are data-derived and move on a game patch, so assert them as bands, not exact equality.
- **Difficulty offsets:** 12-entry arrays split as 3 difficulties (`normal`, `elite`, `ultimate`) by 4 player brackets (`"1"`..`"4"`).
- **Script tests are run directly** (`uv run scripts/test_parse_monsters.py`), matching how `scripts/test_parse_rr.py` is run today. Task 5 adds a `just test-scripts` recipe to make them repeatable.

---

### Task 1: Pure record filtering and resistance extraction

Creates the parser file with the pure helpers that decide whether a creature record is a surveyable monster and pull its resistances. No I/O, no CLI yet.

**Files:**
- Create: `scripts/parse_monsters.py`
- Create: `scripts/test_parse_monsters.py`

**Interfaces:**
- Consumes: `scripts/gd_dbr.py` (`DB`, `load_translations`) - imported now, used from Task 3 onward.
- Produces: `RESISTANCE_FIELDS: dict[str, str]`, `VALID_CLASSIFICATIONS: tuple[str, ...]`, `ROLE_MARKERS: tuple[str, ...]`, `EXCLUSIONS: list[dict]`, `role_of(rel_path: str) -> str`, `as_float(value) -> float | None`, `resistances_of(rec: dict) -> dict[str, int|float]`, `exclusion_reason(rel_path: str, rec: dict, tags: dict[str, str]) -> str | None`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test_parse_monsters.py`:

```python
#!/usr/bin/env -S uv run --script
# ABOUTME: Tests for parse_monsters extraction. Run: uv run scripts/test_parse_monsters.py
# /// script
# requires-python = ">=3.10"
# ///
import importlib.util, json, subprocess, sys, tempfile
from pathlib import Path

here = Path(__file__).parent
root = here.parent

def load(name, file):
    spec = importlib.util.spec_from_file_location(name, here / file)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

mon = load("mon", "parse_monsters.py")

failures = 0
def check(name, cond):
    global failures
    if cond:
        print(f"  ok   {name}")
    else:
        failures += 1
        print(f"  FAIL {name}")

# --- Task 1: role classification ---
check("role from nemesis dir", mon.role_of("enemies/nemesis/nemesis_aetherial_01.dbr") == "nemesis")
check("role from hero dir", mon.role_of("enemies/hero/foo_a01.dbr") == "hero")
check("role boss&quest", mon.role_of("enemies/boss&quest/loghorrean_03.dbr") == "boss&quest")
check("waveevents normalizes to waveevent", mon.role_of("enemies/waveevents/x.dbr") == "waveevent")
check("waveevent stays waveevent", mon.role_of("enemies/waveevent/x.dbr") == "waveevent")
check("bare enemies dir is base", mon.role_of("enemies/aetherelemental_a01.dbr") == "base")
check("role match is case-insensitive", mon.role_of("enemies/NEMESIS/x.dbr") == "nemesis")
check("partial dir name does not match", mon.role_of("enemies/heroic_things/x.dbr") == "base")

# --- Task 1: resistances always carry all ten keys ---
TEN = ["physical","pierce","fire","cold","lightning","poison","aether","chaos","vitality","bleeding"]
res = mon.resistances_of({"defensiveFire": "20.000000", "defensiveAether": "50.000000"})
check("resistances has exactly the ten keys", list(res.keys()) == TEN)
check("absent resistance is explicit 0", res["cold"] == 0 and res["bleeding"] == 0)
check("present resistance parsed as int", res["fire"] == 20 and res["aether"] == 50)
check("vitality reads defensiveLife", mon.resistances_of({"defensiveLife": "25.0"})["vitality"] == 25)
check("negative resistance preserved", mon.resistances_of({"defensiveFire": "-25.0"})["fire"] == -25)
check("fractional resistance kept as float", mon.resistances_of({"defensiveCold": "12.5"})["cold"] == 12.5)
check("non-numeric resistance falls back to 0", mon.resistances_of({"defensiveFire": "abc"})["fire"] == 0)

# --- Task 1: exclusion rules, in order ---
TAGS = {"tagOk": "Real Monster"}
def rec(**kw):
    base = {"Class": "Monster", "description": "tagOk", "monsterClassification": "Common"}
    base.update(kw)
    return base

check("a good record is kept", mon.exclusion_reason("enemies/x.dbr", rec(), TAGS) is None)
check("non-monster excluded", mon.exclusion_reason("enemies/x.dbr", rec(Class="ProxyPool"), TAGS) == "not a monster record")
check("hiddenFromCombat excluded", mon.exclusion_reason("enemies/x.dbr", rec(hiddenFromCombat="1"), TAGS) == "hidden from combat")
check("hiddenFromCombat zero is kept", mon.exclusion_reason("enemies/x.dbr", rec(hiddenFromCombat="0"), TAGS) is None)
check("invincible excluded", mon.exclusion_reason("enemies/x.dbr", rec(invincible="1"), TAGS) == "invincible")
check("missing description excluded", mon.exclusion_reason("enemies/x.dbr", rec(description=""), TAGS) == "no resolvable name")
check("unresolvable description excluded", mon.exclusion_reason("enemies/x.dbr", rec(description="tagMissing"), TAGS) == "no resolvable name")
check("devotion role excluded", mon.exclusion_reason("enemies/devotion/x.dbr", rec(), TAGS) == "devotion role")
check("missing classification excluded", mon.exclusion_reason("enemies/x.dbr", rec(monsterClassification=""), TAGS) == "no classification")
check("unknown classification excluded", mon.exclusion_reason("enemies/x.dbr", rec(monsterClassification="Prop"), TAGS) == "no classification")
for c in ("Common", "Champion", "Hero", "Boss", "SuperBoss", "Quest"):
    check(f"classification {c} is valid", mon.exclusion_reason("enemies/x.dbr", rec(monsterClassification=c), TAGS) is None)
check("rule order: non-monster reported before devotion role",
      mon.exclusion_reason("enemies/devotion/x.dbr", rec(Class="ProxyPool"), TAGS) == "not a monster record")

print("FAILURES:", failures)
raise SystemExit(1 if failures else 0)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run scripts/test_parse_monsters.py`
Expected: FAIL, with `FileNotFoundError` or `ModuleNotFoundError` because `scripts/parse_monsters.py` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `scripts/parse_monsters.py`:

```python
#!/usr/bin/env -S uv run --script
# ABOUTME: Parses Grim Dawn extracted .dbr records into data/monsters.json.
# ABOUTME: Stdlib-only; catalogues every combat-relevant monster's base resistances.
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Survey every combat-relevant monster's base resistances from the extracted records.

See docs/superpowers/specs/2026-07-24-monster-resistance-pipeline-design.md for the
field mapping, exclusion rules, and dedup grain. Pure stdlib; re-run after any patch.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gd_dbr import DB, load_translations  # noqa: E402

# Output key -> the .dbr field holding that resistance. A bare defensive<Type> on a
# CREATURE record is that monster's own resistance; the same field name on a SKILL
# record, negative, is a resistance-reduction debuff (what parse_rr.py extracts).
# defensiveElemental is deliberately absent: elemental is always the three types.
RESISTANCE_FIELDS = {
    "physical": "defensivePhysical",
    "pierce": "defensivePierce",
    "fire": "defensiveFire",
    "cold": "defensiveCold",
    "lightning": "defensiveLightning",
    "poison": "defensivePoison",       # Poison & Acid
    "aether": "defensiveAether",
    "chaos": "defensiveChaos",
    "vitality": "defensiveLife",
    "bleeding": "defensiveBleeding",
}

VALID_CLASSIFICATIONS = ("Common", "Champion", "Hero", "Boss", "SuperBoss", "Quest")

# Directory names that identify a monster's role. "waveevents" normalizes onto
# "waveevent": they are two spellings of one concept. Anything else is "base".
ROLE_MARKERS = (
    "nemesis", "hero", "boss&quest", "bounties", "faction",
    "waveevents", "waveevent", "special", "devotion",
    "anomalies", "npcs", "ambient", "pc",
)

EXCLUSIONS: list[dict] = []


def role_of(rel_path: str) -> str:
    """The role directory a record lives under, or 'base'. Matches whole path
    segments only, so 'heroic_things/' is not the 'hero' role."""
    parts = rel_path.lower().split("/")
    for marker in ROLE_MARKERS:
        if marker in parts:
            return "waveevent" if marker == "waveevents" else marker
    return "base"


def as_float(value):
    """Parse a scalar .dbr value to float, or None when it is not a single number."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def resistances_of(rec: dict) -> dict:
    """All ten resistance keys, always present, absent or unparseable fields as 0.

    Writing every key explicitly is for the consumer: aggregate views reduce over
    arrays with no per-row fallback branch.
    """
    out = {}
    for key, field in RESISTANCE_FIELDS.items():
        v = as_float(rec.get(field))
        if v is None:
            out[key] = 0
        else:
            out[key] = int(v) if v == int(v) else round(v, 4)
    return out


def exclusion_reason(rel_path: str, rec: dict, tags: dict) -> str | None:
    """Why this creature record is not a surveyable monster, else None.

    Order matters: the first matching rule is the one reported, so the counts in
    the summary partition the population rather than overlapping.
    """
    if rec.get("Class") != "Monster":
        return "not a monster record"
    if as_float(rec.get("hiddenFromCombat")):
        return "hidden from combat"
    if as_float(rec.get("invincible")):
        return "invincible"
    desc = rec.get("description")
    if not desc or not tags.get(desc):
        return "no resolvable name"
    if role_of(rel_path) == "devotion":
        return "devotion role"
    if rec.get("monsterClassification") not in VALID_CLASSIFICATIONS:
        return "no classification"
    return None
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run scripts/test_parse_monsters.py`
Expected: every check prints `ok`, final line `FAILURES: 0`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/parse_monsters.py scripts/test_parse_monsters.py
git commit -m "feat(monsters): pure record filtering and resistance extraction"
```

---

### Task 2: Logical-monster grain collapse

Collapses variant records to one logical monster per `(name, classification)`, picking a representative and flagging groups whose variants disagree.

**Files:**
- Modify: `scripts/parse_monsters.py` (append after `exclusion_reason`)
- Modify: `scripts/test_parse_monsters.py` (append before the final `print("FAILURES:", failures)`)

**Interfaces:**
- Consumes: `role_of`, `as_float`, `resistances_of` from Task 1.
- Produces: `monster_id(rel_path: str) -> str`, `race_tag_of(rec: dict, tags: dict) -> str | None`, `collapse_to_logical(groups: dict, tags: dict) -> list[dict]`. `groups` is keyed `(name, classification)` with values `list[tuple[rel_path, rec]]`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test_parse_monsters.py`, immediately before the final `print("FAILURES:", failures)` line:

```python
# --- Task 2: id derivation ---
check("id drops the .dbr suffix and flattens separators",
      mon.monster_id("enemies/nemesis/nemesis_aetherial_01.dbr") == "enemies.nemesis.nemesis_aetherial_01")
check("id sanitizes characters that are unsafe in a URL hash",
      mon.monster_id("enemies/boss&quest/loghorrean_03.dbr") == "enemies.boss-quest.loghorrean_03")

# --- Task 2: race tag resolution ---
RACE_TAGS = {"tagRace005": "Aether Corruption"}
check("race tag resolves", mon.race_tag_of({"characterRacialProfile": "Race005"}, RACE_TAGS) == "tagRace005")
check("unresolvable race tag is dropped", mon.race_tag_of({"characterRacialProfile": "Race099"}, RACE_TAGS) is None)
check("absent race profile is None", mon.race_tag_of({}, RACE_TAGS) is None)
check("malformed race profile is None", mon.race_tag_of({"characterRacialProfile": "Bogus"}, RACE_TAGS) is None)

# --- Task 2: collapse to the logical grain ---
def crec(maxlv, minlv=1, **kw):
    base = {"Class": "Monster", "description": "tagOk", "monsterClassification": "Common",
            "maxLevel": str(maxlv), "minLevel": str(minlv)}
    base.update(kw)
    return base

groups = {
    ("Aetherial Bloater", "Common"): [
        ("enemies/bloater_a01.dbr", crec(30, defensiveFire="10")),
        ("enemies/bloater_c01.dbr", crec(90, defensiveFire="10")),
        ("enemies/bloater_b01.dbr", crec(60, defensiveFire="10")),
    ],
    ("Solo Beast", "Hero"): [("enemies/hero/solo.dbr", crec(50, defensiveCold="8"))],
}
logical = mon.collapse_to_logical(groups, RACE_TAGS)
by_name = {m["id"]: m for m in logical}
check("one logical monster per (name, classification)", len(logical) == 2)
bloater = [m for m in logical if m["variant_count"] == 3][0]
check("representative is the highest maxLevel", bloater["id"] == "enemies.bloater_c01")
check("variant_count counts every collapsed record", bloater["variant_count"] == 3)
check("record_paths lists every collapsed record, representative first",
      bloater["record_paths"][0] == "records/creatures/enemies/bloater_c01.dbr"
      and len(bloater["record_paths"]) == 3)
check("agreeing variants are not flagged", bloater["variants_disagree"] is False)
check("classification carried through", bloater["classification"] == "Common")
check("role carried through", by_name["enemies.hero.solo"]["role"] == "hero")
check("output is sorted by id", [m["id"] for m in logical] == sorted(m["id"] for m in logical))
check("every logical monster carries all ten resistance keys",
      all(list(m["resistances"].keys()) == TEN for m in logical))

# maxLevel ties break on minLevel, then on path
tie = mon.collapse_to_logical({("Tie", "Common"): [
    ("enemies/b.dbr", crec(90, 10)),
    ("enemies/a.dbr", crec(90, 40)),
]}, RACE_TAGS)
check("maxLevel tie breaks on higher minLevel", tie[0]["id"] == "enemies.a")
tie2 = mon.collapse_to_logical({("Tie", "Common"): [
    ("enemies/z.dbr", crec(90, 10)),
    ("enemies/a.dbr", crec(90, 10)),
]}, RACE_TAGS)
check("full tie breaks on lowest path", tie2[0]["id"] == "enemies.a")

# disagreement detection
dis = mon.collapse_to_logical({("Dis", "Common"): [
    ("enemies/x_a01.dbr", crec(90, defensiveFire="10")),
    ("enemies/x_b01.dbr", crec(50, defensiveFire="40")),
]}, RACE_TAGS)
check("disagreeing variants are flagged", dis[0]["variants_disagree"] is True)
check("disagreement still reports the representative's values", dis[0]["resistances"]["fire"] == 10)

# summon flag
summ = mon.collapse_to_logical({("S", "Common"): [("enemies/x_a01_summon.dbr", crec(20))]}, RACE_TAGS)
check("summon records are flagged", summ[0]["is_summon"] is True)
check("non-summon records are not flagged", tie[0]["is_summon"] is False)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run scripts/test_parse_monsters.py`
Expected: FAIL with `AttributeError: module 'mon' has no attribute 'monster_id'`.

- [ ] **Step 3: Write the implementation**

Append to `scripts/parse_monsters.py`:

```python
def monster_id(rel_path: str) -> str:
    """Stable, language-independent, URL-safe id from the representative's path.

    Derived from the path (never from display text) so ids never change with locale.
    Separators are flattened and unsafe characters replaced so the id can sit in a
    URL hash unescaped: 'enemies/boss&quest/x.dbr' -> 'enemies.boss-quest.x'.
    """
    stem = rel_path[:-4] if rel_path.endswith(".dbr") else rel_path
    return re.sub(r"[^A-Za-z0-9_.-]", "-", stem.replace("/", "."))


def race_tag_of(rec: dict, tags: dict) -> str | None:
    """The tagRace0NN translation tag for a record's racial profile, else None.

    Only tags that actually resolve are emitted, so the dataset never carries a
    dangling tag the i18n table cannot fill.
    """
    profile = (rec.get("characterRacialProfile") or "").strip()
    if not re.fullmatch(r"Race\d+", profile):
        return None
    tag = f"tag{profile}"
    return tag if tags.get(tag) else None


def _representative_rank(entry):
    """Sort key selecting the representative: highest maxLevel, then highest
    minLevel, then lexicographically lowest path. Total, so runs are reproducible."""
    rel_path, rec = entry
    return (
        -(as_float(rec.get("maxLevel")) or 0.0),
        -(as_float(rec.get("minLevel")) or 0.0),
        rel_path,
    )


def collapse_to_logical(groups: dict, tags: dict) -> list[dict]:
    """{(name, classification): [(rel_path, rec)]} -> one dict per logical monster.

    Variant records (tier _[abc]NN, _summon, _pN phases) collapse onto the
    highest-level representative. Groups whose members disagree on resistances are
    flagged rather than silently resolved, so the page can mark them.
    """
    out = []
    for (_name, classification), members in groups.items():
        ordered = sorted(members, key=_representative_rank)
        rel_path, rec = ordered[0]
        resistances = resistances_of(rec)
        out.append({
            "id": monster_id(rel_path),
            "name_tag": rec["description"],
            "classification": classification,
            "role": role_of(rel_path),
            "race_tag": race_tag_of(rec, tags),
            "min_level": int(as_float(rec.get("minLevel")) or 0),
            "max_level": int(as_float(rec.get("maxLevel")) or 0),
            "is_summon": rel_path.endswith("_summon.dbr"),
            "resistances": resistances,
            "variant_count": len(ordered),
            "variants_disagree": any(resistances_of(r) != resistances for _, r in ordered[1:]),
            "record_paths": [f"records/creatures/{p}" for p, _ in ordered],
        })
    out.sort(key=lambda m: m["id"])
    return out
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run scripts/test_parse_monsters.py`
Expected: every check prints `ok`, final line `FAILURES: 0`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/parse_monsters.py scripts/test_parse_monsters.py
git commit -m "feat(monsters): collapse variant records to the logical grain"
```

---

### Task 3: Difficulty offset table

Extracts the global difficulty and player-count resistance offsets, resolved through the game engine record rather than hardcoded.

**Files:**
- Modify: `scripts/parse_monsters.py` (append after `collapse_to_logical`)
- Modify: `scripts/test_parse_monsters.py` (append before the final `print`)

**Interfaces:**
- Consumes: `RESISTANCE_FIELDS`, `as_float` from Task 1; `DB` from `gd_dbr`.
- Produces: `DIFFICULTIES: tuple[str, ...]`, `PLAYER_BRACKETS: tuple[str, ...]`, `split_difficulty_array(value: str | None) -> dict | None`, `scaler_ref(db: DB) -> str`, `difficulty_offsets(db: DB) -> dict`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test_parse_monsters.py`, before the final `print`:

```python
# --- Task 3: difficulty array splitting ---
twelve = ";".join(str(float(n)) for n in [0,0,0,0, 4,6,8,11, 8,10,13,16])
split = mon.split_difficulty_array(twelve)
check("split has the three difficulties", sorted(split.keys()) == ["elite", "normal", "ultimate"])
check("split has the four player brackets", sorted(split["elite"].keys()) == ["1", "2", "3", "4"])
check("normal bracket values", [split["normal"][p] for p in "1234"] == [0, 0, 0, 0])
check("elite bracket values", [split["elite"][p] for p in "1234"] == [4, 6, 8, 11])
check("ultimate bracket values", [split["ultimate"][p] for p in "1234"] == [8, 10, 13, 16])
check("a scalar broadcasts to every cell",
      mon.split_difficulty_array("5.000000")["ultimate"]["4"] == 5
      and mon.split_difficulty_array("5.000000")["normal"]["1"] == 5)
check("a wrong-length array is rejected", mon.split_difficulty_array("1.0;2.0;3.0") is None)
check("an empty value is rejected", mon.split_difficulty_array("") is None)
check("a None value is rejected", mon.split_difficulty_array(None) is None)
check("a non-numeric entry is rejected", mon.split_difficulty_array(";".join(["x"] * 12)) is None)

# --- Task 3: offsets read from the real records ---
db = mon.DB((root / "extracted/records").resolve())
check("scaler ref resolves through gameengine.dbr",
      mon.scaler_ref(db).endswith("balancingadjustment_mp+difficulty_enemies01.dbr"))
offs = mon.difficulty_offsets(db)
check("offsets cover the three difficulties", sorted(offs.keys()) == ["elite", "normal", "ultimate"])
check("offsets cover the four player brackets", sorted(offs["ultimate"].keys()) == ["1", "2", "3", "4"])
check("every offset cell carries all ten resistance keys",
      all(list(offs[d][p].keys()) == TEN for d in offs for p in offs[d]))
check("real ultimate fire offsets match the scaler record",
      [offs["ultimate"][p]["fire"] for p in "1234"] == [8, 10, 13, 16])
check("real elite fire offsets match the scaler record",
      [offs["elite"][p]["fire"] for p in "1234"] == [4, 6, 8, 11])
check("normal adds no fire offset", [offs["normal"][p]["fire"] for p in "1234"] == [0, 0, 0, 0])
check("bleeding gains its resistance from difficulty alone",
      offs["ultimate"]["4"]["bleeding"] > 0)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run scripts/test_parse_monsters.py`
Expected: FAIL with `AttributeError: module 'mon' has no attribute 'split_difficulty_array'`.

- [ ] **Step 3: Write the implementation**

Append to `scripts/parse_monsters.py`:

```python
DIFFICULTIES = ("normal", "elite", "ultimate")
PLAYER_BRACKETS = ("1", "2", "3", "4")

GAMEENGINE_REF = "records/game/gameengine.dbr"
SCALER_FALLBACK = "records/game/balancingadjustment_mp+difficulty_enemies01.dbr"


def split_difficulty_array(value):
    """A 12-entry '3 difficulties x 4 player brackets' array -> {difficulty: {players: v}}.

    The scaler stores several fields flat when they do not vary; a scalar therefore
    broadcasts to every cell. Any other length is rejected rather than guessed at.
    """
    parts = [p for p in (value or "").split(";") if p.strip() != ""]
    nums = []
    for p in parts:
        v = as_float(p)
        if v is None:
            return None
        nums.append(int(v) if v == int(v) else round(v, 4))
    if not nums:
        return None
    if len(nums) == 1:
        nums = nums * 12
    if len(nums) != 12:
        return None
    return {
        diff: {players: nums[di * 4 + pi] for pi, players in enumerate(PLAYER_BRACKETS)}
        for di, diff in enumerate(DIFFICULTIES)
    }


def scaler_ref(db: DB) -> str:
    """The enemy difficulty scaler the engine points at, so a patch that moves the
    record is followed automatically rather than silently reading a stale path."""
    ref = (db.get(GAMEENGINE_REF).get("monsterAttributePak") or "").strip()
    return ref or SCALER_FALLBACK


def difficulty_offsets(db: DB) -> dict:
    """Global additive resistance offsets per difficulty and player count.

    Difficulty does not rescale a monster's own resistance; it adds a flat offset to
    every monster in the game. Kept separate from each monster's base so the page can
    compute effective = base + offset, and so these balance constants stay in
    extracted data rather than app code.
    """
    rec = db.get(scaler_ref(db))
    out = {d: {p: {} for p in PLAYER_BRACKETS} for d in DIFFICULTIES}
    for key, field in RESISTANCE_FIELDS.items():
        table = split_difficulty_array(rec.get(field)) or {}
        for d in DIFFICULTIES:
            for p in PLAYER_BRACKETS:
                out[d][p][key] = table.get(d, {}).get(p, 0)
    return out
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run scripts/test_parse_monsters.py`
Expected: every check prints `ok`, final line `FAILURES: 0`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/parse_monsters.py scripts/test_parse_monsters.py
git commit -m "feat(monsters): extract the difficulty and player-count offset table"
```

---

### Task 4: CLI, dataset generation, and integration tests

Wires the pure pieces into a runnable parser that writes `data/monsters.json`, and pins the measured population against the real records.

**Files:**
- Modify: `scripts/parse_monsters.py` (append after `difficulty_offsets`)
- Modify: `scripts/test_parse_monsters.py` (append before the final `print`)
- Modify: `docs/superpowers/specs/2026-07-24-monster-resistance-pipeline-design.md` (align the output sketch)
- Create: `data/monsters.json` (generated, committed)

**Interfaces:**
- Consumes: everything from Tasks 1-3, plus `load_translations` from `gd_dbr`.
- Produces: `iter_creature_records(db) -> Iterator[tuple[str, dict]]`, `collect_monsters(db, tags) -> list[dict]`, `print_summary(monsters, exclusions) -> None`, `main(argv=None) -> int`. Output document shape: `{"meta": {...}, "monsters": [...], "difficulty_offsets": {...}}`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test_parse_monsters.py`, before the final `print`:

```python
# --- Task 4: run the real parser over the extracted tree ---
out = Path(tempfile.mkdtemp()) / "monsters.json"
rc = subprocess.run([sys.executable, str(here / "parse_monsters.py"),
    "--records-dir", str(root / "extracted/records"),
    "--text-dir", str(root / "extracted/text_en"),
    "--out", str(out), "--game-version", "test"]).returncode
check("parser exits 0", rc == 0)
doc = json.loads(out.read_text(encoding="utf-8"))
check("has meta.game_version", doc["meta"]["game_version"] == "test")
check("has meta.generated_utc", bool(doc["meta"].get("generated_utc")))
check("monsters is a list", isinstance(doc["monsters"], list))
check("difficulty_offsets present", isinstance(doc["difficulty_offsets"], dict))

monsters = doc["monsters"]
# Data-derived counts: bands, not equality, so a balance patch does not fail the suite.
check(f"logical monster count in band (got {len(monsters)})", 1400 <= len(monsters) <= 1900)
check("ids are unique", len({m["id"] for m in monsters}) == len(monsters))
check("every monster carries all ten resistance keys",
      all(list(m["resistances"].keys()) == TEN for m in monsters))
check("no monster stores display text",
      all(m["name_tag"].startswith("tag") for m in monsters))
check("every classification is one of the six valid values",
      {m["classification"] for m in monsters} <= set(mon.VALID_CLASSIFICATIONS))
check("no devotion-role monster survives", not any(m["role"] == "devotion" for m in monsters))
check("no monster has a null classification", all(m["classification"] for m in monsters))
check("raw records collapsed in band",
      1400 <= sum(m["variant_count"] for m in monsters) <= 3200)
disagreeing = [m for m in monsters if m["variants_disagree"]]
check(f"disagreeing groups stay a small minority (got {len(disagreeing)})",
      len(disagreeing) <= len(monsters) // 10)
check("summons are present and flagged", any(m["is_summon"] for m in monsters))
check("nemesis role is present", any(m["role"] == "nemesis" for m in monsters))

# Valdaran (nemesis_aetherial_01) is the fixture from the spec.
val = [m for m in monsters if m["id"] == "enemies.nemesis.nemesis_aetherial_01"]
check("valdaran present", len(val) == 1)
check("valdaran resistances match the record",
      val and val[0]["resistances"]["fire"] == 20 and val[0]["resistances"]["lightning"] == 50
      and val[0]["resistances"]["aether"] == 50 and val[0]["resistances"]["poison"] == 20
      and val[0]["resistances"]["cold"] == 0)
check("valdaran classification and role", val and val[0]["classification"] == "Boss" and val[0]["role"] == "nemesis")
check("valdaran level range", val and val[0]["min_level"] == 60 and val[0]["max_level"] == 250)
check("valdaran race tag", val and val[0]["race_tag"] == "tagRace005")

# --- Task 4: determinism ---
out2 = Path(tempfile.mkdtemp()) / "monsters2.json"
subprocess.run([sys.executable, str(here / "parse_monsters.py"),
    "--records-dir", str(root / "extracted/records"),
    "--text-dir", str(root / "extracted/text_en"),
    "--out", str(out2), "--game-version", "test"], check=True)
doc2 = json.loads(out2.read_text(encoding="utf-8"))
check("deterministic across runs", doc["monsters"] == doc2["monsters"])
check("deterministic offsets across runs", doc["difficulty_offsets"] == doc2["difficulty_offsets"])
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run scripts/test_parse_monsters.py`
Expected: FAIL on "parser exits 0" (the script has no `main`, so it produces no output file and the following `json.loads` raises `FileNotFoundError`).

- [ ] **Step 3: Write the implementation**

Append to `scripts/parse_monsters.py`:

```python
def iter_creature_records(db: DB):
    """(path relative to records/creatures, record) for every .dbr under creatures/.

    Sorted so a run is reproducible regardless of filesystem ordering.
    """
    root = db.root / "records/creatures"
    for path in sorted(root.rglob("*.dbr")):
        rel = path.relative_to(root).as_posix()
        yield rel, db.get(f"records/creatures/{rel}")


def collect_monsters(db: DB, tags: dict) -> list[dict]:
    """Sweep creatures/, drop what is not surveyable, and collapse to the logical grain."""
    groups: dict = {}
    for rel_path, rec in iter_creature_records(db):
        reason = exclusion_reason(rel_path, rec, tags)
        if reason:
            EXCLUSIONS.append({"record_path": f"records/creatures/{rel_path}", "reason": reason})
            continue
        key = (tags[rec["description"]], rec["monsterClassification"])
        groups.setdefault(key, []).append((rel_path, rec))
    return collapse_to_logical(groups, tags)


def print_summary(monsters, exclusions):
    """Audit summary to stderr: population, facet spread, and every exclusion count."""
    from collections import Counter
    p = lambda *a: print(*a, file=sys.stderr)
    raw = sum(m["variant_count"] for m in monsters)
    disagreeing = [m for m in monsters if m["variants_disagree"]]
    collapsing = [m for m in monsters if m["variant_count"] > 1]
    p("\n=== MONSTER EXTRACTION SUMMARY ===")
    p(f"  kept records: {raw}  ->  logical monsters: {len(monsters)}")
    p(f"  collapsing >1 record: {len(collapsing)}")
    p(f"  of those, variants disagree on resistances: {len(disagreeing)}")
    p("  by classification: " + ", ".join(
        f"{k}={v}" for k, v in sorted(Counter(m["classification"] for m in monsters).items())))
    p("  by role: " + ", ".join(
        f"{k}={v}" for k, v in sorted(Counter(m["role"] for m in monsters).items())))
    p(f"  summons: {sum(1 for m in monsters if m['is_summon'])}")
    p(f"  no race tag: {sum(1 for m in monsters if not m['race_tag'])}")
    p(f"  excluded: {len(exclusions)}")
    for reason, n in sorted(Counter(e["reason"] for e in exclusions).items()):
        p(f"    - {reason}: {n}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Survey monster resistances into monsters.json")
    ap.add_argument("--records-dir", required=True, type=Path)
    ap.add_argument("--text-dir", required=True, type=Path)
    ap.add_argument("--out", default=Path("monsters.json"), type=Path)
    ap.add_argument("--game-version", default="unknown")
    ap.add_argument("--steam-buildid", default=None)
    args = ap.parse_args(argv)

    db = DB(args.records_dir.resolve())
    if not (db.root / "records/creatures").is_dir():
        print(f"ERROR: creatures not found under {db.root}/records", file=sys.stderr)
        return 2
    tags = load_translations(args.text_dir.resolve())
    if not tags:
        print(f"ERROR: no translations loaded from {args.text_dir}", file=sys.stderr)
        return 2

    monsters = collect_monsters(db, tags)
    meta = {
        "game_version": args.game_version,
        "steam_buildid": args.steam_buildid,
        "generated_utc": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    doc = {"meta": meta, "monsters": monsters, "difficulty_offsets": difficulty_offsets(db)}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {args.out}  ({len(monsters)} monsters)")
    print_summary(monsters, EXCLUSIONS)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run scripts/test_parse_monsters.py`
Expected: every check prints `ok`, final line `FAILURES: 0`, exit code 0.

- [ ] **Step 5: Generate the committed dataset**

Run:
```bash
uv run scripts/parse_monsters.py \
  --records-dir extracted/records --text-dir extracted/text_en \
  --out data/monsters.json --game-version 1.3.0.0
```
Expected stderr summary: kept records near 2,728, logical monsters near 1,637, collapsing groups near 608, disagreeing near 50, and exclusion counts near `not a monster record: 2165`, `hidden from combat: 87`, `invincible: 11`, `no resolvable name: 6`, `devotion role: 191`, `no classification: 51`.

If the counts differ materially from those, stop and report rather than adjusting the assertions to fit: the spec's measurements came from this same extraction, so a large gap means a rule is misimplemented.

- [ ] **Step 6: Align the spec's output sketch**

The spec's illustrative JSON shows `game_version` and `steam_buildid` at the top level. The implementation nests them under `meta`, matching `devotions.json` and `resistance-reduction.json`. In `docs/superpowers/specs/2026-07-24-monster-resistance-pipeline-design.md`, change the opening of the "Output shape" code block from:

```json
{
  "game_version": "1.3.0.0",
  "steam_buildid": "...",
  "monsters": [
```

to:

```json
{
  "meta": {
    "game_version": "1.3.0.0",
    "steam_buildid": "12345678",
    "generated_utc": "2026-07-24T00:00:00Z"
  },
  "monsters": [
```

Also change the `"id"` line in that block from `"id": "nemesis_aetherial_01",` to `"id": "enemies.nemesis.nemesis_aetherial_01",` so the documented id matches the path-derived form the parser emits.

- [ ] **Step 7: Commit**

```bash
git add scripts/parse_monsters.py scripts/test_parse_monsters.py data/monsters.json \
  docs/superpowers/specs/2026-07-24-monster-resistance-pipeline-design.md
git commit -m "feat(monsters): generate data/monsters.json from the extracted records"
```

---

### Task 5: Justfile wiring

Makes the parser a first-class pipeline step so a future version bump regenerates monsters with no extra command, and makes the script tests repeatable.

**Files:**
- Modify: `justfile` (variables, new `parse-monsters` recipe, `all`, `migrate`, `build`, new `test-scripts` recipe)

**Interfaces:**
- Consumes: `scripts/parse_monsters.py` CLI from Task 4; the existing `_game-version` recipe.
- Produces: `just parse-monsters`, `just test-scripts`; `data/monsters.json` copied into `web/dist/data/`.

- [ ] **Step 1: Add the output path variable**

In `justfile`, after the line `out_rr      := justfile_directory() / "data/resistance-reduction.json"`, add:

```
out_mon     := justfile_directory() / "data/monsters.json"
```

- [ ] **Step 2: Add the parse-monsters recipe**

In `justfile`, immediately after the `parse-rr` recipe (before the `diff-data` recipe), add:

```
# Parse extracted records into monsters.json (re-run after a patch / re-extract).
parse-monsters *ARGS:
    #!/usr/bin/env bash
    set -euo pipefail
    read -r buildid version < <(just _game-version)
    mkdir -p "$(dirname "{{out_mon}}")"
    uv run scripts/parse_monsters.py \
        --records-dir "{{records_dir}}" --text-dir "{{text_dir}}" --out "{{out_mon}}" \
        --game-version "$version" --steam-buildid "$buildid" {{ARGS}}
```

- [ ] **Step 3: Add monsters to the pipeline recipes**

In `justfile`, change the `migrate` recipe's dependency line from:

```
migrate: extract parse parse-rr i18n-tables assets build diff-data check
```

to:

```
migrate: extract parse parse-rr parse-monsters i18n-tables assets build diff-data check
```

And change the `all` recipe from:

```
all: extract parse parse-rr i18n-tables
```

to:

```
all: extract parse parse-rr parse-monsters i18n-tables
```

- [ ] **Step 4: Copy the dataset into the built site**

In the `build` recipe, after the line:

```
    cp "{{justfile_directory()}}/data/resistance-reduction.json" dist/data/resistance-reduction.json
```

add:

```
    cp "{{justfile_directory()}}/data/monsters.json" dist/data/monsters.json
```

- [ ] **Step 5: Add a recipe that runs the script tests**

The `scripts/test_*.py` suites are run by hand today, so a new one is easy to forget. In `justfile`, immediately after the `test-slow` recipe, add:

```
# Run the Python script test suites (parsers + data tools). The web suite is `just test`.
test-scripts:
    #!/usr/bin/env bash
    set -euo pipefail
    for t in "{{justfile_directory()}}"/scripts/test_*.py; do
        echo "--- $(basename "$t")"
        uv run "$t"
    done
```

- [ ] **Step 6: Verify the recipes work**

Run: `just parse-monsters`
Expected: regenerates `data/monsters.json` with the real game version resolved from the Steam buildid, and prints the same summary as Task 4 Step 5.

Run: `just test-scripts`
Expected: every `scripts/test_*.py` suite runs and each ends `FAILURES: 0`. If a pre-existing suite fails for reasons unrelated to this work, report it rather than fixing it here.

Run: `git diff --stat data/monsters.json`
Expected: no change, or only the `meta` block (a real version label and buildid replacing the Task 4 values). The monster list itself must be identical, confirming determinism across invocation paths.

- [ ] **Step 7: Commit**

```bash
git add justfile data/monsters.json
git commit -m "build(monsters): wire parse-monsters into the pipeline recipes"
```

---

### Task 6: Monster and race tags in the i18n game tables

Makes monster names and races resolvable in all 13 languages, per the i18n invariant.

**Files:**
- Modify: `scripts/build_game_tables.py`
- Modify: `scripts/test_build_game_tables.py`
- Modify: `justfile` (the `i18n-tables` recipe)

**Interfaces:**
- Consumes: `data/monsters.json` from Task 4 (`monsters[].name_tag`, `monsters[].race_tag`).
- Produces: `collect_referenced_tags(devotions, stat_tags, stat_format_tags=None, rr=None, monsters=None) -> set[str]` (new trailing optional parameter, so existing callers are unaffected); a `--monsters` CLI flag.

- [ ] **Step 1: Write the failing test**

This file's helper is `check(name, got, want)` (three arguments, compares got to want) and the module is aliased `bgt`. Append this block immediately before the final `print("ALL PASSED" if failures == 0 else f"{failures} FAILURE(S)")` line:

```python
# --- monster name + race tags are collected ---
monsters_doc = {"monsters": [
    {"id": "enemies.x", "name_tag": "tagMonsterX", "race_tag": "tagRace005"},
    {"id": "enemies.y", "name_tag": "tagMonsterY", "race_tag": None},
]}
mon_refs = bgt.collect_referenced_tags({}, {}, {}, {}, monsters_doc)
check("monster name tags collected", {"tagMonsterX", "tagMonsterY"} <= mon_refs, True)
check("monster race tag collected", "tagRace005" in mon_refs, True)
check("a null race tag is skipped", None in mon_refs, False)
check("monsters argument is optional",
      isinstance(bgt.collect_referenced_tags({}, {}, {}, {}), set), True)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run scripts/test_build_game_tables.py`
Expected: FAIL, because `collect_referenced_tags` currently takes four arguments and raises `TypeError` on the fifth.

- [ ] **Step 3: Write the implementation**

In `scripts/build_game_tables.py`, change the `collect_referenced_tags` signature and docstring from:

```python
def collect_referenced_tags(
    devotions: dict, stat_tags: dict, stat_format_tags: dict | None = None, rr: dict | None = None
) -> set[str]:
```

to:

```python
def collect_referenced_tags(
    devotions: dict, stat_tags: dict, stat_format_tags: dict | None = None,
    rr: dict | None = None, monsters: dict | None = None
) -> set[str]:
```

Then, immediately before the `tags.update(stat_tags.values())` line, add:

```python
    for m in (monsters or {}).get("monsters", []):
        _add(tags, m.get("name_tag"))
        _add(tags, m.get("race_tag"))
```

In `main`, after the `--rr` argument, add:

```python
    ap.add_argument("--monsters", type=Path,
                    help="Optional monsters.json (adds its monster name + race tags)")
```

After the line that loads `rr`, add:

```python
    monsters = json.loads(args.monsters.read_text(encoding="utf-8")) if args.monsters else {}
```

And change the `collect_referenced_tags` call from:

```python
    referenced = collect_referenced_tags(devotions, stat_tags, stat_format_tags, rr)
```

to:

```python
    referenced = collect_referenced_tags(devotions, stat_tags, stat_format_tags, rr, monsters)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run scripts/test_build_game_tables.py`
Expected: every check prints `ok`, final line reports zero failures, exit code 0.

- [ ] **Step 5: Pass the dataset from the justfile**

In `justfile`, in the `i18n-tables` recipe, change:

```
      uv run scripts/build_game_tables.py --devotions "{{out}}" --stat-tags data/stat-tags.json \
        --stat-format-tags data/stat-format-tags.json --rr "{{out_rr}}" \
        --text-dir "$tdir" --lang "$L" --out "data/i18n/game.$L.json"
```

to:

```
      uv run scripts/build_game_tables.py --devotions "{{out}}" --stat-tags data/stat-tags.json \
        --stat-format-tags data/stat-format-tags.json --rr "{{out_rr}}" --monsters "{{out_mon}}" \
        --text-dir "$tdir" --lang "$L" --out "data/i18n/game.$L.json"
```

- [ ] **Step 6: Rebuild the tables and verify the tags landed**

Run: `just i18n-tables en`
Expected: prints a referenced/resolved/omitted line for `en` with a referenced count well above the previous run (roughly 1,600 monster names plus race tags added).

Run: `jq '{race001: .tagRace001, race005: .tagRace005}' data/i18n/game.en.json`
Expected: `{"race001": "Undead", "race005": "Aether Corruption"}`.

Run:
```bash
jq --arg t "$(jq -r '.monsters[0].name_tag' data/monsters.json)" '.[$t]' data/i18n/game.en.json
```
Expected: a real monster name string, not `null`, confirming monster name tags resolved.

Run: `just i18n-tables`
Expected: rebuilds every installed language; the `built:` line lists all 13.

- [ ] **Step 7: Commit**

```bash
git add scripts/build_game_tables.py scripts/test_build_game_tables.py justfile data/i18n/
git commit -m "feat(monsters): resolve monster and race tags in the i18n game tables"
```

---

### Task 7: Monster section in the data diff

Makes patch-to-patch monster changes visible at review time, the way devotion tuning and RR changes already are.

**Files:**
- Modify: `scripts/diff_data.py`
- Modify: `scripts/test_diff_data.py`

**Interfaces:**
- Consumes: `data/monsters.json` from Task 4; the existing `_load_working` / `_load_baseline` / `_load_gametext` helpers in `diff_data.py`.
- Produces: `diff_monsters(old: dict, new: dict) -> tuple[list[str], list[str], list[str]]` returning `(added, removed, changed)` description lines; a `--monsters` CLI flag.

- [ ] **Step 1: Write the failing test**

This file uses pytest-style `test_*` functions (auto-discovered by its `run()`) with plain `assert`, and aliases the module `dd`. Append these two functions at the end of the file, immediately before the `def run():` definition:

```python
def _mon(mid, fire=10, cls="Common"):
    return {"id": mid, "name_tag": "tag" + mid, "classification": cls,
            "resistances": {"fire": fire, "cold": 0}}


def test_monster_diff_reports_added_removed_and_changed():
    old = {"monsters": [_mon("a"), _mon("b"), _mon("c")]}
    new = {"monsters": [_mon("a"), _mon("b", fire=40), _mon("d")]}
    added, removed, changed = dd.diff_monsters(old, new)
    assert added == ["d (Common)"], added
    assert removed == ["c (Common)"], removed
    assert len(changed) == 1 and changed[0].startswith("b:"), changed
    assert "fire" in changed[0] and "10" in changed[0] and "40" in changed[0], changed


def test_monster_diff_identical_documents_are_clean():
    doc = {"monsters": [_mon("a"), _mon("b")]}
    assert dd.diff_monsters(doc, doc) == ([], [], []), dd.diff_monsters(doc, doc)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run scripts/test_diff_data.py`
Expected: FAIL with `AttributeError: module 'diff_data' has no attribute 'diff_monsters'`.

- [ ] **Step 3: Write the implementation**

In `scripts/diff_data.py`, add this function immediately before `def main(`:

```python
def diff_monsters(old: dict, new: dict):
    """(added, removed, changed) description lines between two monsters.json documents.

    Keyed on the stable id, so a renamed display string is not reported as a
    remove-plus-add. Only resistance changes are reported as changes: they are the
    dataset's payload, and facet churn shows up as an add or remove instead.
    """
    old_by_id = {m["id"]: m for m in old.get("monsters", [])}
    new_by_id = {m["id"]: m for m in new.get("monsters", [])}
    added = [f"{mid} ({new_by_id[mid].get('classification')})"
             for mid in sorted(new_by_id.keys() - old_by_id.keys())]
    removed = [f"{mid} ({old_by_id[mid].get('classification')})"
               for mid in sorted(old_by_id.keys() - new_by_id.keys())]
    changed = []
    for mid in sorted(old_by_id.keys() & new_by_id.keys()):
        o = old_by_id[mid].get("resistances", {})
        n = new_by_id[mid].get("resistances", {})
        deltas = [f"{k} {_fmt(o.get(k))} -> {_fmt(n.get(k))}"
                  for k in sorted(o.keys() | n.keys()) if o.get(k) != n.get(k)]
        if deltas:
            changed.append(f"{mid}: " + ", ".join(deltas))
    return added, removed, changed
```

Then, in `main`, add the CLI flag beside the existing `--rr` argument:

```python
    ap.add_argument("--monsters", type=Path,
                    default=Path(__file__).resolve().parent.parent / "data/monsters.json")
```

And add this section immediately before the final `return exit_code`:

```python
    print("=== monsters.json ===")
    new_mon = _load_working(args.monsters)
    old_mon = _load_baseline(args.monsters)
    if old_mon is None:
        print("  (no committed baseline; skipping monster diff)")
    else:
        added, removed, changed = diff_monsters(old_mon, new_mon)
        print(f"  MONSTERS: +{len(added)} new, -{len(removed)} removed, {len(changed)} changed")
        for a in added:
            print(f"    + {a}")
        if removed:
            print("  REMOVED (review - regression or a legitimate removal):")
            for r in removed:
                print(f"    - {r}")
        for c in changed:
            print(f"    ~ {c}")
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run scripts/test_diff_data.py`
Expected: every check prints `ok`, final line reports zero failures, exit code 0.

- [ ] **Step 5: Verify against the real data**

Run: `just diff-data`
Expected: the report now ends with a `=== monsters.json ===` section. Because `data/monsters.json` was committed in Task 4 and has not changed since, it prints `MONSTERS: +0 new, -0 removed, 0 changed`. The devotion and RR sections are unchanged, and the command exits 0.

- [ ] **Step 6: Run the full gates**

Run: `just test-scripts`
Expected: every suite ends `FAILURES: 0`.

Run: `just check`
Expected: `fmt-check`, the web test suite, `lint`, and `typecheck` all pass. No web sources changed in this plan, so this is a regression guard.

- [ ] **Step 7: Commit**

```bash
git add scripts/diff_data.py scripts/test_diff_data.py
git commit -m "feat(monsters): report monster changes in the data diff"
```

---

## Done criteria

- `just parse-monsters` regenerates `data/monsters.json` deterministically from the extracted records.
- `just all` and `just migrate` include the monster parser, so the next version bump needs no new command.
- `data/monsters.json` holds roughly 1,637 logical monsters, each with all ten resistance keys, a language-independent id, and tag-based name and race.
- `data/i18n/game.<lang>.json` resolves monster names and races in all 13 languages.
- `just diff-data` reports monster additions, removals, and resistance changes.
- `just test-scripts` and `just check` both pass.

## Not in this plan

Per the spec, these are separate sub-projects and must not be started here:

- The explorer page (`web/src/monsters/`). It is brainstormed separately against the real dataset; this plan only produces the data it will consume.
- Health, defensive ability, and offensive ability (the bio-equation phase).
- Attacks, burst damage, and damage types.
- Passive resistance grants from a monster's own skills, which remain a documented limitation.
