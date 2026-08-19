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

# Every parquet this script writes, in build order. The release manifest ships exactly
# this list (dataset_release.ASSETS), so a table added here reaches every machine that
# runs `just fetch-deposit` rather than only the one that ran `just derive`.
OUTPUT_TABLES = ("entities", "stats", "relations", "families", "sources", "boosts",
                 "conversions", "skills", "skill_effect", "skill_ranks", "pet_ranks",
                 "skill_modifiers", "sets", "set_modifiers", "set_boosts")

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
# boosts
# ---------------------------------------------------------------------------

def build_boosts(con: duckdb.DuckDBPyConnection, out_dir: Path) -> int:
    """Per-skill and per-mastery level bonuses, each resolved to its mastery record.

    An item boosts either one named skill (augmentSkillName<N>) or a whole mastery
    (augmentMasteryName<N>); the trailing number pairs a name key with its level key.
    The playerclassNN segment of the target path is what ties a skill to its mastery,
    whose own record is always _classtraining_class<NN> in the same directory.
    """
    con.execute("CREATE TEMP TABLE boosts (record VARCHAR, kind VARCHAR, target VARCHAR, "
                "mastery_record VARCHAR, level INTEGER)")
    for kind, name_key, level_key in (("skill", "augmentSkillName", "augmentSkillLevel"),
                                      ("mastery", "augmentMasteryName", "augmentMasteryLevel")):
        con.execute(f"""
            INSERT INTO boosts
            WITH paired AS (
                SELECT s.record AS rec,
                       lower(trim(n.value)) AS target,
                       CAST(lv.value_num AS INTEGER) AS lvl
                FROM scoped s
                JOIN facts n ON n.record = s.record
                            AND n.key LIKE '{name_key}%' AND trim(n.value) != ''
                JOIN facts lv ON lv.record = s.record
                             AND lv.key = '{level_key}'
                                          || regexp_extract(n.key, '{name_key}(\\d+)', 1)
                             AND lv.value_num > 0
            ),
            classed AS (
                SELECT rec, target, lvl,
                       regexp_extract(target, 'playerclass(\\d+)', 1) AS cls
                FROM paired
            )
            SELECT rec, '{kind}', target,
                   'records/skills/playerclass' || cls
                   || '/_classtraining_class' || cls || '.dbr',
                   lvl
            FROM classed
            WHERE cls != ''""")
    out = out_dir / "boosts.parquet"
    con.execute(f"COPY (SELECT * FROM boosts ORDER BY record, kind, target) "
                f"TO {sql_str(out.as_posix())} (FORMAT parquet, COMPRESSION zstd)")
    return con.execute("SELECT count(*) FROM boosts").fetchone()[0]


# ---------------------------------------------------------------------------
# skill effect resolution
# ---------------------------------------------------------------------------

def build_skill_effect_map(con: duckdb.DuckDBPyConnection, out_dir: Path) -> int:
    """Map every skill-ish record to the record that actually carries its stats.

    Skill records are frequently thin shells: a tree node may hold nothing but a
    buffSkillName pointing at the record with the display name, icon, caps and
    per-rank arrays. The walk must be iterative rather than an ordered
    direct/buff/pet rule, because chains mix the two link types: six pet-modifier
    nodes go petSkillName and then buffSkillName. Depth is capped and visited
    records are tracked so a malformed cycle cannot hang the build.
    """
    con.execute("""
        CREATE TEMP TABLE skill_effect AS
        WITH RECURSIVE roots AS (
            SELECT DISTINCT record AS skill_record FROM facts
            WHERE record LIKE 'records/skills/%'
        ),
        walk(root, cur, depth) AS (
            SELECT skill_record, skill_record, 0 FROM roots
            UNION ALL
            SELECT w.root, f.value, w.depth + 1
            FROM walk w
            JOIN facts f ON f.record = w.cur
                        AND f.key IN ('buffSkillName', 'petSkillName')
                        AND f.value LIKE 'records/skills/%'
            WHERE w.depth < 8
              AND NOT EXISTS (SELECT 1 FROM facts d
                              WHERE d.record = w.cur AND d.key = 'skillDisplayName')
        ),
        named AS (
            SELECT w.root, w.cur, w.depth,
                   row_number() OVER (PARTITION BY w.root ORDER BY w.depth) AS rn
            FROM walk w
            WHERE EXISTS (SELECT 1 FROM facts d
                          WHERE d.record = w.cur AND d.key = 'skillDisplayName')
        )
        SELECT root AS skill_record, cur AS effect_record, depth AS hops
        FROM named WHERE rn = 1""")
    out = out_dir / "skill_effect.parquet"
    con.execute(f"COPY (SELECT * FROM skill_effect ORDER BY skill_record) "
                f"TO {sql_str(out.as_posix())} (FORMAT parquet, COMPRESSION zstd)")
    return con.execute("SELECT count(*) FROM skill_effect").fetchone()[0]


# ---------------------------------------------------------------------------
# skills roster
# ---------------------------------------------------------------------------

