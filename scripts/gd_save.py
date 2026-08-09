#!/usr/bin/env -S uv run --script
# ABOUTME: Read Grim Dawn character saves (player.gdc): decode the obfuscation and report the header.
# ABOUTME: Lists local characters so a build audit can start from a save file instead of a shared link.
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Decode the header of a Grim Dawn character save.

A .gdc file is obfuscated with a keystream seeded from its own first four bytes,
so nothing in it is readable until the whole stream is walked in order. The
decode is exact rather than heuristic: the first decoded word is the ASCII magic
"GDCX", which is the check that the key schedule is right.

Only the header is parsed. Everything after it (inventory, stash, quest state) is
a chain of length-prefixed blocks this script deliberately does not walk, because
the audit gets gear, skills and devotions from the calculator instead - see
docs/grimtools-build-audit.md.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

MAGIC = 0x58434447  # "GDCX", little-endian
SEED_MASK = 0x55555555
KEY_MULT = 39916801
MAX_STRING = 4096  # a header string is a character name or a tag, never longer

# Grim Dawn stores the character's class as one tag whose digits are the two
# mastery numbers concatenated, e.g. tagSkillClassName0306 = Occultist + Shaman.
CLASS_TAG_PREFIX = "tagSkillClassName"

# Where the game keeps saves. Steam Cloud wins on a default install; the
# Documents path is what you get with cloud saves switched off.
SAVE_GLOBS = (
    "Steam/userdata/*/219990/remote/save/main/_*/player.gdc",
    "My Games/Grim Dawn/save/main/_*/player.gdc",
)


class GdcReader:
    """Sequential reader over a .gdc keystream.

    Every read consumes bytes AND advances the key, so reads must happen in file
    order and at the right width: a 32-bit read xors all four bytes against one
    key, while four byte reads advance the key between each. Reading the wrong
    width does not fail, it silently desynchronises everything after it.
    """

    def __init__(self, data: bytes):
        if len(data) < 8:
            raise ValueError("file is too short to be a .gdc save")
        self.data = data
        self.pos = 4
        self.key = int.from_bytes(data[0:4], "little") ^ SEED_MASK
        self.table: list[int] = []
        k = self.key
        for _ in range(256):
            k = ((k >> 1) | (k << 31)) & 0xFFFFFFFF
            k = (k * KEY_MULT) & 0xFFFFFFFF
            self.table.append(k)

    def _advance(self, raw: bytes) -> None:
        for b in raw:
            self.key ^= self.table[b]

    def u8(self) -> int:
        raw = self.data[self.pos]
        self.pos += 1
        value = raw ^ (self.key & 0xFF)
        self._advance(bytes([raw]))
        return value

    def u32(self) -> int:
        raw = self.data[self.pos : self.pos + 4]
        if len(raw) < 4:
            raise ValueError(f"truncated file at offset {self.pos}")
        self.pos += 4
        value = int.from_bytes(raw, "little") ^ self.key
        self._advance(raw)
        return value

    def _length(self) -> int:
        n = self.u32()
        if n > MAX_STRING:
            raise ValueError(f"implausible string length {n} at offset {self.pos}")
        return n

    def ascii_str(self) -> str:
        return "".join(chr(self.u8()) for _ in range(self._length()))

    def wide_str(self) -> str:
        """A UTF-16LE string. The length prefix counts characters, not bytes."""
        return "".join(chr(self.u8() | (self.u8() << 8)) for _ in range(self._length()))


def read_header(path: Path) -> dict:
    """The character header: name, class tag, level, and hardcore flag."""
    r = GdcReader(path.read_bytes())
    magic = r.u32()
    if magic != MAGIC:
        raise ValueError(f"{path}: not a Grim Dawn save (magic 0x{magic:08x}, expected 0x{MAGIC:08x})")
    version = r.u32()
    name = r.wide_str()
    male = r.u8()
    class_tag = r.ascii_str()
    level = r.u32()
    hardcore = r.u8()
    return {
        "path": str(path),
        "name": name,
        "level": level,
        "class_tag": class_tag,
        "mastery_tags": mastery_tags(class_tag),
        "hardcore": bool(hardcore),
        "male": bool(male),
        "version": version,
    }


def mastery_tags(class_tag: str) -> list[str]:
    """The per-mastery tags inside a combined class tag.

    tagSkillClassName0306 -> [tagSkillClassName03, tagSkillClassName06]. A
    single-mastery character carries one pair of digits, and a character with no
    mastery yet carries none.
    """
    if not class_tag.startswith(CLASS_TAG_PREFIX):
        return []
    digits = class_tag[len(CLASS_TAG_PREFIX) :]
    if not digits.isdigit() or len(digits) % 2:
        return []
    return [f"{CLASS_TAG_PREFIX}{digits[i : i + 2]}" for i in range(0, len(digits), 2)]


def describe_class(header: dict, tags: dict[str, str]) -> str:
    """Human-readable class, from the extracted text table when it is available.

    Falls back to the mastery pair, then the raw tag, so this degrades on a
    machine that has never run `just extract` rather than failing.
    """
    combined = tags.get(header["class_tag"])
    if combined:
        parts = [tags[t] for t in header["mastery_tags"] if t in tags]
        return f"{combined} ({' + '.join(parts)})" if len(parts) > 1 else combined
    parts = [tags[t] for t in header["mastery_tags"] if t in tags]
    if parts:
        return " + ".join(parts)
    return header["class_tag"] or "(no mastery)"


