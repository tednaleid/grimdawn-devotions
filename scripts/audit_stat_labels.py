#!/usr/bin/env -S uv run --script
# ABOUTME: Reports candidate Grim Dawn tags for each app-authored stat noun, for hand audit.
# ABOUTME: The game hardcodes stat-id to tag in its engine, so this suggests, it does not decide.
# /// script
# requires-python = ">=3.10"
# ///
"""Put candidate game tags in front of a human for each app-authored stat noun.

Scope is the 64 nouns the app authors itself: stat.override.* and stat.subject.*.
Everything under stat.attr/damage/dot/resist already resolves from the game via
data/stat-tags.json and cannot drift; stat.template/power/group/race/pet are
composed phrases with no single game string to compare against.

Output is a report on stdout. Nothing is written and nothing is committed.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

AUDITED_PREFIXES = ("stat.override.", "stat.subject.")
VALUE_TOKEN = re.compile(r"\{%[^}]*\}")
COLOUR_TOKEN = re.compile(r"\{\^[A-Za-z]\}")
# Words too common to identify a stat; a head noun of "damage" is useful, "of" is not.
STOPWORDS = {"to", "of", "the", "a", "and", "for", "with", "by", "s"}


def strip_tokens(s: str) -> str:
    """Reduce a game format string to its prose: drop value and colour tokens."""
    s = VALUE_TOKEN.sub("", s)
    s = COLOUR_TOKEN.sub("", s)
    s = re.sub(r"^[\s%\-]+|[\s%\-]+$", "", s)
    return re.sub(r"\s{2,}", " ", s).strip()


def head_noun(label: str) -> str:
    """The last significant word of a label, lowercased. "All Damage" -> "damage"."""
    words = [w for w in re.findall(r"[A-Za-z']+", label.lower()) if w not in STOPWORDS]
    return words[-1] if words else ""


def candidates(label: str, tags: dict[str, str]) -> list[tuple[str, str]]:
    """Every (tag, prose) whose text shares the label's head noun, shortest first.

    Shortest first because a bare noun tag is a better label source than a
    sentence that happens to mention the same word.
    """
    noun = head_noun(label)
    if not noun:
        return []
    out: list[tuple[str, str]] = []
    for tag, raw in tags.items():
        prose = strip_tokens(raw)
        if noun in head_noun(prose) or re.search(rf"\b{re.escape(noun)}\b", prose.lower()):
            out.append((tag, prose))
    out.sort(key=lambda p: (len(p[1]), p[0]))
    return out


def load_tags(text_dir: Path) -> dict[str, str]:
    """Every tag=text pair in a language's extracted text directory."""
    tags: dict[str, str] = {}
    for path in sorted(text_dir.rglob("*.txt")):
        for line in path.read_text(encoding="utf-8-sig", errors="replace").splitlines():
            if "=" not in line or line.startswith("//"):
                continue
            tag, _, value = line.partition("=")
            tag = tag.strip()
            if tag:
                tags[tag] = value.strip()
    return tags


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--catalog", type=Path, default=root / "web/src/i18n/app.en.json")
    ap.add_argument("--text-dir", type=Path, default=root / "extracted/text_en")
    ap.add_argument("--max", type=int, default=5, help="candidates shown per label")
    args = ap.parse_args()

    if not args.text_dir.exists():
        print(f"no extracted text at {args.text_dir}; run `just extract` on a machine with the game",
              file=sys.stderr)
        return 2

    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    tags = load_tags(args.text_dir)
    audited = {k: v for k, v in catalog.items() if k.startswith(AUDITED_PREFIXES)}

    print(f"# {len(audited)} app-authored stat nouns against {len(tags)} game tags\n")
    exact = 0
    for key, label in sorted(audited.items()):
        found = candidates(label, tags)
        agree = any(prose.lower() == label.lower() for _, prose in found)
        if agree:
            exact += 1
        mark = "OK " if agree else "?? "
        print(f"{mark}{key}\n    ours: {label!r}")
        for tag, prose in found[: args.max]:
            flag = "==" if prose.lower() == label.lower() else "  "
            print(f"    {flag} {tag}: {prose!r}")
        if not found:
            print("       (no candidate tag shares this head noun)")
        print()
    print(f"# {exact} of {len(audited)} nouns exactly match some game tag's prose")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
