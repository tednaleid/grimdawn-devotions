# Game Version Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regenerate all committed game data against Grim Dawn 1.3.0.0 (Fangs of Asterkarn, Steam build 24346246), verify nothing structurally broke, and harden the pipeline so future bumps are near-one-command.

**Architecture:** Four tooling changes (a buildid->version mapping, a `just diff-data` verification tool, a `just migrate` orchestrator, a docstring fix), then a supervised run of the migration on the Windows machine with the game installed. Tasks 1-4 build and test without the game; Task 5 runs it.

**Tech Stack:** `just` recipes (bash + `jq`), self-contained Python `uv run --script` files, existing TS/Bun web build.

## Global Constraints

- The version string convention is GrimTools' four segments: `1.3.0.0` (not `1.3.0.x`).
- New Python files are self-contained uv scripts: first line `#!/usr/bin/env -S uv run --script`, then an inline `# /// script` metadata block with `requires-python = ">=3.10"`. Run and tested via `uv run scripts/<name>.py`.
- Every new file starts with two `# ABOUTME: ` comment lines (after the shebang for scripts).
- The structural gate is devotions-only. RR additions are expected (Fangs adds items/skills/sets) and must never fail the migration; removed RR sources are a warning to review, not a failure.
- justfile recipes are verified by invocation (run the recipe, check output/exit code), not by a unit-test framework.
- No emojis, emdashes, or hyperbole in docs or output text.
- Commit messages end with the trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Do not commit regenerated data or push/deploy without explicit human sign-off (Task 5 stops at the review gate).

## File Structure

- `data/steam-build-versions.json` (new) - buildid -> human version map.
- `justfile` (modified) - add `_game-version`, `diff-data`, `migrate`; rewire `parse`/`parse-rr`; remove the `gd_version` default.
- `scripts/diff_data.py` (new) - semantic diff + structural gate.
- `scripts/test_diff_data.py` (new) - tests for the pure diff functions.
- `scripts/build_assets.py` (modified) - fix the stale "git-ignored" docstring.

---

### Task 1: Steam buildid -> version mapping and `_game-version` helper

**Files:**
- Create: `data/steam-build-versions.json`
- Modify: `justfile` (add `_game-version`; rewire `parse` at ~154 and `parse-rr` at ~166; remove `gd_version` default at line 10)

**Interfaces:**
- Produces: a private recipe `just _game-version` that prints `<buildid> <version>` on stdout, or exits non-zero with a message on an unknown buildid. Consumed by `parse` and `parse-rr`.

- [ ] **Step 1: Create the mapping file**

Create `data/steam-build-versions.json`:

```json
{
  "19149150": "1.2.1.x",
  "24346246": "1.3.0.0"
}
```

- [ ] **Step 2: Add the `_game-version` helper recipe**

Add to `justfile` (near the `parse` recipe):

```make
# Resolve the game version for parsing: read the Steam buildid from the app manifest, then map it to a
# human-readable version via data/steam-build-versions.json. GD_VERSION overrides the map (and bootstraps
# a brand-new build). Fails on an unknown buildid so a new release cannot silently ship the previous
# version label. Prints one line: "<buildid> <version>".
_game-version:
    #!/usr/bin/env bash
    set -euo pipefail
    manifest="{{gd_dir}}/../../appmanifest_219990.acf"
    buildid=$(grep -oE '"buildid"[[:space:]]+"[0-9]+"' "$manifest" 2>/dev/null | grep -oE '[0-9]+' || true)
    if [ -z "$buildid" ]; then echo "could not read Steam buildid from $manifest" >&2; exit 1; fi
    if [ -n "${GD_VERSION:-}" ]; then echo "$buildid $GD_VERSION"; exit 0; fi
    map="{{justfile_directory()}}/data/steam-build-versions.json"
    version=$(jq -r --arg b "$buildid" '.[$b] // empty' "$map")
    if [ -z "$version" ]; then
      echo "Unknown Steam buildid $buildid: add it to data/steam-build-versions.json (GrimTools shows the version), or pass GD_VERSION=..." >&2
      exit 1
    fi
    echo "$buildid $version"
```

- [ ] **Step 3: Rewire `parse` to use the helper**

Replace the `parse` recipe body's buildid read and `--game-version {{gd_version}}` usage so it becomes:

