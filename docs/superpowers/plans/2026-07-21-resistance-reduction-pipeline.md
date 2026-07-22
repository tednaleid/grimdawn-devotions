# Resistance Reduction Extraction Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A re-runnable, stdlib-only script that sweeps the extracted Grim Dawn `.dbr` records and emits a committed, localizable catalogue of every player-reachable source of enemy resistance reduction (RR) at `data/resistance-reduction.json`.

**Architecture:** A new `scripts/parse_rr.py` mirroring `scripts/parse_devotions.py`, sharing generic `.dbr`/translation/value helpers lifted into a new `scripts/gd_dbr.py` module. It detects the three RR field families established in the spec, follows skill/modifier/item references, classifies each source, and writes a JSON `{meta, sources}` doc plus a stderr summary. Wired to a `just parse-rr` recipe so the Fangs of Asterkarn drop is one re-run.

**Tech Stack:** Python 3.10+ stdlib only, run via `uv run`. Tests are stdlib `check()` scripts run via `uv run` (mirroring `scripts/test_parse_devotions.py`). `just` task runner.

## Global Constraints

Every task's requirements implicitly include these (copied from the spec):

- **Stdlib only.** No third-party deps; PEP-723 inline block with empty `dependencies`, run under `uv run`. Mirror `scripts/parse_devotions.py`.
- **No hardcoded user-facing strings.** RR `name` and `parent` are emitted as localizable descriptors using the existing `register(key, text, table)` pattern (game tag when resolved, else a synthesized stable key), never baked English.
- **Deterministic output.** Two runs over the same extraction produce a byte-identical `data/resistance-reduction.json` (sort sources by a stable key; sort dict keys).
- **Meta keys are snake_case** in the JSON (`game_version`, `steam_buildid`, `generated_utc`, ...), matching `devotions.json` (`web/src/adapters/httpDataSource.ts:metaFromDoc` maps them to camelCase downstream).
- **Extraction location (this repo):** `--records-dir extracted/records` (contains `records/`), `--text-dir extracted/text_en`. The parser runs anywhere the extracted tree exists (unlike Windows-only `just extract`).
- **`data/devotions.json` must stay byte-identical** after the shared-helper refactor (Task 1).
- **Rigor:** never fill a value from memory; an ambiguous record is included with a `notes` explanation, never silently dropped.

### RR field mapping (from the spec, established empirically)

- **Multiplicative** (`reduced-percent`, single highest applies): `offensive<Type>ResistanceReductionPercentMin` (+ `...DurationMin`, `...Chance`). `<Type>` in {`Total`, `Elemental`, `Physical`} only.
- **Flat** (`reduced-flat`, single highest applies): `offensive<Type>ResistanceReductionAbsoluteMin` (+ same siblings). `<Type>` in {`Total`, `Elemental`, `Physical`} only.
- **Stacking** (`stacking`, additive): a **negative** bare `defensive<Type>` value (per-type) or the `defensiveElementalResistance` aggregate, on a debuff/modifier template. `<Type>` in {Physical, Pierce, Fire, Cold, Lightning, Poison, Aether, Chaos, Life, Bleeding}.
- Token -> resistances (kept distinct, never pre-expanded): `Total` -> `"All"`; `Elemental`/`defensiveElementalResistance` -> `"Elemental"`; `Poison` -> `"Poison & Acid"`; `Life` -> `"Vitality"`; else the single label.

### Verified exemplars (used as test oracles)

| Source | Record | Field | Value | Name tag |
|---|---|---|---|---|
| Viper (mult) | `skills/devotion/tier1_13d.dbr` | `offensiveElementalResistanceReductionPercentMin` | 20 (dur 3) | `tagDevotion_A13` |
| Break Morale (flat) | `skills/playerclass01/warcry2.dbr` | `offensivePhysicalResistanceReductionAbsoluteMin` | array, last 45 (dur 5) | `tagClass01SkillName04B` |
| Elemental Storm (flat) | `skills/devotion/tier2_01c_skill.dbr` | `offensiveElementalResistanceReductionAbsoluteMin` | array, last 32 (dur 2) | `tagDevotionEffectB01` |
| Vulnerability (stacking) | `skills/playerclass03/curse2.dbr` | `defensiveElementalResistance` | array, last -35 | `tagClass03SkillName06B` |
| Night's Chill (stacking) | `skills/playerclass04/veilofshadows2.dbr` | `defensiveCold`/`defensivePierce`/`defensivePoison`/`defensiveLife` | array, last -35 | `tagClass04SkillName07B` |
| Aura of Censure (stacking) | `skills/playerclass07/auracensure1_buff.dbr` | `defensiveElementalResistance` | array, last -35 | `tagGDX1Class07SkillName09A` |

---

### Task 1: Shared `scripts/gd_dbr.py` module (behavior-preserving)

Lift the generic helpers out of `parse_devotions.py` so `parse_rr.py` can reuse them without duplication. `devotions.json` output must not change.

**Files:**
- Create: `scripts/gd_dbr.py`
- Create: `scripts/test_gd_dbr.py`
- Modify: `scripts/parse_devotions.py` (replace inline helper defs with imports)

