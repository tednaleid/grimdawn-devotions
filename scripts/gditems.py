#!/usr/bin/env -S uv run --script
# ABOUTME: Command-line entry point for the item query CLI: flag parsing, vocabulary-backed
# ABOUTME: name resolution, the `search`/`show`/`vocab` subcommands, table/JSON output, and --open.
# /// script
# requires-python = ">=3.10"
# dependencies = ["duckdb", "lzstring"]
# ///
"""Query the derived Grim Dawn item database.

Composition root: `main` resolves the two data directories, builds one
`DuckDbRepository`, and hands it to `run_search`/`run_show`/`run_vocab` rather than
letting those functions reach for a database themselves. That is what lets a later
task drive `run_search(repo, args)` with a fake repository in tests, with no parquet
involved.

Directory resolution (independently for `--derived-dir`/`--deposit-dir`): explicit flag,
then `GDITEMS_DERIVED_DIR`/`GDITEMS_DEPOSIT_DIR`, then a repo-relative default computed
from this script's own location. Both are always passed explicitly to `DuckDbRepository`
so moving one directory never silently pulls the other from its own fallback.

Name resolution for skill/mastery flags reads exactly the vocabulary key that belongs to
the flag it came from (`--boosts-skill`/`--mastery` never search `granted_skills`, and
`--grants-skill` never searches `skills`), because `skills` and `granted_skills` share
nine display names that point at different records - see `_resolve_name`. A raw
`records/...` path is always accepted too, since some skills carry no display name at
all.

An unrecognised token for any vocabulary-backed flag exits non-zero and names the near
matches from that flag's own vocabulary (`difflib.get_close_matches` - see
`_fail_unknown`), never another flag's, so a typo cannot be mistaken for an honest
zero-result query. A missing `data/derived` prints one fixed line naming the fix
(`just fetch-deposit`) and nothing else.

`search` renders as a table by default; `--json` renders the identical query as
structured JSON instead, both built from the same scored list (see `run_search`) so
they can never describe a query differently. `--open N` opens the Nth result's
grimtools URL through the module-level `open_url`, which defaults to
`webbrowser.open` and is replaced in tests so nothing actually launches. `show`
prints full detail for one item, resolved the same way ambiguous vocabulary names
are resolved elsewhere in this file: on more than one match it lists the candidates
and exits non-zero rather than guessing which one the caller meant. `--json` on
`show` emits the identical information as structured data instead of prose,
including the ambiguous-match candidate list, since the CLI's primary consumer is an
agent that should not have to parse prose to write a report.
"""
from __future__ import annotations

import argparse
import dataclasses
import difflib
import json
import os
import sys
import webbrowser
from pathlib import Path
from typing import NoReturn

sys.path.insert(0, str(Path(__file__).parent))
from gditems_core import (
    Criteria,
    StatCriterion,
    collapse_tiers,
    criteria_criterion_names,
    grimtools_url,
    score,
)
from gditems_duckdb import SOURCE_TOKENS, DuckDbRepository

REPO_ROOT = Path(__file__).resolve().parent.parent

HONESTY_LINE = ("Score reflects only the criteria you passed. "
                 "It ranks candidates and does not judge builds.")


# ---------------------------------------------------------------------------
# browser port
# ---------------------------------------------------------------------------

def open_url(url: str) -> None:
    """Module-level so tests can replace it and assert the URL without a browser."""
    webbrowser.open(url)


# ---------------------------------------------------------------------------
# argument parsing
# ---------------------------------------------------------------------------

