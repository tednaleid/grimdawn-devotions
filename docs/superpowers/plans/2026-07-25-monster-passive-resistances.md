# Monster Passive Resistances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold the resistance a monster gains from its own skills into `data/monsters.json`, so the dataset reports what a player actually faces instead of the inline record value alone.

**Architecture:** Extends the existing `scripts/parse_monsters.py`. A new pure resolver walks each creature's `skillName{n}` / `skillLevel{n}` pairs, classifies the referenced record, and buckets its resistance contributions into resident (folded into the headline total) or aura (recorded separately). Resolution happens per raw record, before the grain collapse, so the representative's combined total is what reaches the dataset.

**Tech Stack:** Python 3.10+ via `uv` (stdlib only), `just` task runner, existing `scripts/gd_dbr.py` helpers.

**Spec:** `docs/superpowers/specs/2026-07-25-monster-passive-resistances-design.md`

**Branch:** `monster-resistance-pipeline` (continues the v1 pipeline work; do not create a new branch)

## Global Constraints

- **Stdlib only.** No third-party dependencies. Reuse `scripts/gd_dbr.py`; `level_array_value` already implements the exact rank-selection rule this work needs and must not be reimplemented.
- **Python runs via `uv`.** Bare `python`/`python3` fails on this machine (exit 49).
- **Determinism.** Two runs over the same records must produce byte-identical output apart from the `meta` block.
- **The ten resistance keys stay always present** on `resistances`, in this exact order: `physical`, `pierce`, `fire`, `cold`, `lightning`, `poison`, `aether`, `chaos`, `vitality`, `bleeding`.
- **`resistances` is the combined total** (inline plus resident passives). This preserves the v1 contract the explorer page was designed against.
- **Contributions are additive**, both between multiple skills and on top of a nonzero inline value.
- **Class buckets, exactly:**
  - Resident, folded into `resistances`: `Skill_Passive`, `SkillBuff_Passive`, `Skill_PassiveOnLifeBuffSelf`
  - Aura, recorded in `aura_resistances` only: `Skill_BuffSelfDuration`, `Skill_BuffSelfToggled`, `Skill_BuffAttackRadiusToggled`
  - Contribute nothing, counted as "summoned entity": `Monster`, `Turret`, `SpiritHost`, `PetPlayerScaling`
  - Any other class contributes nothing and is counted as "unclassified skill class"
- **Sparse provenance objects.** `passive_resistances` and `aura_resistances` contain only nonzero entries and are omitted entirely when empty.
- **Summoned creatures remain dataset rows.** No new exclusion rule. The row count must not change.
- **Level selection:** the entry at the 1-based pinned level, clamped to the last entry, never extrapolated. A missing or unparseable `skillLevel{n}` defaults to level 1.
- **Validation fixtures** (game version 1.3.0.0):
  - `enemies.boss-quest.ghost_stepsoftorment_01` (Alkamos, `tagGhostBoss05`): bleeding 0 becomes **100**
  - `enemies.nemesis.nemesis_eldritch_01` (Kaisan, `tagGDX2Nemesis_Eldritch01`): bleeding 0 becomes **45**, pierce 66 becomes 67, fire 45 becomes 46
  - `tagBloodswornBoss02` (Karroz, `enemies.boss-quest.cultist_summoner_01`) must still be present
  - Row count stays **1,637**; raw records stay **2,728**
- **Script tests** run via `just test-scripts` (all six suites) or individually with `uv run scripts/test_parse_monsters.py`.

---

### Task 1: Pure skill-contribution resolution

Adds the classification sets and the pure resolver. No wiring into the pipeline yet, so `data/monsters.json` is untouched by this task.

**Files:**
- Modify: `scripts/parse_monsters.py` (imports, plus new code appended after `race_tag_of`)
- Modify: `scripts/test_parse_monsters.py` (append before the final `print("FAILURES:", failures)`)

