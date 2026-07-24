#!/usr/bin/env -S uv run --script
# ABOUTME: Tests for parse_monsters extraction. Run: uv run scripts/test_parse_monsters.py
# /// script
# requires-python = ">=3.10"
# ///
import importlib.util, json, subprocess, sys, tempfile
from pathlib import Path

here = Path(__file__).parent
root = here.parent

def load(name, file):
    spec = importlib.util.spec_from_file_location(name, here / file)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

mon = load("mon", "parse_monsters.py")

failures = 0
def check(name, cond):
    global failures
    if cond:
        print(f"  ok   {name}")
    else:
        failures += 1
        print(f"  FAIL {name}")

# --- Task 1: role classification ---
check("role from nemesis dir", mon.role_of("enemies/nemesis/nemesis_aetherial_01.dbr") == "nemesis")
check("role from hero dir", mon.role_of("enemies/hero/foo_a01.dbr") == "hero")
check("role boss&quest", mon.role_of("enemies/boss&quest/loghorrean_03.dbr") == "boss&quest")
check("waveevents normalizes to waveevent", mon.role_of("enemies/waveevents/x.dbr") == "waveevent")
check("waveevent stays waveevent", mon.role_of("enemies/waveevent/x.dbr") == "waveevent")
check("bare enemies dir is base", mon.role_of("enemies/aetherelemental_a01.dbr") == "base")
check("role match is case-insensitive", mon.role_of("enemies/NEMESIS/x.dbr") == "nemesis")
check("partial dir name does not match", mon.role_of("enemies/heroic_things/x.dbr") == "base")

# --- Task 1: resistances always carry all ten keys ---
TEN = ["physical","pierce","fire","cold","lightning","poison","aether","chaos","vitality","bleeding"]
res = mon.resistances_of({"defensiveFire": "20.000000", "defensiveAether": "50.000000"})
check("resistances has exactly the ten keys", list(res.keys()) == TEN)
check("absent resistance is explicit 0", res["cold"] == 0 and res["bleeding"] == 0)
check("present resistance parsed as int", res["fire"] == 20 and res["aether"] == 50)
check("vitality reads defensiveLife", mon.resistances_of({"defensiveLife": "25.0"})["vitality"] == 25)
check("negative resistance preserved", mon.resistances_of({"defensiveFire": "-25.0"})["fire"] == -25)
check("fractional resistance kept as float", mon.resistances_of({"defensiveCold": "12.5"})["cold"] == 12.5)
check("non-numeric resistance falls back to 0", mon.resistances_of({"defensiveFire": "abc"})["fire"] == 0)

# --- Task 1: exclusion rules, in order ---
TAGS = {"tagOk": "Real Monster"}
def rec(**kw):
    base = {"Class": "Monster", "description": "tagOk", "monsterClassification": "Common"}
    base.update(kw)
    return base

check("a good record is kept", mon.exclusion_reason("enemies/x.dbr", rec(), TAGS) is None)
check("non-monster excluded", mon.exclusion_reason("enemies/x.dbr", rec(Class="ProxyPool"), TAGS) == "not a monster record")
check("hiddenFromCombat excluded", mon.exclusion_reason("enemies/x.dbr", rec(hiddenFromCombat="1"), TAGS) == "hidden from combat")
check("hiddenFromCombat zero is kept", mon.exclusion_reason("enemies/x.dbr", rec(hiddenFromCombat="0"), TAGS) is None)
check("invincible excluded", mon.exclusion_reason("enemies/x.dbr", rec(invincible="1"), TAGS) == "invincible")
check("missing description excluded", mon.exclusion_reason("enemies/x.dbr", rec(description=""), TAGS) == "no resolvable name")
check("unresolvable description excluded", mon.exclusion_reason("enemies/x.dbr", rec(description="tagMissing"), TAGS) == "no resolvable name")
check("devotion role excluded", mon.exclusion_reason("enemies/devotion/x.dbr", rec(), TAGS) == "devotion role")
check("missing classification excluded", mon.exclusion_reason("enemies/x.dbr", rec(monsterClassification=""), TAGS) == "no classification")
check("unknown classification excluded", mon.exclusion_reason("enemies/x.dbr", rec(monsterClassification="Prop"), TAGS) == "no classification")
for c in ("Common", "Champion", "Hero", "Boss", "SuperBoss", "Quest"):
    check(f"classification {c} is valid", mon.exclusion_reason("enemies/x.dbr", rec(monsterClassification=c), TAGS) is None)
