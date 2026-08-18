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
assert spec and spec.loader
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


# Cushions decide where gear budget is wasted and where it is load-bearing, so the verdict
# has to key off the sustained state rather than the as-shared one, and a resistance that is
# not at its cap at all must never read as merely thin.
def state(over_by_res):
    return {s: {"header": s, "stats": {},
                "overcap": {r: {"shown": v[1], "over": v[0][i]}
                            for r, v in over_by_res.items()}}
            for i, s in enumerate(("asShared", "sustained", "everything"))}

rep = {r["resistance"]: r for r in gt.resistance_report({"states": state({
    "resFire":     ((75, 126, 161), "80%"),
    "resPoison":   ((29, 29, 64), "80%"),
    "resAether":   ((50, 85, 120), "80%"),
    "resPhysical": ((0, 0, 0), "12%"),
})})}
check("a cushion far past the useful target is reclaimable budget",
      rep["resFire"]["verdict"], "reclaimable")
check("a cushion under the useful target is on the line",
      rep["resPoison"]["verdict"], "on the line")
check("a healthy cushion is neither", rep["resAether"]["verdict"], "comfortable")
check("a resistance below its cap is called out, not treated as a thin cushion",
      rep["resPhysical"]["verdict"], "UNDER CAP")
check("the verdict follows the sustained state, not the as-shared one",
      gt.resistance_report({"states": state({"r": ((5, 90, 90), "80%")})})[0]["verdict"],
      "reclaimable")
check("every captured state is carried through for display",
      sorted(rep["resFire"]["over"]), ["asShared", "everything", "sustained"])
check("a missing overcap cell is skipped rather than scored as zero",
      gt.resistance_report({"states": {"sustained": {"overcap": {"resFire": None}}}}), [])


# --- end to end: the real matcher over real devotion data --------------------------------
# The unit checks above cannot catch a mismatch between the matcher and the shape of
# data/devotions.json, which is what actually broke: name-based power resolution looked
# perfectly healthy and silently dropped four stars.
import base64  # noqa: E402
import json  # noqa: E402

repo = here.parent
devotions = json.loads((repo / "data/devotions.json").read_text(encoding="utf-8"))
game = json.loads((repo / "data/i18n/game.en.json").read_text(encoding="utf-8"))
text = game.get("tags", game)
fixture = json.loads((here / "fixtures/gt-devotions-infiltrator.json").read_text(encoding="utf-8"))
build = {"devotions": fixture["devotions"]}

selected, unmatched, canonical = gt.map_devotions(build, devotions, text)
check("every scraped star maps to one of ours", len(selected), len(fixture["devotions"]))
check("nothing is left unmatched", unmatched, [])
check("no star id is claimed twice", len(selected), len(set(selected)))
check("canonical order covers the whole model, not just the taken stars",
      len(canonical) > len(selected), True)
check("every selected id exists in the canonical order",
      sorted(set(selected) - set(canonical)), [])

by_constellation = {}
for sid in selected:
    by_constellation[sid.split(":")[0]] = by_constellation.get(sid.split(":")[0], 0) + 1
# Independently confirmed by decoding the generated hash with the app's own decodeHash
# and buildModel, rather than by re-running this matcher.
check("per-constellation counts match the app's own decode of the hash",
      dict(sorted(by_constellation.items())),
      {"amatok_the_spirit_of_winter": 7, "behemoth": 6, "chariot_of_the_dead": 6,
       "hammer": 3, "hydra": 6, "murmur_mistress_of_rumors": 6, "rhowan_s_crown": 5,
       "solemn_watcher": 5, "tsunami": 5, "ulo_the_keeper_of_the_waters": 5,
       "ultos_shepherd_of_storms": 1})

# The regression that motivated isSkill: Tsunami names both a constellation and a celestial
# power, and resolving powers by name collapsed all five of its stars onto the power star.
check("a constellation sharing its name with a power keeps all of its stars",
      by_constellation["tsunami"], 5)
# Partial constellations are the ones the magnitude matcher actually has to decide.
check("a partially taken constellation takes only what was taken",
      (by_constellation["chariot_of_the_dead"], by_constellation["ultos_shepherd_of_storms"]),
      (6, 1))

bits = gt.encode_bitset(selected, canonical)
def decode_bitset(blob, order):
    raw = base64.urlsafe_b64decode(blob + "=" * (-len(blob) % 4))
    return {k for i, k in enumerate(order) if i // 8 < len(raw) and raw[i // 8] >> (i % 8) & 1}
check("the hash round-trips back to exactly the same stars", decode_bitset(bits, canonical), selected)
check("the encoded hash is byte-for-byte the one verified against the planner", bits,
      "AAAAAAAAAAAAOAAAAAAAAAAAAAAAHwAAAIA_AAD8AADuAAAAPwAAAPAD4AMAAD4AAAAfAAAAAAAAAAAAAAAAAACA")

print("FAILURES:", failures)
raise SystemExit(1 if failures else 0)
