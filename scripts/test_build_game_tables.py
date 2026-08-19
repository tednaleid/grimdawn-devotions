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
assert spec and spec.loader
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
            "description_tag": "tagConDesc",
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

stat_format_tags = {"defensiveConvert": "DefenseConvert"}

referenced = bgt.collect_referenced_tags(devotions, stat_tags, stat_format_tags)
check("collects constellation name_tag", "tagConA" in referenced, True)
check("collects constellation description_tag", "tagConDesc" in referenced, True)
check("collects power name_tag", "tagPowerName" in referenced, True)
check("collects power description_tag", "tagPowerDesc" in referenced, True)
check("collects pet name_tag", "tagPetName" in referenced, True)
check("collects weapon description_tag", "tagWeaponDesc" in referenced, True)
check("collects stat-tags values", {"tagCharStatsDA", "Life"} <= referenced, True)
check("collects stat-format-tags values", "DefenseConvert" in referenced, True)
check("collects COMPOSER_TAGS", bgt.COMPOSER_TAGS <= referenced, True)
check("collects FACET_TAGS", bgt.FACET_TAGS <= referenced, True)
check("referenced tag count", len(referenced),
      9 + len(bgt.COMPOSER_TAGS) + len(bgt.FACET_TAGS))
check("collect works without stat-format-tags", "tagConA" in bgt.collect_referenced_tags(devotions, stat_tags), True)

# --- rr sources: tag-prefixed name/parent collected; synthesized x: keys skipped ---
rr = {"sources": [
    {"name": "tagClass04SkillName07B", "parent": "tagDevotion_A13"},
    {"name": "x:rr:records/skills/foo.dbr", "parent": "x:rritem:records/items/bar.dbr"},
]}
ref_rr = bgt.collect_referenced_tags(devotions, stat_tags, stat_format_tags, rr)
check("collects rr name tag", "tagClass04SkillName07B" in ref_rr, True)
check("collects rr parent tag", "tagDevotion_A13" in ref_rr, True)
check("skips synthesized rr keys", any(t.startswith("x:") for t in ref_rr), False)

# --- build_table: resolves against a text table, cleans control codes, omits unresolved tags
text_table = {
    "tagConA": "^oConstellation A^n",
    "tagConDesc": "Constellation A flavour text.",
    "tagPowerName": "Power Name",
    "tagPowerDesc": "{^y}Power Desc",
    "tagPetName": "Pet Name",
    "tagWeaponDesc": "Weapon Desc",
    "tagCharStatsDA": "Defensive Ability",
    # "Life" and "tagUnresolved" deliberately absent from the text table
}
table = bgt.build_table(referenced, text_table)
check("resolves + cleans control codes", table.get("tagConA"), "Constellation A")
check("resolves constellation description_tag", table.get("tagConDesc"), "Constellation A flavour text.")
check("resolves plain tag", table.get("tagPowerName"), "Power Name")
check("strips brace control code", table.get("tagPowerDesc"), "Power Desc")
check("unresolved referenced tag omitted", "Life" in table, False)
check("table size = resolved only", len(table), 7)

# --- end-to-end via main(): fake devotions.json / stat-tags.json / text-dir on disk
with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    dev_path = tmp / "devotions.json"
    dev_path.write_text(json.dumps(devotions), encoding="utf-8")
    stat_path = tmp / "stat-tags.json"
    stat_path.write_text(json.dumps(stat_tags), encoding="utf-8")
    fmt_path = tmp / "stat-format-tags.json"
    fmt_path.write_text(json.dumps(stat_format_tags), encoding="utf-8")
    text_dir = tmp / "text"
    text_dir.mkdir()
    (text_dir / "tags.txt").write_text(
        "\n".join(f"{k}={v}" for k, v in text_table.items()), encoding="utf-8"
    )
    out_path = tmp / "game.en.json"

    rc = bgt.main([
        "--devotions", str(dev_path),
        "--stat-tags", str(stat_path),
        "--stat-format-tags", str(fmt_path),
        "--text-dir", str(text_dir),
        "--lang", "en",
        "--out", str(out_path),
    ])
    check("main() exits 0", rc, 0)
    written = json.loads(out_path.read_text(encoding="utf-8"))
    check("main() writes resolved tags only", written, table)
    check("main() omits unresolved referenced tag", "Life" in written, False)

# --- monster name + race tags are collected ---
monsters_doc = {"monsters": [
    {"id": "enemies.x", "name_tag": "tagMonsterX", "race_tag": "tagRace005"},
    {"id": "enemies.y", "name_tag": "tagMonsterY", "race_tag": None},
]}
mon_refs = bgt.collect_referenced_tags({}, {}, {}, {}, monsters_doc)
check("monster name tags collected", {"tagMonsterX", "tagMonsterY"} <= mon_refs, True)
check("monster race tag collected", "tagRace005" in mon_refs, True)
check("a null race tag is skipped", None in mon_refs, False)
check("monsters argument is optional",
      isinstance(bgt.collect_referenced_tags({}, {}, {}, {}), set), True)

