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
import ast
import datetime as _dt
import json
import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gd_dbr import DB, level_array_value, load_translations  # noqa: E402

# Output key -> the .dbr field holding that resistance. A bare defensive<Type> on a
# CREATURE record is that monster's own resistance; the same field name on a SKILL
# record, negative, is a resistance-reduction debuff (what parse_rr.py extracts).
# Elemental is not a tracked type of its own: see ELEMENTAL_FIELD.
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

# A skill's elemental resistance, which the game and grimtools apply to each of fire,
# cold and lightning. Monster records themselves do not carry it; their skills do.
ELEMENTAL_FIELD = "defensiveElementalResistance"
ELEMENTAL_TYPES = ("fire", "cold", "lightning")

VALID_CLASSIFICATIONS = ("Common", "Champion", "Hero", "Boss", "SuperBoss", "Quest")

# Directory names that identify a monster's role. "waveevents" normalizes onto
# "waveevent": they are two spellings of one concept. Anything else is "base".
ROLE_MARKERS = (
    "nemesis", "hero", "boss&quest", "bounties", "faction",
    "waveevents", "waveevent", "special", "devotion",
    "anomalies", "npcs", "ambient", "pc",
)

EXCLUSIONS: list[dict] = []

# Display names of (name, classification) groups whose records disagreed and were
# split into one row per agreeing subgroup, reported by print_summary.
SPLIT_GROUPS: list[str] = []


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
    if rel_path.rsplit("/", 1)[-1].startswith("trap_"):
        # Traps are level furniture, not monsters: mine_explosive carries 500 in nine of ten
        # types and would distort every aggregate. Matched on the filename prefix, never as a
        # substring: "trap" appears inside five real monsters (three Ugdenbog ghosts,
        # chthonianfiend_trappedandalone_01, chthonianservitor_mourndaletrap).
        return "trap"
    if rec.get("monsterClassification") not in VALID_CLASSIFICATIONS:
        return "no classification"
    return None


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
# A summoned entity's own stats. Crediting these to the summoner would corrupt
# exactly the boss records this resolution exists to fix.
SUMMON_CLASSES = {"Monster", "Turret", "SpiritHost", "PetPlayerScaling"}

# Skill references that carried a resistance but contributed nothing, with the reason.
SKILL_EXCLUSIONS: list[dict] = []

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
        v = ev(ast.parse(expr.strip(), mode="eval"))
    except (SyntaxError, ValueError, ZeroDivisionError, RecursionError):
        return None
    return v if math.isfinite(v) else None


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


def _skill_grant(srec: dict, level: int) -> dict:
    """The nonzero resistance a skill record grants at a given rank.

    Attack skills routinely carry `defensive<Type>` fields pinned to zero, so a field
    being present says nothing about whether the skill grants anything.
    """
    out: dict[str, float] = {}
    for out_key, field in RESISTANCE_FIELDS.items():
        raw = srec.get(field)
        if not raw:
            continue
        v = level_array_value(raw, level)
        if v:
            out[out_key] = v
    elemental = srec.get(ELEMENTAL_FIELD)
    v = level_array_value(elemental, level) if elemental else 0
    if v:
        for out_key in ELEMENTAL_TYPES:
            out[out_key] = out.get(out_key, 0) + v
    return out


def _buff_hop_grant(srec: dict, level: int, get_skill) -> dict:
    """The grant a buff-hosting skill delivers through its `buffSkillName` child.

    A toggled or radius buff carries no `defensive<Type>` field itself; the grant lives on
    the child record it applies. Only a child in BUFF_CHILD_CLASSES counts, because those
    buff the bearer. The `SkillBuff_Debuf` family is excluded on purpose: its values are
    negative because they are resistance reduction applied to the player, which belongs to
    the resistance-reduction pipeline rather than to a monster's own resistance.
    """
    ref = srec.get("buffSkillName")
    if not ref:
        return {}
    child = get_skill(ref)
    if not child or (child.get("Class") or "").strip() not in BUFF_CHILD_CLASSES:
        return {}
    return _skill_grant(child, level)


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
        level = _skill_level(rec, m.group(1), rel_path)
        own = _skill_grant(srec, level)
        hop = _buff_hop_grant(srec, level, get_skill) if not own else {}
        grant = own or hop
        if cls in SELF_PASSIVE_CLASSES:
            bucket = resident
        elif cls in AURA_CLASSES:
            bucket = aura
        elif hop:
            # A toggled or radius buff hosts its grant on a child record rather than
            # carrying it inline. Reaching a grant through such a host makes it
            # conditional, so it is recorded as an aura however the child is classed.
            bucket = aura
        else:
            # Only report a skip that actually forfeits resistance. Most references carry
            # a zeroed defensive field and grant nothing; counting those would make the
            # summary read as loss where none occurred.
            if own:
                reason = ("summoned entity" if cls in SUMMON_CLASSES
                          else f"unclassified skill class {cls or '(none)'}")
                SKILL_EXCLUSIONS.append(
                    {"record_path": f"records/creatures/{rel_path}", "skill": ref.strip(), "reason": reason})
            continue
        for out_key, v in grant.items():
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


