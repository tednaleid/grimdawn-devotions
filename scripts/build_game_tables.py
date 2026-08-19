#!/usr/bin/env -S uv run --script
# ABOUTME: Builds data/i18n/game.<lang>.json: tag -> text for every game tag devotions.json,
# ABOUTME: stat-tags.json, resistance-reduction.json, and monsters.json reference. One run per language.
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


# Tags the /items/ effect formatter composes with, rather than any dataset naming them.
# The game builds a stat line from a label tag plus one of these, so reproducing its
# wording means shipping them to every locale. See the effect-text section of
# docs/superpowers/specs/2026-08-17-items-page-design.md.
COMPOSER_TAGS = frozenset({
    # Damage-over-time and range suffixes ("over 2 Seconds").
    "DamageSingleFormatTime", "DamageRangeFormatTime",
    "DamageFixedSingleFormatTime", "DamageFixedRangeFormatTime",
    # Value-plus-label composers for the 32 tags that carry no template of their own.
    "SkillSecondFormat", "SkillDistanceFormat", "SkillCostFormat",
    "SkillPercentFormat", "SkillIntFormat", "SkillFloatFormat",
    # Pluralized units, selected by the composition site against its value.
    "tagSecond", "tagSeconds",
    # The refresh families' composed lines. The *Name variant is chosen when the
    # record names a target skill; the *Max variant when it also carries a cap
    # (refreshDuration only - 23 of its 29 blocks; refreshCooldown never does).
    "tagSkillCooldownRefresh", "tagSkillCooldownRefreshName",
    "tagSkillDurationRefresh", "tagSkillDurationRefreshName",
    "tagSkillDurationRefreshMax", "tagSkillDurationRefreshNameMax",
} | {f"tagRefreshSkillCondition{n:02d}" for n in range(1, 13)})

# The /items/ page's gear-category chips. The game groups weapons this way in its own
# loot filter, and each of the 13 weapon gear_types falls into exactly one of these
# (the game's own help text confirms the grouping: tagLootFilter10Info reads
# "Two-handed Axes, Maces, Spears and Swords" against axe2h/mace2h/spear2h/sword2h).
# Shipping the game's tags rather than our own strings means the categories are already
# translated everywhere. No dataset names them, so they are listed here.
# See the gear category table in web/src/items/core/facets.ts.
FACET_TAGS = frozenset({f"tagLootFilter{n:02d}" for n in range(9, 16)})


def collect_referenced_tags(
    devotions: dict, stat_tags: dict, stat_format_tags: dict | None = None,
    rr: dict | None = None, monsters: dict | None = None,
    skill_items: dict | None = None, stat_item_tags: dict | None = None
) -> set[str]:
    """Every *_tag value referenced in devotions.json (constellation/power/pet/weapon),
    plus every game tag value in stat-tags.json, stat-format-tags.json and
    stat-item-tags.json, plus the
    name/parent tags of every resistance-reduction source, plus the name and race tags
    of every monster in monsters.json. RR sources whose name/parent could not resolve to
    a real tag carry a synthesized x: placeholder (no game text exists), so only
    tag-prefixed values are collected. A monster with no resolvable race carries a null
    race_tag, which _add skips. skill-items contributes the name tags of its masteries,
    skills and items, plus the pet name and pet-ability name tags a summon skill's panel
    renders; a nameless item or an unnamed pet ability carries a null tag, which _add
    also skips. Always also includes COMPOSER_TAGS, the formatter's grammar tags, and
    FACET_TAGS, the /items/ page's gear-category chip labels."""
    tags: set[str] = set()
    for c in devotions.get("constellations", []):
        _add(tags, c.get("name_tag"))
        _add(tags, c.get("description_tag"))
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
    for s in (rr or {}).get("sources", []):
        for key in (s.get("name"), s.get("parent")):
            if key and key.startswith("tag"):
                tags.add(key)
    for m in (monsters or {}).get("monsters", []):
        _add(tags, m.get("name_tag"))
        _add(tags, m.get("race_tag"))
    # A set's name_tag rides in with the rest: it captions the "<set> (N pieces)"
    # block an item's set bonus renders under.
    for key in ("masteries", "skills", "items", "sets"):
        for row in (skill_items or {}).get(key, []):
            _add(tags, row.get("name_tag"))
    # The skill's own prose, shown on the tree's hover card.
    for skill in (skill_items or {}).get("skills", []):
        _add(tags, skill.get("description_tag"))
    for skill in (skill_items or {}).get("skills", []):
        for pet in skill.get("pets", []):
            _add(tags, pet.get("name_tag"))
            for stat in pet.get("stats", []):
                _add(tags, stat.get("source_name_tag"))
    tags.update(stat_tags.values())
    tags.update((stat_format_tags or {}).values())
    tags.update((stat_item_tags or {}).values())
    tags.update(COMPOSER_TAGS)
    tags.update(FACET_TAGS)
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
    ap.add_argument("--stat-format-tags", type=Path,
                    help="Optional stat-format-tags.json (raw stat id -> value-embedded game tag)")
    ap.add_argument("--rr", type=Path,
                    help="Optional resistance-reduction.json (adds its source name/parent tags)")
    ap.add_argument("--monsters", type=Path,
                    help="Optional monsters.json (adds its monster name + race tags)")
    ap.add_argument("--skill-items", type=Path,
                    help="Optional skill-items.json (adds its mastery, skill, item, "
                         "pet and pet-ability name tags)")
    ap.add_argument("--stat-item-tags", type=Path,
                    help="Optional stat-item-tags.json (raw item/skill stat id -> game tag)")
    ap.add_argument("--text-dir", required=True, type=Path)
    ap.add_argument("--lang", required=True, help="Language code, e.g. en (used only for logging)")
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args(argv)

    devotions = json.loads(args.devotions.read_text(encoding="utf-8"))
    stat_tags = json.loads(args.stat_tags.read_text(encoding="utf-8"))
    stat_format_tags = json.loads(args.stat_format_tags.read_text(encoding="utf-8")) if args.stat_format_tags else {}
    rr = json.loads(args.rr.read_text(encoding="utf-8")) if args.rr else {}
    monsters = json.loads(args.monsters.read_text(encoding="utf-8")) if args.monsters else {}
    skill_items = json.loads(args.skill_items.read_text(encoding="utf-8")) if args.skill_items else {}
    stat_item_tags = json.loads(args.stat_item_tags.read_text(encoding="utf-8")) if args.stat_item_tags else {}
    referenced = collect_referenced_tags(devotions, stat_tags, stat_format_tags, rr,
                                         monsters, skill_items, stat_item_tags)

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