```make
parse *ARGS:
    #!/usr/bin/env bash
    set -euo pipefail
    read -r buildid version < <({{just_executable()}} _game-version)
    mkdir -p "$(dirname "{{out}}")"
    uv run scripts/parse_devotions.py \
        --records-dir "{{records_dir}}" --text-dir "{{text_dir}}" --out "{{out}}" \
        --game-version "$version" --steam-buildid "$buildid" {{ARGS}}
```

- [ ] **Step 4: Rewire `parse-rr` to use the helper**

```make
parse-rr *ARGS:
    #!/usr/bin/env bash
    set -euo pipefail
    read -r buildid version < <({{just_executable()}} _game-version)
    mkdir -p "$(dirname "{{out_rr}}")"
    uv run scripts/parse_rr.py \
        --records-dir "{{records_dir}}" --text-dir "{{text_dir}}" --out "{{out_rr}}" \
        --devotions "{{out}}" \
        --game-version "$version" --steam-buildid "$buildid" {{ARGS}}
```

- [ ] **Step 5: Remove the now-unused `gd_version` default**

Delete line 10: `gd_version  := env_var_or_default("GD_VERSION", "1.2.1.x")`. `GD_VERSION` is now read directly in `_game-version`. Confirm no other `{{gd_version}}` reference remains:

Run: `grep -n "gd_version" justfile`
Expected: no matches.

- [ ] **Step 6: Verify the helper resolves this machine's build**

Run: `just _game-version`
Expected: `24346246 1.3.0.0`

Run: `GD_VERSION=9.9.9.9 just _game-version`
Expected: `24346246 9.9.9.9`

Unknown-build path (temporarily drop the current build from the map, confirm the failure, restore):

```bash
cp data/steam-build-versions.json /tmp/sbv.bak
jq 'del(."24346246")' /tmp/sbv.bak > data/steam-build-versions.json
just _game-version; echo "exit=$?"
cp /tmp/sbv.bak data/steam-build-versions.json
```

Expected: the "Unknown Steam buildid 24346246: add it to data/steam-build-versions.json ..." message on stderr and `exit=1`.

- [ ] **Step 7: Commit**

```bash
git add data/steam-build-versions.json justfile
git commit -m "feat(migration): map Steam buildid to game version, fail on unknown"
```

---

### Task 2: `just diff-data` semantic diff and verification gate

**Files:**
- Create: `scripts/diff_data.py`
- Create: `scripts/test_diff_data.py`
- Modify: `justfile` (add `diff-data` recipe)

**Interfaces:**
- Consumes: `data/devotions.json` and `data/resistance-reduction.json` shapes. Devotions: `{meta:{affinities:[...]}, constellations:[{id, name_tag, tier, point_cost, affinity_required, affinity_bonus, stars:[{index, bonuses:{stat:val}, celestial_power}]}]}`. RR: `{sources:[{id, rr_type, resistances, values_per_rank}]}`.
- Produces: `diff_devotions(old, new) -> (errors, changes)` and `diff_rr(old, new) -> (added, removed, changed)`; a `just diff-data` recipe that exits non-zero on structural errors.

- [ ] **Step 1: Write the failing test**

Create `scripts/test_diff_data.py`:

