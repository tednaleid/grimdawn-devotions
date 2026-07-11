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


# ---------------------------------------------------------------------------
# publish
# ---------------------------------------------------------------------------

def run_gh(gh_args: list[str], what: str) -> str:
    try:
        res = subprocess.run(["gh", *gh_args], capture_output=True, text=True)
    except FileNotFoundError:
        err("`gh` CLI not found - publish needs it (fetch does not). https://cli.github.com")
        raise SystemExit(2)
    if res.returncode != 0:
        err(f"{what} failed (gh {' '.join(gh_args[:2])} ...):\n{res.stderr.strip()}")
        raise SystemExit(2)
    return res.stdout.strip()


def next_revision(buildid: str, existing_tags: list[str]) -> int:
    """Next free rev for deposit-<buildid>.<rev>; existing releases are never touched."""
    prefix = f"deposit-{buildid}."
    revs = []
    for tag in existing_tags:
        if tag.startswith(prefix) and tag[len(prefix):].isdigit():
            revs.append(int(tag[len(prefix):]))
    return max(revs) + 1 if revs else 1


def git_head_sha() -> str:
    res = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True)
    if res.returncode != 0:
        err(f"git rev-parse HEAD failed:\n{res.stderr.strip()}")
        raise SystemExit(2)
    return res.stdout.strip()


def head_on_remote(nwo: str, sha: str) -> bool:
    res = subprocess.run(["gh", "api", f"repos/{nwo}/commits/{sha}", "--silent"],
                         capture_output=True, text=True)
    return res.returncode == 0


def cmd_publish(args) -> int:
    entries = build_asset_entries(args.deposit_dir, args.derived_dir)
    meta = read_deposit_meta(args.deposit_dir)
    buildid = require_buildid(meta)

    if args.assume_existing_tags is not None:  # dev/test hook for revision discovery
        existing = [t for t in args.assume_existing_tags.split(",") if t]
    else:
        out = run_gh(["release", "list", "--limit", "1000", "--json", "tagName",
                      "--jq", ".[].tagName"], "release listing")
        existing = out.splitlines()
    tag = f"deposit-{buildid}.{next_revision(buildid, existing)}"

    nwo = run_gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
                 "repo lookup")
    download_base = f"https://github.com/{nwo}/releases/download/{tag}"
    lock = build_lock(meta, tag, download_base, entries)
    sha = git_head_sha()

    if args.dry_run:
        print(f"DRY RUN: would create release {tag} on {nwo} (target {sha[:12]}) "
              f"with {len(entries)} assets, then write {args.lock}", file=sys.stderr)
        if not head_on_remote(nwo, sha):
            print(f"WARNING: commit {sha[:12]} is not on the remote; a real publish will "
                  "refuse until the branch is pushed.", file=sys.stderr)
        print(json.dumps(lock, indent=2))
        return 0

    # The tag must point at a commit the remote has, or gh creates it against the
    # default branch head - a permanently wrong target once releases are immutable.
    if not head_on_remote(nwo, sha):
        err(f"commit {sha[:12]} is not on the remote, so the release tag cannot point at it.")
        print("Push the current branch first (`git push`), then re-run.", file=sys.stderr)
        raise SystemExit(2)

    title = f"deposit {buildid}.{tag.rsplit('.', 1)[1]} (game {meta.get('game_version', '?')})"
    notes = (f"Internal data artifact for this repo's tooling (see docs/deposit.md): "
             f"build {buildid}, {meta.get('facts_rows', '?')} fact rows, "
             f"{meta.get('labels_rows', '?')} label rows.")
    paths = [str(asset_dir(d, args.deposit_dir, args.derived_dir) / name) for name, d in ASSETS]
    # Draft first, publish after all assets are attached: the repo has immutable
    # releases enabled, and a release locks (assets and tag) the moment it is
    # published - an upload failure after publishing would strand an incomplete,
    # unfixable release. Drafts stay editable and deletable.
    run_gh(["release", "create", tag, *paths, "--title", title, "--notes", notes,
            "--target", sha, "--draft"], f"draft release creation ({tag})")
    print(f"created draft release {tag} with {len(paths)} assets")

    if args.draft:
        print("draft kept as requested: deposit.lock NOT written "
              "(publish or delete the draft manually)")
        return 0
    try:
        run_gh(["release", "edit", tag, "--draft=false"], f"release publish ({tag})")
    except SystemExit:
        err(f"the draft {tag} exists with its assets but was NOT published.")
        print(f"Finish manually: gh release edit {tag} --draft=false  "
              "(or delete the draft and re-run)", file=sys.stderr)
        raise
    print(f"published release {tag}")
    try:
        write_lock(lock, args.lock)
    except OSError as e:
        # The release exists and is immutable; say plainly what is left to do.
        err(f"release {tag} was created, but writing {args.lock} failed: {e}")
        print(f"Re-run: scripts/dataset_release.py lock --tag {tag} "
              f"--download-base {download_base} ...", file=sys.stderr)
        raise SystemExit(2)
    return 0


