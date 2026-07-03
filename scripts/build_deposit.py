#!/usr/bin/env -S uv run --script
# ABOUTME: Builds the raw Grim Dawn data deposit (facts/labels/meta parquet) from the extracted
# ABOUTME: records tree, plus `census` and `query` subcommands for inspecting it with DuckDB.
# /// script
# requires-python = ">=3.10"
# dependencies = ["duckdb"]
# ///
"""Raw game-data deposit: lossless long-format extraction of the full records/ tree.

Three parquet artifacts (see docs/deposit.md):
  facts.parquet   one row per key,value line of every .dbr, in file order:
                  (record, idx, key, value, value_num). Duplicate keys within a
                  record are preserved as separate rows (idx orders them).
  labels.parquet  (locale, tag, text) - the FULL tag table of every extracted
                  language (unfiltered; filtering to referenced tags is a
                  web-payload concern, not an analyst one).
  meta.parquet    key/value provenance: steam build id, counts, locale coverage.

Subcommands:
  build    regenerate the deposit from an extracted tree (`just deposit`)
  census   schema census report per record category (`just census`)
  query    run SQL with facts/labels/meta views (`just q "..."`); --fail-on-empty
           makes an empty result exit non-zero (acceptance recipes).

Kept self-contained (only trivial helpers imported from parse_devotions) so it
can lift to a separate repo if the deposit outgrows this one.
"""
from __future__ import annotations

import argparse
import csv
import datetime as _dt
import json
import sys
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).parent))
from parse_devotions import clean_text, load_translations  # shared trivial helpers

# Label text spans 13 locales; a cp1252 Windows console must not crash the printer.
for _stream in (sys.stdout, sys.stderr):
    _stream.reconfigure(encoding="utf-8", errors="replace")

SCHEMA_VERSION = "1"
# Sentinel so DuckDB's read_csv never turns an empty .dbr value into NULL (losslessness).
NULLSTR = "\\N{deposit-null}"


def utc_now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sql_str(s: str) -> str:
    """Quote a string (e.g. a path) as a SQL literal."""
    return "'" + str(s).replace("'", "''") + "'"


def iter_dbr_lines(path: Path):
    """Yield (idx, key, value) for every key,value line of one .dbr, in file order.

    Same first-comma split as parse_devotions.read_dbr, but order-preserving and
    duplicate-key-preserving: read_dbr returns a dict, which silently keeps only
    the last occurrence of a repeated key - a losslessness violation here.
    """
    try:
        text = path.read_text(encoding="utf-8-sig", errors="replace")
    except OSError:
        return
    idx = 0
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
        yield idx, key, value
        idx += 1


def file_size_str(p: Path) -> str:
    n = p.stat().st_size
    if n >= 1 << 20:
        return f"{n / (1 << 20):.1f} MB"
    return f"{n / (1 << 10):.1f} KB"


# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------

