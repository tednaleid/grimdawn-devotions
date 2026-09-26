#!/usr/bin/env -S uv run --script
# ABOUTME: Tests for stats.py pure logic. Run: uv run scripts/test_stats.py
# ABOUTME: Pins how Cloudflare's country codes are labelled, including its non-ISO codes.
# /// script
# requires-python = ">=3.14"
# dependencies = ["pycountry"]
# ///
import importlib.util
from pathlib import Path

here = Path(__file__).parent
spec = importlib.util.spec_from_file_location("stats", here / "stats.py")
assert spec and spec.loader
stats = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stats)

failures = 0
def check(name, got, want):
    global failures
    if got != want:
        failures += 1
        print(f"  FAIL {name}: got {got!r}, want {want!r}")
    else:
        print(f"  ok   {name}")

check("an ISO code gets its name", stats.country_label("US"), "US  United States")
check("the everyday name wins over the formal one", stats.country_label("KR"), "KR  South Korea")
check("Cloudflare's unknown code", stats.country_label("XX"), "XX  Unknown")
check("Cloudflare's Tor code", stats.country_label("T1"), "T1  Tor network")
check("an unrecognized code keeps its code", stats.country_label("ZZ"), "ZZ  ?")

print("FAILURES:", failures)
raise SystemExit(1 if failures else 0)