**Interfaces:**
- Consumes: `RESISTANCE_FIELDS`, `as_float` (Task 1 of the v1 plan); `level_array_value` from `gd_dbr`.
- Produces: `SELF_PASSIVE_CLASSES`, `AURA_CLASSES`, `SUMMON_CLASSES`, `SKILL_EXCLUSIONS: list[dict]`, `_skill_level(rec, n) -> int`, `skill_contributions(rel_path, rec, get_skill) -> tuple[dict, dict]`, `_tidy(d) -> dict`, `resolved_resistances(rel_path, rec, get_skill) -> dict`. `get_skill` is an injected callable taking a record reference and returning a record dict, so the resolver is testable without a filesystem. `resolved_resistances` returns `{"resistances": {...ten keys...}, "passive": {...sparse...}, "aura": {...sparse...}}`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test_parse_monsters.py`, immediately before the final `print("FAILURES:", failures)` line:

```python
# --- Task 1 (passives): skill level pinning ---
check("skill level reads the pinned rank", mon._skill_level({"skillLevel3": "4.000000"}, "3") == 4)
check("absent skill level defaults to 1", mon._skill_level({}, "3") == 1)
check("unparseable skill level defaults to 1", mon._skill_level({"skillLevel3": "abc"}, "3") == 1)
check("zero skill level defaults to 1", mon._skill_level({"skillLevel3": "0"}, "3") == 1)

# --- Task 1 (passives): contribution bucketing by skill Class ---
SKILLS = {
    "records/skills/np/passive.dbr": {"Class": "Skill_Passive", "defensiveBleeding": "100.000000"},
    "records/skills/np/buffpassive.dbr": {"Class": "SkillBuff_Passive", "defensiveFire": "10.000000"},
    "records/skills/np/onlife.dbr": {"Class": "Skill_PassiveOnLifeBuffSelf", "defensiveChaos": "7.000000"},
    "records/skills/np/aura.dbr": {"Class": "Skill_BuffAttackRadiusToggled", "defensiveCold": "20.000000"},
    "records/skills/np/toggled.dbr": {"Class": "Skill_BuffSelfToggled", "defensiveCold": "5.000000"},
    "records/skills/np/duration.dbr": {"Class": "Skill_BuffSelfDuration", "defensiveAether": "9.000000"},
    "records/skills/np/minion.dbr": {"Class": "Monster", "defensivePhysical": "50.000000"},
    "records/skills/np/turret.dbr": {"Class": "Turret", "defensivePierce": "50.000000"},
    "records/skills/np/weird.dbr": {"Class": "AttributePak", "defensiveVitalityBogus": "1", "defensiveLife": "40.000000"},
    "records/skills/np/levelled.dbr": {"Class": "Skill_Passive", "defensiveBleeding": "10.000000;20.000000;30.000000"},
    "records/skills/np/nores.dbr": {"Class": "Skill_Passive", "characterLife": "500.000000"},
}
get_skill = lambda ref: SKILLS.get(ref.strip(), {})

def contrib(skills_and_levels):
    rec = {}
    for i, (ref, lvl) in enumerate(skills_and_levels, start=1):
        rec[f"skillName{i}"] = ref
        if lvl is not None:
            rec[f"skillLevel{i}"] = str(lvl)
    return mon.skill_contributions("enemies/x.dbr", rec, get_skill)

before = len(mon.SKILL_EXCLUSIONS)
p, a = contrib([("records/skills/np/passive.dbr", 1)])
check("self passive contributes to the passive bucket", p == {"bleeding": 100} and a == {})
p, a = contrib([("records/skills/np/buffpassive.dbr", 1)])
check("SkillBuff_Passive is resident", p == {"fire": 10})
p, a = contrib([("records/skills/np/onlife.dbr", 1)])
check("Skill_PassiveOnLifeBuffSelf is resident", p == {"chaos": 7})
p, a = contrib([("records/skills/np/aura.dbr", 1)])
check("aura class goes to the aura bucket only", a == {"cold": 20} and p == {})
p, a = contrib([("records/skills/np/toggled.dbr", 1)])
check("toggled class goes to the aura bucket only", a == {"cold": 5} and p == {})
p, a = contrib([("records/skills/np/duration.dbr", 1)])
check("duration class goes to the aura bucket only", a == {"aether": 9} and p == {})
p, a = contrib([("records/skills/np/minion.dbr", 1)])
check("summoned entity contributes nothing", p == {} and a == {})
p, a = contrib([("records/skills/np/turret.dbr", 1)])
check("turret contributes nothing", p == {} and a == {})
p, a = contrib([("records/skills/np/weird.dbr", 1)])
check("unclassified class contributes nothing", p == {} and a == {})
check("skipped skills carrying a resistance are recorded",
      len(mon.SKILL_EXCLUSIONS) - before == 3)
