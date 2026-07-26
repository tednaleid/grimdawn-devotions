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
         "stars": [{"index": 0, "bonuses": {"str": 10}, "pet_bonuses": {"petcrit": 8},
                    "celestial_power": {"stats": {"dmg": 100}, "pet": None}}]},
    ],
}


def clone(d):
    import copy
    return copy.deepcopy(d)


def test_stable_is_clean():
    errors, changes = dd.diff_devotions(BASE, clone(BASE))
    assert errors == [], errors
    assert changes == {}, changes


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


def test_player_bonus_change_is_tuning():
    new = clone(BASE)
    new["constellations"][0]["stars"][0]["bonuses"]["str"] = 12
    errors, changes = dd.diff_devotions(BASE, new)
    assert errors == [], errors
    lines = changes.get("c1", [])
    assert any("str" in ln and "12" in ln and "pet" not in ln for ln in lines), lines


def test_pet_bonus_change_is_tuning_and_labeled_pet():
    new = clone(BASE)
    new["constellations"][0]["stars"][0]["pet_bonuses"]["petcrit"] = 5
    errors, changes = dd.diff_devotions(BASE, new)
    assert errors == [], errors
    lines = changes.get("c1", [])
    assert any("(pet)" in ln and "8 -> 5" in ln for ln in lines), lines


def test_celestial_power_stat_change_is_tuning():
    new = clone(BASE)
    new["constellations"][0]["stars"][0]["celestial_power"]["stats"]["dmg"] = 120
    errors, changes = dd.diff_devotions(BASE, new)
    assert errors == [], errors
    lines = changes.get("c1", [])
    assert any("[power]" in ln and "100 -> 120" in ln for ln in lines), lines


def test_rr_added_removed_changed():
    old = {"sources": [{"id": "s1", "rr_type": "stacking", "resistances": "Fire", "values_per_rank": [10]},
                       {"id": "s2", "rr_type": "stacking", "resistances": "Cold", "values_per_rank": [5]}]}
    new = {"sources": [{"id": "s1", "rr_type": "stacking", "resistances": "Fire", "values_per_rank": [12]},
                       {"id": "s3", "rr_type": "stacking", "resistances": "Aether", "values_per_rank": [8]}]}
    added, removed, changed = dd.diff_rr(old, new)
    assert added == ["s3"], added
    assert removed == ["s2"], removed
    assert any("s1" in c for c in changed), changed


def _mon(mid, fire=10, cls="Common"):
    return {"id": mid, "name_tag": "tag" + mid, "classification": cls,
            "resistances": {"fire": fire, "cold": 0}}


def test_monster_diff_reports_added_removed_and_changed():
    old = {"monsters": [_mon("a"), _mon("b"), _mon("c")]}
    new = {"monsters": [_mon("a"), _mon("b", fire=40), _mon("d")]}
    added, removed, changed = dd.diff_monsters(old, new)
    assert added == ["d (Common)"], added
    assert removed == ["c (Common)"], removed
    assert len(changed) == 1 and changed[0].startswith("b:"), changed
    assert "fire" in changed[0] and "10" in changed[0] and "40" in changed[0], changed


def test_monster_diff_identical_documents_are_clean():
    doc = {"monsters": [_mon("a"), _mon("b")]}
    assert dd.diff_monsters(doc, doc) == ([], [], []), dd.diff_monsters(doc, doc)


def test_monster_diff_reports_provenance_moves_at_an_unchanged_total():
    """A patch can move where resistance comes from without moving the total."""
    old = {"monsters": [_mon("a")]}
    new = {"monsters": [dict(_mon("a"), passive_resistances={"fire": 10})]}
    _, _, changed = dd.diff_monsters(old, new)
    assert len(changed) == 1 and "passive fire" in changed[0], changed


def test_monster_diff_reports_a_gained_aura():
    old = {"monsters": [_mon("a")]}
    new = {"monsters": [dict(_mon("a"), aura_resistances={"cold": 33})]}
    _, _, changed = dd.diff_monsters(old, new)
    assert len(changed) == 1 and "aura cold" in changed[0], changed


def _offsets_doc(offsets):
    return {"monsters": [], "difficulty_offsets": offsets}


def test_offsets_diff_reports_changed_cells():
    old = _offsets_doc({"normal": {"1": {"fire": 0}, "2": {"fire": 0}},
                         "ultimate": {"1": {"fire": 8}}})
    new = _offsets_doc({"normal": {"1": {"fire": 0}, "2": {"fire": 5}},
                         "ultimate": {"1": {"fire": 8}}})
    changed = dd.diff_offsets(old, new)
    assert changed == ["normal/2: fire 0 -> 5"], changed


def test_offsets_diff_identical_documents_are_clean():
    doc = _offsets_doc({"normal": {"1": {"fire": 0}}, "ultimate": {"4": {"bleeding": 16}}})
    assert dd.diff_offsets(doc, doc) == [], dd.diff_offsets(doc, doc)


def test_offsets_diff_reports_multiple_changed_cells_sorted():
    old = _offsets_doc({"elite": {"1": {"fire": 4}, "4": {"cold": 11}}})
    new = _offsets_doc({"elite": {"1": {"fire": 6}, "4": {"cold": 13}}})
    changed = dd.diff_offsets(old, new)
    assert changed == ["elite/1: fire 4 -> 6", "elite/4: cold 11 -> 13"], changed


def run():
    fns = [v for k, v in globals().items() if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")


if __name__ == "__main__":
    run()
