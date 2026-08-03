#!/usr/bin/env -S uv run --script
# ABOUTME: Tests for parse_monsters extraction. Run: uv run scripts/test_parse_monsters.py
# ABOUTME: Covers role/exclusion rules, id and race-tag derivation, difficulty offsets, and skill-granted resistance bucketing.
# /// script
# requires-python = ">=3.10"
# ///
import contextlib, importlib.util, io, json, subprocess, sys, tempfile
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

# None of the fixtures below carry skillName fields, so the resolved map is just
# each record's inline resistances with no passive/aura provenance.
def resolved_of(groups):
    return {rel_path: {"resistances": mon.resistances_of(rec), "passive": {}, "aura": {}}
            for members in groups.values() for rel_path, rec in members}

groups = {
    ("Aetherial Bloater", "Common"): [
        ("enemies/bloater_a01.dbr", crec(30, defensiveFire="10")),
        ("enemies/bloater_c01.dbr", crec(90, defensiveFire="10")),
        ("enemies/bloater_b01.dbr", crec(60, defensiveFire="10")),
    ],
    ("Solo Beast", "Hero"): [("enemies/hero/solo.dbr", crec(50, defensiveCold="8"))],
}
logical = mon.collapse_to_logical(groups, RACE_TAGS, resolved_of(groups))
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
tie_groups = {("Tie", "Common"): [
    ("enemies/b.dbr", crec(90, 10)),
    ("enemies/a.dbr", crec(90, 40)),
]}
tie = mon.collapse_to_logical(tie_groups, RACE_TAGS, resolved_of(tie_groups))
check("maxLevel tie breaks on higher minLevel", tie[0]["id"] == "enemies.a")
tie2_groups = {("Tie", "Common"): [
    ("enemies/z.dbr", crec(90, 10)),
    ("enemies/a.dbr", crec(90, 10)),
]}
tie2 = mon.collapse_to_logical(tie2_groups, RACE_TAGS, resolved_of(tie2_groups))
check("full tie breaks on lowest path", tie2[0]["id"] == "enemies.a")

# disagreement detection
dis_groups = {("Dis", "Common"): [
    ("enemies/x_a01.dbr", crec(90, defensiveFire="10")),
    ("enemies/x_b01.dbr", crec(50, defensiveFire="40")),
]}
dis = mon.collapse_to_logical(dis_groups, RACE_TAGS, resolved_of(dis_groups))
check("disagreeing variants are flagged", dis[0]["variants_disagree"] is True)
check("disagreement still reports the representative's values", dis[0]["resistances"]["fire"] == 10)

# summon flag
summ_groups = {("S", "Common"): [("enemies/x_a01_summon.dbr", crec(20))]}
summ = mon.collapse_to_logical(summ_groups, RACE_TAGS, resolved_of(summ_groups))
check("summon records are flagged", summ[0]["is_summon"] is True)
check("non-summon records are not flagged", tie[0]["is_summon"] is False)

# --- role/summon facet disagreement across collapsed members (fix B) ---
role_dis_groups = {("R", "Common"): [
    ("enemies/hero/r_a01.dbr", crec(90)),
    ("enemies/special/r_b01.dbr", crec(50)),
]}
role_dis = mon.collapse_to_logical(role_dis_groups, RACE_TAGS, resolved_of(role_dis_groups))
check("members_disagree_on_role true when collapsed paths span roles",
      mon.members_disagree_on_role(role_dis[0]) is True)
check("members_disagree_on_summon false when none of the paths differ on summon status",
      mon.members_disagree_on_summon(role_dis[0]) is False)

summon_dis_groups = {("S2", "Common"): [
    ("enemies/s_a01.dbr", crec(90)),
    ("enemies/s_a01_summon.dbr", crec(50)),
]}
summon_dis = mon.collapse_to_logical(summon_dis_groups, RACE_TAGS, resolved_of(summon_dis_groups))
check("members_disagree_on_summon true when collapsed paths mix summon status",
      mon.members_disagree_on_summon(summon_dis[0]) is True)
