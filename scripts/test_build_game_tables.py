#!/usr/bin/env -S uv run --script
# ABOUTME: Tests for build_game_tables: referenced-tag collection, resolution, and omission of misses.
# ABOUTME: Run with `uv run scripts/test_build_game_tables.py`. Stdlib-only, no framework.
# /// script
# requires-python = ">=3.10"
# ///
import importlib.util
import json
import tempfile
from pathlib import Path

here = Path(__file__).parent
spec = importlib.util.spec_from_file_location("bgt", here / "build_game_tables.py")
bgt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bgt)

failures = 0
def check(name, got, want):
    global failures
    if got != want:
        failures += 1
        print(f"  FAIL {name}: got {got!r}, want {want!r}")
    else:
        print(f"  ok   {name}")

# --- collect_referenced_tags: every *_tag across constellations/powers/pets/weapons + stat-tags values
devotions = {
    "constellations": [
        {
            "name_tag": "tagConA",
            "stars": [
                {
                    "celestial_power": {
                        "name_tag": "tagPowerName",
                        "description_tag": "tagPowerDesc",
                        "pet": {"name_tag": "tagPetName"},
                    },
                    "weapon_requirement": {"description_tag": "tagWeaponDesc"},
                },
                {"celestial_power": None, "weapon_requirement": None},
            ],
        }
    ]
}
stat_tags = {"stat.attr.DefensiveAbility": "tagCharStatsDA", "stat.attr.Life": "Life"}

referenced = bgt.collect_referenced_tags(devotions, stat_tags)
check("collects constellation name_tag", "tagConA" in referenced, True)
check("collects power name_tag", "tagPowerName" in referenced, True)
check("collects power description_tag", "tagPowerDesc" in referenced, True)
check("collects pet name_tag", "tagPetName" in referenced, True)
check("collects weapon description_tag", "tagWeaponDesc" in referenced, True)
check("collects stat-tags values", {"tagCharStatsDA", "Life"} <= referenced, True)
check("referenced tag count", len(referenced), 7)

# --- build_table: resolves against a text table, cleans control codes, omits unresolved tags
text_table = {
    "tagConA": "^oConstellation A^n",
    "tagPowerName": "Power Name",
    "tagPowerDesc": "{^y}Power Desc",
    "tagPetName": "Pet Name",
    "tagWeaponDesc": "Weapon Desc",
    "tagCharStatsDA": "Defensive Ability",
    # "Life" and "tagUnresolved" deliberately absent from the text table
}
table = bgt.build_table(referenced, text_table)
check("resolves + cleans control codes", table.get("tagConA"), "Constellation A")
check("resolves plain tag", table.get("tagPowerName"), "Power Name")
check("strips brace control code", table.get("tagPowerDesc"), "Power Desc")
check("unresolved referenced tag omitted", "Life" in table, False)
check("table size = resolved only", len(table), 6)

# --- end-to-end via main(): fake devotions.json / stat-tags.json / text-dir on disk
with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    dev_path = tmp / "devotions.json"
    dev_path.write_text(json.dumps(devotions), encoding="utf-8")
    stat_path = tmp / "stat-tags.json"
    stat_path.write_text(json.dumps(stat_tags), encoding="utf-8")
    text_dir = tmp / "text"
    text_dir.mkdir()
    (text_dir / "tags.txt").write_text(
        "\n".join(f"{k}={v}" for k, v in text_table.items()), encoding="utf-8"
    )
    out_path = tmp / "game.en.json"

    rc = bgt.main([
        "--devotions", str(dev_path),
        "--stat-tags", str(stat_path),
        "--text-dir", str(text_dir),
        "--lang", "en",
        "--out", str(out_path),
    ])
    check("main() exits 0", rc, 0)
    written = json.loads(out_path.read_text(encoding="utf-8"))
    check("main() writes resolved tags only", written, table)
    check("main() omits unresolved referenced tag", "Life" in written, False)

print("ALL PASSED" if failures == 0 else f"{failures} FAILURE(S)")
raise SystemExit(1 if failures else 0)
