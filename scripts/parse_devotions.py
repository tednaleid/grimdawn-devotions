#!/usr/bin/env -S uv run --script
# ABOUTME: Parses Grim Dawn's extracted .dbr devotion records into a single devotions.json.
# ABOUTME: Stdlib-only; discovers keys at runtime so it survives game patches.
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Parse Grim Dawn extracted .dbr devotion records into a single devotions.json.

See docs/dbr-format.md for the data model this relies on. Pure stdlib so it runs
under `uv run` with zero dependencies. Re-run after any game patch / re-extract.
"""
from __future__ import annotations

import argparse
import csv
import datetime as _dt
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gd_dbr import (  # noqa: E402
    DB,
    as_number,
    clean_text,
    level_array_value,
    load_translations,
    read_dbr,
    register,
)

# ---------------------------------------------------------------------------
# Constants discovered from the records (see docs/dbr-format.md)
# ---------------------------------------------------------------------------

AFFINITIES = ["ascendant", "chaos", "eldritch", "order", "primordial"]
AFFINITY_SET = set(AFFINITIES)

# Weapon-requirement flags that live at the top of a star skill record.
WEAPON_FLAGS = [
    "Axe", "Axe2h", "Mace", "Mace2h", "Sword", "Sword2h", "Spear", "Staff",
    "Ranged1h", "Ranged2h", "Shield", "Offhand", "Magical",
]
WEAPON_FLAG_SET = set(WEAPON_FLAGS)

# Numeric keys that are bookkeeping, not granted bonuses.
META_NUMERIC_KEYS = {
    "skillMaxLevel", "skillUltimateLevel", "skillMasteryLevelRequired",
    "isCircular", "isPetDisplayable", "exclusiveSkill", "dualWieldOnly",
    "dualRangedOnly", "unarmedOnly", "excludeRacialDamage",
    "racialBonusPercent", "skillConnectionOff", "skillConnectionOn",
}

PASSIVE_CLASSES = {"Skill_Passive", "SkillBuff_Passive"}

POINT_CAP = 55  # devotion points available at max (sanity ceiling)

# --- Celestial power (proc skill) extraction --------------------------------
# A devotion power is granted at a fixed skill level that VARIES per power (10..25;
# grimtools shows it as "Current Level : N"). The real level is the number of skill
# levels the power defines, read from skillExperienceLevels (see granted_level);
# its stat arrays are defined for exactly levels 1..N. This constant is only a last
# resort if that field is ever missing. (A previous version hardcoded 25 for all
# powers and extrapolated past shorter arrays, inflating ~49 of 63 powers.)
CELESTIAL_POWER_LEVEL = 25

# Ability fields that are not "stat" ids but are shown on the power tooltip; the
# web layer (statFormat) maps these raw ids to GD-style lines. A power carries at
# most one of the two radius ids.
POWER_META_FIELDS = {
    "skillCooldownTime", "projectileLaunchNumber", "projectilePiercingChance",
    "projectileExplosionRadius", "skillTargetRadius", "weaponDamagePct",
    "skillActiveDuration", "damageAbsorption",
    # Heal / restore procs (Dryad's Blessing, Giant's Blood, Inspiration).
    "skillLifeBonus", "skillLifePercent", "skillManaPercent",
}

# Stat-id families to pull off a proc skill (same families as extract_bonuses),
# selected at the granted level. Boolean flags and cosmetic radii are excluded.
POWER_STAT_PREFIXES = ("offensive", "defensive", "retaliation", "character", "racial")


# ---------------------------------------------------------------------------
# Value helpers
# ---------------------------------------------------------------------------

def extract_bonuses(skill: dict[str, str]) -> dict[str, float]:
    """Non-zero numeric stat keys from a passive skill record (raw stat ids)."""
    bonuses: dict[str, float] = {}
    for key, raw in skill.items():
        if key in WEAPON_FLAG_SET or key in META_NUMERIC_KEYS:
            continue
        num = as_number(raw)
        if num is None or num == 0:
            continue
        bonuses[key] = num
    return bonuses


def granted_level(chain: list[dict[str, str]]) -> int:
    """The level a devotion power is granted at = how many skill levels it defines.

    Read from skillExperienceLevels (a per-level XP table present on every devotion
    skill chain); its length is the granted level grimtools shows. Falls back to the
    longest per-level numeric stat array, then to CELESTIAL_POWER_LEVEL, if absent.
    """
    for rec in chain:
        parts = [p for p in rec.get("skillExperienceLevels", "").split(";") if p.strip() != ""]
        if parts:
            return len(parts)
    best = 0
    for rec in chain:
        for v in rec.values():
            parts = [p for p in v.split(";") if p.strip() != ""]
            if len(parts) < 2:
                continue
            try:
                [float(p) for p in parts]
            except ValueError:
                continue
            best = max(best, len(parts))
    return best or CELESTIAL_POWER_LEVEL


def power_skill_chain(db: DB, skill: dict[str, str]) -> list[dict[str, str]]:
    """The granting skill plus the buff/pet/modifier child skills it delegates to.

    Damage-over-time and debuffs frequently live on a child skill, so the proc
    trigger, name and stats are all gathered across this whole chain.
    """
    chain = [skill]
    seen: set[str] = set()
    for ref_key in ("buffSkillName", "petSkillName", "modifierSkillName"):
        ref = skill.get(ref_key, "").strip()
        if ref and ref not in seen:
            seen.add(ref)
            chain.append(db.get(ref))
    return chain


def is_power_stat_key(key: str) -> bool:
    """Whether a raw key is a stat id to surface on a celestial power."""
    if key in POWER_META_FIELDS:
        return False  # handled explicitly, not via the stat-family scan
    if not key.startswith(POWER_STAT_PREFIXES):
        return False
    if key.endswith(("Global", "XOR")):
        return False  # boolean flags, not granted values
    if key.endswith("Radius"):
        return False  # characterLightRadius / cosmetic; real radius via meta fields
    return True


def extract_proc(db: DB, chain: list[dict[str, str]]):
    """The proc trigger { chance, trigger } from a skill's autocast controller, or None.

    Always-on auras/buffs have no autocast controller and so no proc.
    """
    for rec in chain:
        ref = rec.get("templateAutoCast", "").strip()
        if not ref:
            continue
        ctrl = db.get(ref)
        chance = as_number(ctrl.get("chanceToRun", ""))
        trig = ctrl.get("triggerType", "").strip()
        if chance is None or not trig:
            continue
        return {"chance": chance, "trigger_key": trig}
    return None


def extract_power_stats(chain: list[dict[str, str]], level: int) -> dict[str, float]:
    """Raw stat id -> value at the granted level, gathered across the skill chain.

    Mirrors the bonuses convention (raw ids, numbers, non-zero only) but selects
    per-level array values, and additionally keeps the ability meta fields used
    for the tooltip (recharge, projectiles, pass-through, radius, weapon %).
    """
    stats: dict[str, float] = {}
    for rec in chain:
        for key, raw in rec.items():
            if key not in POWER_META_FIELDS and not is_power_stat_key(key):
                continue
            val = level_array_value(raw, level)
            if val is None or val == 0:
                continue
            stats.setdefault(key, val)  # first record in the chain wins
    return stats


def extract_pet(db: DB, tags: dict[str, str], skill: dict[str, str], level: int,
                 skill_ref: str, game_en: dict[str, str]):
    """Summon info for a spawn-pet power, or None.

    A Skill_*SpawnPet power summons a temporary creature. We surface the fixed
    facts the proc tooltip needs: pet name, count (petLimit), duration
    (spawnObjectsTimeToLive), and the pet's base attack damage. The summoned
    creature is the level-indexed entry of spawnObjects (the list runs 1..level,
    so the granted level picks the last). The pet's health/defenses scale with the
    player's pet bonuses, so only the fixed base attack damage is read.
    """
    spawn = skill.get("spawnObjects", "").strip()
    if "SpawnPet" not in skill.get("Class", "") and not spawn:
        return None
    objs = [o.strip() for o in spawn.split(";") if o.strip()]
    if not objs:
        return None
    creature = db.get(objs[min(level, len(objs)) - 1])
    name_tag_raw = creature.get("description", "").strip()
    name_tag = name_tag_raw if name_tag_raw in tags else None
    pet_name = clean_text(tags[name_tag]) if name_tag else None
    name_key = register(name_tag or f"x:pet:{skill_ref}", pet_name, game_en)
    count = level_array_value(skill.get("petLimit", ""), level)
    duration = level_array_value(skill.get("spawnObjectsTimeToLive", ""), level)
    # Base attack: the creature's basic attack, falling back to its special attack
    # (some pets, e.g. the Eldritch Hound, only have the special). Damage stats only.
    atk_ref = creature.get("attackSkillName", "").strip() or creature.get("specialAttackSkillName", "").strip()
    attack_stats: dict[str, float] = {}
    if atk_ref:
        atk_chain = power_skill_chain(db, db.get(atk_ref))
        attack_stats = {k: v for k, v in extract_power_stats(atk_chain, level).items()
                        if k not in POWER_META_FIELDS}
    return {
        "name_tag": name_key,
        "count": int(count) if count else None,
        "duration": duration,
        "attack_stats": attack_stats,
    }


def extract_weapon_requirement(skill: dict[str, str], tags: dict[str, str],
                                skill_ref: str, game_en: dict[str, str]):
    weapons = [w for w in WEAPON_FLAGS if skill.get(w, "0").strip() not in ("0", "")]
    if not weapons:
        return None
    desc_tag = skill.get("skillBaseDescription", "")
    is_requires_tag = desc_tag.startswith("tagDevotion_Requires")
    resolved_desc_tag = desc_tag if is_requires_tag and desc_tag in tags else None
    desc = clean_text(tags[resolved_desc_tag]) if resolved_desc_tag else None
    desc_key = register(resolved_desc_tag or f"x:weap:{skill_ref}", desc, game_en)
    return {"weapons": weapons, "description_tag": desc_key}


def read_position(rec: dict[str, str]):
    """(bitmapPositionX, bitmapPositionY) -> {x, y} on the shared devotion-map
    canvas, or None. All stars/backgrounds share one coordinate plane (a negative
    origin), so these can be drawn directly to recreate the starmap."""
    x = as_number(rec.get("bitmapPositionX", ""))
    y = as_number(rec.get("bitmapPositionY", ""))
    if x is None and y is None:
        return None
    return {"x": int(x or 0), "y": int(y or 0)}


# ---------------------------------------------------------------------------
# Core parsing
# ---------------------------------------------------------------------------

def parse_affinity_map(rec: dict[str, str], value_key: str, name_key: str) -> dict[str, int]:
    """Read affinityGiven{i}/affinityGivenName{i} style paired fields -> {affinity: n}."""
    result: dict[str, int] = {}
    for i in range(1, 6):
        name = rec.get(f"{name_key}{i}", "").strip().lower()
        amount = as_number(rec.get(f"{value_key}{i}", "0"))
        if name and amount:
            result[name] = result.get(name, 0) + int(amount)
    return result


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return s or "constellation"


def parse_star(db: DB, tags: dict[str, str], button_ref: str, warnings: list[str],
                game_en: dict[str, str]):
    """Resolve a devotionButton -> UI button -> skill record -> star dict."""
    button = db.get(button_ref)
    skill_ref = button.get("skillName", "").strip()
    if not skill_ref:
        warnings.append(f"button {button_ref} has no skillName")
        return None, skill_ref
    skill = db.get(skill_ref)
    cls = skill.get("Class", "").strip()
    is_passive = cls in PASSIVE_CLASSES

    star = {
        "dbr": skill_ref,
        "predecessors": [],  # filled by caller from devotionLinks
        "position": read_position(button),  # star's (x,y) on the shared map canvas
        "bonuses": {},
        "celestial_power": None,
        "weapon_requirement": extract_weapon_requirement(skill, tags, skill_ref, game_en),
    }

    if is_passive:
        star["bonuses"] = extract_bonuses(skill)
        # racialBonusPercentDamage/Defense apply only vs a monster race; keep the
        # resolved race target so that context isn't lost.
        race_raw = skill.get("racialBonusRace", "").strip()
        if race_raw:
            races = [clean_text(tags.get(f"tag{r.strip()}", r.strip()))
                     for r in race_raw.split(";") if r.strip()]
            if races:
                star["racial_target"] = races
        pet_ref = skill.get("petBonusName", "").strip()
        if pet_ref:
            pet_skill = db.get(pet_ref)
            pet_bonuses = extract_bonuses(pet_skill)
            if pet_bonuses:
                star["pet_bonuses"] = pet_bonuses
                star["pet_bonus_dbr"] = pet_ref
    else:
        # Celestial power node: the granted proc skill, not passive stats. The
        # ability (proc trigger + per-level stats) is read across the skill chain
        # at the fixed granted level; see CELESTIAL_POWER_LEVEL.
        chain = power_skill_chain(db, skill)
        name, desc, name_tag_raw, desc_tag_raw = resolve_power_name(tags, chain)
        level = granted_level(chain)
        name_key = register(name_tag_raw or f"x:pow:{skill_ref}:name", name, game_en)
        desc_key = register(desc_tag_raw or f"x:pow:{skill_ref}:desc", desc, game_en)
        star["celestial_power"] = {
            "name_tag": name_key,
            "dbr": skill_ref,
            "skill_class": cls,
            "description_tag": desc_key,
            "proc": extract_proc(db, chain),
            "level": level,
            "stats": extract_power_stats(chain, level),
            "pet": extract_pet(db, tags, skill, level, skill_ref, game_en),
        }
    return star, skill_ref


def resolve_power_name(tags: dict[str, str], chain: list[dict[str, str]]):
    """Find a celestial power's display name + description.

    Direct attack skills carry skillDisplayName themselves; buff/aura skills
    (Skill_BuffRadius, etc.) put it on the child skill referenced by
    buffSkillName / petSkillName. Fall back to FileDescription's "X - Power".

    Returns (name, desc, name_tag, desc_tag); the two tags are the game tags
    that resolved (or None, e.g. when name falls back to FileDescription).
    """
    name = ""
    desc = ""
    name_tag = ""
    desc_tag = ""
    for rec in chain:
        tag = rec.get("skillDisplayName", "").strip()
        if tag and tag in tags and not name:
            name = clean_text(tags[tag])
            name_tag = tag
        dtag = rec.get("skillBaseDescription", "").strip()
        if dtag and dtag in tags and not desc:
            desc = clean_text(tags[dtag])
            desc_tag = dtag
        if name:
            break

    if not name:
        fd = chain[0].get("FileDescription", "").strip()
        name = fd.split(" - ", 1)[1].strip() if " - " in fd else fd
    return name or None, desc or None, name_tag or None, desc_tag or None


def parse_constellation(db: DB, tags: dict[str, str], con_path: Path, warnings: list[str],
                         game_en: dict[str, str]):
    rec = read_dbr(con_path)
    tpl = rec.get("templateName", "")
    if not tpl.endswith("devotionconstellation.tpl"):
        return None

    # Collect ordered star buttons (devotionButton1, devotionButton2, ...)
    button_refs: list[str] = []
    i = 1
    while True:
        ref = rec.get(f"devotionButton{i}", "").strip()
        if not ref:
            break
        button_refs.append(ref)
        i += 1
    if not button_refs:
        return None  # layout placeholder with no stars

    name_tag = rec.get("constellationDisplayTag", "").strip()
    name = clean_text(tags.get(name_tag, name_tag)) or rec.get("FileDescription", con_path.stem)
    if name_tag and name_tag not in tags:
        warnings.append(f"{con_path.name}: unresolved name tag {name_tag}")

    # Tier from the star path prefix, e.g. tier1_01a -> 1
    tier = None
    m = re.search(r"tier(\d)_", button_refs[0])
    if m:
        tier = int(m.group(1))

    affinity_required = parse_affinity_map(rec, "affinityRequired", "affinityRequiredName")
    affinity_bonus = parse_affinity_map(rec, "affinityGiven", "affinityGivenName")

    # Constellation artwork (a .tex) + where it sits on the shared map canvas.
    # Lives in the sibling constellationNN_background.dbr.
    background = None
    bg_path = con_path.with_name(con_path.stem + "_background.dbr")
    if bg_path.exists():
        bg = read_dbr(bg_path)
        img = bg.get("bitmapName", "").strip()
        pos = read_position(bg)
        if img or pos:
            background = {
                "image": img or None,
                "x": pos["x"] if pos else None,
                "y": pos["y"] if pos else None,
                "dbr": str(bg_path.relative_to(db.root)).replace("\\", "/"),
            }

    stars = []
    for ref in button_refs:
        star, _ = parse_star(db, tags, ref, warnings, game_en)
        if star is None:
            star = {"dbr": ref, "predecessors": [], "position": None, "bonuses": {},
                    "celestial_power": None, "weapon_requirement": None}
        stars.append(star)

    # Predecessors: devotionLinks{n} = 1-based index of the star that must be
    # taken before star n. Convert to 0-based predecessor lists.
    for n in range(1, len(stars) + 1):
        raw = rec.get(f"devotionLinks{n}", "").strip()
        if not raw:
            continue
        preds = []
        for part in raw.split(";"):
            part = part.strip()
            if not part:
                continue
            try:
                preds.append(int(part) - 1)
            except ValueError:
                warnings.append(f"{con_path.name}: bad devotionLinks{n}={raw}")
        stars[n - 1]["predecessors"] = [p for p in preds if 0 <= p < len(stars)]

    for idx, star in enumerate(stars):
        star_obj = {"index": idx}
        star_obj.update(star)
        stars[idx] = star_obj

    con_id = slugify(name)
    resolved_name_tag = register(name_tag or f"x:con:{con_id}:name", name, game_en)

    return {
        "id": con_id,
        "name_tag": resolved_name_tag,
        "tier": tier,
        "dbr": str(con_path.relative_to(db.root)).replace("\\", "/"),
        "affinity_required": affinity_required,
        "affinity_bonus": affinity_bonus,
        "background": background,
        "point_cost": len(stars),
        "stars": stars,
    }


# ---------------------------------------------------------------------------
# Assembly + validation
# ---------------------------------------------------------------------------

def ensure_unique_ids(constellations: list[dict]):
    from collections import Counter
    name_counts = Counter(c["id"] for c in constellations)
    used: set[str] = set()
    for c in constellations:
        base = c["id"]
        if name_counts[base] > 1:
            # Disambiguate every member of a duplicate set (e.g. the 5 Crossroads)
            # by the affinity it grants, for stable, readable ids.
            suffix = "_".join(sorted(c["affinity_bonus"])) or Path(c["dbr"]).stem
            cid = f"{base}_{suffix}"
            while cid in used:
                cid = f"{base}_{Path(c['dbr']).stem}"
            c["id"] = cid
        used.add(c["id"])


def validate(constellations: list[dict], game_en: dict[str, str], warnings: list[str]) -> list[str]:
    report: list[str] = []
    report.append(f"Constellations parsed: {len(constellations)}")
    if len(constellations) < 40:
        report.append(f"  WARNING: expected ~50+, got {len(constellations)}")

    total_stars = sum(c["point_cost"] for c in constellations)
    report.append(f"Total stars (devotion points to take everything): {total_stars}")

    ids = [c["id"] for c in constellations]
    dupe = {x for x in ids if ids.count(x) > 1}
    if dupe:
        report.append(f"  ERROR: duplicate ids: {sorted(dupe)}")

    bad_aff = set()
    for c in constellations:
        for m in (c["affinity_required"], c["affinity_bonus"]):
            bad_aff |= set(m) - AFFINITY_SET
    if bad_aff:
        report.append(f"  ERROR: unknown affinity keys: {sorted(bad_aff)}")
    else:
        report.append("Affinity keys: all within the five known affinities. OK")

    # Every *_tag/key referenced anywhere in the output must resolve to non-empty
    # English text in game_en - this is the tag-completeness check that replaced
    # the old "unresolved tag... leaking" scan (that scan is now moot: there is no
    # baked English left to leak from, only tags).
    referenced_tags: list[tuple[str, str]] = []
    bad_pred = 0
    powers = 0
    powers_with_proc = 0
    powers_with_stats = 0
    weapon_reqs = 0
    stars_total = 0
    stars_no_pos = 0
    cons_no_bg = 0
    for c in constellations:
        referenced_tags.append((f"constellation {c['id']}", c["name_tag"]))
        if not c.get("background"):
            cons_no_bg += 1
        n = len(c["stars"])
        for s in c["stars"]:
            stars_total += 1
            if not s.get("position"):
                stars_no_pos += 1
            for p in s["predecessors"]:
                if not (0 <= p < n):
                    bad_pred += 1
            if s["celestial_power"]:
                powers += 1
                cp = s["celestial_power"]
                referenced_tags.append((f"power {cp['dbr']} name", cp["name_tag"]))
                referenced_tags.append((f"power {cp['dbr']} description", cp["description_tag"]))
                if cp.get("proc"):
                    powers_with_proc += 1
                if cp.get("stats"):
                    powers_with_stats += 1
                else:
                    warnings.append(f"power {cp['name_tag']} ({cp['dbr']}) parsed no stats")
                pet = cp.get("pet")
                if pet:
                    referenced_tags.append((f"pet {cp['dbr']}", pet["name_tag"]))
            if s["weapon_requirement"]:
                weapon_reqs += 1
                referenced_tags.append((f"weapon requirement {s['dbr']}",
                                        s["weapon_requirement"]["description_tag"]))
    report.append(f"Celestial powers found: {powers}")
    report.append(f"Celestial powers with a proc trigger: {powers_with_proc}/{powers}")
    report.append(f"Celestial powers with parsed stats: {powers_with_stats}/{powers}"
                  + ("  WARNING" if powers_with_stats < powers else "  OK"))
    report.append(f"Stars with weapon requirement: {weapon_reqs}")
    report.append(f"Stars missing a map position: {stars_no_pos}/{stars_total}"
                  + ("  WARNING" if stars_no_pos else "  OK"))
    report.append(f"Constellations missing background art: {cons_no_bg}"
                  + ("  WARNING" if cons_no_bg else "  OK"))
    report.append(f"Predecessor indices out of range: {bad_pred}"
                  + ("  ERROR" if bad_pred else "  OK"))

    miss = sum(1 for _, tag in referenced_tags if not game_en.get(tag))
    report.append(f"Referenced tags missing from game table: {miss}"
                  + ("  ERROR" if miss else "  OK"))

    by_tier: dict = {}
    for c in constellations:
        by_tier.setdefault(c["tier"], 0)
        by_tier[c["tier"]] += 1
    report.append("Constellations by tier: "
                  + ", ".join(f"T{k}={v}" for k, v in sorted(by_tier.items(), key=lambda x: (x[0] is None, x[0]))))
    return report


def write_duckdb_csv(db: DB, out_csv: Path):
    """Emit a tidy long-format (dbr, key, value) table of all devotion records."""
    roots = [
        db.root / "records/skills/devotion",
        db.root / "records/ui/skills/devotion",
    ]
    rows = 0
    with out_csv.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["dbr", "key", "value"])
        for base in roots:
            for dbr in sorted(base.rglob("*.dbr")):
                rel = str(dbr.relative_to(db.root)).replace("\\", "/")
                for k, v in read_dbr(dbr).items():
                    w.writerow([rel, k, v])
                    rows += 1
    return rows


def build_stat_labels(constellations: list[dict]) -> dict[str, str]:
    """Collect every raw stat key used, with a best-effort human label."""
    keys = set()
    for c in constellations:
        for s in c["stars"]:
            keys |= set(s["bonuses"])
            keys |= set(s.get("pet_bonuses", {}))

    def humanize(k: str) -> str:
        s = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", k)
        s = s.replace(".", " ").replace("_", " ")
        return s[:1].upper() + s[1:]

    return {k: humanize(k) for k in sorted(keys)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Parse Grim Dawn devotion .dbr records into devotions.json")
    ap.add_argument("--records-dir", required=True, type=Path,
                    help="Extracted records dir (the folder containing 'records/')")
    ap.add_argument("--text-dir", required=True, type=Path,
                    help="Extracted text_en dir (containing tags_*.txt)")
    ap.add_argument("--out", default=Path("devotions.json"), type=Path)
    ap.add_argument("--game-version", default="unknown",
                    help="Game version string to stamp into meta")
    ap.add_argument("--steam-buildid", default=None,
                    help="Steam build id to record in meta for provenance")
    ap.add_argument("--duckdb", action="store_true",
                    help="Also emit devotion_records.csv (long format) for ad-hoc querying")
    ap.add_argument("--stat-labels", action="store_true",
                    help="Also emit stat_labels.json (raw stat id -> human label)")
    args = ap.parse_args(argv)

    db = DB(args.records_dir.resolve())
    con_dir = db.devotion_constellations_dir
    if not con_dir.is_dir():
        print(f"ERROR: devotion records not found under {con_dir}", file=sys.stderr)
        print("Run `just extract` first (extracts database.arz + Text_EN.arc).", file=sys.stderr)
        return 2

    tags = load_translations(args.text_dir.resolve())
    if not tags:
        print(f"ERROR: no translations loaded from {args.text_dir}", file=sys.stderr)
        print("Run `just extract` to produce text_en/*.txt.", file=sys.stderr)
        return 2
    print(f"Loaded {len(tags)} translation tags.")

    warnings: list[str] = []
    constellations: list[dict] = []
    game_en: dict[str, str] = {}
    for con_path in sorted(con_dir.glob("constellation*.dbr")):
        if "_background" in con_path.name:
            continue
        c = parse_constellation(db, tags, con_path, warnings, game_en)
        if c:
            constellations.append(c)

    constellations.sort(key=lambda c: (c["tier"] is None, c["tier"], game_en.get(c["name_tag"], c["id"])))
    ensure_unique_ids(constellations)

    meta = {
        "game_version": args.game_version,
        "steam_buildid": args.steam_buildid,
        "extracted_from": "records/ui/skills/devotion/",
        "generated_utc": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "affinities": AFFINITIES,
    }
    doc = {"meta": meta, "constellations": constellations}
    args.out.write_text(json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {args.out}  ({len(constellations)} constellations)")

    if args.stat_labels:
        labels = build_stat_labels(constellations)
        lp = args.out.parent / "stat_labels.json"
        lp.write_text(json.dumps(labels, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"Wrote {lp}  ({len(labels)} stat keys)")

    if args.duckdb:
        cp = args.out.parent / "devotion_records.csv"
        rows = write_duckdb_csv(db, cp)
        print(f"Wrote {cp}  ({rows} rows)")

    print("\n=== VALIDATION REPORT ===")
    report = validate(constellations, game_en, warnings)
    for line in report:
        print("  " + line)
    if warnings:
        print(f"\n  {len(warnings)} parser warning(s):")
        for wmsg in warnings[:25]:
            print("    - " + wmsg)
        if len(warnings) > 25:
            print(f"    ... and {len(warnings) - 25} more")

    errored = any("ERROR" in ln for ln in report)
    return 1 if errored else 0


if __name__ == "__main__":
    raise SystemExit(main())
