# Monster Resistance grimtools Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Monster Resistances page show the numbers grimtools shows, and link every monster to its grimtools entry for the selected difficulty.

**Architecture:** Three changes to `scripts/parse_monsters.py`: evaluate `skillLevel` equations at monster level 100, count only the skill classes grimtools counts as permanent, and split merged groups whose records disagree. A new bun script maps each row to grimtools ids per difficulty from grimtools' public `monsterdb.js` into a committed `data/grimtools-monsters.json`, which the page reads to link names. A committed fixture of grimtools' own rendered numbers gates parity.

**Tech Stack:** Python 3 stdlib scripts run with `uv`, TypeScript on bun (web app and `scripts/*.ts`), `just`.

**Spec:** The design was settled in conversation on 2026-09-27; the decisions are recorded in the "Decisions" section below, and the evidence is the audit summarized in "Background".

## Background

Ravager of Flesh on Ultimate: grimtools shows vitality 123, we show 98. Monster records set `skillLevel<n>` to equations such as `charLevel*1`, `charLevel/4+1`, `(charLevel/26)+3`. `_skill_level` in `scripts/parse_monsters.py` parses with `float()`, fails, and falls back to rank 1. Ravager's vitality passive is `defensiveLife` 1..60 at `charLevel/4+1`, rank 26 at level 100: 85 inline + 26 + 12 (Ultimate offset) = 123.

An audit of all 62 grimtools Boss, SuperBoss, nemesis and Death Revenant entries (1,830 cells, grimtools 1.3.0.8) found 260 differing cells: 252 from the equation bug (every level-scaled passive exactly 25 low, including bleeding on Nyarlathon, Vinn Ozmald and Reaper of Rot) and 8 from Death Revenant, whose merged records differ on pierce (grimtools m339/m444 have 33, m249 and our row have 0). grimtools' difficulty offsets equal ours. grimtools evaluates every monster at one site-wide level, default 100, floors skill-level equations, and counts only `Skill_Passive`, `Skill_PassiveDualWieldWeapon`, `Skill_Mastery` as permanent. grimtools keeps one entry per difficulty variant (Ravager of Flesh: m363 Normal/Elite, m364 Ultimate, m3843 Ascendant); `monsterDifficulty[id]` lists difficulty indexes 1..4 (1 Normal, 2 Elite, 3 Ultimate, 4 Ascendant; absent means all four).

## Where this runs

Execute on Ted's Windows PC, which has the game installed and `extracted/` (run `just extract` with the game closed if it is missing or the game patched; a new Steam buildid goes in `data/steam-build-versions.json` first). Every task that changes the parser regenerates `data/monsters.json` with `just parse-monsters` and runs `just monster-parity` against the real data, so progress is measured on the actual 1,635 monsters rather than only on fixtures.

