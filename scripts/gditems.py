#!/usr/bin/env -S uv run --script
# ABOUTME: Command-line entry point for the item query CLI: flag parsing, vocabulary-backed
# ABOUTME: name resolution, the `search` and `vocab` subcommands, and the human-readable table.
# /// script
# requires-python = ">=3.10"
# dependencies = ["duckdb", "lzstring"]
# ///
"""Query the derived Grim Dawn item database.

Composition root: `main` resolves the two data directories, builds one
`DuckDbRepository`, and hands it to `run_search`/`run_vocab` rather than letting those
functions reach for a database themselves. That is what lets a later task drive
`run_search(repo, args)` with a fake repository in tests, with no parquet involved.

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

Table output only; `--json`, `show`, and `--open` are later tasks. `--json`/`--open` are
still parsed here (so the flag surface matches the spec) but fail loudly rather than
silently falling back to the table, since a caller who asked for JSON and got a table
would be a confident wrong answer, not an honest error.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from gditems_core import Criteria, StatCriterion, collapse_tiers, grimtools_url, score
from gditems_duckdb import DuckDbRepository

REPO_ROOT = Path(__file__).resolve().parent.parent

HONESTY_LINE = ("Score reflects only the criteria you passed. "
                 "It ranks candidates and does not judge builds.")

# Positional labels for a tier ladder, lowest item level first. Grim Dawn's own game data
# gives every tier of a family the same display name (checked directly against Sellecor's
# March: all three tiers are named "Sellecor's March" in labels.parquet, is_empowered is
# False on all three) so these words are NOT read from the data - they are the same
# base/Empowered/Mythical convention the design spec itself uses for "the ladder", applied
# by rank position. A family deeper than three tiers (not seen among real tiered gear;
# large group_key collisions in the data are unrelated same-named common drops, not a real
# ladder) falls back to a plain ordinal rather than inventing a fourth tier name.
_TIER_LABELS = ("base", "Empowered", "Mythical")


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
                      help="Not yet implemented (a later task)")
    out.add_argument("--explain", action="store_true",
                      help="Print the per-criterion score arithmetic")
    out.add_argument("--weights", default=None,
                      help="Comma-separated name=weight pairs; names match the criterion "
                           "labels --explain prints, e.g. stat:resist.pierce=2.0")
    out.add_argument("--open", type=int, default=None,
                      help="Not yet implemented (a later task)")

    vocab = subparsers.add_parser("vocab", help="List valid tokens for every flag")
    vocab.add_argument("--json", action="store_true")

    return parser.parse_args(argv)


def _fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def _split_csv(value: str | None) -> tuple[str, ...]:
    if not value:
        return ()
    return tuple(v.strip() for v in value.split(",") if v.strip())


def _parse_stat(raw: str) -> StatCriterion:
    family, sep, min_str = raw.partition(":")
    minimum = float(min_str) if sep else None
    return StatCriterion(family=family, minimum=minimum)


def _resist_stats(vocab: dict, value: str | None) -> list[StatCriterion]:
    """`--resist pierce` sugar, expanded through the vocabulary rather than a hardcoded
    resist-type list, so a family the curation drops or renames fails loudly instead of
    silently matching nothing."""
    stats = []
    for resist_type in _split_csv(value):
        family = f"resist.{resist_type}"
        if family not in vocab["stat_families"]:
            _fail(f"'{resist_type}' is not a known resist type "
                  f"(looked for stat family '{family}' in the vocabulary)")
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
    _fail(f"'{raw}' is not a known token for {flag}")


def _resolve_names(vocab_map: dict[str, str], flag: str, value: str | None) -> tuple[str, ...]:
    return tuple(_resolve_name(vocab_map, flag, name) for name in _split_csv(value))


def _build_criteria(vocab: dict, args: argparse.Namespace) -> Criteria:
    stats = [_parse_stat(s) for s in args.stat]
    stats.extend(_resist_stats(vocab, args.resist))
    return Criteria(
        domains=_split_csv(args.domain),
        slots=_split_csv(args.slot),
        gear_types=_split_csv(args.gear_type),
        rarities=_split_csv(args.rarity),
        expansions=_split_csv(args.expansion),
        sources=_split_csv(args.source),
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

def run_search(repo, args: argparse.Namespace) -> dict:
    """Fetch, collapse to tiers, and score. Callable with any object structurally
    matching the repository port (fetch/vocabulary/find), so a fake repo can drive this
    with no database."""
    vocab = repo.vocabulary()
    criteria = _build_criteria(vocab, args)
    weights = _parse_weights(args.weights)

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

    scored = score(pool, criteria, weights)[:criteria.limit]

    results = [
        {"rank": rank, "scored": item, "tiers": family_of[item.candidate.record],
         "url": grimtools_url(item.candidate.name, item.candidate.item_level)}
        for rank, item in enumerate(scored, start=1)
    ]
    return {"results": results, "disclaimer": HONESTY_LINE}


def _tier_index(record: str, tiers: list) -> int:
    ascending = sorted(tiers, key=lambda c: c.item_level)
    return next(i for i, c in enumerate(ascending) if c.record == record)


def _tier_label(index: int) -> str:
    if index < len(_TIER_LABELS):
        return _TIER_LABELS[index]
    return f"tier {index + 1}"


def _ladder(tiers: list) -> str:
    ascending = sorted(tiers, key=lambda c: c.item_level)
    return " / ".join(f"{_tier_label(i)} {c.item_level}" for i, c in enumerate(ascending))


def _fmt_num(value: float) -> str:
    return f"{value:g}"


def _pretty_name(name: str) -> str:
    kind, sep, target = name.partition(":")
    if not sep:
        return name
    if kind == "stat":
        return target
    return f"{kind.replace('_', ' ')} {target}"


def _matched_summary(scored) -> str:
    matched = [f"{_pretty_name(p.name)}={_fmt_num(p.raw)}" for p in scored.parts if p.raw > 0]
    return ", ".join(matched) if matched else "none matched"


def _explain_lines(scored) -> list[str]:
    lines = []
    for p in scored.parts:
        note = f" ({p.note})" if p.note else ""
        lines.append(f"     {_pretty_name(p.name)}: raw={_fmt_num(p.raw)} "
                      f"normalised={p.normalised:.2f} weight={_fmt_num(p.weight)} "
                      f"contributes={p.normalised * p.weight:.2f}{note}")
    return lines


def render_table(payload: dict, explain: bool = False) -> str:
    lines: list[str] = []
    for result in payload["results"]:
        scored = result["scored"]
        cand = scored.candidate
        tiers = result["tiers"]
        index = _tier_index(cand.record, tiers)
        lines.append(f"{result['rank']}. {cand.name}  score {scored.total:.2f}")
        lines.append(f"   matched: {_matched_summary(scored)}")
        if explain:
            lines.extend(_explain_lines(scored))
        lines.append(f"   {_tier_label(index)} tier, item level {cand.item_level}, "
                      f"req level {cand.req_level}, source: {cand.source}")
        if len(tiers) > 1:
            lines.append(f"   tiers: {_ladder(tiers)}")
        lines.append(f"   {result['url']}")
    lines.append("")
    lines.append(HONESTY_LINE)
    return "\n".join(lines)


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


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)

    derived_dir = _resolve_dir(args.derived_dir, "GDITEMS_DERIVED_DIR", "derived")
    deposit_dir = _resolve_dir(args.deposit_dir, "GDITEMS_DEPOSIT_DIR", "deposit")
    if not derived_dir.is_dir():
        print(f"ERROR: {derived_dir} not found. Run: just fetch-deposit", file=sys.stderr)
        return 2
    repo = DuckDbRepository(derived_dir, deposit_dir)

    if args.command == "vocab":
        payload = run_vocab(repo)
        print(json.dumps(payload, indent=2) if args.json else render_vocab_table(payload))
        return 0

    if args.command == "search":
        if args.json:
            _fail("--json for search is not implemented yet")
        if args.open is not None:
            _fail("--open is not implemented yet")
        payload = run_search(repo, args)
        print(render_table(payload, explain=args.explain))
        return 0

    return 2


if __name__ == "__main__":
    raise SystemExit(main())
