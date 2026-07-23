#!/usr/bin/env -S uv run --script
# ABOUTME: Tests the pure diff functions in diff_data.py (structural gate + tuning/RR reports).
# ABOUTME: Run: uv run scripts/test_diff_data.py
# /// script
# requires-python = ">=3.10"
# ///
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("diff_data", Path(__file__).parent / "diff_data.py")
dd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dd)

BASE = {
    "meta": {"affinities": ["a", "b"]},
    "constellations": [
        {"id": "c1", "name_tag": "t1", "tier": 1, "point_cost": 2,
         "affinity_required": {"a": 1}, "affinity_bonus": {"a": 5},
         "stars": [{"index": 0, "bonuses": {"str": 10}, "celestial_power": None}]},
    ],
}


def clone(d):
    import copy
    return copy.deepcopy(d)


def test_stable_is_clean():
    errors, changes = dd.diff_devotions(BASE, clone(BASE))
    assert errors == [], errors
    assert changes == [], changes


def test_removed_constellation_is_structural_error():
    new = clone(BASE)
    new["constellations"] = []
    errors, _ = dd.diff_devotions(BASE, new)
    assert any("REMOVED" in e for e in errors), errors


def test_affinities_change_is_error():
    new = clone(BASE)
    new["meta"]["affinities"] = ["a"]
    errors, _ = dd.diff_devotions(BASE, new)
    assert any("affinities" in e for e in errors), errors


def test_point_cost_total_change_is_error():
    new = clone(BASE)
    new["constellations"][0]["point_cost"] = 3
    errors, _ = dd.diff_devotions(BASE, new)
    assert errors, errors


def test_bonus_value_change_is_tuning():
    new = clone(BASE)
    new["constellations"][0]["stars"][0]["bonuses"]["str"] = 12
    errors, changes = dd.diff_devotions(BASE, new)
    assert errors == [], errors
    assert any("str" in c and "12" in c for c in changes), changes


def test_rr_added_removed_changed():
    old = {"sources": [{"id": "s1", "rr_type": "stacking", "resistances": "Fire", "values_per_rank": [10]},
                       {"id": "s2", "rr_type": "stacking", "resistances": "Cold", "values_per_rank": [5]}]}
    new = {"sources": [{"id": "s1", "rr_type": "stacking", "resistances": "Fire", "values_per_rank": [12]},
                       {"id": "s3", "rr_type": "stacking", "resistances": "Aether", "values_per_rank": [8]}]}
    added, removed, changed = dd.diff_rr(old, new)
    assert added == ["s3"], added
    assert removed == ["s2"], removed
    assert any("s1" in c for c in changed), changed


def run():
    fns = [v for k, v in globals().items() if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")


if __name__ == "__main__":
    run()