def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="gditems.py", description="Query the derived Grim Dawn item database.")
    parser.add_argument("--derived-dir", default=None,
                         help="Derived-schema directory (else GDITEMS_DERIVED_DIR, "
                              "else <repo>/data/derived)")
    parser.add_argument("--deposit-dir", default=None,
                         help="Deposit directory, for labels (else GDITEMS_DEPOSIT_DIR, "
                              "else <repo>/data/deposit)")
    subparsers = parser.add_subparsers(dest="command", required=True)

    search = subparsers.add_parser("search", help="Search items by scope and criteria")

    scope = search.add_argument_group("scope (narrows the candidate set, does not score)")
    scope.add_argument("--domain", default=None,
                        help="Comma-separated: gear,augment,component,relic,...")
    scope.add_argument("--slot", default=None, help="Comma-separated slot tokens")
    scope.add_argument("--gear-type", default=None, help="Comma-separated gear-type tokens")
    scope.add_argument("--rarity", default=None, help="Comma-separated rarity tokens")
    scope.add_argument("--expansion", default=None, help="Comma-separated expansion tokens")
    scope.add_argument("--all-tiers", action="store_true",
                        help="Score every tier of a family separately, not just the "
                             "strongest usable one")
    scope.add_argument("--source", default=None, help="Comma-separated: vendor,crafted,unknown")
    scope.add_argument("--fits", default=None,
                        help="Gear-type token an augment/component must apply to")
    scope.add_argument("--level", type=int, default=None,
                        help="Exclude anything req_level exceeds; selects which tier shows")

    crit = search.add_argument_group("criteria (both filter and scored dimension)")
    crit.add_argument("--stat", action="append", default=[], metavar="FAMILY[:MIN]",
                       help="Repeatable. A stat family, optionally with a minimum, "
                            "e.g. damage.pierce:20")
    crit.add_argument("--resist", default=None,
                       help="Comma-separated resist types, sugar for the resist.<type> "
                            "stat family, e.g. pierce")
    crit.add_argument("--converts-to", default=None, help="Damage type conversions target")
    crit.add_argument("--min-convert", type=float, default=None)
    crit.add_argument("--grants-skill", default=None,
                       help="Comma-separated skill names or record paths (outright grants)")
    crit.add_argument("--boosts-skill", default=None,
                       help="Comma-separated skill names or record paths (skill bonus)")
    crit.add_argument("--boosts-mastery", default=None,
                       help="Comma-separated mastery names or record paths")
    crit.add_argument("--mastery", default=None,
                       help="Comma-separated mastery names or record paths; union of "
                            "boosting the mastery outright and any skill within it")

    out = search.add_argument_group("output")
    out.add_argument("--limit", type=int, default=20)
    out.add_argument("--json", action="store_true",
                      help="Print results as structured JSON instead of a table")
    out.add_argument("--explain", action="store_true",
                      help="Print the per-criterion score arithmetic")
    out.add_argument("--weights", default=None,
                      help="Comma-separated name=weight pairs; names match the criterion "
                           "labels --explain prints (a skill or mastery may also be "
                           "weighted by its record path), e.g. "
                           "stat:resist.pierce=2.0")
    out.add_argument("--open", type=int, default=None, metavar="N",
                      help="Open the Nth result's grimtools page in a browser")

    show = subparsers.add_parser(
        "show", help="Print full detail for one item")
    show.add_argument("name_or_record",
                       help="Exact item name, or an entities.record path")
    show.add_argument("--json", action="store_true",
                       help="Print item detail as structured JSON instead of prose")

    vocab = subparsers.add_parser("vocab", help="List valid tokens for every flag")
    vocab.add_argument("--json", action="store_true")

    return parser.parse_args(argv)


def _fail(message: str) -> NoReturn:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def _fail_unknown(flag: str, raw: str, valid) -> NoReturn:
    """Fail loudly on an unrecognised token for `flag`, naming near matches computed with
    `difflib.get_close_matches` against `valid` - that flag's own vocabulary, never
    another flag's (see the module docstring). Silence is the failure mode this guards
    against: an unknown token that filters to zero rows is otherwise indistinguishable
    from an honest "no items match"."""
    suggestions = difflib.get_close_matches(raw, list(valid), n=3, cutoff=0.6)
    hint = f" Did you mean: {', '.join(suggestions)}?" if suggestions else ""
    _fail(f"'{raw}' is not a known token for {flag}.{hint}")


def _validate_tokens(flag: str, tokens: tuple[str, ...], valid) -> None:
    for token in tokens:
        if token not in valid:
            _fail_unknown(flag, token, valid)


def _split_csv(value: str | None) -> tuple[str, ...]:
    if not value:
        return ()
    return tuple(v.strip() for v in value.split(",") if v.strip())


def _parse_stat(raw: str) -> StatCriterion:
    family, sep, min_str = raw.partition(":")
    minimum = float(min_str) if sep else None
    return StatCriterion(family=family, minimum=minimum)