def build_skills(con: duckdb.DuckDBPyConnection, out_dir: Path, diag: dict) -> int:
    """The mastery skill roster, with tree position joined on where one exists.

    Roster comes from _classtree_classNN.dbr, which is authoritative: every entry
    resolves to a record that exists. The records/ui/skills/classNN/skill*.dbr
    buttons supply bitmapPosition and isCircular, but carry three references to
    records with no facts at all, so they are joined and never trusted as the
    roster. Four playerclass10 transform abilities have no button; their ui_x and
    ui_y stay NULL rather than being invented.
    """
    con.execute("""
        CREATE TEMP TABLE skills AS
        WITH roster AS (
            SELECT DISTINCT
                   value AS record,
                   'records/skills/playerclass'
                     || regexp_extract(record, '_classtree_class(\\d+)', 1)
                     || '/_classtraining_class'
                     || regexp_extract(record, '_classtree_class(\\d+)', 1) || '.dbr'
                     AS mastery_record
            FROM facts
            WHERE regexp_matches(record, '_classtree_class(0[1-9]|10)\\.dbr$')
              AND key LIKE 'skillName%'
              AND value NOT LIKE '%_classtraining_%'
        ),
        button AS (
            SELECT max(CASE WHEN key = 'skillName' THEN value END) AS record,
                   max(CASE WHEN key = 'bitmapPositionX' THEN value END)::INTEGER AS ui_x,
                   max(CASE WHEN key = 'bitmapPositionY' THEN value END)::INTEGER AS ui_y
            FROM facts
            WHERE regexp_matches(record, 'records/ui/skills/class(0[1-9]|10)/skill')
            GROUP BY record
        ),
        joined AS (
            SELECT r.record, r.mastery_record, b.ui_x, b.ui_y,
                   e.effect_record,
                   (SELECT f.value FROM facts f
                     WHERE f.record = r.record AND f.key = 'Class') AS cls
            FROM roster r
            LEFT JOIN button b ON b.record = r.record
            LEFT JOIN skill_effect e ON e.skill_record = r.record
        ),
        tagged AS (
            SELECT j.*,
                   (SELECT f.value FROM facts f
                     WHERE f.record = j.effect_record AND f.key = 'skillDisplayName') AS tag
            FROM joined j
        ),
        grouped AS (
            SELECT t.*,
                   -- The game encodes the group in the display-name tag itself:
                   -- tagClass<NN>SkillName<GG><L>, where GG numbers the group and
                   -- the trailing letter identifies the member. Dreeg's Evil Eye
                   -- is 11A with its modifiers at 11B..11E. Every one of the 142
                   -- groups has exactly one A member. Neither the record stem nor
                   -- the UI geometry works; see the spec for why both were rejected.
                   CASE WHEN regexp_matches(t.tag, 'SkillName[0-9]+[A-Z]?$')
                        THEN regexp_extract(t.tag, '^(.*SkillName[0-9]+)[A-Z]?$', 1)
                        ELSE t.record END AS group_tag,
                   regexp_extract(t.tag, '^.*SkillName[0-9]+([A-Z])?$', 1) AS group_letter
            FROM tagged t
        ),
        kinded AS (
            -- What a node IS comes from its record's own Class, not from its display-name tag.
            -- The tag says which nodes Crate numbered together, which is a good grouping signal
            -- and a bad classification one: it files Zolhan's Technique under Markovian's
            -- Advantage (06A/06B) and Star Pact under Reckless Power (15A/15B), though each
            -- pair is two independent skills the game's own tree draws no connector between
            -- (checked against grimtools, which renders the game's connector sprites). Class
            -- separates them cleanly: the modifier family is Skill_Modifier,
            -- Skill_ProjectileModifier and the SkillSecondary_* variants, and every one of
            -- those appears ONLY as a non-'A' member, while Skill_WPAttack_BasicAttack,
            -- Skill_Passive and Skill_BuffSelfToggled all appear as bases far more often than
            -- not (8/5, 14/2 and 16/1 at build 24756825). Naming a transmuter by an exact
            -- Class also missed Skill_ProjectileTransmuter and Skill_SpawnPetTransmuter, whose
            -- four nodes carry the tree's own 'b' record suffix.
            SELECT g.*,
                   CASE
                       -- A node with nothing to modify is not a modifier: the sole member of
                       -- its tag group is its own base whatever its Class says (one node,
                       -- playerclass10/passive04.dbr, a Skill_Modifier alone in its group).
                       WHEN (SELECT count(*) FROM grouped o WHERE o.group_tag = g.group_tag) = 1
                            THEN 'base'
                       WHEN g.cls LIKE '%Transmuter' THEN 'transmuter'
                       WHEN g.cls = 'SkillSecondary_PetModifier' THEN 'pet_modifier'
                       WHEN g.cls IN ('Skill_Modifier', 'Skill_ProjectileModifier')
                            OR g.cls LIKE 'SkillSecondary=_%' ESCAPE '=' THEN 'modifier'
                       ELSE 'base'
                   END AS node_kind
            FROM grouped g
        )
        SELECT
            j.record,
            j.mastery_record,
            -- A base is its own group. Everything else belongs to the group its display-name
            -- tag names, whose base is that group's 'A' member; a skill whose tag does not
            -- match the pattern (the four playerclass10 transform abilities) is its own base.
            -- The 'A' test still does the picking rather than node_kind alone, because a tag
            -- group can now hold more than one base: Reckless Power and Star Pact share
            -- tagClass05SkillName15 and are both independent skills.
            CASE WHEN j.node_kind = 'base' THEN j.record ELSE
                coalesce(
                    (SELECT b.record FROM kinded b
                      WHERE b.group_tag = j.group_tag AND b.group_letter IN ('A', '')
                        AND b.node_kind = 'base'),
                    j.record)
            END AS group_record,
            j.node_kind,
            j.ui_x, j.ui_y,
            j.tag AS name_tag,
            -- The skill's own prose, the paragraph the game's tooltip opens with. Present on
            -- all 315 skills, and the only thing a node with no renderable stat line has to
            -- say for itself (Manifestation's whole card was empty without it).
            (SELECT f.value FROM facts f
              WHERE f.record = j.effect_record AND f.key = 'skillBaseDescription')
                AS description_tag,
            -- Stored verbatim: the sprite index in data/skill-icons.json is keyed
            -- by the same `ui/skills/icons/...` path, so this joins with no
            -- string surgery on either side.
            (SELECT f.value FROM facts f
              WHERE f.record = j.effect_record AND f.key = 'skillUpBitmapName') AS icon,
            (SELECT f.value FROM facts f
              WHERE f.record = j.effect_record AND f.key = 'skillMaxLevel')::INTEGER
                AS max_level,
            (SELECT f.value FROM facts f
              WHERE f.record = j.effect_record AND f.key = 'skillUltimateLevel')::INTEGER
                AS ultimate_level,
            j.effect_record
        FROM kinded j""")
    diag["skills_without_button"] = con.execute(
        "SELECT count(*) FROM skills WHERE ui_x IS NULL").fetchone()[0]
    diag["skills_without_name"] = con.execute(
        "SELECT count(*) FROM skills WHERE name_tag IS NULL").fetchone()[0]
    out = out_dir / "skills.parquet"
    con.execute(f"COPY (SELECT * FROM skills ORDER BY mastery_record, record) "
                f"TO {sql_str(out.as_posix())} (FORMAT parquet, COMPRESSION zstd)")
    return con.execute("SELECT count(*) FROM skills").fetchone()[0]


# ---------------------------------------------------------------------------
# conversions
# ---------------------------------------------------------------------------

def build_conversions(con: duckdb.DuckDBPyConnection, out_dir: Path) -> int:
    """Damage conversion as from/to/percent triples.

    A record can carry several conversions, numbered by a trailing digit on the key
    (the unnumbered key is index 1), so these are joined from facts rather than pivoted
    wide, which would collapse them to one per record.
    """
    con.execute("CREATE TEMP TABLE conversions (record VARCHAR, from_type VARCHAR, "
                "to_type VARCHAR, percent DOUBLE)")
    con.execute("""
        WITH idx AS (
            SELECT record, key, value, value_num,
                   COALESCE(NULLIF(regexp_extract(key, '(\\d+)$', 1), ''), '1') AS n,
                   regexp_replace(key, '\\d+$', '') AS base
            FROM facts
            WHERE regexp_replace(key, '\\d+$', '') IN
                  ('conversionInType', 'conversionOutType', 'conversionPercentage')
        )
        INSERT INTO conversions
        SELECT s.record, trim(i.value), trim(o.value), p.value_num
        FROM scoped s
        JOIN idx i ON i.record = s.record AND i.base = 'conversionInType'  AND trim(i.value) != ''
        JOIN idx o ON o.record = s.record AND o.base = 'conversionOutType' AND o.n = i.n
                                          AND trim(o.value) != ''
        JOIN idx p ON p.record = s.record AND p.base = 'conversionPercentage' AND p.n = i.n
                                          AND p.value_num > 0""")
    out = out_dir / "conversions.parquet"
    con.execute(f"COPY (SELECT * FROM conversions ORDER BY record, from_type, to_type) "
                f"TO {sql_str(out.as_posix())} (FORMAT parquet, COMPRESSION zstd)")
    return con.execute("SELECT count(*) FROM conversions").fetchone()[0]


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
    # (328 at build 24346246) make any future widening a loud, reviewed event.
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
# skill rank breakpoints
# ---------------------------------------------------------------------------