def cmd_build(args) -> int:
    records_dir = args.records_dir.resolve()
    text_root = args.text_root.resolve()
    out_dir = args.out_dir.resolve()

    if not (records_dir / "records").is_dir():
        print(f"ERROR: no extracted records under {records_dir}", file=sys.stderr)
        print("Run `just extract` first (Windows, game closed).", file=sys.stderr)
        return 2

    if not args.steam_buildid:
        print("WARNING: no Steam build id supplied; meta will record it as empty. "
              "Provenance of this deposit will be untraceable - check that "
              "appmanifest_219990.acf is readable next to the game install.")

    out_dir.mkdir(parents=True, exist_ok=True)
    facts_csv = out_dir / "_facts_tmp.csv"
    labels_csv = out_dir / "_labels_tmp.csv"

    # --- facts: walk every .dbr in deterministic order --------------------
    files = sorted(records_dir.rglob("*.dbr"),
                   key=lambda p: p.relative_to(records_dir).as_posix())
    files_scanned = zero_row_files = facts_rows = 0
    with facts_csv.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(["record", "idx", "key", "value"])
        for fp in files:
            rel = fp.relative_to(records_dir).as_posix()
            n = 0
            for idx, key, value in iter_dbr_lines(fp):
                w.writerow([rel, idx, key, value])
                n += 1
            files_scanned += 1
            facts_rows += n
            if n == 0:
                zero_row_files += 1

    # --- labels: every extracted text_<locale> dir, full tag table --------
    text_dirs = sorted(d for d in text_root.glob("text_*") if d.is_dir())
    if not text_dirs:
        print(f"WARNING: no extracted text_* directories under {text_root}; "
              "labels.parquet will be empty. Run `just extract` (en) and "
              "`just i18n-tables` (all other languages).")
    # Locales the repo knows about (committed game tables) but that have no
    # extracted text dir are a coverage gap, warned and reported (R3).
    locales_missing: list[str] = []
    if args.i18n_dir and args.i18n_dir.is_dir():
        expected = {p.name[len("game."):-len(".json")] for p in args.i18n_dir.glob("game.*.json")}
        found = {d.name[len("text_"):] for d in text_dirs}
        locales_missing = sorted(expected - found)
        if locales_missing:
            print(f"WARNING: no extracted text for {' '.join(locales_missing)} "
                  f"(expected from {args.i18n_dir.name}/game.<locale>.json); "
                  "run `just i18n-tables` to extract them.")
    records_mtime = records_dir.stat().st_mtime
    locale_counts: dict[str, int] = {}
    locales_skipped: list[str] = []
    locales_stale: list[str] = []
    labels_rows = 0
    with labels_csv.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(["locale", "tag", "text"])
        for tdir in text_dirs:
            locale = tdir.name[len("text_"):]
            if tdir.stat().st_mtime < records_mtime:
                locales_stale.append(locale)
            tags = load_translations(tdir)
            if not tags:
                print(f"WARNING: locale '{locale}' has no readable tags under {tdir}; skipped.")
                locales_skipped.append(locale)
                continue
            for tag in sorted(tags):
                w.writerow([locale, tag, clean_text(tags[tag])])
            locale_counts[locale] = len(tags)
            labels_rows += len(tags)
    if locales_stale:
        print(f"WARNING: text for {' '.join(locales_stale)} is older than the extracted records - "
              "likely stale after a patch. Refresh flow: `just extract`, then "
              "`just i18n-tables`, then `just deposit`.")

    # --- parquet via DuckDB ------------------------------------------------
    facts_pq = out_dir / "facts.parquet"
    labels_pq = out_dir / "labels.parquet"
    meta_pq = out_dir / "meta.parquet"
    con = duckdb.connect()
    csv_opts = (f"header=true, delim=',', quote='\"', escape='\"', "
                f"nullstr={sql_str(NULLSTR)}")
    con.execute(
        f"COPY (SELECT record, idx, key, value, TRY_CAST(value AS DOUBLE) AS value_num "
        f"FROM read_csv({sql_str(facts_csv.as_posix())}, {csv_opts}, "
        f"columns={{'record':'VARCHAR','idx':'INTEGER','key':'VARCHAR','value':'VARCHAR'}}) "
        f"ORDER BY record, idx) "
        f"TO {sql_str(facts_pq.as_posix())} (FORMAT parquet, COMPRESSION zstd)")
    con.execute(
        f"COPY (SELECT locale, tag, text "
        f"FROM read_csv({sql_str(labels_csv.as_posix())}, {csv_opts}, "
        f"columns={{'locale':'VARCHAR','tag':'VARCHAR','text':'VARCHAR'}}) "
        f"ORDER BY locale, tag) "
        f"TO {sql_str(labels_pq.as_posix())} (FORMAT parquet, COMPRESSION zstd)")

    buildid = args.steam_buildid or ""
    meta_rows = [
        ("schema_version", SCHEMA_VERSION),
        ("steam_buildid", buildid),
        ("facts_buildid", buildid),
        ("labels_buildid", buildid),
        ("game_version", args.game_version),
        ("generated_utc", utc_now()),
        ("facts_files", str(files_scanned)),
        ("facts_zero_row_files", str(zero_row_files)),
        ("facts_rows", str(facts_rows)),
        ("labels_rows", str(labels_rows)),
        ("locales_built", " ".join(sorted(locale_counts))),
        ("locales_missing", " ".join(locales_missing)),
        ("locales_skipped", " ".join(locales_skipped)),
        ("locales_stale", " ".join(locales_stale)),
        ("locale_tag_counts", json.dumps(locale_counts, sort_keys=True)),
    ]
    con.execute("CREATE TABLE meta (key VARCHAR, value VARCHAR)")
    con.executemany("INSERT INTO meta VALUES (?, ?)", meta_rows)
    con.execute(f"COPY meta TO {sql_str(meta_pq.as_posix())} (FORMAT parquet, COMPRESSION zstd)")
    con.close()
    facts_csv.unlink()
    labels_csv.unlink()

    print("\n=== DEPOSIT SUMMARY ===")
    print(f"  records scanned: {files_scanned} .dbr files ({zero_row_files} zero-row)")
    print(f"  facts rows: {facts_rows}")
    locs = "  ".join(f"{k}({v})" for k, v in sorted(locale_counts.items()))
    print(f"  labels rows: {labels_rows}  locales: {locs or '(none)'}")
    if locales_missing:
        print(f"  locales MISSING (not extracted): {' '.join(locales_missing)}")
    if locales_skipped:
        print(f"  locales skipped: {' '.join(locales_skipped)}")
    if locales_stale:
        print(f"  locales STALE vs records: {' '.join(locales_stale)}")
    print(f"  steam buildid: {buildid or '(none)'}   game version: {args.game_version}")
    print(f"  {facts_pq.name}: {file_size_str(facts_pq)}   "
          f"{labels_pq.name}: {file_size_str(labels_pq)}   "
          f"{meta_pq.name}: {file_size_str(meta_pq)}")
    return 0


