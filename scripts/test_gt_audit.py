#!/usr/bin/env -S uv run --script
# ABOUTME: Tests for gt_audit pure logic. Run: uv run scripts/test_gt_audit.py
# ABOUTME: Pins the scrape traps that produce confidently wrong advice when parsed naively.
# /// script
# requires-python = ">=3.10"
# dependencies = ["duckdb"]
# ///
import importlib.util
from pathlib import Path

here = Path(__file__).parent
spec = importlib.util.spec_from_file_location("gt_audit", here / "gt_audit.py")
gt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gt)

failures = 0
def check(name, got, want):
    global failures
    if got != want:
        failures += 1
        print(f"  FAIL {name}: got {got!r}, want {want!r}")
    else:
        print(f"  ok   {name}")


# A grimtools skill tooltip always prints the next rank too. Scanning the whole blob counts
# every bonus twice at two magnitudes; on a real build that turned -90% cold into -115%.
NIGHTS_CHILL = """Night's Chill
Causes foes affected by the Veil of Shadow to feel the dark chill of the night.

Current Level : 8 + 11
135 Cold Damage
-34% Pierce Resistance
-34% Cold Resistance

Next Level : 9 + 11
152 Cold Damage
-35% Pierce Resistance
-35% Cold Resistance
"""
cur = gt.current_block(NIGHTS_CHILL)
check("current block keeps the current rank", "-34% Cold Resistance" in cur, True)
check("current block drops the next rank", "-35% Cold Resistance" in cur, False)
check("only the current rank's RR is read",
      sorted(gt.find_rr(cur)), [("stacking", "Cold", 34), ("stacking", "Pierce", 34)])
check("a tooltip with no rank blocks is passed through",
      gt.current_block("-20% Fire Resistance"), "-20% Fire Resistance")

# A bound celestial power is printed inside the skill's tooltip AND returned by
# dumpDevotion(); counting both reports one source twice.
BURSTING_ROUND = """Bursting Round
Current Level : 1 + 5
20% Chance to be Used

Next Level : 2 + 5
20% Chance to be Used

Celestial Power:
Rumor (15% Chance on Attack)
Current Level : 20 / 20
-23% Cold Resistance
-30% Poison & Acid Resistance
"""
check("the bound power is not read from the skill's tooltip", gt.find_rr(gt.current_block(BURSTING_ROUND)), [])

build = {
    "items": [{"slot": "ring1", "details": "Flash Freeze\n-40% Fire Resistance"}],
    "skills": [{"name": "Night's Chill", "level": 8, "details": NIGHTS_CHILL},
               {"name": "Bursting Round", "level": 1, "details": BURSTING_ROUND},
               {"name": "Unspent", "level": 0, "details": "-99% Cold Resistance"}],
    "devotions": [{"name": "Rumor", "isSkill": True,
                   "details": "Rumor\nCurrent Level : 20 / 20\n-23% Cold Resistance\n"
                              "-30% Poison & Acid Resistance"}],
}
rows = gt.collect_rr(build)
check("Rumor is counted once, as the devotion power",
      [(r["kind"], r["type"], r["value"]) for r in rows if r["value"] == 23],
      [("devotion power", "Cold", 23)])
check("a skill at level 0 contributes nothing",
      any(r["origin"] == "Unspent" for r in rows), False)
check("item RR is picked up", ("item", "Fire", 40) in
      [(r["kind"], r["type"], r["value"]) for r in rows], True)

# Elemental RR is one line that reduces three resistances.
elem = gt.stacking_totals([
    {"pass": "stacking", "kind": "skill", "origin": "Aura of Censure",
     "type": "Elemental", "value": 33},
    {"pass": "stacking", "kind": "skill", "origin": "Night's Chill", "type": "Cold", "value": 34},
])
check("Elemental expands to fire, cold and lightning", sorted(elem), ["Cold", "Fire", "Lightning"])
check("an expanded Elemental source sums with a direct one",
      sum(v for _, v in elem["Cold"]), 67)
check("Elemental is not reported as a damage type of its own", "Elemental" in elem, False)

# The ledger's three passes. The multiplicative pass is skipped once stacking has driven
# the target's resistance to zero, which is what makes multiplicative RR worthless to a
# character who already stacks past every real target.
check("stacking alone drives resistance negative", gt.apply_ledger(80, 90, 0, 0), -10)
check("the multiplicative pass shrinks resistance that is still positive",
      gt.apply_ledger(100, 0, 50, 0), 50.0)
check("the multiplicative pass does nothing once stacking has passed zero",
      gt.apply_ledger(80, 90, 50, 0), -10)
check("the flat pass subtracts even when resistance is already negative",
      gt.apply_ledger(80, 90, 0, 25), -35)
check("all three passes compose in order", gt.apply_ledger(100, 20, 50, 10), 30.0)

# dumpDevotion() names a power star after the power, not its constellation - and Tsunami is
# both a constellation and a power, so splitting by name collapses the whole constellation.
tsunami = {"devotions": [
    {"name": "Tsunami", "isSkill": False}, {"name": "Tsunami", "isSkill": False},
    {"name": "Tsunami", "isSkill": False}, {"name": "Tsunami", "isSkill": False},
    {"name": "Tsunami", "isSkill": True},
]}
stars, powers = gt.split_devotions(tsunami)
check("four plain Tsunami stars survive the split", len(stars), 4)
check("the Tsunami celestial power is the only power", len(powers), 1)

# encodeBitset: LSB-first within each byte, trailing zero bytes trimmed (urlState.ts).
order = [f"s{i}" for i in range(20)]
check("an empty selection encodes to nothing", gt.encode_bitset(set(), order), "")
check("bit 0 is the low bit of byte 0", gt.encode_bitset({"s0"}, order), "AQ")
check("bit 7 is the high bit of byte 0", gt.encode_bitset({"s7"}, order), "gA")
check("bit 8 starts a second byte", gt.encode_bitset({"s8"}, order), "AAE")
check("trailing zero bytes are trimmed, not padded to the canonical length",
      gt.encode_bitset({"s0", "s1"}, order), "Aw")

# Low-health effects are the circuit breakers; the on-hit devotion procs sit alongside them.
cb = gt.circuit_breakers({
    "items": [{"slot": "relic", "details": "Serenity\nLegendary\n[Granted Skills]\n"
                                           "Serenity (Granted by Item)\n"
                                           "Activates when Health drops below 35%\n"
                                           "80 Second Skill Recharge"}],
    "devotions": [{"name": "Giant's Blood", "isSkill": True,
                   "details": "Giant's Blood (15% Chance when Hit)\n5 Second Duration"},
                  {"name": "Tsunami", "isSkill": True,
                   "details": "Tsunami (35% Chance on Attack)"}],
})
names = {c["name"]: c["trigger"] for c in cb}
check("a low-health relic proc is found with its threshold",
      names.get("Serenity"), "health below 35%")
check("an on-hit devotion proc is reported alongside it",
      names.get("Giant's Blood"), "15% when hit")
check("an on-attack proc is not a circuit breaker", "Tsunami" in names, False)

print("FAILURES:", failures)
raise SystemExit(1 if failures else 0)
