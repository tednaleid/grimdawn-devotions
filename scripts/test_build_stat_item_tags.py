#!/usr/bin/env -S uv run --script
# ABOUTME: Pins the pure derivation rules in build_stat_item_tags.py against a decoy-laden
# ABOUTME: tag index, so a broken rule fails here. Run via `just test-scripts`.
# /// script
# requires-python = ">=3.10"
# dependencies = ["duckdb"]
# ///
import importlib.util
import sys
from pathlib import Path

here = Path(__file__).parent
sys.path.insert(0, str(here))
spec = importlib.util.spec_from_file_location("bsit", here / "build_stat_item_tags.py")
assert spec and spec.loader
bsit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bsit)

failures = 0
def check(name, got, want):
    global failures
    if got != want:
        failures += 1
        print(f"  FAIL {name}: got {got!r}, want {want!r}")
    else:
        print(f"  ok   {name}")


# --- The fixture index -------------------------------------------------------
# Deliberately NOT degenerate. Every rule below has to choose between a right
# answer and a wrong one that is also present, so a rule that stops working
# (or an ordering that flips) lands on a decoy instead of on nothing.
TAGS = [
    # Instant damage: the family rewrite must reach Damage*, not the literal id.
    "DamageFire",
    "OffensiveFireMin",                 # decoy: the un-rewritten spelling exists too
    "DamageModifierFire",               # modifier migration target
    "DamageModifierFireR",              # decoy: the range variant is never the label
    # Both the collapsed parent AND the real Duration stat exist, so the "try the
    # unpeeled form first" ordering is what separates them.
    "DefenseFire",
    "DefenseFireDuration",
    "DamageDurationFire",
    "DamageDurationBleeding",
    # "tag"-prefixed spelling, reached case-insensitively.
    "tagDamageBaseCold",
    # Family-less spellings the engine also uses.
    "ManaCost",
    "SkillManaCostReduction",           # decoy: a longer tag sharing the stem
    "SkillPetLimit",
    # Alias territory: the bare rule would find "Fumble" if the alias stopped winning.
    "Fumble",
    "DamageDurationFumble",
    "DamageDurationProjectileFumble",
    "tagCharAttribute02",
    "Strength",                         # decoy: the bare rule's answer for characterStrength
]
INDEX = {t.lower(): t for t in TAGS}


def resolved(stat_id):
    return bsit.resolve(stat_id, INDEX)


def before(items, first, second):
    """Whether both are present and `first` comes first. False (not a crash) if either
    is missing, so a rule that stops emitting a candidate reads as a plain failure."""
    return first in items and second in items and items.index(first) < items.index(second)


# --- peel_qualifiers ---------------------------------------------------------
check("peel_qualifiers keeps the id first",
      bsit.peel_qualifiers("offensiveFireModifierChance")[0], "offensiveFireModifierChance")
check("peel_qualifiers peels repeatedly, longest first",
      bsit.peel_qualifiers("offensiveFireModifierChance"),
      ["offensiveFireModifierChance", "offensiveFireModifier"])
check("peel_qualifiers peels Min and XOR and Global",
      bsit.peel_qualifiers("offensiveFireGlobalXORMin"),
      ["offensiveFireGlobalXORMin", "offensiveFireGlobalXOR", "offensiveFireGlobal",
       "offensiveFire"])
check("peel_qualifiers leaves an id with no qualifier alone",
      bsit.peel_qualifiers("defensiveFire"), ["defensiveFire"])
check("peel_qualifiers never peels an id down to nothing",
      bsit.peel_qualifiers("Max"), ["Max"])

# --- duration_parent ---------------------------------------------------------
check("duration_parent of a Duration slot",
      bsit.duration_parent("offensiveSlowFireDuration"), "offensiveSlowFire")
check("duration_parent of a DurationModifier slot",
      bsit.duration_parent("offensiveSlowBleedingDurationModifier"), "offensiveSlowBleeding")
check("duration_parent of a plain stat", bsit.duration_parent("defensiveFire"), None)

# --- core_forms: unpeeled spellings before any duration collapse -------------
forms = bsit.core_forms("offensiveSlowFireDurationMin")
check("core_forms starts with the id", forms[0], "offensiveSlowFireDurationMin")
check("core_forms collapses the duration slot last",
      before(forms, "offensiveSlowFireDuration", "offensiveSlowFire"), True)
check("core_forms deduplicates", len(forms), len(set(forms)))

# --- family_candidates -------------------------------------------------------
check("family rewrite offensive -> Damage",
      bsit.family_candidates("offensiveFire")[0], "DamageFire")
check("family rewrite offensiveSlow beats offensive",
      bsit.family_candidates("offensiveSlowFire")[0], "DamageDurationFire")
check("modifier migrates to just after the family",
      "DamageModifierFire" in bsit.family_candidates("offensiveFireModifier"), True)
check("un-migrated spelling is offered first",
      bsit.family_candidates("offensiveFireModifier")[0], "DamageFireModifier")
check("family-less spelling is offered",
      "ManaCost" in bsit.family_candidates("skillManaCost"), True)
check("a core with no family prefix has no family candidates",
      bsit.family_candidates("weaponDamagePct"), [])
check("literal_candidates keeps the id whole",
      bsit.literal_candidates("petLimit"), ["PetLimit", "SkillPetLimit"])

