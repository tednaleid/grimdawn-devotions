#!/usr/bin/env -S uv run --script
# ABOUTME: Tests for gditems_core pure logic. Run: uv run scripts/test_gditems_core.py
# ABOUTME: Covers tier collapse, level filtering, scoring, and grimtools link construction.
# /// script
# requires-python = ">=3.10"
# dependencies = ["lzstring"]
# ///
import importlib.util
from pathlib import Path

here = Path(__file__).parent
spec = importlib.util.spec_from_file_location("core", here / "gditems_core.py")
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)

failures = 0
def check(name, got, want):
    global failures
    if got != want:
        failures += 1
        print(f"  FAIL {name}: got {got!r}, want {want!r}")
    else:
        print(f"  ok   {name}")

def cand(record, group_key, name, item_level, req_level, **kw):
    return core.Candidate(
        record=record, group_key=group_key, name=name, item_level=item_level,
        req_level=req_level, rarity=kw.get("rarity", "Epic"),
        slots=kw.get("slots", ("feet",)), source=kw.get("source", "unknown"),
        stat_values=kw.get("stat_values", {}), skill_boosts=kw.get("skill_boosts", {}),
        mastery_boosts=kw.get("mastery_boosts", {}),
        granted_skills=kw.get("granted_skills", ()), conversions=kw.get("conversions", ()))

# The three Sellecor's March records are one family at three levels.
base = cand("r/base", "fam1", "Sellecor's March", 30, 25)
emp = cand("r/emp", "fam1", "Empowered Sellecor's March", 65, 60)
myth = cand("r/myth", "fam1", "Mythical Sellecor's March", 84, 80)
fam = [base, emp, myth]

groups = core.collapse_tiers(fam, level=None)
check("collapse yields one family", len(groups), 1)
check("family carries every tier, strongest first",
      [c.record for c in groups[0]], ["r/myth", "r/emp", "r/base"])

groups = core.collapse_tiers(fam, level=70)
check("level 70 makes the empowered tier the headline", groups[0][0].record, "r/emp")
check("level 70 drops the tier the character cannot equip",
      "r/myth" in [c.record for c in groups[0]], False)

groups = core.collapse_tiers(fam, level=20)
check("level below every requirement drops the family entirely", groups, [])

src = (here / "gditems_core.py").read_text(encoding="utf-8")
for banned in ("import duckdb", "import argparse", "open(", "requests"):
    check(f"core stays pure: no {banned}", banned in src, False)

# criteria_criterion_names: one stable label per criterion the caller actually passed.
# Only the scored dimensions produce labels; scope flags (domain, slot, gear_type,
# rarity, expansion, source, fits, level, all_tiers, limit) never filter into scoring
# and so contribute nothing here.
def criteria(**kw):
    defaults = dict(
        domains=(), slots=(), gear_types=(), rarities=(), expansions=(), sources=(),
        fits=None, level=None, all_tiers=False, stats=(), converts_to=None,
        min_convert=None, grants_skills=(), boosts_skills=(), boosts_masteries=(),
        masteries=(), limit=20)
    defaults.update(kw)
    return core.Criteria(**defaults)

check("no criteria given yields no labels", core.criteria_criterion_names(criteria()), [])

full = criteria(
    stats=(core.StatCriterion("Physique", 100), core.StatCriterion("Cunning", 50)),
    converts_to="Fire", min_convert=25,
    grants_skills=("Blast Nova",),
    boosts_skills=("Blitz",),
    boosts_masteries=("Demolitionist",),
    masteries=("Nightblade",))
check("one label per criterion instance, stable order", core.criteria_criterion_names(full), [
    "stat:Physique", "stat:Cunning", "converts_to:Fire", "grants_skill:Blast Nova",
    "boosts_skill:Blitz", "boosts_mastery:Demolitionist", "mastery:Nightblade"])

check("scope flags never produce a label",
      core.criteria_criterion_names(criteria(
          domains=("gear",), slots=("chest",), gear_types=("armor",),
          rarities=("Epic",), expansions=("AoM",), sources=("vendor",),
          fits="chest", level=70, all_tiers=True, limit=5)),
      [])

# score: relative normalisation, mastery fallback, and "kept, not dropped" for misses.
crit = core.Criteria(
    domains=("gear",), slots=(), gear_types=(), rarities=(), expansions=(), sources=(),
    fits=None, level=None, all_tiers=False,
    stats=(core.StatCriterion(family="damage.pierce", minimum=None),),
    converts_to=None, min_convert=None, grants_skills=(),
    boosts_skills=("records/skills/playerclass04/shadowstrike.dbr",),
    boosts_masteries=(), masteries=(), limit=10)

strong = cand("r/strong", "f1", "Strong", 84, 80,
              stat_values={"damage.pierce": 40.0},
              skill_boosts={"records/skills/playerclass04/shadowstrike.dbr": 3})
weak = cand("r/weak", "f2", "Weak", 84, 80,
            stat_values={"damage.pierce": 20.0},
            skill_boosts={"records/skills/playerclass04/shadowstrike.dbr": 1})
generalist = cand("r/gen", "f3", "Generalist", 84, 80,
                  stat_values={"damage.pierce": 20.0},
                  mastery_boosts={"records/skills/playerclass04/_classtraining_class04.dbr": 3})
nostat = cand("r/none", "f4", "Nothing", 84, 80)

ranked = core.score([weak, strong, generalist, nostat], crit, None)
check("best item ranks first", ranked[0].candidate.record, "r/strong")
check("item matching nothing is kept, not dropped", "r/none" in [r.candidate.record for r in ranked], True)
check("item matching nothing scores zero", ranked[-1].total, 0.0)

by_rec = {r.candidate.record: r for r in ranked}
check("normalisation is relative to the best candidate",
      by_rec["r/strong"].parts[0].normalised, 1.0)
check("half the best value normalises to half",
      by_rec["r/weak"].parts[0].normalised, 0.5)

gen_skill = [p for p in by_rec["r/gen"].parts if p.name.startswith("boosts_skill")][0]
check("mastery boost counts toward a skill criterion", gen_skill.raw > 0, True)
check("mastery boost is discounted against a direct hit",
      gen_skill.normalised < by_rec["r/strong"].parts[1].normalised, True)
check("mastery fallback explains itself", "mastery" in gen_skill.note.lower(), True)

print("FAILURES:", failures)
raise SystemExit(1 if failures else 0)
