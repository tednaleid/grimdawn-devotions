#!/usr/bin/env -S uv run --script
# ABOUTME: Tests for parse_monsters extraction. Run: uv run scripts/test_parse_monsters.py
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

mon = load("mon", "parse_monsters.py")

failures = 0
def check(name, cond):
    global failures
    if cond:
        print(f"  ok   {name}")
    else:
        failures += 1
        print(f"  FAIL {name}")

# --- Task 1: role classification ---
check("role from nemesis dir", mon.role_of("enemies/nemesis/nemesis_aetherial_01.dbr") == "nemesis")
check("role from hero dir", mon.role_of("enemies/hero/foo_a01.dbr") == "hero")
check("role boss&quest", mon.role_of("enemies/boss&quest/loghorrean_03.dbr") == "boss&quest")
check("waveevents normalizes to waveevent", mon.role_of("enemies/waveevents/x.dbr") == "waveevent")
check("waveevent stays waveevent", mon.role_of("enemies/waveevent/x.dbr") == "waveevent")
check("bare enemies dir is base", mon.role_of("enemies/aetherelemental_a01.dbr") == "base")
check("role match is case-insensitive", mon.role_of("enemies/NEMESIS/x.dbr") == "nemesis")
check("partial dir name does not match", mon.role_of("enemies/heroic_things/x.dbr") == "base")

# --- Task 1: resistances always carry all ten keys ---
TEN = ["physical","pierce","fire","cold","lightning","poison","aether","chaos","vitality","bleeding"]
res = mon.resistances_of({"defensiveFire": "20.000000", "defensiveAether": "50.000000"})
check("resistances has exactly the ten keys", list(res.keys()) == TEN)
check("absent resistance is explicit 0", res["cold"] == 0 and res["bleeding"] == 0)
check("present resistance parsed as int", res["fire"] == 20 and res["aether"] == 50)
check("vitality reads defensiveLife", mon.resistances_of({"defensiveLife": "25.0"})["vitality"] == 25)
check("negative resistance preserved", mon.resistances_of({"defensiveFire": "-25.0"})["fire"] == -25)
check("fractional resistance kept as float", mon.resistances_of({"defensiveCold": "12.5"})["cold"] == 12.5)
check("non-numeric resistance falls back to 0", mon.resistances_of({"defensiveFire": "abc"})["fire"] == 0)

# --- Task 1: exclusion rules, in order ---
TAGS = {"tagOk": "Real Monster"}
def rec(**kw):
    base = {"Class": "Monster", "description": "tagOk", "monsterClassification": "Common"}
    base.update(kw)
    return base

check("a good record is kept", mon.exclusion_reason("enemies/x.dbr", rec(), TAGS) is None)
check("non-monster excluded", mon.exclusion_reason("enemies/x.dbr", rec(Class="ProxyPool"), TAGS) == "not a monster record")
check("hiddenFromCombat excluded", mon.exclusion_reason("enemies/x.dbr", rec(hiddenFromCombat="1"), TAGS) == "hidden from combat")
check("hiddenFromCombat zero is kept", mon.exclusion_reason("enemies/x.dbr", rec(hiddenFromCombat="0"), TAGS) is None)
check("invincible excluded", mon.exclusion_reason("enemies/x.dbr", rec(invincible="1"), TAGS) == "invincible")
check("missing description excluded", mon.exclusion_reason("enemies/x.dbr", rec(description=""), TAGS) == "no resolvable name")
check("unresolvable description excluded", mon.exclusion_reason("enemies/x.dbr", rec(description="tagMissing"), TAGS) == "no resolvable name")
check("devotion role excluded", mon.exclusion_reason("enemies/devotion/x.dbr", rec(), TAGS) == "devotion role")
check("missing classification excluded", mon.exclusion_reason("enemies/x.dbr", rec(monsterClassification=""), TAGS) == "no classification")
check("unknown classification excluded", mon.exclusion_reason("enemies/x.dbr", rec(monsterClassification="Prop"), TAGS) == "no classification")
for c in ("Common", "Champion", "Hero", "Boss", "SuperBoss", "Quest"):
    check(f"classification {c} is valid", mon.exclusion_reason("enemies/x.dbr", rec(monsterClassification=c), TAGS) is None)
