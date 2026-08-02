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

Mastery/skill vocabulary. `vocabulary()['masteries']`, `['skills']`, and `['granted_skills']`
are each a mapping from display name to record, not a plain list, so a caller can turn a
human name straight into the record path `Criteria` actually uses. The name comes from
`facts` (a deposit table, not a derived one - reached the same way as `labels`, via
`deposit_dir`): `facts.record = <record> AND facts.key = 'skillDisplayName'` gives a tag,
`labels.tag = that tag AND labels.locale = 'en'` gives the text. An unresolved record is
never dropped or given an invented name: it is keyed by its own record path instead, so it
stays addressable; see `_name_map` for how a name shared by more than one record (real for
`granted_skills`) is handled without dropping any of them either.

`skills` is scoped to `boosts.target` where `kind = 'skill'` (245 records, what
`--boosts-skill`/`--mastery` can name; 199 resolve to a display name). `granted_skills` is a
separate key scoped to `relations.dst` where `kind = 'grants_skill'` (724 records, what
`--grants-skill` can name; 616 resolve). These are almost entirely disjoint sets at the
record level - exactly one record (a Flashbang item skill) appears in both `boosts.target`
and as a `grants_skill` edge, measured 2026-08-01 - so a single shared `skills` key would
have resolved essentially none of `--grants-skill`'s vocabulary. `masteries` (9 records, all
resolve) never shares a key with either of the other two, checked directly.

