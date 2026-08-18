#!/usr/bin/env -S uv run --script
# ABOUTME: Pins the pure helpers in audit_stat_labels.py so they need no game install to test.
# ABOUTME: Run via `just test-scripts`, or directly with `uv run scripts/test_audit_stat_labels.py`.
# /// script
# requires-python = ">=3.10"
# ///
import importlib.util
from pathlib import Path

here = Path(__file__).parent
spec = importlib.util.spec_from_file_location("audit_stat_labels", here / "audit_stat_labels.py")
assert spec and spec.loader
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

failures = 0
def check(name, got, want):
    global failures
    if got != want:
        failures += 1
        print(f"  FAIL {name}: got {got!r}, want {want!r}")
    else:
        print(f"  ok   {name}")

check("strip_tokens drops value + colour tokens", audit.strip_tokens("{%+.0f0}% {^E}to All Damage"), "to All Damage")
check("strip_tokens drops a leading percent token",
      audit.strip_tokens("{%.0f0}% Resistance to Life Reduction"), "Resistance to Life Reduction")
check("strip_tokens is a no-op on plain prose", audit.strip_tokens("Armor Rating"), "Armor Rating")

check("head_noun of 'All Damage'", audit.head_noun("All Damage"), "damage")
check("head_noun of 'Shield Block Chance'", audit.head_noun("Shield Block Chance"), "chance")
check("head_noun of empty string", audit.head_noun(""), "")

tags = {
    "tagDamageModifierTotalDamage": "{%+.0f0}% {^E}to All Damage",
    "tagCharStatsArmorTotal": "Armor Rating",
}
found = audit.candidates("Total Damage", tags)
check("candidates matches the tag sharing the head noun",
      ("tagDamageModifierTotalDamage", "to All Damage") in found, True)
check("candidates excludes a tag with a different head noun",
      all(tag != "tagCharStatsArmorTotal" for tag, _ in found), True)

print("ALL PASSED" if failures == 0 else f"{failures} FAILURE(S)")
raise SystemExit(1 if failures else 0)