check("rule order: non-monster reported before devotion role",
      mon.exclusion_reason("enemies/devotion/x.dbr", rec(Class="ProxyPool"), TAGS) == "not a monster record")

# --- Task 2: id derivation ---
check("id drops the .dbr suffix and flattens separators",
      mon.monster_id("enemies/nemesis/nemesis_aetherial_01.dbr") == "enemies.nemesis.nemesis_aetherial_01")
check("id sanitizes characters that are unsafe in a URL hash",
      mon.monster_id("enemies/boss&quest/loghorrean_03.dbr") == "enemies.boss-quest.loghorrean_03")

# --- Task 2: race tag resolution ---
RACE_TAGS = {"tagRace005": "Aether Corruption"}
check("race tag resolves", mon.race_tag_of({"characterRacialProfile": "Race005"}, RACE_TAGS) == "tagRace005")
check("unresolvable race tag is dropped", mon.race_tag_of({"characterRacialProfile": "Race099"}, RACE_TAGS) is None)
check("absent race profile is None", mon.race_tag_of({}, RACE_TAGS) is None)
check("malformed race profile is None", mon.race_tag_of({"characterRacialProfile": "Bogus"}, RACE_TAGS) is None)

# --- Task 2: collapse to the logical grain ---
def crec(maxlv, minlv=1, **kw):
    base = {"Class": "Monster", "description": "tagOk", "monsterClassification": "Common",
            "maxLevel": str(maxlv), "minLevel": str(minlv)}
    base.update(kw)
    return base

groups = {
    ("Aetherial Bloater", "Common"): [
        ("enemies/bloater_a01.dbr", crec(30, defensiveFire="10")),
        ("enemies/bloater_c01.dbr", crec(90, defensiveFire="10")),
        ("enemies/bloater_b01.dbr", crec(60, defensiveFire="10")),
    ],
    ("Solo Beast", "Hero"): [("enemies/hero/solo.dbr", crec(50, defensiveCold="8"))],
}
logical = mon.collapse_to_logical(groups, RACE_TAGS)
by_name = {m["id"]: m for m in logical}
check("one logical monster per (name, classification)", len(logical) == 2)
bloater = [m for m in logical if m["variant_count"] == 3][0]
check("representative is the highest maxLevel", bloater["id"] == "enemies.bloater_c01")
check("variant_count counts every collapsed record", bloater["variant_count"] == 3)
check("record_paths lists every collapsed record, representative first",
      bloater["record_paths"][0] == "records/creatures/enemies/bloater_c01.dbr"
      and len(bloater["record_paths"]) == 3)
check("agreeing variants are not flagged", bloater["variants_disagree"] is False)
check("classification carried through", bloater["classification"] == "Common")
check("role carried through", by_name["enemies.hero.solo"]["role"] == "hero")
check("output is sorted by id", [m["id"] for m in logical] == sorted(m["id"] for m in logical))
check("every logical monster carries all ten resistance keys",
      all(list(m["resistances"].keys()) == TEN for m in logical))

# maxLevel ties break on minLevel, then on path
tie = mon.collapse_to_logical({("Tie", "Common"): [
    ("enemies/b.dbr", crec(90, 10)),
    ("enemies/a.dbr", crec(90, 40)),
]}, RACE_TAGS)
check("maxLevel tie breaks on higher minLevel", tie[0]["id"] == "enemies.a")
tie2 = mon.collapse_to_logical({("Tie", "Common"): [
    ("enemies/z.dbr", crec(90, 10)),
    ("enemies/a.dbr", crec(90, 10)),
]}, RACE_TAGS)
check("full tie breaks on lowest path", tie2[0]["id"] == "enemies.a")

# disagreement detection
dis = mon.collapse_to_logical({("Dis", "Common"): [
    ("enemies/x_a01.dbr", crec(90, defensiveFire="10")),
    ("enemies/x_b01.dbr", crec(50, defensiveFire="40")),
]}, RACE_TAGS)
check("disagreeing variants are flagged", dis[0]["variants_disagree"] is True)
check("disagreement still reports the representative's values", dis[0]["resistances"]["fire"] == 10)

# summon flag
summ = mon.collapse_to_logical({("S", "Common"): [("enemies/x_a01_summon.dbr", crec(20))]}, RACE_TAGS)
check("summon records are flagged", summ[0]["is_summon"] is True)
check("non-summon records are not flagged", tie[0]["is_summon"] is False)

print("FAILURES:", failures)
raise SystemExit(1 if failures else 0)
