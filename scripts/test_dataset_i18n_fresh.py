#!/usr/bin/env -S uv run --script
# ABOUTME: Guards that the committed locale tables are not stale against the committed datasets:
# ABOUTME: every name tag data/skill-items.json references must resolve in every data/i18n/game.*.json.
# /// script
# requires-python = ">=3.10"
# ///
"""Catch a dataset rebuilt without its locale tables.

`just i18n-tables` reads data/skill-items.json to decide which game tags to resolve, so
re-emitting the dataset without re-running it leaves the new tags absent from all 13
locale files. They then fall through active locale -> English -> raw key and the page
shows `tagClass06SkillName04_Pet` as a skill name in every language.

Nothing in the pipeline enforces the ordering: `just publish-deposit` depends on `derive`
and `q-ae-all`, neither of which re-emits the dataset or the locale tables. This test is
the enforcement, and it runs on committed data alone - no game install, no deposit.

The check is against English specifically. English is the last fallback before the raw
key, so a tag absent there is broken in every language; and since all 13 tables are built
from the same dataset in one run, a stale rebuild leaves a new tag missing from all of
them at once. Splitting "missing everywhere" from "missing in English" would therefore
excuse exactly the case worth catching.
"""
from __future__ import annotations

import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
failures = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global failures
    if ok:
        print(f"  ok   {name}")
    else:
        failures += 1
        print(f"  FAIL {name}{': ' + detail if detail else ''}")


def referenced_tags(dataset: dict) -> set[str]:
    """Every name tag the dataset points at, across all of its tag-bearing collections."""
    tags: set[str] = set()
    for key in ("masteries", "skills", "items"):
        for row in dataset.get(key, []):
            if row.get("name_tag"):
                tags.add(row["name_tag"])
    # Pet blocks hang off a skill and carry their own name plus their abilities' names.
    for skill in dataset.get("skills", []):
        for pet in skill.get("pets", []) or []:
            if pet.get("name_tag"):
                tags.add(pet["name_tag"])
            for row in pet.get("stats", []) or []:
                if row.get("source_name_tag"):
                    tags.add(row["source_name_tag"])
    return tags


def main() -> int:
    dataset_path = root / "data" / "skill-items.json"
    locale_paths = sorted((root / "data" / "i18n").glob("game.*.json"))
    check("skill-items.json exists", dataset_path.is_file())
    check("locale tables exist", len(locale_paths) > 0, f"found {len(locale_paths)}")
    if failures:
        return 1

    dataset = json.loads(dataset_path.read_text(encoding="utf-8"))
    wanted = referenced_tags(dataset)
    check("dataset references name tags", len(wanted) > 0, f"found {len(wanted)}")

    tables = {p.stem.split(".", 1)[1]: json.loads(p.read_text(encoding="utf-8"))
              for p in locale_paths}
    check("english table present", "en" in tables, f"locales: {sorted(tables)}")
    if failures:
        return 1

    missing_en = sorted(t for t in wanted if t not in tables["en"])
    check("english table is current", not missing_en,
          f"{len(missing_en)} tag(s) the dataset references are absent from game.en.json "
          f"(re-emit ran without `just i18n-tables`; run it with the game closed), "
          f"e.g. {missing_en[:4]}")

    # Per-locale shortfalls are reported, not failed. Crate's own text tables are sparse in
    # places (Czech has no tagGDX3WeaponAxeB302, Korean is short a couple), so gating on
    # them would fail forever on upstream data we do not control. English is the gate
    # because it is the last fallback before the raw key.
    for loc in sorted(tables):
        if loc == "en":
            continue
        short = [t for t in wanted if t not in tables[loc] and t in tables["en"]]
        if short:
            print(f"  note {loc}: {len(short)} tag(s) resolve in English but not here "
                  f"(upstream sparsity; English fallback covers them), "
                  f"e.g. {sorted(short)[:3]}")

    print(f"\nchecked {len(wanted)} name tags against {len(tables)} locale tables")
    print(f"FAILURES: {failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