check("skip reasons name summoned entity and unclassified",
      {"summoned entity"} <= {e["reason"] for e in mon.SKILL_EXCLUSIONS[before:]}
      and any(e["reason"].startswith("unclassified skill class") for e in mon.SKILL_EXCLUSIONS[before:]))

# a skill with no tracked resistance is not recorded as an exclusion
before2 = len(mon.SKILL_EXCLUSIONS)
contrib([("records/skills/np/nores.dbr", 1)])
check("a resistance-free skill is not recorded as skipped", len(mon.SKILL_EXCLUSIONS) == before2)

# level pinning against a real array, and clamping past its end
p, _ = contrib([("records/skills/np/levelled.dbr", 2)])
check("level array picks the pinned entry", p == {"bleeding": 20})
p, _ = contrib([("records/skills/np/levelled.dbr", 99)])
check("level array clamps to the last entry", p == {"bleeding": 30})
p, _ = contrib([("records/skills/np/levelled.dbr", None)])
check("missing skill level uses rank 1", p == {"bleeding": 10})

# additive across multiple skills
p, _ = contrib([("records/skills/np/passive.dbr", 1), ("records/skills/np/levelled.dbr", 3)])
check("contributions add across skills", p == {"bleeding": 130})

# --- Task 1 (passives): combining with inline values ---
check("tidy drops zero entries", mon._tidy({"fire": 0, "cold": 5}) == {"cold": 5})
check("tidy keeps whole numbers whole", mon._tidy({"cold": 5.0})["cold"] == 5)

rec_inline = {"defensiveFire": "10.000000", "skillName1": "records/skills/np/buffpassive.dbr", "skillLevel1": "1"}
res = mon.resolved_resistances("enemies/x.dbr", rec_inline, get_skill)
check("passive stacks on a nonzero inline value", res["resistances"]["fire"] == 20)
check("combined keeps all ten keys", list(res["resistances"].keys()) == TEN)
check("passive provenance is sparse", res["passive"] == {"fire": 10})
check("aura provenance is empty when unused", res["aura"] == {})

rec_aura = {"defensiveCold": "10.000000", "skillName1": "records/skills/np/aura.dbr", "skillLevel1": "1"}
res_a = mon.resolved_resistances("enemies/x.dbr", rec_aura, get_skill)
check("aura is NOT folded into the total", res_a["resistances"]["cold"] == 10)
check("aura provenance is recorded", res_a["aura"] == {"cold": 20})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run scripts/test_parse_monsters.py`
Expected: FAIL with `AttributeError: module 'mon' has no attribute '_skill_level'`.

- [ ] **Step 3: Write the implementation**

In `scripts/parse_monsters.py`, change the `gd_dbr` import line from:

```python
from gd_dbr import DB, load_translations  # noqa: E402
```

to:

```python
from gd_dbr import DB, level_array_value, load_translations  # noqa: E402
```

Then append this code immediately after the `race_tag_of` function:

```python
# How a referenced skill record's resistance counts, keyed on its Class.
# Resident: the caster's own permanent resistance, folded into the headline total.
SELF_PASSIVE_CLASSES = {"Skill_Passive", "SkillBuff_Passive", "Skill_PassiveOnLifeBuffSelf"}
# Conditional: recorded separately so the judgment call stays data, not a guess.
AURA_CLASSES = {"Skill_BuffSelfDuration", "Skill_BuffSelfToggled", "Skill_BuffAttackRadiusToggled"}
# A summoned entity's own stats. Crediting these to the summoner would corrupt
# exactly the boss records this resolution exists to fix.
SUMMON_CLASSES = {"Monster", "Turret", "SpiritHost", "PetPlayerScaling"}

# Skill references that carried a resistance but contributed nothing, with the reason.
SKILL_EXCLUSIONS: list[dict] = []


def _skill_level(rec: dict, n: str) -> int:
    """The rank a monster pins for its skillName<n>, defaulting to 1.

    A monster pins each skill's rank in a skillLevel<n> sibling; that rank selects
    the entry from the skill's per-level arrays.
    """
    v = as_float((rec.get(f"skillLevel{n}") or "").split(";")[0])
    return int(v) if v and v >= 1 else 1


