#!/usr/bin/env -S uv run --script
# ABOUTME: Analyse a scraped grimtools build (scripts/gt_scrape.ts) against this repo's own data.
# ABOUTME: RR ledger, resistance overcap, circuit breakers, monster cross-check, planner link.
# /// script
# requires-python = ">=3.10"
# dependencies = ["duckdb"]
# ///
"""Turn one scraped build into the findings a report is built from.

Every rule here exists because a hand-written regex got it wrong first; see
docs/grimtools-build-audit.md. The parsing functions are pure so
scripts/test_gt_audit.py can pin them without a browser or the game.
"""
from __future__ import annotations

import argparse
import base64
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ELEMENTAL = ("Fire", "Cold", "Lightning")

STACK_RE = re.compile(r"-(\d+)%\s+([A-Za-z& ']+?)\s+Resistance\b")
RED_PCT_RE = re.compile(r"(\d+)%\s+Reduced target's Resistances")
RED_FLAT_RE = re.compile(r"(?<![%\d])\s(\d+)\s+Reduced target's Resistances")
LOW_HEALTH_RE = re.compile(r"Activates when Health drops below\s*(\d+)%")


def current_block(text: str) -> str:
    """The Current Level section of a skill tooltip, and nothing else.

    A grimtools skill tooltip prints "Current Level : N" and "Next Level : N+1" with a
    full stat block under each, then any bound celestial power. Scanning the whole
    tooltip counts every skill's bonuses twice at two different magnitudes, and counts
    the celestial power a second time when dumpDevotion() already reported it.
    """
    if "Current Level" not in text:
        return text
    return text.split("Current Level", 1)[1].split("Next Level", 1)[0]


def find_rr(text: str) -> list[tuple[str, str, int]]:
    """Every (pass, damage type, magnitude) resistance-reduction line in a blob of text."""
    found: list[tuple[str, str, int]] = []
    for line in (text or "").split("\n"):
        s = line.strip()
        for m in STACK_RE.finditer(s):
            found.append(("stacking", m.group(2).strip(), int(m.group(1))))
        for m in RED_PCT_RE.finditer(s):
            found.append(("reduced-percent", "all", int(m.group(1))))
        for m in RED_FLAT_RE.finditer(s):
            found.append(("reduced-flat", "all", int(m.group(1))))
    return found


def collect_rr(build: dict) -> list[dict]:
    """Deduped RR sources across items, skills and devotion powers.

    A celestial power is printed inside the tooltip of the skill it is bound to AND
    returned by dumpDevotion(). Keeping both counts one source twice, so a row that
    duplicates a devotion power's (type, value) is dropped in favour of the power.
    """
    rows: list[dict] = []

    def scan(kind: str, origin: str, text: str) -> None:
        for pass_, typ, val in find_rr(text):
            rows.append({"pass": pass_, "kind": kind, "origin": origin,
                         "type": typ, "value": val})

    for it in build.get("items", []):
        scan("item", it.get("slot", "?"), it.get("details") or "")
    for s in build.get("skills", []):
        if (s.get("level") or 0) > 0:
            scan("skill", s.get("name", "?"), current_block(s.get("details") or ""))
    for d in build.get("devotions", []):
        if d.get("isSkill"):
            scan("devotion power", d.get("name", "?"), current_block(d.get("details") or ""))

    powers = {(r["type"], r["value"]) for r in rows if r["kind"] == "devotion power"}
    return [r for r in rows
            if r["kind"] == "devotion power" or (r["type"], r["value"]) not in powers]


def stacking_totals(rows: list[dict]) -> dict[str, list[tuple[str, int]]]:
    """Per damage type, the sources that sum into the stacking pass.

    "Elemental" resistance reduction applies to Fire, Cold and Lightning individually,
    so it is expanded rather than reported as a type of its own.
    """
    totals: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for r in rows:
        if r["pass"] != "stacking":
            continue
        targets = ELEMENTAL if r["type"] == "Elemental" else (r["type"],)
        for t in targets:
            totals[t].append((r["origin"], r["value"]))
    return dict(totals)


def apply_ledger(r0: float, stacking: float, max_percent: float, max_flat: float) -> float:
    """The target's resistance after all three passes (web/src/rr/core/ledger.ts).

    The multiplicative pass only shrinks resistance that is still positive, so once
    stacking has driven a resistance to zero it contributes nothing at all.
    """
    base = r0 - stacking
    reduced = base * (1 - max_percent / 100) if base > 0 else base
    return reduced - max_flat


