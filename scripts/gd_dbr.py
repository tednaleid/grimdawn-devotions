#!/usr/bin/env python3
# ABOUTME: Shared stdlib helpers for reading Grim Dawn .dbr records and translations.
# ABOUTME: Imported by parse_devotions.py and parse_rr.py; no game-domain logic lives here.
from __future__ import annotations

import re
from pathlib import Path


def read_dbr(path: Path) -> dict[str, str]:
    """One .dbr file -> {key: value}. Each line is `key,value,` (trailing comma)."""
    out: dict[str, str] = {}
    try:
        text = path.read_text(encoding="utf-8-sig", errors="replace")
    except OSError:
        return out
    for line in text.splitlines():
        if not line or "," not in line:
            continue
        key, value = line.split(",", 1)
        key = key.strip()
        if not key:
            continue
        # Drop only the single trailing comma the format appends; values may
        # themselves contain commas/semicolons, so don't split further.
        if value.endswith(","):
            value = value[:-1]
        out[key] = value
    return out


def load_translations(text_dir: Path) -> dict[str, str]:
    """Glob every *.txt under text_dir and build tag -> display text."""
    tags: dict[str, str] = {}
    files = list(text_dir.rglob("*.txt"))
    for fp in files:
        try:
            text = fp.read_text(encoding="utf-8-sig", errors="replace")
        except OSError:
            continue
        for line in text.splitlines():
            tag, sep, val = line.partition("=")
            if not sep:
                continue
            tag = tag.strip()
            if tag:
                tags[tag] = val.strip()
    return tags


def clean_text(s: str) -> str:
    """Strip Grim Dawn formatting control codes (^o, ^n, {^...}) from display text."""
    s = re.sub(r"\{\^[a-zA-Z]\}", "", s)
    s = re.sub(r"\^[a-zA-Z]", "", s)
    return s.strip()


def register(key: str, text: str | None, table: dict[str, str]) -> str:
    """Record `text` (cleaned) under `key` in `table` when `text` is truthy.

    `key` is the game tag when one resolved, else a synthesized stable key (see
    callers). Always returns `key`, so callers can inline this while building a
    field's `*_tag`/`*_key` sibling. `table` is the accumulated game_en table
    written to data/i18n/game.en.json.
    """
    if text:
        table[key] = clean_text(text)
    return key


class DB:
    """Resolves `records/...` reference paths against the extracted db root."""

    def __init__(self, records_dir: Path):
        if (records_dir / "records").is_dir():
            self.root = records_dir
        elif records_dir.name == "records" and (records_dir / "ui").is_dir():
            self.root = records_dir.parent
        else:
            self.root = records_dir
        self._cache: dict[str, dict[str, str]] = {}

    def path(self, ref: str) -> Path:
        return self.root / ref.replace("\\", "/")

    def get(self, ref: str) -> dict[str, str]:
        ref = ref.replace("\\", "/").strip()
        if ref not in self._cache:
            self._cache[ref] = read_dbr(self.path(ref))
        return self._cache[ref]

    @property
    def devotion_constellations_dir(self) -> Path:
        return self.root / "records/ui/skills/devotion/constellations"


def as_number(value: str):
    """Parse a scalar .dbr value to int/float, or None if not a single number."""
    v = value.strip()
    if not v or ";" in v:  # level-array values belong to proc skills, not passives
        return None
    try:
        f = float(v)
    except ValueError:
        return None
    r = round(f, 4)
    return int(r) if r == int(r) else r


def level_array_value(value: str, level: int):
    """Select a skill stat value at a 1-based level from a per-level array.

    Most proc-skill stats are semicolon-separated arrays ("10;20;30;..."), one
    entry per level 1..N where N is the skill's granted level and the final entry
    carries the end-of-line bonus. We pick the entry at `level`, clamping to the
    last entry when `level` exceeds the array - the game never scales a stat past
    its defined max, so never extrapolate. For a scalar this is just the number.
    Returns None if the value is not numeric.
    """
    parts = [p for p in value.split(";") if p.strip() != ""]
    if not parts:
        return None
    try:
        nums = [float(p) for p in parts]
    except ValueError:
        return None
    val = nums[min(max(level, 1) - 1, len(nums) - 1)]
    # Keep whole arrays whole (damage, projectiles); allow decimals otherwise.
    if all(float(p) == int(float(p)) for p in parts):
        val = round(val)
    else:
        val = round(val, 4)
    return int(val) if val == int(val) else val
