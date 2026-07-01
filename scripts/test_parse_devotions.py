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

# --- Tag preservation (Phase 1b Task 1): parser keeps game tags + emits game_en ---
# Runs the real parse over the extracted tree (records/text already extracted; no
# `just extract` needed) and checks structural invariants on the output, rather
# than hand-rolling fake .dbr fixtures.

records_dir = here.parent / "extracted" / "records"
text_dir = here.parent / "extracted" / "text_en"

if not records_dir.is_dir() or not text_dir.is_dir():
    print("  SKIP tag-preservation checks (extracted/ data not present)")
else:
    try:
        db = pd.DB(records_dir)
        tags = pd.load_translations(text_dir)
        game_en: dict[str, str] = {}
        warnings: list[str] = []
        constellations = []
        con_dir = db.devotion_constellations_dir
        for con_path in sorted(con_dir.glob("constellation*.dbr")):
            if "_background" in con_path.name:
                continue
            c = pd.parse_constellation(db, tags, con_path, warnings, game_en)
            if c:
                constellations.append(c)
        pd.ensure_unique_ids(constellations)  # main() does this before validate()

        check("parsed some constellations", len(constellations) > 0, True)

        def resolves(key):
            return bool(key) and bool(game_en.get(key))

        con = constellations[0]
        check("constellation has name_tag", "name_tag" in con, True)
        check("constellation name_tag resolves in game_en", resolves(con["name_tag"]), True)

        # --- Phase 1b Task 5: the English display fields are gone; only tags remain.
        check("constellation has no baked english name", "name" in con, False)

        power = None
        proc_power = None
        weapon_req = None
        pet = None
        for c in constellations:
            for s in c["stars"]:
                cp = s.get("celestial_power")
                if cp and power is None:
                    power = cp
                if cp and cp.get("proc") and proc_power is None:
                    proc_power = cp
                if s.get("weapon_requirement") and weapon_req is None:
                    weapon_req = s["weapon_requirement"]
                if cp and cp.get("pet") and resolves(cp["pet"].get("name_tag")) and pet is None:
                    pet = cp["pet"]

        check("found a celestial power", power is not None, True)
        if power:
            check("power has name_tag", "name_tag" in power, True)
            check("power has description_tag", "description_tag" in power, True)
            check("power name_tag resolves in game_en", resolves(power["name_tag"]), True)
            check("power has no baked english name", "name" in power, False)
            check("power has no baked english description", "description" in power, False)

        check("found a power with a proc trigger", proc_power is not None, True)
        if proc_power:
            proc = proc_power["proc"]
            check("proc keeps trigger_key as the raw enum", proc.get("trigger_key") in pd.TRIGGER_DISPLAY
                  or bool(proc.get("trigger_key")), True)
            check("proc has no baked english trigger", "trigger" in proc, False)

        check("found a weapon requirement", weapon_req is not None, True)
        if weapon_req:
            check("weapon_requirement has description_tag", "description_tag" in weapon_req, True)
            check("weapon_requirement has no baked english description", "description" in weapon_req, False)

        check("found a pet power", pet is not None, True)
        if pet:
            check("pet has name_tag", "name_tag" in pet, True)
            check("pet name_tag resolves in game_en", resolves(pet["name_tag"]), True)
            check("pet has no baked english name", "name" in pet, False)

        # Every *_tag/key referenced in the output must resolve to non-empty text in game_en
        # (the completeness the inverted validate() now enforces).
        missing = []
        for c in constellations:
            if not resolves(c.get("name_tag")):
                missing.append(("con", c["id"], c.get("name_tag")))
            for s in c["stars"]:
                cp = s.get("celestial_power")
                if cp:
                    if not resolves(cp.get("name_tag")):
                        missing.append(("pow-name", cp["dbr"], cp.get("name_tag")))
                    if not resolves(cp.get("description_tag")):
                        missing.append(("pow-desc", cp["dbr"], cp.get("description_tag")))
                    p = cp.get("pet")
                    if p and not resolves(p.get("name_tag")):
                        missing.append(("pet", cp["dbr"], p.get("name_tag")))
                wr = s.get("weapon_requirement")
                if wr and not resolves(wr.get("description_tag")):
                    missing.append(("weapon", s["dbr"], wr.get("description_tag")))
        check("every referenced *_tag resolves in game_en", missing, [])

        # --- validate() itself: completeness check is inverted (misses -> ERROR, not leaks).
        report_ok = pd.validate(constellations, game_en, [])
        check("validate() OK report has no ERROR", any("ERROR" in ln for ln in report_ok), False)
        check("validate() reports referenced-tag completeness line",
              any(ln.strip().startswith("Referenced tags missing from game table:") for ln in report_ok), True)

        broken = [dict(c) for c in constellations]
        broken[0] = dict(broken[0])
        broken[0]["name_tag"] = "tagDoesNotExist_Nope"
        report_broken = pd.validate(broken, game_en, [])
        check("validate() flags a tag missing from game_en as ERROR",
              any("ERROR" in ln for ln in report_broken), True)
    except Exception as e:
        failures += 1
        print(f"  FAIL tag-preservation block raised: {e!r}")

print("ALL PASSED" if failures == 0 else f"{failures} FAILURE(S)")
raise SystemExit(1 if failures else 0)
