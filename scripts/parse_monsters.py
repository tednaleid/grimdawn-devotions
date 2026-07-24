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