# Keys that are per-rank lists of records or effects rather than numbers.
_RANK_ARRAY_EXCLUDE = ("skillConnectionOn", "skillConnectionOff", "spawnObjects",
                       "petChanges", "fxChanges", "projectileOverride",
                       "modSpawnObjects", "radiusEffectName", "skillProjectileName")


def build_rank_keys(con: duckdb.DuckDBPyConnection) -> None:
    """The game's own vocabulary of rank-scaling stat keys, as a temp table.

    A key counts as a rank stat when the game writes it as a per-rank array on
    some skill record somewhere. Admitting any non-zero scalar instead pulls in
    148 keys the game never scales, from skillMaxLevel and skillTier through
    cameraShakeAmplitude, roundBitmap and the Mace2h/Shield weapon-restriction
    flags. Array rows are unaffected: every one of them is in this set by
    definition. Both build_skill_ranks and build_pet_ranks gate on it, so it is
    computed once rather than repeated as a CTE in each.
    """
    con.execute("""
        CREATE TEMP TABLE rank_keys AS
        SELECT DISTINCT key FROM facts
        WHERE record LIKE 'records/skills/%' AND value LIKE '%;%'
          AND NOT regexp_matches(value, '[A-Za-z/]')""")


def build_skill_ranks(con: duckdb.DuckDBPyConnection, out_dir: Path, diag: dict) -> int:
    """Per-stat values at the three breakpoints a player actually decides between.

    A multi-rank stat is a semicolon-separated array, one entry per rank. A skill
    that only ever has one rank stores the same stat as a bare scalar instead, so
    str_split turns both shapes into an array and a scalar is simply a one-element
    rank list whose three breakpoints collapse onto the same value. Requiring the
    semicolon dropped every transmuter and every other rank-1 skill from this
    table entirely. Array length is not reliably skillUltimateLevel (9 are shorter
    and 8 longer at build 24756825), so each breakpoint clamps to the array's own
    length. A mismatch count rides out as a diagnostic so a patch that changes the
    shape is visible instead of silently yielding a wrong number.

    Stats are read off the roster record AND its effect_record, not the effect
    record alone. A shell usually holds nothing but the link, but not always:
    Artifact Handling keeps its own 20-entry cooldownTime array while its
    petSkillName target carries the other two lines of its card, and reading only the
    target lost the skill-recharge line (-0.1 / -1.5 / -2.0) entirely. Two stats over
    two skills sit this way at build 24756825, the other being Spectral Wrath's
    onHitActivationChance, which skill_ranks already carries for six other skills
    whose record and effect_record coincide. Where
    both records name the same stat the effect record wins, since that is the record
    every other column here (name, caps, icon) already comes from; no skill is in
    that position today, and the rule keeps (skill_record, stat_id) a key rather than
    leaving one of two rows to arrive at random.
    """
    excluded = ", ".join(f"'{k}'" for k in _RANK_ARRAY_EXCLUDE)
    con.execute(f"""
        CREATE TEMP TABLE skill_ranks AS
        WITH src AS (
            SELECT record AS skill_record, effect_record AS rec, 0 AS pref,
                   max_level, ultimate_level
            FROM skills
            UNION ALL
            SELECT record, record, 1, max_level, ultimate_level
            FROM skills WHERE record != effect_record
        ),
        arr AS (
            SELECT s.skill_record,
                   f.key AS stat_id,
                   str_split(f.value, ';') AS parts,
                   s.max_level, s.ultimate_level
            FROM src s
            JOIN facts f ON f.record = s.rec
            WHERE f.key NOT IN ({excluded})
              AND f.key IN (SELECT key FROM rank_keys)
              AND NOT regexp_matches(f.value, '[A-Za-z/]')
              -- Every skill record carries the whole template key set with the
              -- unused stats sitting at zero, so a bare scalar only counts as a
              -- rank-1 stat when it is non-zero. An array is authored per skill,
              -- so it is kept exactly as written.
              AND (f.value LIKE '%;%'
                   OR (f.value_num IS NOT NULL AND f.value_num != 0))
            QUALIFY row_number() OVER (PARTITION BY s.skill_record, f.key
                                       ORDER BY s.pref) = 1
        ),
        idx AS (
            -- DuckDB's greatest()/least() ignore NULL arguments, so greatest(NULL, 1)
            -- returns 1, not NULL. A skill with no skillUltimateLevel is a transmuter
            -- (gear cannot push it past its max), so its fully-maxed value IS its max
            -- value; coalesce to max_level rather than silently falling back to 1.
            SELECT skill_record, stat_id, parts,
                   least(greatest(coalesce(max_level, 1), 1), len(parts)) AS i_max,
                   least(greatest(coalesce(ultimate_level, max_level, 1), 1), len(parts)) AS i_ult
            FROM arr
        )
        SELECT skill_record, stat_id,
               TRY_CAST(parts[1] AS DOUBLE) AS at_first,
               TRY_CAST(parts[i_max] AS DOUBLE) AS at_max,
               TRY_CAST(parts[i_ult] AS DOUBLE) AS at_ultimate
        FROM idx
        WHERE TRY_CAST(parts[1] AS DOUBLE) IS NOT NULL""")
    # Over both records the table reads, for the same reason it reads both.
    diag["rank_array_len_mismatch"] = con.execute("""
        WITH src AS (
            SELECT effect_record AS rec, ultimate_level FROM skills
            UNION ALL
            SELECT record, ultimate_level FROM skills WHERE record != effect_record
        )
        SELECT count(*) FROM src s
        JOIN facts f ON f.record = s.rec
        WHERE f.value LIKE '%;%'
          AND NOT regexp_matches(f.value, '[A-Za-z/]')
          AND len(str_split(f.value, ';')) != s.ultimate_level""").fetchone()[0]
    out = out_dir / "skill_ranks.parquet"
    con.execute(f"COPY (SELECT * FROM skill_ranks ORDER BY skill_record, stat_id) "
                f"TO {sql_str(out.as_posix())} (FORMAT parquet, COMPRESSION zstd)")
    return con.execute("SELECT count(*) FROM skill_ranks").fetchone()[0]


# ---------------------------------------------------------------------------
# stat-carrier link walk (shared by pet_ranks and skill_modifiers)
# ---------------------------------------------------------------------------

