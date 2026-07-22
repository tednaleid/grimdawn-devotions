#!/usr/bin/env -S uv run --script
# ABOUTME: Tests for parse_rr RR extraction. Run: uv run scripts/test_parse_rr.py
# /// script
# requires-python = ">=3.10"
# ///
import importlib.util, json, subprocess, sys, tempfile
from pathlib import Path

here = Path(__file__).parent
root = here.parent

def load(name, file):
    spec = importlib.util.spec_from_file_location(name, here / file)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

rr = load("rr", "parse_rr.py")

failures = 0
def check(name, cond):
    global failures
    if cond:
        print(f"  ok   {name}")
    else:
        failures += 1
        print(f"  FAIL {name}")

# Run the real parser over the extracted tree into a temp file.
out = Path(tempfile.mkdtemp()) / "rr.json"
rc = subprocess.run([sys.executable, str(here / "parse_rr.py"),
    "--records-dir", str(root / "extracted/records"),
    "--text-dir", str(root / "extracted/text_en"),
    "--out", str(out), "--game-version", "test"]).returncode
check("parser exits 0", rc == 0)
doc = json.loads(out.read_text(encoding="utf-8"))
check("has meta.game_version", doc["meta"]["game_version"] == "test")
check("has meta.generated_utc", bool(doc["meta"].get("generated_utc")))
check("sources is a list", isinstance(doc["sources"], list))

# --- Task 3: pure classification & value helpers ---
check("mult field", rr.classify_offensive_field("offensiveElementalResistanceReductionPercentMin") == ("reduced-percent", "Elemental"))
check("flat physical", rr.classify_offensive_field("offensivePhysicalResistanceReductionAbsoluteMin") == ("reduced-flat", "Physical"))
check("total flat -> field", rr.classify_offensive_field("offensiveTotalResistanceReductionAbsoluteMin") == ("reduced-flat", "Total"))
check("duration sibling is not a value field", rr.classify_offensive_field("offensiveTotalResistanceReductionAbsoluteDurationMin") is None)
check("non-rr field", rr.classify_offensive_field("offensivePhysicalMin") is None)

check("stacking bare cold", rr.stacking_token("defensiveCold") == "Cold")
check("stacking elemental aggregate", rr.stacking_token("defensiveElementalResistance") == "Elemental")
check("stacking rejects modifier", rr.stacking_token("defensiveColdModifier") is None)
check("stacking rejects duration", rr.stacking_token("defensiveColdDurationModifier") is None)

check("token All", rr.token_to_resistances("Total") == "All")
check("token Elemental", rr.token_to_resistances("Elemental") == "Elemental")
check("token Poison label", rr.token_to_resistances("Poison") == ["Poison & Acid"])
check("token Life label", rr.token_to_resistances("Life") == ["Vitality"])

check("array parse", rr.parse_array("10.0;15.0;20.0") == [10, 15, 20])
check("array negative", rr.parse_array("-3.0;-6.0")[-1] == -6)

# --- Task 4: offensive sweep (flat + multiplicative) ---
def find(pred):
    return [s for s in doc["sources"] if pred(s)]

viper = find(lambda s: s["record_path"].endswith("skills/devotion/tier1_13d.dbr"))
check("viper present", len(viper) == 1)
check("viper mult 20 elemental", viper and viper[0]["rr_type"] == "reduced-percent"
      and viper[0]["value_at_max"] == 20 and viper[0]["resistances"] == "Elemental")
check("viper duration 3", viper and viper[0]["duration_seconds"] == 3)

morale = find(lambda s: s["record_path"].endswith("skills/playerclass01/warcry2.dbr")
              and s["rr_type"] == "reduced-flat")
# Base max (rank 12) = 35; overcap (rank 22) = 45. value_at_max is base, not the array end.
check("break morale flat physical base 35 / overcap 45",
      morale and morale[0]["value_at_max"] == 35 and morale[0]["value_at_ultimate"] == 45
      and morale[0]["resistances"] == ["Physical"])

estorm = find(lambda s: s["record_path"].endswith("skills/devotion/tier2_01c_skill.dbr")
              and s["rr_type"] == "reduced-flat")
check("elemental storm flat 32", estorm and estorm[0]["value_at_max"] == 32
      and estorm[0]["resistances"] == "Elemental")

