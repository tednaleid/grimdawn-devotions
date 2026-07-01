#!/usr/bin/env -S uv run --script
# ABOUTME: Builds data/i18n/game.<lang>.json: tag -> text for every game tag devotions.json and
# ABOUTME: stat-tags.json reference. Language-independent; run once per language (see justfile `parse`).
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Build a per-language game text table (game.<lang>.json) for the web app's gameText lookup.

Separate from parse_devotions.py because: (a) it must also cover the stat tags in
data/stat-tags.json, which the parser never sees, and (b) later phases build this
table for many languages by re-running against each language's extracted text
directory - re-running the parser itself per language would corrupt its
slugify(English name) ids. This script only reads devotions.json/stat-tags.json,
never re-derives ids from them.

Tags that do not resolve in a language's text table are simply omitted; the web
app's gameText falls back to English at runtime for those.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from parse_devotions import clean_text, load_translations  # reuse the parser's text-table reader


def _add(tags: set[str], tag: str | None) -> None:
    if tag:
        tags.add(tag)


def collect_referenced_tags(devotions: dict, stat_tags: dict) -> set[str]:
    """Every *_tag value referenced in devotions.json (constellation/power/pet/weapon),
    plus every game tag value in stat-tags.json."""
    tags: set[str] = set()
    for c in devotions.get("constellations", []):
        _add(tags, c.get("name_tag"))
        for s in c.get("stars", []):
            cp = s.get("celestial_power")
            if cp:
                _add(tags, cp.get("name_tag"))
                _add(tags, cp.get("description_tag"))
                pet = cp.get("pet")
                if pet:
                    _add(tags, pet.get("name_tag"))
            wr = s.get("weapon_requirement")
            if wr:
                _add(tags, wr.get("description_tag"))
    tags.update(stat_tags.values())
    return tags


def build_table(referenced: set[str], text_table: dict[str, str]) -> dict[str, str]:
    """{tag: cleaned text} for every referenced tag that resolves in text_table."""
    out: dict[str, str] = {}
    for tag in referenced:
        raw = text_table.get(tag)
        if raw:
            out[tag] = clean_text(raw)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="Build a per-language game text table (tag -> text) for devotion + stat tags")
    ap.add_argument("--devotions", required=True, type=Path)
    ap.add_argument("--stat-tags", required=True, type=Path)
    ap.add_argument("--text-dir", required=True, type=Path)
    ap.add_argument("--lang", required=True, help="Language code, e.g. en (used only for logging)")
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args(argv)

    devotions = json.loads(args.devotions.read_text(encoding="utf-8"))
    stat_tags = json.loads(args.stat_tags.read_text(encoding="utf-8"))
    referenced = collect_referenced_tags(devotions, stat_tags)

    text_table = load_translations(args.text_dir)
    table = build_table(referenced, text_table)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(table, indent=2, ensure_ascii=False, sort_keys=True), encoding="utf-8")

    resolved = len(table)
    omitted = len(referenced) - resolved
    print(f"[{args.lang}] referenced tags: {len(referenced)}, resolved: {resolved}, omitted: {omitted}")
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