check("rule order: non-monster reported before devotion role",
      mon.exclusion_reason("enemies/devotion/x.dbr", rec(Class="ProxyPool"), TAGS) == "not a monster record")

# --- Task 2: id derivation ---
check("id drops the .dbr suffix and flattens separators",
      mon.monster_id("enemies/nemesis/nemesis_aetherial_01.dbr") == "enemies.nemesis.nemesis_aetherial_01")
check("id sanitizes characters that are unsafe in a URL hash",
      mon.monster_id("enemies/boss&quest/loghorrean_03.dbr") == "enemies.boss-quest.loghorrean_03")

# --- Task 2: race tag resolution ---
RACE_TAGS = {"tagRace005": "Aether Corruption"}
check("race tag resolves", mon.race_tag_of({"characterRacialProfile": "Race005"}, RACE_TAGS) == "tagRace005")
check("unresolvable race tag is dropped", mon.race_tag_of({"characterRacialProfile": "Race099"}, RACE_TAGS) is None)
check("absent race profile is None", mon.race_tag_of({}, RACE_TAGS) is None)
check("malformed race profile is None", mon.race_tag_of({"characterRacialProfile": "Bogus"}, RACE_TAGS) is None)

# --- Task 2: collapse to the logical grain ---
def crec(maxlv, minlv=1, **kw):
    base = {"Class": "Monster", "description": "tagOk", "monsterClassification": "Common",
            "maxLevel": str(maxlv), "minLevel": str(minlv)}
    base.update(kw)
    return base

groups = {
    ("Aetherial Bloater", "Common"): [
        ("enemies/bloater_a01.dbr", crec(30, defensiveFire="10")),
        ("enemies/bloater_c01.dbr", crec(90, defensiveFire="10")),
        ("enemies/bloater_b01.dbr", crec(60, defensiveFire="10")),
    ],
    ("Solo Beast", "Hero"): [("enemies/hero/solo.dbr", crec(50, defensiveCold="8"))],
}
logical = mon.collapse_to_logical(groups, RACE_TAGS)
by_name = {m["id"]: m for m in logical}
check("one logical monster per (name, classification)", len(logical) == 2)
bloater = [m for m in logical if m["variant_count"] == 3][0]
check("representative is the highest maxLevel", bloater["id"] == "enemies.bloater_c01")
check("variant_count counts every collapsed record", bloater["variant_count"] == 3)
check("record_paths lists every collapsed record, representative first",
      bloater["record_paths"][0] == "records/creatures/enemies/bloater_c01.dbr"
      and len(bloater["record_paths"]) == 3)
check("agreeing variants are not flagged", bloater["variants_disagree"] is False)
check("classification carried through", bloater["classification"] == "Common")
check("role carried through", by_name["enemies.hero.solo"]["role"] == "hero")
check("output is sorted by id", [m["id"] for m in logical] == sorted(m["id"] for m in logical))
check("every logical monster carries all ten resistance keys",
      all(list(m["resistances"].keys()) == TEN for m in logical))

# maxLevel ties break on minLevel, then on path
tie = mon.collapse_to_logical({("Tie", "Common"): [
    ("enemies/b.dbr", crec(90, 10)),
    ("enemies/a.dbr", crec(90, 40)),
]}, RACE_TAGS)
check("maxLevel tie breaks on higher minLevel", tie[0]["id"] == "enemies.a")
tie2 = mon.collapse_to_logical({("Tie", "Common"): [
    ("enemies/z.dbr", crec(90, 10)),
    ("enemies/a.dbr", crec(90, 10)),
]}, RACE_TAGS)
check("full tie breaks on lowest path", tie2[0]["id"] == "enemies.a")