def _stat_criteria(vocab: dict, raw_list: list[str]) -> list[StatCriterion]:
    stats = [_parse_stat(raw) for raw in raw_list]
    for stat in stats:
        if stat.family not in vocab["stat_families"]:
            _fail_unknown("--stat", stat.family, vocab["stat_families"])
    return stats


def _resist_stats(vocab: dict, value: str | None) -> list[StatCriterion]:
    """`--resist pierce` sugar, expanded through the vocabulary rather than a hardcoded
    resist-type list, so a family the curation drops or renames fails loudly instead of
    silently matching nothing."""
    resist_types = [family[len("resist."):] for family in vocab["stat_families"]
                     if family.startswith("resist.")]
    stats = []
    for resist_type in _split_csv(value):
        family = f"resist.{resist_type}"
        if family not in vocab["stat_families"]:
            _fail_unknown("--resist", resist_type, resist_types)
        stats.append(StatCriterion(family=family, minimum=None))
    return stats


def _parse_weights(value: str | None) -> dict[str, float] | None:
    if not value:
        return None
    weights: dict[str, float] = {}
    for pair in value.split(","):
        pair = pair.strip()
        if not pair:
            continue
        name, sep, weight_str = pair.partition("=")
        if not sep:
            _fail(f"--weights entry '{pair}' must be name=weight")
        try:
            weights[name.strip()] = float(weight_str)
        except ValueError:
            _fail(f"--weights entry '{pair}' has a non-numeric weight")
    return weights


def _normalise_weight_keys(weights: dict[str, float] | None,
                            labels: dict[str, str]) -> dict[str, float] | None:
    """Accept a `--weights` key in either form the CLI shows.

    Scoring keys on the internal criterion label, which for a skill or mastery carries a
    `records/...` path, so requiring that form would mean pasting a record path to weight
    a skill a caller named by display name. The display form the table and `--explain`
    print is translated back here. A key matching neither form passes through untouched
    so `_validate_weights` rejects it by name. Two criteria cannot share a display form:
    `_name_map` disambiguates duplicate names within a vocabulary key, and the criterion
    kind prefix separates the keys from each other.
    """
    if not weights:
        return weights
    by_display = {display: label for label, display in labels.items()}
    return {by_display.get(name, name): weight for name, weight in weights.items()}


def _validate_weights(criteria: Criteria, weights: dict[str, float] | None) -> None:
    """Fail loudly on a `--weights` name that names no scored criterion the caller
    actually passed. Weights are read with `dict.get(name, 1.0)` at scoring time
    (`gditems_core.score`), so an unrecognised name is otherwise a silent no-op that
    still exits 0 with an unweighted ranking - see the module docstring's rationale for
    `--weights` at all."""
    if not weights:
        return
    valid_names = criteria_criterion_names(criteria)
    for name in weights:
        if name not in valid_names:
            _fail_unknown("--weights", name, valid_names)


def _resolve_name(vocab_map: dict[str, str], flag: str, raw: str) -> str:
    """Resolve one caller-supplied token for `flag` against the vocabulary map that
    belongs to it (never any other key - see the module docstring).

    Three rules, each forced by something measured in the real data:
    1. A `records/...` path is always accepted directly, unresolved against the map at
       all, since some skills carry no display name to look up.
    2. An exact display-name match wins outright.
    3. Otherwise gather every key of the form `<raw> (<anything>)` (how the repository
       keys a name shared by more than one record within this key). Exactly one match
       resolves; several exit non-zero listing each candidate so the caller picks, since
       silently choosing one could point at the wrong record.
    """
    if raw.startswith("records/"):
        return raw
    if raw in vocab_map:
        return vocab_map[raw]
    prefix = f"{raw} ("
    candidates = sorted(name for name in vocab_map if name.startswith(prefix) and name.endswith(")"))
    if len(candidates) == 1:
        return vocab_map[candidates[0]]
    if len(candidates) > 1:
        print(f"ERROR: '{raw}' for {flag} is ambiguous. Candidates:", file=sys.stderr)
        for name in candidates:
            print(f"  {name}", file=sys.stderr)
        raise SystemExit(1)
    _fail_unknown(flag, raw, vocab_map.keys())


