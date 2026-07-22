#!/usr/bin/env -S uv run --script
# ABOUTME: Cross-checks data/resistance-reduction.json against the desktop prototype's 33 rows.
# ABOUTME: A report, not a test: our record-read values legitimately differ from community numbers.
# /// script
# requires-python = ">=3.10"
# ///
"""Diff the extracted RR catalogue against the prototype's hand-sourced DATA array.

Resolves our localizable name keys to English via the extracted text tables, then
matches each prototype row by name and prints our value vs. theirs, plus any
prototype row we did not find (a real coverage gap or a prototype error).

Run: uv run scripts/compare_rr_prototype.py
"""
import importlib.util
import json
import re
import sys
from pathlib import Path

here = Path(__file__).parent
root = here.parent
gd = importlib.util.spec_from_file_location("gd", here / "gd_dbr.py")
gd_mod = importlib.util.module_from_spec(gd)
gd.loader.exec_module(gd_mod)

RR_MAP = {"stack": "stacking", "mult": "reduced-percent", "flat": "reduced-flat"}


def load_prototype_rows(html: str):
    """Extract {name, rr, value} from the prototype's `const DATA = [...]` array."""
    rows = []
    for block in re.findall(r"\{[^{}]*rr:\"[^\"]+\"[^{}]*\}", html):
        name = re.search(r'name:"([^"]*)"', block)
        rr = re.search(r'rr:"(stack|mult|flat)"', block)
        value = re.search(r"value:(-?\d+)", block)
        if name and rr:
            rows.append({
                "name": name.group(1).replace("\\u2019", "’"),
                "rr": RR_MAP[rr.group(1)],
                "value": int(value.group(1)) if value else None,
            })
    return rows


def main() -> int:
    data = json.loads((root / "data/resistance-reduction.json").read_text(encoding="utf-8"))
    tags = gd_mod.load_translations((root / "extracted/text_en").resolve())

    # Resolve each source's name key -> English; index by lowercased English name.
    by_name: dict[str, list] = {}
    for s in data["sources"]:
        en = gd_mod.clean_text(tags.get(s["name"], s["name"]))
        by_name.setdefault(en.lower(), []).append(s)

    proto = load_prototype_rows((root / ".llm/grim-dawn-rr_1.html").read_text(encoding="utf-8"))
    print(f"prototype rows: {len(proto)}   our sources: {len(data['sources'])}\n")

    found = missing = 0
    print(f"{'PROTOTYPE':30} {'TYPE':16} {'THEIRS':>7} {'OURS':>7}  MATCH")
    for r in proto:
        ours = by_name.get(r["name"].lower(), [])
        same_type = [s for s in ours if s["rr_type"] == r["rr"]]
        if same_type:
            found += 1
            our_v = same_type[0]["value_at_max"]
            flag = "" if our_v == r["value"] else "  <-- value differs"
            print(f"{r['name'][:30]:30} {r['rr']:16} {str(r['value']):>7} {str(our_v):>7}{flag}")
        elif ours:
            found += 1
            print(f"{r['name'][:30]:30} {r['rr']:16} {str(r['value']):>7} {'?':>7}  <-- type differs (ours: {ours[0]['rr_type']})")
        else:
            missing += 1
            print(f"{r['name'][:30]:30} {r['rr']:16} {str(r['value']):>7} {'MISSING':>7}")

    print(f"\nmatched {found}/{len(proto)} prototype rows; {missing} not found by name.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