def stat_carrier_walk(roots: str, stat_gate: str) -> str:
    """The `walk`/`stat_record` CTE pair resolving a shell record to its stats.

    A record named by something else is frequently a thin shell holding nothing
    but a `buffSkillName` or `petSkillName`. A pet's Wind Devil ability is a
    Skill_BuffRadiusToggled with no stats at all - its 242 physical and 382-463
    lightning damage sit one hop away on the SkillBuff_Debuf it points at - and an
    item's pet-modifier record is the same shape over the carrier holding its fire
    damage. Reading stats straight off the named record silently yields nothing.

    Both callers gate on a STAT, not on a display name: the carriers are anonymous.
    All 2,978 records this walk reaches for `skill_modifiers` at build 24756825 carry
    no `skillDisplayName`, and `skill_effect` consequently has no row at all for any
    of their roots - its walk drops a chain outright when nothing in the chain
    reaches a name - so the name-gated resolver cannot be reused here whatever its
    stopping rule. (The five `pet_ranks` shells are the milder case: they are unnamed
    themselves but their targets are named, so `skill_effect` does resolve those
    five.) The rule lives in this one place rather than in each caller, because a
    name-gated or unwalked read has dropped a stat block repeatedly on this schema.

    EVERY stat-bearing record in the chain is emitted, not just the nearest. The
    records in a chain are different application scopes, not competing copies of one
    stat block: a `SkillSecondary_PetModifier` shell carries the change to the
    player's skill (Bloodsworn Codex's -6s Summon Briarthorn recharge) on itself and
    reaches the pet's own block (+25% total damage) through `petSkillName`, and
    Anderos' Amplifier's Mortar Trap card likewise shows both its -2s recharge and
    the 100% physical-to-fire conversion that sits past the hop. Stopping at the
    nearest carrier shipped one and silently dropped the other. Ten of the 259
    reachable pet-modifier roots are that shape (35 rows over 28 blocks); the other
    249 and all 2,709 plain `Skill_Modifier` roots reach exactly one carrier, so
    collecting the union changes nothing for them, no chain in either caller carries
    the same stat key on two records, and no `pet_ranks` chain has a second carrier
    at all.

    `roots` is a three-column SELECT seeding (root, cur, depth). `stat_gate` is a
    predicate over a `facts f` row deciding whether a record carries a stat, and
    stays the caller's own because the two tables read stats differently: pet
    abilities gate on the game's rank-key vocabulary, item modifiers on a non-zero
    first rank. Emits `stat_record(root, cur)`, one row per carrier reached; a
    record reachable by two paths is emitted once. Must be embedded in a
    WITH RECURSIVE.
    """
    return f"""
        walk(root, cur, depth) AS (
            {roots}
            UNION ALL
            SELECT w.root, f.value, w.depth + 1
            FROM walk w
            JOIN facts f ON f.record = w.cur
                        AND f.key IN ('buffSkillName', 'petSkillName')
                        AND f.value LIKE 'records/skills/%'
            WHERE w.depth < 8
        ),
        stat_record AS (
            SELECT DISTINCT root, cur
            FROM walk w
            WHERE EXISTS (SELECT 1 FROM facts f
                          WHERE f.record = w.cur AND ({stat_gate}))
        )"""


# ---------------------------------------------------------------------------
# pet rank breakpoints
# ---------------------------------------------------------------------------

# A pet creature record carries the whole monster template, most of which is
# animation, sound and physics. These two prefixes are the pet's own body: its
# resistances (defensive*) and its speeds, dodge, life floor and light radius
# (character*). No pet creature record in the game carries an offensive* or
# retaliation* key with a non-zero value - a pet's damage lives entirely on the
# abilities it is granted, which this table reads separately.
_PET_STAT_PREFIXES = ("character", "defensive")


