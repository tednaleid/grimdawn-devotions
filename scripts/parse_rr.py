#!/usr/bin/env -S uv run --script
# ABOUTME: Parses Grim Dawn extracted .dbr records into data/resistance-reduction.json.
# ABOUTME: Stdlib-only; catalogues every player-reachable source of enemy resistance reduction.
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Catalogue every source of enemy resistance reduction from the extracted records.

See docs/superpowers/specs/2026-07-21-resistance-reduction-pipeline-design.md for
the field mapping and disambiguation rules. Pure stdlib; re-run after any patch.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gd_dbr import DB, level_array_value, load_translations, register  # noqa: E402,F401

import re  # noqa: E402

RR_PERCENT = "reduced-percent"
RR_FLAT = "reduced-flat"
RR_STACKING = "stacking"

ELEMENTAL = ["Fire", "Cold", "Lightning"]

# Bare defensive<Type> tokens that are RR when negative (per the spec's Step 0).
STACKING_TOKENS = {
    "Physical", "Pierce", "Fire", "Cold", "Lightning",
    "Poison", "Aether", "Chaos", "Life", "Bleeding",
}
# Token -> display label where the game name differs from the field token.
TYPE_LABEL = {"Poison": "Poison & Acid", "Life": "Vitality"}

_OFFENSIVE_RE = re.compile(
    r"^offensive(Total|Elemental|Physical)ResistanceReduction(Absolute|Percent)Min$")


def classify_offensive_field(field: str):
    """(rr_type, token) for an offensive RR *value* field, else None. Siblings
    (DurationMin/Chance) return None so only the value field yields a source."""
    m = _OFFENSIVE_RE.match(field)
    if not m:
        return None
    token, suffix = m.group(1), m.group(2)
    return (RR_PERCENT if suffix == "Percent" else RR_FLAT, token)


def stacking_token(field: str):
    """The stacking <Type> token for a bare defensive<Type> field (or the
    defensiveElementalResistance aggregate), else None."""
    if field in ("defensiveElementalResistance", "defensiveElemental"):
        return "Elemental"
    m = re.fullmatch(r"defensive([A-Za-z]+)", field)
    if m and m.group(1) in STACKING_TOKENS:
        return m.group(1)
    return None


def token_to_resistances(token: str):
    """Kept distinct, never pre-expanded: 'All' | 'Elemental' | [labels]."""
    if token == "Total":
        return "All"
    if token == "Elemental":
        return "Elemental"
    return [TYPE_LABEL.get(token, token)]


def parse_array(raw: str) -> list:
    """';'-separated per-rank numbers -> list (int when whole)."""
    out = []
    for part in raw.split(";"):
        part = part.strip()
        if not part:
            continue
        try:
            f = round(float(part), 4)
        except ValueError:
            continue
        out.append(int(f) if f == int(f) else f)
    return out


def iter_skill_records(db: DB):
    """Yield (posix record path like 'records/skills/...', parsed record) for every .dbr under skills."""
    skills_root = db.root / "records/skills"
    for p in sorted(skills_root.rglob("*.dbr")):
        rel = p.relative_to(db.root).as_posix()
        yield rel, db.get(rel)


def _name_descriptor(rec, rec_path, tags, game_en):
    """Localizable name: resolve skillDisplayName tag, else a stable synthesized key."""
    tag = rec.get("skillDisplayName", "").strip()
    text = tags.get(tag) if tag else None
    return register(tag or f"x:rr:{rec_path}", text, game_en)


def _int(v):
    v = (v or "").strip()
    try:
        return int(float(v)) if v else None
    except ValueError:
        return None


def rank_fields(raw, rec):
    """(values_per_rank, max_rank, value_at_max, ultimate_rank, value_at_ultimate).

    Class skills/modifiers use skillMaxLevel (base cap) and skillUltimateLevel (+skills
    overcap) to pick base vs overcap values. A devotion proc (skillMaxLevel <= 1) has a
    single value at the granted celestial-power level, which is the array's full extent."""
    arr = parse_array(raw)
    smax = _int(rec.get("skillMaxLevel"))
    sult = _int(rec.get("skillUltimateLevel"))
    if smax and smax > 1:
        max_rank = smax
        v_max = level_array_value(raw, smax)
        ult_rank = sult if (sult and sult > smax) else None
        v_ult = level_array_value(raw, ult_rank) if ult_rank else None
    else:
        max_rank = len(arr)
        v_max = arr[-1] if arr else None
        ult_rank = None
        v_ult = None
    return arr, max_rank, v_max, ult_rank, v_ult


def _num(s):
    s = (s or "").strip()
    if not s or ";" in s:
        return None
    try:
        f = round(float(s), 4)
        return int(f) if f == int(f) else f
    except ValueError:
        return None