# disagreement detection
dis = mon.collapse_to_logical({("Dis", "Common"): [
    ("enemies/x_a01.dbr", crec(90, defensiveFire="10")),
    ("enemies/x_b01.dbr", crec(50, defensiveFire="40")),
]}, RACE_TAGS)
check("disagreeing variants are flagged", dis[0]["variants_disagree"] is True)
check("disagreement still reports the representative's values", dis[0]["resistances"]["fire"] == 10)

# summon flag
summ = mon.collapse_to_logical({("S", "Common"): [("enemies/x_a01_summon.dbr", crec(20))]}, RACE_TAGS)
check("summon records are flagged", summ[0]["is_summon"] is True)
check("non-summon records are not flagged", tie[0]["is_summon"] is False)

# --- role/summon facet disagreement across collapsed members (fix B) ---
role_dis = mon.collapse_to_logical({("R", "Common"): [
    ("enemies/hero/r_a01.dbr", crec(90)),
    ("enemies/special/r_b01.dbr", crec(50)),
]}, RACE_TAGS)
check("members_disagree_on_role true when collapsed paths span roles",
      mon.members_disagree_on_role(role_dis[0]) is True)
check("members_disagree_on_summon false when none of the paths differ on summon status",
      mon.members_disagree_on_summon(role_dis[0]) is False)

summon_dis = mon.collapse_to_logical({("S2", "Common"): [
    ("enemies/s_a01.dbr", crec(90)),
    ("enemies/s_a01_summon.dbr", crec(50)),
]}, RACE_TAGS)
check("members_disagree_on_summon true when collapsed paths mix summon status",
      mon.members_disagree_on_summon(summon_dis[0]) is True)
check("members_disagree_on_role false for a single-role group",
      mon.members_disagree_on_role(summon_dis[0]) is False)

agree = mon.collapse_to_logical({("A", "Common"): [
    ("enemies/a_a01.dbr", crec(90)),
    ("enemies/a_b01.dbr", crec(50)),
]}, RACE_TAGS)
check("members_disagree_on_role false when every collapsed path shares a role",
      mon.members_disagree_on_role(agree[0]) is False)
check("members_disagree_on_summon false when every collapsed path shares summon status",
      mon.members_disagree_on_summon(agree[0]) is False)

# --- Task 3: difficulty array splitting ---
twelve = ";".join(str(float(n)) for n in [0,0,0,0, 4,6,8,11, 8,10,13,16])
split = mon.split_difficulty_array(twelve)
check("split has the three difficulties", sorted(split.keys()) == ["elite", "normal", "ultimate"])
check("split has the four player brackets", sorted(split["elite"].keys()) == ["1", "2", "3", "4"])
check("normal bracket values", [split["normal"][p] for p in "1234"] == [0, 0, 0, 0])
check("elite bracket values", [split["elite"][p] for p in "1234"] == [4, 6, 8, 11])
check("ultimate bracket values", [split["ultimate"][p] for p in "1234"] == [8, 10, 13, 16])
check("a scalar broadcasts to every cell",
      mon.split_difficulty_array("5.000000")["ultimate"]["4"] == 5
      and mon.split_difficulty_array("5.000000")["normal"]["1"] == 5)
check("a wrong-length array is rejected", mon.split_difficulty_array("1.0;2.0;3.0") is None)
check("an empty value is rejected", mon.split_difficulty_array("") is None)
check("a None value is rejected", mon.split_difficulty_array(None) is None)
check("a non-numeric entry is rejected", mon.split_difficulty_array(";".join(["x"] * 12)) is None)

# --- Task 3: offsets read from the real records ---
db = mon.DB((root / "extracted/records").resolve())
check("scaler ref resolves through gameengine.dbr",
      mon.scaler_ref(db).endswith("balancingadjustment_mp+difficulty_enemies01.dbr"))
