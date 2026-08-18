#!/usr/bin/env -S uv run --script
# ABOUTME: Emits data/stat-item-tags.json, the raw Grim Dawn stat id -> game tag map the
# ABOUTME: /items/ page labels stats with. Derives the tag from the engine's naming convention.
# /// script
# requires-python = ">=3.10"
# dependencies = ["duckdb"]
# ///
"""Map every raw stat id the item/skill datasets carry onto the game tag that names it.

Grim Dawn keeps no stat-id-to-tag lookup in its database - the pairing is compiled
into Game.dll - but the engine's naming is systematic, so most of it derives from
the id by string rules alone (see `candidate_tags`). What the rules cannot produce
is hand-listed in ALIASES; what the game never displays is hand-listed in
NON_DISPLAY, so a silent miss and a deliberate exclusion do not look the same. A
stat id in neither bucket that no rule resolves fails the run.

The output is a flat `{stat id: game tag}` map, the same shape as the curated
data/stat-tags.json and data/stat-format-tags.json, so build_game_tables.py pulls
its values into every game.<lang>.json the same way.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build_deposit import open_deposit  # noqa: E402

# Stat ids come from the derived typed schema, not the emitted JSON datasets: the
# datasets narrow items to the top tier per family, and a map keyed off that would
# lose a stat the moment the page widened its selection.
POPULATION_TABLES = ("stats", "skill_ranks", "skill_modifiers", "pet_ranks")

# The game's own display strings live in the UI tag files (tags_ui plus the
# per-expansion tagsgdx1/2/3_ui). Restricting the search here is what keeps a rule
# from matching a same-spelled item name or quest string in some other tag file.
UI_SOURCE_SUFFIX = "_ui"

# Trailing slots on a stat id that name a facet of one value (its low/high end, the
# chance it applies, whether it is exclusive or global), never a stat of their own.
# The game labels the parent stat once, so these peel off before the family rules.
QUALIFIER_SUFFIXES = ("Min", "Max", "Chance", "XOR", "Global")

# Duration sub-slots. A damage-over-time stat's line already carries its "over N
# seconds" suffix, so <parent>Duration collapses onto <parent>. Tried only after
# every unpeeled spelling has failed, so a real stat whose name ends in Duration
# (defensiveFireDuration -> DefenseFireDuration, "Reduction in Burn Duration")
# still wins over the collapse.
DURATION_SUFFIXES = ("DurationModifier", "Duration")

# The engine renames the family prefix on its way to the tag: an id's "offensive"
# is a tag's "Damage", "defensive" is "Defense", and so on. Longest prefix first,
# since offensiveSlow must beat offensive.
FAMILY_PREFIXES = (
    ("offensiveSlow", "DamageDuration"),
    ("offensive", "Damage"),
    ("defensiveSlow", "Defense"),
    ("defensive", "Defense"),
    ("retaliationSlow", "RetaliationDuration"),
    ("retaliation", "Retaliation"),
    ("character", "tagChar"),
    ("racialBonus", "RacialBonus"),
    ("projectile", "Projectile"),
    ("skill", "Skill"),
    ("pet", "Skill"),
)

# Tags whose text is a whole game display string carry a "tag" prefix about half the
# time (tagDamageBaseFire beside DamageBaseFire). Both spellings are tried for every
# candidate, case-insensitively.
TAG_PREFIX = "tag"

VALUE_TOKEN = re.compile(r"\{[^}]*\}")

# --- Hand-authored tables ----------------------------------------------------
# Aliases override the rules. Each entry is here because no string rule over the
# stat id can produce the tag; the comment above each block says what forced it.
ALIASES: dict[str, str] = {
    # The five character attributes are numbered in the tag table, and the digits
    # are nowhere in the stat id. (A bare `Strength`/`Life`/`Mana` tag does exist
    # and a rule finds it, but only for the flat form: the percent and total forms
    # are tagCharAttribute02Modifier / tagCharAttribute04MultModifier, so the whole
    # family is pinned here to keep one stat's facets speaking one vocabulary.)
    "characterStrength": "tagCharAttribute02",
    "characterStrengthModifier": "tagCharAttribute02Modifier",
    "characterDexterity": "tagCharAttribute01",
    "characterDexterityModifier": "tagCharAttribute01Modifier",
    "characterIntelligence": "tagCharAttribute03",
    "characterIntelligenceModifier": "tagCharAttribute03Modifier",
    "characterLife": "tagCharAttribute04",
    "characterLifeModifier": "tagCharAttribute04Modifier",
    "characterLifeMultModifier": "tagCharAttribute04MultModifier",
    "characterMana": "tagCharAttribute05",
    "characterManaModifier": "tagCharAttribute05Modifier",
    # Item-granted skill and mastery levels are named by what grants them (Item...)
    # rather than by the augment* stat family, and the trailing 1/2 is a slot index.
    "augmentAllLevel": "ItemAllSkillIncrement",
    "augmentSkillLevel1": "ItemSkillIncrement",
    "augmentSkillLevel2": "ItemSkillIncrement",
    "augmentMasteryLevel1": "ItemMasteryIncrement",
    "augmentMasteryLevel2": "ItemMasteryIncrement",
    # Words the tag spells out that the stat id leaves implicit, or vice versa.
    "defensiveProtection": "DefenseAbsorptionProtection",
    "defensiveBonusProtection": "DefenseAbsorptionProtectionBonus",
    "defensivePercentReflectionResistance": "DefenseReflectResist",
    "offensivePierceRatio": "DamageBasePierceRatio",
    "offensiveManaBurnDrain": "DamageManaDrain",
    "characterDeflectProjectile": "tagCharDeflectProjectiles",
    "characterHealIncreasePercent": "tagCharHealIncreaseModifier",
    "skillComboChargeLevel": "ComboChargeLevels",
    "spawnObjectsTimeToLive": "tagSkillPetTimeToLive",
    # GD's internal Life is the player-facing Vitality, and only the tag says so.
    "offensiveBaseLife": "tagDamageBaseVitality",
    # Fumble and Impaired Aim are named as duration debuffs in the tag table even
    # though their stat ids carry no Slow infix, so the family rewrite misses them.
    "offensiveFumble": "DamageDurationFumble",
    "offensiveProjectileFumble": "DamageDurationProjectileFumble",
    # A shield's block chance has its own noun; peeling "Chance" would land on
    # DefenseBlock, which is the damage blocked, a different number entirely.
    "defensiveBlockChance": "tagCharStatsBlockChance",
    # Value-embedded formats whose tag name shares no stem with the stat id.
    "conversionPercentage": "tagDamageConversion",
    "conversionPercentage2": "tagDamageConversion",
    "weaponDamagePct": "SkillWeaponDamageFormat",
    "retaliationDamagePct": "SkillRetaliationDamageFormat",
    "sparkChance": "tagSparkMaxNumberChance",
    # The refresh families compose one card line from an amount, a chance, and the
    # target/trigger qualifiers carried alongside them since 2026-08-17. Amount and
    # chance share the family's tag; the formatter reads both off the block and
    # renders a single line. Pinned to Badge of the Crimson Company, whose card reads
    # "25% Chance on Attack to reduce cooldown of Leap by 1 Second".
    "refreshCooldownAmount": "tagSkillCooldownRefresh",
    "refreshCooldownChance": "tagSkillCooldownRefresh",
    "refreshDurationAmount": "tagSkillDurationRefresh",
    "refreshDurationChance": "tagSkillDurationRefresh",
    "refreshDurationMax": "tagSkillDurationRefreshMax",
    # Two spellings of one stat. The skill_modifier template calls the pass-through
    # chance projectilePiercing where a skill record calls it
    # projectilePiercingChance: no record in the deposit carries both, the 45
    # occurrences are all on Skill_Modifier records, and every value is a 33-100
    # percentage, never a flag. Pinned to the Eldritch Storm Emitter, whose Storm
    # Spread block reads "70% Chance to pass through Enemies".
    "projectilePiercing": "ProjectilePiercingChance",
    # A wave skill's reach in meters, on the skill itself (Skill_AttackWave and
    # friends) and as a bonus on a modifier. The tag is named for the target, not
    # the wave. Pinned to Ghol's Reach, whose Bone Harvest block reads
    # "2 Meter Range" beside its recharge and leech lines.
    "waveDistance": "TargetRange",
}

# Stat ids the game never renders as a labelled line. Declared rather than left to
# fall out as a miss, so adding a stat the game DOES label fails the run instead of
# silently joining a pile of known gaps. The value is the reason.
NON_DISPLAY: dict[str, str] = {
    # Weapon-class requirement tokens on a skill, not stats. The game renders these
    # through its "Requires" line, and statFormat.classify already returns null for
    # them (they are the only ids that start with a capital).
    "Axe": "weapon-class requirement token",
    "Axe2h": "weapon-class requirement token",
    "Dagger": "weapon-class requirement token",
    "Mace": "weapon-class requirement token",
    "Mace2h": "weapon-class requirement token",
    "Offhand": "weapon-class requirement token",
    "Ranged1h": "weapon-class requirement token",
    "Ranged2h": "weapon-class requirement token",
    "Scepter": "weapon-class requirement token",
    "Shield": "weapon-class requirement token",
    "Spear2h": "weapon-class requirement token",
    "Sword": "weapon-class requirement token",
    "Sword2h": "weapon-class requirement token",
    "dualRangedOrAllRangedOnly": "weapon-requirement flag",
    # Engine behaviour: geometry, spread and spawn bookkeeping with no display line.
    "contagionInterval": "contagion spread mechanics, never displayed",
    "contagionLimit": "contagion spread mechanics, never displayed",
    "contagionMaxSpread": "contagion spread mechanics, never displayed",
    "overwriteBaseSkill": "skill-wiring flag, never displayed",
    "radiusEffectSize": "effect geometry, never displayed",
    "skillChargeMultipliers": "per-charge scaling array, never displayed",
    "skillTargetInterval": "internal tick rate, never displayed",
    "spawnObjectWeights": "spawn table weighting, never displayed",
    "spawnObjectWeights2": "spawn table weighting, never displayed",
    "spawnObjectWeights3": "spawn table weighting, never displayed",
    "spawnObjectWeights4": "spawn table weighting, never displayed",
    "waveEndWidth": "wave geometry, never displayed",
    "waveStartWidth": "wave geometry, never displayed",
    # Facets the game folds into a sibling stat's line rather than labelling.
    "defensiveManaBurn": "flat facet of defensiveManaBurnRatio; only the ratio has a line",
    "defensiveProtectionChance": "chance facet of defensiveProtection",
    "skillLifeBonusBuffDuration": "duration facet folded into the SkillLifeBonus line",
    "skillLifePercentBuffDuration": "duration facet folded into the SkillLifePercent line",
    "onHitActivationChance": "proc probability, rendered as the trigger qualifier",
    "skillProcChance": "proc probability, rendered as the trigger qualifier",
    # Lines the game composes from several stats at once, so no one stat owns a label.
    "offensiveGlobalChance": (
        "chance-of block header; the wording depends on the sibling XOR flag "
        "(GlobalPercentChanceOfAllTag vs GlobalPercentChanceOfOneTag)"
    ),
}


# --- Pure derivation ---------------------------------------------------------
def peel_qualifiers(stat_id: str) -> list[str]:
    """The stat id and every shorter form left by stripping trailing qualifiers.

    Longest first, so a caller tries the unpeeled spelling before any collapse.
    "offensiveFireModifierChance" -> [..., "offensiveFireModifier", "offensiveFire"].
    """
    forms = [stat_id]
    core = stat_id
    peeled = True
    while peeled:
        peeled = False
        for suffix in QUALIFIER_SUFFIXES:
            if core.endswith(suffix) and len(core) > len(suffix):
                core = core[: -len(suffix)]
                forms.append(core)
                peeled = True
                break
    return forms


def duration_parent(core: str) -> str | None:
    """The stat a duration sub-slot belongs to, or None if this is not one."""
    for suffix in DURATION_SUFFIXES:
        if core.endswith(suffix) and len(core) > len(suffix):
            return core[: -len(suffix)]
    return None


def _capitalize(s: str) -> str:
    return s[:1].upper() + s[1:]


def family_candidates(core: str) -> list[str]:
    """Tag spellings for one stat-id core that rewrite its family prefix.

    Turns the id's family into the tag's (offensive -> Damage, defensiveSlow ->
    Defense, ...), moves a trailing Modifier to just after the family
    (offensiveFireModifier -> DamageModifierFire), and offers the family-less
    spelling the engine also uses (skillManaCost -> ManaCost). Empty for a core
    with no family prefix, which literal_candidates then covers.
    """
    out: list[str] = []
    for prefix, replacement in FAMILY_PREFIXES:
        if not core.startswith(prefix):
            continue
        rest = _capitalize(core[len(prefix):])
        if not rest:
            continue
        out.append(replacement + rest)
        if rest.endswith("Modifier"):
            out.append(replacement + "Modifier" + rest[: -len("Modifier")])
        out.append(rest)
        break
    return out


def literal_candidates(core: str) -> list[str]:
    """Tag spellings that keep the stat id whole: as written, and Skill-prefixed.

    Last resort, tried only after every family rewrite has failed, so a tag that
    happens to be spelled like a longer form of the id (OffensiveFireMin beside
    DamageFire) cannot outrank the systematic answer.
    """
    return [_capitalize(core), "Skill" + _capitalize(core)]


def core_forms(stat_id: str) -> list[str]:
    """Every stat-id spelling to consider, in priority order.

    The unpeeled id and its qualifier-peeled forms come first; only then the
    duration collapse (and the qualifier peel of what that leaves), so a real stat
    whose name ends in Duration is never mistaken for a sub-slot of a shorter stat.
    """
    forms = peel_qualifiers(stat_id)
    collapsed: list[str] = []
    for core in forms:
        parent = duration_parent(core)
        if parent:
            collapsed.extend(peel_qualifiers(parent))
    out: list[str] = []
    for core in forms + collapsed:
        if core not in out:
            out.append(core)
    return out


def candidate_tags(stat_id: str) -> list[str]:
    """Every tag spelling to try for a stat id, in priority order, deduplicated.

    Both the bare and the "tag"-prefixed spelling of each candidate are emitted.
    """
    cores = core_forms(stat_id)
    bases: list[str] = []
    for core in cores:
        bases.extend(family_candidates(core))
    for core in cores:
        bases.extend(literal_candidates(core))
    out: list[str] = []
    seen: set[str] = set()
    for base in bases:
        for spelling in (base, TAG_PREFIX + base):
            key = spelling.lower()
            if key not in seen:
                seen.add(key)
                out.append(spelling)
    return out


def resolve(stat_id: str, tag_index: dict[str, str]) -> str | None:
    """The game tag naming this stat, or None. tag_index is lowercased tag -> tag.

    An alias on any peeled form of the id wins over every derived candidate: the
    hand-authored answer is there precisely because a rule would find the wrong one.
    """
    for core in core_forms(stat_id):
        alias = ALIASES.get(core)
        if alias:
            return tag_index.get(alias.lower())
    for candidate in candidate_tags(stat_id):
        hit = tag_index.get(candidate.lower())
        if hit:
            return hit
    return None


def reduces_to_label(text: str) -> bool:
    """Whether stripping a tag's LEADING value tokens leaves a usable bare noun.

    "{%+.0f0}% Fire Damage" does ("Fire Damage"). "Stun target{%t0}" and "Total
    Damage Modified by {%.0f0}%" do not: the value sits inside or after the prose,
    so the page has to render the string whole rather than beside a value. Neither
    does "{%d0}%", which is all value and no prose.
    """
    rest = text
    while True:
        stripped = VALUE_TOKEN.sub("", rest, count=1) if rest.startswith("{") else rest
        stripped = stripped.lstrip(" %+-")
        if stripped == rest:
            break
        rest = stripped
    return bool(rest) and not VALUE_TOKEN.search(rest)


# --- I/O ---------------------------------------------------------------------
def load_ui_tags(con) -> dict[str, str]:
    """{tag: english text} for every tag in the game's UI tag files."""
    rows = con.execute(
        "SELECT tag, text, source FROM labels WHERE locale = 'en'").fetchall()
    return {tag: text for tag, text, source in rows if source.endswith(UI_SOURCE_SUFFIX)}