def source_from_offensive(tags, game_en, rec_path, rec, field, rr_type, token):
    arr, max_rank, v_max, ult_rank, v_ult = rank_fields(rec[field], rec)
    base = field[:-len("Min")]  # e.g. offensiveElementalResistanceReductionAbsolute
    dur = rec.get(base + "DurationMin", "").strip()
    chance = rec.get(base + "Chance", "").strip()
    return {
        "id": rec_path.replace("/", ":").removesuffix(".dbr") + f":{rr_type}",
        "name": _name_descriptor(rec, rec_path, tags, game_en),
        "parent": None,   # filled by category/parent pass (Task 6)
        "record_path": rec_path,
        "category": None,  # Task 6
        "rr_type": rr_type,
        "resistances": token_to_resistances(token),
        "values_per_rank": arr,
        "max_rank": max_rank,
        "ultimate_rank": ult_rank,
        "value_at_max": v_max,
        "value_at_ultimate": v_ult,
        "duration_seconds": _num(dur),
        "cooldown_seconds": _num(rec.get("skillCooldownTime", "")),
        "trigger_chance_percent": _num(chance),
        "trigger": None,   # Task 6 classification
        "per_resistance_values": None,
        "notes": "",
    }


DEBUFF_TEMPLATES = {
    "skillbuff_debuf.tpl", "skillbuff_contageous.tpl",
    "skillbuff_debuftrap.tpl", "skillbuff_debuffreeze.tpl",
}
SELF_TEMPLATES = {"skill_buffselfduration.tpl"}
MODIFIER_TEMPLATE = "skill_modifier.tpl"

EXCLUSIONS: list = []  # {record_path, reason} for the summary


def template_name(rec) -> str:
    return rec.get("templateName", "").rsplit("/", 1)[-1]


def reverse_ref_index(db):
    """Map each referenced 'records/.../x.dbr' -> [record paths that reference it]."""
    index: dict[str, list[str]] = {}
    for rec_path, rec in iter_skill_records(db):
        for v in rec.values():
            if v.endswith(".dbr") and "records/" in v:
                ref = v.replace("\\", "/").strip()
                index.setdefault(ref, []).append(rec_path)
    return index


def build_modifier_base(db):
    """modifier record_path -> the base skill it augments, read from the class trees.
    In a _classtree_*.dbr the skillNameNN entries list each base skill followed by its
    modifier(s); a modifier's base is the nearest preceding non-modifier entry."""
    mmap: dict[str, str] = {}
    skills_root = db.root / "records/skills"
    for p in sorted(skills_root.rglob("_classtree_*.dbr")):
        rec = db.get(p.relative_to(db.root).as_posix())
        entries = []
        for k, v in rec.items():
            m = re.fullmatch(r"skillName(\d+)", k)
            if m and v.strip():
                entries.append((int(m.group(1)), v.replace("\\", "/").strip()))
        entries.sort()
        last_base = None
        for _, ref in entries:
            if template_name(db.get(ref)) == MODIFIER_TEMPLATE:
                if last_base:
                    mmap[ref] = last_base
            else:
                last_base = ref
    return mmap


def _reaches_debuff(db, ref, depth=4) -> bool:
    """True when a skill (or its buffSkillName/petSkillName chain) is a debuff template."""
    seen = set()
    stack = [(ref, depth)]
    while stack:
        cur, d = stack.pop()
        cur = cur.replace("\\", "/").strip()
        if not cur or cur in seen or d < 0:
            continue
        seen.add(cur)
        rec = db.get(cur)
        if template_name(rec) in DEBUFF_TEMPLATES:
            return True
        for f in ("buffSkillName", "petSkillName"):
            nxt = rec.get(f, "").strip()
            if nxt:
                stack.append((nxt, d - 1))
    return False


def is_enemy_facing_modifier(db, rec_path, ctx) -> bool:
    """A skill_modifier is enemy-facing when the base skill it augments (via the class
    tree) reaches a debuff template, or, failing a tree link, when a skill referencing
    it does. Covers toggled auras (Veil of Shadow's base -> its _buff debuff)."""
    base = ctx["mmap"].get(rec_path)
    if base and _reaches_debuff(db, base):
        return True
    for referrer in ctx["index"].get(rec_path, []):
        if _reaches_debuff(db, referrer, depth=2):
            return True
    return False