def _resolve_names(vocab_map: dict[str, str], flag: str, value: str | None) -> tuple[str, ...]:
    return tuple(_resolve_name(vocab_map, flag, name) for name in _split_csv(value))


def _build_criteria(vocab: dict, args: argparse.Namespace) -> Criteria:
    domains = _split_csv(args.domain)
    _validate_tokens("--domain", domains, vocab["domains"])
    slots = _split_csv(args.slot)
    _validate_tokens("--slot", slots, vocab["slots"])
    gear_types = _split_csv(args.gear_type)
    _validate_tokens("--gear-type", gear_types, vocab["gear_types"])
    rarities = _split_csv(args.rarity)
    _validate_tokens("--rarity", rarities, vocab["rarities"])
    expansions = _split_csv(args.expansion)
    _validate_tokens("--expansion", expansions, vocab["expansions"])
    sources = _split_csv(args.source)
    _validate_tokens("--source", sources, SOURCE_TOKENS)
    if args.fits is not None:
        _validate_tokens("--fits", (args.fits,), vocab["gear_types"])
    if args.converts_to is not None:
        _validate_tokens("--converts-to", (args.converts_to,), vocab["conversion_types"])
    if args.min_convert is not None and args.converts_to is None:
        _fail("--min-convert requires --converts-to")

    stats = _stat_criteria(vocab, args.stat)
    stats.extend(_resist_stats(vocab, args.resist))

    return Criteria(
        domains=domains,
        slots=slots,
        gear_types=gear_types,
        rarities=rarities,
        expansions=expansions,
        sources=sources,
        fits=args.fits,
        level=args.level,
        all_tiers=args.all_tiers,
        stats=tuple(stats),
        converts_to=args.converts_to,
        min_convert=args.min_convert,
        grants_skills=_resolve_names(vocab["granted_skills"], "--grants-skill", args.grants_skill),
        boosts_skills=_resolve_names(vocab["skills"], "--boosts-skill", args.boosts_skill),
        boosts_masteries=_resolve_names(vocab["masteries"], "--boosts-mastery", args.boosts_mastery),
        masteries=_resolve_names(vocab["masteries"], "--mastery", args.mastery),
        limit=args.limit,
    )


# ---------------------------------------------------------------------------
# search
# ---------------------------------------------------------------------------

def _unmatched_criteria(criteria: Criteria, scored_pool: list) -> list[str]:
    """Name every scored criterion nobody in the pool satisfies at all (raw value zero
    for every candidate), computed against the full pool before --limit truncates it, so
    a criterion that only the 21st-best candidate happens to hit is not misreported as
    matched by nobody. See `gditems_core.criteria_criterion_names` for the label format
    and `gditems_core.score` for why a non-matching candidate stays in the list scored
    at zero instead of being dropped, which is what this reads."""
    matched = {p.name for item in scored_pool for p in item.parts if p.raw > 0}
    return [name for name in criteria_criterion_names(criteria) if name not in matched]


def run_search(repo, args: argparse.Namespace) -> dict:
    """Fetch, collapse to tiers, and score. Callable with any object structurally
    matching the repository port (fetch/vocabulary/find), so a fake repo can drive this
    with no database. Both the table and the JSON renderer are built from this single
    result, so they cannot describe the same query differently."""
    vocab = repo.vocabulary()
    criteria = _build_criteria(vocab, args)
    labels = _criterion_labels(vocab, criteria)
    weights = _normalise_weight_keys(_parse_weights(args.weights), labels)
    _validate_weights(criteria, weights)

    candidates = repo.fetch(criteria)
    groups = collapse_tiers(candidates, criteria.level)

    family_of: dict[str, list] = {}
    for group in groups:
        for cand in group:
            family_of[cand.record] = group

    if criteria.all_tiers:
        pool = [cand for group in groups for cand in group]
    else:
        pool = [group[0] for group in groups]

    scored_pool = score(pool, criteria, weights)
    scored = scored_pool[:criteria.limit]

    results = [
        {"rank": rank, "scored": item, "tiers": family_of[item.candidate.record],
         "url": grimtools_url(item.candidate.name, item.candidate.item_level)}
        for rank, item in enumerate(scored, start=1)
    ]
    return {"results": results, "disclaimer": HONESTY_LINE, "criteria": criteria,
            "weights": weights or {}, "labels": labels,
            "unmatched_criteria": _unmatched_criteria(criteria, scored_pool)}