def build_pet_ranks(con: duckdb.DuckDBPyConnection, out_dir: Path, diag: dict) -> int:
    """What a summon's pet is and does, at the same three rank breakpoints.

    A summon skill's own record holds almost nothing a player can judge: Summon
    Hellhound carries a mana cost, a cooldown and a pet cap and no damage at all,
    because the pet is a separate creature record. `spawnObjects` on the summon is
    a per-rank array of those creature records, one entry per rank, so the pet
    spawned at rank N is entry N. That makes the pet reachable at exactly the
    breakpoints skill_ranks already uses.

    Two kinds of row come back, distinguished by `source_kind` rather than mixed:

    - `pet`: a stat on the creature record itself (its resistances and speeds).
      Measured at build 24756825 no such stat scales with the summon's rank - the
      only keys that differ between the rank-1 and rank-26 creature records are
      the granted-ability levels, `scale`, `angerMultiplier` and
      `experiencePoints` - so these three columns normally hold one value. They
      are still read per breakpoint rather than once, so a patch that starts
      scaling a pet's resistances shows up instead of being flattened away.
    - `pet_skill`: a stat on an ability the creature is granted. The creature
      record pairs `skillName<N>` with `skillLevel<N>`, and that level IS the
      summon's rank for 45 of the 65 active grants; the other 20 (radius helpers,
      totem immunities, wraith resists) stay pinned at 1 however far the summon is
      pushed. Reading the level off the per-rank creature record gets both right
      without a rule about which is which. At this build every pinned grant
      happens to carry only scalar stats, so assuming the summon's rank would
      produce the same numbers today; reading the level is what keeps that an
      accident rather than a dependency.

    Grant counts here are (summon skill, ability record) pairs, since one ability
    record is shared by several summons and one summon grants several abilities:
    421 pairs at build 24756825, of which 338 sit at level 0, 18 at a `charLevel`
    equation and 65 at a positive number. Both excluded groups are dropped by the
    same `TRY_CAST(level) > 0` filter, for two different reasons, and neither
    should be loosened:

    - level 0 is an inactive modifier slot. The creature record reserves the slot
      so an item or a group modifier can fill it later; nothing grants the ability
      at a summon rank, so it has no value at a rank breakpoint.
    - a `charLevel` equation (pet armor scaling, the global damage adjuster)
      tracks the player's level, not the summon's rank, so it has no meaning at a
      rank breakpoint either and is left out rather than evaluated at an invented
      level. The pet's base life, offensive and defensive ability are the same
      story one level down: they come from the `characterAttributeEquations` bio
      record, which is written purely in `charLevel`.

    The ability named by `skillName<N>` is frequently a shell of its own - Wind
    Devil's whirlwind is a Skill_BuffRadiusToggled carrying a `buffSkillName` and
    nothing else, with all of its damage on the buff record it points at - so the
    stats are read through `stat_carrier_walk`, the same stat-gated walk
    build_skill_modifiers uses, not off the named record. Five of the 65 grants
    hop; the rest resolve at depth 0 and are unaffected. The rank index follows the
    hop unchanged: the level is the one the creature record grants, whichever
    record in the chain ends up carrying the array. `source_record` stays the
    granted ability, not the carrier, because the ability is what the pet has.

    The internal immunity grants (`traps_innate1`, `petskill_totem_immunities`:
    flat 100/500 sentinels for CC and damage-type immunity, 208 of the rows here)
    are deliberately KEPT. No honest predicate separates them from content this
    table must carry: they are unnamed, but so are the raven growth passive and
    the manticore, blightbeast and celestial-guardian damage abilities; they are
    flat with rank, but so is every `source_kind = 'pet'` row; and they are 100/500
    sentinels, but so are 109 of the 204 pet-body defensive rows, including the
    Hellhound `defensiveFire` 500 that AE16 pins as the mark of a fire pet.
    Suppressing them here would make the parquet lie about what a summon grants,
    with nowhere else for the fact to live. Requiring a display name is a
    presentation filter and belongs to the consumer, which already applies exactly
    that rule to the unnamed item records.

    A modifier node that swaps the pet outright (`modSpawnObjects`) is itself a
    one-rank node, but its array is still 26 long because it is indexed by the base
    summon's rank, so those three nodes borrow their group base's caps. All three
    carry `node_kind = 'modifier'`, not `pet_modifier`, despite one of them being
    named `stormtotem01b_petmodifier`: none of the 22 `pet_modifier` nodes reaches
    this table.

    This is deliberately NOT part of skill_ranks. A pet stat needs the carrier in
    its identity, because one summon routinely has two sources naming the same
    stat: Summon Hellhound's innate gives `offensiveFireMin` 6/110/234 and its
    detonate ability gives 58/388/708, two real numbers that a
    `(skill_record, stat_id)` key would collide into one. It is also a different
    subject - what the PET has, not what the PLAYER gets - and folding pet damage
    into the player's rank table would read as the player's own.
    """
    excluded = ", ".join(f"'{k}'" for k in _RANK_ARRAY_EXCLUDE)
    prefixes = " OR ".join(f"f.key LIKE '{p}%'" for p in _PET_STAT_PREFIXES)
    # Same rule as skill_ranks: an array is authored per record and is kept as
    # written, a bare scalar only counts when it is non-zero, because every skill
    # record carries the whole template key set with its unused stats at zero. The
    # walk stops at the first record this admits, so a record it admits is exactly
    # a record that contributes rows below - the two cannot drift apart.
    ability_stats = f"""f.key NOT IN ({excluded})
              AND f.key IN (SELECT key FROM rank_keys)
              AND NOT regexp_matches(f.value, '[A-Za-z/]')
              AND (f.value LIKE '%;%'
                   OR (f.value_num IS NOT NULL AND f.value_num != 0))"""
    con.execute(f"""
        CREATE TEMP TABLE pet_ranks AS
        WITH RECURSIVE summon AS (
            SELECT s.record AS skill_record,
                   coalesce(g.max_level, s.max_level) AS max_level,
                   coalesce(g.ultimate_level, s.ultimate_level) AS ultimate_level,
                   str_split(f.value, ';') AS pets
            FROM skills s
            JOIN facts f ON f.record = s.effect_record
                        AND f.key IN ('spawnObjects', 'modSpawnObjects')
                        AND trim(f.value) != ''
            LEFT JOIN skills g ON f.key = 'modSpawnObjects'
                              AND g.record = s.group_record
        ),
        bp AS (
            -- The rank-1 creature is the pet's stable identity: only its
            -- description tag has a label (tagPetHellhoundA01 resolves, the A26
            -- copy does not), and the later entries are the same pet at a higher
            -- rank rather than a different one. Breakpoints clamp to the array's
            -- own length exactly as skill_ranks does.
            SELECT skill_record, pets[1] AS pet_record, 1 AS bp, pets[1] AS at_pet
            FROM summon
            UNION ALL
            SELECT skill_record, pets[1], 2,
                   pets[least(greatest(coalesce(max_level, 1), 1), len(pets))]
            FROM summon
            UNION ALL
            SELECT skill_record, pets[1], 3,
                   pets[least(greatest(coalesce(ultimate_level, max_level, 1), 1),
                              len(pets))]
            FROM summon
        ),
        body AS (
            SELECT b.skill_record, b.pet_record, 'pet' AS source_kind,
                   b.pet_record AS source_record, b.bp, f.key AS stat_id,
                   f.value_num AS v
            FROM bp b
            JOIN facts f ON f.record = b.at_pet
            WHERE ({prefixes})
              AND f.value_num IS NOT NULL AND f.value_num != 0
        ),
        granted AS (
            SELECT b.skill_record, b.pet_record, b.bp,
                   lower(trim(n.value)) AS ability,
                   TRY_CAST(l.value AS INTEGER) AS lvl
            FROM bp b
            JOIN facts n ON n.record = b.at_pet
                        AND n.key LIKE 'skillName%' AND trim(n.value) != ''
            JOIN facts l ON l.record = b.at_pet
                        AND l.key = 'skillLevel'
                                 || regexp_extract(n.key, 'skillName(\\d+)', 1)
            -- Drops the 338 level-0 slots (inactive until an item or a group
            -- modifier fills them) and the 18 charLevel equations in one test.
            -- Both are documented above; neither has a value at a summon rank.
            WHERE TRY_CAST(l.value AS INTEGER) > 0
        ),
        {stat_carrier_walk("SELECT DISTINCT ability, ability, 0 FROM granted",
                           ability_stats)},
        ability AS (
            -- The granted ability is the source_record even when the stats come
            -- from a record one hop further on: the ability is what the pet has,
            -- and two abilities on one pet can name the same stat. g.lvl is the
            -- level the creature record grants, and it indexes the carrier's array
            -- unchanged - the hop resolves where the stats live, not which rank.
            SELECT g.skill_record, g.pet_record, 'pet_skill' AS source_kind,
                   g.ability AS source_record, g.bp, f.key AS stat_id,
                   TRY_CAST(str_split(f.value, ';')[
                       least(g.lvl, len(str_split(f.value, ';')))] AS DOUBLE) AS v
            FROM granted g
            JOIN stat_record sr ON sr.root = g.ability
            JOIN facts f ON f.record = sr.cur
            WHERE {ability_stats}
        ),
        sampled AS (SELECT * FROM body UNION ALL SELECT * FROM ability)
        SELECT skill_record, pet_record, source_kind, source_record, stat_id,
               max(v) FILTER (WHERE bp = 1) AS at_first,
               max(v) FILTER (WHERE bp = 2) AS at_max,
               max(v) FILTER (WHERE bp = 3) AS at_ultimate
        FROM sampled
        GROUP BY skill_record, pet_record, source_kind, source_record, stat_id""")
    # The spawn array is one entry per rank of whatever summon drives it, so its
    # length matching that summon's ultimate rank is the shape this whole table
    # assumes. A patch that breaks it would silently clamp every breakpoint onto
    # the last entry, so it rides out as a diagnostic instead.
    diag["pet_spawn_len_mismatch"] = con.execute("""
        SELECT count(*) FROM skills s
        JOIN facts f ON f.record = s.effect_record
                    AND f.key IN ('spawnObjects', 'modSpawnObjects')
                    AND trim(f.value) != ''
        LEFT JOIN skills g ON f.key = 'modSpawnObjects' AND g.record = s.group_record
        WHERE len(str_split(f.value, ';'))
              != coalesce(g.ultimate_level, s.ultimate_level)""").fetchone()[0]
    out = out_dir / "pet_ranks.parquet"
    con.execute(f"COPY (SELECT * FROM pet_ranks ORDER BY skill_record, source_kind, "
                f"source_record, stat_id) "
                f"TO {sql_str(out.as_posix())} (FORMAT parquet, COMPRESSION zstd)")
    return con.execute("SELECT count(*) FROM pet_ranks").fetchone()[0]