def stacking_sources(db, tags, game_en, rec_path, rec, ctx):
    """Zero or more stacking sources from one record's negative defensive<Type> fields."""
    tmpl = template_name(rec)
    hits = []
    for field, raw in rec.items():
        token = stacking_token(field)
        if not token:
            continue
        arr = parse_array(raw)
        if not arr or arr[-1] >= 0:  # only negative = reduction
            continue
        hits.append((token, raw, arr))
    if not hits:
        return []
    # Template gate: debuffs pass clean; self-buff templates are excluded (a self-applied
    # negative resistance is a player downside, not enemy RR). A modifier's negative
    # defensive resistance always reduces a target's resistance, so it is included even when
    # its base skill is item- or pet-wired (not in a class tree); we only annotate the ones
    # we could not confirm reach an enemy debuff, per the include-with-a-note rigor rule.
    note = ""
    if tmpl in DEBUFF_TEMPLATES:
        pass
    elif tmpl == MODIFIER_TEMPLATE:
        if not is_enemy_facing_modifier(db, rec_path, ctx):
            note = "modifier base not resolved to an enemy debuff; verify"
    elif tmpl in SELF_TEMPLATES:
        EXCLUSIONS.append({"record_path": rec_path, "reason": f"self template {tmpl}"})
        return []
    else:
        note = f"unusual template {tmpl}; verify enemy-facing"
    out = []
    for token, raw, _arr in hits:
        arr, max_rank, v_max, ult_rank, v_ult = rank_fields(raw, rec)
        out.append({
            "id": rec_path.replace("/", ":").removesuffix(".dbr") + f":stacking:{token}",
            "name": _name_descriptor(rec, rec_path, tags, game_en),
            "parent": None, "record_path": rec_path, "category": None,
            "rr_type": RR_STACKING,
            "resistances": token_to_resistances(token),
            "values_per_rank": arr, "max_rank": max_rank, "ultimate_rank": ult_rank,
            "value_at_max": v_max,
            "value_at_ultimate": v_ult,
            "duration_seconds": _num(rec.get("skillActiveDuration", "")),
            "cooldown_seconds": _num(rec.get("skillCooldownTime", "")),
            "trigger_chance_percent": None,
            "trigger": None, "per_resistance_values": None,
            "notes": note,
        })
    return out


def classify_category(rec_path, rec) -> str:
    """Category from the record's path and template. Item-granted skills are refined
    by attribute_items; this is the skill-intrinsic default."""
    tmpl = template_name(rec)
    if "/devotion/" in rec_path:
        return "devotion"
    if "/itemskills" in rec_path:
        return "item skill modifier" if tmpl == MODIFIER_TEMPLATE else "item granted"
    if tmpl == MODIFIER_TEMPLATE:
        return "modifier"
    return "mastery skill"


def classify_trigger(rec) -> str:
    """Coarse trigger classification from the record's template/wiring."""
    tmpl = template_name(rec)
    if "debuftrap" in tmpl:
        return "field/trap"
    if "contageous" in tmpl:
        return "contagious debuff"
    if "toggled" in template_name(rec) or rec.get("buffSkillName", "").strip():
        return "passive aura"
    if "/pets/" in rec.get("templateName", ""):
        return "pet aura"
    return "debuff"


def _parent_descriptor(tags, game_en, rec_path, rec):
    """Localizable parent label. For skill sources this is the skill's own name for now;
    mastery/constellation parent resolution is a follow-up (the UI can also join against
    devotions.json). Item sources get their item name via attribute_items."""
    return _name_descriptor(rec, rec_path, tags, game_en)


ITEM_SKILL_FIELDS = (
    ["itemSkillName"]
    + [f"augmentSkillName{i}" for i in range(1, 6)]
    + [f"modifierSkillName{i}" for i in range(1, 6)]
)


def build_item_skill_map(db):
    """skill record_path -> (item record_path, is_item_skill_modifier). First item wins."""
    m: dict[str, tuple[str, bool]] = {}
    items_root = db.root / "records/items"
    for p in items_root.rglob("*.dbr"):
        rel = p.relative_to(db.root).as_posix()
        rec = db.get(rel)
        for f in ITEM_SKILL_FIELDS:
            v = rec.get(f, "").replace("\\", "/").strip()
            if v.endswith(".dbr"):
                m.setdefault(v, (rel, f.startswith("modifierSkillName")))
    return m


def item_category(rec) -> str:
    cls = rec.get("Class", "")
    classif = rec.get("itemClassification", "").strip()
    if cls == "ItemArtifact":
        return "relic"
    if cls == "ItemRelic":  # GD internal name for craftable components (materia/)
        return "component"
    if "Enchantment" in cls or "Augment" in cls:
        return "augment"
    if rec.get("itemSetName", "").strip():
        return "set bonus"
    if classif == "Rare":  # monster-infrequent items are the "Rare" (green) rarity
        return "monster infrequent"
    return "item granted"


