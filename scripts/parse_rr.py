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
from gd_dbr import DB, load_translations, register  # noqa: E402,F401


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