# ---------------------------------------------------------------------------
# skill modifiers
# ---------------------------------------------------------------------------

# Skill-shape keys that are not stats. Excluded wherever modifier stats are read.
_MODIFIER_STAT_EXCLUDE = ("skillMaxLevel", "skillUltimateLevel", "skillTier",
                          "skillMasteryLevelRequired", "isPetBonusScaling",
                          "instantCast", "petLimit", "petBurstSpawn")


def _modifier_rows_sql(paired_sql: str, extra_cols: tuple[str, ...] = ()) -> str:
    """The SELECT behind skill_modifiers.parquet and set_modifiers.parquet.

    `paired_sql` is the body of a `paired` CTE producing (source_record,
    modified_skill, modifier_record) plus any column named in `extra_cols`. The two
    tables differ only in what roots them: an item names its modifier through its own
    record, a set through the set record every member points at. Everything after
    that - the shell walk, the conversion pair, the refresh qualifiers, reading a
    per-rank array's first element - is one implementation, because the two must
    render identically on the same card and a second copy would drift.
    """
    excluded = ", ".join(f"'{k}'" for k in _MODIFIER_STAT_EXCLUDE)
    # facts.value_num is NULL for every one of the 44,013 semicolon-separated
    # values, so reading it alone dropped every array-valued stat. The split runs
    # only on the rows that need it and a scalar still comes straight off the
    # pre-parsed column.
    first_rank = ("CASE WHEN f.value LIKE '%;%' "
                  "THEN TRY_CAST(str_split(f.value, ';')[1] AS DOUBLE) "
                  "ELSE f.value_num END")
    # The conversion index carried by a key's trailing digits, the unnumbered key
    # being index 1 - the same expression build_conversions uses, so the two tables
    # pair the same three keys the same way.
    conv_n = "COALESCE(NULLIF(regexp_extract({0}, '(\\d+)$', 1), ''), '1')"
    extra = "".join(f"p.{c}, " for c in extra_cols)
    return f"""
        WITH RECURSIVE conv_key AS (
            SELECT record, regexp_replace(key, '\\d+$', '') AS base,
                   {conv_n.format("key")} AS n, trim(value) AS value
            FROM facts
            WHERE (key LIKE 'conversionInType%' OR key LIKE 'conversionOutType%')
              AND trim(value) != ''
        ),
        -- Both halves of a pair or neither. conversions.parquet requires an in-type
        -- AND an out-type at the same index to build a triple, and a percentage with
        -- one side missing names nothing a card could render, so the two tables must
        -- not disagree about the same game data. Two modifier records carry
        -- conversionInType Stun with no out-type; they keep their percentage row and
        -- report no types at all rather than shipping half a pair.
        conv AS (
            SELECT i.record, i.n, i.value AS from_type, o.value AS to_type
            FROM conv_key i
            JOIN conv_key o ON o.record = i.record AND o.n = i.n
                           AND o.base = 'conversionOutType'
            WHERE i.base = 'conversionInType'
        ),
        paired AS ({paired_sql}),
        -- The refresh families name a target skill and a trigger in sibling string
        -- keys that the numeric stat gate drops. They ride along on the rows that
        -- have them, matched on the family prefix, exactly as conv does for
        -- conversions.
        --
        -- A trigger holding more than one token is the template's untouched default
        -- (the full 13-value enum), not a selection, so it is read as absent.
        --
        -- The guard is defensive rather than load-bearing: at build 24756825 no record
        -- pairs a defaulted enum with a non-zero refresh amount, so the numeric stat
        -- gate has already dropped every row this could catch. It stays because the
        -- alternative failure is silent and ugly (the whole enum printed onto a card),
        -- and test_no_record_pairs_a_defaulted_trigger_with_a_real_amount fails the
        -- moment that stops being true.
        refresh_qual AS (
            SELECT record,
                   regexp_extract(key, '^(refreshCooldown|refreshDuration)', 1) AS family,
                   max(CASE WHEN key LIKE '%Skill' THEN trim(value) END) AS refresh_skill,
                   max(CASE WHEN key LIKE '%Trigger' AND trim(value) NOT LIKE '%;%'
                            THEN trim(value) END) AS refresh_trigger
            FROM facts
            WHERE (key IN ('refreshCooldownSkill', 'refreshCooldownTrigger',
                           'refreshDurationSkill', 'refreshDurationTrigger'))
              AND trim(value) != ''
            GROUP BY 1, 2
        ),
        {stat_carrier_walk("SELECT DISTINCT modifier_record, modifier_record, 0 "
                           "FROM paired",
                           f"f.key NOT IN ({excluded}) "
                           f"AND coalesce({first_rank}, 0) != 0")}
        SELECT p.source_record, {extra}p.modified_skill, p.modifier_record,
               f.key AS stat_id,
               {first_rank} AS value,
               c.from_type,
               c.to_type,
               rq.refresh_skill,
               rq.refresh_trigger
        FROM paired p
        JOIN stat_record sr ON sr.root = p.modifier_record
        JOIN facts f ON f.record = sr.cur
        -- conversionPercentage says nothing on its own: the pair of damage types
        -- it converts between lives in two sibling string keys that the numeric
        -- gate below would drop. They ride along on the row instead, matched on the
        -- conversion index. The index expression is applied to every stat key, but
        -- only a conversionPercentage row can find a conv partner on its record, so
        -- the join simply finds nothing on the others.
        LEFT JOIN conv c ON c.record = sr.cur
                        AND f.key LIKE 'conversionPercentage%'
                        AND c.n = {conv_n.format("f.key")}
        -- regexp_extract returns '' for a non-refresh key, and no refresh_qual row
        -- has an empty family, so this join finds nothing on unrelated stats
        -- without needing a guard.
        LEFT JOIN refresh_qual rq ON rq.record = sr.cur
                                 AND rq.family = regexp_extract(
                                       f.key, '^(refreshCooldown|refreshDuration)', 1)
        WHERE f.key NOT IN ({excluded})
          AND coalesce({first_rank}, 0) != 0"""