offs = mon.difficulty_offsets(db)
check("offsets cover the three difficulties", sorted(offs.keys()) == ["elite", "normal", "ultimate"])
check("offsets cover the four player brackets", sorted(offs["ultimate"].keys()) == ["1", "2", "3", "4"])
check("every offset cell carries all ten resistance keys",
      all(list(offs[d][p].keys()) == TEN for d in offs for p in offs[d]))
check("real ultimate fire offsets match the scaler record",
      [offs["ultimate"][p]["fire"] for p in "1234"] == [8, 10, 13, 16])
check("real elite fire offsets match the scaler record",
      [offs["elite"][p]["fire"] for p in "1234"] == [4, 6, 8, 11])
check("normal adds no fire offset", [offs["normal"][p]["fire"] for p in "1234"] == [0, 0, 0, 0])
check("bleeding gains its resistance from difficulty alone",
      offs["ultimate"]["4"]["bleeding"] > 0)

# --- difficulty offset parse failures are recorded, not silently defaulted (fix A) ---
class FakeDB:
    def __init__(self, records):
        self.records = records
    def get(self, ref):
        return self.records.get(ref.replace("\\", "/").strip(), {})

good12 = ";".join(["1.0"] * 12)
fake_rec = {field: good12 for field in mon.RESISTANCE_FIELDS.values()}
fake_rec["defensiveFire"] = "1.0;2.0;3.0"  # wrong arity: neither 1 nor 12
fake_db = FakeDB({
    mon.GAMEENGINE_REF: {"monsterAttributePak": mon.SCALER_FALLBACK},
    mon.SCALER_FALLBACK: fake_rec,
})
before_failures = list(mon.FAILED_OFFSET_FIELDS)
fake_offs = mon.difficulty_offsets(fake_db)
new_failures = mon.FAILED_OFFSET_FIELDS[len(before_failures):]
check("a bad-arity field is recorded as failed", new_failures == ["fire"])
check("a bad-arity field still defaults its offset to 0", fake_offs["ultimate"]["4"]["fire"] == 0)
check("a good-arity field is not recorded as failed", "cold" not in new_failures)
check("a good-arity field keeps its real parsed value", fake_offs["normal"]["1"]["cold"] == 1)

# --- Task 4: run the real parser over the extracted tree ---
out = Path(tempfile.mkdtemp()) / "monsters.json"
rc = subprocess.run([sys.executable, str(here / "parse_monsters.py"),
    "--records-dir", str(root / "extracted/records"),
    "--text-dir", str(root / "extracted/text_en"),
    "--out", str(out), "--game-version", "test"]).returncode
check("parser exits 0", rc == 0)
doc = json.loads(out.read_text(encoding="utf-8"))
check("has meta.game_version", doc["meta"]["game_version"] == "test")
check("has meta.generated_utc", bool(doc["meta"].get("generated_utc")))
check("monsters is a list", isinstance(doc["monsters"], list))
check("difficulty_offsets present", isinstance(doc["difficulty_offsets"], dict))

monsters = doc["monsters"]
# Data-derived counts: bands, not equality, so a balance patch does not fail the suite.
check(f"logical monster count in band (got {len(monsters)})", 1400 <= len(monsters) <= 1900)
check("ids are unique", len({m["id"] for m in monsters}) == len(monsters))
check("every monster carries all ten resistance keys",
      all(list(m["resistances"].keys()) == TEN for m in monsters))
check("no monster stores display text",
      all(m["name_tag"].startswith("tag") for m in monsters))
check("every classification is one of the six valid values",
      {m["classification"] for m in monsters} <= set(mon.VALID_CLASSIFICATIONS))
check("no devotion-role monster survives", not any(m["role"] == "devotion" for m in monsters))
check("no monster has a null classification", all(m["classification"] for m in monsters))
check("raw records collapsed in band",
      1400 <= sum(m["variant_count"] for m in monsters) <= 3200)
