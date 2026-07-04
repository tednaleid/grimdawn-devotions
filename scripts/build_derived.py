#!/usr/bin/env -S uv run --script
# ABOUTME: Builds the derived typed item schema (entities/stats/relations parquet) from the raw
# ABOUTME: deposit plus the committed curation files in data/item-curation/ (see docs/item-schema.md).
# /// script
# requires-python = ">=3.10"
# dependencies = ["duckdb"]
# ///
"""Derived item schema: typed tables for the item-database SPA, built by SQL alone.

Inputs: the deposit parquet (facts/labels/meta, labels schema v2 with tag sources)
and data/item-curation/*.json. Outputs under data/derived/ (gitignored, same
size-gate discipline as the deposit):

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
    for name in ("gear-types", "stat-families", "attack-speed", "variance"):
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
    "characterBaseAttackSpeed", "itemSkillName", "itemSetName", "attributeScalePercent",
    "lootRandomizerName", "lootRandomizerJitter", "lootRandomizerCost",
]


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

    # has_blueprint: some blueprint's crafts target is this record (KTD8 keys).
    con.execute("""
        UPDATE entities SET has_blueprint = TRUE
        WHERE lower(record) IN (
          SELECT lower(trim(value)) FROM facts
          WHERE key IN ('forcedRandomArtifactName', 'artifactName')
            AND record LIKE 'records/items/crafting/%')""")

    out = out_dir / "entities.parquet"
    con.execute(f"COPY (SELECT * FROM entities ORDER BY record) TO {sql_str(out.as_posix())} "
                f"(FORMAT parquet, COMPRESSION zstd)")
    return len(inserts)


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
            "cost_default_used": 0, "cost_record_missing": 0, "equation_errors": 0}
    build_wide(con, cur)
    n_entities = build_entities(con, cur, out_dir, diag)

    counts = con.execute(
        "SELECT domain, count(*) FROM entities GROUP BY 1 ORDER BY 1").fetchall()

    print("\n=== DERIVED SUMMARY ===")
    print(f"  entities: {n_entities}   " +
          "  ".join(f"{d}({n})" for d, n in counts))
    print(f"  diagnostics: " + "  ".join(f"{k}={v}" for k, v in diag.items()
                                         if not k.endswith("_sample")))
    if diag.get("equation_error_sample"):
        print(f"  first equation error: {diag['equation_error_sample']}")
    for name in ("entities",):
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