**Interfaces:**
- Produces (imported by parse_devotions and parse_rr):
  - `read_dbr(path: Path) -> dict[str, str]`
  - `load_translations(text_dir: Path) -> dict[str, str]`
  - `clean_text(s: str) -> str`
  - `register(key: str, text: str | None, table: dict[str, str]) -> str`
  - `as_number(value: str) -> int | float | None`
  - `level_array_value(value: str, level: int)` (existing signature/behavior)
  - `class DB` with `__init__(records_dir: Path)`, `path(ref)`, `get(ref)`, `devotion_constellations_dir`

- [ ] **Step 1: Capture the pre-refactor devotions baseline**

Run:
```bash
uv run scripts/parse_devotions.py --records-dir extracted/records --text-dir extracted/text_en --out /tmp/devotions_before.json
```
Expected: `Wrote /tmp/devotions_before.json  (NN constellations)` and exit 0.

- [ ] **Step 2: Create `scripts/gd_dbr.py` with the lifted helpers**

Copy the exact bodies of `read_dbr`, `load_translations`, `clean_text`, `register`, `as_number`, `level_array_value`, and the `DB` class **verbatim** from `parse_devotions.py` (do not alter behavior). Header:

```python
#!/usr/bin/env python3
# ABOUTME: Shared stdlib helpers for reading Grim Dawn .dbr records and translations.
# ABOUTME: Imported by parse_devotions.py and parse_rr.py; no game-domain logic lives here.
from __future__ import annotations

import re
from pathlib import Path

# read_dbr, load_translations, clean_text, register, as_number, level_array_value, DB
# (verbatim copies from parse_devotions.py)
```

- [ ] **Step 3: Write the failing test for the shared module**

Create `scripts/test_gd_dbr.py`:
```python
#!/usr/bin/env -S uv run --script
# ABOUTME: Tests for gd_dbr shared helpers. Run: uv run scripts/test_gd_dbr.py
# /// script
# requires-python = ">=3.10"
# ///
import importlib.util
from pathlib import Path

here = Path(__file__).parent
spec = importlib.util.spec_from_file_location("gd", here / "gd_dbr.py")
gd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gd)

failures = 0
def check(name, got, want):
    global failures
    if got != want:
        failures += 1
        print(f"  FAIL {name}: got {got!r}, want {want!r}")
    else:
        print(f"  ok   {name}")

check("level_array clamps past end", gd.level_array_value("30;40;50", 25), 50)
check("level_array scalar", gd.level_array_value("8.000000", 15), 8)
check("as_number int", gd.as_number("45.000000"), 45)
check("as_number rejects array", gd.as_number("1;2;3"), None)
check("clean_text strips codes", gd.clean_text("{^n}Night^o's"), "Night's")

# read_dbr over a real record: Viper carries the mult field.
db_root = here.parent / "extracted/records"
viper = gd.read_dbr(db_root / "records/skills/devotion/tier1_13d.dbr")
check("read_dbr picks up mult field",
      viper.get("offensiveElementalResistanceReductionPercentMin"), "20.000000")

print("FAILURES:", failures)
raise SystemExit(1 if failures else 0)
```

- [ ] **Step 4: Run the shared-module test**

Run: `uv run scripts/test_gd_dbr.py`
Expected: all `ok`, `FAILURES: 0`, exit 0.

- [ ] **Step 5: Refactor `parse_devotions.py` to import from `gd_dbr`**

Delete the inline defs of `read_dbr`, `load_translations`, `clean_text`, `register`, `as_number`, `level_array_value`, and `class DB` from `parse_devotions.py`. After the existing imports, add (robust to cwd so importlib callers resolve the sibling):
```python
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from gd_dbr import read_dbr, load_translations, clean_text, register, as_number, level_array_value, DB  # noqa: E402
```
Leave everything else (extract_bonuses, proc/pet/chain logic, main) unchanged.

- [ ] **Step 6: Verify devotions output is byte-identical**

Run:
```bash
uv run scripts/parse_devotions.py --records-dir extracted/records --text-dir extracted/text_en --out /tmp/devotions_after.json
diff /tmp/devotions_before.json /tmp/devotions_after.json && echo IDENTICAL
```
Expected: `IDENTICAL` (no diff output). If they differ, the refactor changed behavior — fix before continuing.

- [ ] **Step 7: Run the existing parser test**

Run: `uv run scripts/test_parse_devotions.py`
Expected: existing checks still pass (exit 0).

- [ ] **Step 8: Commit**

```bash
git add scripts/gd_dbr.py scripts/test_gd_dbr.py scripts/parse_devotions.py
git commit -m "refactor(parser): lift generic dbr helpers into scripts/gd_dbr.py"
```

---

### Task 2: `parse_rr.py` skeleton + `just parse-rr` recipe

Stand up the script shell and wiring: CLI, load records + translations, emit an empty `{meta, sources}` doc. No RR detection yet.

**Files:**
- Create: `scripts/parse_rr.py`
- Create: `scripts/test_parse_rr.py`
- Modify: `justfile` (add `out_rr` variable + `parse-rr` recipe)

**Interfaces:**
- Consumes: `gd_dbr.DB`, `gd_dbr.load_translations` (Task 1).
- Produces: `main(argv=None) -> int`; a JSON doc `{"meta": {...}, "sources": [...]}`; module-level helpers extended by later tasks.

- [ ] **Step 1: Write the failing integration test**

