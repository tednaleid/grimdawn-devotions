#!/usr/bin/env -S uv run --script
# ABOUTME: Semantic diff of regenerated game data (devotions.json + resistance-reduction.json) vs the
# ABOUTME: git-committed baseline. Asserts devotion structure is stable; reports tuning + RR changes.
# /// script
# requires-python = ">=3.10"
# ///
import argparse
import json
import subprocess
import sys
from pathlib import Path


def _load_working(path: str):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _load_baseline(path: str):
    """The committed version at git HEAD, or None if the file is not yet committed.

    `git show HEAD:<path>` requires a path relative to the repo root; the justfile passes
    absolute paths (out/out_rr), so resolve against the repo root first.
    """
    root = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    rel = path
    if root.returncode == 0:
        try:
            rel = Path(path).resolve().relative_to(Path(root.stdout.strip())).as_posix()
        except ValueError:
            rel = path
    r = subprocess.run(["git", "show", f"HEAD:{rel}"], capture_output=True, text=True)
    if r.returncode != 0:
        return None
    return json.loads(r.stdout)


def diff_devotions(old: dict, new: dict):
    """Return (errors, changes): errors are structural (must be empty to pass); changes are tuning info."""
    errors: list[str] = []
    changes: list[str] = []
    by_id = lambda doc: {c["id"]: c for c in doc.get("constellations", [])}
    o, n = by_id(old), by_id(new)
    o_ids, n_ids = set(o), set(n)
    for cid in sorted(n_ids - o_ids):
        errors.append(f"constellation ADDED: {cid}")
    for cid in sorted(o_ids - n_ids):
        errors.append(f"constellation REMOVED: {cid}")
    o_aff = set(old.get("meta", {}).get("affinities", []))
    n_aff = set(new.get("meta", {}).get("affinities", []))
    if o_aff != n_aff:
        errors.append(f"affinities changed: {sorted(o_aff)} -> {sorted(n_aff)}")
    o_pts = sum(c.get("point_cost", 0) for c in old.get("constellations", []))
    n_pts = sum(c.get("point_cost", 0) for c in new.get("constellations", []))
    if o_pts != n_pts:
        errors.append(f"total point_cost changed: {o_pts} -> {n_pts}")
    for cid in sorted(o_ids & n_ids):
        oc, nc = o[cid], n[cid]
        for field in ("name_tag", "tier", "point_cost"):
            if oc.get(field) != nc.get(field):
                errors.append(f"{cid}: {field} changed {oc.get(field)!r} -> {nc.get(field)!r}")
        os_, ns_ = oc.get("stars", []), nc.get("stars", [])
        if len(os_) != len(ns_):
            errors.append(f"{cid}: star count changed {len(os_)} -> {len(ns_)}")
            continue
        for field in ("affinity_required", "affinity_bonus"):
            if oc.get(field) != nc.get(field):
                changes.append(f"{cid}: {field} {oc.get(field)} -> {nc.get(field)}")
        for a, b in zip(os_, ns_):
            ab, bb = a.get("bonuses", {}), b.get("bonuses", {})
            for k in sorted(set(ab) | set(bb)):
                if ab.get(k) != bb.get(k):
                    changes.append(f"{cid} star{a.get('index')}: {k} {ab.get(k)} -> {bb.get(k)}")
            if bool(a.get("celestial_power")) != bool(b.get("celestial_power")):
                changes.append(f"{cid} star{a.get('index')}: celestial_power presence changed")
    return errors, changes


def diff_rr(old: dict, new: dict):
    """Return (added, removed, changed) for RR sources; RR has no hard structural gate."""
    by_id = lambda doc: {s["id"]: s for s in doc.get("sources", [])}
    o, n = by_id(old), by_id(new)
    o_ids, n_ids = set(o), set(n)
    added = sorted(n_ids - o_ids)
    removed = sorted(o_ids - n_ids)
    changed: list[str] = []
    for sid in sorted(o_ids & n_ids):
        os_, ns_ = o[sid], n[sid]
        for field in ("rr_type", "resistances", "values_per_rank"):
            if os_.get(field) != ns_.get(field):
                changed.append(f"{sid}: {field} {os_.get(field)} -> {ns_.get(field)}")
    return added, removed, changed


def _meta_line(old: dict, new: dict) -> str:
    om, nm = old.get("meta", {}), new.get("meta", {})
    return (f"  meta: v{om.get('game_version')} (build {om.get('steam_buildid')}) -> "
            f"v{nm.get('game_version')} (build {nm.get('steam_buildid')})")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--devotions", default="data/devotions.json")
    ap.add_argument("--rr", default="data/resistance-reduction.json")
    args = ap.parse_args(argv)
    exit_code = 0

    print("=== devotions.json ===")
    new_dev = _load_working(args.devotions)
    old_dev = _load_baseline(args.devotions)
    if old_dev is None:
        print("  (no committed baseline; skipping devotion diff)")
    else:
        print(_meta_line(old_dev, new_dev))
        errors, changes = diff_devotions(old_dev, new_dev)
        if errors:
            print(f"  STRUCTURE: FAIL ({len(errors)})")
            for e in errors:
                print(f"    ERROR {e}")
            exit_code = 1
        else:
            print(f"  STRUCTURE: stable ({len(new_dev.get('constellations', []))} constellations) OK")
        if changes:
            print(f"  TUNING CHANGES ({len(changes)}):")
            for c in changes:
                print(f"    {c}")
        else:
            print("  TUNING CHANGES: none")

    print("=== resistance-reduction.json ===")
    new_rr = _load_working(args.rr)
    old_rr = _load_baseline(args.rr)
    if old_rr is None:
        print("  (no committed baseline; skipping RR diff)")
    else:
        added, removed, changed = diff_rr(old_rr, new_rr)
        print(f"  SOURCES: +{len(added)} new, -{len(removed)} removed, {len(changed)} changed")
        for a in added:
            print(f"    + {a}")
        if removed:
            print("  REMOVED (review - regression or a legitimate removal):")
            for r in removed:
                print(f"    - {r}")
        for c in changed:
            print(f"    ~ {c}")

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
