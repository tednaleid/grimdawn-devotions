#!/usr/bin/env -S uv run --script
# ABOUTME: Builds the derived typed item schema (entities/stats/relations parquet) from the raw
# ABOUTME: deposit plus the committed curation files in data/item-curation/ (see docs/item-schema.md).
# /// script
# requires-python = ">=3.10"
# dependencies = ["duckdb"]
# ///
"""Derived item schema: typed tables for the item-database SPA, built by SQL alone.

Inputs: the deposit parquet (facts/labels/meta, labels schema v2 with tag sources)
and data/item-curation/*.json. Outputs under data/derived/ (never committed;
released alongside the deposit - see docs/deposit.md):

  entities.parquet   one row per in-scope game record: identity, domain/type/slots
                     taxonomy, variant group key, rarity, computed requirements,
                     expansion, attacks per second.
  stats.parquet      long-form stats per entity (self + granted-skill sources) with
                     variance-applied display ranges.
  relations.parquet  applies_to / crafts / reagent / set_member / grants_skill edges.

Curation drift guards fail the build loudly when the game vocabulary outgrows the
committed curation files (new category, new Class value, stale stat id, unknown
attack-speed tier).

Requirements are computed per KTD3 of the plan: literal keys win when positive;
otherwise the record's itemCostName formula record (default itemcostformulas.dbr)
supplies per-gear-kind equations evaluated over itemLevel and totalAttCount with a
whitelisted AST evaluator. Results round half-up (pinned by the Sacrificial
Knife 74/93 and shield/jewelry card oracles).
"""
from __future__ import annotations

import argparse
import ast
import json
import math
import operator
import re
import sys
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).parent))
from build_deposit import file_size_str, open_deposit, read_meta, sql_str, warn_buildid_mismatch

DEFAULT_COST_RECORD = "records/game/itemcostformulas.dbr"

# Gear type -> the equation-key prefix inside a cost-formula record. The three
# per-prefix keys (<prefix>StrengthEquation/DexterityEquation/IntelligenceEquation)
# map onto physique/cunning/spirit. Types absent here (medal, component, ...) have
# no attribute-requirement equations in any formula record.
EQ_PREFIX = {
    "sword1h": "sword", "axe1h": "axe", "mace1h": "mace", "dagger": "dagger",
    "scepter": "scepter", "sword2h": "melee2h", "axe2h": "melee2h", "mace2h": "melee2h",
    "spear2h": "melee2h", "ranged1h": "ranged1h", "ranged2h": "ranged2h",
    "shield": "shield", "offhand": "offhand", "head": "head", "chest": "chest",
    "shoulders": "shoulders", "hands": "hands", "legs": "legs", "feet": "feet",
    "waist": "waist", "amulet": "amulet", "ring": "ring",
}
REQ_ATTRS = (("strength", "req_physique"), ("dexterity", "req_cunning"), ("intelligence", "req_spirit"))

def expansion_of_source(source: str | None) -> str | None:
    """KTD6: the earliest tag file defining the name tag names the expansion layer.

    Generalized past the three *_items files: any tagsgdx1_*/tagsgdx2_* file marks
    AoM/FG content (e.g. FG keystone blueprints name through tagsgdx2_endlessdungeon,
    quest-asset gear through tagsgdx2_storyelements); every base-game tag file maps
    to base. None (tag absent from the en labels) is the caller's diagnostic case.
    """
    if source is None:
        return None
    if source.startswith("tagsgdx1"):
        return "aom"
    if source.startswith("tagsgdx2"):
        return "fg"
    return "base"

# Weapon gear types that display attacks per second (shields/off-hands do not).
APS_TYPES = {"sword1h", "axe1h", "mace1h", "dagger", "scepter", "sword2h", "axe2h",
             "mace2h", "spear2h", "ranged1h", "ranged2h"}

# Domains whose records name themselves through `description` (weapons/armor use
# itemNameTag; their `description` is the lore quote instead).
DESCRIPTION_NAMED = {"component", "augment", "relic", "blueprint", "quest"}


# ---------------------------------------------------------------------------
# equation evaluator (KTD3: AST whitelist, ^ -> power, case-insensitive names)
# ---------------------------------------------------------------------------

_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
        ast.Div: operator.truediv, ast.Pow: operator.pow}