```python
#!/usr/bin/env -S uv run --script
# ABOUTME: Tests the pure diff functions in diff_data.py (structural gate + tuning/RR reports).
# ABOUTME: Run: uv run scripts/test_diff_data.py
# /// script
# requires-python = ">=3.10"
# ///
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("diff_data", Path(__file__).parent / "diff_data.py")
dd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dd)

BASE = {
    "meta": {"affinities": ["a", "b"]},
    "constellations": [
        {"id": "c1", "name_tag": "t1", "tier": 1, "point_cost": 2,
         "affinity_required": {"a": 1}, "affinity_bonus": {"a": 5},
         "stars": [{"index": 0, "bonuses": {"str": 10}, "celestial_power": None}]},
    ],
}


def clone(d):
    import copy
    return copy.deepcopy(d)


def test_stable_is_clean():
    errors, changes = dd.diff_devotions(BASE, clone(BASE))
    assert errors == [], errors
    assert changes == [], changes


def test_removed_constellation_is_structural_error():
    new = clone(BASE)
    new["constellations"] = []
    errors, _ = dd.diff_devotions(BASE, new)
    assert any("REMOVED" in e for e in errors), errors


def test_affinities_change_is_error():
    new = clone(BASE)
    new["meta"]["affinities"] = ["a"]
    errors, _ = dd.diff_devotions(BASE, new)
    assert any("affinities" in e for e in errors), errors


def test_point_cost_total_change_is_error():
    new = clone(BASE)
    new["constellations"][0]["point_cost"] = 3
    errors, _ = dd.diff_devotions(BASE, new)
    assert errors, errors


def test_bonus_value_change_is_tuning():
    new = clone(BASE)
    new["constellations"][0]["stars"][0]["bonuses"]["str"] = 12
    errors, changes = dd.diff_devotions(BASE, new)
    assert errors == [], errors
    assert any("str" in c and "12" in c for c in changes), changes


def test_rr_added_removed_changed():
    old = {"sources": [{"id": "s1", "rr_type": "stacking", "resistances": "Fire", "values_per_rank": [10]},
                       {"id": "s2", "rr_type": "stacking", "resistances": "Cold", "values_per_rank": [5]}]}
    new = {"sources": [{"id": "s1", "rr_type": "stacking", "resistances": "Fire", "values_per_rank": [12]},
                       {"id": "s3", "rr_type": "stacking", "resistances": "Aether", "values_per_rank": [8]}]}
    added, removed, changed = dd.diff_rr(old, new)
    assert added == ["s3"], added
    assert removed == ["s2"], removed
    assert any("s1" in c for c in changed), changed


def run():
    fns = [v for k, v in globals().items() if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")


if __name__ == "__main__":
    run()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run scripts/test_diff_data.py`
Expected: FAIL (diff_data.py does not exist yet, import error).

- [ ] **Step 3: Implement `diff_data.py`**

Create `scripts/diff_data.py`:

```python
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
    """The committed version at git HEAD, or None if the file is not yet committed."""
    r = subprocess.run(["git", "show", f"HEAD:{path}"], capture_output=True, text=True)
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run scripts/test_diff_data.py`
Expected: `6 passed`

- [ ] **Step 5: Add the `diff-data` recipe**

Add to `justfile`:

```make
# Diff the regenerated data/*.json against the committed baseline: assert devotion structure is stable,
# report tuning + RR changes. Run after regenerating, before committing. Exits non-zero on a structural break.
diff-data:
    uv run scripts/diff_data.py --devotions "{{out}}" --rr "{{out_rr}}"
```

- [ ] **Step 6: Verify the recipe against the committed baseline**

Run: `just diff-data`
Expected: exit 0; devotions STRUCTURE stable; TUNING CHANGES none; RR SOURCES +0/-0/0 (the working tree matches HEAD, so no changes). This confirms the tool runs end to end and the git-baseline load works before any data changes.

- [ ] **Step 7: Commit**

```bash
git add scripts/diff_data.py scripts/test_diff_data.py justfile
git commit -m "feat(migration): just diff-data semantic diff + devotion structural gate"
```

---

### Task 3: `just migrate` orchestrator

**Files:**
- Modify: `justfile` (add `migrate` recipe)

**Interfaces:**
- Consumes: existing recipes `extract`, `parse`, `parse-rr`, `i18n-tables`, `assets`, `build`, `diff-data`, `check`.

- [ ] **Step 1: Add the `migrate` recipe**

Add to `justfile`:

```make
# One-command version bump: regenerate all game data, rebuild, and verify, stopping BEFORE commit so you
# review the diff and deploy yourself. Requires the game installed + closed (Windows-only extraction).
# `diff-data` exits non-zero on a devotion structural break, halting the chain. New buildids must be added
# to data/steam-build-versions.json first (or pass GD_VERSION=...).
migrate: extract parse parse-rr i18n-tables assets build diff-data check
    @echo ""
    @echo "Migration regenerated + verified. Review the diff-data report above (before the check output)."
    @echo "Then: just e2e   (recommended), then   git add -A && git commit && git push   to deploy."
```

- [ ] **Step 2: Verify the recipe is registered and ordered**

Run: `just --show migrate`
Expected: prints the recipe with the dependency chain `extract parse parse-rr i18n-tables assets build diff-data check`.

(A full run of `migrate` happens in Task 5; it drives the game extraction and is supervised.)

- [ ] **Step 3: Commit**

```bash
git add justfile
git commit -m "feat(migration): just migrate orchestrator, stops at the review gate"
```

