#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
# ABOUTME: Prints page-load counts from the worker's Analytics Engine dataset (POST /hit).
# ABOUTME: Reads a read-only token from GD_STATS_TOKEN or the macOS keychain (see just setup-stats-auth).
import argparse
import json
import os
import shutil
import subprocess
import sys
import tomllib
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATASET = "grimdawn_devotions_hits"
PAGES = ["planner", "rr", "monsters", "items"]


def token() -> str:
    if env := os.environ.get("GD_STATS_TOKEN"):
        return env
    if shutil.which("security"):
        found = subprocess.run(
            ["security", "find-generic-password", "-s", "grimdawn-devotions-stats", "-a", "cloudflare", "-w"],
            capture_output=True,
            text=True,
        )
        if found.returncode == 0:
            return found.stdout.strip()
    sys.exit("No stats token: run `just setup-stats-auth` or set GD_STATS_TOKEN.")


def account_id() -> str:
    with open(ROOT / "worker" / "wrangler.toml", "rb") as f:
        return tomllib.load(f)["account_id"]


def query(sql: str, tok: str, account: str) -> list[dict]:
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{account}/analytics_engine/sql",
        data=f"{sql} FORMAT JSON".encode(),
        headers={"Authorization": f"Bearer {tok}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.load(res)["data"]
    except urllib.error.HTTPError as e:
        sys.exit(f"Analytics Engine SQL API returned {e.code}: {e.read().decode(errors='replace')}")
    except urllib.error.URLError as e:
        sys.exit(f"Could not reach the Analytics Engine SQL API: {e.reason}")


def since(days: int) -> str:
    return f"timestamp > NOW() - INTERVAL '{days}' DAY"


def print_table(title: str, header: list[str], rows: list[list[str]]) -> None:
    print(f"\n{title}")
    widths = [max(len(str(r[i])) for r in [header, *rows]) for i in range(len(header))]
    for r in [header, *rows]:
        print("  ".join(str(c).rjust(w) if i else str(c).ljust(w) for i, (c, w) in enumerate(zip(r, widths))))


def main() -> None:
    parser = argparse.ArgumentParser(description="Print page-load counts from the worker.")
    parser.add_argument("--days", type=int, default=30, help="look-back window in days (Analytics Engine keeps ~90)")
    args = parser.parse_args()
    tok, account = token(), account_id()
    where = since(args.days)

    daily = query(
        f"SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, blob1 AS page, "
        f"SUM(_sample_interval) AS loads FROM {DATASET} WHERE {where} GROUP BY day, page ORDER BY day",
        tok,
        account,
    )
    by_day: dict[str, dict[str, int]] = {}
    for r in daily:
        by_day.setdefault(r["day"][:10], {})[r["page"]] = int(r["loads"])
    rows = [[day, *(str(c.get(p, 0)) for p in PAGES), str(sum(c.values()))] for day, c in sorted(by_day.items())]
    totals = [sum(c.get(p, 0) for c in by_day.values()) for p in PAGES]
    rows.append(["total", *(str(t) for t in totals), str(sum(totals))])
    print_table(f"Page loads per day, last {args.days} days", ["day", *PAGES, "all"], rows)

    for title, column in (("Top countries", "blob2"), ("Top referrers", "blob3")):
        top = query(
            f"SELECT {column} AS label, SUM(_sample_interval) AS loads FROM {DATASET} "
            f"WHERE {where} GROUP BY label ORDER BY loads DESC LIMIT 15",
            tok,
            account,
        )
        print_table(f"{title}, last {args.days} days", ["label", "loads"], [[r["label"], str(int(r["loads"]))] for r in top])


if __name__ == "__main__":
    main()
