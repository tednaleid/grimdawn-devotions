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

        check("parsed some constellations", len(constellations) > 0, True)

        def resolves(key):
            return bool(key) and bool(game_en.get(key))

        con = constellations[0]
        check("constellation has name_tag", "name_tag" in con, True)
        check("constellation name_tag resolves in game_en", resolves(con["name_tag"]), True)
        check("constellation name_tag maps to its english name", game_en.get(con["name_tag"]), con["name"])

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
                if cp and cp.get("pet") and cp["pet"].get("name") and pet is None:
                    pet = cp["pet"]

        check("found a celestial power", power is not None, True)
        if power:
            check("power has name_tag", "name_tag" in power, True)
            check("power has description_tag", "description_tag" in power, True)
            check("power name_tag resolves in game_en", resolves(power["name_tag"]), True)

        check("found a power with a proc trigger", proc_power is not None, True)
        if proc_power:
            proc = proc_power["proc"]
            check("proc keeps trigger_key as the raw enum", proc.get("trigger_key"),
                  {v: k for k, v in pd.TRIGGER_DISPLAY.items()}.get(proc["trigger"], proc.get("trigger_key")))
            check("proc still has english trigger", proc.get("trigger"),
                  pd.TRIGGER_DISPLAY.get(proc.get("trigger_key"), proc.get("trigger_key")))

        check("found a weapon requirement", weapon_req is not None, True)
        if weapon_req:
            check("weapon_requirement has description_tag", "description_tag" in weapon_req, True)

        check("found a pet power", pet is not None, True)
        if pet:
            check("pet has name_tag", "name_tag" in pet, True)
            check("pet name_tag resolves in game_en", resolves(pet["name_tag"]), True)

        # Every *_tag field whose field has text must resolve to that same text in game_en.
        missing = []
        for c in constellations:
            if c.get("name") and game_en.get(c.get("name_tag")) != c["name"]:
                missing.append(("con", c["id"], c.get("name_tag")))
            for s in c["stars"]:
                cp = s.get("celestial_power")
                if cp:
                    if cp.get("name") and game_en.get(cp.get("name_tag")) != cp["name"]:
                        missing.append(("pow-name", cp["dbr"], cp.get("name_tag")))
                    if cp.get("description") and game_en.get(cp.get("description_tag")) != cp["description"]:
                        missing.append(("pow-desc", cp["dbr"], cp.get("description_tag")))
                    p = cp.get("pet")
                    if p and p.get("name") and game_en.get(p.get("name_tag")) != p["name"]:
                        missing.append(("pet", cp["dbr"], p.get("name_tag")))
                wr = s.get("weapon_requirement")
                if wr and wr.get("description") and game_en.get(wr.get("description_tag")) != wr["description"]:
                    missing.append(("weapon", s["dbr"], wr.get("description_tag")))
        check("every referenced *_tag resolves in game_en to its english text", missing, [])
    except Exception as e:
        failures += 1
        print(f"  FAIL tag-preservation block raised: {e!r}")

print("ALL PASSED" if failures == 0 else f"{failures} FAILURE(S)")
raise SystemExit(1 if failures else 0)