def skill_contributions(rel_path: str, rec: dict, get_skill) -> tuple[dict, dict]:
    """(resident, aura) sparse resistance contributions from a monster's own skills.

    `get_skill(ref)` returns the referenced record; it is injected so this stays a
    pure function, testable without a filesystem. Contributions are additive, both
    across skills and later on top of the inline value.
    """
    resident: dict[str, float] = {}
    aura: dict[str, float] = {}
    for key, ref in rec.items():
        m = re.fullmatch(r"skillName(\d+)", key)
        if not m or not ref:
            continue
        srec = get_skill(ref)
        if not srec:
            continue
        cls = (srec.get("Class") or "").strip()
        if cls in SELF_PASSIVE_CLASSES:
            bucket = resident
        elif cls in AURA_CLASSES:
            bucket = aura
        else:
            # Only report a skip that actually forfeits a resistance, so the summary
            # counts real losses rather than every unrelated skill a monster carries.
            if any(srec.get(f) for f in RESISTANCE_FIELDS.values()):
                reason = ("summoned entity" if cls in SUMMON_CLASSES
                          else f"unclassified skill class {cls or '(none)'}")
                SKILL_EXCLUSIONS.append(
                    {"record_path": f"records/creatures/{rel_path}", "skill": ref.strip(), "reason": reason})
            continue
        level = _skill_level(rec, m.group(1))
        for out_key, field in RESISTANCE_FIELDS.items():
            raw = srec.get(field)
            if not raw:
                continue
            v = level_array_value(raw, level)
            if v:
                bucket[out_key] = bucket.get(out_key, 0) + v
    return resident, aura


def _tidy(values: dict) -> dict:
    """Drop zero entries and normalise numbers, keeping the sparse objects sparse."""
    out = {}
    for k, v in values.items():
        if not v:
            continue
        out[k] = int(v) if float(v) == int(v) else round(v, 4)
    return out


def resolved_resistances(rel_path: str, rec: dict, get_skill) -> dict:
    """A record's combined resistances plus its sparse provenance objects.

    `resistances` is inline plus resident passives, which is what a player faces.
    Aura contributions are reported but deliberately not folded in.
    """
    resident, aura = skill_contributions(rel_path, rec, get_skill)
    total = resistances_of(rec)
    for k, v in resident.items():
        total[k] = total[k] + v
    return {"resistances": _tidy_total(total), "passive": _tidy(resident), "aura": _tidy(aura)}


def _tidy_total(total: dict) -> dict:
    """Normalise every combined value, keeping all ten keys present."""
    return {k: (int(v) if float(v) == int(v) else round(v, 4)) for k, v in total.items()}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run scripts/test_parse_monsters.py`
Expected: every check prints `ok`, final line `FAILURES: 0`, exit code 0.

- [ ] **Step 5: Confirm the dataset is untouched**

Run: `git status --porcelain data/monsters.json`
Expected: no output. This task adds the resolver but does not wire it in, so the committed dataset must not change.

- [ ] **Step 6: Commit**

```bash
git add scripts/parse_monsters.py scripts/test_parse_monsters.py
git commit -m "feat(monsters): resolve skill-granted resistance contributions"
```

---

### Task 2: Fold contributions into the dataset

Wires the resolver into collection and collapse, then regenerates the committed dataset.

**Files:**
- Modify: `scripts/parse_monsters.py` (`collapse_to_logical`, `collect_monsters`)
- Modify: `scripts/test_parse_monsters.py` (append before the final `print`)
- Modify: `data/monsters.json` (regenerated)

**Interfaces:**
- Consumes: `resolved_resistances` from Task 1.
- Produces: `collapse_to_logical(groups, tags, resolved)` gains a third parameter, a `{rel_path: resolved_resistances(...)}` map. Emitted rows gain optional `passive_resistances` and `aura_resistances` keys.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test_parse_monsters.py`, before the final `print`:

