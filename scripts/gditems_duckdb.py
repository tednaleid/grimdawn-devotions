#!/usr/bin/env -S uv run --script
# ABOUTME: DuckDB repository adapter translating gditems_core.Criteria into SQL over the
# ABOUTME: derived item parquet. Owns every SQL string in the item CLI; gditems_core does not.
# /// script
# requires-python = ">=3.10"
# dependencies = ["duckdb", "lzstring"]
# ///
"""Repository port for the item query CLI.

Design decisions not spelled out by the interface, recorded here so a reader does not
have to re-derive them:

Filtering vs. scoring. `entities`-level scope flags (domain, slot, gear_type, rarity,
expansion, fits, source) always narrow the SQL candidate set. `Criteria.stats` and
`converts_to` narrow it too, but only when a threshold is given (`StatCriterion.minimum`,
`min_convert`); without a threshold they contribute no WHERE clause at all, matching
`gditems_core.score`'s rule that a criterion without a minimum leaves a non-matching
candidate in the result scored at zero rather than excluding it. `grants_skills`,
`boosts_skills`, `boosts_masteries`, and `masteries` never filter (they have no minimum
concept); they only shape which rows populate a Candidate's dict/tuple fields, which
`gditems_core._raw_value` reads at scoring time. `Criteria.level`, `all_tiers`, and `limit`
are never used here: level selection is `collapse_tiers`' job in the core, and limiting the
result before scoring would risk cutting a candidate that scores well before it is scored.

Stat family aggregation. A family (e.g. resist.pierce) can map to several raw stat_ids
(flat value, a %, a duration, a duration modifier, ...). Per docs/item-schema.md the filter
contract treats a family as a semi-join ("OR within a family"): a stats criterion with a
minimum matches if ANY stat_id in that family clears it. The same OR-flavoured reading
extends to populating Candidate.stat_values: MAX(value_min) across the family's stat_ids,
not a sum, since the family's members are not commensurable quantities.

Source uniqueness. No item in the sampled data carries two different `sources.kind`
values, so a single `LIMIT 1` subquery is a safe, deterministic way to read one item's
source kind even on the ~8% of sourced items that have more than one row (multiple
vendors at the same kind).

Labels live outside derived_dir. `labels.parquet` is a deposit artifact (data/deposit/),
not a derived one, but item display names and `find()`'s name lookup need it. The
constructor takes only `derived_dir` per the task interface, so `deposit_dir` defaults to
its sibling (`derived_dir.parent / "deposit"`), mirroring the repo's own justfile
convention that the two directories are always siblings under data/. An explicit
`deposit_dir` argument overrides that default.

Mastery/skill vocabulary. `vocabulary()['masteries']` and `['skills']` return record paths
(e.g. `records/skills/playerclass04/_classtraining_class04.dbr`), not human display names.
None of the tables this adapter reads (entities/stats/relations/families/sources/boosts/
conversions/labels) carry a name tag for a skill or mastery record - `entities` is items
only, and `labels` has no row keyed to those tags in this dataset. Record paths are also
exactly what Criteria.masteries/boosts_skills/boosts_masteries and Candidate.skill_boosts/
mastery_boosts already use, so nothing downstream needs translation. A human-name
resolution layer, if wanted, needs a different data source than this module has.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build_deposit import sql_str  # shared path-quoting helper
from gditems_core import Candidate, Criteria

import duckdb

DERIVED_TABLES = ("entities", "stats", "relations", "families", "sources", "boosts",
                   "conversions")

# Criteria.sources tokens -> sources.kind. 'unknown' has no row in `sources` at all.
_SOURCE_KIND_TO_TOKEN = {"faction_vendor": "vendor", "crafted": "crafted"}
_TOKEN_TO_SOURCE_KIND = {token: kind for kind, token in _SOURCE_KIND_TO_TOKEN.items()}

# The CASE that maps sources.kind to the Candidate.source vocabulary (vendor/crafted/unknown).
_SOURCE_CASE_SQL = (
    "CASE (SELECT so.kind FROM sources so WHERE so.item = e.record LIMIT 1) "
    + " ".join(f"WHEN {sql_str(kind)} THEN {sql_str(token)}"
               for kind, token in _SOURCE_KIND_TO_TOKEN.items())
    + " ELSE 'unknown' END"
)

_BASE_SELECT = f"""
    SELECT e.record, e.group_key, COALESCE(l.text, ''), COALESCE(e.item_level, 0),
           e.req_level, COALESCE(e.rarity, ''), e.slots, {_SOURCE_CASE_SQL}
    FROM entities e
    LEFT JOIN labels l ON l.tag = e.name_tag AND l.locale = 'en'