def _tier_levels(tiers: list) -> str:
    """Render a family's tier ladder as the item levels the data actually carries.

    Grim Dawn's own game data gives every tier of a family the same display name -
    checked directly against Sellecor's March: all three tiers are named "Sellecor's
    March" in labels.parquet, is_empowered is False on all three - and the words
    base/Empowered/Mythical are grimtools' own display convention, not present in this
    data at all. A two-tier family can be an ordinary Rare item (measured: 208 two-tier
    and 583 more-than-three-tier families among Rare gear alone), so applying those
    words by rank position would assert a specific in-game upgrade tier that may not
    exist. Item level is real and already the ladder's own sort key, so it is the only
    thing shown.
    """
    ascending = sorted(tiers, key=lambda c: c.item_level)
    return " / ".join(str(c.item_level) for c in ascending)


def _ladder(tiers: list, headline_level: int) -> str:
    """A search result's tier ladder: `_tier_levels` plus which tier the row above is
    scored against, since search always headlines one tier per family."""
    return f"{_tier_levels(tiers)} (showing {headline_level})"


def _grimtools_url_or_none(name: str, item_level: int) -> str | None:
    """`grimtools_url`, but None for an empty name instead of raising: `show` can
    resolve a nameless record by its own record path (a legitimate use, see
    `gditems_duckdb.DuckDbRepository.find`'s docstring), and such a record has no link
    grimtools could ever isolate it by."""
    return grimtools_url(name, item_level) if name else None


def _fmt_num(value: float) -> str:
    return f"{value:g}"


def _reverse_map(vocab_map: dict[str, str]) -> dict[str, str]:
    return {record: name for name, record in vocab_map.items()}


# Criterion kind -> the one vocabulary key whose flag produces it. Skill and mastery
# criteria carry a `records/...` path in their label because that is what `Criteria`
# matches on, so rendering one verbatim would echo an internal path back at a reader who
# typed a display name. Each kind is translated through the same key `_resolve_name` used
# to resolve it (never any other - see the gditems_duckdb module docstring on the nine
# display names shared between `skills` and `granted_skills`).
_CRITERION_VOCAB_KEY = {
    "grants_skill": "granted_skills",
    "boosts_skill": "skills",
    "boosts_mastery": "masteries",
    "mastery": "masteries",
}


def _criterion_labels(vocab: dict, criteria: Criteria) -> dict[str, str]:
    """Map each scored criterion's internal label to its display form.

    `stat` and `converts_to` targets are already display tokens and pass through. A skill
    or mastery record with no display name in the data keeps its record path, which is the
    honest rendering for the 46 of 245 boost targets that genuinely carry no name (for
    example `records/skills/playerclass01/cadence3.dbr`, a hidden buff-carrier record with
    no skillDisplayName fact at all). Guessing a name from the file stem would invent one.
    """
    reversed_by_kind = {kind: _reverse_map(vocab[key])
                        for kind, key in _CRITERION_VOCAB_KEY.items()}
    labels = {}
    for label in criteria_criterion_names(criteria):
        kind, _, target = label.partition(":")
        display = reversed_by_kind.get(kind, {}).get(target, target)
        labels[label] = f"{kind}:{display}"
    return labels


def _pretty_name(name: str, labels: dict[str, str] | None = None) -> str:
    kind, sep, target = (labels or {}).get(name, name).partition(":")
    if not sep:
        return name
    if kind == "stat":
        return target
    return f"{kind.replace('_', ' ')} {target}"


def _matched_summary(scored, labels: dict[str, str] | None = None) -> str:
    matched = [f"{_pretty_name(p.name, labels)}={_fmt_num(p.raw)}"
               for p in scored.parts if p.raw > 0]
    return ", ".join(matched) if matched else "none matched"


def _explain_lines(scored, labels: dict[str, str] | None = None) -> list[str]:
    lines = []
    for p in scored.parts:
        note = f" ({p.note})" if p.note else ""
        lines.append(f"     {_pretty_name(p.name, labels)}: raw={_fmt_num(p.raw)} "
                      f"normalised={p.normalised:.2f} weight={_fmt_num(p.weight)} "
                      f"contributes={p.normalised * p.weight:.2f}{note}")
    return lines