```python
# --- Task 2 (passives): collapse consumes the resolved map ---
def crec2(maxlv, **kw):
    base = {"Class": "Monster", "description": "tagOk", "monsterClassification": "Common",
            "maxLevel": str(maxlv), "minLevel": "1"}
    base.update(kw)
    return base

g_rec_a = crec2(90, defensiveFire="10")
g_rec_b = crec2(50, defensiveFire="10")
groups2 = {("Mon", "Common"): [("enemies/a.dbr", g_rec_a), ("enemies/b.dbr", g_rec_b)]}
resolved2 = {
    "enemies/a.dbr": {"resistances": {**mon.resistances_of(g_rec_a), "bleeding": 80},
                      "passive": {"bleeding": 80}, "aura": {"cold": 20}},
    "enemies/b.dbr": {"resistances": mon.resistances_of(g_rec_b), "passive": {}, "aura": {}},
}
rows2 = mon.collapse_to_logical(groups2, RACE_TAGS, resolved2)
check("collapse uses the resolved combined resistances", rows2[0]["resistances"]["bleeding"] == 80)
check("collapse emits sparse passive provenance", rows2[0]["passive_resistances"] == {"bleeding": 80})
check("collapse emits sparse aura provenance", rows2[0]["aura_resistances"] == {"cold": 20})
check("variants_disagree compares combined totals", rows2[0]["variants_disagree"] is True)

groups3 = {("Mon", "Common"): [("enemies/a.dbr", g_rec_a)]}
resolved3 = {"enemies/a.dbr": {"resistances": mon.resistances_of(g_rec_a), "passive": {}, "aura": {}}}
rows3 = mon.collapse_to_logical(groups3, RACE_TAGS, resolved3)
check("empty provenance keys are omitted entirely",
      "passive_resistances" not in rows3[0] and "aura_resistances" not in rows3[0])

# --- Task 2 (passives): the regenerated dataset ---
out3 = Path(tempfile.mkdtemp()) / "monsters3.json"
rc3 = subprocess.run([sys.executable, str(here / "parse_monsters.py"),
    "--records-dir", str(root / "extracted/records"),
    "--text-dir", str(root / "extracted/text_en"),
    "--out", str(out3), "--game-version", "test"]).returncode
check("parser still exits 0", rc3 == 0)
doc3 = json.loads(out3.read_text(encoding="utf-8"))
m3 = doc3["monsters"]
by_id = {m["id"]: m for m in m3}

check(f"row count unchanged (got {len(m3)})", len(m3) == 1637)
check("raw record count unchanged", sum(m["variant_count"] for m in m3) == 2728)
check("all ten resistance keys still present", all(list(m["resistances"].keys()) == TEN for m in m3))

alkamos = by_id.get("enemies.boss-quest.ghost_stepsoftorment_01")
check("alkamos bleeding resolves to 100", alkamos and alkamos["resistances"]["bleeding"] == 100)
check("alkamos records the passive provenance",
      alkamos and alkamos.get("passive_resistances", {}).get("bleeding") == 100)

kaisan = by_id.get("enemies.nemesis.nemesis_eldritch_01")
check("kaisan bleeding resolves to 45", kaisan and kaisan["resistances"]["bleeding"] == 45)
check("kaisan pierce resolves to 67", kaisan and kaisan["resistances"]["pierce"] == 67)
check("kaisan fire resolves to 46", kaisan and kaisan["resistances"]["fire"] == 46)

check("karroz is still present", "enemies.boss-quest.cultist_summoner_01" in by_id)
bleeders = [m for m in m3 if m["resistances"]["bleeding"]]
check(f"bleeding is no longer uniformly zero (got {len(bleeders)})", 300 <= len(bleeders) <= 900)
check("no zero-valued provenance entries",
      all(all(v for v in m.get("passive_resistances", {}).values()) for m in m3)
      and all(all(v for v in m.get("aura_resistances", {}).values()) for m in m3))
check("empty provenance objects are never emitted",
      all(m.get("passive_resistances") != {} and m.get("aura_resistances") != {} for m in m3))
check("at least one monster records an aura contribution",
      any(m.get("aura_resistances") for m in m3))
check("provenance keys are always real resistance names",
      all(set(m.get("passive_resistances", {})) <= set(TEN)
          and set(m.get("aura_resistances", {})) <= set(TEN) for m in m3))
# That aura is excluded from the headline total is proven by the Task 1 unit test
# ("aura is NOT folded into the total"), which controls both inputs; from the
# generated file alone the un-aura'd value is not recoverable, so no check here
# can verify it without recomputing the parser's own arithmetic.

# determinism still holds
out4 = Path(tempfile.mkdtemp()) / "monsters4.json"
subprocess.run([sys.executable, str(here / "parse_monsters.py"),
    "--records-dir", str(root / "extracted/records"),
    "--text-dir", str(root / "extracted/text_en"),
    "--out", str(out4), "--game-version", "test"], check=True)
check("still deterministic across runs",
      json.loads(out4.read_text(encoding="utf-8"))["monsters"] == m3)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run scripts/test_parse_monsters.py`
Expected: FAIL on "collapse uses the resolved combined resistances" with a `TypeError`, because `collapse_to_logical` currently takes two arguments.

