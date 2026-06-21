#!/usr/bin/env -S uv run --script
# ABOUTME: Tests for parse_devotions value selection: granted level + level-array clamping.
# ABOUTME: Run with `uv run scripts/test_parse_devotions.py`. Stdlib-only, no framework.
# /// script
# requires-python = ">=3.10"
# ///
import importlib.util
from pathlib import Path

here = Path(__file__).parent
spec = importlib.util.spec_from_file_location("pd", here / "parse_devotions.py")
pd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pd)

# Obelisk of Menhir / Stone Form's retaliation array (15 levels, last = 115).
RETAL = ";".join(["25", "31", "37", "43", "49", "55", "61", "67", "73", "79", "85", "91", "97", "103", "115"])

failures = 0
def check(name, got, want):
    global failures
    if got != want:
        failures += 1
        print(f"  FAIL {name}: got {got!r}, want {want!r}")
    else:
        print(f"  ok   {name}")

# A level-array value clamps to the last defined entry; it never extrapolates past the array.
check("in-range level 15 -> last", pd.level_array_value(RETAL, 15), 115)
check("clamp past array (level 25 -> 115, not 175)", pd.level_array_value(RETAL, 25), 115)
check("mid level 10", pd.level_array_value(RETAL, 10), 79)
check("scalar value", pd.level_array_value("8.000000", 15), 8)
check("shorter array clamps", pd.level_array_value("30;40;50", 25), 50)

# The granted level is the length of skillExperienceLevels across the skill chain.
xp15 = {"skillExperienceLevels": ";".join(["100"] * 15)}
xp25 = {"skillExperienceLevels": ";".join(["100"] * 25)}
check("granted_level from buff in chain = 15", pd.granted_level([{}, xp15]), 15)
check("granted_level = 25", pd.granted_level([xp25]), 25)
check("granted_level fallback when no XP field", pd.granted_level([{"weaponDamagePct": "1;2;3;4;5"}]), 5)

print("ALL PASSED" if failures == 0 else f"{failures} FAILURE(S)")
raise SystemExit(1 if failures else 0)
