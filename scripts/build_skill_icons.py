#!/usr/bin/env -S uv run --script
# ABOUTME: Extracts skill icons from the game's UI.arc and packs one sprite sheet.
# ABOUTME: Windows-only (needs ArchiveTool.exe and a Grim Dawn install).
# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow"]
# ///
import argparse
import json
import math
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from gd_tex import decode_tex  # noqa: E402

CELL = 32
# "up" is the normal (allocated-capable) icon. "down" is the pressed state and
# "_red" the unaffordable state; neither adds information to a static table.
WANTED_SUFFIX = "up.tex"


def ui_archives(gd_dir: Path) -> list[Path]:
    """Base UI.arc first, then each expansion overlay in version order.

    Base carries class01 through class06 only; Inquisitor, Necromancer,
    Oathkeeper and Berserker icons ship in the gdx overlays. Expansions are
    discovered by the gdx* convention so a future release needs no code change,
    matching how `just extract` layers records and text.
    """
    def gdx_num(p: Path) -> int:
        m = re.search(r"gdx(\d+)", p.as_posix().lower())
        return int(m.group(1)) if m else 0
    found = [gd_dir / "resources" / "UI.arc"]
    found += sorted(gd_dir.glob("gdx*/resources/UI.arc"), key=gdx_num)
    return [p for p in found if p.is_file()]


def extract(archive: Path, tool: Path, dest: Path) -> None:
    # stdin must be closed or ArchiveTool can block waiting on it, the same
    # reason the i18n-tables recipe redirects it.
    subprocess.run([str(tool), str(archive), "-extract", str(dest)],
                   check=True, stdout=subprocess.DEVNULL, stdin=subprocess.DEVNULL)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Pack Grim Dawn skill icons into a sprite sheet")
    ap.add_argument("--gd-dir", required=True, type=Path)
    ap.add_argument("--out-png", required=True, type=Path)
    ap.add_argument("--out-json", required=True, type=Path)
    ap.add_argument("--game-version", default="")
    ap.add_argument("--steam-buildid", default="")
    args = ap.parse_args(argv)

    tool = args.gd_dir / "ArchiveTool.exe"
    archives = ui_archives(args.gd_dir)
    if not tool.is_file() or not archives:
        print(f"ERROR: need {tool} and resources/UI.arc under {args.gd_dir}. "
              f"Set GD_DIR; needs a local Grim Dawn install.", file=sys.stderr)
        return 2

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        for arc in archives:
            extract(arc, tool, root)
        # The extracted tree keeps the leading "ui/" that the skill records use,
        # so a key here is byte-identical to a record's skillUpBitmapName.
        icons_root = root / "ui" / "skills" / "icons"
        found = sorted(p for p in icons_root.rglob("*.tex")
                       if p.name.endswith(WANTED_SUFFIX) and "_red" not in p.name)
        if not found:
            print(f"ERROR: no skill icons under {icons_root} (archive layout changed?)",
                  file=sys.stderr)
            return 2
        # An absent expansion overlay is not an error to ArchiveTool, it just yields
        # fewer icons, so check the ten mastery directories are all present rather
        # than trusting the archive count.
        seen = {p.parent.name for p in found}
        missing = sorted({f"class{n:02d}" for n in range(1, 11)} - seen)
        if missing:
            print(f"ERROR: no icons for {', '.join(missing)}. Expansion UI.arc overlays are "
                  f"missing or failed to extract; layered {len(archives)} archive(s) from {args.gd_dir}.",
                  file=sys.stderr)
            return 2

        decoded = []
        for p in found:
            w, h, rgba = decode_tex(p.read_bytes())
            if (w, h) != (CELL, CELL):
                print(f"ERROR: {p.name} is {w}x{h}, expected {CELL}x{CELL}", file=sys.stderr)
                return 2
            key = p.relative_to(root).as_posix()
            decoded.append((key, Image.frombytes("RGBA", (w, h), rgba)))

    columns = math.ceil(math.sqrt(len(decoded)))
    rows = math.ceil(len(decoded) / columns)
    sheet = Image.new("RGBA", (columns * CELL, rows * CELL), (0, 0, 0, 0))
    index = {}
    for i, (key, img) in enumerate(decoded):
        col, row = i % columns, i // columns
        sheet.paste(img, (col * CELL, row * CELL))
        index[key] = [col, row]

    args.out_png.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.out_png, optimize=True)
    doc = {
        "meta": {
            "game_version": args.game_version,
            "steam_buildid": args.steam_buildid,
            "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "cell": CELL,
        "columns": columns,
        "icons": dict(sorted(index.items())),
    }
    args.out_json.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")

    print(f"  icons packed: {len(decoded)}")
    print(f"  sheet: {sheet.size[0]}x{sheet.size[1]}  "
          f"{args.out_png.stat().st_size / 1024:.1f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
