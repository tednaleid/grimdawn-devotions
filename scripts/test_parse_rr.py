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

print("FAILURES:", failures)
raise SystemExit(1 if failures else 0)