# ---------------------------------------------------------------------------
# fetch
# ---------------------------------------------------------------------------

def load_lock(path: Path) -> dict:
    if not path.is_file():
        err(f"no lockfile at {path} - nothing to fetch.")
        print("Publish from the Windows box first (`just publish-deposit`).", file=sys.stderr)
        raise SystemExit(2)
    try:
        lock = json.loads(path.read_text(encoding="utf-8"))
        if not lock["download_base"] or not lock["assets"]:
            raise KeyError("empty download_base or assets")
        for e in lock["assets"]:
            if e["dir"] not in ("deposit", "derived") or not e["name"] or not e["sha256"]:
                raise KeyError(f"bad asset entry {e}")
    except (json.JSONDecodeError, KeyError, TypeError) as ex:
        err(f"malformed lockfile {path}: {ex}")
        raise SystemExit(2)
    return lock


def cmd_fetch(args) -> int:
    lock = load_lock(args.lock)

    def local_path(e: dict) -> Path:
        return asset_dir(e["dir"], args.deposit_dir, args.derived_dir) / e["name"]

    # Idempotence: only assets whose local copy is absent or hash-mismatched are fetched.
    needs = [e for e in lock["assets"]
             if not (local_path(e).is_file() and sha256_file(local_path(e)) == e["sha256"])]
    if not needs:
        print(f"up to date: all {len(lock['assets'])} artifacts match deposit.lock ({lock['tag']})")
        return 0

    # Download everything to a temp dir on the same volume, verify every hash,
    # and only then move into place - a bad download never replaces current data.
    data_root = args.deposit_dir.parent
    data_root.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix=".fetch-", dir=data_root))
    try:
        for e in needs:
            url = f"{lock['download_base']}/{e['name']}"
            print(f"downloading {e['name']} ({e['bytes']:,} bytes) ...")
            try:
                with urllib.request.urlopen(url) as r, (tmp / e["name"]).open("wb") as f:
                    shutil.copyfileobj(r, f)
            except (urllib.error.URLError, OSError) as ex:
                err(f"download of {e['name']} failed: {ex}")
                print(f"URL: {url}\nLocal data is untouched.", file=sys.stderr)
                raise SystemExit(2)
        bad = [e["name"] for e in needs if sha256_file(tmp / e["name"]) != e["sha256"]]
        if bad:
            err("checksum mismatch for: " + ", ".join(bad))
            print("Local data is untouched. deposit.lock and the downloaded assets disagree -\n"
                  "check that the lockfile matches the release it points at.", file=sys.stderr)
            raise SystemExit(2)
        for e in needs:
            target = local_path(e)
            target.parent.mkdir(parents=True, exist_ok=True)
            try:
                os.replace(tmp / e["name"], target)
            except OSError as ex:
                err(f"could not move {e['name']} into place: {ex}")
                print("Close whatever holds the file open (a server or query), then re-run\n"
                      "`just fetch-deposit` - it resumes with whatever is still missing.",
                      file=sys.stderr)
                raise SystemExit(2)
        print(f"fetched {len(needs)} artifact(s) ({lock['tag']})")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


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

    p_pub = sub.add_parser("publish", help="create the next deposit-<buildid>.<rev> release")
    common(p_pub)
    p_pub.add_argument("--dry-run", action="store_true",
                       help="hash + discover the tag and print the would-be lockfile; no side effects")
    p_pub.add_argument("--draft", action="store_true",
                       help="create a draft release for scratch testing; skips the lockfile")
    p_pub.add_argument("--assume-existing-tags", metavar="TAGS",
                       help="comma-separated tag list standing in for `gh release list` (testing)")
    p_pub.set_defaults(fn=cmd_publish)

    p_fetch = sub.add_parser("fetch", help="download + verify the assets pinned by deposit.lock")
    common(p_fetch)
    p_fetch.set_defaults(fn=cmd_fetch)

    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
