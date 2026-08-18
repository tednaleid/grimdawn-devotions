#!/usr/bin/env -S uv run --script
# ABOUTME: Tests for build_skill_items.py against the committed data/skill-items.json.
# ABOUTME: Run: uv run scripts/test_build_skill_items.py (rebuild first with `just skill-items`).
# /// script
# requires-python = ">=3.10"
# ///
import json
from pathlib import Path

failures = 0
def check(name, got, want):
    global failures
    if got != want:
        failures += 1
        print(f"  FAIL {name}: got {got!r}, want {want!r}")
    else:
        print(f"  ok   {name}")


# --- refresh qualifiers reach the payload -------------------------------------
# Badge of the Crimson Company's Cadence block reduces LEAP's cooldown. Pinned
# to the grimtools card "25% Chance on Attack to reduce cooldown of Leap by
# 1 Second". The target is a different skill from the modified skill, so a
# reader that assumes self-targeting mislabels it.
doc = json.loads(Path("data/skill-items.json").read_text(encoding="utf-8"))
item = next(i for i in doc["items"]
            if i["record"].endswith("awakened/gearaccessories/medals/c010_medal.dbr"))
block = next(m for m in item["modifiers"]
             if m["skill"] == "records/skills/playerclass01/cadence1.dbr")
amount = next(s for s in block["stats"] if s["stat"] == "refreshCooldownAmount")
check("refresh_skill on refreshCooldownAmount",
      amount["refresh_skill"], "records/skills/playerclass10/leap1.dbr")
check("refresh_trigger on refreshCooldownAmount", amount["refresh_trigger"], "AttackEnemy")

bleed = next(s for s in block["stats"] if s["stat"] == "offensiveSlowBleedingMin")
check("refresh_skill absent from an unrelated stat",
      "refresh_skill" not in bleed, True)
check("refresh_trigger absent from an unrelated stat",
      "refresh_trigger" not in bleed, True)

print("ALL PASSED" if failures == 0 else f"{failures} FAILURE(S)")
raise SystemExit(1 if failures else 0)
