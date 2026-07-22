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
from gd_dbr import DB, level_array_value, load_translations, register  # noqa: E402,F401

import re  # noqa: E402

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
    return register(tag or f"x:rr:{rec_path}", text, game_en)


def _ultimate(rec):
    v = rec.get("skillUltimateLevel", "").strip()
    try:
        return int(float(v)) if v else None
    except ValueError:
        return None


def _num(s):
    s = (s or "").strip()
    if not s or ";" in s:
        return None
    try:
        f = round(float(s), 4)
        return int(f) if f == int(f) else f
    except ValueError:
        return None


def source_from_offensive(db, tags, game_en, rec_path, rec, field, rr_type, token):
    arr = parse_array(rec[field])
    ult = _ultimate(rec)
    base = field[:-len("Min")]  # e.g. offensiveElementalResistanceReductionAbsolute
    dur = rec.get(base + "DurationMin", "").strip()
    chance = rec.get(base + "Chance", "").strip()
    return {
        "id": rec_path.replace("/", ":").removesuffix(".dbr") + f":{rr_type}",
        "name": _name_descriptor(rec, rec_path, tags, game_en),
        "parent": None,   # filled by category/parent pass (Task 6)
        "record_path": rec_path,
        "category": None,  # Task 6
        "rr_type": rr_type,
        "resistances": token_to_resistances(token),
        "values_per_rank": arr,
        "max_rank": len(arr),
        "ultimate_rank": ult,
        "value_at_max": arr[-1] if arr else None,
        "value_at_ultimate": level_array_value(rec[field], ult) if ult else None,
        "duration_seconds": _num(dur),
        "cooldown_seconds": _num(rec.get("skillCooldownTime", "")),
        "trigger_chance_percent": _num(chance),
        "trigger": None,   # Task 6 classification
        "per_resistance_values": None,
        "notes": "",
    }


def collect_sources(db: DB, tags: dict[str, str], game_en: dict[str, str]) -> list[dict]:
    """Sweep the extraction and return one dict per RR source."""
    sources: list[dict] = []
    for rec_path, rec in iter_skill_records(db):
        for field in rec:
            hit = classify_offensive_field(field)
            if hit:
                rr_type, token = hit
                sources.append(
                    source_from_offensive(db, tags, game_en, rec_path, rec, field, rr_type, token))
    return sources


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
