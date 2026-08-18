#!/usr/bin/env -S uv run --script
# ABOUTME: Emits data/skill-items.json and data/skill-items-stats.json, the committed
# ABOUTME: datasets behind the /items/ page. Reads the derived parquet only.
# /// script
# requires-python = ">=3.10"
# dependencies = ["duckdb", "lzstring"]
# ///
import argparse
import gzip
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build_deposit import open_deposit, read_meta, register_derived  # noqa: E402
from gditems_core import grimtools_url  # noqa: E402

DOMAINS = ("gear", "relic", "augment")


def rows(con, sql, params=None):
    cur = con.execute(sql, params or [])
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def conversion_type_tags(stat_tags: dict) -> dict:
    """Game tag for each damage-type token a conversionPercentage names.

    `conversionInType`/`conversionOutType` hold GD's internal damage-type names
    (`Fire`, `Life`, `Poison`), which are not game tags. Shipping them raw would put
    an English word on the card in every language, and the one that does happen to
    resolve as a tag resolves to the wrong thing: GD's internal `Life` is the
    player-facing Vitality, while a bare `Life` tag is "Health".

    data/stat-tags.json already carries exactly this vocabulary as
    `stat.damage.<token>`, mapped to the tag the devotion planner labels the same
    damage type with (Life -> tagCharStatsVitality, Poison -> tagCharStatsAcid), so
    this reuses it rather than restating it. Every one of those tags is already
    resolved into every locale table by `just i18n-tables`, which is handed the same
    file, so naming conversions this way adds no tag that needs translating.
    """
    return {k[len("stat.damage."):]: v for k, v in stat_tags.items()
            if k.startswith("stat.damage.")}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Emit the /items/ page dataset")
    ap.add_argument("--deposit-dir", required=True, type=Path)
    ap.add_argument("--derived-dir", required=True, type=Path)
    ap.add_argument("--stat-tags", required=True, type=Path,
                    help="data/stat-tags.json, for the conversion damage-type tags")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--out-stats", required=True, type=Path)
    args = ap.parse_args(argv)

    conv_tags = conversion_type_tags(
        json.loads(args.stat_tags.read_text(encoding="utf-8")))

    con = open_deposit(args.deposit_dir.resolve())
    if not register_derived(con, args.derived_dir.resolve(), True):
        return 2
    meta = read_meta(con)

    # Top tier per family: the page targets endgame, so each group_key
    # contributes only its highest item level. About 97 families tie at that
    # level - typically an Awakened/Legendary variant against a plain Epic
    # one sharing a name tag (e.g. tagGDX1HeadC122 at level 94) - so without a
    # tiebreaker DuckDB's choice of surviving row is unspecified and could
    # churn between runs on unchanged input. Rarity breaks the tie toward the
    # higher-tier item this endgame page is for; record is a final tiebreaker
    # purely so the output is reproducible, not because it means anything.
    #
    # en_name resolves entities.name_tag to its English label. This is joined
    # here ONLY to build the outbound grimtools link below: grimtools matches
    # item names in English, not by tag, and there is no way around that. It
    # does not violate the i18n invariant - the emitted dataset still stores
    # name_tag (a tag, resolved to the viewer's locale by the page) for every
    # display purpose; only the URL string embeds English text.
    con.execute(f"""
        CREATE TEMP TABLE top AS
        WITH hit AS (
            SELECT e.*, l.text AS en_name
            FROM entities e
            LEFT JOIN labels l ON l.tag = e.name_tag AND l.locale = 'en'
            WHERE e.domain IN {DOMAINS}
              AND (e.record IN (SELECT record FROM boosts)
                OR e.record IN (SELECT item_record FROM skill_modifiers))
        ),
        ranked AS (
            SELECT *, row_number() OVER (PARTITION BY group_key
                                         ORDER BY item_level DESC,
                                                  CASE rarity WHEN 'Legendary' THEN 4
                                                              WHEN 'Epic' THEN 3
                                                              WHEN 'Rare' THEN 2
                                                              ELSE 1 END DESC,
                                                  record ASC) AS rn
            FROM hit
        )
        SELECT * FROM ranked WHERE rn = 1""")

    masteries = rows(con, """
        SELECT DISTINCT s.mastery_record AS record,
               (SELECT f.value FROM facts f
                 WHERE f.record = s.mastery_record AND f.key = 'skillDisplayName')
                 AS name_tag
        FROM skills s ORDER BY 1""")

    ranks_by_skill = {}
    for r in rows(con, "SELECT * FROM skill_ranks ORDER BY skill_record, stat_id"):
        ranks_by_skill.setdefault(r["skill_record"], []).append(
            {"stat": r["stat_id"], "first": r["at_first"],
             "max": r["at_max"], "ultimate": r["at_ultimate"]})

    # A summon skill's own record says almost nothing (Summon Hellhound carries a
    # mana cost, a cooldown and a pet cap), so its panel is the pet: the creature's
    # own resistances plus the rank-scaled abilities it is granted. The pet's name
    # comes off its `description` tag and an ability's off the same walk that names
    # every other skill; both are NULL where the game has no name, which the page
    # renders as an unlabelled block rather than inventing one.
    pets_by_skill = {}
    for r in rows(con, """
            SELECT p.skill_record, p.pet_record, p.source_kind, p.source_record,
                   p.stat_id, p.at_first, p.at_max, p.at_ultimate,
                   (SELECT f.value FROM facts f
                     WHERE f.record = p.pet_record AND f.key = 'description')
                     AS pet_name_tag,
                   (SELECT f.value FROM facts f
                     JOIN skill_effect e ON e.effect_record = f.record
                    WHERE e.skill_record = p.source_record
                      AND f.key = 'skillDisplayName') AS source_name_tag
            FROM pet_ranks p
            ORDER BY p.skill_record, p.pet_record, p.source_kind, p.source_record,
                     p.stat_id"""):
        by_pet = pets_by_skill.setdefault(r["skill_record"], {})
        pet = by_pet.setdefault(r["pet_record"],
                                {"record": r["pet_record"],
                                 "name_tag": r["pet_name_tag"], "stats": []})
        pet["stats"].append({
            "source_kind": r["source_kind"], "source": r["source_record"],
            "source_name_tag": r["source_name_tag"], "stat": r["stat_id"],
            "first": r["at_first"], "max": r["at_max"], "ultimate": r["at_ultimate"],
        })

    skills = []
    for s in rows(con, "SELECT * FROM skills ORDER BY mastery_record, record"):
        skills.append({
            "record": s["record"], "mastery": s["mastery_record"],
            "group": s["group_record"], "node_kind": s["node_kind"],
            "ui_x": s["ui_x"], "ui_y": s["ui_y"], "name_tag": s["name_tag"],
            "icon": s["icon"], "max_level": s["max_level"],
            "ultimate_level": s["ultimate_level"],
            "ranks": ranks_by_skill.get(s["record"], []),
            "pets": list(pets_by_skill.get(s["record"], {}).values()),
        })

    def group(sql, key):
        out = {}
        for r in rows(con, sql):
            out.setdefault(r[key], []).append(r)
        return out

    boosts = group("""SELECT b.record, b.target, b.level, b.kind
                      FROM boosts b JOIN top t ON t.record = b.record
                      ORDER BY b.record, b.target""", "record")
    # modifier_record is in the sort key, not the output: one item can attach two
    # different carriers to the same skill and both can name the same stat with
    # different values (Bloodlord's Blade gives Possession skillCooldownReduction
    # 100 on the chance-gated reset carrier and 5 on the flat one), so the pair is
    # kept, and without the record in the sort their order is not determined.
    mods = group("""SELECT m.item_record, m.modified_skill, m.stat_id, m.value,
                           m.from_type, m.to_type, m.refresh_skill, m.refresh_trigger
                    FROM skill_modifiers m JOIN top t ON t.record = m.item_record
                    ORDER BY m.item_record, m.modified_skill, m.modifier_record,
                             m.stat_id""", "item_record")
    # A damage type with no stat.damage.* entry would ship as a missing label, so a
    # patch that adds a conversion type fails the run instead of half-naming a card.
    unmapped = sorted({t for rs in mods.values() for r in rs
                       for t in (r["from_type"], r["to_type"])
                       if t is not None and t not in conv_tags})
    if unmapped:
        print(f"ERROR: conversion damage types absent from stat-tags.json: "
              f"{', '.join(unmapped)}", file=sys.stderr)
        return 2
    stats = group("""SELECT s.record, s.stat_id, s.source, s.display_low, s.display_high,
                            s.value_min, s.value_max
                     FROM stats s JOIN top t ON t.record = s.record
                     ORDER BY s.record, s.source, s.stat_id""", "record")
    # A family is a ladder of item levels (20/40/55/70/84/94), one rung per tier.
    # Several families hold more than one record at the same level (an Awakened
    # copy beside its plain one), and listing every record repeats that rung.
    tiers = group("""SELECT DISTINCT e.group_key, e.item_level FROM entities e
                     WHERE e.group_key IN (SELECT group_key FROM top)
                     ORDER BY e.group_key, e.item_level""", "group_key")

    items = []
    stats_by_record = {}
    for t in rows(con, "SELECT * FROM top ORDER BY record"):
        rec = t["record"]
        by_skill = {}
        for m in mods.get(rec, []):
            stat = {"stat": m["stat_id"], "value": m["value"]}
            # A conversion percentage reads as a bare number without the pair of
            # damage types it converts between, so those ride along on the rows
            # that have them and are absent everywhere else. They ship as game
            # tags, not as the raw GD type tokens: see conversion_type_tags.
            if m["from_type"] is not None:
                stat["from_tag"] = conv_tags[m["from_type"]]
                stat["to_tag"] = conv_tags[m["to_type"]]
            # A refresh amount reads as a bare number without the skill it targets
            # and the trigger that fires it. The target is frequently a different
            # skill from the block's own (Badge of the Crimson Company sits on
            # Cadence and reduces Leap), so it cannot be inferred at read time.
            if m["refresh_skill"] is not None:
                stat["refresh_skill"] = m["refresh_skill"]
            if m["refresh_trigger"] is not None:
                stat["refresh_trigger"] = m["refresh_trigger"]
            by_skill.setdefault(m["modified_skill"], []).append(stat)
        name = t.get("name_tag")
        en_name = t.get("en_name")
        stats_by_record[rec] = [
            {"stat": s["stat_id"], "source": s["source"],
             "low": s["display_low"] if s["display_low"] is not None
                    else s["value_min"],
             "high": s["display_high"] if s["display_high"] is not None
                     else s["value_max"]}
            for s in stats.get(rec, [])]
        items.append({
            "record": rec,
            "name_tag": name,
            "domain": t["domain"],
            "slots": list(t["slots"]) if t["slots"] else [],
            "rarity": t["rarity"],
            "item_level": t["item_level"],
            "tiers": [r["item_level"] for r in tiers.get(t["group_key"], [])],
            "grimtools": grimtools_url(en_name, t["item_level"]) if en_name else None,
            "boosts": [{"skill": b["target"], "level": b["level"]}
                       for b in boosts.get(rec, []) if b["kind"] == "skill"],
            "mastery_boosts": [{"mastery": b["target"], "level": b["level"]}
                               for b in boosts.get(rec, []) if b["kind"] == "mastery"],
            "modifiers": [{"skill": k, "stats": v} for k, v in sorted(by_skill.items())],
        })

    doc_meta = {
        "game_version": meta.get("game_version", ""),
        "steam_buildid": meta.get("steam_buildid", ""),
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    doc = {
        "meta": doc_meta,
        "masteries": masteries,
        "skills": skills,
        "items": items,
    }
    # Per-item stats live in a second, lazily loaded file: the table view
    # needs name/slot/boosts/modifiers, not the full stat-row detail, and
    # that detail was most of the file (1.9 of 3.9 MB compact).
    stats_doc = {
        "meta": doc_meta,
        "stats": stats_by_record,
    }
    args.out.write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")
    args.out_stats.write_text(json.dumps(stats_doc, indent=1) + "\n", encoding="utf-8")
    size_kb = args.out.stat().st_size / 1024
    stats_size_kb = args.out_stats.stat().st_size / 1024
    print(f"Wrote {args.out}  ({len(items)} items, {len(skills)} skills, {size_kb:.1f} KB)")
    print(f"Wrote {args.out_stats}  ({len(stats_by_record)} item stat entries, "
          f"{stats_size_kb:.1f} KB)")
    # Budget the transfer size, not the file size: these datasets are served gzipped,
    # and the accepted split (docs/superpowers/specs/2026-08-15-skill-item-finder-page-design.md)
    # was sized in gzipped terms. Warning on raw bytes fired on every successful run.
    gz_kb = len(gzip.compress(args.out.read_bytes())) / 1024
    print(f"  first load: {gz_kb:.1f} KB gzipped")
    if gz_kb > 400:
        print(f"WARNING: {gz_kb:.1f} KB gzipped is well past the ~242 KB the split was "
              f"sized for; consider what else belongs in the lazily-fetched stats file",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