def split_devotions(build: dict) -> tuple[list[dict], list[dict]]:
    """Plain stars and celestial-power stars, split on dumpDevotion()'s isSkill flag.

    Splitting by name instead looks right until a constellation and a power share one
    (Tsunami is both), at which point every star of that constellation collapses onto
    the single power star.
    """
    stars = [d for d in build.get("devotions", []) if not d.get("isSkill")]
    powers = [d for d in build.get("devotions", []) if d.get("isSkill")]
    return stars, powers


def circuit_breakers(build: dict) -> list[dict]:
    """Effects that fire on low health, plus the on-hit procs that serve the same role."""
    out = []
    seen = set()

    def add(source: str, name: str, text: str, trigger: str) -> None:
        key = (name, trigger)
        if key in seen:
            return
        seen.add(key)
        detail = [l.strip() for l in text.split("\n") if l.strip()][:8]
        out.append({"source": source, "name": name, "trigger": trigger, "detail": detail})

    for it in build.get("items", []):
        det = it.get("details") or ""
        for m in LOW_HEALTH_RE.finditer(det):
            add(f"item:{it.get('slot')}", it.get("details", "").split("\n")[0].strip(),
                det[max(0, m.start() - 400):m.end() + 200], f"health below {m.group(1)}%")
    for d in build.get("devotions", []):
        if not d.get("isSkill"):
            continue
        det = d.get("details") or ""
        m = LOW_HEALTH_RE.search(det)
        if m:
            add("devotion", d.get("name", "?"), det, f"health below {m.group(1)}%")
        elif re.search(r"Chance when Hit", det):
            trig = re.search(r"(\d+)% Chance when Hit", det)
            add("devotion", d.get("name", "?"), det,
                f"{trig.group(1)}% when hit" if trig else "when hit")
    return out


# Roughly the cushion worth holding: enough to absorb the resistance reduction enemies
# apply, past which more overcap stops paying for itself. Judged at Ultimate, which has
# already subtracted 50 from every resistance before the cap.
USEFUL_CUSHION = 30


def resistance_report(build: dict, state: str = "sustained") -> list[dict]:
    """Each resistance with its cushion in every captured buff state, and a verdict.

    The panel only shows the capped value, so this is the table that decides where gear
    budget is being wasted and where it is load-bearing - which is invisible without it.
    """
    states = build.get("states") or {}
    order = [s for s in ("asShared", "sustained", "everything") if s in states]
    base = states.get(state) or states.get("asShared") or {}
    rows = []
    for res, cell in (base.get("overcap") or {}).items():
        if cell is None:
            continue
        over = {s: (states[s]["overcap"].get(res) or {}).get("over", 0) for s in order}
        judged = over.get(state, 0)
        shown = cell.get("shown", "")
        capped = "%" in shown and not shown.startswith("0")
        if not capped or judged <= 0:
            verdict = "UNDER CAP" if judged <= 0 else "thin"
        elif judged < USEFUL_CUSHION:
            verdict = "on the line"
        elif judged < USEFUL_CUSHION * 3:
            verdict = "comfortable"
        else:
            verdict = "reclaimable"
        rows.append({"resistance": res, "shown": shown, "over": over, "verdict": verdict})
    return rows