# --- Task 5: stacking sweep (negative defensive + templates + modifier parents) ---
vuln = find(lambda s: s["record_path"].endswith("skills/playerclass03/curse2.dbr"))
check("vulnerability present (all stacking)", vuln and all(s["rr_type"] == "stacking" for s in vuln))
vuln_elem = [s for s in vuln if s["resistances"] == "Elemental"]
# Base max (rank 10) = -25; overcap (rank 20) = -35.
check("vulnerability stacking elemental base -25 / overcap -35",
      vuln_elem and vuln_elem[0]["value_at_max"] == -25 and vuln_elem[0]["value_at_ultimate"] == -35)

nc = find(lambda s: s["record_path"].endswith("skills/playerclass04/veilofshadows2.dbr"))
check("night's chill present (stacking)", nc and nc[0]["rr_type"] == "stacking")
nc_res = set()
for s in nc:
    r = s["resistances"]
    nc_res |= set(r if isinstance(r, list) else [r])
check("night's chill covers Cold/Pierce/Poison&Acid/Vitality",
      {"Cold", "Pierce", "Poison & Acid", "Vitality"} <= nc_res)

censure = find(lambda s: s["record_path"].endswith("skills/playerclass07/auracensure1_buff.dbr"))
# Base max (rank 12) = -25; overcap (rank 22) = -35.
check("aura of censure stacking elemental base -25 / overcap -35",
      censure and censure[0]["value_at_max"] == -25 and censure[0]["value_at_ultimate"] == -35)

# --- Task 6: category, parent, trigger + item attribution ---
check("every source has a category", all(s["category"] for s in doc["sources"]))
check("every source has a trigger", all(s["trigger"] for s in doc["sources"]))
check("viper category devotion", viper and viper[0]["category"] == "devotion")
check("break morale is a mastery/modifier skill",
      morale and morale[0]["category"] in {"mastery skill", "modifier"})
item_cats = {"component", "augment", "relic", "set bonus", "item granted", "item skill modifier", "monster infrequent"}
item_sources = find(lambda s: s["category"] in item_cats)
check("item-attributed RR sources exist", len(item_sources) >= 1)

# --- Task 7: determinism + rr_type coverage ---
out2 = Path(tempfile.mkdtemp()) / "rr2.json"
subprocess.run([sys.executable, str(here / "parse_rr.py"),
    "--records-dir", str(root / "extracted/records"),
    "--text-dir", str(root / "extracted/text_en"),
    "--out", str(out2), "--game-version", "test"], check=True)
doc2 = json.loads(out2.read_text(encoding="utf-8"))
check("deterministic sources across runs", doc["sources"] == doc2["sources"])
check("has stacking, flat, and percent sources",
      {"stacking", "reduced-flat", "reduced-percent"} <= {s["rr_type"] for s in doc["sources"]})

# --- Task (page-1): real parent names (mastery / constellation / item) ---
# A class skill's parent is its mastery, not its own name.
nc_all = find(lambda s: s["record_path"].endswith("skills/playerclass04/veilofshadows2.dbr"))
check("night's chill parent differs from name", nc_all and nc_all[0]["parent"] != nc_all[0]["name"])
# A devotion's parent is its constellation, not its own name.
est = find(lambda s: s["record_path"].endswith("skills/devotion/tier2_01c_skill.dbr"))
check("elemental storm parent differs from name", est and est[0]["parent"] != est[0]["name"])
# No source keeps a synthesized x: placeholder as its display name: a nameless skill
# modifier borrows the skill it modifies, else the parent (item/mastery/constellation).
synth_names = [s for s in doc["sources"] if s["name"].startswith("x:")]
check("no source shows a raw x: placeholder name", len(synth_names) == 0)
# A nameless item skill modifier resolves to the skill it modifies (Doom Bolt).
doombolt = find(lambda s: s["record_path"].endswith("skillmodifiers/legendary/axe2h_d206_doombolt.dbr"))
tag = doombolt[0]["name"] if doombolt else ""
check("doom bolt modifier borrows the modified skill's name tag", tag.startswith("tag"))
# The Conduit of Eldritch Whispers rolls a random skill modifier from a folder its item record
# does not link back to; those modifiers are attributed to the amulet (a distinct real name).
conduit = find(lambda s: "/eldritchwhispers/" in s["record_path"])
check("conduit modifiers attribute to the amulet, not the skill",
      conduit and all(c["parent"].startswith("tag") and c["parent"] != c["name"] for c in conduit))

print("FAILURES:", failures)
raise SystemExit(1 if failures else 0)