- [ ] **Step 3: Write the implementation**

In `scripts/parse_monsters.py`, replace the whole `collapse_to_logical` function with:

```python
def collapse_to_logical(groups: dict, tags: dict, resolved: dict) -> list[dict]:
    """{(name, classification): [(rel_path, rec)]} -> one dict per logical monster.

    Variant records (tier _[abc]NN, _summon, _pN phases) collapse onto the
    highest-level representative. `resolved` maps each member's path to its
    combined resistances and provenance, computed before this collapse so the
    representative's total already includes its skill-granted resistance.
    Groups whose members disagree on the combined total are flagged rather than
    silently resolved, so the page can mark them.
    """
    out = []
    for (_name, classification), members in groups.items():
        ordered = sorted(members, key=_representative_rank)
        rel_path, rec = ordered[0]
        res = resolved[rel_path]
        resistances = res["resistances"]
        entry = {
            "id": monster_id(rel_path),
            "name_tag": rec["description"],
            "classification": classification,
            "role": role_of(rel_path),
            "race_tag": race_tag_of(rec, tags),
            "min_level": int(as_float(rec.get("minLevel")) or 0),
            "max_level": int(as_float(rec.get("maxLevel")) or 0),
            "is_summon": rel_path.endswith("_summon.dbr"),
            "resistances": resistances,
            "passive_resistances": res["passive"],
            "aura_resistances": res["aura"],
            "variant_count": len(ordered),
            "variants_disagree": any(resolved[p]["resistances"] != resistances for p, _ in ordered[1:]),
            "record_paths": [f"records/creatures/{p}" for p, _ in ordered],
        }
        # Sparse by contract: omit the provenance keys entirely when nothing was granted,
        # so the ~80% of monsters with no skill grants gain no bulk.
        if not entry["passive_resistances"]:
            del entry["passive_resistances"]
        if not entry["aura_resistances"]:
            del entry["aura_resistances"]
        out.append(entry)
    out.sort(key=lambda m: m["id"])
    return out
```

Then replace the whole `collect_monsters` function with:

```python
def collect_monsters(db: DB, tags: dict) -> list[dict]:
    """Sweep creatures/, drop what is not surveyable, and collapse to the logical grain.

    Skill-granted resistance resolves per raw record here, before the collapse, so a
    variant carrying a different skill loadout is compared on its true total.
    """
    groups: dict = {}
    resolved: dict = {}
    for rel_path, rec in iter_creature_records(db):
        reason = exclusion_reason(rel_path, rec, tags)
        if reason:
            EXCLUSIONS.append({"record_path": f"records/creatures/{rel_path}", "reason": reason})
            continue
        resolved[rel_path] = resolved_resistances(rel_path, rec, db.get)
        key = (tags[rec["description"]], rec["monsterClassification"])
        groups.setdefault(key, []).append((rel_path, rec))
    return collapse_to_logical(groups, tags, resolved)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run scripts/test_parse_monsters.py`
Expected: every check prints `ok`, final line `FAILURES: 0`, exit code 0.

If the row count or raw record count assertions fail, STOP and report rather than adjusting them: those numbers must not move, and a change means the resolution altered grouping, which it must not.

- [ ] **Step 5: Regenerate the committed dataset**

Run: `just parse-monsters`

Expected: the summary still reports 2,728 kept records and 1,637 logical monsters.

Then confirm the change is confined to resistance data:

```bash
git diff --stat data/monsters.json
jq '[.monsters[]|select(.resistances.bleeding > 0)]|length' data/monsters.json
jq '.monsters[]|select(.id=="enemies.nemesis.nemesis_eldritch_01")|{resistances,passive_resistances}' data/monsters.json
```

Expected: bleeding is nonzero for several hundred monsters, and Kaisan shows bleeding 45 with `passive_resistances` naming its contributions.

- [ ] **Step 6: Commit**

```bash
git add scripts/parse_monsters.py scripts/test_parse_monsters.py data/monsters.json
git commit -m "feat(monsters): fold skill-granted resistance into the dataset"
```

---

### Task 3: Observability and superseded documentation

Surfaces what the resolution did and what it skipped, and strikes the v1 limitation this work resolves.

**Files:**
- Modify: `scripts/parse_monsters.py` (`print_summary`)
- Modify: `scripts/test_parse_monsters.py` (append before the final `print`)
- Modify: `docs/superpowers/specs/2026-07-24-monster-resistance-pipeline-design.md`

