#!/usr/bin/env -S uv run --script
# ABOUTME: Publishes the deposit + derived parquet as immutable per-buildid GitHub Releases and
# ABOUTME: fetches the release pinned by deposit.lock on any machine (lock/publish/fetch).
# /// script
# requires-python = ">=3.10"
# dependencies = ["duckdb"]
# ///
"""Dataset releases: the parquet artifacts' home outside git (see docs/deposit.md).

Generated parquet never enters git. It ships as assets of an immutable GitHub
Release tagged `deposit-<steam buildid>.<rev>`; git commits only `deposit.lock`,
a small JSON manifest pinning one exact tag with a sha256 per asset.

Subcommands:
  lock     hash the seven local parquet artifacts and write deposit.lock for a
           given --tag and --download-base (plumbing shared by publish)
  publish  discover the next deposit-<buildid>.<rev> tag, create the GitHub
           Release with the seven assets via `gh`, write deposit.lock
  fetch    download the assets pinned by deposit.lock over plain HTTPS (no gh,
           no auth needed), verify every sha256, then move into data/

Entry points are the justfile recipes: `just publish-deposit` (Windows box,
gated on `just derive` + `just q-ae-all`) and `just fetch-deposit` (anywhere).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build_deposit import open_deposit, read_meta, utc_now

# The seven managed release assets, split by target data dir. Census byproducts
# and anything else living beside them are never released and never touched.
ASSETS = (
    ("facts.parquet", "deposit"),
    ("labels.parquet", "deposit"),
    ("meta.parquet", "deposit"),
    ("entities.parquet", "derived"),
    ("stats.parquet", "derived"),
    ("relations.parquet", "derived"),
    ("families.parquet", "derived"),
)


def err(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)


def asset_dir(dir_name: str, deposit_dir: Path, derived_dir: Path) -> Path:
    return deposit_dir if dir_name == "deposit" else derived_dir


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def build_asset_entries(deposit_dir: Path, derived_dir: Path) -> list[dict]:
    """Hash the seven local artifacts; loud exit 2 naming anything missing."""
    missing = [
        str(asset_dir(d, deposit_dir, derived_dir) / name)
        for name, d in ASSETS
        if not (asset_dir(d, deposit_dir, derived_dir) / name).is_file()
    ]
    if missing:
        err("missing artifact(s): " + ", ".join(missing))
        print("Run `just deposit` (Windows) and `just derive` first.", file=sys.stderr)
        raise SystemExit(2)
    entries = []
    for name, d in ASSETS:
        p = asset_dir(d, deposit_dir, derived_dir) / name
        entries.append({"name": name, "dir": d, "sha256": sha256_file(p), "bytes": p.stat().st_size})
    return entries


def read_deposit_meta(deposit_dir: Path) -> dict[str, str]:
    con = open_deposit(deposit_dir)
    meta = read_meta(con)
    con.close()
    return meta


def require_buildid(meta: dict[str, str]) -> str:
    buildid = (meta.get("steam_buildid") or "").strip()
    if not buildid:
        err("the deposit's meta.parquet has no steam_buildid (the appmanifest read is best-effort).")
        print("Re-run `just deposit` with GD_DIR pointing at the game install, then retry.",
              file=sys.stderr)
        raise SystemExit(2)
    return buildid


def build_lock(meta: dict[str, str], tag: str, download_base: str, entries: list[dict]) -> dict:
    return {
        "tag": tag,
        "steam_buildid": require_buildid(meta),
        "game_version": meta.get("game_version", ""),
        "schema_version": meta.get("schema_version", ""),
        "published_utc": utc_now(),
        "download_base": download_base,
        "assets": entries,
    }


def write_lock(lock: dict, path: Path) -> None:
    path.write_text(json.dumps(lock, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {path} ({lock['tag']}, {len(lock['assets'])} assets)")


def cmd_lock(args) -> int:
    entries = build_asset_entries(args.deposit_dir, args.derived_dir)
    meta = read_deposit_meta(args.deposit_dir)
    write_lock(build_lock(meta, args.tag, args.download_base, entries), args.lock)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p):
        p.add_argument("--deposit-dir", type=Path, required=True)
        p.add_argument("--derived-dir", type=Path, required=True)
        p.add_argument("--lock", type=Path, required=True, help="path of deposit.lock")

    p_lock = sub.add_parser("lock", help="hash local artifacts and write deposit.lock")
    common(p_lock)
    p_lock.add_argument("--tag", required=True)
    p_lock.add_argument("--download-base", required=True,
                        help="release download URL prefix the lockfile records")
    p_lock.set_defaults(fn=cmd_lock)

    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