# ---------------------------------------------------------------------------
# shared deposit access (census + query)
# ---------------------------------------------------------------------------

def open_deposit(deposit_dir: Path) -> duckdb.DuckDBPyConnection:
    """Views facts/labels/meta over the deposit parquet files; loud error if absent."""
    facts = deposit_dir / "facts.parquet"
    if not facts.is_file():
        print(f"ERROR: no deposit at {deposit_dir} (missing facts.parquet).", file=sys.stderr)
        print("Run `just deposit` first (needs the extracted tree from `just extract`).",
              file=sys.stderr)
        raise SystemExit(2)
    con = duckdb.connect()
    con.execute(f"CREATE VIEW facts AS SELECT * FROM read_parquet({sql_str(facts.as_posix())})")
    for name in ("labels", "meta"):
        p = deposit_dir / f"{name}.parquet"
        if p.is_file():
            con.execute(f"CREATE VIEW {name} AS SELECT * FROM read_parquet({sql_str(p.as_posix())})")
        else:
            print(f"WARNING: {p.name} missing; the `{name}` view is unavailable.")
    return con


def read_meta(con: duckdb.DuckDBPyConnection) -> dict[str, str]:
    try:
        return dict(con.execute("SELECT key, value FROM meta").fetchall())
    except duckdb.Error:
        return {}


def warn_buildid_mismatch(meta: dict[str, str]) -> None:
    fb, lb = meta.get("facts_buildid"), meta.get("labels_buildid")
    if fb is not None and lb is not None and fb != lb:
        print(f"WARNING: facts (build {fb or '?'}) and labels (build {lb or '?'}) "
              "carry different build ids - regenerate with `just deposit`.")


# Category taxonomy: path prefix, one level deeper inside records/items/.
CATEGORY_SQL = ("COALESCE(NULLIF(CASE WHEN record LIKE 'records/items/%' "
                "THEN regexp_extract(record, '^(records/items/[^/]+)', 1) "
                "ELSE regexp_extract(record, '^(records/[^/]+)', 1) END, ''), '(root)')")


# ---------------------------------------------------------------------------
# census
# ---------------------------------------------------------------------------

