#!/usr/bin/env -S uv run --script
# ABOUTME: Checks data/monsters.json against grimtools' displayed boss and nemesis resistances.
# ABOUTME: Run: uv run scripts/test_monster_parity.py  (fixture: scripts/fixtures/gt-monster-resistances.json)
# /// script
# requires-python = ">=3.10"
# ///
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
doc = json.loads((root / "data/monsters.json").read_text(encoding="utf-8"))
fixture = json.loads((root / "scripts/fixtures/gt-monster-resistances.json").read_text(encoding="utf-8"))
offsets = doc["difficulty_offsets"]

rows_by_key: dict = {}
for m in doc["monsters"]:
    rows_by_key.setdefault((m["name_tag"], m["classification"]), []).append(m)


def displayed(m: dict, difficulty: str) -> dict:
    """What the page shows at 1 player: base plus the difficulty's flat offset."""
    off = offsets[difficulty]["1"]
    return {k: m["resistances"][k] + off.get(k, 0) for k in m["resistances"]}


failures = 0
for e in fixture["entries"]:
    rows = rows_by_key.get((e["name_tag"], e["classification"]), [])
    if not rows:
        failures += 1
        print(f"  FAIL m{e['gt_id']} {e['name_tag']} ({e['classification']}): no row")
        continue
    for difficulty, want in e["resistances"].items():
        if any(displayed(m, difficulty) == want for m in rows):
            continue
        failures += 1
        closest = min(rows, key=lambda m: sum(abs(displayed(m, difficulty)[k] - want[k]) for k in want))
        diff = {k: (displayed(closest, difficulty)[k], want[k]) for k in want
                if displayed(closest, difficulty)[k] != want[k]}
        print(f"  FAIL m{e['gt_id']} {e['name_tag']} {difficulty}: ours vs grimtools {diff} ({closest['id']})")

print(f"entries: {len(fixture['entries'])}  FAILURES: {failures}")
raise SystemExit(1 if failures else 0)