def eval_equation(expr: str, variables: dict[str, float]) -> float:
    """Evaluate a game equation string over `variables` (keys lowercase)."""
    tree = ast.parse(expr.replace("^", "**"), mode="eval")

    def ev(node: ast.AST) -> float:
        if isinstance(node, ast.Expression):
            return ev(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return float(node.value)
        if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
            return _OPS[type(node.op)](ev(node.left), ev(node.right))
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
            v = ev(node.operand)
            return -v if isinstance(node.op, ast.USub) else v
        if isinstance(node, ast.Name):
            name = node.id.lower()
            if name in variables:
                return variables[name]
            raise ValueError(f"unknown equation variable {node.id!r}")
        raise ValueError(f"disallowed equation syntax: {type(node).__name__}")

    return ev(tree)


# ---------------------------------------------------------------------------
# curation loading + drift guards
# ---------------------------------------------------------------------------

def load_curation(curation_dir: Path) -> dict:
    cur = {}
    for name in ("gear-types", "stat-families", "attack-speed", "variance", "factions"):
        p = curation_dir / f"{name}.json"
        if not p.is_file():
            print(f"ERROR: missing curation file {p}", file=sys.stderr)
            raise SystemExit(2)
        cur[name] = json.loads(p.read_text(encoding="utf-8"))
    return cur


def run_guards(con: duckdb.DuckDBPyConnection, cur: dict) -> None:
    """Fail loudly when the game vocabulary outgrows the curation files (KTD2)."""
    failures: list[str] = []

    cats = cur["gear-types"]["categories"]
    known_cats = set(cats)
    seen = {r[0] for r in con.execute(
        "SELECT DISTINCT 'records/items/' || regexp_extract(record, '^records/items/([^/]+)', 1) "
        "FROM facts WHERE record LIKE 'records/items/%'").fetchall()}
    if unknown := sorted(seen - known_cats):
        failures.append(f"categories missing from gear-types.json: {' '.join(unknown)}")

    scoped = sorted(c for c, domains in cats.items() if domains)
    classes = cur["gear-types"]["classes"]
    in_pred = " OR ".join(f"record LIKE {sql_str(c + '/%')}" for c in scoped)
    seen_classes = {r[0] for r in con.execute(
        f"SELECT DISTINCT value FROM facts WHERE key='Class' AND ({in_pred})").fetchall()}
    if missing := sorted(seen_classes - set(classes)):
        failures.append(f"Class values missing from gear-types.json: {' '.join(missing)}")

    known_keys = {r[0] for r in con.execute("SELECT DISTINCT key FROM facts").fetchall()}
    fam_ids = {i for fam in cur["stat-families"]["families"].values() for i in fam.get("ids", [])}
    if stale := sorted(fam_ids - known_keys):
        failures.append(f"stat-families.json ids absent from the deposit: {' '.join(stale)}")

    tiers = set(cur["attack-speed"]["tier_base"])
    gear_pred = " OR ".join(f"f.record LIKE {sql_str(c + '/%')}"
                            for c, domains in cats.items() if "gear" in domains)
    seen_tiers = {r[0] for r in con.execute(
        f"SELECT DISTINCT f.value FROM facts f JOIN facts c ON c.record=f.record AND c.key='Class' "
        f"WHERE f.key='characterBaseAttackSpeedTag' AND c.value LIKE 'Weapon%' "
        f"AND c.value NOT LIKE 'WeaponArmor%' AND ({gear_pred})").fetchall()}
    if unknown_tiers := sorted(seen_tiers - tiers):
        failures.append(f"attack-speed tiers missing from attack-speed.json: {' '.join(unknown_tiers)}")

    fac_map = set(cur["factions"]["faction_tags"])
    seen_fac = {r[0] for r in con.execute(
        "SELECT DISTINCT value FROM facts WHERE key='factionSource'").fetchall()}
    if unmapped := sorted(seen_fac - fac_map):
        failures.append(f"factionSource values missing from factions.json: {' '.join(unmapped)}")

    if failures:
        for f in failures:
            print(f"CURATION DRIFT: {f}", file=sys.stderr)
        print("Update data/item-curation/ (deliberately, reviewing the new vocabulary) "
              "and re-run `just derive`.", file=sys.stderr)
        raise SystemExit(1)


# ---------------------------------------------------------------------------
# entities
# ---------------------------------------------------------------------------

WIDE_KEYS = [
    "Class", "itemNameTag", "description", "itemText", "itemClassification",
    "itemLevel", "levelRequirement", "strengthRequirement", "dexterityRequirement",
    "intelligenceRequirement", "itemCostName", "characterBaseAttackSpeedTag",
    "characterBaseAttackSpeed", "itemSkillName", "itemSkillLevelEq", "itemSkillLevel",
    "itemSkillAutoController", "petBonusName", "itemSetName", "attributeScalePercent",
    "lootRandomizerName", "lootRandomizerJitter", "lootRandomizerCost",
]

# Value-bearing stat vocabulary shared by the self-stat and skill-rollup stages;
# structural plumbing keys never become stats rows.
STAT_KEY_RE = "^(offensive|retaliation|defensive|character)"
STAT_STRUCTURAL_RE = "(XOR|Global|Jitter|Equation|Tag$)"
STAT_EXTRA_IDS = ("augmentSkillLevel1", "augmentSkillLevel2", "augmentMasteryLevel1",
                  "augmentMasteryLevel2", "augmentAllLevel")
SKILL_CARD_IDS = ("skillManaCost", "skillCooldownTime", "skillActiveDuration",
                  "skillTargetRadius", "skillTargetNumber")
# APS plumbing (see attack-speed.json), not a display stat.
STAT_ID_BLOCKLIST = {"characterBaseAttackSpeed"}


def build_wide(con: duckdb.DuckDBPyConnection, cur: dict) -> None:
    """One row per in-scope record with the entity-relevant keys pivoted wide."""
    cats = cur["gear-types"]["categories"]
    classes = cur["gear-types"]["classes"]

    con.execute("CREATE TEMP TABLE class_map (class VARCHAR, domain VARCHAR, gear_type VARCHAR, slots VARCHAR[])")
    con.executemany("INSERT INTO class_map VALUES (?, ?, ?, ?)",
                    [(c, m.get("domain"), m.get("type"), m.get("slots", []))
                     for c, m in classes.items()])
    con.execute("CREATE TEMP TABLE cat_map (cat VARCHAR, domains VARCHAR[])")
    con.executemany("INSERT INTO cat_map VALUES (?, ?)", [(c, d) for c, d in cats.items()])

    keys_in = ", ".join(sql_str(k) for k in WIDE_KEYS)
    pivots = ",\n".join(
        f"max(CASE WHEN key = '{k}' THEN value END) AS \"{k}\"" for k in WIDE_KEYS)
    con.execute(f"""
        CREATE TEMP TABLE wide AS
        SELECT f.record, c.cat,
               {pivots}
        FROM facts f
        JOIN cat_map c ON len(c.domains) > 0 AND f.record LIKE c.cat || '/%'
        WHERE f.key IN ({keys_in})
        GROUP BY 1, 2""")
    # Scope: the record's Class maps to a domain allowed for its category.
    con.execute("""
        CREATE TEMP TABLE scoped AS
        SELECT w.*, m.domain, m.gear_type, m.slots
        FROM wide w
        JOIN class_map m ON m.class = w."Class"
        JOIN cat_map c ON c.cat = w.cat
        WHERE m.domain IS NOT NULL AND list_contains(c.domains, m.domain)""")


def load_cost_formulas(con: duckdb.DuckDBPyConnection) -> dict[str, dict[str, str]]:
    rows = con.execute(
        "SELECT record, key, value FROM facts WHERE record LIKE 'records/game/itemcostformulas%' "
        "AND key LIKE '%Equation'").fetchall()
    formulas: dict[str, dict[str, str]] = {}
    for record, key, value in rows:
        formulas.setdefault(record, {})[key.lower()] = value
    return formulas


def fnum(v: str | None) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def compute_att_counts(con: duckdb.DuckDBPyConnection) -> dict[str, int]:
    """totalAttCount per jewelry record: the engine's count of attribute entries.

    Calibrated exactly against the amulet oracles (Avatar of Mercy spirit 267 with
    7 stat groups; Avatar of Order 270 with 5 stat groups + 4 augment entries, both
    level 58): one count per unified stat group with a non-zero value (Min/Max
    pairs collapse to one; Modifier is its own group; chance/duration facets fold
    into their group), plus one per skill/mastery augment entry. A granted skill
    (itemSkillName) does NOT count.
    """
    rows = con.execute("""
        WITH jewelry AS (SELECT record FROM scoped WHERE gear_type IN ('amulet','ring','medal')),
        stat_groups AS (
          SELECT f.record,
                 regexp_replace(f.key, '(Min|Max|Chance|DurationMin|DurationMax|DurationModifier|ModifierChance)$', '') AS grp
          FROM facts f JOIN jewelry j ON j.record = f.record
          WHERE f.value_num IS NOT NULL AND f.value_num != 0
            AND regexp_matches(f.key, '^(offensive|retaliation|defensive|character)')
            AND NOT regexp_matches(f.key, '(XOR|Global|Jitter)')
          GROUP BY 1, 2
        ),
        augments AS (
          SELECT f.record, f.key AS grp FROM facts f JOIN jewelry j ON j.record = f.record
          WHERE f.key IN ('augmentSkillLevel1','augmentSkillLevel2','augmentMasteryLevel1',
                          'augmentMasteryLevel2','augmentAllLevel')
            AND f.value_num IS NOT NULL AND f.value_num != 0
        )
        SELECT record, count(*) FROM (
          SELECT * FROM stat_groups UNION SELECT * FROM augments)
        GROUP BY 1""").fetchall()
    return dict(rows)


def compute_requirements(row: dict, formulas: dict[str, dict[str, str]],
                         att_counts: dict[str, int], diag: dict) -> dict[str, int]:
    """KTD3 precedence: positive literals win; else the itemCostName formula record."""
    out = {"req_level": 0, "req_physique": 0, "req_cunning": 0, "req_spirit": 0}
    item_level = fnum(row["itemLevel"]) or 0.0

    lvl = fnum(row["levelRequirement"])
    if lvl and lvl > 0:
        out["req_level"] = int(lvl)
    elif item_level > 0:
        # The game's cards show Required Player Level == item level when no
        # literal exists (all six supplied card oracles agree).
        out["req_level"] = int(item_level)

    literals = {"req_physique": fnum(row["strengthRequirement"]),
                "req_cunning": fnum(row["dexterityRequirement"]),
                "req_spirit": fnum(row["intelligenceRequirement"])}

    prefix = EQ_PREFIX.get(row["gear_type"] or "")
    eqs = {}
    if prefix and item_level > 0:
        cost_name = (row["itemCostName"] or "").strip().lower() or DEFAULT_COST_RECORD
        record_eqs = formulas.get(cost_name)
        if record_eqs is None:
            diag["cost_record_missing"] += 1
            record_eqs = formulas.get(DEFAULT_COST_RECORD, {})
        if not row["itemCostName"]:
            diag["cost_default_used"] += 1
        eqs = record_eqs

    variables = {"itemlevel": item_level,
                 "totalattcount": float(att_counts.get(row["record"], 0))}
    for attr, col in REQ_ATTRS:
        lit = literals[col]
        if lit and lit > 0:
            out[col] = int(lit)
            continue
        expr = eqs.get(f"{prefix}{attr}equation") if prefix else None
        if expr:
            try:
                # Round half-up: the Sacrificial Knife card needs 92.96 -> 93 (spirit)
                # AND 74.37 -> 74 (cunning), which floor cannot produce together.
                out[col] = max(0, math.floor(eval_equation(expr, variables) + 0.5))
            except ValueError as e:
                diag["equation_errors"] += 1
                diag.setdefault("equation_error_sample", str(e))
        elif prefix and item_level > 0 and attr == "strength":
            pass  # kinds without a strength equation simply have no physique gate
    return out


def build_entities(con: duckdb.DuckDBPyConnection, cur: dict, out_dir: Path,
                   diag: dict) -> int:
    formulas = load_cost_formulas(con)
    att_counts = compute_att_counts(con)
    tier_base = cur["attack-speed"]["tier_base"]

    # Expansion: the en label's defining tag file for the record's name tag (KTD6).
    name_sources = dict(con.execute(
        "SELECT tag, source FROM labels WHERE locale = 'en'").fetchall())

    cols = [d[0] for d in con.execute("SELECT * FROM scoped LIMIT 0").description]
    rows = [dict(zip(cols, r)) for r in con.execute("SELECT * FROM scoped").fetchall()]

    con.execute("""
        CREATE TEMP TABLE entities (
          record VARCHAR, domain VARCHAR, gear_type VARCHAR, slots VARCHAR[],
          group_key VARCHAR, name_tag VARCHAR, text_tag VARCHAR, rarity VARCHAR,
          item_level INTEGER, req_level INTEGER, req_physique INTEGER,
          req_cunning INTEGER, req_spirit INTEGER, expansion VARCHAR,
          is_empowered BOOLEAN, attacks_per_sec DOUBLE, set_record VARCHAR,
          granted_skill VARCHAR, has_blueprint BOOLEAN)""")

    inserts = []
    for row in rows:
        domain, gear_type = row["domain"], row["gear_type"]
        if domain == "affix":
            name_tag = row["lootRandomizerName"]
            text_tag = None
        elif domain in DESCRIPTION_NAMED:
            name_tag = row["description"]
            text_tag = row["itemText"]
        else:
            name_tag = row["itemNameTag"]
            text_tag = row["description"]
        if not name_tag:
            diag["unnamed"] += 1

        reqs = compute_requirements(row, formulas, att_counts, diag)
        if domain == "affix" and not reqs["req_level"]:
            lvl = fnum(row["levelRequirement"])
            reqs["req_level"] = int(lvl) if lvl and lvl > 0 else 0

        expansion = expansion_of_source(name_sources.get(name_tag or ""))
        if expansion is None:
            diag["expansion_defaulted"] += 1
            expansion = "base"

        aps = None
        if gear_type in APS_TYPES:
            tag = row["characterBaseAttackSpeedTag"]
            base = tier_base.get(tag or "")
            if base is not None:
                aps = round(base + (fnum(row["characterBaseAttackSpeed"]) or 0.0), 2)
            else:
                diag["aps_missing_tier"] += 1

        item_level = fnum(row["itemLevel"])
        inserts.append((
            row["record"], domain, gear_type, row["slots"],
            name_tag or row["record"], name_tag, text_tag, row["itemClassification"],
            int(item_level) if item_level else None,
            reqs["req_level"], reqs["req_physique"], reqs["req_cunning"], reqs["req_spirit"],
            expansion, row["record"].startswith("records/items/upgraded/"), aps,
            row["itemSetName"] or None, row["itemSkillName"] or None, False))
    con.executemany(
        "INSERT INTO entities VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", inserts)

    # has_blueprint: some blueprint's crafts edge targets this record (KTD8).
    con.execute("""
        UPDATE entities SET has_blueprint = TRUE
        WHERE record IN (SELECT dst FROM relations WHERE kind = 'crafts')""")

    out = out_dir / "entities.parquet"
    con.execute(f"COPY (SELECT * FROM entities ORDER BY record) TO {sql_str(out.as_posix())} "
                f"(FORMAT parquet, COMPRESSION zstd)")
    return len(inserts)


# ---------------------------------------------------------------------------
# relations
# ---------------------------------------------------------------------------

# Applies-to slot flags on augment/component records -> the gear-type vocabulary
# of gear-types.json (1h melee flags lack the "1h" suffix; everything else matches).
FLAG_TYPE = {
    "sword": "sword1h", "axe": "axe1h", "mace": "mace1h",
    "dagger": "dagger", "scepter": "scepter", "sword2h": "sword2h", "axe2h": "axe2h",
    "mace2h": "mace2h", "spear2h": "spear2h", "ranged1h": "ranged1h", "ranged2h": "ranged2h",
    "shield": "shield", "offhand": "offhand", "head": "head", "chest": "chest",
    "shoulders": "shoulders", "hands": "hands", "legs": "legs", "feet": "feet",
    "waist": "waist", "amulet": "amulet", "ring": "ring", "medal": "medal",
}


def build_relations(con: duckdb.DuckDBPyConnection, diag: dict) -> int:
    con.execute("CREATE TEMP TABLE flag_map (flag VARCHAR, gear_type VARCHAR)")
    con.executemany("INSERT INTO flag_map VALUES (?, ?)", list(FLAG_TYPE.items()))

    con.execute("""
        CREATE TEMP TABLE relations (src VARCHAR, kind VARCHAR, dst VARCHAR)""")
    # applies_to: slot flags with value 1 on augments/components (R12).
    con.execute("""
        INSERT INTO relations
        SELECT s.record, 'applies_to', m.gear_type
        FROM scoped s
        JOIN facts f USING (record)
        JOIN flag_map m ON m.flag = f.key
        WHERE s.domain IN ('augment', 'component') AND f.value_num = 1""")
    # crafts: forcedRandomArtifactName always; else artifactName when it resolves
    # to an in-scope entity record (KTD8). dst is the entity's canonical path.
    con.execute("""
        INSERT INTO relations
        SELECT s.record, 'crafts', COALESCE(e.record, lower(trim(f.value)))
        FROM scoped s
        JOIN facts f USING (record)
        LEFT JOIN scoped e ON lower(e.record) = lower(trim(f.value))
        WHERE s.domain = 'blueprint' AND f.key = 'forcedRandomArtifactName' AND f.value != ''""")
    con.execute("""
        INSERT INTO relations
        SELECT s.record, 'crafts', e.record
        FROM scoped s
        JOIN facts f USING (record)
        JOIN scoped e ON lower(e.record) = lower(trim(f.value))
        WHERE s.domain = 'blueprint' AND f.key = 'artifactName' AND f.value != ''
          AND NOT EXISTS (SELECT 1 FROM relations r WHERE r.src = s.record AND r.kind = 'crafts')""")
    # reagent edges always resolve where possible but are kept even when dangling.
    con.execute("""
        INSERT INTO relations
        SELECT s.record, 'reagent', COALESCE(e.record, lower(trim(f.value)))
        FROM scoped s
        JOIN facts f USING (record)
        LEFT JOIN scoped e ON lower(e.record) = lower(trim(f.value))
        WHERE s.domain = 'blueprint' AND f.value != ''
          AND f.key IN ('reagent1BaseName', 'reagent2BaseName', 'reagent3BaseName')""")
    con.execute("""
        INSERT INTO relations
        SELECT record, 'set_member', trim("itemSetName") FROM scoped
        WHERE COALESCE("itemSetName", '') != ''""")
    con.execute("""
        INSERT INTO relations
        SELECT record, 'grants_skill', trim("itemSkillName") FROM scoped
        WHERE COALESCE("itemSkillName", '') != ''""")
    # Pet chains ride as relations only in this phase (KTD5): a granted summon
    # skill's spawnObjects (;-packed) names the pet creature record(s).
    con.execute("""
        INSERT INTO relations
        SELECT DISTINCT s.record, 'spawns_pet', trim(pet)
        FROM scoped s
        JOIN facts f ON f.record = s."itemSkillName" AND f.key = 'spawnObjects'
        CROSS JOIN unnest(string_split(f.value, ';')) AS t(pet)
        WHERE trim(pet) != ''""")

    diag["blueprints_without_crafts"] = con.execute("""
        SELECT count(*) FROM scoped s WHERE s.domain = 'blueprint'
          AND NOT EXISTS (SELECT 1 FROM relations r WHERE r.src = s.record AND r.kind = 'crafts')""").fetchone()[0]
    return con.execute("SELECT count(*) FROM relations").fetchone()[0]


# ---------------------------------------------------------------------------
# sources
# ---------------------------------------------------------------------------

def build_sources(con: duckdb.DuckDBPyConnection, cur: dict, out_dir: Path) -> int:
    """Item acquisition sources (tier 1): faction vendor rows from the merchant
    chain plus crafted rows materialized from the crafts edges (plan KTD1/KTD2/KTD4).
    Crafted rows reuse the vendor columns for the blueprint and leave faction/tier empty."""
    con.execute("CREATE TEMP TABLE faction_map (fac VARCHAR, faction_tag VARCHAR)")
    con.executemany("INSERT INTO faction_map VALUES (?, ?)",
                    list(cur["factions"]["faction_tags"].items()))

    # The merchant chain is followed from every marketFileName in the deposit
    # (not path-scoped): today only faction vendors reference tier tables whose
    # marketStaticItems carry faction-sourced items, and the acceptance pins
    # (284 at build 19149150) make any future widening a loud, reviewed event.
    con.execute("""
        CREATE TEMP TABLE sources (
          item VARCHAR, kind VARCHAR, vendor_record VARCHAR, vendor_tag VARCHAR,
          faction_tag VARCHAR, tier VARCHAR, provenance VARCHAR)""")
    con.execute("""
        INSERT INTO sources
        SELECT DISTINCT fs.record, 'faction_vendor', m.record, trim(d.value),
               fm.faction_tag, replace(t.key, 'NormalTable', ''), 'flat-fact'
        FROM facts m
        JOIN facts t ON t.record = lower(trim(m.value))
                    AND t.key IN ('friendlyNormalTable', 'respectedNormalTable',
                                  'honoredNormalTable', 'reveredNormalTable')
        JOIN facts si ON si.record = lower(trim(t.value)) AND si.key = 'marketStaticItems'
        CROSS JOIN unnest(string_split(si.value, ';')) AS u(item)
        JOIN facts fs ON fs.record = lower(trim(u.item)) AND fs.key = 'factionSource'
        JOIN faction_map fm ON fm.fac = fs.value
        LEFT JOIN facts d ON d.record = m.record AND d.key = 'description'
        WHERE m.key = 'marketFileName'""")

    # Guard 2 (factions.json): augments with no vendor row must be exactly the
    # pinned unsold_augments list - dev template blanks, sold by no vendor.
    expected = set(cur["factions"]["unsold_augments"])
    actual = {r[0] for r in con.execute("""
        SELECT DISTINCT record FROM facts f WHERE f.key = 'factionSource'
          AND NOT EXISTS (SELECT 1 FROM sources s
                          WHERE s.item = f.record AND s.kind = 'faction_vendor')""").fetchall()}
    if actual != expected:
        for r in sorted(actual - expected):
            print(f"CURATION DRIFT: faction augment with no vendor row, not in "
                  f"factions.json unsold_augments: {r}", file=sys.stderr)
        for r in sorted(expected - actual):
            print(f"CURATION DRIFT: factions.json unsold_augments entry now HAS a "
                  f"vendor row (or left the deposit): {r}", file=sys.stderr)
        print("Update data/item-curation/factions.json (deliberately) and re-run "
              "`just derive`.", file=sys.stderr)
        raise SystemExit(1)

    con.execute("""
        INSERT INTO sources
        SELECT DISTINCT r.dst, 'crafted', r.src, e.name_tag, NULL, NULL, 'flat-fact'
        FROM relations r
        LEFT JOIN entities e ON e.record = r.src
        WHERE r.kind = 'crafts'""")

    out = out_dir / "sources.parquet"
    con.execute(f"COPY (SELECT * FROM sources ORDER BY item, kind, vendor_record) "
                f"TO {sql_str(out.as_posix())} (FORMAT parquet, COMPRESSION zstd)")
    return con.execute("SELECT count(*) FROM sources").fetchone()[0]


# ---------------------------------------------------------------------------
# stats
# ---------------------------------------------------------------------------

def parse_leveled(value: str, level: int) -> float | None:
    """A skill stat at the granted level: ;-packed arrays index at level-1, clamped."""
    parts = value.split(";") if value else []
    if not parts:
        return None
    idx = min(max(level, 1) - 1, len(parts) - 1)
    try:
        return float(parts[idx])
    except ValueError:
        return None


def unify_pairs(kv: dict[str, float]) -> dict[str, tuple[float, float]]:
    """Collapse <id>Min/<id>Max sibling keys into one (value_min, value_max) entry."""
    out: dict[str, tuple[float, float]] = {}
    for key, v in kv.items():
        if key.endswith("Min") or key.endswith("Max"):
            base = key[:-3]
            lo, hi = out.get(base, (0.0, 0.0))
            if key.endswith("Min"):
                lo = v
            else:
                hi = v
            out[base] = (lo, hi)
        else:
            out[key] = (v, v)
    return {k: (lo if lo else hi, max(lo, hi)) for k, (lo, hi) in out.items()
            if lo or hi}


def build_stats(con: duckdb.DuckDBPyConnection, cur: dict, out_dir: Path,
                diag: dict) -> int:
    var = cur["variance"]
    jitter = float(var["jitter_percent"])
    exempt_ids = set(var["exempt_ids"]) | set(STAT_EXTRA_IDS) - {""}
    exempt_pat = "|".join(f"({p})" for p in var["exempt_id_patterns"])
    weapon_dmg = set(var["weapon_damage_ids"])

    # --- self stats: SQL over the scoped entities ---------------------------
    exempt_ids_sql = ", ".join(sql_str(i) for i in sorted(exempt_ids))
    weapon_dmg_sql = ", ".join(sql_str(i) for i in sorted(weapon_dmg))
    aps_types_sql = ", ".join(sql_str(t) for t in sorted(APS_TYPES | {"shield", "offhand"}))
    exempt_domains_sql = ", ".join(sql_str(d) for d in var["exempt_domains"])
    con.execute(f"""
        CREATE TEMP TABLE self_stats AS
        WITH raw AS (
          SELECT s.record, s.domain, s.gear_type,
                 TRY_CAST(s."lootRandomizerJitter" AS DOUBLE) AS affix_jitter,
                 f.key, f.value_num
          FROM scoped s JOIN facts f USING (record)
          WHERE f.value_num IS NOT NULL AND f.value_num != 0
            AND ((regexp_matches(f.key, '{STAT_KEY_RE}')
                  AND NOT regexp_matches(f.key, '{STAT_STRUCTURAL_RE}'))
                 OR f.key IN ({", ".join(sql_str(i) for i in STAT_EXTRA_IDS)}))
            AND f.key NOT IN ({", ".join(sql_str(i) for i in sorted(STAT_ID_BLOCKLIST))})
        ),
        unified AS (
          SELECT record, domain, gear_type, affix_jitter,
                 regexp_replace(key, '(Min|Max)$', '') AS stat_id,
                 max(CASE WHEN key LIKE '%Min' THEN value_num END) AS minv,
                 max(CASE WHEN key LIKE '%Max' THEN value_num END) AS maxv,
                 max(CASE WHEN key NOT LIKE '%Min' AND key NOT LIKE '%Max'
                          THEN value_num END) AS plainv
          FROM raw GROUP BY 1, 2, 3, 4, 5
        ),
        valued AS (
          SELECT record, domain, gear_type, affix_jitter, stat_id,
                 COALESCE(minv, plainv, maxv) AS value_min,
                 GREATEST(COALESCE(minv, plainv, maxv), COALESCE(maxv, 0)) AS value_max,
                 (minv IS NOT NULL AND maxv IS NOT NULL AND maxv != minv) AS is_pair,
                 CASE WHEN domain = 'affix' THEN COALESCE(affix_jitter, 0) ELSE {jitter} END AS jit
          FROM unified
        )
        SELECT record, 'self' AS source, stat_id, value_min, value_max,
               CASE WHEN is_pair OR jit = 0
                         OR domain IN ({exempt_domains_sql})
                         OR stat_id IN ({exempt_ids_sql})
                         OR regexp_matches(stat_id, {sql_str(exempt_pat)})
                         OR (stat_id IN ({weapon_dmg_sql})
                             AND gear_type IN ({aps_types_sql}))
                    THEN NULL
                    ELSE ceil(value_min * (1 - jit / 100)) END AS display_low,
               CASE WHEN is_pair OR jit = 0
                         OR domain IN ({exempt_domains_sql})
                         OR stat_id IN ({exempt_ids_sql})
                         OR regexp_matches(stat_id, {sql_str(exempt_pat)})
                         OR (stat_id IN ({weapon_dmg_sql})
                             AND gear_type IN ({aps_types_sql}))
                    THEN NULL
                    ELSE floor(value_max * (1 + jit / 100)) END AS display_high
        FROM valued""")

    # --- granted-skill rollup: python over the skill closure (KTD5) ---------
    stat_re = re.compile(STAT_KEY_RE)
    structural_re = re.compile(STAT_STRUCTURAL_RE)

    items = [dict(zip(("record", "skill", "eq", "lvl_lit", "item_level", "controller", "pet"), r))
             for r in con.execute("""
        SELECT record, "itemSkillName", "itemSkillLevelEq", "itemSkillLevel",
               TRY_CAST("itemLevel" AS DOUBLE), "itemSkillAutoController", "petBonusName"
        FROM scoped
        WHERE COALESCE("itemSkillName", '') != '' OR COALESCE("petBonusName", '') != ''""").fetchall()]

    # One fetch for every referenced skill/buff/controller/pet-bonus record.
    refs = {v for it in items for v in (it["skill"], it["controller"], it["pet"]) if v}
    con.execute("CREATE TEMP TABLE ref_list (record VARCHAR)")
    con.executemany("INSERT INTO ref_list VALUES (?)", [(r,) for r in sorted(refs)])
    ref_facts: dict[str, dict[str, str]] = {}
    for rec, key, value in con.execute(
            "SELECT f.record, f.key, f.value FROM facts f JOIN ref_list r USING (record)").fetchall():
        ref_facts.setdefault(rec, {})[key] = value
    # buffSkillName is a second hop discovered from the first fetch.
    buffs = {kv["buffSkillName"] for kv in ref_facts.values()
             if kv.get("buffSkillName")} - set(ref_facts)
    if buffs:
        con.execute("DELETE FROM ref_list")
        con.executemany("INSERT INTO ref_list VALUES (?)", [(r,) for r in sorted(buffs)])
        for rec, key, value in con.execute(
                "SELECT f.record, f.key, f.value FROM facts f JOIN ref_list r USING (record)").fetchall():
            ref_facts.setdefault(rec, {})[key] = value

    skill_rows: list[tuple] = []

    def emit_skill_stats(item: str, rec: str, source: str, level: int) -> None:
        kv = ref_facts.get(rec)
        if kv is None:
            diag["skill_ref_missing"] += 1
            return
        leveled: dict[str, float] = {}
        for key, value in kv.items():
            ok = (stat_re.match(key) and not structural_re.search(key)) or key in SKILL_CARD_IDS
            if not ok or key in STAT_ID_BLOCKLIST:
                continue
            v = parse_leveled(value, level)
            if v:
                leveled[key] = v
        for stat_id, (lo, hi) in unify_pairs(leveled).items():
            skill_rows.append((item, source, stat_id, lo, hi, None, None))

    for it in items:
        if it["skill"]:
            level = 1
            if it["eq"]:
                try:
                    level = max(1, math.floor(eval_equation(
                        it["eq"], {"itemlevel": it["item_level"] or 0.0})))
                except ValueError:
                    diag["equation_errors"] += 1
            elif it["lvl_lit"]:
                level = max(1, int(fnum(it["lvl_lit"]) or 1))
            emit_skill_stats(it["record"], it["skill"], "skill", level)
            buff = ref_facts.get(it["skill"], {}).get("buffSkillName")
            if buff:
                emit_skill_stats(it["record"], buff, "skill_buff", level)
            chance = fnum(ref_facts.get(it["controller"] or "", {}).get("chanceToRun"))
            if chance:
                skill_rows.append((it["record"], "skill", "skillProcChance",
                                   chance, chance, None, None))
        if it["pet"]:
            emit_skill_stats(it["record"], it["pet"], "pet_bonus", 1)

    con.execute("""
        CREATE TEMP TABLE skill_stats (
          record VARCHAR, source VARCHAR, stat_id VARCHAR, value_min DOUBLE,
          value_max DOUBLE, display_low DOUBLE, display_high DOUBLE)""")
    con.executemany("INSERT INTO skill_stats VALUES (?,?,?,?,?,?,?)", skill_rows)

    out = out_dir / "stats.parquet"
    con.execute(f"""
        COPY (SELECT * FROM self_stats UNION ALL SELECT * FROM skill_stats
              ORDER BY record, source, stat_id)
        TO {sql_str(out.as_posix())} (FORMAT parquet, COMPRESSION zstd)""")
    return con.execute("SELECT count(*) FROM (SELECT * FROM self_stats UNION ALL SELECT * FROM skill_stats)").fetchone()[0]


# ---------------------------------------------------------------------------

def cmd_build(args) -> int:
    deposit_dir = args.deposit_dir.resolve()
    out_dir = args.out_dir.resolve()
    con = open_deposit(deposit_dir)
    meta = read_meta(con)
    warn_buildid_mismatch(meta)
    if meta.get("schema_version", "1") < "2":
        print("ERROR: deposit labels lack tag sources (schema v1). Run `just deposit` first.",
              file=sys.stderr)
        return 2

    cur = load_curation(args.curation_dir.resolve())
    run_guards(con, cur)
    out_dir.mkdir(parents=True, exist_ok=True)

    diag = {"unnamed": 0, "expansion_defaulted": 0, "aps_missing_tier": 0,
            "cost_default_used": 0, "cost_record_missing": 0, "equation_errors": 0,
            "skill_ref_missing": 0}
    build_wide(con, cur)
    n_relations = build_relations(con, diag)
    n_entities = build_entities(con, cur, out_dir, diag)
    n_stats = build_stats(con, cur, out_dir, diag)
    n_sources = build_sources(con, cur, out_dir)

    rel_out = out_dir / "relations.parquet"
    con.execute(f"COPY (SELECT * FROM relations ORDER BY src, kind, dst) "
                f"TO {sql_str(rel_out.as_posix())} (FORMAT parquet, COMPRESSION zstd)")

    # The filter taxonomy rides along as a table so acceptance SQL and the SPA
    # join it instead of parsing JSON. Ids are unified to the stats table's
    # vocabulary (Min/Max suffixes stripped); the JSON keeps raw ids so the drift
    # guard can check them against the deposit's key census. Id-less families
    # like `pet` are source-predicates documented in docs/item-schema.md.
    fam_rows = sorted({(fam, re.sub(r"(Min|Max)$", "", sid))
                       for fam, spec in cur["stat-families"]["families"].items()
                       for sid in spec.get("ids", [])})
    con.execute("CREATE TEMP TABLE families (family VARCHAR, stat_id VARCHAR)")
    con.executemany("INSERT INTO families VALUES (?, ?)", fam_rows)
    fam_out = out_dir / "families.parquet"
    con.execute(f"COPY (SELECT * FROM families ORDER BY family, stat_id) "
                f"TO {sql_str(fam_out.as_posix())} (FORMAT parquet, COMPRESSION zstd)")

    counts = con.execute(
        "SELECT domain, count(*) FROM entities GROUP BY 1 ORDER BY 1").fetchall()
    src_counts = con.execute(
        "SELECT source, count(*) FROM (SELECT * FROM self_stats UNION ALL "
        "SELECT * FROM skill_stats) GROUP BY 1 ORDER BY 1").fetchall()
    kind_counts = con.execute(
        "SELECT kind, count(*) FROM relations GROUP BY 1 ORDER BY 1").fetchall()

    print("\n=== DERIVED SUMMARY ===")
    print(f"  entities: {n_entities}   " +
          "  ".join(f"{d}({n})" for d, n in counts))
    print(f"  stats rows: {n_stats}   " +
          "  ".join(f"{s}({n})" for s, n in src_counts))
    print(f"  relations: {n_relations}   " +
          "  ".join(f"{k}({n})" for k, n in kind_counts))
    src_kind_counts = con.execute(
        "SELECT kind, count(*) FROM sources GROUP BY 1 ORDER BY 1").fetchall()
    print(f"  sources: {n_sources}   " +
          "  ".join(f"{k}({n})" for k, n in src_kind_counts))
    print(f"  diagnostics: " + "  ".join(f"{k}={v}" for k, v in diag.items()
                                         if not k.endswith("_sample")))
    if diag.get("equation_error_sample"):
        print(f"  first equation error: {diag['equation_error_sample']}")
    for name in ("entities", "stats", "relations", "families", "sources"):
        p = out_dir / f"{name}.parquet"
        print(f"  {p.name}: {file_size_str(p)}")
    print(f"  deposit build: {meta.get('steam_buildid') or '(none)'}")
    con.close()
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Derived item schema: build entities/stats/relations")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="build the derived parquet from the deposit + curation")
    b.add_argument("--deposit-dir", required=True, type=Path)
    b.add_argument("--curation-dir", required=True, type=Path)
    b.add_argument("--out-dir", required=True, type=Path)
    b.set_defaults(fn=cmd_build)
    args = ap.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