def cmd_census(args) -> int:
    deposit_dir = args.deposit_dir.resolve()
    con = open_deposit(deposit_dir)
    meta = read_meta(con)
    warn_buildid_mismatch(meta)

    overview = con.execute(
        "SELECT count(DISTINCT record), count(*), count(DISTINCT key) FROM facts").fetchone()
    total_records, total_rows, total_keys = overview

    cats = con.execute(
        f"SELECT {CATEGORY_SQL} AS category, count(DISTINCT record) AS records, "
        f"count(*) AS rows, count(DISTINCT key) AS keys, "
        f"count(DISTINCT CASE WHEN key = 'templateName' THEN value END) AS templates "
        f"FROM facts GROUP BY 1 ORDER BY 1").fetchall()

    # Canonical-key coverage per item category: the R7 signal separating
    # weakly-modeled categories (enemygear, questitems, faction) from mainline gear.
    canon = ["templateName", "Class", "itemClassification", "itemNameTag",
             "description", "itemText", "levelRequirement"]
    cov_cols = ", ".join(
        f"count(DISTINCT CASE WHEN key = '{k}' THEN record END) AS c{i}"
        for i, k in enumerate(canon))
    coverage = con.execute(
        f"SELECT {CATEGORY_SQL} AS category, count(DISTINCT record) AS records, {cov_cols} "
        f"FROM facts WHERE record LIKE 'records/items/%' GROUP BY 1 ORDER BY 1").fetchall()

    top_templates = con.execute(
        f"SELECT category, template, records FROM ("
        f"  SELECT {CATEGORY_SQL} AS category, value AS template, count(*) AS records, "
        f"  row_number() OVER (PARTITION BY {CATEGORY_SQL} ORDER BY count(*) DESC, value) AS rn "
        f"  FROM facts WHERE key = 'templateName' GROUP BY 1, 2) "
        f"WHERE rn <= 5 ORDER BY category, records DESC").fetchall()

    # Dangling cross-references: values that name records/....dbr paths (arrays
    # are ';'-packed, so split first) with no matching record in the deposit.
    con.execute(
        "CREATE TEMP TABLE dangling AS "
        "WITH refs AS ("
        "  SELECT record, key, lower(trim(unnest(string_split(value, ';')))) AS ref "
        "  FROM facts WHERE lower(value) LIKE '%records/%'), "
        "known AS (SELECT DISTINCT lower(record) AS rec FROM facts) "
        "SELECT r.record, r.key, r.ref FROM refs r LEFT JOIN known k ON r.ref = k.rec "
        "WHERE r.ref LIKE 'records/%.dbr' AND k.rec IS NULL")
    dangling_count, dangling_refs = con.execute(
        "SELECT count(*), count(DISTINCT ref) FROM dangling").fetchone()
    dangling_sample = con.execute(
        "SELECT ref, count(*) AS uses FROM dangling GROUP BY ref ORDER BY uses DESC, ref LIMIT 10"
    ).fetchall()

    # Full, uncapped per-category/key detail lives beside the report.
    keys_csv = deposit_dir / "census_keys.csv"
    templates_csv = deposit_dir / "census_templates.csv"
    con.execute(
        f"COPY (SELECT {CATEGORY_SQL} AS category, key, count(*) AS rows, "
        f"count(DISTINCT record) AS records_with_key, count(value_num) AS numeric_rows, "
        f"count(CASE WHEN value_num IS NOT NULL AND value_num != 0 THEN 1 END) AS nonzero_numeric_rows, "
        f"count(DISTINCT value) AS distinct_values "
        f"FROM facts GROUP BY 1, 2 ORDER BY 1, rows DESC, key) "
        f"TO {sql_str(keys_csv.as_posix())} (HEADER)")
    con.execute(
        f"COPY (SELECT {CATEGORY_SQL} AS category, value AS template, count(*) AS records "
        f"FROM facts WHERE key = 'templateName' GROUP BY 1, 2 ORDER BY 1, records DESC, 2) "
        f"TO {sql_str(templates_csv.as_posix())} (HEADER)")

    zero_row = meta.get("facts_zero_row_files", "?")
    lines: list[str] = []
    lines.append("# Deposit schema census")
    lines.append("")
    lines.append(f"Generated {utc_now()} from build {meta.get('steam_buildid') or '(none)'} "
                 f"(game {meta.get('game_version', '?')}). Regenerate with `just census`.")
    lines.append("")
    lines.append("## Overview")
    lines.append("")
    lines.append(f"- records: {total_records}")
    lines.append(f"- facts rows: {total_rows}")
    lines.append(f"- distinct keys: {total_keys}")
    lines.append(f"- zero-row .dbr files at build time: {zero_row}")
    lines.append("")
    lines.append("## Categories (path-prefix taxonomy)")
    lines.append("")
    lines.append("Full per-key stats (type shape, non-zero frequency, cardinality) in "
                 "`census_keys.csv`; full template distribution in `census_templates.csv` "
                 "- neither is truncated.")
    lines.append("")
    lines.append("| category | records | rows | distinct keys | distinct templates |")
    lines.append("|---|---|---|---|---|")
    for cat, recs, rows, keys, tpls in cats:
        lines.append(f"| {cat} | {recs} | {rows} | {keys} | {tpls} |")
    lines.append("")
    lines.append("## Item categories: canonical-key coverage (R7)")
    lines.append("")
    lines.append("Share of records carrying each mainline-gear key. Low coverage marks a "
                 "weakly-modeled category for the typed-schema scoping decision.")
    lines.append("")
    lines.append("| category | records | " + " | ".join(canon) + " |")
    lines.append("|---|---|" + "---|" * len(canon))
    for row in coverage:
        cat, recs = row[0], row[1]
        pcts = " | ".join(f"{100 * c / recs:.0f}%" for c in row[2:])
        lines.append(f"| {cat} | {recs} | {pcts} |")
    lines.append("")
    lines.append("## Top templates per category (top 5 each)")
    lines.append("")
    lines.append("Template usage is also the visible face of the .tpl-inheritance gap: the "
                 "deposit carries raw .dbr content only, so template-inherited defaults are absent.")
    lines.append("")
    lines.append("| category | template | records |")
    lines.append("|---|---|---|")
    for cat, tpl, recs in top_templates:
        lines.append(f"| {cat} | {tpl} | {recs} |")
    lines.append("")
    lines.append("## Diagnostics")
    lines.append("")
    lines.append(f"- dangling cross-references: {dangling_count} rows "
                 f"({dangling_refs} distinct missing targets)")
    for ref, uses in dangling_sample:
        lines.append(f"  - {ref} ({uses} uses)")
    lines.append(f"- zero-row .dbr files: {zero_row}")
    lines.append("")

    report = deposit_dir / "census.md"
    report.write_text("\n".join(lines), encoding="utf-8")
    con.close()

    print("=== CENSUS SUMMARY ===")
    print(f"  records: {total_records}   rows: {total_rows}   distinct keys: {total_keys}")
    print(f"  categories: {len(cats)}   "
          f"item categories: {sum(1 for c in cats if c[0].startswith('records/items/'))}")
    print(f"  dangling refs: {dangling_count} rows ({dangling_refs} distinct targets)   "
          f"zero-row files: {zero_row}")
    print(f"  report: {report}")
    print(f"  detail: {keys_csv.name}, {templates_csv.name} (uncapped)")
    return 0