Already done on the branch (from the Mac session that ran the audit): this plan, `scripts/gt_monster_harvest.mjs`, and its output `scripts/fixtures/gt-monster-resistances.json` (62 grimtools entries, 1,830 cells, grimtools 1.3.0.8, cross-checked cell for cell against the audit's validated harvest). Do not regenerate the fixture unless grimtools shows a newer game version; the harvest script depends on grimtools' minified internals and is the most fragile step.

## Decisions

1. Level-scaled skills evaluate at monster level 100, floored, matching grimtools' default. The page footnote states it.
2. One row per logical monster; difficulty variants that agree stay merged. The grimtools link follows the selected difficulty.
3. Resident (headline) classes are exactly `Skill_Passive`, `Skill_PassiveDualWieldWeapon`, `Skill_Mastery`. `SkillBuff_Passive` and `Skill_PassiveOnLifeBuffSelf` move to the aura bucket.
4. A merged group whose records disagree on combined resistances splits into subgroups of agreeing records, across the whole dataset. `variants_disagree` goes away (it can no longer be true), with its marker, legend entry and catalog keys.
5. Split rows are told apart by the Role column; when name, classification and role all collide, rows get a "(variant N)" suffix with the record path as a tooltip.
6. grimtools mapping: candidates share name tag + classification + difficulty; prefer the one whose inline resistances equal the row's; then lowest id. Unmatched rows show plain text.
7. A committed fixture of grimtools' own rendered numbers pins parity; `docs/monster-resistances.md` is the evergreen reference.

## Global Constraints

- Every code file starts with two `ABOUTME: ` comment lines.
- No user-facing string literal in app code: add a key to `web/src/i18n/app.en.json` and to the list in `web/test/appCatalog.test.ts`; resolve with `loc.translate(key, params?)`.
- Use `just` recipes (`just test`, `just check`, `just lint-py`) in preference to raw commands where one exists.
- Docs: no emojis, no emdashes, no hyperbole. Top-level `docs/` files are evergreen.
- Comments are evergreen: no "now", "new", history, or ticket ids.
- The web page must keep working against an older `data/monsters.json` (one carrying `variants_disagree` and no `variant_index`), since a deploy can pair new code with old data.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never `--no-verify`.
- Work on branch `monster-grimtools-parity` (already pushed; `git fetch && git checkout monster-grimtools-parity`).

## Review Focus

1. A skillLevel expression the evaluator cannot parse (unknown identifier, `**`, garbage): must fall back to rank 1 and be counted in the summary, never raise or evaluate arbitrary code.
2. A fractional equation result such as `(charLevel/26)+3` = 6.85: must floor to 6, matching grimtools, not round to 7.
3. A buff host whose child is `SkillBuff_Passive`: the child grant must still be found (the hop must not break when `SkillBuff_Passive` leaves the resident set) and land in the aura bucket.
4. The page loaded with the old `data/monsters.json` (no `variant_index`, has `variants_disagree`) and with no `data/grimtools-monsters.json` fetchable: must render every row, unlinked, without throwing.
5. Two split rows with the same name, classification and role: each gets a distinct suffix, and a row with no collision gets none.

Each is pinned by a test in the owning task (Tasks 2, 2, 2, 4 and 6, and 3 respectively).

---

### Task 1: Parity check, and pure parser tests that run without the game

Two pieces of test scaffolding the later tasks measure against. The parity check compares `data/monsters.json` with the committed grimtools fixture. Separately, `scripts/test_parse_monsters.py` exits at its `if not (root / "extracted/records").is_dir():` gate (around line 202) before its pure sections ("Task 1 (passives): skill level pinning", "contribution bucketing by skill Class", "combining with inline values", "Task 2 (passives): collapse consumes the resolved map", "Task 1 (explorer): traps are excluded") run, so on a machine without the game they never run. Moving them above the gate keeps them useful everywhere.

**Files:**
- Create: `scripts/test_monster_parity.py`
- Modify: `scripts/test_parse_monsters.py`, `justfile` (recipe `monster-parity`)

**Interfaces:**
- Consumes: `scripts/fixtures/gt-monster-resistances.json` (committed): `{"source", "game_version", "monster_level": 100, "players": 1, "entries": [{"gt_id": 364, "name_tag": "tagGDX1Boss_Wendigo03", "classification": "SuperBoss", "resistances": {"ultimate": {"physical": 87, ..., "vitality": 123, "bleeding": 94}}}]}`, our ten key names, only the difficulties the entry exists in.
- Produces: `just monster-parity` (exit 0 when every fixture entry has a row showing exactly grimtools' numbers at every difficulty).

- [ ] **Step 1: Write the parity check**

`scripts/test_monster_parity.py`:

```python
#!/usr/bin/env -S uv run --script
# ABOUTME: Checks data/monsters.json against grimtools' displayed boss and nemesis resistances.
# ABOUTME: Run: uv run scripts/test_monster_parity.py  (fixture: scripts/fixtures/gt-monster-resistances.json)
# /// script
# requires-python = ">=3.10"
# ///
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
doc = json.loads((root / "data/monsters.json").read_text(encoding="utf-8"))
fixture = json.loads((root / "scripts/fixtures/gt-monster-resistances.json").read_text(encoding="utf-8"))
offsets = doc["difficulty_offsets"]

rows_by_key: dict = {}
for m in doc["monsters"]:
    rows_by_key.setdefault((m["name_tag"], m["classification"]), []).append(m)


def displayed(m: dict, difficulty: str) -> dict:
    """What the page shows at 1 player: base plus the difficulty's flat offset."""
    off = offsets[difficulty]["1"]
    return {k: m["resistances"][k] + off.get(k, 0) for k in m["resistances"]}


failures = 0
for e in fixture["entries"]:
    rows = rows_by_key.get((e["name_tag"], e["classification"]), [])
    if not rows:
        failures += 1
        print(f"  FAIL m{e['gt_id']} {e['name_tag']} ({e['classification']}): no row")
        continue
    for difficulty, want in e["resistances"].items():
        if any(displayed(m, difficulty) == want for m in rows):
            continue
        failures += 1
        closest = min(rows, key=lambda m: sum(abs(displayed(m, difficulty)[k] - want[k]) for k in want))
        diff = {k: (displayed(closest, difficulty)[k], want[k]) for k in want
                if displayed(closest, difficulty)[k] != want[k]}
        print(f"  FAIL m{e['gt_id']} {e['name_tag']} {difficulty}: ours vs grimtools {diff} ({closest['id']})")

print(f"entries: {len(fixture['entries'])}  FAILURES: {failures}")
raise SystemExit(1 if failures else 0)
```

- [ ] **Step 2: Add the just recipe**

In `justfile` after `parse-monsters`:

```
# Check data/monsters.json against grimtools' displayed boss and nemesis resistances
# (fixture: scripts/fixtures/gt-monster-resistances.json; refresh with bun scripts/gt_monster_harvest.mjs).
monster-parity:
    uv run "{{justfile_directory()}}/scripts/test_monster_parity.py"
```

- [ ] **Step 3: Establish the baseline**

Run: `just parse-monsters` (regenerates from the unchanged parser, so the baseline reflects the current game data), then `just monster-parity`.
Expected: FAIL, and every failure line shows only differences of exactly 25 in level-scaled types (for example Ravager of Flesh vitality 98 vs 123), or Death Revenant pierce (0 vs 33). Any other difference means the fixture, the check, or a game patch is involved: stop and report to Ted. Keep the failure count; later tasks drive it to zero. If `just parse-monsters` changed `data/monsters.json` (a game patch since the last regeneration), do not commit that yet; note it for the report.

- [ ] **Step 4: Move the pure sections above the gate**

Cut these blocks, in order, and paste them immediately before the comment `# Everything from here on reads the extracted game tree`:
- from `# --- Task 1 (passives): skill level pinning ---` through the end of the `# --- Task 2 (passives): collapse consumes the resolved map ---` block (ends just before `# --- Task 2 (passives): the regenerated dataset ---`);
- the `# --- Task 1 (explorer): traps are excluded ...` block (ends just before the final `print("FAILURES:", failures)`).

Do not change any line's content. `TEN`, `TAGS`, `rec` and `RACE_TAGS` are defined before the gate already.

- [ ] **Step 5: Run the parser suite**

Run: `uv run scripts/test_parse_monsters.py`
Expected: `FAILURES: 0` (with `extracted/` present, the real-records legs run too and pass against the unchanged parser).

- [ ] **Step 6: Commit**

```bash
git add scripts/test_monster_parity.py scripts/test_parse_monsters.py justfile
git commit -m "test(monsters): grimtools parity check; pure parser checks run without the game"
```

---

### Task 2: Evaluate skillLevel equations at monster level 100; match grimtools' resident classes

**Files:**
- Modify: `scripts/parse_monsters.py` (`_skill_level`, class sets, `_buff_hop_grant`, `print_summary`)
- Test: `scripts/test_parse_monsters.py` (pure section, above the gate)

**Interfaces:**
- Produces: `MONSTER_LEVEL = 100`; `eval_level_expr(expr: str, char_level: int) -> float | None`; `_skill_level(rec, n) -> int` (floored, at least 1); `UNPARSED_SKILL_LEVELS: list[dict]` (`{"record_path", "expr"}`); `SELF_PASSIVE_CLASSES = {"Skill_Passive", "Skill_PassiveDualWieldWeapon", "Skill_Mastery"}`; `BUFF_CHILD_CLASSES = {"Skill_Passive", "SkillBuff_Passive", "Skill_PassiveOnLifeBuffSelf"}`.

- [ ] **Step 1: Write the failing tests**

In the moved "skill level pinning" section, replace the `unparseable skill level defaults to 1` check's neighbours with this block (keep the existing four checks):

```python
check("level expr: charLevel/4+1 at 100 is 26", mon.eval_level_expr("charLevel/4+1", 100) == 26)
check("level expr: parenthesised form", mon.eval_level_expr("(charLevel/4)+1", 100) == 26)
check("level expr: charLevel*1 is the level", mon.eval_level_expr("charLevel*1", 100) == 100)
check("level expr: plain number", mon.eval_level_expr("6", 100) == 6)
check("level expr: power is refused", mon.eval_level_expr("charLevel**2", 100) is None)
check("level expr: unknown name is refused", mon.eval_level_expr("__import__('os')", 100) is None)
check("level expr: garbage is refused", mon.eval_level_expr("charLevel/", 100) is None)
check("skill level evaluates an equation at MONSTER_LEVEL",
      mon._skill_level({"skillLevel5": "charLevel/4+1"}, "5") == 26)
check("skill level floors a fractional equation",
      mon._skill_level({"skillLevel1": "(charLevel/26)+3"}, "1") == 6)
before_unparsed = len(mon.UNPARSED_SKILL_LEVELS)
mon._skill_level({"skillLevel2": "charLevel**2"}, "2")
check("an unparseable equation is recorded", len(mon.UNPARSED_SKILL_LEVELS) == before_unparsed + 1)
```

The existing `unparseable skill level defaults to 1` check (`"abc"`) stays and must still pass.

In the `SKILLS` fixture dict add:

```python
    "records/skills/np/scaled.dbr": {"Class": "Skill_Passive",
                                     "defensiveLife": ";".join(f"{i}.000000" for i in range(1, 61))},
    "records/skills/np/dualwield.dbr": {"Class": "Skill_PassiveDualWieldWeapon", "defensivePierce": "12.000000"},
    "records/skills/np/mastery.dbr": {"Class": "Skill_Mastery", "defensiveAether": "4.000000"},
    "records/skills/np/firepassive.dbr": {"Class": "Skill_Passive", "defensiveFire": "10.000000"},
    "records/skills/np/buffhost.dbr": {"Class": "Skill_AttackBuffRadius", "buffSkillName": "records/skills/np/shieldbuff.dbr"},
```

Change these existing checks (the design moves both classes to the aura bucket):

```python
p, a = contrib([("records/skills/np/buffpassive.dbr", 1)])
check("SkillBuff_Passive is conditional, not resident", p == {} and a == {"fire": 10})
p, a = contrib([("records/skills/np/onlife.dbr", 1)])
check("Skill_PassiveOnLifeBuffSelf is conditional, not resident", p == {} and a == {"chaos": 7})
```

Add:

```python
p, a = contrib([("records/skills/np/dualwield.dbr", 1)])
check("Skill_PassiveDualWieldWeapon is resident", p == {"pierce": 12} and a == {})
p, a = contrib([("records/skills/np/mastery.dbr", 1)])
check("Skill_Mastery is resident", p == {"aether": 4} and a == {})
p, a = contrib([("records/skills/np/scaled.dbr", "charLevel/4+1")])
check("a level-scaled passive is read at the evaluated rank", p == {"vitality": 26})
p, a = contrib([("records/skills/np/buffhost.dbr", 1)])
check("a buff host still reaches a SkillBuff_Passive child, as an aura", p == {} and a == {"fire": 33, "cold": 33})

# Ravager of Flesh (grimtools m364): 85 inline + 26 from its passive; Ultimate adds 12 -> 123.
ravager = {"defensiveLife": "85.000000", "skillName5": "records/skills/np/scaled.dbr",
           "skillLevel5": "charLevel/4+1"}
check("ravager-shaped record resolves vitality 111 before the difficulty offset",
      mon.resolved_resistances("enemies/x.dbr", ravager, get_skill)["resistances"]["vitality"] == 111)
```

In the "combining with inline values" section, `rec_inline` uses `buffpassive.dbr`; switch it to `firepassive.dbr` so it still tests a resident grant stacking on inline:

```python
rec_inline = {"defensiveFire": "10.000000", "skillName1": "records/skills/np/firepassive.dbr", "skillLevel1": "1"}
```

Update the skipped-skills count check if it changes: the `weird.dbr` (AttributePak), `minion.dbr`, `turret.dbr` skips are unchanged, so `len(mon.SKILL_EXCLUSIONS) - before == 3` should still hold. If a new fixture lands between `before` and that check, keep the new `contrib` calls after it.

- [ ] **Step 2: Run to verify they fail**

Run: `uv run scripts/test_parse_monsters.py`
Expected: FAIL lines for the level-expr checks (`AttributeError: eval_level_expr` aborts the run) — confirm the failure is the missing function.

- [ ] **Step 3: Implement**

In `scripts/parse_monsters.py`, add `import ast` and `import math` to the imports. Replace the class-set block and `_skill_level`:

```python
# How a referenced skill record's resistance counts, keyed on its Class.
# Resident: permanent, folded into the headline total. Exactly the classes grimtools
# treats as always-on, so the page matches the site players check it against.
SELF_PASSIVE_CLASSES = {"Skill_Passive", "Skill_PassiveDualWieldWeapon", "Skill_Mastery"}
# Conditional: recorded separately so the judgment call stays data, not a guess.
# SkillBuff_Passive and Skill_PassiveOnLifeBuffSelf are buffs grimtools shows only
# behind its buff toggles, so they are conditional here too.
AURA_CLASSES = {
    "Skill_BuffSelfDuration", "Skill_BuffSelfToggled", "Skill_BuffAttackRadiusToggled",
    "SkillBuff_Passive", "Skill_PassiveOnLifeBuffSelf",
}
# The child classes a buff host can deliver to its bearer through buffSkillName.
BUFF_CHILD_CLASSES = {"Skill_Passive", "SkillBuff_Passive", "Skill_PassiveOnLifeBuffSelf"}
```

```python
# The monster level every level-scaled skill is evaluated at: grimtools' default, so
# the page matches the numbers players compare it with. Records express a skill's
# rank as an equation of the monster's level (for example "charLevel/4+1").
MONSTER_LEVEL = 100

_LEVEL_OPS = {ast.Add: lambda a, b: a + b, ast.Sub: lambda a, b: a - b,
              ast.Mult: lambda a, b: a * b, ast.Div: lambda a, b: a / b}

# skillLevel equations the evaluator refused, reported by print_summary.
UNPARSED_SKILL_LEVELS: list[dict] = []


def eval_level_expr(expr: str, char_level: int) -> float | None:
    """Evaluate a skillLevel value: numbers, `charLevel`, + - * / and parentheses only.

    Walks the parsed tree against that whitelist rather than calling eval, so a
    record can never execute code. Anything else returns None.
    """
    def ev(node):
        if isinstance(node, ast.Expression):
            return ev(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return float(node.value)
        if isinstance(node, ast.Name) and node.id == "charLevel":
            return float(char_level)
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
            return -ev(node.operand)
        if isinstance(node, ast.BinOp) and type(node.op) in _LEVEL_OPS:
            return _LEVEL_OPS[type(node.op)](ev(node.left), ev(node.right))
        raise ValueError(node)
    try:
        return ev(ast.parse(expr.strip(), mode="eval"))
    except (SyntaxError, ValueError, ZeroDivisionError):
        return None


def _skill_level(rec: dict, n: str, rel_path: str = "") -> int:
    """The rank a monster gives its skillName<n>, defaulting to 1.

    skillLevel<n> is a number or an equation of the monster's level, evaluated at
    MONSTER_LEVEL and floored as the game does. The rank selects the entry from the
    skill's per-level arrays.
    """
    raw = (rec.get(f"skillLevel{n}") or "").split(";")[0].strip()
    if not raw:
        return 1
    v = eval_level_expr(raw, MONSTER_LEVEL)
    if v is None:
        UNPARSED_SKILL_LEVELS.append({"record_path": f"records/creatures/{rel_path}", "expr": raw})
        return 1
    return max(1, math.floor(v))
```

In `skill_contributions`, pass the path: `level = _skill_level(rec, m.group(1), rel_path)`.

In `_buff_hop_grant`, change the child check to `BUFF_CHILD_CLASSES`:

```python
    if not child or (child.get("Class") or "").strip() not in BUFF_CHILD_CLASSES:
        return {}
```

and its docstring sentence "Only a `SkillBuff_Passive` child counts, because that buffs the bearer." becomes "Only a child in BUFF_CHILD_CLASSES counts, because those buff the bearer."

In `print_summary`, after the `skill grants not counted` lines, add:

```python
    p(f"  skill levels evaluated at monster level {MONSTER_LEVEL}")
    if UNPARSED_SKILL_LEVELS:
        p(f"  WARNING: skillLevel equations not understood, read as rank 1: {len(UNPARSED_SKILL_LEVELS)}")
        for expr, n in Counter(e["expr"] for e in UNPARSED_SKILL_LEVELS).most_common(10):
            p(f"    - {expr!r}: {n}")
```

Note `"abc"` is recorded as unparsed too; that is intended.

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run scripts/test_parse_monsters.py`
Expected: every pure check `ok`. The real-records legs will now fail where this change intentionally moves values; the next step handles those.

Run: `just lint-py`
Expected: clean.

- [ ] **Step 5: Regenerate and measure against grimtools**

Run: `just parse-monsters`, then `just monster-parity`.
Expected: the parser summary reports `skill levels evaluated at monster level 100` and ideally no `skillLevel equations not understood` warning (if one appears, list the expressions for Ted rather than extending the evaluator unasked). Parity failures drop to Death Revenant pierce only (0 vs 33, grimtools m339/m444), which Task 3 fixes. Any other remaining failure: stop and investigate.

Then re-pin the real-records checks in `scripts/test_parse_monsters.py` that this change intentionally moves, each with a one-line comment naming the grimtools source:
- Kaisan pierce 67 -> 92 and fire 46 -> 71 (grimtools m1839; level-scaled passives at rank 26).
- The aura-count band (100-200) may rise because `SkillBuff_Passive` and `Skill_PassiveOnLifeBuffSelf` moved to auras; re-pin to the observed count after checking a few of the rows that moved.
Anything else failing there is unexpected: investigate before re-pinning.

Run: `uv run scripts/test_parse_monsters.py`
Expected: `FAILURES: 0`.

- [ ] **Step 6: Commit**

```bash
git add scripts/parse_monsters.py scripts/test_parse_monsters.py data/monsters.json
git commit -m "fix(monsters): evaluate skillLevel equations at level 100; count grimtools' resident classes"
```

---

### Task 3: Split merged groups whose records disagree

**Files:**
- Modify: `scripts/parse_monsters.py` (`collapse_to_logical`, `print_summary`)
- Test: `scripts/test_parse_monsters.py` (pure "collapse to the logical grain" and "collapse consumes the resolved map" sections, above the gate)

**Interfaces:**
- Consumes: the `resolved` map (`{rel_path: {"resistances", "passive", "aura"}}`).
- Produces: rows without `variants_disagree`; optional `variant_index: int` (1-based) present only when two or more rows share display name, classification and role; `SPLIT_GROUPS: list[str]` (display names of groups that split).

- [ ] **Step 1: Write the failing tests**

In the "collapse to the logical grain" section, replace `check("agreeing variants are not flagged", bloater["variants_disagree"] is False)` with:

```python
check("rows no longer carry variants_disagree", "variants_disagree" not in bloater)
check("an unsplit row carries no variant_index", "variant_index" not in bloater)
```

Add after that section's last check:

```python
# A group whose records disagree splits into subgroups of agreeing records.
split_groups = {
    ("Death Revenant", "Hero"): [
        ("enemies/boss&quest/rev_02.dbr", crec(250, defensiveCold="50")),
        ("enemies/waveevent/rev_wave.dbr", crec(250, defensiveCold="50", defensivePierce="33")),
        ("enemies/bounties/rev_bounty.dbr", crec(250, defensiveCold="50", defensivePierce="33")),
    ],
}
split = mon.collapse_to_logical(split_groups, RACE_TAGS, resolved_of(split_groups))
check("a disagreeing group becomes one row per agreeing subgroup", len(split) == 2)
pierce = sorted(m["resistances"]["pierce"] for m in split)
check("each split row keeps its own values", pierce == [0, 33])
check("agreeing records stay merged inside a subgroup",
      sorted(m["variant_count"] for m in split) == [1, 2])
check("split rows have distinct ids", len({m["id"] for m in split}) == 2)
check("split rows with different roles need no suffix", all("variant_index" not in m for m in split))

same_role = {
    ("Twin", "Hero"): [
        ("enemies/hero/twin_a.dbr", crec(90, defensiveFire="10")),
        ("enemies/hero/twin_b.dbr", crec(50, defensiveFire="20")),
    ],
}
twins = mon.collapse_to_logical(same_role, RACE_TAGS, resolved_of(same_role))
idx = {m["id"]: m.get("variant_index") for m in twins}
check("same name, classification and role get variant 1 and 2 by representative rank",
      idx == {"enemies.hero.twin_a": 1, "enemies.hero.twin_b": 2})
```

In the "collapse consumes the resolved map" section, `rows2` has two records that disagree (a has bleeding 80, b has none). Replace:

```python
check("variants_disagree compares combined totals", rows2[0]["variants_disagree"] is True)
```

with:

```python
check("records that disagree only through a passive still split", len(rows2) == 2)
```

and make the three checks above it select the representative row explicitly: `r2a = [m for m in rows2 if m["id"] == "enemies.a"][0]`, then use `r2a` in place of `rows2[0]`.

- [ ] **Step 2: Run to verify they fail**

Run: `uv run scripts/test_parse_monsters.py`
Expected: FAIL on the split checks (one row returned).

- [ ] **Step 3: Implement**

Add `SPLIT_GROUPS: list[str] = []` next to `EXCLUSIONS`. Replace `collapse_to_logical` with:

```python
def _row(members, classification, tags, resolved) -> dict:
    """One output row from records that agree, the highest-ranked as representative."""
    ordered = sorted(members, key=_representative_rank)
    rel_path, rec = ordered[0]
    res = resolved[rel_path]
    entry = {
        "id": monster_id(rel_path),
        "name_tag": rec["description"],
        "classification": classification,
        "role": role_of(rel_path),
        "race_tag": race_tag_of(rec, tags),
        "min_level": int(as_float(rec.get("minLevel")) or 0),
        "max_level": int(as_float(rec.get("maxLevel")) or 0),
        "is_summon": rel_path.endswith("_summon.dbr"),
        "resistances": res["resistances"],
        "passive_resistances": res["passive"],
        "aura_resistances": res["aura"],
        "variant_count": len(ordered),
        "record_paths": [f"records/creatures/{p}" for p, _ in ordered],
    }
    # Sparse by contract: omit the provenance keys entirely when nothing was granted,
    # so the ~80% of monsters with no skill grants gain no bulk.
    if not entry["passive_resistances"]:
        del entry["passive_resistances"]
    if not entry["aura_resistances"]:
        del entry["aura_resistances"]
    return entry


def collapse_to_logical(groups: dict, tags: dict, resolved: dict) -> list[dict]:
    """{(name, classification): [(rel_path, rec)]} -> rows of records that agree.

    Variant records (tier _[abc]NN, _summon, _pN phases) collapse onto the
    highest-level representative while their combined resistances agree. A group
    whose records disagree splits into one row per agreeing subgroup, so every row
    states values that are true of every record behind it. Rows that end up sharing
    name, classification and role get a 1-based variant_index to tell them apart.
    """
    out = []
    for (name, classification), members in groups.items():
        subgroups: dict = {}
        for rel_path, rec in members:
            key = tuple(sorted(resolved[rel_path]["resistances"].items()))
            subgroups.setdefault(key, []).append((rel_path, rec))
        if len(subgroups) > 1:
            SPLIT_GROUPS.append(name)
        rows = [_row(sub, classification, tags, resolved) for sub in subgroups.values()]
        # Representative rank of each row's first record, so variant numbering is stable.
        rows.sort(key=lambda r: _representative_rank(
            (r["record_paths"][0][len("records/creatures/"):], next(
                rec for p, rec in members if f"records/creatures/{p}" == r["record_paths"][0]))))
        by_role: dict = {}
        for r in rows:
            by_role.setdefault(r["role"], []).append(r)
        for same in by_role.values():
            if len(same) > 1:
                for i, r in enumerate(same, start=1):
                    r["variant_index"] = i
        out.extend(rows)
    out.sort(key=lambda m: m["id"])
    return out
```

If the sort lambda reads poorly, build a `{row_id: rank}` dict first; keep behavior identical.

In `print_summary`, replace the `disagreeing` computation and its line with:

```python
    p(f"  groups split because their records disagree: {len(SPLIT_GROUPS)}")
    p(f"  rows carrying a variant suffix: {sum(1 for m in monsters if 'variant_index' in m)}")
```

Delete `disagreeing = ...`. Update the ABOUTME of `scripts/test_parse_monsters.py` line 2 to mention "splitting disagreeing groups".

- [ ] **Step 4: Run tests**

Run: `uv run scripts/test_parse_monsters.py`
Expected: pure checks `ok`; real-records legs may fail where splitting intentionally moves values (next step). Run `just lint-py`: clean.

- [ ] **Step 5: Regenerate and measure**

Run: `just parse-monsters`, then `just monster-parity`.
Expected: `FAILURES: 0`. Note the summary's `groups split` and `rows carrying a variant suffix` counts for the final report. If the suffix count is more than a handful, show Ted a sample of the colliding rows before continuing: the labeling decision assumed collisions are rare.

Re-pin the real-records checks splitting intentionally moves, each with a one-line comment:
- The logical row count 1635 rises by the number of extra rows splitting created; re-pin to the summary's row count. The kept raw record count (2737 or the current value) must not change: splitting reassigns records, it never drops them.
- Any check reading `variants_disagree` is obsolete: replace it with `check("no row carries variants_disagree", all("variants_disagree" not in m for m in m3))`.

Run: `uv run scripts/test_parse_monsters.py`
Expected: `FAILURES: 0`.

- [ ] **Step 6: Update diff_data's docstring**

`scripts/diff_data.py` docstring of the monsters diff function lists `variants_disagree` as a facet; replace it with `variant_index`. Run `uv run scripts/test_diff_data.py` and confirm it passes.

- [ ] **Step 7: Commit**

```bash
git add scripts/parse_monsters.py scripts/test_parse_monsters.py scripts/diff_data.py data/monsters.json
git commit -m "feat(monsters): split merged groups whose records disagree"
```

---

### Task 4: Web model and table: variant suffix replaces the disagree marker

**Files:**
- Modify: `web/src/monsters/core/model.ts`, `web/src/monsters/adapters/tableView.ts`, `web/src/monsters/monsters.css`, `web/src/i18n/app.en.json`, `web/test/appCatalog.test.ts`
- Test: `web/test/monsters/model.test.ts`, `web/test/monsters/tableView.test.ts`, and the `mon()` fixtures in `web/test/monsters/filter.test.ts`, `rankView.test.ts`, `stats.test.ts`

**Interfaces:**
- Produces: `Monster.variantIndex: number | null`, `Monster.recordPath: string` (first of `record_paths`, `""` when absent). `Monster.variantsDisagree` is removed.

- [ ] **Step 1: Write the failing tests**

In `web/test/monsters/model.test.ts`, replace `variants_disagree: true,` in `DOC` with `variant_index: 2, record_paths: ["records/creatures/enemies/a.dbr", "records/creatures/enemies/a2.dbr"],` and replace `expect(m.variantsDisagree).toBe(true);` with:

```ts
  expect(m.variantIndex).toBe(2);
  expect(m.recordPath).toBe("records/creatures/enemies/a.dbr");
```

Add:

```ts
test("an old dataset row without variant_index or record_paths still parses", () => {
  const raw = structuredClone(DOC) as { monsters: Record<string, unknown>[] };
  delete raw.monsters[0]!.variant_index;
  delete raw.monsters[0]!.record_paths;
  raw.monsters[0]!.variants_disagree = true;
  const m = parseMonsters(raw).monsters[0]!;
  expect(m.variantIndex).toBeNull();
  expect(m.recordPath).toBe("");
});
```

In every test `mon()` fixture (`filter`, `rankView`, `stats`, `model`, `tableView`), replace `variantsDisagree: false,` with `variantIndex: null,` and `recordPath: "",`.

In `web/test/monsters/tableView.test.ts`, replace the test `a disagreeing row carries a warning marker` with:

```ts
test("a colliding split row shows its variant suffix with the record path as tooltip", () => {
  const html = tableMarkup(
    loc,
    [mon({ variantIndex: 2, recordPath: "records/creatures/enemies/hero/twin_b.dbr" })],
    view(),
    ZERO,
    nameOf,
  );
  expect(html).toContain('class="m-variant"');
  expect(html).toContain('title="records/creatures/enemies/hero/twin_b.dbr"');
  expect(html).toContain("monsters.table.variantSuffix");
});

test("a row without a variant index shows no suffix", () => {
  const html = tableMarkup(loc, [mon()], view(), ZERO, nameOf);
  expect(html).not.toContain("m-variant");
});
```

Also assert the legend no longer carries the disagree entry: if an existing legend test lists `monsters.legend.disagree`, remove that expectation and add `expect(html).not.toContain("monsters.legend.disagree");`.

- [ ] **Step 2: Run to verify they fail**

Run: `just test test/monsters`
Expected: FAIL (`variantIndex` undefined, suffix missing).

- [ ] **Step 3: Implement**

`web/src/monsters/core/model.ts`: in `Monster`, replace `variantsDisagree: boolean;` with

```ts
  /** 1-based, present only when split rows share name, classification and role. */
  variantIndex: number | null;
  /** The representative record, shown as the variant suffix's tooltip. */
  recordPath: string;
```

In `RawMonster`, replace `variants_disagree: boolean;` with `variant_index?: number;` and `record_paths?: string[];`. In `mapMonster`, replace the `variantsDisagree` line with:

```ts
    variantIndex: r.variant_index ?? null,
    recordPath: r.record_paths?.[0] ?? "",
```

`web/src/monsters/adapters/tableView.ts`: delete the `warn` constant and its use. Build the name cell as:

```ts
  const suffix =
    m.variantIndex !== null
      ? ` <span class="m-variant" title="${esc(m.recordPath)}">${esc(
          loc.translate("monsters.table.variantSuffix", { n: m.variantIndex }),
        )}</span>`
      : "";
```

and use `` `<td class="left m-name">${esc(nameOf(m))}${suffix}</td>` ``. In `legend`, delete the `monsters.legend.disagree` span.

`web/src/monsters/monsters.css`: replace the `.monsters-page .disagree { ... }` rule with

```css
.monsters-page .m-variant {
  font-weight: 400;
  color: var(--mon-mut);
}
```

`web/src/i18n/app.en.json`: delete `monsters.table.disagreeTitle` and `monsters.legend.disagree`; add `"monsters.table.variantSuffix": "(variant {n})",` after `monsters.table.summonSuffix`. `web/test/appCatalog.test.ts`: remove the two deleted keys from its list and add `"monsters.table.variantSuffix",`.

- [ ] **Step 4: Run tests**

Run: `just test`
Expected: all pass. Then `just check`: fmt, lint, typecheck clean (run `just fmt` first if fmt-check fails on the edited files only).

- [ ] **Step 5: Commit**

```bash
git add web/src/monsters web/src/i18n/app.en.json web/test
git commit -m "feat(monsters): label split rows with a variant suffix; drop the disagree marker"
```

---

### Task 5: grimtools id mapping script and link data

**Files:**
- Create: `scripts/gt_monster_links.ts` (fetch + write), `web/src/monsters/core/grimtoolsLinks.ts` (pure matcher, so it is testable under `just test`)
- Create: `data/grimtools-monsters.json` (generated)
- Test: `web/test/monsters/grimtoolsLinks.test.ts`
- Modify: `justfile` (recipe `gt-monster-links`; `build` copies the new data file)

**Interfaces:**
- Produces (`grimtoolsLinks.ts`):

```ts
export interface GtMonster { id: number; nameTag: string; classification: string; difficulties: Difficulty[]; inline: Resistances }
export interface LinkRow { id: string; nameTag: string; classification: string; inline: Resistances }
export type LinkTable = Record<string, Partial<Record<Difficulty, number>>>;
export function matchLinks(rows: LinkRow[], gt: GtMonster[]): { links: LinkTable; unmatched: string[] };
export function grimtoolsMonsterUrl(id: number): string; // https://www.grimtools.com/monsterdb/<id>
```

- `data/grimtools-monsters.json`: `{"source": "https://www.grimtools.com/monsterdb/js/monsterdb.js", "game_version": "...", "links": LinkTable}`.

- [ ] **Step 1: Write the failing tests**

`web/test/monsters/grimtoolsLinks.test.ts`:

```ts
// ABOUTME: Tests the grimtools id matcher: difficulty variants, inline tie-breaks, and misses.
// ABOUTME: The matcher is pure; scripts/gt_monster_links.ts feeds it grimtools' monsterdb.js.
import { test, expect } from "bun:test";
import { matchLinks, grimtoolsMonsterUrl, type GtMonster, type LinkRow } from "../../src/monsters/core/grimtoolsLinks";
import { DAMAGE_TYPES } from "../../src/monsters/core/facets";
import type { Resistances } from "../../src/monsters/core/model";

const Z = Object.fromEntries(DAMAGE_TYPES.map((t) => [t, 0])) as Resistances;
const ALL = ["normal", "elite", "ultimate", "ascendant"] as const;
const row = (over: Partial<LinkRow> = {}): LinkRow => ({ id: "r", nameTag: "tagX", classification: "SuperBoss", inline: { ...Z }, ...over });
const gt = (over: Partial<GtMonster> = {}): GtMonster => ({ id: 1, nameTag: "tagX", classification: "SuperBoss", difficulties: [...ALL], inline: { ...Z }, ...over });

test("difficulty variants map each difficulty to its own entry", () => {
  const { links } = matchLinks([row()], [
    gt({ id: 363, difficulties: ["normal", "elite"] }),
    gt({ id: 364, difficulties: ["ultimate"] }),
    gt({ id: 3843, difficulties: ["ascendant"] }),
  ]);
  expect(links.r).toEqual({ normal: 363, elite: 363, ultimate: 364, ascendant: 3843 });
});

test("several candidates: the one whose inline values equal the row's wins", () => {
  const rows = [row({ id: "rev0" }), row({ id: "rev33", inline: { ...Z, pierce: 33 } })];
  const { links } = matchLinks(rows, [gt({ id: 249 }), gt({ id: 339, inline: { ...Z, pierce: 33 } }), gt({ id: 444, inline: { ...Z, pierce: 33 } })]);
  expect(links.rev0!.ultimate).toBe(249);
  expect(links.rev33!.ultimate).toBe(339);
});

test("no inline match among candidates falls back to the lowest id", () => {
  const { links } = matchLinks([row({ inline: { ...Z, fire: 5 } })], [gt({ id: 20 }), gt({ id: 10 })]);
  expect(links.r!.normal).toBe(10);
});

test("classification must match, and a row with no candidates is reported unmatched", () => {
  const { links, unmatched } = matchLinks([row()], [gt({ classification: "Boss" })]);
  expect(links.r).toBeUndefined();
  expect(unmatched).toEqual(["r"]);
});

test("the url is the monsterdb page", () => {
  expect(grimtoolsMonsterUrl(364)).toBe("https://www.grimtools.com/monsterdb/364");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `just test test/monsters/grimtoolsLinks.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the matcher**

`web/src/monsters/core/grimtoolsLinks.ts`:

```ts
// ABOUTME: Matches our monster rows to grimtools monsterdb ids, one per difficulty.
// ABOUTME: Pure: scripts/gt_monster_links.ts supplies grimtools' data and writes the table.
import { DAMAGE_TYPES, DIFFICULTIES, type Difficulty } from "./facets";
import type { Resistances } from "./model";

export interface GtMonster {
  id: number;
  nameTag: string;
  classification: string;
  difficulties: Difficulty[];
  inline: Resistances;
}

export interface LinkRow {
  id: string;
  nameTag: string;
  classification: string;
  /** The row's own record values: resistances minus passive grants. */
  inline: Resistances;
}

export type LinkTable = Record<string, Partial<Record<Difficulty, number>>>;

const sameInline = (a: Resistances, b: Resistances) => DAMAGE_TYPES.every((t) => a[t] === b[t]);

/** For each row and difficulty, the grimtools entry sharing name tag and classification
 *  that exists in that difficulty; among several, the one whose inline values equal the
 *  row's, then the lowest id. */
export function matchLinks(rows: LinkRow[], gt: GtMonster[]): { links: LinkTable; unmatched: string[] } {
  const byKey = new Map<string, GtMonster[]>();
  for (const g of gt) {
    const key = `${g.nameTag}|${g.classification}`;
    byKey.set(key, [...(byKey.get(key) ?? []), g]);
  }
  const links: LinkTable = {};
  const unmatched: string[] = [];
  for (const r of rows) {
    const candidates = byKey.get(`${r.nameTag}|${r.classification}`) ?? [];
    const perDiff: Partial<Record<Difficulty, number>> = {};
    for (const d of DIFFICULTIES) {
      const inDiff = candidates.filter((g) => g.difficulties.includes(d)).sort((a, b) => a.id - b.id);
      const pick = inDiff.find((g) => sameInline(g.inline, r.inline)) ?? inDiff[0];
      if (pick) perDiff[d] = pick.id;
    }
    if (Object.keys(perDiff).length) links[r.id] = perDiff;
    else unmatched.push(r.id);
  }
  return { links, unmatched };
}

export function grimtoolsMonsterUrl(id: number): string {
  return `https://www.grimtools.com/monsterdb/${id}`;
}
```

Check `DIFFICULTIES` in `web/src/monsters/core/facets.ts` is ordered `normal, elite, ultimate, ascendant` and typed as `Difficulty[]`; adapt the import if its name differs.

- [ ] **Step 4: Run tests**

Run: `just test test/monsters/grimtoolsLinks.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the fetch script**

`scripts/gt_monster_links.ts`:

```ts
// ABOUTME: Regenerates data/grimtools-monsters.json: our monster rows -> grimtools monsterdb ids per difficulty.
// ABOUTME: Fetches grimtools' public monsterdb.js once, evaluates it in a sandbox, and matches with matchLinks.
//
// Usage: bun scripts/gt_monster_links.ts   (re-run after regenerating data/monsters.json)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { matchLinks, type GtMonster, type LinkRow } from "../web/src/monsters/core/grimtoolsLinks";
import { DAMAGE_TYPES, type Difficulty } from "../web/src/monsters/core/facets";
import type { Resistances } from "../web/src/monsters/core/model";

const ROOT = join(import.meta.dir, "..");
const SRC = "https://www.grimtools.com/monsterdb/js/monsterdb.js";
const UA = "grimdawn-devotions-import/1.0 (+https://github.com/tednaleid/grimdawn-devotions)";
const GT_FIELD: Record<string, string> = { vitality: "defensiveLife" };
const DIFF_INDEX: Record<number, Difficulty> = { 1: "normal", 2: "elite", 3: "ultimate", 4: "ascendant" };

const res = await fetch(SRC, { headers: { "User-Agent": UA } });
if (!res.ok) throw new Error(`${SRC}: ${res.status}`);
const ctx: { window: Record<string, any> } = { window: {} };
ctx.window.window = ctx.window;
vm.createContext(ctx);
vm.runInContext(await res.text(), ctx);
const w = ctx.window;

// grimtools stores a ranged stat as [min, max]; inline resistances are scalars in practice.
const num = (v: unknown) => (Array.isArray(v) ? (Number(v[0]) + Number(v[1])) / 2 : Number(v ?? 0));
const inlineOf = (rec: Record<string, unknown>, field: (t: string) => string) =>
  Object.fromEntries(DAMAGE_TYPES.map((t) => [t, num(rec[field(t)])])) as Resistances;

const gt: GtMonster[] = Object.entries(w.allMonsters as Record<string, Record<string, unknown>>).map(([key, m]) => ({
  id: Number(key.slice(1)),
  nameTag: String(m.d),
  classification: String(m.monsterClassification),
  difficulties: ((w.monsterDifficulty[key] as number[] | undefined) ?? [1, 2, 3, 4]).map((i) => DIFF_INDEX[i]!),
  inline: inlineOf(m, (t) => GT_FIELD[t] ?? `defensive${t[0]!.toUpperCase()}${t.slice(1)}`),
}));

const doc = JSON.parse(readFileSync(join(ROOT, "data/monsters.json"), "utf8"));
const rows: LinkRow[] = doc.monsters.map((m: any) => ({
  id: m.id,
  nameTag: m.name_tag,
  classification: m.classification,
  inline: Object.fromEntries(
    DAMAGE_TYPES.map((t) => [t, m.resistances[t] - (m.passive_resistances?.[t] ?? 0)]),
  ) as Resistances,
}));

const { links, unmatched } = matchLinks(rows, gt);
const out = { source: SRC, game_version: String(w.gameVersion ?? ""), links };
writeFileSync(join(ROOT, "data/grimtools-monsters.json"), `${JSON.stringify(out, null, 1)}\n`);

const byClass = new Map<string, string[]>();
for (const id of unmatched) {
  const c = doc.monsters.find((m: any) => m.id === id).classification;
  byClass.set(c, [...(byClass.get(c) ?? []), id]);
}
console.log(`${w.gameVersion}: linked ${Object.keys(links).length} of ${rows.length} rows; unmatched ${unmatched.length}`);
for (const [c, ids] of byClass) console.log(`  ${c}: ${ids.length}${ids.length <= 10 ? `  ${ids.join(", ")}` : ""}`);
```

Before running, confirm the grimtools field for our `poison` is `defensivePoison` and for `vitality` is `defensiveLife` (the audit's `inline` block confirms both); the generic `defensive<Type>` capitalisation covers the rest.

- [ ] **Step 6: Generate the link data**

Run: `bun scripts/gt_monster_links.ts`
Expected: a summary line with linked and unmatched counts. Check `jq '.links["enemies.boss-quest.wendigo_ravager_flesh"]' data/grimtools-monsters.json` prints `{"normal": 363, "elite": 363, "ultimate": 364, "ascendant": 3843}`. Record the unmatched counts per classification for the final report; many unmatched Common rows is expected only if grimtools omits them, so read the list and flag anything surprising to Ted rather than tuning the matcher silently.

- [ ] **Step 7: Recipes**

In `justfile`, next to `gt-star-table`:

```
# Regenerate data/grimtools-monsters.json (monster -> grimtools monsterdb id per difficulty).
# Re-run after regenerating data/monsters.json.
[group("deposit")]
gt-monster-links:
    bun "{{justfile_directory()}}/scripts/gt_monster_links.ts"
```

In `build`, after the `monsters.json` copy line, add:

```
    cp "{{justfile_directory()}}/data/grimtools-monsters.json" dist/data/grimtools-monsters.json
```

- [ ] **Step 8: Run and commit**

Run: `just check`
Expected: clean.

```bash
git add scripts/gt_monster_links.ts web/src/monsters/core/grimtoolsLinks.ts web/test/monsters/grimtoolsLinks.test.ts data/grimtools-monsters.json justfile
git commit -m "feat(monsters): map monsters to grimtools monsterdb ids per difficulty"
```

---

### Task 6: Link monster names to grimtools for the selected difficulty

**Files:**
- Modify: `web/src/monsters/adapters/dataSource.ts` (load links), `web/src/monsters/app/main.ts` (pass links), `web/src/monsters/adapters/tableView.ts` (render anchor)
- Test: `web/test/monsters/tableView.test.ts`

**Interfaces:**
- Consumes: `LinkTable`, `grimtoolsMonsterUrl` from Task 5.
- Produces: `loadGrimtoolsLinks(base = ".."): Promise<LinkTable>` (returns `{}` on any fetch or parse failure, so the page never breaks over a missing link file); `tableMarkup(..., nameOf, linkOf?: (m: Monster) => string | null)`; `renderTable(..., nameOf, onSort, linkOf?)`.

- [ ] **Step 1: Write the failing tests**

In `web/test/monsters/tableView.test.ts`:

```ts
test("a linked row's name opens its grimtools page in a new tab", () => {
  const html = tableMarkup(loc, [mon()], view(), ZERO, nameOf, () => "https://www.grimtools.com/monsterdb/364");
  expect(html).toContain('<a href="https://www.grimtools.com/monsterdb/364" target="_blank" rel="noopener noreferrer">Name:enemies.a</a>');
});

test("an unlinked row's name is plain text", () => {
  const html = tableMarkup(loc, [mon()], view(), ZERO, nameOf, () => null);
  expect(html).toContain('<td class="left m-name">Name:enemies.a</td>');
});

test("omitting linkOf renders plain names", () => {
  const html = tableMarkup(loc, [mon()], view(), ZERO, nameOf);
  expect(html).not.toContain("<a ");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `just test test/monsters/tableView.test.ts`
Expected: FAIL (no anchor).

- [ ] **Step 3: Implement**

`tableView.ts`: add parameter `linkOf: (m: Monster) => string | null = () => null` to `tableMarkup` and `renderTable` (last position), thread it to `row`, and build the name:

```ts
  const href = linkOf(m);
  const name = href
    ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(nameOf(m))}</a>`
    : esc(nameOf(m));
```

then `` `<td class="left m-name">${name}${suffix}</td>` ``.

`dataSource.ts`: add

```ts
/** grimtools monsterdb ids per row and difficulty; empty when the file is missing or unreadable,
 *  so a deploy without it still renders every row, unlinked. */
export async function loadGrimtoolsLinks(base = ".."): Promise<LinkTable> {
  try {
    const res = await fetch(withVersion(`${base}/data/grimtools-monsters.json`));
    if (!res.ok) return {};
    const doc = (await res.json()) as { links?: LinkTable };
    return doc.links ?? {};
  } catch {
    return {};
  }
}
```

(import `type LinkTable` from `../core/grimtoolsLinks`; update the file's ABOUTME second line to say it also loads the grimtools link table).

`main.ts`: load both in parallel next to `loadMonsters`: `const [doc, gtLinks] = await Promise.all([loadMonsters(".."), loadGrimtoolsLinks("..")]);` and define

```ts
  const linkOf = (m: Monster) => {
    const id = gtLinks[m.id]?.[view.diff];
    return id === undefined ? null : grimtoolsMonsterUrl(id);
  };
```

passing `linkOf` as the last argument to `renderTable`.

Add a dataSource test if `web/test/monsters` has a pattern for mocking `fetch`; otherwise cover the failure path by a unit test that stubs `globalThis.fetch` to reject and asserts `loadGrimtoolsLinks()` resolves to `{}` (restore `fetch` after).

- [ ] **Step 4: Run tests and see it in the browser**

Run: `just check`
Expected: clean.

Run: `just open-monsters`, set tier SuperBoss, confirm Ravager of Flesh links to `/monsterdb/364` on Ultimate and `/monsterdb/363` on Normal, and that link color and hover read well in the table (adjust `.monsters-page .m-name a` in `monsters.css` only if the default `a` color fights the row).

- [ ] **Step 5: Commit**

```bash
git add web/src/monsters web/test/monsters
git commit -m "feat(monsters): link each monster name to its grimtools page for the selected difficulty"
```

---

### Task 7: Evergreen reference doc and footnote

**Files:**
- Create: `docs/monster-resistances.md`
- Modify: `CLAUDE.md` (domain section), `web/src/i18n/app.en.json` + `web/test/appCatalog.test.ts` only if the footnote needs a new key

- [ ] **Step 1: Check the page's existing caveat text**

`monsters.rank.caveat` already explains offsets. Decide whether the level-100 convention fits there. If a new sentence is needed, add key `monsters.note.level`: "Level-scaled monster skills are read at monster level 100, as grimtools does." render it where `monsters.rank.caveat` renders, and add the key to `appCatalog.test.ts`. Add a markup test asserting the key appears.

- [ ] **Step 2: Write the doc**

`docs/monster-resistances.md`, concise, evergreen, no emojis or emdashes. Sections:
- What a row is: the (name, classification) group, the representative rule, and splitting into agreeing subgroups; what `variant_index` means.
- The formula: displayed = inline + resident passive grants + difficulty offset (players bracket); aura grants shown, excluded by default.
- Skill ranks: `skillLevel<n>` is a number or an equation of `charLevel`; evaluated at monster level 100 and floored; unparseable equations read as rank 1 and are counted in the parser summary.
- Resident versus conditional classes, listing the three resident classes and the aura classes.
- grimtools parity: level 100, 1 player, same offsets; the fixture `scripts/fixtures/gt-monster-resistances.json`, `just monster-parity`, and how to refresh it (`bun scripts/gt_monster_harvest.mjs`).
- grimtools links: `data/grimtools-monsters.json`, the matching rule, `just gt-monster-links`, re-run after regenerating monsters.json.
- Sources: link grimtools monsterdb pages m363, m364, m3843 (Ravager of Flesh) and m339/m444/m249 (Death Revenant) as the worked examples.

- [ ] **Step 3: Link it from CLAUDE.md**

In `CLAUDE.md`'s "The domain" section, after the Resistance Reduction sentence, add: "The Monster Resistances page's formula, skill-rank rule, and grimtools parity checks are in [docs/monster-resistances.md](docs/monster-resistances.md); read it before touching `scripts/parse_monsters.py` or the monster page."

- [ ] **Step 4: Commit**

```bash
git add docs/monster-resistances.md CLAUDE.md web
git commit -m "docs(monsters): evergreen reference for monster resistances and grimtools parity"
```

---

### Task 8: Final verification and report

- [ ] **Step 1: Full checks**

Run, in order: `just parse-monsters`, `just monster-parity` (expect `FAILURES: 0`), `uv run scripts/test_parse_monsters.py`, `just gt-monster-links`, `just diff-data`, `just check`.

`diff-data` should show the intended changes only: +25 on level-scaled passive types for bosses and nemeses, rows added by splitting, aura moves from the reclassified buff classes. Anything else: investigate before reporting.

- [ ] **Step 2: Wire parity into migrate**

Add `monster-parity` to the end of the `migrate` recipe's dependency list, so a future game patch that moves boss resistances is caught during migration.

- [ ] **Step 3: Report to Ted**

Report: parity result; groups split and rows with a variant suffix; unmatched grimtools links by classification (with the list for Boss, SuperBoss and Hero); any skillLevel equations the evaluator refused; every parser test value re-pinned and why; whether `data/monsters.json` also moved because of a game patch.

- [ ] **Step 4: Commit**

```bash
git add data/monsters.json data/grimtools-monsters.json scripts/test_parse_monsters.py justfile
git commit -m "data(monsters): regenerate with level-100 skill ranks and split variants"
```

Do not push or merge without Ted's go-ahead.