check("members_disagree_on_role false for a single-role group",
      mon.members_disagree_on_role(summon_dis[0]) is False)

agree_groups = {("A", "Common"): [
    ("enemies/a_a01.dbr", crec(90)),
    ("enemies/a_b01.dbr", crec(50)),
]}
agree = mon.collapse_to_logical(agree_groups, RACE_TAGS, resolved_of(agree_groups))
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

# Everything from here on reads the extracted game tree, which comes from a local install
# via `just extract` and is never in git. The pure checks above still gate everywhere.
if not (root / "extracted/records").is_dir():
    print("  SKIP the real-records legs (extracted/ not present)")
    print("FAILURES:", failures)
    raise SystemExit(1 if failures else 0)

# --- Task 3: offsets read from the real records ---
db = mon.DB((root / "extracted/records").resolve())
check("scaler ref resolves through gameengine.dbr",
      mon.scaler_ref(db).endswith("balancingadjustment_mp+difficulty_enemies01.dbr"))
offs = mon.difficulty_offsets(db)
check("offsets cover the four difficulties",
      sorted(offs.keys()) == ["ascendant", "elite", "normal", "ultimate"])
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

# --- Ascendant: the adjustment record and the fourth offsets key ---
check("ascendant ref resolves through gameengine.dbr and gameascendant.dbr",
      mon.ascendant_ref(db).endswith("balancingadjustment_ultramode_enemies01.dbr"))
check("ascendant ref falls back when the engine names no ascendant record",
      mon.ascendant_ref(FakeDB({})).endswith("balancingadjustment_ultramode_enemies01.dbr"))

check("flat_adjustment reads a scalar field",
      mon.flat_adjustment({"defensiveFire": "7.000000"})["fire"] == 7)
check("flat_adjustment keeps a negative adjustment",
      mon.flat_adjustment({"defensiveFire": "-4.000000"})["fire"] == -4)
check("flat_adjustment treats an absent field as no adjustment",
      mon.flat_adjustment({})["fire"] == 0)
check("flat_adjustment returns all ten keys",
      list(mon.flat_adjustment({}).keys()) == TEN)
before_asc = list(mon.FAILED_ASCENDANT_FIELDS)
bad_adj = mon.flat_adjustment({"defensiveCold": "1.0;2.0"})
check("flat_adjustment records a non-scalar field as failed",
      mon.FAILED_ASCENDANT_FIELDS[len(before_asc):] == ["cold"])
check("a failed ascendant field defaults to 0", bad_adj["cold"] == 0)

# The real ultramode record is all zeros, so a fixture built from it cannot tell
# "ultimate + adjustment" from "copy ultimate", "adjustment only", or "read the
# wrong record". These values are nonzero and differ per type so it can.
twelve_up = ";".join(str(float(n)) for n in [0, 0, 0, 0, 4, 6, 8, 11, 8, 10, 13, 16])
asc_db = FakeDB({
    mon.GAMEENGINE_REF: {"monsterAttributePak": mon.SCALER_FALLBACK,
                         "ascendantRecord": mon.ASCENDANT_RECORD_FALLBACK},
    mon.SCALER_FALLBACK: {f: twelve_up for f in mon.RESISTANCE_FIELDS.values()},
    mon.ASCENDANT_RECORD_FALLBACK: {"ultimateChallangeAdjustment": mon.ULTRAMODE_FALLBACK},
    mon.ULTRAMODE_FALLBACK: {"defensiveFire": "3.000000", "defensiveCold": "-2.000000"},
})
asc = mon.difficulty_offsets(asc_db)
check("offsets cover four difficulties",
      sorted(asc.keys()) == ["ascendant", "elite", "normal", "ultimate"])
check("ascendant covers the four player brackets",
      sorted(asc["ascendant"].keys()) == ["1", "2", "3", "4"])
check("ascendant adds the adjustment to ultimate in every bracket",
      [asc["ascendant"][p]["fire"] for p in "1234"] == [11, 13, 16, 19])