# ---------------------------------------------------------------------------
# query
# ---------------------------------------------------------------------------

def print_table(cols: list[str], rows: list[tuple], max_rows: int) -> None:
    def cell(v) -> str:
        s = "" if v is None else str(v)
        return s if len(s) <= 60 else s[:57] + "..."
    shown = [tuple(cell(v) for v in r) for r in rows[:max_rows]]
    widths = [len(c) for c in cols]
    for r in shown:
        widths = [max(w, len(v)) for w, v in zip(widths, r)]
    print("  ".join(c.ljust(w) for c, w in zip(cols, widths)).rstrip())
    print("  ".join("-" * w for w in widths))
    for r in shown:
        print("  ".join(v.ljust(w) for v, w in zip(r, widths)).rstrip())
    if len(rows) > max_rows:
        print(f"... ({len(rows) - max_rows} more rows not shown)")


def cmd_query(args) -> int:
    if not args.sql and not args.file:
        print("ERROR: pass --sql or --file.", file=sys.stderr)
        return 2
    sql = args.sql or Path(args.file).read_text(encoding="utf-8")
    con = open_deposit(args.deposit_dir.resolve())
    warn_buildid_mismatch(read_meta(con))
    try:
        res = con.execute(sql)
        cols = [d[0] for d in res.description] if res.description else []
        rows = res.fetchall()
    except duckdb.Error as e:
        print(f"ERROR: query failed: {e}", file=sys.stderr)
        return 2
    if cols:
        print_table(cols, rows, args.max_rows)
    print(f"{len(rows)} row(s)")
    if args.fail_on_empty and not rows:
        print("FAIL: query returned 0 rows - for an acceptance recipe this means a "
              "broken join or a stale deposit, not success (see docs/deposit.md).",
              file=sys.stderr)
        return 1
    return 0


# ---------------------------------------------------------------------------

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Grim Dawn raw data deposit: build, census, query")
    sub = ap.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build", help="regenerate facts/labels/meta parquet from the extracted tree")
    b.add_argument("--records-dir", required=True, type=Path,
                   help="Extracted records dir (the folder containing 'records/')")
    b.add_argument("--text-root", required=True, type=Path,
                   help="Dir containing the extracted text_<locale> folders (extracted/)")
    b.add_argument("--out-dir", required=True, type=Path, help="Deposit output dir")
    b.add_argument("--i18n-dir", type=Path, default=None,
                   help="data/i18n dir; its game.<locale>.json files define which "
                        "locales are expected (missing ones are warned about)")
    b.add_argument("--game-version", default="unknown")
    b.add_argument("--steam-buildid", default=None)
    b.set_defaults(fn=cmd_build)

    c = sub.add_parser("census", help="schema census report over the deposit")
    c.add_argument("--deposit-dir", required=True, type=Path)
    c.set_defaults(fn=cmd_census)

    q = sub.add_parser("query", help="run SQL against facts/labels/meta views")
    q.add_argument("--deposit-dir", required=True, type=Path)
    q.add_argument("--sql", default=None)
    q.add_argument("--file", default=None, help="Read the SQL from a file")
    q.add_argument("--max-rows", type=int, default=100, help="Rows to display (count is always full)")
    q.add_argument("--fail-on-empty", action="store_true",
                   help="Exit non-zero when the query returns 0 rows (acceptance recipes)")
    q.set_defaults(fn=cmd_query)

    args = ap.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
