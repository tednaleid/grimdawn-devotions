#!/usr/bin/env -S uv run --script
# ABOUTME: Emits data/skill-items.json, the committed dataset behind the /items/ page.
# ABOUTME: Reads the derived parquet only; needs no game install.
# /// script
# requires-python = ">=3.10"
# dependencies = ["duckdb", "lzstring"]
# ///
import argparse
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


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Emit the /items/ page dataset")
    ap.add_argument("--deposit-dir", required=True, type=Path)
    ap.add_argument("--derived-dir", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args(argv)

    con = open_deposit(args.deposit_dir.resolve())
    if not register_derived(con, args.derived_dir.resolve(), True):
        return 2
    meta = read_meta(con)

    # Top tier per family: the page targets endgame, so each group_key
    # contributes only its highest item level.
    con.execute(f"""
        CREATE TEMP TABLE top AS
        WITH hit AS (
            SELECT e.* FROM entities e
            WHERE e.domain IN {DOMAINS}
              AND (e.record IN (SELECT record FROM boosts)
                OR e.record IN (SELECT item_record FROM skill_modifiers))
        ),
        ranked AS (
            SELECT *, row_number() OVER (PARTITION BY group_key
                                         ORDER BY item_level DESC) AS rn
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

    skills = []
    for s in rows(con, "SELECT * FROM skills ORDER BY mastery_record, record"):
        skills.append({
            "record": s["record"], "mastery": s["mastery_record"],
            "group": s["group_record"], "node_kind": s["node_kind"],
            "ui_x": s["ui_x"], "ui_y": s["ui_y"], "name_tag": s["name_tag"],
            "icon": s["icon"], "max_level": s["max_level"],
            "ultimate_level": s["ultimate_level"],
            "ranks": ranks_by_skill.get(s["record"], []),
        })

    def group(sql, key):
        out = {}
        for r in rows(con, sql):
            out.setdefault(r[key], []).append(r)
        return out

    boosts = group("""SELECT b.record, b.target, b.level, b.kind
                      FROM boosts b JOIN top t ON t.record = b.record
                      ORDER BY b.record, b.target""", "record")
    mods = group("""SELECT m.item_record, m.modified_skill, m.stat_id, m.value
                    FROM skill_modifiers m JOIN top t ON t.record = m.item_record
                    ORDER BY m.item_record, m.modified_skill, m.stat_id""", "item_record")
    stats = group("""SELECT s.record, s.stat_id, s.source, s.display_low, s.display_high,
                            s.value_min, s.value_max
                     FROM stats s JOIN top t ON t.record = s.record
                     ORDER BY s.record, s.source, s.stat_id""", "record")
    tiers = group("""SELECT e.group_key, e.item_level FROM entities e
                     WHERE e.group_key IN (SELECT group_key FROM top)
                     ORDER BY e.group_key, e.item_level""", "group_key")

    items = []
    for t in rows(con, "SELECT * FROM top ORDER BY record"):
        rec = t["record"]
        by_skill = {}
        for m in mods.get(rec, []):
            by_skill.setdefault(m["modified_skill"], []).append(
                {"stat": m["stat_id"], "value": m["value"]})
        name = t.get("name_tag")
        items.append({
            "record": rec,
            "name_tag": name,
            "domain": t["domain"],
            "slots": list(t["slots"]) if t["slots"] else [],
            "rarity": t["rarity"],
            "item_level": t["item_level"],
            "tiers": [r["item_level"] for r in tiers.get(t["group_key"], [])],
            "grimtools": grimtools_url(name, t["item_level"]) if name else None,
            "boosts": [{"skill": b["target"], "level": b["level"]}
                       for b in boosts.get(rec, []) if b["kind"] == "skill"],
            "mastery_boosts": [{"mastery": b["target"], "level": b["level"]}
                               for b in boosts.get(rec, []) if b["kind"] == "mastery"],
            "modifiers": [{"skill": k, "stats": v} for k, v in sorted(by_skill.items())],
            "stats": [{"stat": s["stat_id"], "source": s["source"],
                       "low": s["display_low"] if s["display_low"] is not None
                              else s["value_min"],
                       "high": s["display_high"] if s["display_high"] is not None
                               else s["value_max"]}
                      for s in stats.get(rec, [])],
        })

    doc = {
        "meta": {
            "game_version": meta.get("game_version", ""),
            "steam_buildid": meta.get("steam_buildid", ""),
            "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "masteries": masteries,
        "skills": skills,
        "items": items,
    }
    args.out.write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")
    size_kb = args.out.stat().st_size / 1024
    print(f"Wrote {args.out}  ({len(items)} items, {len(skills)} skills, {size_kb:.1f} KB)")
    if size_kb > 1400:
        print(f"WARNING: {size_kb:.1f} KB exceeds the 1.2 MB monsters.json reference",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