def _item_name_descriptor(tags, game_en, item_path, rec):
    tag = rec.get("itemNameTag", "").strip()
    text = tags.get(tag) if tag else None
    return register(tag or f"x:rritem:{item_path}", text, game_en)


def attribute_items(db, tags, game_en, sources):
    """Override category/parent for item-owned RR sources. Only skills under
    records/skills/itemskills are item-owned; a class or devotion skill that an item
    merely references (grants +skills to, e.g. gloves referencing War Cry -> Break Morale)
    keeps its intrinsic category."""
    m = build_item_skill_map(db)
    for s in sources:
        if "/itemskills" not in s["record_path"]:
            continue
        info = m.get(s["record_path"])
        if not info:
            continue
        item_path, is_mod = info
        item_rec = db.get(item_path)
        s["category"] = "item skill modifier" if is_mod else item_category(item_rec)
        s["parent"] = _item_name_descriptor(tags, game_en, item_path, item_rec)
        if is_mod and s["notes"].startswith("modifier base not resolved"):
            s["notes"] = f"item skill modifier via {item_path}"


def collect_sources(db: DB, tags: dict[str, str], game_en: dict[str, str]) -> list[dict]:
    """Sweep the extraction and return one dict per RR source."""
    sources: list[dict] = []
    ctx = {"index": reverse_ref_index(db), "mmap": build_modifier_base(db)}
    for rec_path, rec in iter_skill_records(db):
        for field in rec:
            hit = classify_offensive_field(field)
            if hit:
                rr_type, token = hit
                sources.append(
                    source_from_offensive(tags, game_en, rec_path, rec, field, rr_type, token))
        sources.extend(stacking_sources(db, tags, game_en, rec_path, rec, ctx))
    for s in sources:
        rec = db.get(s["record_path"])
        s["category"] = classify_category(s["record_path"], rec)
        s["trigger"] = classify_trigger(rec)
        if s["parent"] is None:
            s["parent"] = _parent_descriptor(tags, game_en, s["record_path"], rec)
    attribute_items(db, tags, game_en, sources)
    return sources


def print_summary(sources, exclusions):
    """Audit summary to stderr: counts per type/category, exclusions, and the unsure list."""
    from collections import Counter
    by_type = Counter(s["rr_type"] for s in sources)
    by_cat = Counter(s["category"] for s in sources)
    # "unsure" = a note that asks for verification, not the informative provenance notes
    # (e.g. "item skill modifier via <item>") that attribution attaches.
    unsure = [s for s in sources if "verify" in s["notes"]]
    p = lambda *a: print(*a, file=sys.stderr)
    p("\n=== RR EXTRACTION SUMMARY ===")
    p(f"  sources: {len(sources)}")
    p("  by rr_type: " + ", ".join(f"{k}={v}" for k, v in sorted(by_type.items())))
    p("  by category: " + ", ".join(f"{k}={v}" for k, v in sorted(by_cat.items())))
    p(f"  excluded: {len(exclusions)}")
    for reason, n in Counter(e["reason"] for e in exclusions).items():
        p(f"    - {reason}: {n}")
    p(f"  unsure (carry a verify note): {len(unsure)}")
    for s in unsure[:15]:
        p(f"    - {s['record_path']}: {s['notes']}")
    if len(unsure) > 15:
        p(f"    ... and {len(unsure) - 15} more")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Parse Grim Dawn RR sources into resistance-reduction.json")
    ap.add_argument("--records-dir", required=True, type=Path)
    ap.add_argument("--text-dir", required=True, type=Path)
    ap.add_argument("--out", default=Path("resistance-reduction.json"), type=Path)
    ap.add_argument("--game-version", default="unknown")
    ap.add_argument("--steam-buildid", default=None)
    args = ap.parse_args(argv)

    db = DB(args.records_dir.resolve())
    if not (db.root / "records/skills").is_dir():
        print(f"ERROR: skills not found under {db.root}/records", file=sys.stderr)
        return 2
    tags = load_translations(args.text_dir.resolve())
    if not tags:
        print(f"ERROR: no translations loaded from {args.text_dir}", file=sys.stderr)
        return 2

    game_en: dict[str, str] = {}
    sources = collect_sources(db, tags, game_en)
    sources.sort(key=lambda s: (s["rr_type"], s["record_path"]))

    meta = {
        "game_version": args.game_version,
        "steam_buildid": args.steam_buildid,
        "generated_utc": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "berserker_present": (db.root / "records/skills/playerclass13").is_dir(),
    }
    doc = {"meta": meta, "sources": sources}
    args.out.write_text(json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {args.out}  ({len(sources)} sources)")
    print_summary(sources, EXCLUSIONS)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