# modifiedSkillName<N> names the skill and modifierSkillName<N> the record holding
# the stats, the trailing number pairing them. Only a mastery skill can be rendered
# against the skills roster: records/skills/default/defaultevade.dbr is the one
# off-roster target at build 24756825, and the nine rune items that qualify for
# skill_modifiers through it alone would otherwise carry nothing renderable.
_MODIFIER_PAIR_JOIN = """
            JOIN facts m ON m.record = root.record
                        AND m.key LIKE 'modifiedSkillName%' AND trim(m.value) != ''
            JOIN facts r ON r.record = root.record
                        AND r.key = 'modifierSkillName'
                                 || regexp_extract(m.key, 'modifiedSkillName(\\d+)', 1)
                        AND trim(r.value) != ''
            WHERE lower(trim(m.value)) IN (SELECT record FROM skills)"""


def build_skill_modifiers(con: duckdb.DuckDBPyConnection, out_dir: Path) -> int:
    """The extra stats an item attaches to one specific skill.

    modifiedSkillName<N> names the skill and modifierSkillName<N> names the record
    holding the stats, the trailing number pairing them. That modifier record is
    frequently a shell: Chosen Visage's Summon Hellhound modifier is a
    SkillSecondary_PetModifier whose petSkillName reaches the record actually
    carrying 200 fire damage and 18% crit damage.

    The walk is `stat_carrier_walk`, shared with build_pet_ranks: it collects every
    record in the chain carrying a non-zero numeric stat, and gates on a stat rather
    than on a display name. Modifier stats routinely sit on anonymous carrier
    records, so the name-gated skill_effect walk cannot reach them at all. Only the
    stat gate below is this table's own. Collecting the whole chain rather than the
    nearest carrier is what keeps a pet-modifier shell's own line and its pet block
    both on the card: Bloodsworn Codex's Summon Briarthorn shell carries -6s of skill
    recharge and reaches +25% total damage one petSkillName hop away, and reporting
    only the nearer of the two dropped a real card line either way.

    A carrier stores a stat either as a bare scalar or, when the modifier skill has
    more than one rank, as a semicolon-separated per-rank array. Both are read with
    the same expression, taking the first element:

    - nothing on the item record names a rank (there is no modifierSkillLevel key
      of any kind in the deposit), so an item grants its modifier at rank 1;
    - 2,406 of the 2,978 carriers the walk reaches (counted once per (root, carrier)
      pair; 2,403 of 2,947 distinct carrier records) have skillMaxLevel 1 and store
      their stats as scalars, which are rank-1 values by definition, so taking
      element 1 makes the two shapes agree;
    - the numbers agree too. Where a stat appears on both shapes the first elements
      land in the scalar range and the later ranks do not: offensiveFireMin has a
      median of 90 across 23 scalar carriers, 100 across the first elements of the
      6 array carriers, and 200 across their second elements.

    Reading arrays with the same expression also keeps the walk's stat gate honest.
    A carrier whose only stats are arrays used to look empty, so the walk ran past
    it and the whole block vanished with no diagnostic.
    """
    con.execute("CREATE TEMP TABLE skill_modifiers AS " + _modifier_rows_sql(f"""
            SELECT root.record AS source_record,
                   lower(trim(m.value)) AS modified_skill,
                   lower(trim(r.value)) AS modifier_record
            FROM scoped root{_MODIFIER_PAIR_JOIN}"""))
    out = out_dir / "skill_modifiers.parquet"
    # modifier_record is part of the sort key because it is part of the identity:
    # one item can attach two different carriers to the same skill and both can
    # name the same stat. Bloodlord's Blade's Possession block carries
    # skillCooldownReduction 100 (the chance-gated reset) on one carrier and 5 (the
    # flat reduction) on another, so neither row can be dropped or summed, and
    # without the record in the sort their order is not determined.
    con.execute(f"COPY (SELECT source_record AS item_record, modified_skill, modifier_record, "
                f"stat_id, value, from_type, to_type, refresh_skill, refresh_trigger "
                f"FROM skill_modifiers "
                f"ORDER BY item_record, modified_skill, modifier_record, stat_id) "
                f"TO {sql_str(out.as_posix())} (FORMAT parquet, COMPRESSION zstd)")
    return con.execute("SELECT count(*) FROM skill_modifiers").fetchone()[0]


# ---------------------------------------------------------------------------
# loot sets
# ---------------------------------------------------------------------------

# A set bonus turns on at a piece count, and the set record stores that as one
# array slot per member: position N carries the value granted while N pieces are
# worn. Every such array in the game today is a single step (0..0,V,V..V) and
# position 1 is zero in all 642 of them, one piece not being a set, so a bonus is
# fully described by the first non-zero position and the value sitting there.
# build_sets fails the run if a patch ever ships a multi-step array, rather than
# silently reporting only its first step.
_PIECES = ("list_position(list_transform(str_split({0}, ';'), "
           "x -> coalesce(TRY_CAST(x AS DOUBLE), 0) != 0), true)")
_SET_ARRAY_KEYS = ("itemSkillModifierControl", "augmentSkillLevel%",
                   "augmentMasteryLevel%", "itemSkillLevel")


def build_sets(con: duckdb.DuckDBPyConnection, out_dir: Path) -> int:
    """The loot sets and which items belong to them.

    A set is its own record under `records/items/lootsets` and is deliberately
    outside `scoped`: it carries no `Class` at all and gear-types.json maps its
    category to no domain, so every other table here passes it by. It nonetheless
    carries the same skill wiring an item does - `modifiedSkillName<N>` with
    `modifierSkillName<N>`, `augmentSkillName<N>` with `augmentSkillLevel<N>` - and
    those bonuses are a real reason to wear a piece. Ultos' Tempest gives Savagery
    33 lightning damage and a 30% on-crit Primal Strike refresh at 5 pieces, and
    none of its five members says so on its own record.

    One row per set, not per member: which set an ITEM belongs to is the item's own
    `itemSetName`, which is single-valued and is what the game puts on its tooltip.
    The set's `setMembers` list is read only for its length, which is what sizes
    every piece-count array on the record. The two disagree in the corners (26 items
    claim a set that does not list them, 19 listed members do not claim back), and no
    item is a member of two sets that both carry skill wiring, so the item's own
    claim is the safe side to link from.
    """
    con.execute("""
        CREATE TEMP TABLE sets AS
        SELECT n.record AS set_record, trim(n.value) AS name_tag,
               len(str_split(m.value, ';')) AS members
        FROM facts n
        JOIN facts m ON m.record = n.record AND m.key = 'setMembers'
                    AND trim(m.value) != ''
        WHERE n.key = 'setName' AND trim(n.value) != ''""")
    # A multi-step array would mean a bonus that grows with the piece count, which
    # neither this schema nor the page's "(N pieces)" caption can express. Nothing
    # in the game ships one; the guard is here so a patch that starts to says so.
    for key in _SET_ARRAY_KEYS:
        bad = con.execute(f"""
            SELECT count(*) FROM facts f
            WHERE f.key LIKE '{key}' AND f.value LIKE '%;%'
              AND f.record IN (SELECT set_record FROM sets)
              AND len(list_filter(list_distinct(
                    list_transform(str_split(f.value, ';'),
                                   x -> coalesce(TRY_CAST(x AS DOUBLE), 0))),
                    v -> v != 0)) > 1""").fetchone()[0]
        if bad:
            print(f"ERROR: {bad} set arrays for {key} carry more than one non-zero "
                  f"level; the piece-count model assumes a single step", file=sys.stderr)
            raise SystemExit(2)
    out = out_dir / "sets.parquet"
    con.execute(f"COPY (SELECT * FROM sets ORDER BY set_record) "
                f"TO {sql_str(out.as_posix())} (FORMAT parquet, COMPRESSION zstd)")
    return con.execute("SELECT count(*) FROM sets").fetchone()[0]