def load_population(con, derived_dir: Path) -> set[str]:
    """Every distinct stat id in the derived typed schema."""
    out: set[str] = set()
    for table in POPULATION_TABLES:
        path = derived_dir / f"{table}.parquet"
        if not path.is_file():
            print(f"ERROR: no {path.name} at {derived_dir}; run `just fetch-deposit` "
                  f"(or `just derive`) first.", file=sys.stderr)
            raise SystemExit(2)
        sql = f"SELECT DISTINCT stat_id FROM read_parquet('{path.as_posix()}')"
        out.update(r[0] for r in con.execute(sql).fetchall())
    return out


def locale_coverage(con, tags: set[str]) -> list[tuple[str, int]]:
    """(locale, how many of `tags` that locale carries), alphabetically."""
    rows = con.execute("SELECT locale, tag FROM labels").fetchall()
    seen: dict[str, int] = {}
    locales: set[str] = set()
    for locale, tag in rows:
        locales.add(locale)
        if tag in tags:
            seen[locale] = seen.get(locale, 0) + 1
    return sorted((loc, seen.get(loc, 0)) for loc in locales)


def audit_dll(dll_path: Path, tags: set[str]) -> tuple[int, list[str]]:
    """(how many of `tags` appear verbatim in the binary, the ones that do not).

    Advisory only. The stat-id-to-tag pairing is compiled into Game.dll as adjacent
    string literals, so a derived tag the binary never mentions deserves a look;
    a tag it does mention is corroboration, not proof of the pairing.
    """
    blob = dll_path.read_bytes()
    absent = sorted(t for t in tags if t.encode("ascii", "ignore") not in blob)
    return len(tags) - len(absent), absent


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Emit the raw stat id -> game tag map")
    ap.add_argument("--deposit-dir", required=True, type=Path)
    ap.add_argument("--derived-dir", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--report", action="store_true",
                    help="also print every mapping with its English text, for audit")
    ap.add_argument("--audit-dll", type=Path,
                    help="optional Game.dll to cross-check: the engine stores stat id and "
                         "tag as adjacent string literals, so a mapped tag missing from the "
                         "binary is worth a second look (Windows install only)")
    args = ap.parse_args(argv)

    con = open_deposit(args.deposit_dir.resolve())
    ui_tags = load_ui_tags(con)
    tag_index = {}
    for tag in ui_tags:
        tag_index.setdefault(tag.lower(), tag)
    population = load_population(con, args.derived_dir.resolve())

    mapping: dict[str, str] = {}
    missing: list[str] = []
    for stat_id in sorted(population):
        if stat_id in NON_DISPLAY:
            continue
        tag = resolve(stat_id, tag_index)
        if tag:
            mapping[stat_id] = tag
        else:
            missing.append(stat_id)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(mapping, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8")

    distinct = set(mapping.values())
    print(f"Wrote {args.out}")
    print(f"  {len(mapping)} of {len(population)} stat ids -> {len(distinct)} distinct tags "
          f"({len(NON_DISPLAY)} declared non-display, {len(ALIASES)} aliases)")
    coverage = locale_coverage(con, distinct)
    full = [loc for loc, n in coverage if n == len(distinct)]
    print(f"  locales carrying all {len(distinct)} tags: {len(full)} of {len(coverage)} "
          f"({' '.join(full)})")
    for loc, n in coverage:
        if n != len(distinct):
            print(f"  WARNING: {loc} carries only {n} of {len(distinct)} tags")

    embedded = sorted(t for t in distinct if not reduces_to_label(ui_tags[t]))
    print(f"  {len(embedded)} of {len(distinct)} tags do NOT reduce to a bare label "
          f"(value-embedded or value-suffix; a rendering decision for the page, "
          f"see docs/i18n.md):")
    for tag in embedded:
        print(f"    {tag}: {ui_tags[tag]!r}")

    if args.audit_dll:
        found, absent = audit_dll(args.audit_dll, distinct)
        print(f"  Game.dll cross-check: {found} of {len(distinct)} tags appear as a literal "
              f"in {args.audit_dll.name}")
        for tag in absent:
            print(f"    absent: {tag} ({ui_tags[tag]!r})")

    if args.report:
        print("  mapping:")
        for stat_id, tag in mapping.items():
            print(f"    {stat_id}\t{tag}\t{ui_tags[tag]}")

    if missing:
        print(f"ERROR: {len(missing)} stat id(s) resolve to no tag and are not declared "
              f"non-display. Add each to ALIASES (with the tag) or to NON_DISPLAY "
              f"(with the reason) in {Path(__file__).name}:", file=sys.stderr)
        for stat_id in missing:
            print(f"  {stat_id}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
