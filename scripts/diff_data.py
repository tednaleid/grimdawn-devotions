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

# Friendly labels for the devotion stat keys a balance patch commonly touches; unknown keys fall back
# to the raw key (still unambiguous). Kept deliberately small and hand-checked rather than replicating
# the web app's full stat-format engine.
STAT_LABELS = {
    "offensiveCritDamageModifier": "Crit Damage %",
    "retaliationTotalDamageModifier": "Total Retaliation Damage %",
    "retaliationPhysicalModifier": "Physical Retaliation %",
    "retaliationPoisonModifier": "Acid/Poison Retaliation %",
    "retaliationFireModifier": "Fire Retaliation %",
    "retaliationColdModifier": "Cold Retaliation %",
    "retaliationLightningModifier": "Lightning Retaliation %",
    "characterOffensiveAbility": "Offensive Ability",
    "characterOffensiveAbilityModifier": "Offensive Ability %",
    "characterDefensiveAbility": "Defensive Ability",
    "characterDefensiveAbilityModifier": "Defensive Ability %",
    "characterTotalSpeedModifier": "Total Speed %",
    "characterAttackSpeedModifier": "Attack Speed %",
    "characterSpellCastSpeedModifier": "Cast Speed %",
    "characterRunSpeedModifier": "Movement Speed %",
    "characterStrength": "Physique",
    "characterDexterity": "Cunning",
    "characterIntelligence": "Spirit",
    "characterLife": "Health",
    "characterLifeModifier": "Health %",
    "defensiveAbsorptionModifier": "Damage Absorption %",
    "defensiveProtection": "Armor",
    "defensiveProtectionModifier": "Armor %",
    "skillCooldownReduction": "Cooldown Reduction %",
    "skillCooldownTime": "Cooldown (s)",
}


def _stat_label(key: str) -> str:
    return STAT_LABELS.get(key, key)


def _fmt(v) -> str:
    return "none" if v is None else str(v)


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


def _load_gametext(path: str) -> dict:
    """Flat tag -> English text map (data/i18n/game.en.json), for resolving constellation names."""
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except OSError:
        return {}


def _diff_map(out: list, prefix: str, old_map: dict | None, new_map: dict | None) -> None:
    """Append 'prefix: Label OLD -> NEW' for every key whose value differs between the two maps."""
    om, nm = old_map or {}, new_map or {}
    for k in sorted(set(om) | set(nm)):
        ov, nv = om.get(k), nm.get(k)
        if ov != nv:
            out.append(f"{prefix}{_stat_label(k)} {_fmt(ov)} -> {_fmt(nv)}")


def diff_devotions(old: dict, new: dict):
    """Return (errors, changes): errors are structural (must be empty to pass); changes maps a
    constellation id to its list of stat-change lines, covering player bonuses, PET bonuses, and the
    celestial power's own stats + granted pet stats. (Celestial-power stats are stored at max rank
    only, so a scaling-with-rank tweak that keeps the same max value will not appear.)"""
    errors: list[str] = []
    changes: dict[str, list[str]] = {}
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
        cl: list[str] = []
        for field in ("affinity_required", "affinity_bonus"):
            if oc.get(field) != nc.get(field):
                cl.append(f"{field}: {oc.get(field)} -> {nc.get(field)}")
        for a, b in zip(os_, ns_):
            si = a.get("index")
            _diff_map(cl, f"star{si}: ", a.get("bonuses"), b.get("bonuses"))
            _diff_map(cl, f"star{si} (pet): ", a.get("pet_bonuses"), b.get("pet_bonuses"))
            ocp, ncp = a.get("celestial_power"), b.get("celestial_power")
            if bool(ocp) != bool(ncp):
                cl.append(f"star{si}: celestial power {'added' if ncp else 'removed'}")
            elif ocp and ncp:
                _diff_map(cl, f"star{si} [power]: ", ocp.get("stats"), ncp.get("stats"))
                _diff_map(cl, f"star{si} [power/pet]: ", ocp.get("pet"), ncp.get("pet"))
        if cl:
            changes[cid] = cl
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


def _con_name(con: dict, gametext: dict) -> str:
    """Resolved constellation display name (game text), falling back to the id."""
    return gametext.get(con.get("name_tag", ""), con.get("id", "?"))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--devotions", default="data/devotions.json")
    ap.add_argument("--rr", default="data/resistance-reduction.json")
    ap.add_argument("--game-text", default="data/i18n/game.en.json", help="tag->name map for readable names")
    args = ap.parse_args(argv)
    exit_code = 0
    gametext = _load_gametext(args.game_text)

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
        # Group per constellation, sorted by resolved name, covering player + pet + celestial-power stats.
        n_by_id = {c["id"]: c for c in new_dev.get("constellations", [])}
        total = sum(len(v) for v in changes.values())
        if changes:
            print(f"  TUNING CHANGES ({total} across {len(changes)} constellations):")
            for cid in sorted(changes, key=lambda i: _con_name(n_by_id.get(i, {"id": i}), gametext).lower()):
                print(f"    {_con_name(n_by_id.get(cid, {'id': cid}), gametext)}:")
                for line in changes[cid]:
                    print(f"      {line}")
            print("  NOTE: celestial-power stats are max-rank; a scaling change that keeps the same max is not shown.")
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