check("ascendant carries a negative adjustment too",
      [asc["ascendant"][p]["cold"] for p in "1234"] == [6, 8, 11, 14])
check("a type absent from the adjustment record matches ultimate exactly",
      [asc["ascendant"][p]["poison"] for p in "1234"] == [8, 10, 13, 16])
check("building ascendant does not mutate ultimate",
      [asc["ultimate"][p]["fire"] for p in "1234"] == [8, 10, 13, 16])
check("ascendant is emitted after ultimate so the JSON reads weakest to hardest",
      list(asc.keys()) == ["normal", "elite", "ultimate", "ascendant"])

real = mon.difficulty_offsets(db)
check("real ascendant offsets equal ultimate today (the ultramode record is all zeros)",
      all(real["ascendant"][p][k] == real["ultimate"][p][k] for p in "1234" for k in TEN))

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
# lightning/aether include +1 each from valdaran_passiveproperties.dbr (Skill_Passive):
# its skillLevel10 is the dynamic formula "charLevel/4+1", which _skill_level cannot
# parse, so it defaults to rank 1, pinning the array's level-1 entry (1 for both).
check("valdaran resistances match the record",
      val and val[0]["resistances"]["fire"] == 20 and val[0]["resistances"]["lightning"] == 51
      and val[0]["resistances"]["aether"] == 51 and val[0]["resistances"]["poison"] == 20
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
    "records/skills/np/toggledhost.dbr": {"Class": "Skill_BuffRadiusToggled", "buffSkillName": "records/skills/np/shieldbuff.dbr"},
    "records/skills/np/shieldbuff.dbr": {"Class": "SkillBuff_Passive", "defensiveFire": "33.000000", "defensiveCold": "33.000000"},
    "records/skills/np/debufhost.dbr": {"Class": "Skill_AttackBuffRadius", "buffSkillName": "records/skills/np/curse.dbr"},
    "records/skills/np/curse.dbr": {"Class": "SkillBuff_Debuf", "defensivePoison": "-15.000000", "defensiveChaos": "-15.000000"},
    "records/skills/np/granterwithchild.dbr": {"Class": "Skill_Passive", "defensiveBleeding": "40.000000", "buffSkillName": "records/skills/np/shieldbuff.dbr"},
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
p, a = contrib([("records/skills/np/toggledhost.dbr", 1)])
check("a toggled host's child grant lands in the aura bucket", a == {"fire": 33, "cold": 33} and p == {})
p, a = contrib([("records/skills/np/debufhost.dbr", 1)])
check("a debuff child is never credited to the monster", p == {} and a == {})
p, a = contrib([("records/skills/np/granterwithchild.dbr", 1)])
check("a skill granting inline is not also credited with its child", p == {"bleeding": 40} and a == {})
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

# --- Task 2 (passives): collapse consumes the resolved map ---
def crec2(maxlv, **kw):
    base = {"Class": "Monster", "description": "tagOk", "monsterClassification": "Common",
            "maxLevel": str(maxlv), "minLevel": "1"}
    base.update(kw)
    return base

g_rec_a = crec2(90, defensiveFire="10")
g_rec_b = crec2(50, defensiveFire="10")
groups2 = {("Mon", "Common"): [("enemies/a.dbr", g_rec_a), ("enemies/b.dbr", g_rec_b)]}
resolved2 = {
    "enemies/a.dbr": {"resistances": {**mon.resistances_of(g_rec_a), "bleeding": 80},
                      "passive": {"bleeding": 80}, "aura": {"cold": 20}},
    "enemies/b.dbr": {"resistances": mon.resistances_of(g_rec_b), "passive": {}, "aura": {}},
}
rows2 = mon.collapse_to_logical(groups2, RACE_TAGS, resolved2)
check("collapse uses the resolved combined resistances", rows2[0]["resistances"]["bleeding"] == 80)
check("collapse emits sparse passive provenance", rows2[0]["passive_resistances"] == {"bleeding": 80})
check("collapse emits sparse aura provenance", rows2[0]["aura_resistances"] == {"cold": 20})
check("variants_disagree compares combined totals", rows2[0]["variants_disagree"] is True)

groups3 = {("Mon", "Common"): [("enemies/a.dbr", g_rec_a)]}
resolved3 = {"enemies/a.dbr": {"resistances": mon.resistances_of(g_rec_a), "passive": {}, "aura": {}}}
rows3 = mon.collapse_to_logical(groups3, RACE_TAGS, resolved3)
check("empty provenance keys are omitted entirely",
      "passive_resistances" not in rows3[0] and "aura_resistances" not in rows3[0])

# --- Task 2 (passives): the regenerated dataset ---
out3 = Path(tempfile.mkdtemp()) / "monsters3.json"
rc3 = subprocess.run([sys.executable, str(here / "parse_monsters.py"),
    "--records-dir", str(root / "extracted/records"),
    "--text-dir", str(root / "extracted/text_en"),
    "--out", str(out3), "--game-version", "test"]).returncode
check("parser still exits 0", rc3 == 0)
doc3 = json.loads(out3.read_text(encoding="utf-8"))
m3 = doc3["monsters"]
by_id = {m["id"]: m for m in m3}

check(f"row count is the post-trap-exclusion total (got {len(m3)})", len(m3) == 1635)
# 2,728 before the trap exclusion. This counts KEPT records (the variant_counts of surviving
# rows), not records read, so excluding 3 trap records necessarily drops it by 3. Those 3
# collapse into only 2 logical rows, which is why the row count fell by 2 and this by 3.
check(f"kept raw record count (got {sum(m['variant_count'] for m in m3)})",
      sum(m["variant_count"] for m in m3) == 2725)
check("all ten resistance keys still present", all(list(m["resistances"].keys()) == TEN for m in m3))

alkamos = by_id.get("enemies.boss-quest.ghost_stepsoftorment_01")
check("alkamos bleeding resolves to 100", alkamos and alkamos["resistances"]["bleeding"] == 100)
check("alkamos records the passive provenance",
      alkamos and alkamos.get("passive_resistances", {}).get("bleeding") == 100)

kaisan = by_id.get("enemies.nemesis.nemesis_eldritch_01")
check("kaisan bleeding resolves to 45", kaisan and kaisan["resistances"]["bleeding"] == 45)
check("kaisan pierce resolves to 67", kaisan and kaisan["resistances"]["pierce"] == 67)
check("kaisan fire resolves to 46", kaisan and kaisan["resistances"]["fire"] == 46)

check("karroz is still present", "enemies.boss-quest.cultist_summoner_01" in by_id)

eldritch = by_id.get("enemies.eldritcharmor_c01")
check("a toggled self-shield is recorded as an aura",
      eldritch and eldritch.get("aura_resistances", {}).get("fire") == 33
      and eldritch["aura_resistances"].get("cold") == 33)
check("an aura is still kept out of the headline total",
      eldritch and eldritch["resistances"]["fire"] == 0)
auras = [m for m in m3 if m.get("aura_resistances")]
check(f"aura provenance now covers the toggled hosts (got {len(auras)})", 100 <= len(auras) <= 200)
bleeders = [m for m in m3 if m["resistances"]["bleeding"]]
# Band widened from the plan's stated 300-900, which was written against the wrong grain.
# The design doc's "592 monsters" counted raw records across a 3,023-record superset that
# includes the devotion role, hiddenFromCombat, and invincible records this pipeline
# excludes. Here, 245 logical rows cover 533 raw records (of 1,635 rows after the trap exclusion), so nothing is lost in
# resolution: the difference is the grain plus those exclusions. Every point of it comes
# from passive_resistances -- bleeding is never set inline, and no aura skill grants it.
check(f"bleeding is no longer uniformly zero (got {len(bleeders)})", 150 <= len(bleeders) <= 400)
check("no zero-valued provenance entries",
      all(all(v for v in m.get("passive_resistances", {}).values()) for m in m3)
      and all(all(v for v in m.get("aura_resistances", {}).values()) for m in m3))
check("empty provenance objects are never emitted",
      all(m.get("passive_resistances") != {} and m.get("aura_resistances") != {} for m in m3))
check("at least one monster records an aura contribution",
      any(m.get("aura_resistances") for m in m3))
check("provenance keys are always real resistance names",
      all(set(m.get("passive_resistances", {})) <= set(TEN)
          and set(m.get("aura_resistances", {})) <= set(TEN) for m in m3))
# That aura is excluded from the headline total is proven by the Task 1 unit test
# ("aura is NOT folded into the total"), which controls both inputs; from the
# generated file alone the un-aura'd value is not recoverable, so no check here
# can verify it without recomputing the parser's own arithmetic.

# determinism still holds
out4 = Path(tempfile.mkdtemp()) / "monsters4.json"
subprocess.run([sys.executable, str(here / "parse_monsters.py"),
    "--records-dir", str(root / "extracted/records"),
    "--text-dir", str(root / "extracted/text_en"),
    "--out", str(out4), "--game-version", "test"], check=True)
check("still deterministic across runs",
      json.loads(out4.read_text(encoding="utf-8"))["monsters"] == m3)

# --- Task 3 (passives): the summary reports grants and skips ---
probe = subprocess.run([sys.executable, str(here / "parse_monsters.py"),
    "--records-dir", str(root / "extracted/records"),
    "--text-dir", str(root / "extracted/text_en"),
    "--out", str(Path(tempfile.mkdtemp()) / "probe.json"), "--game-version", "test"],
    capture_output=True, text=True)
summary = probe.stderr
check("summary reports monsters with a passive grant", "with a skill resistance grant:" in summary)
check("summary reports monsters with an aura grant", "with an aura grant" in summary)
check("summary reports skipped skill references", "skill grants not counted:" in summary)

# The reason itemisation has nothing to render against real records: every skill that
# resolves to zero is now correctly not a skip, and no creature reaches a SUMMON_CLASSES
# record through skillName{n} (summon definitions hang off spawn skills, one level deeper
# than this resolver follows). So seed a skip and drive print_summary directly.
# SKILL_EXCLUSIONS is a module global that the unit tests above have already appended to,
# so replace its contents outright rather than appending: on top of that residue the
# assertions below would pass whether or not the seed took effect.
saved_skips = mon.SKILL_EXCLUSIONS[:]
mon.SKILL_EXCLUSIONS[:] = [{"record_path": "records/creatures/enemies/x.dbr",
                            "skill": "records/skills/np/minion.dbr", "reason": "summoned entity"}]
buf = io.StringIO()
with contextlib.redirect_stderr(buf):
    mon.print_summary(m3, [], [], [])
mon.SKILL_EXCLUSIONS[:] = saved_skips
seeded = buf.getvalue()
check("summary counts exactly the seeded skip", "skill grants not counted: 1" in seeded)
check("summary itemises skip reasons by reason", "- summoned entity: 1" in seeded)

# --- Task 1 (explorer): traps are excluded, monsters merely named "trap" are not ---
check("a trap_ prefixed record is excluded",
      mon.exclusion_reason("enemies/trap_mineexplosive_a01.dbr", rec(), TAGS) == "trap")
check("a trap_ prefixed record in a subdir is excluded",
      mon.exclusion_reason("enemies/special/trap_foo_01.dbr", rec(), TAGS) == "trap")
check("a monster merely named with trap inside is kept",
      mon.exclusion_reason("enemies/boss&quest/ghost_ugdenbogtrap_01.dbr", rec(), TAGS) is None)
check("a monster whose name starts with a trap-like word is kept",
      mon.exclusion_reason("enemies/boss&quest/trapdoorspider_01.dbr", rec(), TAGS) is None)
check("rule order: a non-monster record is still reported as such, not as a trap",
      mon.exclusion_reason("enemies/trap_x.dbr", rec(Class="ProxyPool"), TAGS) == "not a monster record")

print("FAILURES:", failures)
raise SystemExit(1 if failures else 0)