# --- skill-items: mastery, skill and item name tags are collected ---
skill_items_doc = {
    "masteries": [{"record": "records/skills/playerclass03/_classtraining_class03.dbr",
                   "name_tag": "tagClass03SkillName00"}],
    "skills": [{"record": "records/skills/playerclass03/summon_hellhound1.dbr",
                "name_tag": "tagClass03SkillName02A",
                "pets": [{"record": "records/skills/playerclass03/pets/pet_hellhound_a01.dbr",
                          "name_tag": "tagPetHellhoundA01",
                          "stats": [{"source_name_tag": "tagClass03SkillName02E"},
                                    {"source_name_tag": None}]}]},
               {"record": "records/skills/nameless.dbr", "name_tag": None}],
    "items": [{"record": "records/items/gearhead/b201f_head.dbr",
               "name_tag": "tagGDX2HeadB201"}],
}
tags = bgt.collect_referenced_tags({}, {}, {}, {}, {}, skill_items_doc)
check("skill-items contributes mastery name tags", "tagClass03SkillName00" in tags, True)
check("skill-items contributes skill name tags", "tagClass03SkillName02A" in tags, True)
check("skill-items contributes item name tags", "tagGDX2HeadB201" in tags, True)
check("skill-items contributes pet name tags", "tagPetHellhoundA01" in tags, True)
check("skill-items contributes pet ability name tags",
      "tagClass03SkillName02E" in tags, True)
check("a null name_tag is skipped, not added", None not in tags, True)

# --- stat-item-tags: the raw stat id -> game tag map contributes its tag values ---
stat_item_tags = {"offensiveFireMin": "DamageFire", "characterStrength": "tagCharAttribute02"}
item_tag_refs = bgt.collect_referenced_tags({}, {}, {}, {}, {}, {}, stat_item_tags)
check("stat-item-tags values collected",
      item_tag_refs,
      {"DamageFire", "tagCharAttribute02"} | bgt.COMPOSER_TAGS | bgt.FACET_TAGS)
check("stat-item-tags argument is optional",
      bgt.collect_referenced_tags({}, {}, {}, {}, {}, {}),
      set(bgt.COMPOSER_TAGS | bgt.FACET_TAGS))

# --- COMPOSER_TAGS: the formatter's grammar tags reach the built English table ---
game_en = json.loads(Path("data/i18n/game.en.json").read_text(encoding="utf-8"))
for tag in ("DamageSingleFormatTime", "DamageRangeFormatTime", "SkillSecondFormat",
            "SkillDistanceFormat", "SkillCostFormat", "SkillPercentFormat",
            "SkillIntFormat", "tagSecond", "tagSeconds",
            "tagSkillCooldownRefresh", "tagSkillCooldownRefreshName",
            "tagSkillDurationRefresh", "tagSkillDurationRefreshName",
            "tagSkillDurationRefreshMax", "tagSkillDurationRefreshNameMax"):
    check(f"composer tag reaches game.en.json: {tag}", tag in game_en, True)
check("DamageSingleFormatTime text", game_en.get("DamageSingleFormatTime"), "over {%.1f0} Seconds")
check("tagSkillCooldownRefreshName text", game_en.get("tagSkillCooldownRefreshName"),
      "{%t0} to reduce cooldown of {%s1} by {%.1f2} {%z3}")
check("tagSkillDurationRefreshName text", game_en.get("tagSkillDurationRefreshName"),
      "{%t0} to extend duration of {%s1} by {%.1f2} {%z3}")
check("tagSkillDurationRefreshNameMax text", game_en.get("tagSkillDurationRefreshNameMax"),
      "{%t0} to refresh duration of {%s1} by {%.1f2} {%z3} (Max {%.1f4} {%z5})")

# The gear-category chips are labelled from these tags alone. No dataset references them,
# so nothing else would notice them going missing from the built table.
for tag in sorted(bgt.FACET_TAGS):
    check(f"facet tag reaches game.en.json: {tag}", tag in game_en, True)
check("tagLootFilter10 text", game_en.get("tagLootFilter10"), "2h Melee")

# --- every used trigger has a condition tag, or a trigger would render unlabelled ---
for tag in ("tagRefreshSkillCondition03", "tagRefreshSkillCondition07",
            "tagRefreshSkillCondition10", "tagRefreshSkillCondition11",
            "tagRefreshSkillCondition12"):
    check(f"trigger condition tag present: {tag}", tag in game_en, True)

print("ALL PASSED" if failures == 0 else f"{failures} FAILURE(S)")
raise SystemExit(1 if failures else 0)