---

### Task 4: Fix the stale `build_assets.py` docstring

**Files:**
- Modify: `scripts/build_assets.py` (line ~9)

- [ ] **Step 1: Correct the comment**

In `scripts/build_assets.py`, replace the stale sentence in the module docstring:

Old:
```python
plus a manifest the web app reads. Output dir is git-ignored. See
docs/assets-and-textures.md for the .tex format."""
```

New:
```python
plus a manifest the web app reads. The output dir (assets/devotions) is committed for the
GitHub Pages build; regenerate it with `just assets`. See docs/assets-and-textures.md for the .tex format."""
```

- [ ] **Step 2: Verify**

Run: `grep -n "git-ignored" scripts/build_assets.py`
Expected: no matches.

Run: `uv run scripts/build_assets.py --help`
Expected: prints usage (the script still parses; the docstring edit did not break it).

- [ ] **Step 3: Commit**

```bash
git add scripts/build_assets.py
git commit -m "docs(assets): correct the stale git-ignored comment (art is committed)"
```

---

### Task 5: Run the 1.3.0.0 migration (supervised)

This task runs on the Windows machine with Grim Dawn 1.3.0.0 installed and closed. It is interactive: it regenerates large committed datasets, surfaces changes for human review, and ends at a deploy gate. Do not automate the commit/push.

**Files:**
- Regenerated (not hand-edited): `data/devotions.json`, `data/resistance-reduction.json`, `data/i18n/game.*.json`, `assets/devotions/*` (if art changed), `data/cover-table.bin`.

- [ ] **Step 1: Confirm prerequisites**

Run: `just _game-version`
Expected: `24346246 1.3.0.0`. If it fails with "Unknown Steam buildid", the game updated again; add the new buildid to `data/steam-build-versions.json` (GrimTools shows the version) and re-run.

Confirm Grim Dawn is closed (extraction requires it).

- [ ] **Step 2: Run the migration**

Run: `just migrate`
Expected: extract -> parse -> parse-rr -> i18n-tables -> assets -> build -> diff-data -> check, then the review reminder. If a step fails, stop and triage before continuing.

- [ ] **Step 3: Triage a parser break, if any**

If `parse`/`parse-rr`/`i18n-tables` errors or `diff-data` reports a STRUCTURE FAIL, the new records exposed a gap. Investigate the offending record with the existing dbr tooling, fix the parser, add a regression test in the matching `scripts/test_*.py`, and re-run `just migrate`. A structural devotion change that is NOT a parser bug (unexpected content change) must be raised with the human before proceeding, since the developer stated devotions are stable.

- [ ] **Step 4: Review the diff-data report**

Read the `diff-data` output. Expected shape for a balance patch: STRUCTURE stable; some devotion TUNING CHANGES (value tweaks); RR SOURCES with new entries from Fangs and possibly value changes. Confirm the tuning changes are plausible balance edits, not corruption. Present the report to the human for sign-off.

- [ ] **Step 5: Confirm the art re-encode was clean**

Run: `git status --short assets/`
Expected: either no changes (unchanged art re-encoded deterministically) or only real texture changes. If unchanged art shows a large spurious diff, the WebP re-encode is non-deterministic; note it and raise whether to keep `assets` in `just migrate` before committing the art churn.

- [ ] **Step 6: Full verification**

Run: `just e2e`
Expected: planner and RR suites pass (84/84 and 13/13 at time of writing).

- [ ] **Step 7: Deploy (human sign-off required)**

After human review of the diff-data report and the green gates:

```bash
git add -A
git commit -m "data(migration): regenerate for Grim Dawn 1.3.0.0 (Fangs of Asterkarn)"
git push
```

The GitHub Action rebuilds and deploys; the `?v=` cache-bust delivers the new data to returning visitors immediately.

---

## Self-Review

- Spec coverage: mapping (Task 1), diff-data (Task 2), migrate (Task 3), docstring (Task 4), the run (Task 5). All five spec deliverables covered.
- Placeholders: none; all recipe and script code is complete.
- Type/name consistency: `_game-version` prints `<buildid> <version>` and both `parse`/`parse-rr` `read -r buildid version` in the same order. `diff_devotions`/`diff_rr` signatures match between `diff_data.py`, its test, and the `diff-data` recipe. `{{out}}`/`{{out_rr}}` are the existing justfile variables for the two data files.