def _representative_rank(entry):
    """Sort key selecting the representative: highest maxLevel, then highest
    minLevel, then lexicographically lowest path. Total, so runs are reproducible."""
    rel_path, rec = entry
    return (
        -(as_float(rec.get("maxLevel")) or 0.0),
        -(as_float(rec.get("minLevel")) or 0.0),
        rel_path,
    )


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
        rank_of = {
            f"records/creatures/{rel_path}": _representative_rank((rel_path, rec))
            for rel_path, rec in members
        }
        rows.sort(key=lambda r: rank_of[r["record_paths"][0]])
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


def _member_rel_paths(monster: dict) -> list[str]:
    """A logical monster's collapsed record paths, relative to records/creatures/.

    record_paths carries the "records/creatures/" prefix; role_of and the summon
    check both expect a path relative to that root, so strip it back off here.
    """
    prefix = "records/creatures/"
    return [p[len(prefix):] if p.startswith(prefix) else p for p in monster["record_paths"]]


def members_disagree_on_role(monster: dict) -> bool:
    """True when a logical monster's collapsed members span more than one path role.

    `role` on the output row is representative-derived: only the chosen
    representative's role is kept, so other members' roles are recomputed here from
    record_paths rather than stored on the row.
    """
    return len({role_of(p) for p in _member_rel_paths(monster)}) > 1


def members_disagree_on_summon(monster: dict) -> bool:
    """True when a logical monster's collapsed members mix _summon and non-_summon
    paths. `is_summon` on the output row is likewise representative-derived."""
    return len({p.endswith("_summon.dbr") for p in _member_rel_paths(monster)}) > 1


DIFFICULTIES = ("normal", "elite", "ultimate")
# Ascendant is not a fourth difficulty in the records: it is a toggle layered on
# Ultimate (internally "ultimate challenge", the way Veteran layers on Normal).
# It is a fourth key in our output because that is how the page offers it.
ASCENDANT = "ascendant"
PLAYER_BRACKETS = ("1", "2", "3", "4")

GAMEENGINE_REF = "records/game/gameengine.dbr"
SCALER_FALLBACK = "records/game/balancingadjustment_mp+difficulty_enemies01.dbr"
ASCENDANT_RECORD_FALLBACK = "records/game/gameascendant.dbr"
ULTRAMODE_FALLBACK = "records/game/balancingadjustment_ultramode_enemies01.dbr"


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


def ascendant_ref(db: DB) -> str:
    """The enemy adjustment Ascendant Mode layers on top of Ultimate.

    Two hops, both through fields the engine declares, so a patch that relocates
    either record is followed rather than silently read from a stale path:
    gameengine.dbr -> ascendantRecord -> gameascendant.dbr
    -> ultimateChallangeAdjustment (the game's own spelling).
    """
    game_ref = (db.get(GAMEENGINE_REF).get("ascendantRecord") or "").strip()
    ref = (db.get(game_ref or ASCENDANT_RECORD_FALLBACK).get("ultimateChallangeAdjustment") or "").strip()
    return ref or ULTRAMODE_FALLBACK


FAILED_ASCENDANT_FIELDS: list[str] = []


def flat_adjustment(rec: dict) -> dict:
    """The ten resistance values on a flat (non-tabular) adjustment record.

    Deliberately not split_difficulty_array: that models a 3x4 difficulty/player
    table, while this record is one adjustment applied on top of whichever
    difficulty is active. Routing it through the 12-cell reader would be a
    category error that happens to look correct while every value is zero.

    An absent field contributes 0. A present field that is not a single number
    is recorded in FAILED_ASCENDANT_FIELDS (mirroring FAILED_OFFSET_FIELDS) so
    print_summary reports it instead of the value silently becoming 0.
    """
    out = {}
    for key, field in RESISTANCE_FIELDS.items():
        raw = rec.get(field)
        if raw is None:
            out[key] = 0
            continue
        v = as_float(raw)
        if v is None:
            FAILED_ASCENDANT_FIELDS.append(key)
            out[key] = 0
            continue
        out[key] = int(v) if v == int(v) else round(v, 4)
    return out


FAILED_OFFSET_FIELDS: list[str] = []