disagreeing = [m for m in monsters if m["variants_disagree"]]
check(f"disagreeing groups stay a small minority (got {len(disagreeing)})",
      len(disagreeing) <= len(monsters) // 10)
check("summons are present and flagged", any(m["is_summon"] for m in monsters))
check("nemesis role is present", any(m["role"] == "nemesis" for m in monsters))

# Valdaran (nemesis_aetherial_01) is the fixture from the spec.
val = [m for m in monsters if m["id"] == "enemies.nemesis.nemesis_aetherial_01"]
check("valdaran present", len(val) == 1)
check("valdaran resistances match the record",
      val and val[0]["resistances"]["fire"] == 20 and val[0]["resistances"]["lightning"] == 50
      and val[0]["resistances"]["aether"] == 50 and val[0]["resistances"]["poison"] == 20
      and val[0]["resistances"]["cold"] == 0)
check("valdaran classification and role", val and val[0]["classification"] == "Boss" and val[0]["role"] == "nemesis")
check("valdaran level range", val and val[0]["min_level"] == 60 and val[0]["max_level"] == 250)
check("valdaran race tag", val and val[0]["race_tag"] == "tagRace005")

# --- Task 4: determinism ---
out2 = Path(tempfile.mkdtemp()) / "monsters2.json"
subprocess.run([sys.executable, str(here / "parse_monsters.py"),
    "--records-dir", str(root / "extracted/records"),
    "--text-dir", str(root / "extracted/text_en"),
    "--out", str(out2), "--game-version", "test"], check=True)
doc2 = json.loads(out2.read_text(encoding="utf-8"))
check("deterministic across runs", doc["monsters"] == doc2["monsters"])
check("deterministic offsets across runs", doc["difficulty_offsets"] == doc2["difficulty_offsets"])

# --- Task 1 (passives): skill level pinning ---
check("skill level reads the pinned rank", mon._skill_level({"skillLevel3": "4.000000"}, "3") == 4)
check("absent skill level defaults to 1", mon._skill_level({}, "3") == 1)
check("unparseable skill level defaults to 1", mon._skill_level({"skillLevel3": "abc"}, "3") == 1)
check("zero skill level defaults to 1", mon._skill_level({"skillLevel3": "0"}, "3") == 1)

# --- Task 1 (passives): contribution bucketing by skill Class ---
SKILLS = {
    "records/skills/np/passive.dbr": {"Class": "Skill_Passive", "defensiveBleeding": "100.000000"},
    "records/skills/np/buffpassive.dbr": {"Class": "SkillBuff_Passive", "defensiveFire": "10.000000"},
    "records/skills/np/onlife.dbr": {"Class": "Skill_PassiveOnLifeBuffSelf", "defensiveChaos": "7.000000"},
    "records/skills/np/aura.dbr": {"Class": "Skill_BuffAttackRadiusToggled", "defensiveCold": "20.000000"},
    "records/skills/np/toggled.dbr": {"Class": "Skill_BuffSelfToggled", "defensiveCold": "5.000000"},
    "records/skills/np/duration.dbr": {"Class": "Skill_BuffSelfDuration", "defensiveAether": "9.000000"},
    "records/skills/np/minion.dbr": {"Class": "Monster", "defensivePhysical": "50.000000"},
    "records/skills/np/turret.dbr": {"Class": "Turret", "defensivePierce": "50.000000"},
    "records/skills/np/weird.dbr": {"Class": "AttributePak", "defensiveVitalityBogus": "1", "defensiveLife": "40.000000"},
    "records/skills/np/levelled.dbr": {"Class": "Skill_Passive", "defensiveBleeding": "10.000000;20.000000;30.000000"},
    "records/skills/np/nores.dbr": {"Class": "Skill_Passive", "characterLife": "500.000000"},
}
get_skill = lambda ref: SKILLS.get(ref.strip(), {})

def contrib(skills_and_levels):
    rec = {}
    for i, (ref, lvl) in enumerate(skills_and_levels, start=1):
        rec[f"skillName{i}"] = ref
        if lvl is not None:
            rec[f"skillLevel{i}"] = str(lvl)
    return mon.skill_contributions("enemies/x.dbr", rec, get_skill)

before = len(mon.SKILL_EXCLUSIONS)
p, a = contrib([("records/skills/np/passive.dbr", 1)])
check("self passive contributes to the passive bucket", p == {"bleeding": 100} and a == {})
p, a = contrib([("records/skills/np/buffpassive.dbr", 1)])
check("SkillBuff_Passive is resident", p == {"fire": 10})
p, a = contrib([("records/skills/np/onlife.dbr", 1)])
check("Skill_PassiveOnLifeBuffSelf is resident", p == {"chaos": 7})
p, a = contrib([("records/skills/np/aura.dbr", 1)])
check("aura class goes to the aura bucket only", a == {"cold": 20} and p == {})
p, a = contrib([("records/skills/np/toggled.dbr", 1)])
check("toggled class goes to the aura bucket only", a == {"cold": 5} and p == {})
p, a = contrib([("records/skills/np/duration.dbr", 1)])
check("duration class goes to the aura bucket only", a == {"aether": 9} and p == {})
p, a = contrib([("records/skills/np/minion.dbr", 1)])
check("summoned entity contributes nothing", p == {} and a == {})
p, a = contrib([("records/skills/np/turret.dbr", 1)])
check("turret contributes nothing", p == {} and a == {})
p, a = contrib([("records/skills/np/weird.dbr", 1)])
check("unclassified class contributes nothing", p == {} and a == {})
check("skipped skills carrying a resistance are recorded",
      len(mon.SKILL_EXCLUSIONS) - before == 3)
check("skip reasons name summoned entity and unclassified",
      {"summoned entity"} <= {e["reason"] for e in mon.SKILL_EXCLUSIONS[before:]}
      and any(e["reason"].startswith("unclassified skill class") for e in mon.SKILL_EXCLUSIONS[before:]))

# a skill with no tracked resistance is not recorded as an exclusion
before2 = len(mon.SKILL_EXCLUSIONS)
contrib([("records/skills/np/nores.dbr", 1)])
check("a resistance-free skill is not recorded as skipped", len(mon.SKILL_EXCLUSIONS) == before2)

# level pinning against a real array, and clamping past its end
p, _ = contrib([("records/skills/np/levelled.dbr", 2)])
check("level array picks the pinned entry", p == {"bleeding": 20})
p, _ = contrib([("records/skills/np/levelled.dbr", 99)])
check("level array clamps to the last entry", p == {"bleeding": 30})
p, _ = contrib([("records/skills/np/levelled.dbr", None)])
check("missing skill level uses rank 1", p == {"bleeding": 10})

# additive across multiple skills
p, _ = contrib([("records/skills/np/passive.dbr", 1), ("records/skills/np/levelled.dbr", 3)])
check("contributions add across skills", p == {"bleeding": 130})

# --- Task 1 (passives): combining with inline values ---
check("tidy drops zero entries", mon._tidy({"fire": 0, "cold": 5}) == {"cold": 5})
check("tidy keeps whole numbers whole", mon._tidy({"cold": 5.0})["cold"] == 5)

rec_inline = {"defensiveFire": "10.000000", "skillName1": "records/skills/np/buffpassive.dbr", "skillLevel1": "1"}
res = mon.resolved_resistances("enemies/x.dbr", rec_inline, get_skill)
check("passive stacks on a nonzero inline value", res["resistances"]["fire"] == 20)
check("combined keeps all ten keys", list(res["resistances"].keys()) == TEN)
check("passive provenance is sparse", res["passive"] == {"fire": 10})
check("aura provenance is empty when unused", res["aura"] == {})

rec_aura = {"defensiveCold": "10.000000", "skillName1": "records/skills/np/aura.dbr", "skillLevel1": "1"}
res_a = mon.resolved_resistances("enemies/x.dbr", rec_aura, get_skill)
check("aura is NOT folded into the total", res_a["resistances"]["cold"] == 10)
check("aura provenance is recorded", res_a["aura"] == {"cold": 20})

print("FAILURES:", failures)
raise SystemExit(1 if failures else 0)
