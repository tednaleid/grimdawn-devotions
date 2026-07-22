#!/usr/bin/env -S uv run --script
# ABOUTME: Tests for gd_dbr shared helpers. Run: uv run scripts/test_gd_dbr.py
# /// script
# requires-python = ">=3.10"
# ///
import importlib.util
from pathlib import Path

here = Path(__file__).parent
spec = importlib.util.spec_from_file_location("gd", here / "gd_dbr.py")
gd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gd)

failures = 0
def check(name, got, want):
    global failures
    if got != want:
        failures += 1
        print(f"  FAIL {name}: got {got!r}, want {want!r}")
    else:
        print(f"  ok   {name}")

check("level_array clamps past end", gd.level_array_value("30;40;50", 25), 50)
check("level_array scalar", gd.level_array_value("8.000000", 15), 8)
check("as_number int", gd.as_number("45.000000"), 45)
check("as_number rejects array", gd.as_number("1;2;3"), None)
check("clean_text strips codes", gd.clean_text("{^n}Night^o's"), "Night's")

# read_dbr over a real record: Viper carries the mult field.
db_root = here.parent / "extracted/records"
viper = gd.read_dbr(db_root / "records/skills/devotion/tier1_13d.dbr")
check("read_dbr picks up mult field",
      viper.get("offensiveElementalResistanceReductionPercentMin"), "20.000000")

print("FAILURES:", failures)
raise SystemExit(1 if failures else 0)