def render_table(payload: dict, explain: bool = False) -> str:
    lines: list[str] = []
    labels = payload["labels"]
    for result in payload["results"]:
        scored = result["scored"]
        cand = scored.candidate
        tiers = result["tiers"]
        lines.append(f"{result['rank']}. {cand.name}  score {scored.total:.2f}")
        lines.append(f"   matched: {_matched_summary(scored, labels)}")
        if explain:
            lines.extend(_explain_lines(scored, labels))
        lines.append(f"   item level {cand.item_level}, req level {cand.req_level}, "
                      f"{cand.domain}, source: {cand.source}")
        if len(tiers) > 1:
            lines.append(f"   tiers: {_ladder(tiers, cand.item_level)}")
        lines.append(f"   {result['url']}")
    if payload["unmatched_criteria"]:
        pretty = ", ".join(_pretty_name(name, labels)
                            for name in payload["unmatched_criteria"])
        lines.append("")
        lines.append(f"Unmatched criteria (matched nothing in the pool): {pretty}")
    lines.append("")
    lines.append(HONESTY_LINE)
    return "\n".join(lines)


def _json_result(result: dict, labels: dict[str, str]) -> dict:
    scored = result["scored"]
    cand = scored.candidate
    ascending_tiers = sorted(result["tiers"], key=lambda c: c.item_level)
    return {
        "rank": result["rank"],
        "name": cand.name,
        "record": cand.record,
        "item_level": cand.item_level,
        "req_level": cand.req_level,
        "rarity": cand.rarity,
        "domain": cand.domain,
        "slots": list(cand.slots),
        "source": cand.source,
        "score": scored.total,
        # `name` stays the internal label (it is the --weights key and the value echoed in
        # `unmatched_criteria`); `display` is the same criterion with skill and mastery
        # records resolved back to the name the caller typed.
        "parts": [
            {"name": p.name, "display": labels.get(p.name, p.name), "raw": p.raw,
             "normalised": p.normalised, "weight": p.weight, "note": p.note}
            for p in scored.parts
        ],
        "tiers": [c.item_level for c in ascending_tiers],
        "url": result["url"],
    }


def render_json(payload: dict) -> str:
    """Same query, same result set as `render_table` - see `run_search`'s docstring.
    `criteria` echoes what was actually parsed (post name-resolution) so a caller can
    confirm intent; `weights` echoes the effective `--weights` map (empty if none were
    passed) since weights are not part of `Criteria` and would otherwise be invisible in
    this echo even though they change the ranking; `disclaimer` repeats the honesty line
    so a caller reading only the JSON still sees it."""
    data = {
        "criteria": dataclasses.asdict(payload["criteria"]),
        "weights": payload["weights"],
        "results": [_json_result(r, payload["labels"]) for r in payload["results"]],
        "unmatched_criteria": payload["unmatched_criteria"],
        "disclaimer": payload["disclaimer"],
    }
    return json.dumps(data, indent=2)


# ---------------------------------------------------------------------------
# show
# ---------------------------------------------------------------------------

def run_show(repo, name_or_record: str) -> dict:
    """Resolve `name_or_record` through the same repository port `search` uses
    (repo.find), to exactly one candidate, and gather everything known about it.

    Never exits and never prints: an absent or ambiguous name comes back as an
    `"error"` payload (with a `"candidates"` list, empty for the absent case) so the
    caller can report it in whichever format `--json` asked for - text on stderr, or
    the same information as structured JSON - rather than only ever as prose (see the
    module docstring). Ambiguity is a name resolving to more than one record: a
    family's several tiers, or two families sharing a display name, both real in this
    data (see the module docstring's Sellecor's March example). The caller must pick
    one, typically by record path, rather than the CLI guessing which one was meant.

    On success, `tiers` is every record in the resolved candidate's own family
    (`repo.tiers(candidate.group_key)`), NOT every record sharing its display name.
    Display names collide across unrelated families (measured 2026-08-01: "Massacre"
    names both a relic and an unrelated two-handed axe), so a name-based lookup here
    would silently blend another family's item levels into this one's ladder - a
    confirmed bug this docstring used to describe as intentional. group_key is the
    real family identity and is already on the resolved Candidate."""
    matches = repo.find(name_or_record)
    if not matches:
        return {"error": f"no item found for '{name_or_record}'", "candidates": []}
    if len(matches) > 1:
        ordered = sorted(matches, key=lambda c: (c.item_level, c.record))
        return {
            "error": f"'{name_or_record}' matches more than one item",
            "candidates": [{"record": c.record, "item_level": c.item_level} for c in ordered],
        }
    candidate = matches[0]
    tiers = repo.tiers(candidate.group_key)
    return {"candidate": candidate, "set_name": repo.set_name(candidate.record),
            "vocab": repo.vocabulary(), "tiers": tiers}


