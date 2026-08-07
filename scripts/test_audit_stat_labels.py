#!/usr/bin/env -S uv run --script
# ABOUTME: Pins the pure helpers in audit_stat_labels.py so they need no game install to test.
# ABOUTME: Run via `just test-scripts`, or directly with `uv run scripts/test_audit_stat_labels.py`.
# /// script
# requires-python = ">=3.10"
# ///
from audit_stat_labels import strip_tokens, head_noun, candidates


def test_strip_tokens():
    assert strip_tokens("{%+.0f0}% {^E}to All Damage") == "to All Damage"
    assert strip_tokens("{%.0f0}% Resistance to Life Reduction") == "Resistance to Life Reduction"
    assert strip_tokens("Armor Rating") == "Armor Rating"


def test_head_noun():
    assert head_noun("All Damage") == "damage"
    assert head_noun("Shield Block Chance") == "chance"
    assert head_noun("") == ""


def test_candidates_matches_on_head_noun():
    tags = {
        "tagDamageModifierTotalDamage": "{%+.0f0}% {^E}to All Damage",
        "tagCharStatsArmorTotal": "Armor Rating",
    }
    found = candidates("Total Damage", tags)
    assert ("tagDamageModifierTotalDamage", "to All Damage") in found
    assert all(tag != "tagCharStatsArmorTotal" for tag, _ in found)


test_strip_tokens()
test_head_noun()
test_candidates_matches_on_head_noun()
print("ok")