def difficulty_offsets(db: DB) -> dict:
    """Global additive resistance offsets per difficulty and player count.

    Difficulty does not rescale a monster's own resistance; it adds a flat offset to
    every monster in the game. Kept separate from each monster's base so the page can
    compute effective = base + offset, and so these balance constants stay in
    extracted data rather than app code.

    A field whose array arity is neither 1 nor 12 defaults to 0 for every difficulty
    and player bracket, and is recorded in FAILED_OFFSET_FIELDS (mirroring the
    EXCLUSIONS pattern) so print_summary can report it loudly instead of the whole
    resistance column silently going to zero.
    """
    rec = db.get(scaler_ref(db))
    out = {d: {p: {} for p in PLAYER_BRACKETS} for d in DIFFICULTIES}
    for key, field in RESISTANCE_FIELDS.items():
        table = split_difficulty_array(rec.get(field))
        if table is None:
            FAILED_OFFSET_FIELDS.append(key)
            table = {}
        for d in DIFFICULTIES:
            for p in PLAYER_BRACKETS:
                out[d][p][key] = table.get(d, {}).get(p, 0)
    # Ascendant = Ultimate plus a flat adjustment. The adjustment does not vary by
    # player bracket, so Ultimate's bracket spread carries through unchanged.
    # Additive rather than replacing: the field is named an "adjustment" and sits
    # parallel to challengeAdjustment (Veteran), which stacks on Normal. Every
    # value is 0 today, so no test on real data can distinguish the two readings.
    adj = flat_adjustment(db.get(ascendant_ref(db)))
    out[ASCENDANT] = {
        p: {key: out["ultimate"][p][key] + adj[key] for key in RESISTANCE_FIELDS}
        for p in PLAYER_BRACKETS
    }
    return out


def iter_creature_records(db: DB):
    """(path relative to records/creatures, record) for every .dbr under creatures/.

    Sorted so a run is reproducible regardless of filesystem ordering.
    """
    root = db.root / "records/creatures"
    for path in sorted(root.rglob("*.dbr")):
        rel = path.relative_to(root).as_posix()
        yield rel, db.get(f"records/creatures/{rel}")


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


def print_summary(monsters, exclusions, failed_offset_fields, failed_ascendant_fields):
    """Audit summary to stderr: population, facet spread, and every exclusion count."""
    from collections import Counter
    p = lambda *a: print(*a, file=sys.stderr)
    raw = sum(m["variant_count"] for m in monsters)
    collapsing = [m for m in monsters if m["variant_count"] > 1]
    p("\n=== MONSTER EXTRACTION SUMMARY ===")
    p(f"  kept records: {raw}  ->  logical monsters: {len(monsters)}")
    p(f"  collapsing >1 record: {len(collapsing)}")
    p(f"  groups split because their records disagree: {len(SPLIT_GROUPS)}")
    p(f"  rows carrying a variant suffix: {sum(1 for m in monsters if 'variant_index' in m)}")
    # role/is_summon/level range are representative-derived (only the chosen
    # representative's values land on the row), same as resistances above, so a
    # collapsed group's other members can carry a different role or summon status.
    p(f"  rows collapsing records of mixed role: "
      f"{sum(1 for m in monsters if members_disagree_on_role(m))}")
    p(f"  rows collapsing records of mixed summon status: "
      f"{sum(1 for m in monsters if members_disagree_on_summon(m))}")
    p("  by classification: " + ", ".join(
        f"{k}={v}" for k, v in sorted(Counter(m["classification"] for m in monsters).items())))
    p("  by role: " + ", ".join(
        f"{k}={v}" for k, v in sorted(Counter(m["role"] for m in monsters).items())))
    p(f"  summons: {sum(1 for m in monsters if m['is_summon'])}")
    p(f"  no race tag: {sum(1 for m in monsters if not m['race_tag'])}")
    p(f"  with a skill resistance grant: {sum(1 for m in monsters if m.get('passive_resistances'))}")
    p(f"  with an aura grant (recorded, not counted): {sum(1 for m in monsters if m.get('aura_resistances'))}")
    p(f"  skill grants not counted: {len(SKILL_EXCLUSIONS)}")
    for reason, n in sorted(Counter(e["reason"] for e in SKILL_EXCLUSIONS).items()):
        p(f"    - {reason}: {n}")
    p(f"  skill levels evaluated at monster level {MONSTER_LEVEL}")
    if UNPARSED_SKILL_LEVELS:
        p(f"  WARNING: skillLevel equations not understood, read as rank 1: {len(UNPARSED_SKILL_LEVELS)}")
        for expr, n in Counter(e["expr"] for e in UNPARSED_SKILL_LEVELS).most_common(10):
            p(f"    - {expr!r}: {n}")
    p(f"  excluded: {len(exclusions)}")
    for reason, n in sorted(Counter(e["reason"] for e in exclusions).items()):
        p(f"    - {reason}: {n}")
    if failed_offset_fields:
        p(f"  WARNING: difficulty offset fields failed to parse and defaulted to 0 "
          f"for every difficulty/player bracket: {sorted(set(failed_offset_fields))}")
    if failed_ascendant_fields:
        p(f"  WARNING: ascendant adjustment fields failed to parse and defaulted to 0: "
          f"{sorted(set(failed_ascendant_fields))}")


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
    print_summary(monsters, EXCLUSIONS, FAILED_OFFSET_FIELDS, FAILED_ASCENDANT_FIELDS)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