def encode_bitset(selected: set[str], order: list[str]) -> str:
    """Trailing-trimmed LSB-first bitset, base64url unpadded (web/src/core/urlState.ts)."""
    last = max((i for i, k in enumerate(order) if k in selected), default=-1)
    if last < 0:
        return ""
    out = bytearray((last // 8) + 1)
    for i, k in enumerate(order):
        if i <= last and k in selected:
            out[i // 8] |= 1 << (i % 8)
    return base64.urlsafe_b64encode(bytes(out)).decode().rstrip("=")


def _magnitudes(s: str) -> Counter:
    return Counter(abs(float(x)) for x in re.findall(r"-?\d+(?:\.\d+)?", s))


def map_devotions(build: dict, devotions: dict,
                  text: dict[str, str]) -> tuple[set[str], list[str], list[str]]:
    """Map scraped stars onto our star ids; returns (selected, unmatched, canonical order).

    Complete constellations are unambiguous. A partial one is resolved star by star by
    comparing the multiset of magnitudes in the tooltip against our structured bonuses.
    """
    canonical: list[str] = []
    meta: dict[str, dict] = {}
    by_constellation: dict[str, list[str]] = defaultdict(list)
    power_star: dict[str, str] = {}
    for c in devotions["constellations"]:
        cname = text.get(c["name_tag"], c["name_tag"])
        for s in c["stars"]:
            sid = f"{c['id']}:{s['index']}"
            canonical.append(sid)
            meta[sid] = {"constellation": cname, "bonuses": s.get("bonuses") or {}}
            by_constellation[cname].append(sid)
            cp = s.get("celestial_power")
            if cp:
                power_star[text.get(cp["name_tag"], cp["name_tag"])] = sid

    stars, powers = split_devotions(build)
    selected: set[str] = set()
    unmatched: list[str] = []
    for p in powers:
        sid = power_star.get(p["name"]) or power_star.get(p["name"].split(" (")[0])
        if sid:
            selected.add(sid)
        else:
            unmatched.append(f"power {p['name']}")

    his: dict[str, list[dict]] = defaultdict(list)
    for d in stars:
        his[d["name"]].append(d)

    for cname, group in his.items():
        pool = [s for s in by_constellation.get(cname, []) if s not in selected]
        if not pool:
            unmatched.extend(f"{cname} (constellation not found)" for _ in group)
            continue
        if len(group) == len(pool):
            selected.update(pool)
            continue
        for st in group:
            want = _magnitudes((st.get("details") or "").split("Affinity Requirement")[0])
            best, best_score = None, -1.0
            for sid in pool:
                have = _magnitudes(json.dumps(list(meta[sid]["bonuses"].values())))
                score = sum((want & have).values()) - 0.01 * len(have - want)
                if score > best_score:
                    best, best_score = sid, score
            if best is None or best_score <= 0:
                unmatched.append(f"{cname}: {(st.get('details') or '')[:60]}")
                continue
            selected.add(best)
            pool.remove(best)
    return selected, unmatched, canonical


def monster_check(monsters: dict, totals: dict[str, list[tuple[str, int]]],
                  difficulty: str = "ultimate", tier: str = "4") -> list[dict]:
    """How many real targets still have positive resistance after his stacking RR.

    Resistances in data/monsters.json are BASE values; the per-difficulty offsets are a
    separate table and must be added, or every Elite/Ultimate answer is too optimistic.
    """
    offsets = monsters["difficulty_offsets"][difficulty][tier]
    tough = [m for m in monsters["monsters"]
             if not m["is_summon"]
             and m["classification"] in ("Boss", "Hero", "Quest", "SuperBoss", "Champion")]
    key = {"Poison & Acid": "poison", "Vitality": "vitality", "Pierce": "pierce",
           "Cold": "cold", "Fire": "fire", "Lightning": "lightning",
           "Aether": "aether", "Chaos": "chaos", "Bleeding": "bleeding",
           "Physical": "physical"}
    rows = []
    for typ, entries in totals.items():
        col = key.get(typ)
        if not col:
            continue
        stack = sum(v for _, v in entries)
        off = offsets.get(col, 0)
        values = [m["resistances"].get(col, 0) + off for m in tough]
        rows.append({"type": typ, "stacking": stack, "targets": len(values),
                     "still_positive": sum(1 for v in values if v > stack),
                     "max": max(values)})
    return sorted(rows, key=lambda r: -r["stacking"])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("build", type=Path, help="JSON written by scripts/gt_scrape.ts")
    ap.add_argument("--repo", type=Path, default=Path(__file__).resolve().parent.parent)
    ap.add_argument("--json", action="store_true", help="emit findings as JSON")
    args = ap.parse_args()

    build = json.loads(args.build.read_text(encoding="utf-8"))
    repo = args.repo
    devotions = json.loads((repo / "data/devotions.json").read_text(encoding="utf-8"))
    monsters = json.loads((repo / "data/monsters.json").read_text(encoding="utf-8"))

    import duckdb  # only needed for the label table
    con = duckdb.connect()
    labels_path = repo / "data/deposit/labels.parquet"
    text: dict[str, str] = {}
    if labels_path.is_file():
        text = dict(con.execute(
            "SELECT tag, text FROM read_parquet(?) WHERE locale = 'en'",
            [str(labels_path)]).fetchall())
    else:
        game = repo / "data/i18n/game.en.json"
        if game.is_file():
            blob = json.loads(game.read_text(encoding="utf-8"))
            text = blob.get("tags", blob)

    rows = collect_rr(build)
    totals = stacking_totals(rows)
    max_pct = max([r["value"] for r in rows if r["pass"] == "reduced-percent"] or [0])
    max_flat = max([r["value"] for r in rows if r["pass"] == "reduced-flat"] or [0])
    selected, unmatched, canonical = map_devotions(build, devotions, text)
    stars, powers = split_devotions(build)
    bits = encode_bitset(selected, canonical)
    cap = len(build.get("devotions", []))

    findings = {
        "url": build.get("url"),
        "class": build.get("className"),
        "level": (build.get("bio") or {}).get("level"),
        "gameVersion": build.get("gameVersion"),
        "dataVersion": devotions.get("meta", {}).get("game_version"),
        "difficulty": build.get("difficulty"),
        "difficultyAsShared": build.get("difficultyAsShared"),
        "buffStates": {k: v.get("header") for k, v in (build.get("states") or {}).items()},
        "resistances": resistance_report(build),
        "rrSources": rows,
        "rrStacking": {k: sum(v for _, v in e) for k, e in totals.items()},
        "rrMaxPercent": max_pct,
        "rrMaxFlat": max_flat,
        "monsterCheck": monster_check(monsters, totals),
        "circuitBreakers": circuit_breakers(build),
        "devotionStars": len(stars),
        "devotionPowers": len(powers),
        "devotionMatched": len(selected),
        "devotionUnmatched": unmatched,
        "plannerHash": f"#p={cap}&s={bits}",
        "plannerBaselineHash": f"#p={cap}&s={bits}&cs={bits}&cp={cap}",
    }

    if args.json:
        print(json.dumps(findings, indent=1))
        return 0

    f = findings
    print(f"{f['class']} level {f['level']} - {f['url']}")
    print(f"  build made in game {f['gameVersion']}; repo data is {f['dataVersion']}")
    print(f"  buff states: {' -> '.join(str(v) for v in f['buffStates'].values())}")
    if f["difficulty"] and f["difficulty"] != "Ultimate":
        print(f"  WARNING: read at {f['difficulty']}, not Ultimate - cushions below are too high")
    print()
    cols = [s for s in ("asShared", "sustained", "everything")
            if any(s in r["over"] for r in f["resistances"])]
    print(f"RESISTANCE CUSHIONS at {f['difficulty'] or '?'}"
          f" (verdict judged on 'sustained' against a useful target of +{USEFUL_CUSHION})")
    print(f"  {'resistance':25}{'shown':>7}" + "".join(f"{c:>12}" for c in cols) + "   verdict")
    for r in f["resistances"]:
        cells = "".join(f"{r['over'].get(c, 0):>+12}" for c in cols)
        print(f"  {r['resistance']:25}{r['shown']:>7}{cells}   {r['verdict']}")
    print()
    print("RESISTANCE REDUCTION (stacking pass sums; the other two take the highest only)")
    for typ, entries in sorted(totals.items(), key=lambda kv: -sum(v for _, v in kv[1])):
        srcs = " + ".join(f"{o} {v}" for o, v in entries)
        print(f"  {typ:16} -{sum(v for _, v in entries):>3}%   {srcs}")
    print(f"  highest reduced-percent {max_pct}%, highest reduced-flat {max_flat}")
    print()
    print("TARGETS STILL POSITIVE AFTER STACKING (Boss/Hero/Champion/SuperBoss, ultimate t4)")
    for r in f["monsterCheck"]:
        print(f"  {r['type']:16} -{r['stacking']:>3}%   {r['still_positive']:>4} of {r['targets']}"
              f"   (highest in game {r['max']})")
    print()
    print("CIRCUIT BREAKERS AND ON-HIT SUSTAIN")
    for cb in f["circuitBreakers"]:
        print(f"  {cb['name']} [{cb['trigger']}] ({cb['source']})")
    print()
    print(f"DEVOTIONS  {f['devotionStars']} stars + {f['devotionPowers']} powers, "
          f"{f['devotionMatched']} mapped")
    if unmatched:
        print("  UNMATCHED:")
        for u in unmatched:
            print(f"    {u}")
    print(f"  planner: {f['plannerHash']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