But `skills` and `granted_skills` DO share 9 display names, checked directly against the
real, already-disambiguated dicts: Canister Bomb, Overguard, Panetti's Replicating Missile,
Phantasmal Blades, Rebuke, Storm Surge, Stun Jacks, Wind Devil (each names a genuinely
different record depending which key you look it up in - a class skill in `skills`, a
separate item-skill record with the same display text in `granted_skills`), plus Flashbang
(the one record shared by both keys, so both point to the same record there). A caller that
resolves a bare name against these three maps without knowing which one the flag calls for
can land on the wrong record for those 9 names. This module does not disambiguate across
keys - only within one - so a caller (Task 7's flag parsing) must look a name up in the
vocabulary key that matches the flag it came from (`--boosts-skill`/`--mastery` -> `skills`,
`--grants-skill` -> `granted_skills`), not search all three and take whichever hits first.
"""
from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path
from typing import TypedDict

sys.path.insert(0, str(Path(__file__).parent))
from build_deposit import sql_str  # shared path-quoting helper
from gditems_core import Candidate, Criteria

import duckdb


class Vocabulary(TypedDict):
    """`vocabulary()`'s result. Enum-like scope/criteria tokens (gear_types, slots,
    stat_families, domains, rarities, expansions, conversion_types) stay plain lists of
    the raw tokens `Criteria` consumes directly. `masteries`, `skills`, and
    `granted_skills` need per-name lookup, so each is a
    display-name -> record map instead (see `_name_map`); a flat `dict[str, list[str] |
    dict[str, str]]` would type every value as the union at every key, which is looser than
    what the method actually returns and defeats the point of asking for one key by name."""
    masteries: dict[str, str]
    gear_types: list[str]
    slots: list[str]
    stat_families: list[str]
    domains: list[str]
    rarities: list[str]
    expansions: list[str]
    conversion_types: list[str]
    skills: dict[str, str]
    granted_skills: dict[str, str]

DERIVED_TABLES = ("entities", "stats", "relations", "families", "sources", "boosts",
                   "conversions")

# Criteria.sources tokens -> sources.kind. 'unknown' has no row in `sources` at all.
_SOURCE_KIND_TO_TOKEN = {"faction_vendor": "vendor", "crafted": "crafted"}
_TOKEN_TO_SOURCE_KIND = {token: kind for kind, token in _SOURCE_KIND_TO_TOKEN.items()}

# Every token Candidate.source (and therefore --source) can take: every
# _SOURCE_KIND_TO_TOKEN value, plus 'unknown' for the no-source-row case
# _SOURCE_CASE_SQL falls back to below. The single source of truth for this list -
# gditems.py imports it rather than re-typing it, so the CLI's --source vocabulary
# can never drift from what the adapter actually produces.
SOURCE_TOKENS = tuple(_SOURCE_KIND_TO_TOKEN.values()) + ("unknown",)

# The CASE that maps sources.kind to the Candidate.source vocabulary (vendor/crafted/unknown).
_SOURCE_CASE_SQL = (
    "CASE (SELECT so.kind FROM sources so WHERE so.item = e.record LIMIT 1) "
    + " ".join(f"WHEN {sql_str(kind)} THEN {sql_str(token)}"
               for kind, token in _SOURCE_KIND_TO_TOKEN.items())
    + " ELSE 'unknown' END"
)

_BASE_SELECT = f"""
    SELECT e.record, e.group_key, COALESCE(l.text, ''), COALESCE(e.item_level, 0),
           e.req_level, COALESCE(e.rarity, ''), COALESCE(e.domain, ''), e.slots,
           {_SOURCE_CASE_SQL}
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
        for name in ("labels", "facts"):
            path = deposit_dir / f"{name}.parquet"
            self._con.execute(
                f"CREATE VIEW {name} AS SELECT * FROM read_parquet({sql_str(path.as_posix())})")

    # ------------------------------------------------------------------
    # public port
    # ------------------------------------------------------------------

    def fetch(self, c: Criteria) -> list[Candidate]:
        """Candidates for `search`, scoped by `c` and always excluding empty-name
        records. 944 entities (measured 2026-08-01: 742 affix, 192 gear under
        records/items/enemygear/ and elsewhere, 5 augment, 5 blueprint) resolve to no
        display name at all - internal templates, not real items a build recommendation
        should ever surface. `find`/`tiers` do not apply this filter: a nameless record
        is still a legitimate `show` target by its own record path (see `find`'s
        docstring)."""
        where_sql, params = _where_clause(c)
        name_clause = "COALESCE(l.text, '') <> ''"
        where_sql = f"({where_sql}) AND {name_clause}" if where_sql else name_clause
        return self._select(where_sql, params)

    def find(self, name_or_record: str) -> list[Candidate]:
        """Resolve `name_or_record` for `show`, unfiltered by name: a nameless record
        (see `fetch`'s docstring) is still addressable by its own record path, since
        inspecting one directly is a legitimate use even though `search` must never
        rank it as a recommendation."""
        if name_or_record.startswith("records/"):
            return self._select("e.record = ?", [name_or_record])
        return self._select("l.text = ?", [name_or_record])

    def tiers(self, group_key: str) -> list[Candidate]:
        """Every record in the item family `group_key` identifies - the tier ladder
        `show` reports. Scoped by group_key, never by display name: display names
        collide ACROSS families, not just within one (measured 2026-08-01: Gazer Eye,
        Exalted Effigy, Hysteria, and Massacre each name two unrelated families across
        gear/augment/component/relic alone, 20+ once affixes are included). A relic
        named "Massacre" and an unrelated two-handed axe also named "Massacre" both
        matched `find("Massacre")`, so a caller that used `find` for this would silently
        report the axe's levels as part of the relic's ladder."""
        return self._select("e.group_key = ?", [group_key])

    def set_name(self, record: str) -> str | None:
        """Display name of the item set `record` belongs to, resolved
        entities.set_record -> facts.key='setName' -> labels, the same
        facts-then-labels join `_name_map` uses for skill/mastery names. None if the
        item is not part of a set or the set's name does not resolve."""
        row = self._con.execute("""
            SELECT l.text
            FROM entities e
            JOIN facts f ON f.record = e.set_record AND f.key = 'setName'
            JOIN labels l ON l.tag = f.value AND l.locale = 'en'
            WHERE e.record = ?
        """, [record]).fetchone()
        return row[0] if row else None

    def vocabulary(self) -> Vocabulary:
        def col(table: str, column: str) -> list[str]:
            rows = self._con.execute(
                f"SELECT DISTINCT {column} FROM {table} WHERE {column} IS NOT NULL "
                f"ORDER BY {column}").fetchall()
            return [r[0] for r in rows]

        slots = self._con.execute(
            "SELECT DISTINCT unnest(slots) AS slot FROM entities ORDER BY slot").fetchall()
        masteries = col("boosts", "mastery_record")
        skills = self._con.execute(
            "SELECT DISTINCT target FROM boosts WHERE kind = 'skill' ORDER BY target").fetchall()
        granted_skills = self._con.execute(
            "SELECT DISTINCT dst FROM relations WHERE kind = 'grants_skill' "
            "ORDER BY dst").fetchall()

        return {
            "masteries": self._name_map(masteries),
            "gear_types": col("entities", "gear_type"),
            "slots": [r[0] for r in slots],
            "stat_families": col("families", "family"),
            "domains": col("entities", "domain"),
            "rarities": col("entities", "rarity"),
            "expansions": col("entities", "expansion"),
            "conversion_types": col("conversions", "to_type"),
            "skills": self._name_map([r[0] for r in skills]),
            "granted_skills": self._name_map([r[0] for r in granted_skills]),
        }

    def _name_map(self, records: list[str]) -> dict[str, str]:
        """Display name -> record for every record with a resolvable skillDisplayName fact,
        record -> record for the rest, so an unnamed record stays addressable rather than
        silently dropped. `masteries` and the `boosts`-scoped `skills` never collide on a
        name in the measured data, but `granted_skills` does: distinct item-skill records
        (e.g. a base version and a legendary/rune version of the same skill) commonly share
        one skillDisplayName - 47 names across 62 of the 724 granted-skill records, measured
        2026-08-01. A plain `{name: record}` dict would silently keep only the last such
        record and drop the rest, exactly the failure mode this function exists to avoid, so
        a name shared by more than one record in this call is disambiguated to `"name
        (record)"` for every record that shares it, keeping the real name and the real
        record - nothing invented - rather than dropping any of them."""
        if not records:
            return {}
        named = dict(self._con.execute("""
            SELECT f.record, l.text
            FROM facts f
            JOIN labels l ON l.tag = f.value AND l.locale = 'en'
            WHERE f.record = ANY(?) AND f.key = 'skillDisplayName'
        """, [records]).fetchall())
        labels = {record: named.get(record, record) for record in records}
        counts = Counter(labels.values())
        return {
            (label if counts[label] == 1 else f"{label} ({record})"): record
            for record, label in labels.items()
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
                req_level=req_level, rarity=rarity, domain=domain, slots=tuple(slots),
                source=source,
                stat_values=stat_values.get(record, {}),
                skill_boosts=skill_boosts.get(record, {}),
                mastery_boosts=mastery_boosts.get(record, {}),
                granted_skills=granted_skills.get(record, ()),
                conversions=conversions.get(record, ()))
            for record, group_key, name, item_level, req_level, rarity, domain, slots, source
            in rows
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
    for key in ("gear_types", "slots", "stat_families", "domains", "rarities", "expansions"):
        print(f"vocabulary[{key}]: {len(vocab[key])} token(s)")
    for key in ("masteries", "skills", "granted_skills"):
        print(f"vocabulary[{key}]: {len(vocab[key])} token(s)")

    masteries = vocab["masteries"]
    assert "Nightblade" in masteries, "expected the Nightblade mastery to resolve by name"
    print(f"masteries['Nightblade'] = {masteries['Nightblade']}")

    skills = vocab["skills"]
    named_skills = [name for name, record in skills.items() if name != record]
    unnamed_skills = [name for name, record in skills.items() if name == record]
    print(f"skills: {len(named_skills)} resolved to a display name, "
          f"{len(unnamed_skills)} addressable only by record path")
    assert "Amarasta's Blade Burst" in skills

    granted_skills = vocab["granted_skills"]
    named_granted = [name for name, record in granted_skills.items() if name != record]
    unnamed_granted = [name for name, record in granted_skills.items() if name == record]
    print(f"granted_skills: {len(named_granted)} resolved to a display name, "
          f"{len(unnamed_granted)} addressable only by record path")
    assert len(granted_skills) == 724, f"expected 724 granted-skill records, got {len(granted_skills)}"
    assert len(named_granted) == 616, (
        f"expected 616 resolved (named or disambiguated) entries, got {len(named_granted)}")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
    else:
        print("usage: gditems_duckdb.py --selftest", file=sys.stderr)
        sys.exit(2)