def build_set_modifiers(con: duckdb.DuckDBPyConnection, out_dir: Path) -> int:
    """A set's own skill modifiers, and the piece count that turns them on.

    Same shape and same walk as skill_modifiers (see `_modifier_rows_sql`) - a set's
    modifier record is a `Skill_Modifier` like any other - plus the piece count. One
    `itemSkillModifierControl` array governs every `modifiedSkillName<N>` on a set,
    so all of a set's blocks share a threshold; no set in the game carries a
    per-block control key.
    """
    con.execute("CREATE TEMP TABLE set_modifiers AS " + _modifier_rows_sql(f"""
            SELECT root.set_record AS source_record,
                   CAST({_PIECES.format("ctl.value")} AS INTEGER) AS pieces,
                   lower(trim(m.value)) AS modified_skill,
                   lower(trim(r.value)) AS modifier_record
            FROM (SELECT DISTINCT set_record FROM sets) root
            JOIN facts ctl ON ctl.record = root.set_record
                          AND ctl.key = 'itemSkillModifierControl'
                          AND trim(ctl.value) != ''{_MODIFIER_PAIR_JOIN.replace(
                              "root.record", "root.set_record")}""",
                                                                          ("pieces",)))
    out = out_dir / "set_modifiers.parquet"
    con.execute(f"COPY (SELECT source_record AS set_record, pieces, modified_skill, "
                f"modifier_record, stat_id, value, from_type, to_type, refresh_skill, "
                f"refresh_trigger FROM set_modifiers "
                f"ORDER BY set_record, modified_skill, modifier_record, stat_id) "
                f"TO {sql_str(out.as_posix())} (FORMAT parquet, COMPRESSION zstd)")
    return con.execute("SELECT count(*) FROM set_modifiers").fetchone()[0]


def build_set_boosts(con: duckdb.DuckDBPyConnection, out_dir: Path) -> int:
    """A set's +N to a skill or a mastery, and the piece count that turns it on.

    build_boosts' shape with a piece count: the level lives in the same per-piece
    array as everything else on a set record, so the level reported is the one at
    the first piece count that grants anything.
    """
    con.execute("CREATE TEMP TABLE set_boosts (set_record VARCHAR, pieces INTEGER, "
                "kind VARCHAR, target VARCHAR, mastery_record VARCHAR, level INTEGER)")
    for kind, name_key, level_key in (("skill", "augmentSkillName", "augmentSkillLevel"),
                                      ("mastery", "augmentMasteryName", "augmentMasteryLevel")):
        con.execute(f"""
            INSERT INTO set_boosts
            WITH raw AS (
                SELECT s.set_record, lower(trim(n.value)) AS target, lv.value AS arr
                FROM (SELECT DISTINCT set_record FROM sets) s
                JOIN facts n ON n.record = s.set_record
                            AND n.key LIKE '{name_key}%' AND trim(n.value) != ''
                JOIN facts lv ON lv.record = s.set_record
                             AND lv.key = '{level_key}'
                                          || regexp_extract(n.key, '{name_key}(\\d+)', 1)
                             AND trim(lv.value) != ''
            ),
            stepped AS (
                SELECT set_record, target, arr,
                       CAST({_PIECES.format("arr")} AS INTEGER) AS pieces
                FROM raw
            ),
            levelled AS (
                SELECT set_record, target, pieces,
                       CAST(TRY_CAST(str_split(arr, ';')[pieces] AS DOUBLE) AS INTEGER) AS lvl,
                       regexp_extract(target, 'playerclass(\\d+)', 1) AS cls
                FROM stepped
                WHERE pieces IS NOT NULL
            )
            SELECT set_record, pieces, '{kind}', target,
                   'records/skills/playerclass' || cls
                   || '/_classtraining_class' || cls || '.dbr',
                   lvl
            FROM levelled
            WHERE cls != '' AND lvl > 0""")
    out = out_dir / "set_boosts.parquet"
    con.execute(f"COPY (SELECT * FROM set_boosts ORDER BY set_record, kind, target) "
                f"TO {sql_str(out.as_posix())} (FORMAT parquet, COMPRESSION zstd)")
    return con.execute("SELECT count(*) FROM set_boosts").fetchone()[0]


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
            "skill_ref_missing": 0,
            "skills_without_button": 0, "skills_without_name": 0,
            "rank_array_len_mismatch": 0, "pet_spawn_len_mismatch": 0}
    build_wide(con, cur)
    n_skill_effect = build_skill_effect_map(con, out_dir)
    n_relations = build_relations(con, diag)
    n_entities = build_entities(con, cur, out_dir, diag)
    n_stats = build_stats(con, cur, out_dir, diag)
    n_sources = build_sources(con, cur, out_dir)
    n_boosts = build_boosts(con, out_dir)
    n_conversions = build_conversions(con, out_dir)
    n_skills = build_skills(con, out_dir, diag)
    build_rank_keys(con)
    n_skill_ranks = build_skill_ranks(con, out_dir, diag)
    n_pet_ranks = build_pet_ranks(con, out_dir, diag)
    n_skill_modifiers = build_skill_modifiers(con, out_dir)
    n_sets = build_sets(con, out_dir)
    n_set_modifiers = build_set_modifiers(con, out_dir)
    n_set_boosts = build_set_boosts(con, out_dir)

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
    boost_kind_counts = con.execute(
        "SELECT kind, count(*) FROM boosts GROUP BY 1 ORDER BY 1").fetchall()
    print(f"  boosts: {n_boosts}   " +
          "  ".join(f"{k}({n})" for k, n in boost_kind_counts))
    print(f"  conversions: {n_conversions}")
    print(f"  skills: {n_skills}")
    print(f"  skill ranks: {n_skill_ranks}")
    print(f"  pet ranks: {n_pet_ranks}")
    print(f"  skill modifiers: {n_skill_modifiers}")
    print(f"  sets: {n_sets}   modifiers({n_set_modifiers})  boosts({n_set_boosts})")
    print(f"  skill effect map: {n_skill_effect}")
    print("  diagnostics: " + "  ".join(f"{k}={v}" for k, v in diag.items()
                                        if not k.endswith("_sample")))
    if diag.get("equation_error_sample"):
        print(f"  first equation error: {diag['equation_error_sample']}")
    for name in OUTPUT_TABLES:
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