Create `scripts/test_parse_rr.py`:
```python
#!/usr/bin/env -S uv run --script
# ABOUTME: Tests for parse_rr RR extraction. Run: uv run scripts/test_parse_rr.py
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

rr = load("rr", "parse_rr.py")

failures = 0
def check(name, cond):
    global failures
    if cond:
        print(f"  ok   {name}")
    else:
        failures += 1
        print(f"  FAIL {name}")

# Run the real parser over the extracted tree into a temp file.
out = Path(tempfile.mkdtemp()) / "rr.json"
rc = subprocess.run([sys.executable, str(here / "parse_rr.py"),
    "--records-dir", str(root / "extracted/records"),
    "--text-dir", str(root / "extracted/text_en"),
    "--out", str(out), "--game-version", "test"]).returncode
check("parser exits 0", rc == 0)
doc = json.loads(out.read_text(encoding="utf-8"))
check("has meta.game_version", doc["meta"]["game_version"] == "test")
check("has meta.generated_utc", bool(doc["meta"].get("generated_utc")))
check("sources is a list", isinstance(doc["sources"], list))

print("FAILURES:", failures)
raise SystemExit(1 if failures else 0)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run scripts/test_parse_rr.py`
Expected: FAIL — `parse_rr.py` does not exist yet (import error).

- [ ] **Step 3: Create the `parse_rr.py` skeleton**

```python
#!/usr/bin/env -S uv run --script
# ABOUTME: Parses Grim Dawn extracted .dbr records into data/resistance-reduction.json.
# ABOUTME: Stdlib-only; catalogues every player-reachable source of enemy resistance reduction.
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Catalogue every source of enemy resistance reduction from the extracted records.

See docs/superpowers/specs/2026-07-21-resistance-reduction-pipeline-design.md for
the field mapping and disambiguation rules. Pure stdlib; re-run after any patch.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gd_dbr import DB, load_translations, register  # noqa: E402


def collect_sources(db: DB, tags: dict[str, str], game_en: dict[str, str]) -> list[dict]:
    """Sweep the extraction and return one dict per RR source. Filled in by later tasks."""
    return []


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Parse Grim Dawn RR sources into resistance-reduction.json")
    ap.add_argument("--records-dir", required=True, type=Path)
    ap.add_argument("--text-dir", required=True, type=Path)
    ap.add_argument("--out", default=Path("resistance-reduction.json"), type=Path)
    ap.add_argument("--game-version", default="unknown")
    ap.add_argument("--steam-buildid", default=None)
    args = ap.parse_args(argv)

    db = DB(args.records_dir.resolve())
    if not (db.root / "records/skills").is_dir():
        print(f"ERROR: skills not found under {db.root}/records", file=sys.stderr)
        return 2
    tags = load_translations(args.text_dir.resolve())
    if not tags:
        print(f"ERROR: no translations loaded from {args.text_dir}", file=sys.stderr)
        return 2

    game_en: dict[str, str] = {}
    sources = collect_sources(db, tags, game_en)
    sources.sort(key=lambda s: (s["rr_type"], s["record_path"]))

    meta = {
        "game_version": args.game_version,
        "steam_buildid": args.steam_buildid,
        "generated_utc": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "berserker_present": (db.root / "records/skills/playerclass13").is_dir(),
    }
    doc = {"meta": meta, "sources": sources}
    args.out.write_text(json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {args.out}  ({len(sources)} sources)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```