**Interfaces:**
- Consumes: `SKILL_EXCLUSIONS` from Task 1; the emitted rows from Task 2.
- Produces: no new callable interface; `print_summary` gains lines and the v1 spec loses a superseded bullet.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test_parse_monsters.py`, before the final `print`:

```python
# --- Task 3 (passives): the summary reports grants and skips ---
probe = subprocess.run([sys.executable, str(here / "parse_monsters.py"),
    "--records-dir", str(root / "extracted/records"),
    "--text-dir", str(root / "extracted/text_en"),
    "--out", str(Path(tempfile.mkdtemp()) / "probe.json"), "--game-version", "test"],
    capture_output=True, text=True)
summary = probe.stderr
check("summary reports monsters with a passive grant", "with a skill resistance grant:" in summary)
check("summary reports monsters with an aura grant", "with an aura grant:" in summary)
check("summary reports skipped skill references", "skill grants not counted:" in summary)
check("summary names the summoned-entity reason", "summoned entity" in summary)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run scripts/test_parse_monsters.py`
Expected: FAIL on "summary reports monsters with a passive grant", because `print_summary` does not emit that line yet.

- [ ] **Step 3: Write the implementation**

In `scripts/parse_monsters.py`, in `print_summary`, insert these lines immediately after the existing `p(f"  no race tag: ...")` line:

```python
    p(f"  with a skill resistance grant: {sum(1 for m in monsters if m.get('passive_resistances'))}")
    p(f"  with an aura grant (recorded, not counted): {sum(1 for m in monsters if m.get('aura_resistances'))}")
    p(f"  skill grants not counted: {len(SKILL_EXCLUSIONS)}")
    for reason, n in sorted(Counter(e["reason"] for e in SKILL_EXCLUSIONS).items()):
        p(f"    - {reason}: {n}")
```

`Counter` is already imported at the top of `print_summary` as `from collections import Counter`; confirm that import is present before the new lines use it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run scripts/test_parse_monsters.py`
Expected: every check prints `ok`, final line `FAILURES: 0`, exit code 0.

- [ ] **Step 5: Strike the superseded v1 limitation**

In `docs/superpowers/specs/2026-07-24-monster-resistance-pipeline-design.md`, the "Known limitations" section opens with a bullet beginning **"Passive resistance grants are not modelled."** That is now false. Replace that whole bullet with:

```markdown
- **Passive resistance grants are modelled as of 2026-07-25.** A monster's own
  skills contribute to its resistance, resolved at the rank the monster pins. See
  [2026-07-25-monster-passive-resistances-design.md](2026-07-25-monster-passive-resistances-design.md).
  Aura and duration buffs are recorded in `aura_resistances` but deliberately not
  folded into the headline total.
```

Do not otherwise edit that spec: it is a dated historical artifact.

- [ ] **Step 6: Run the full gates**

Run: `just test-scripts`
Expected: all six suites pass.

Run: `just diff-data`
Expected: the monsters section reports the resistance changes this work introduced (several hundred monsters changed, 0 added, 0 removed) and `DIFFICULTY OFFSETS: 0 changed`. A nonzero added or removed count means grouping changed and must be reported, not accepted.

Run: `just check`
Expected: formatting, the web suite, lint, and typecheck all pass. No web sources changed, so this is a regression guard.

- [ ] **Step 7: Commit**

```bash
git add scripts/parse_monsters.py scripts/test_parse_monsters.py \
  docs/superpowers/specs/2026-07-24-monster-resistance-pipeline-design.md
git commit -m "feat(monsters): report skill grants and skips in the parser summary"
```

---

## Done criteria

- `data/monsters.json` reports combined inline plus resident passive resistance, with `passive_resistances` and `aura_resistances` provenance.
- Alkamos reads 100 bleeding, Kaisan 45; bleeding is no longer uniformly zero.
- Row count stays 1,637 and raw record count stays 2,728: no monster gained or lost.
- The parser summary reports grants applied and grants skipped, by reason.
- `just test-scripts` and `just check` both pass; `just diff-data` shows only resistance changes.

## Not in this plan

- The explorer page. It is unblocked by this work but is a separate sub-project with its own brainstorm and spec.
- Difficulty offsets remain page-applied; nothing about the offset table changes.
- Health, offensive ability, defensive ability, and attacks remain deferred phases.
- Following skill references more than one level deep.
