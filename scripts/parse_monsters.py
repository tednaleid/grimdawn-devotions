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
from gd_dbr import DB, level_array_value, load_translations  # noqa: E402

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
    return out


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
        grant = _skill_grant(srec, _skill_level(rec, m.group(1)))
        if cls in SELF_PASSIVE_CLASSES:
            bucket = resident
        elif cls in AURA_CLASSES:
            bucket = aura
        else:
            # Only report a skip that actually forfeits resistance. 2,177 references on
            # current data carry a zeroed defensive field and grant nothing; counting
            # those would make the summary read as loss where none occurred.
            if grant:
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


def print_summary(monsters, exclusions, failed_offset_fields):
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
    p(f"  excluded: {len(exclusions)}")
    for reason, n in sorted(Counter(e["reason"] for e in exclusions).items()):
        p(f"    - {reason}: {n}")
    if failed_offset_fields:
        p(f"  WARNING: difficulty offset fields failed to parse and defaulted to 0 "
          f"for every difficulty/player bracket: {sorted(set(failed_offset_fields))}")


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
    print_summary(monsters, EXCLUSIONS, FAILED_OFFSET_FIELDS)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