(`berserker_present` uses a directory probe; adjust the class-dir number in Task 6 once the Berserker mastery's real path is confirmed against a Fangs extraction — for the current extraction it is simply absent, which is the correct signal.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run scripts/test_parse_rr.py`
Expected: all `ok`, `FAILURES: 0`.

- [ ] **Step 5: Add the `just parse-rr` recipe**

In `justfile`, add a variable next to `out` (line ~13):
```
out_rr      := justfile_directory() / "data/resistance-reduction.json"
```
Add a recipe after the `parse` recipe:
```
# Parse extracted records into resistance-reduction.json (re-run after a patch / re-extract).
parse-rr *ARGS:
    #!/usr/bin/env bash
    set -euo pipefail
    manifest="{{gd_dir}}/../../appmanifest_219990.acf"
    buildid=$(grep -oE '"buildid"[[:space:]]+"[0-9]+"' "$manifest" 2>/dev/null | grep -oE '[0-9]+' || true)
    mkdir -p "$(dirname "{{out_rr}}")"
    uv run scripts/parse_rr.py \
        --records-dir "{{records_dir}}" --text-dir "{{text_dir}}" --out "{{out_rr}}" \
        --game-version "{{gd_version}}" ${buildid:+--steam-buildid "$buildid"} {{ARGS}}
```

- [ ] **Step 6: Run the recipe**

Run: `just parse-rr`
Expected: `Wrote .../data/resistance-reduction.json  (0 sources)` (still empty; sources land in later tasks).

- [ ] **Step 7: Commit**

```bash
git add scripts/parse_rr.py scripts/test_parse_rr.py justfile
git commit -m "feat(rr): parse_rr.py skeleton + just parse-rr recipe"
```

---

### Task 3: Pure classification & value helpers

The pure, fully-determined functions: field-family classification, token->resistances, per-rank value arrays, rank/duration/chance. No sweeping yet.

**Files:**
- Modify: `scripts/parse_rr.py`
- Modify: `scripts/test_parse_rr.py`

**Interfaces:**
- Produces (used by Tasks 4-6):
  - `classify_offensive_field(field: str) -> tuple[str, str] | None` — returns `(rr_type, token)` where `rr_type in {"reduced-percent","reduced-flat"}`.
  - `STACKING_TOKENS: set[str]`, `stacking_token(field: str) -> str | None`.
  - `token_to_resistances(token: str) -> str | list[str]` — `"All"` | `"Elemental"` | `[labels]`.
  - `parse_array(raw: str) -> list[float]`.
  - `rank_value(raw: str, rank: int)` — reuse `gd_dbr.level_array_value`.

- [ ] **Step 1: Write failing unit tests**

Append to `scripts/test_parse_rr.py` (before the `print("FAILURES")` line):
```python
check("mult field", rr.classify_offensive_field("offensiveElementalResistanceReductionPercentMin") == ("reduced-percent", "Elemental"))
check("flat physical", rr.classify_offensive_field("offensivePhysicalResistanceReductionAbsoluteMin") == ("reduced-flat", "Physical"))
check("total flat -> field", rr.classify_offensive_field("offensiveTotalResistanceReductionAbsoluteMin") == ("reduced-flat", "Total"))
check("duration sibling is not a value field", rr.classify_offensive_field("offensiveTotalResistanceReductionAbsoluteDurationMin") is None)
check("non-rr field", rr.classify_offensive_field("offensivePhysicalMin") is None)

check("stacking bare cold", rr.stacking_token("defensiveCold") == "Cold")
check("stacking elemental aggregate", rr.stacking_token("defensiveElementalResistance") == "Elemental")
check("stacking rejects modifier", rr.stacking_token("defensiveColdModifier") is None)
check("stacking rejects duration", rr.stacking_token("defensiveColdDurationModifier") is None)

check("token All", rr.token_to_resistances("Total") == "All")
check("token Elemental", rr.token_to_resistances("Elemental") == "Elemental")
check("token Poison label", rr.token_to_resistances("Poison") == ["Poison & Acid"])
check("token Life label", rr.token_to_resistances("Life") == ["Vitality"])

check("array parse", rr.parse_array("10.0;15.0;20.0") == [10, 15, 20])
check("array negative", rr.parse_array("-3.0;-6.0")[-1] == -6)
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run scripts/test_parse_rr.py`
Expected: FAIL — `classify_offensive_field` not defined.

- [ ] **Step 3: Implement the helpers**

Add to `parse_rr.py` (after the imports, before `collect_sources`):
```python
import re

RR_PERCENT = "reduced-percent"
RR_FLAT = "reduced-flat"
RR_STACKING = "stacking"

ELEMENTAL = ["Fire", "Cold", "Lightning"]

# Bare defensive<Type> tokens that are RR when negative (per the spec's Step 0).
STACKING_TOKENS = {
    "Physical", "Pierce", "Fire", "Cold", "Lightning",
    "Poison", "Aether", "Chaos", "Life", "Bleeding",
}
# Token -> display label where the game name differs from the field token.
TYPE_LABEL = {"Poison": "Poison & Acid", "Life": "Vitality"}

_OFFENSIVE_RE = re.compile(
    r"^offensive(Total|Elemental|Physical)ResistanceReduction(Absolute|Percent)Min$")


def classify_offensive_field(field: str):
    """(rr_type, token) for an offensive RR *value* field, else None. Siblings
    (DurationMin/Chance) return None so only the value field yields a source."""
    m = _OFFENSIVE_RE.match(field)
    if not m:
        return None
    token, suffix = m.group(1), m.group(2)
    return (RR_PERCENT if suffix == "Percent" else RR_FLAT, token)


def stacking_token(field: str):
    """The stacking <Type> token for a bare defensive<Type> field (or the
    defensiveElementalResistance aggregate), else None."""
    if field in ("defensiveElementalResistance", "defensiveElemental"):
        return "Elemental"
    m = re.fullmatch(r"defensive([A-Za-z]+)", field)
    if m and m.group(1) in STACKING_TOKENS:
        return m.group(1)
    return None


def token_to_resistances(token: str):
    """Kept distinct, never pre-expanded: 'All' | 'Elemental' | [labels]."""
    if token == "Total":
        return "All"
    if token == "Elemental":
        return "Elemental"
    return [TYPE_LABEL.get(token, token)]


def parse_array(raw: str) -> list:
    """';'-separated per-rank numbers -> list (int when whole)."""
    out = []
    for part in raw.split(";"):
        part = part.strip()
        if not part:
            continue
        try:
            f = round(float(part), 4)
        except ValueError:
            continue
        out.append(int(f) if f == int(f) else f)
    return out
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run scripts/test_parse_rr.py`
Expected: all `ok`, `FAILURES: 0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/parse_rr.py scripts/test_parse_rr.py
git commit -m "feat(rr): field classification and value-array helpers"
```

---

### Task 4: Skills sweep — offensive families (flat + multiplicative)

Walk `records/skills/**`, emit one source per offensive RR value field, with name/parent/category/values/trigger metadata.

**Files:**
- Modify: `scripts/parse_rr.py`
- Modify: `scripts/test_parse_rr.py`

**Interfaces:**
- Consumes: `classify_offensive_field`, `token_to_resistances`, `parse_array` (Task 3); `DB`, `register`, `gd_dbr.level_array_value`.
- Produces: `iter_skill_records(db) -> Iterator[tuple[str, dict]]` yielding `(record_path, record)`; `source_from_offensive(db, tags, game_en, rec_path, rec, field) -> dict`; a populated `collect_sources`.
- Source dict shape (all tasks converge on this):
  `{id, name, parent, record_path, category, rr_type, resistances, values_per_rank, max_rank, ultimate_rank, value_at_max, value_at_ultimate, duration_seconds, cooldown_seconds, trigger_chance_percent, trigger, per_resistance_values, notes}`

- [ ] **Step 1: Write the failing integration test**

Append to `scripts/test_parse_rr.py` (these assert against the temp `doc` already loaded in Task 2's block — move the offensive checks after `doc = json.loads(...)`):
```python
def find(pred):
    return [s for s in doc["sources"] if pred(s)]

viper = find(lambda s: s["record_path"].endswith("skills/devotion/tier1_13d.dbr"))
check("viper present", len(viper) == 1)
check("viper mult 20 elemental", viper and viper[0]["rr_type"] == "reduced-percent"
      and viper[0]["value_at_max"] == 20 and viper[0]["resistances"] == "Elemental")
check("viper duration 3", viper and viper[0]["duration_seconds"] == 3)

morale = find(lambda s: s["record_path"].endswith("skills/playerclass01/warcry2.dbr")
              and s["rr_type"] == "reduced-flat")
check("break morale flat physical 45", morale and morale[0]["value_at_max"] == 45
      and morale[0]["resistances"] == ["Physical"])

estorm = find(lambda s: s["record_path"].endswith("skills/devotion/tier2_01c_skill.dbr")
              and s["rr_type"] == "reduced-flat")
check("elemental storm flat 32", estorm and estorm[0]["value_at_max"] == 32
      and estorm[0]["resistances"] == "Elemental")
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run scripts/test_parse_rr.py`
Expected: FAIL — `viper present` false (sweep not implemented).

- [ ] **Step 3: Implement the offensive sweep**

Add to `parse_rr.py`:
```python
from gd_dbr import level_array_value  # noqa: E402  (add to the gd_dbr import line)


def iter_skill_records(db: DB):
    """Yield (posix record path like 'records/skills/...', parsed record) for every .dbr under skills."""
    skills_root = db.root / "records/skills"
    for p in sorted(skills_root.rglob("*.dbr")):
        rel = p.relative_to(db.root).as_posix()
        yield rel, db.get(rel)


def _name_descriptor(rec, rec_path, tags, game_en):
    """Localizable name: resolve skillDisplayName tag, else a stable synthesized key."""
    tag = rec.get("skillDisplayName", "").strip()
    text = tags.get(tag) if tag else None
    key = register(tag or f"x:rr:{rec_path}", text, game_en)
    return key


def _ultimate(rec):
    v = rec.get("skillUltimateLevel", "").strip()
    try:
        return int(float(v)) if v else None
    except ValueError:
        return None


def source_from_offensive(db, tags, game_en, rec_path, rec, field, rr_type, token):
    arr = parse_array(rec[field])
    max_rank = len(arr)
    ult = _ultimate(rec)
    suffix = "Percent" if rr_type == RR_PERCENT else "Absolute"
    base = field[:-len("Min")]  # e.g. offensiveElementalResistanceReductionAbsolute
    dur = rec.get(base + "DurationMin", "").strip()
    chance = rec.get(base + "Chance", "").strip()
    return {
        "id": rec_path.replace("/", ":").removesuffix(".dbr") + f":{rr_type}",
        "name": _name_descriptor(rec, rec_path, tags, game_en),
        "parent": None,  # filled by category/parent pass (Task 6)
        "record_path": rec_path,
        "category": None,  # Task 6
        "rr_type": rr_type,
        "resistances": token_to_resistances(token),
        "values_per_rank": arr,
        "max_rank": max_rank,
        "ultimate_rank": ult,
        "value_at_max": arr[-1] if arr else None,
        "value_at_ultimate": level_array_value(rec[field], ult) if ult else None,
        "duration_seconds": _num(dur),
        "cooldown_seconds": _num(rec.get("skillCooldownTime", "")),
        "trigger_chance_percent": _num(chance),
        "trigger": None,  # Task 6 classification
        "per_resistance_values": None,
        "notes": "",
    }


def _num(s):
    s = (s or "").strip()
    if not s or ";" in s:
        return None
    try:
        f = round(float(s), 4)
        return int(f) if f == int(f) else f
    except ValueError:
        return None
```
Replace `collect_sources` body:
```python
def collect_sources(db, tags, game_en):
    sources = []
    for rec_path, rec in iter_skill_records(db):
        for field in rec:
            hit = classify_offensive_field(field)
            if hit:
                rr_type, token = hit
                sources.append(source_from_offensive(db, tags, game_en, rec_path, rec, field, rr_type, token))
    return sources
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run scripts/test_parse_rr.py`
Expected: viper / break morale / elemental storm checks pass, `FAILURES: 0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/parse_rr.py scripts/test_parse_rr.py
git commit -m "feat(rr): sweep offensive flat + multiplicative RR from skills"
```

---

### Task 5: Skills sweep — stacking family (negative defensive + templates + modifier parents)

Detect the stacking family, gate by template, resolve `skill_modifier` parents to enemy-facing skills, exclude self-buffs (logged).

**Files:**
- Modify: `scripts/parse_rr.py`
- Modify: `scripts/test_parse_rr.py`

**Interfaces:**
- Consumes: `stacking_token`, `token_to_resistances`, `parse_array` (Task 3); `iter_skill_records`, `_name_descriptor`, `_ultimate`, `_num` (Task 4).
- Produces: `DEBUFF_TEMPLATES: set[str]`, `SELF_TEMPLATES: set[str]`, `template_name(rec) -> str`, `reverse_ref_index(db) -> dict[str, list[str]]`, `is_enemy_facing_modifier(db, rec_path, index) -> bool`, `source_from_stacking(...)`, `EXCLUSIONS: list[dict]`.

**Investigation note (test-gated, not a placeholder):** the `skill_modifier` bucket (136 records) needs parent resolution — a modifier's RR counts only when it modifies an enemy-facing skill. Build a reverse-reference index (map each referenced `.dbr` path to the records that reference it), then treat a modifier as enemy-facing when a referencing skill's own template (or its `buffSkillName` target) is a debuff/aura template. The integration test below is the oracle: Night's Chill (`veilofshadows2`, referenced by the Veil of Shadow toggled aura) must be **included**; a `skill_buffselfduration` self-debuff must be **excluded and logged**.

- [ ] **Step 1: Write the failing integration test**

Append to `scripts/test_parse_rr.py`:
```python
vuln = find(lambda s: s["record_path"].endswith("skills/playerclass03/curse2.dbr"))
check("vulnerability stacking elemental -35", vuln and vuln[0]["rr_type"] == "stacking"
      and vuln[0]["resistances"] == "Elemental" and vuln[0]["value_at_max"] == -35)

nc = find(lambda s: s["record_path"].endswith("skills/playerclass04/veilofshadows2.dbr"))
check("night's chill present (stacking)", nc and nc[0]["rr_type"] == "stacking")
# Night's Chill hits Cold, Pierce, Poison & Acid, and Vitality; per-resistance split.
nc_res = set()
for s in nc:
    r = s["resistances"]
    nc_res |= set(r if isinstance(r, list) else [r])
check("night's chill covers Cold/Pierce/Poison&Acid/Vitality",
      {"Cold", "Pierce", "Poison & Acid", "Vitality"} <= nc_res)

censure = find(lambda s: s["record_path"].endswith("skills/playerclass07/auracensure1_buff.dbr"))
check("aura of censure stacking elemental -35", censure and censure[0]["value_at_max"] == -35)
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run scripts/test_parse_rr.py`
Expected: FAIL — stacking sources absent.

- [ ] **Step 3: Implement stacking detection + template gating + parent resolution**

Add to `parse_rr.py`:
```python
DEBUFF_TEMPLATES = {
    "skillbuff_debuf.tpl", "skillbuff_contageous.tpl",
    "skillbuff_debuftrap.tpl", "skillbuff_debuffreeze.tpl",
}
SELF_TEMPLATES = {"skill_buffselfduration.tpl"}
MODIFIER_TEMPLATE = "skill_modifier.tpl"

EXCLUSIONS: list = []  # {record_path, reason} for the summary


def template_name(rec) -> str:
    return rec.get("templateName", "").rsplit("/", 1)[-1]


def reverse_ref_index(db):
    """Map each referenced 'records/.../x.dbr' -> [record paths that reference it]."""
    index: dict[str, list[str]] = {}
    for rec_path, rec in iter_skill_records(db):
        for v in rec.values():
            if v.endswith(".dbr") and "records/" in v:
                ref = v.replace("\\", "/").strip()
                index.setdefault(ref, []).append(rec_path)
    return index


def is_enemy_facing_modifier(db, rec_path, index) -> bool:
    """A skill_modifier is enemy-facing when a skill that references it is (or resolves
    through buffSkillName to) a debuff/aura template."""
    for referrer in index.get(rec_path, []):
        ref_rec = db.get(referrer)
        if template_name(ref_rec) in DEBUFF_TEMPLATES:
            return True
        buff = ref_rec.get("buffSkillName", "").replace("\\", "/").strip()
        if buff and template_name(db.get(buff)) in DEBUFF_TEMPLATES:
            return True
    return False


def stacking_sources(db, tags, game_en, rec_path, rec, index):
    """Zero or more stacking sources from one record's negative defensive<Type> fields."""
    tmpl = template_name(rec)
    hits = []
    for field, raw in rec.items():
        token = stacking_token(field)
        if not token:
            continue
        arr = parse_array(raw)
        if not arr or arr[-1] >= 0:  # only negative = reduction
            continue
        hits.append((field, token, raw, arr))
    if not hits:
        return []
    # Template gate.
    if tmpl in DEBUFF_TEMPLATES:
        pass
    elif tmpl == MODIFIER_TEMPLATE:
        if not is_enemy_facing_modifier(db, rec_path, index):
            EXCLUSIONS.append({"record_path": rec_path, "reason": "modifier parent not enemy-facing"})
            return []
    elif tmpl in SELF_TEMPLATES:
        EXCLUSIONS.append({"record_path": rec_path, "reason": f"self template {tmpl}"})
        return []
    else:
        # Edge templates (skillbuff_passive, monster.tpl): include with a note.
        pass
    out = []
    ult = _ultimate(rec)
    for field, token, raw, arr in hits:
        out.append({
            "id": rec_path.replace("/", ":").removesuffix(".dbr") + f":stacking:{token}",
            "name": _name_descriptor(rec, rec_path, tags, game_en),
            "parent": None, "record_path": rec_path, "category": None,
            "rr_type": RR_STACKING,
            "resistances": token_to_resistances(token),
            "values_per_rank": arr, "max_rank": len(arr), "ultimate_rank": ult,
            "value_at_max": arr[-1],
            "value_at_ultimate": level_array_value(raw, ult) if ult else None,
            "duration_seconds": _num(rec.get("skillActiveDuration", "")),
            "cooldown_seconds": _num(rec.get("skillCooldownTime", "")),
            "trigger_chance_percent": None,
            "trigger": None, "per_resistance_values": None,
            "notes": "" if tmpl in DEBUFF_TEMPLATES or tmpl == MODIFIER_TEMPLATE
                     else f"unusual template {tmpl}; verify enemy-facing",
        })
    return out
```
Extend `collect_sources` to build the index once and call `stacking_sources`:
```python
def collect_sources(db, tags, game_en):
    sources = []
    index = reverse_ref_index(db)
    for rec_path, rec in iter_skill_records(db):
        for field in rec:
            hit = classify_offensive_field(field)
            if hit:
                rr_type, token = hit
                sources.append(source_from_offensive(db, tags, game_en, rec_path, rec, field, rr_type, token))
        sources.extend(stacking_sources(db, tags, game_en, rec_path, rec, index))
    return sources
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run scripts/test_parse_rr.py`
Expected: vulnerability / night's chill / aura of censure checks pass, `FAILURES: 0`. If Night's Chill is excluded, inspect `is_enemy_facing_modifier` against Veil of Shadow's aura (`veilofshadows1.dbr`, `Skill_BuffRadiusToggled` with `buffSkillName` -> `veilofshadows1_buff.dbr`, a `skillbuff_debuf`) and widen the referrer check to follow toggled-aura buff chains until the test passes.

- [ ] **Step 5: Commit**

```bash
git add scripts/parse_rr.py scripts/test_parse_rr.py
git commit -m "feat(rr): sweep stacking RR with template gating and modifier parent resolution"
```

---

### Task 6: Category, parent, trigger classification + item attribution

Assign `category`, localizable `parent`, and a classified `trigger` to every source, including resolving item-granted skills and item skill-modifiers to their items.

**Files:**
- Modify: `scripts/parse_rr.py`
- Modify: `scripts/test_parse_rr.py`

**Interfaces:**
- Consumes: the source list from Tasks 4-5; `DB`, `register`, translations.
- Produces: `classify_category(db, rec_path, rec) -> str`, `classify_trigger(rec) -> str`, `attribute_items(db, tags, game_en, sources) -> None` (mutates category/parent for item-granted sources).

**Investigation note (test-gated):** category comes from the record's template/class and path — `skills/devotion/**` -> `devotion`; transmuters carry the transmuter class; a `skill_modifier` -> `modifier`; a mastery skill under `skills/playerclassNN/**` -> `mastery skill`. Item attribution requires walking `records/items/**` and following each item's granted-skill and skill-modifier references (known reference fields include `itemSkillName`, `augmentSkillName1..N`, `modifiedSkillName1..N`, `itemSkillLevel`); the full field set is discovered here with the integration test + summary counts as the oracle. Item categories (`component`, `augment`, `relic`, `set bonus`, `item granted`, `item skill modifier`, `monster infrequent`) come from the item record's type/path. The eldritchwhispers set-modifier records under `skills/itemskillsgdx1/skillmodifiers/**` (which carry `offensiveElementalResistanceReductionPercentMin`) are a confirmed item-skill-modifier exemplar.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test_parse_rr.py`:
```python
check("every source has a category", all(s["category"] for s in doc["sources"]))
check("every source has a trigger", all(s["trigger"] for s in doc["sources"]))
check("viper category devotion", viper and viper[0]["category"] == "devotion")
check("break morale is a mastery/modifier skill",
      morale and morale[0]["category"] in {"mastery skill", "modifier"})
# At least one item-attributed source exists (eldritchwhispers mult modifier, etc.).
item_sources = find(lambda s: s["category"] in {
    "component", "augment", "relic", "set bonus", "item granted", "item skill modifier", "monster infrequent"})
check("item-attributed RR sources exist", len(item_sources) >= 1)
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run scripts/test_parse_rr.py`
Expected: FAIL — categories/triggers are `None`.

- [ ] **Step 3: Implement classification + item attribution**

Add `classify_category(db, rec_path, rec)` and `classify_trigger(rec)` using the record path and template/class per the investigation note; then `attribute_items(db, tags, game_en, sources)` that builds an index from RR-bearing skill `record_path` -> item, walking `records/items/**` for granted-skill/modifier references and overriding `category`/`parent` for matched sources (leaving pure-skill sources with their skill category). Call both from `collect_sources` after the sweep:
```python
    for s in sources:
        rec = db.get(s["record_path"])
        s["category"] = classify_category(db, s["record_path"], rec)
        s["trigger"] = classify_trigger(rec)
        if s["parent"] is None:
            s["parent"] = _parent_descriptor(db, tags, game_en, s["record_path"], rec)
    attribute_items(db, tags, game_en, sources)
    return sources
```
Write `classify_category`, `classify_trigger`, `attribute_items`, and `_parent_descriptor` with real logic (no stubs); iterate against the integration test until all four new checks pass. Record any item-reference field you rely on in a code comment so the next re-run is auditable.

- [ ] **Step 4: Run to verify it passes**

Run: `uv run scripts/test_parse_rr.py`
Expected: category/trigger/item checks pass, `FAILURES: 0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/parse_rr.py scripts/test_parse_rr.py
git commit -m "feat(rr): category, parent, trigger classification + item attribution"
```

---

### Task 7: Summary, determinism, dataset + prototype cross-check

Emit the audit summary, guarantee deterministic output, generate and commit `data/resistance-reduction.json`, and produce the cross-check report against the prototype's 33 rows.

**Files:**
- Modify: `scripts/parse_rr.py` (summary to stderr)
- Modify: `scripts/test_parse_rr.py` (determinism check)
- Create: `scripts/compare_rr_prototype.py`
- Create: `data/resistance-reduction.json` (generated, committed)

**Interfaces:**
- Consumes: `EXCLUSIONS`, the source list.
- Produces: `print_summary(sources, exclusions)`; a committed dataset.

- [ ] **Step 1: Write the failing determinism test**

Append to `scripts/test_parse_rr.py`:
```python
out2 = Path(tempfile.mkdtemp()) / "rr2.json"
subprocess.run([sys.executable, str(here / "parse_rr.py"),
    "--records-dir", str(root / "extracted/records"),
    "--text-dir", str(root / "extracted/text_en"),
    "--out", str(out2), "--game-version", "test"], check=True)
check("deterministic output", out.read_bytes() == out2.read_bytes())
check("has stacking, flat, and percent sources",
      {"stacking", "reduced-flat", "reduced-percent"} <= {s["rr_type"] for s in doc["sources"]})
```

- [ ] **Step 2: Run to verify it fails / passes**

Run: `uv run scripts/test_parse_rr.py`
Expected: the determinism check may already pass (sorted output); the rr_type-coverage check passes. If determinism fails, ensure `collect_sources` output is fully sorted (it is, via `main`'s `sources.sort`) and that no dict carries run-varying data.

- [ ] **Step 3: Add the stderr summary**

In `main`, before `return 0`, add `print_summary(sources, EXCLUSIONS)` writing to stderr: counts per `rr_type`, counts per `category`, the count of excluded records with their reasons, and an "unsure" list (sources whose `notes` is non-empty). Format mirrors the devotions parser's `=== VALIDATION REPORT ===` block.

- [ ] **Step 4: Generate and commit the dataset**

Run: `just parse-rr`
Expected: `Wrote .../data/resistance-reduction.json (NN sources)` and the summary on stderr.
Sanity-check `NN` is in the low hundreds and the summary's exclusions read sensibly (self-buffs, non-enemy modifiers).

- [ ] **Step 5: Write the prototype cross-check script**

Create `scripts/compare_rr_prototype.py` (stdlib `uv` script): parse the `DATA = [...]` array out of `.llm/grim-dawn-rr_1.html` (regex the JS array, or a small hand-transcription of its 33 `{id,name,rr,value,...}` rows), match each against `data/resistance-reduction.json` by name/parent, and print a table of matches with our value vs. their value, plus prototype rows we did not find. This is a **report**, not a test gate — values legitimately differ (their community numbers vs. our record reads).

- [ ] **Step 6: Run the cross-check and eyeball coverage**

Run: `uv run scripts/compare_rr_prototype.py`
Expected: a diff table. Confirm the catalogue covers at least the prototype's set; investigate any prototype row missing from ours (it may be a real gap in the sweep or a prototype error — note which in the summary's unsure list).

- [ ] **Step 7: Commit**

```bash
git add scripts/parse_rr.py scripts/test_parse_rr.py scripts/compare_rr_prototype.py data/resistance-reduction.json
git commit -m "feat(rr): summary, deterministic dataset, prototype cross-check"
```

---

## Self-Review

**Spec coverage:**
- Re-runnable script + committed dataset + `just` recipe -> Tasks 2, 7.
- Localizable text (register pattern) -> Tasks 4-6 (`_name_descriptor`, `_parent_descriptor`).
- Step 0 three-family mapping -> Task 3 (helpers), Tasks 4-5 (sweeps).
- Stacking disambiguation (templates, modifier parents, self-buff exclusion) -> Task 5.
- Full coverage (skills, devotions, items incl. skill-modifiers; monster-only excluded) -> Tasks 4-6; monster-infrequent items in Task 6 categories.
- Schema (all fields) -> Task 4 source dict, extended in 5-6.
- Rigor (ambiguous included-with-note, exclusions logged) -> Task 5 `EXCLUSIONS`/notes, Task 7 summary.
- Version/berserker-present meta -> Task 2.
- Verification (cross-check, guard exemplars, devotions parity, determinism) -> Task 1 (parity), Tasks 4-5 (exemplar guards), Task 7 (determinism + cross-check).
- Justfile wiring -> Task 2.

**Placeholder scan:** the three "investigation notes" (Task 5 modifier parents, Task 6 item attribution) are test-gated algorithms with concrete starting fields and a named oracle, not vague TODOs; each has a failing test that must pass. No "add error handling"/"TBD" steps.

**Type consistency:** the source dict shape is defined once in Task 4's Interfaces and reused verbatim in Task 5; `rr_type` values (`reduced-percent`/`reduced-flat`/`stacking`) are consistent across `classify_offensive_field`, `stacking_sources`, tests, and the sort key. `token_to_resistances` returns `"All"|"Elemental"|[labels]` consistently everywhere.