# --- candidate_tags ----------------------------------------------------------
cands = bsit.candidate_tags("offensiveFireMin")
check("candidate_tags offers the tag-prefixed spelling",
      "tagDamageFire" in cands, True)
check("candidate_tags puts the bare spelling before the tag-prefixed one",
      before(cands, "DamageFire", "tagDamageFire"), True)
check("candidate_tags deduplicates", len(cands), len(set(cands)))
check("candidate_tags tries every family rewrite before any literal spelling",
      before(cands, "DamageFire", "OffensiveFireMin"), True)

# --- resolve: the rules, against the decoys ---------------------------------
check("family rewrite wins over the un-rewritten id",
      resolved("offensiveFireMin"), "DamageFire")
check("Max resolves to the same tag as Min", resolved("offensiveFireMax"), "DamageFire")
check("Chance peels to the parent stat", resolved("offensiveFireChance"), "DamageFire")
check("modifier migration", resolved("offensiveFireModifier"), "DamageModifierFire")
check("a real Duration stat beats the duration collapse",
      resolved("defensiveFireDuration"), "DefenseFireDuration")
check("the duration collapse still applies where there is no Duration tag",
      resolved("offensiveSlowFireDurationMin"), "DamageDurationFire")
check("DurationModifier collapses to the parent stat",
      resolved("offensiveSlowBleedingDurationModifier"), "DamageDurationBleeding")
check("tag prefix is found case-insensitively",
      resolved("offensiveBaseCold"), "tagDamageBaseCold")
check("family-less spelling", resolved("skillManaCost"), "ManaCost")
check("Skill-prefixed spelling", resolved("petLimit"), "SkillPetLimit")
check("an unmappable id resolves to nothing", resolved("waveStartWidth"), None)

# --- resolve: aliases override the rules ------------------------------------
check("an alias beats the rule's answer", resolved("offensiveFumble"), "DamageDurationFumble")
check("an alias applies through a qualifier peel",
      resolved("offensiveFumbleMin"), "DamageDurationFumble")
check("an alias applies through a duration collapse",
      resolved("offensiveProjectileFumbleDurationMin"), "DamageDurationProjectileFumble")
check("an alias beats a bare-noun rule hit",
      resolved("characterStrength"), "tagCharAttribute02")
check("an alias naming a tag the index lacks resolves to nothing (a stale alias shows up)",
      bsit.resolve("conversionPercentage", INDEX), None)

# --- table hygiene -----------------------------------------------------------
check("no stat id is both aliased and declared non-display",
      sorted(set(bsit.ALIASES) & set(bsit.NON_DISPLAY)), [])
check("every alias names a tag", all(bsit.ALIASES.values()), True)
check("every non-display entry carries a reason", all(bsit.NON_DISPLAY.values()), True)

# --- the refresh families are aliased, not declared non-display --------------
check("refreshCooldownAmount aliases to the cooldown refresh tag",
      bsit.ALIASES.get("refreshCooldownAmount"), "tagSkillCooldownRefresh")
check("refreshCooldownChance aliases to the cooldown refresh tag",
      bsit.ALIASES.get("refreshCooldownChance"), "tagSkillCooldownRefresh")
check("refreshDurationAmount aliases to the duration refresh tag",
      bsit.ALIASES.get("refreshDurationAmount"), "tagSkillDurationRefresh")
check("refreshDurationChance aliases to the duration refresh tag",
      bsit.ALIASES.get("refreshDurationChance"), "tagSkillDurationRefresh")
check("refreshDurationMax aliases to the duration refresh max tag",
      bsit.ALIASES.get("refreshDurationMax"), "tagSkillDurationRefreshMax")

# --- the other composed facets stay declared non-display ---------------------
for sid in ("onHitActivationChance", "skillProcChance", "offensiveGlobalChance",
            "defensiveManaBurn", "defensiveProtectionChance",
            "skillLifeBonusBuffDuration", "skillLifePercentBuffDuration"):
    check(f"{sid} is still declared non-display", sid in bsit.NON_DISPLAY, True)

# --- reduces_to_label --------------------------------------------------------
check("a value-prefix format reduces to its noun",
      bsit.reduces_to_label("{%+.0f0}% Fire Damage"), True)
check("plain prose reduces to itself", bsit.reduces_to_label("Skill Recharge"), True)
check("a value-suffix format does not reduce",
      bsit.reduces_to_label("Total Damage Modified by {%.0f0}%"), False)
check("a value-embedded format does not reduce",
      bsit.reduces_to_label("Stun target{%t0}"), False)
check("a multi-slot format does not reduce",
      bsit.reduces_to_label("{%.0f0}% {%s1} converted to {%s2}"), False)
check("an all-value format leaves no label", bsit.reduces_to_label("{%d0}%"), False)

# --- audit_dll ---------------------------------------------------------------
import tempfile  # noqa: E402
with tempfile.TemporaryDirectory() as tmp:
    blob = Path(tmp) / "fake.dll"
    blob.write_bytes(b"\x00\x01DamageFire\x00padding\x00tagDamageBaseCold\x00")
    found, absent = bsit.audit_dll(blob, {"DamageFire", "tagDamageBaseCold", "ManaCost"})
    check("audit_dll counts the literals present", found, 2)
    check("audit_dll names the absent one", absent, ["ManaCost"])

print("ALL PASSED" if failures == 0 else f"{failures} FAILURE(S)")
raise SystemExit(1 if failures else 0)
