#!/usr/bin/env -S uv run --script
# ABOUTME: Extracts devotion .tex textures from the base + expansion UI.arc archives, decodes, downscales, encodes WebP.
# ABOUTME: Writes assets/devotions/*.webp and a manifest.json the web app reads.
# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow"]
# ///
"""Extract devotion .tex from UI.arc, decode, downscale, and write optimized WebP
plus a manifest the web app reads. Output dir is git-ignored. See
docs/assets-and-textures.md for the .tex format."""
from __future__ import annotations
import argparse, json, re, subprocess, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from tex2png import tex_to_image  # reuse the proven decoder


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gd-dir", required=True, type=Path)
    ap.add_argument("--out-dir", required=True, type=Path)
    ap.add_argument("--max-dim", type=int, default=0,
                    help="if >0, downscale longest side to this many px (shrinks the file only; "
                         "the manifest always records native size so art stays aligned)")
    ap.add_argument("--quality", type=int, default=85)
    ap.add_argument("--include-nebula", action="store_true")
    args = ap.parse_args(argv)

    tool = args.gd_dir / "ArchiveTool.exe"
    # UI textures live in the base game's UI.arc plus one per expansion (gdx1 = Ashes
    # of Malmouth, gdx2 = Forgotten Gods, gdx3+ = future). Later expansions add and
    # override art (e.g. Forgotten Gods' Lotus and Scarab constellations), so scan in
    # load order and let a later archive win. New expansions are found via the gdx*
    # convention with no change here.
    def gdx_num(p: Path) -> int:
        m = re.search(r"gdx(\d+)", p.as_posix().lower())
        return int(m.group(1)) if m else 0
    arcs = [a for a in [args.gd_dir / "resources/UI.arc"] if a.exists()]
    arcs += sorted(args.gd_dir.glob("gdx*/resources/UI.arc"), key=gdx_num)
    if not arcs or not tool.exists():
        print(f"need resources/UI.arc + ArchiveTool under {args.gd_dir}", file=sys.stderr)
        return 2

    # stem -> (archive, entry); iterate archives in load order so a later expansion
    # replaces an earlier same-named texture and adds its own.
    chosen: dict[str, tuple[Path, str]] = {}
    for arc in arcs:
        listing = subprocess.run([str(tool), str(arc), "-list"], capture_output=True, text=True).stdout
        for ln in listing.splitlines():
            e = ln.strip()
            if not (e.lower().startswith("skills/devotion/") and e.lower().endswith(".tex")):
                continue
            if not args.include_nebula and "nebula" in e.lower():
                continue
            chosen[Path(e).stem] = (arc, e)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    images: dict[str, dict] = {}
    skipped: list[str] = []
    converted = 0
    with tempfile.TemporaryDirectory() as td:
        for stem, (arc, e) in sorted(chosen.items()):
            subprocess.run([str(tool), str(arc), "-extract", td, e], capture_output=True)
            tex = Path(td) / e
            if not tex.exists():
                skipped.append(f"{e}: extraction produced no file")
                continue
            try:
                img = tex_to_image(tex.read_bytes())
            except ValueError as exc:
                skipped.append(f"{e}: {exc}")
                continue
            # Native size is the texture's footprint in the devotion-map coordinate
            # space. The web app renders the <image> at this size so the art aligns
            # with the star positions regardless of how much the file is downscaled.
            native_w, native_h = img.size
            if args.max_dim > 0 and max(native_w, native_h) > args.max_dim:
                scale = args.max_dim / max(native_w, native_h)
                img = img.resize((max(1, round(native_w * scale)), max(1, round(native_h * scale))))
            out = args.out_dir / f"{stem}.webp"
            img.save(out, "WEBP", quality=args.quality, method=6)
            entry = {"url": f"assets/devotions/{stem}.webp", "w": native_w, "h": native_h}
            images[f"{stem}.tex"] = entry
            images[f"{stem}.png"] = entry
            converted += 1

    (args.out_dir / "manifest.json").write_text(json.dumps({"images": images}, indent=2))
    total = sum(p.stat().st_size for p in args.out_dir.glob("*.webp"))
    print(f"Wrote {converted} images, {total/1_048_576:.1f} MB, manifest -> {args.out_dir}")
    if skipped:
        print(f"{len(skipped)} skipped:", file=sys.stderr)
        for s in skipped:
            print(f"  - {s}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