def render_show(payload: dict) -> str:
    cand = payload["candidate"]
    vocab = payload["vocab"]
    tiers = payload["tiers"]
    skill_names = _reverse_map(vocab["skills"])
    mastery_names = _reverse_map(vocab["masteries"])
    granted_names = _reverse_map(vocab["granted_skills"])

    lines = [cand.name, f"  record: {cand.record}"]
    lines.append(f"  item level {cand.item_level}, req level {cand.req_level}, "
                  f"rarity {cand.rarity}, {cand.domain}, source: {cand.source}")
    if cand.slots:
        lines.append(f"  slots: {', '.join(cand.slots)}")
    if payload["set_name"]:
        lines.append(f"  set: {payload['set_name']}")
    if len(tiers) > 1:
        lines.append(f"  tiers: {_tier_levels(tiers)}")
    url = _grimtools_url_or_none(cand.name, cand.item_level)
    lines.append(f"  grimtools: {url}" if url else
                  "  grimtools: no link (item has no display name)")

    lines.append("")
    lines.append("Stats:")
    if cand.stat_values:
        for family in sorted(cand.stat_values):
            lines.append(f"  {family}: {_fmt_num(cand.stat_values[family])}")
    else:
        lines.append("  none")

    lines.append("")
    lines.append("Skill boosts:")
    if cand.skill_boosts:
        for target in sorted(cand.skill_boosts):
            lines.append(f"  {skill_names.get(target, target)}: +{cand.skill_boosts[target]}")
    else:
        lines.append("  none")

    lines.append("")
    lines.append("Mastery boosts:")
    if cand.mastery_boosts:
        for target in sorted(cand.mastery_boosts):
            lines.append(f"  {mastery_names.get(target, target)}: +{cand.mastery_boosts[target]}")
    else:
        lines.append("  none")

    lines.append("")
    lines.append("Granted skills:")
    if cand.granted_skills:
        for target in sorted(cand.granted_skills):
            lines.append(f"  {granted_names.get(target, target)}")
    else:
        lines.append("  none")

    lines.append("")
    lines.append("Conversions:")
    if cand.conversions:
        for from_type, to_type, percent in cand.conversions:
            lines.append(f"  {from_type} -> {to_type}: {_fmt_num(percent)}%")
    else:
        lines.append("  none")

    return "\n".join(lines)


def _json_show(payload: dict) -> dict:
    cand = payload["candidate"]
    vocab = payload["vocab"]
    skill_names = _reverse_map(vocab["skills"])
    mastery_names = _reverse_map(vocab["masteries"])
    granted_names = _reverse_map(vocab["granted_skills"])
    ascending_tiers = sorted(payload["tiers"], key=lambda c: c.item_level)
    return {
        "name": cand.name,
        "record": cand.record,
        "item_level": cand.item_level,
        "req_level": cand.req_level,
        "rarity": cand.rarity,
        "domain": cand.domain,
        "slots": list(cand.slots),
        "source": cand.source,
        "set": payload["set_name"],
        "stats": dict(cand.stat_values),
        "skill_boosts": {skill_names.get(target, target): level
                          for target, level in cand.skill_boosts.items()},
        "mastery_boosts": {mastery_names.get(target, target): level
                            for target, level in cand.mastery_boosts.items()},
        "granted_skills": [granted_names.get(target, target) for target in cand.granted_skills],
        "conversions": [{"from": from_type, "to": to_type, "percent": percent}
                         for from_type, to_type, percent in cand.conversions],
        "tiers": [c.item_level for c in ascending_tiers],
        "url": _grimtools_url_or_none(cand.name, cand.item_level),
    }


