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

print("FAILURES:", failures)
raise SystemExit(1 if failures else 0)