"""

# Deterministic order required by gditems_core.collapse_tiers's stable sort: without it,
# two records sharing an item_level could swap between runs on identical data. record is
# the tiebreaker because it is the only column guaranteed unique.
_ORDER_BY = "ORDER BY e.item_level DESC NULLS LAST, e.record"


class DuckDbRepository:
    """Structural repository port: fetch/vocabulary/find over the derived item parquet."""

    def __init__(self, derived_dir: Path, deposit_dir: Path | None = None):
        self._con = duckdb.connect()
        for name in DERIVED_TABLES:
            path = derived_dir / f"{name}.parquet"
            self._con.execute(
                f"CREATE VIEW {name} AS SELECT * FROM read_parquet({sql_str(path.as_posix())})")
        deposit_dir = deposit_dir or derived_dir.parent / "deposit"
        labels_path = deposit_dir / "labels.parquet"
        self._con.execute(
            f"CREATE VIEW labels AS SELECT * FROM read_parquet({sql_str(labels_path.as_posix())})")

    # ------------------------------------------------------------------
    # public port
    # ------------------------------------------------------------------

    def fetch(self, c: Criteria) -> list[Candidate]:
        where_sql, params = _where_clause(c)
        return self._select(where_sql, params)

    def find(self, name_or_record: str) -> list[Candidate]:
        if name_or_record.startswith("records/"):
            return self._select("e.record = ?", [name_or_record])
        return self._select("l.text = ?", [name_or_record])

    def vocabulary(self) -> dict[str, list[str]]:
        def col(table: str, column: str) -> list[str]:
            rows = self._con.execute(
                f"SELECT DISTINCT {column} FROM {table} WHERE {column} IS NOT NULL "
                f"ORDER BY {column}").fetchall()
            return [r[0] for r in rows]

        slots = self._con.execute(
            "SELECT DISTINCT unnest(slots) AS slot FROM entities ORDER BY slot").fetchall()
        skills = self._con.execute("""
            SELECT DISTINCT target FROM boosts WHERE kind = 'skill'
            UNION
            SELECT DISTINCT dst FROM relations WHERE kind = 'grants_skill'
            ORDER BY 1
        """).fetchall()

        return {
            "masteries": col("boosts", "mastery_record"),
            "gear_types": col("entities", "gear_type"),
            "slots": [r[0] for r in slots],
            "stat_families": col("families", "family"),
            "domains": col("entities", "domain"),
            "rarities": col("entities", "rarity"),
            "expansions": col("entities", "expansion"),
            "skills": [r[0] for r in skills],
        }

    # ------------------------------------------------------------------
    # shared query + assembly
    # ------------------------------------------------------------------

    def _select(self, where_sql: str, params: list) -> list[Candidate]:
        sql = _BASE_SELECT
        if where_sql:
            sql += f" WHERE {where_sql}"
        sql += f" {_ORDER_BY}"
        rows = self._con.execute(sql, params).fetchall()
        if not rows:
            return []
        records = [row[0] for row in rows]
        stat_values = self._stat_values(records)
        skill_boosts, mastery_boosts = self._boosts(records)
        granted_skills = self._granted_skills(records)
        conversions = self._conversions(records)
        return [
            Candidate(
                record=record, group_key=group_key, name=name, item_level=item_level,
                req_level=req_level, rarity=rarity, slots=tuple(slots), source=source,
                stat_values=stat_values.get(record, {}),
                skill_boosts=skill_boosts.get(record, {}),
                mastery_boosts=mastery_boosts.get(record, {}),
                granted_skills=granted_skills.get(record, ()),
                conversions=conversions.get(record, ()))
            for record, group_key, name, item_level, req_level, rarity, slots, source in rows
        ]

    def _stat_values(self, records: list[str]) -> dict[str, dict[str, float]]:
        rows = self._con.execute("""
            SELECT s.record, f.family, MAX(s.value_min)
            FROM stats s JOIN families f ON f.stat_id = s.stat_id
            WHERE s.record = ANY(?)
            GROUP BY s.record, f.family
        """, [records]).fetchall()
        out: dict[str, dict[str, float]] = {}
        for record, family, value in rows:
            out.setdefault(record, {})[family] = value
        return out

    def _boosts(self, records: list[str]) -> tuple[dict[str, dict[str, int]],
                                                     dict[str, dict[str, int]]]:
        rows = self._con.execute("""
            SELECT record, kind, target, mastery_record, MAX(level)
            FROM boosts
            WHERE record = ANY(?)
            GROUP BY record, kind, target, mastery_record
        """, [records]).fetchall()
        skill_boosts: dict[str, dict[str, int]] = {}
        mastery_boosts: dict[str, dict[str, int]] = {}
        for record, kind, target, mastery_record, level in rows:
            if kind == "skill":
                skill_boosts.setdefault(record, {})[target] = level
            elif kind == "mastery":
                mastery_boosts.setdefault(record, {})[mastery_record] = level
        return skill_boosts, mastery_boosts

    def _granted_skills(self, records: list[str]) -> dict[str, tuple[str, ...]]:
        rows = self._con.execute("""
            SELECT src, dst FROM relations
            WHERE src = ANY(?) AND kind = 'grants_skill'
            ORDER BY src, dst
        """, [records]).fetchall()
        out: dict[str, list[str]] = {}
        for src, dst in rows:
            out.setdefault(src, []).append(dst)
        return {record: tuple(skills) for record, skills in out.items()}

    def _conversions(self, records: list[str]) -> dict[str, tuple[tuple[str, str, float], ...]]:
        rows = self._con.execute("""
            SELECT record, from_type, to_type, percent FROM conversions
            WHERE record = ANY(?)
            ORDER BY record, from_type, to_type
        """, [records]).fetchall()
        out: dict[str, list[tuple[str, str, float]]] = {}
        for record, from_type, to_type, percent in rows:
            out.setdefault(record, []).append((from_type, to_type, percent))
        return {record: tuple(triples) for record, triples in out.items()}


# ------------------------------------------------------------------
# Criteria -> WHERE clause
# ------------------------------------------------------------------

def _where_clause(c: Criteria) -> tuple[str, list]:
    clauses: list[str] = []
    params: list = []

    def scope(column: str, values: tuple[str, ...]) -> None:
        if values:
            clauses.append(f"e.{column} = ANY(?)")
            params.append(list(values))

    scope("domain", c.domains)
    scope("gear_type", c.gear_types)
    scope("rarity", c.rarities)
    scope("expansion", c.expansions)

    if c.slots:
        clauses.append("list_has_any(e.slots, ?)")
        params.append(list(c.slots))

    if c.fits is not None:
        clauses.append(
            "EXISTS (SELECT 1 FROM relations r WHERE r.src = e.record "
            "AND r.kind = 'applies_to' AND r.dst = ?)")
        params.append(c.fits)

    if c.sources:
        clause, source_params = _sources_clause(c.sources)
        if clause:
            clauses.append(clause)
            params.extend(source_params)

    for stat in c.stats:
        if stat.minimum is not None:
            clauses.append(
                "EXISTS (SELECT 1 FROM stats s JOIN families f "
                "ON f.stat_id = s.stat_id AND f.family = ? "
                "WHERE s.record = e.record AND s.value_min >= ?)")
            params.extend([stat.family, stat.minimum])

    if c.converts_to is not None and c.min_convert is not None:
        clauses.append(
            "EXISTS (SELECT 1 FROM conversions cv WHERE cv.record = e.record "
            "AND cv.to_type = ? AND cv.percent >= ?)")
        params.extend([c.converts_to, c.min_convert])

    return " AND ".join(clauses), params


def _sources_clause(sources: tuple[str, ...]) -> tuple[str, list]:
    """Build the `sources` scope clause. `unknown` means no row in `sources` at all."""
    mapped_kinds = [_TOKEN_TO_SOURCE_KIND[s] for s in sources if s in _TOKEN_TO_SOURCE_KIND]
    want_unknown = "unknown" in sources

    parts: list[str] = []
    params: list = []
    if mapped_kinds:
        parts.append("EXISTS (SELECT 1 FROM sources so WHERE so.item = e.record "
                      "AND so.kind = ANY(?))")
        params.append(mapped_kinds)
    if want_unknown:
        parts.append("NOT EXISTS (SELECT 1 FROM sources so2 WHERE so2.item = e.record)")

    if not parts:
        return "", []
    return "(" + " OR ".join(parts) + ")", params


# ------------------------------------------------------------------
# smoke check
# ------------------------------------------------------------------

def _selftest() -> None:
    derived_dir = Path(__file__).resolve().parent.parent / "data" / "derived"
    repo = DuckDbRepository(derived_dir)
    criteria = Criteria(
        domains=("augment",), slots=(), gear_types=(), rarities=(), expansions=(),
        sources=(), fits="chest", level=None, all_tiers=False, stats=(), converts_to=None,
        min_convert=None, grants_skills=(), boosts_skills=(), boosts_masteries=(),
        masteries=(), limit=20)
    results = repo.fetch(criteria)
    print(f"domain=augment fits=chest: {len(results)} row(s)")
    assert len(results) > 0, "expected a non-zero row count"

    vocab = repo.vocabulary()
    for key, values in vocab.items():
        print(f"vocabulary[{key}]: {len(values)} token(s)")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
    else:
        print("usage: gditems_duckdb.py --selftest", file=sys.stderr)
        sys.exit(2)
