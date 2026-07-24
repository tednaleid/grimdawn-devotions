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