def render_show_json(payload: dict) -> str:
    """Same information `render_show` prints, as structured data instead of prose: stats,
    skill and mastery boosts, conversions, source, set membership, the tier ladder, and
    the grimtools URL (null for a nameless record - see `_grimtools_url_or_none`) - so
    an agent asking for one item's detail does not have to parse prose (see the module
    docstring)."""
    return json.dumps(_json_show(payload), indent=2)


# ---------------------------------------------------------------------------
# vocab
# ---------------------------------------------------------------------------

def run_vocab(repo) -> dict:
    vocab = repo.vocabulary()

    def names(key: str) -> list[str]:
        # Drop the self-keyed record-path fallback: those are addressable directly
        # (fact 4) but are not tokens a caller would type into `vocab`.
        return sorted(name for name, record in vocab[key].items() if name != record)

    return {
        "domains": vocab["domains"],
        "gear_types": vocab["gear_types"],
        "slots": vocab["slots"],
        "rarities": vocab["rarities"],
        "expansions": vocab["expansions"],
        "stat_families": vocab["stat_families"],
        "conversion_types": vocab["conversion_types"],
        "masteries": names("masteries"),
        "skills": names("skills"),
        "granted_skills": names("granted_skills"),
    }


def render_vocab_table(payload: dict) -> str:
    lines: list[str] = []
    for category, tokens in payload.items():
        lines.append(f"{category}:")
        lines.extend(f"  {token}" for token in tokens)
        lines.append("")
    return "\n".join(lines).rstrip("\n")


# ---------------------------------------------------------------------------
# directory resolution + entry point
# ---------------------------------------------------------------------------

def _resolve_dir(explicit: str | None, env_var: str, default_subdir: str) -> Path:
    if explicit is not None:
        return Path(explicit)
    env_value = os.environ.get(env_var)
    if env_value:
        return Path(env_value)
    return REPO_ROOT / "data" / default_subdir


def _handle_open(results: list[dict], n: int) -> None:
    """Open the Nth result (1-indexed, matching the rank the table prints) through
    `open_url`. Validated against the actual result count rather than trusting the
    caller's N, since a caller reading a table that stopped at --limit could otherwise
    ask for a rank that was never fetched."""
    if not (1 <= n <= len(results)):
        _fail(f"--open {n} is out of range: {len(results)} result(s)")
    open_url(results[n - 1]["url"])


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)

    derived_dir = _resolve_dir(args.derived_dir, "GDITEMS_DERIVED_DIR", "derived")
    deposit_dir = _resolve_dir(args.deposit_dir, "GDITEMS_DEPOSIT_DIR", "deposit")
    if not derived_dir.is_dir():
        # Exact, fixed text regardless of where derived_dir actually resolved from -
        # nothing else - so this is reliably grep-able and never buries the fix under
        # an absolute-path echo.
        print("data/derived not found. Run: just fetch-deposit", file=sys.stderr)
        return 2
    repo = DuckDbRepository(derived_dir, deposit_dir)

    if args.command == "vocab":
        payload = run_vocab(repo)
        print(json.dumps(payload, indent=2) if args.json else render_vocab_table(payload))
        return 0

    if args.command == "search":
        payload = run_search(repo, args)
        if args.open is not None:
            _handle_open(payload["results"], args.open)
        if args.json:
            print(render_json(payload))
        else:
            print(render_table(payload, explain=args.explain))
        return 0

    if args.command == "show":
        payload = run_show(repo, args.name_or_record)
        if "error" in payload:
            if args.json:
                print(json.dumps({"error": payload["error"], "candidates": payload["candidates"]},
                                  indent=2), file=sys.stderr)
            else:
                suffix = ":" if payload["candidates"] else ""
                print(f"ERROR: {payload['error']}{suffix}", file=sys.stderr)
                for c in payload["candidates"]:
                    print(f"  {c['record']}  (item level {c['item_level']})", file=sys.stderr)
            return 1
        print(render_show_json(payload) if args.json else render_show(payload))
        return 0

    return 2


if __name__ == "__main__":
    raise SystemExit(main())