def search_roots() -> list[Path]:
    """Directories the save globs are applied under, most specific first."""
    roots: list[Path] = []
    env = os.environ.get("GD_SAVE_DIR")
    if env:
        roots.append(Path(env))
    for var in ("ProgramFiles(x86)", "ProgramFiles"):
        p = os.environ.get(var)
        if p:
            roots.append(Path(p))
    home = Path.home()
    roots += [home / "Documents", home / "OneDrive" / "Documents", home]
    return roots


def find_saves(roots: list[Path] | None = None) -> list[Path]:
    """Every player.gdc under the known save layouts, deduped and sorted."""
    found: dict[str, Path] = {}
    for root in roots if roots is not None else search_roots():
        if not root.is_dir():
            continue
        for pattern in SAVE_GLOBS:
            for hit in root.glob(pattern):
                found.setdefault(str(hit.resolve()).lower(), hit)
        # A GD_SAVE_DIR pointing straight at save/main, or at one character.
        for pattern in ("_*/player.gdc", "player.gdc"):
            for hit in root.glob(pattern):
                found.setdefault(str(hit.resolve()).lower(), hit)
    return sorted(found.values(), key=lambda p: p.parent.name.lower())


def load_tags(text_dir: Path | None = None) -> dict[str, str]:
    """Class-name text from extracted/text_en, or {} when it is not extracted.

    Deliberately not gd_dbr.load_translations, which merges every file in
    filesystem order. The base game ships placeholders for the expansion
    masteries (`tagSkillClassName07=?`, `tagSkillClassName0407=` empty) and the
    expansion files carry the real names, but NTFS returns tagsgdx1_skills.txt
    before tags_skills.txt, so a plain last-writer-wins merge resolves
    Infiltrator back to "Nightblade + ?". A placeholder must never overwrite a
    real name, which is the one rule this loader adds.
    """
    if text_dir is None:
        text_dir = Path(__file__).parent.parent / "extracted" / "text_en"
    if not text_dir.is_dir():
        return {}
    tags: dict[str, str] = {}
    for fp in sorted(text_dir.rglob("*.txt")):
        try:
            text = fp.read_text(encoding="utf-8-sig", errors="replace")
        except OSError:
            continue
        for line in text.splitlines():
            tag, sep, value = line.partition("=")
            if not sep:
                continue
            tag, value = tag.strip(), value.strip()
            if tag.startswith(CLASS_TAG_PREFIX) and value and value != "?":
                tags[tag] = value
    return tags


def headers_for(paths: list[Path]) -> tuple[list[dict], list[str]]:
    """Headers for every readable save, plus one error line per unreadable one."""
    rows: list[dict] = []
    errors: list[str] = []
    for p in paths:
        try:
            rows.append(read_header(p))
        except (OSError, ValueError) as e:
            errors.append(str(e))
    return rows, errors


def main() -> int:
    ap = argparse.ArgumentParser(description="Read Grim Dawn character saves (player.gdc).")
    sub = ap.add_subparsers(dest="cmd")
    p_list = sub.add_parser("list", help="List every local character (the default)")
    p_list.add_argument("--json", action="store_true")
    p_header = sub.add_parser("header", help="Print one save's header")
    p_header.add_argument("file", type=Path)
    p_header.add_argument("--json", action="store_true")
    p_path = sub.add_parser("path", help="Print the save path for a character name")
    p_path.add_argument("name")
    args = ap.parse_args()
    cmd = args.cmd or "list"

    if cmd == "header":
        header = read_header(args.file)
        if args.json:
            print(json.dumps(header, indent=2))
        else:
            tags = load_tags()
            hc = " [hardcore]" if header["hardcore"] else ""
            print(f"{header['name']}  level {header['level']}  {describe_class(header, tags)}{hc}")
        return 0

    saves = find_saves()
    if cmd == "path":
        wanted = args.name.lstrip("_").lower()
        for p in saves:
            if p.parent.name.lstrip("_").lower() == wanted:
                print(p)
                return 0
        print(f"no local character named {args.name!r} (found: {[s.parent.name.lstrip('_') for s in saves]})",
              file=sys.stderr)
        return 1

    rows, errors = headers_for(saves)
    if getattr(args, "json", False):
        print(json.dumps({"characters": rows, "errors": errors}, indent=2))
        return 0

    if not rows:
        print("No Grim Dawn saves found. Set GD_SAVE_DIR to the folder holding your _<name> directories.")
        for e in errors:
            print(f"  {e}", file=sys.stderr)
        return 1

    tags = load_tags()
    if not tags:
        print("(class names unresolved: extracted/text_en missing - run `just extract` on Windows)\n")
    width = max(len(r["name"]) for r in rows)
    for r in rows:
        hc = " [hardcore]" if r["hardcore"] else ""
        print(f"  {r['name']:<{width}}  level {r['level']:>3}  {describe_class(r, tags)}{hc}")
        print(f"  {'':<{width}}  {r['path']}")
    for e in errors:
        print(f"  {e}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
