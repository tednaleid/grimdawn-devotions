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


# ---------------------------------------------------------------------------
# Generic .dbr + translation readers
# ---------------------------------------------------------------------------

def read_dbr(path: Path) -> dict[str, str]:
    """One .dbr file -> {key: value}. Each line is `key,value,` (trailing comma)."""
    out: dict[str, str] = {}
    try:
        text = path.read_text(encoding="utf-8-sig", errors="replace")
    except OSError:
        return out
    for line in text.splitlines():
        if not line or "," not in line:
            continue
        key, value = line.split(",", 1)
        key = key.strip()
        if not key:
            continue
        # Drop only the single trailing comma the format appends; values may
        # themselves contain commas/semicolons, so don't split further.
        if value.endswith(","):
            value = value[:-1]
        out[key] = value
    return out


def load_translations(text_dir: Path) -> dict[str, str]:
    """Glob every *.txt under text_dir and build tag -> display text."""
    tags: dict[str, str] = {}
    files = list(text_dir.rglob("*.txt"))
    for fp in files:
        try:
            text = fp.read_text(encoding="utf-8-sig", errors="replace")
        except OSError:
            continue
        for line in text.splitlines():
            tag, sep, val = line.partition("=")
            if not sep:
                continue
            tag = tag.strip()
            if tag:
                tags[tag] = val.strip()
    return tags


def clean_text(s: str) -> str:
    """Strip Grim Dawn formatting control codes (^o, ^n, {^...}) from display text."""
    s = re.sub(r"\{\^[a-zA-Z]\}", "", s)
    s = re.sub(r"\^[a-zA-Z]", "", s)
    return s.strip()


# ---------------------------------------------------------------------------
# Reference resolution
# ---------------------------------------------------------------------------

class DB:
    """Resolves `records/...` reference paths against the extracted db root."""

    def __init__(self, records_dir: Path):
        if (records_dir / "records").is_dir():
            self.root = records_dir
        elif records_dir.name == "records" and (records_dir / "ui").is_dir():
            self.root = records_dir.parent
        else:
            self.root = records_dir
        self._cache: dict[str, dict[str, str]] = {}

    def path(self, ref: str) -> Path:
        return self.root / ref.replace("\\", "/")

    def get(self, ref: str) -> dict[str, str]:
        ref = ref.replace("\\", "/").strip()
        if ref not in self._cache:
            self._cache[ref] = read_dbr(self.path(ref))
        return self._cache[ref]

    @property
    def devotion_constellations_dir(self) -> Path:
        return self.root / "records/ui/skills/devotion/constellations"


# ---------------------------------------------------------------------------
# Value helpers
# ---------------------------------------------------------------------------

def as_number(value: str):
    """Parse a scalar .dbr value to int/float, or None if not a single number."""
    v = value.strip()
    if not v or ";" in v:  # level-array values belong to proc skills, not passives
        return None
    try:
        f = float(v)
    except ValueError:
        return None
    r = round(f, 4)
    return int(r) if r == int(r) else r


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


def extract_weapon_requirement(skill: dict[str, str], tags: dict[str, str]):
    weapons = [w for w in WEAPON_FLAGS if skill.get(w, "0").strip() not in ("0", "")]
    if not weapons:
        return None
    desc_tag = skill.get("skillBaseDescription", "")
    desc = clean_text(tags.get(desc_tag, "")) if desc_tag.startswith("tagDevotion_Requires") else ""
    return {"weapons": weapons, "description": desc or None}


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


def parse_star(db: DB, tags: dict[str, str], button_ref: str, warnings: list[str]):
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
        "weapon_requirement": extract_weapon_requirement(skill, tags),
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
        # Celestial power node: the granted proc skill, not passive stats.
        name, desc = resolve_power_name(db, tags, skill)
        star["celestial_power"] = {
            "name": name,
            "dbr": skill_ref,
            "skill_class": cls,
            "description": desc,
        }
    return star, skill_ref


def resolve_power_name(db: DB, tags: dict[str, str], skill: dict[str, str]):
    """Find a celestial power's display name + description.

    Direct attack skills carry skillDisplayName themselves; buff/aura skills
    (Skill_BuffRadius, etc.) put it on the child skill referenced by
    buffSkillName / petSkillName. Fall back to FileDescription's "X - Power".
    """
    candidates = [skill]
    for ref_key in ("buffSkillName", "petSkillName", "modifierSkillName"):
        ref = skill.get(ref_key, "").strip()
        if ref:
            candidates.append(db.get(ref))

    name = ""
    desc = ""
    for rec in candidates:
        tag = rec.get("skillDisplayName", "").strip()
        if tag and tag in tags and not name:
            name = clean_text(tags[tag])
        dtag = rec.get("skillBaseDescription", "").strip()
        if dtag and dtag in tags and not desc:
            desc = clean_text(tags[dtag])
        if name:
            break

    if not name:
        fd = skill.get("FileDescription", "").strip()
        name = fd.split(" - ", 1)[1].strip() if " - " in fd else fd
    return name or None, desc or None


def parse_constellation(db: DB, tags: dict[str, str], con_path: Path, warnings: list[str]):
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
        star, _ = parse_star(db, tags, ref, warnings)
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

    return {
        "id": slugify(name),
        "name": name,
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


def validate(constellations: list[dict], tags: dict[str, str]) -> list[str]:
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

    leak = 0
    bad_pred = 0
    powers = 0
    weapon_reqs = 0
    stars_total = 0
    stars_no_pos = 0
    cons_no_bg = 0
    for c in constellations:
        if c["name"].startswith("tag"):
            leak += 1
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
                if (s["celestial_power"]["name"] or "").startswith("tag"):
                    leak += 1
            if s["weapon_requirement"]:
                weapon_reqs += 1
    report.append(f"Celestial powers found: {powers}")
    report.append(f"Stars with weapon requirement: {weapon_reqs}")
    report.append(f"Stars missing a map position: {stars_no_pos}/{stars_total}"
                  + ("  WARNING" if stars_no_pos else "  OK"))
    report.append(f"Constellations missing background art: {cons_no_bg}"
                  + ("  WARNING" if cons_no_bg else "  OK"))
    report.append(f"Predecessor indices out of range: {bad_pred}"
                  + ("  ERROR" if bad_pred else "  OK"))
    report.append(f"Unresolved tag... names leaking: {leak}"
                  + ("  ERROR" if leak else "  OK"))

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
    for con_path in sorted(con_dir.glob("constellation*.dbr")):
        if "_background" in con_path.name:
            continue
        c = parse_constellation(db, tags, con_path, warnings)
        if c:
            constellations.append(c)

    constellations.sort(key=lambda c: (c["tier"] is None, c["tier"], c["name"]))
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
    report = validate(constellations, tags)
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
