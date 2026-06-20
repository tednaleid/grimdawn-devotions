#!/usr/bin/env -S uv run --script
# ABOUTME: Extracts devotion .tex textures from UI.arc, decodes, downscales, encodes WebP.
# ABOUTME: Writes assets/devotions/*.webp and a manifest.json the web app reads.
# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow"]
# ///
"""Extract devotion .tex from UI.arc, decode, downscale, and write optimized WebP
plus a manifest the web app reads. Output dir is git-ignored. See
docs/assets-and-textures.md for the .tex format."""
from __future__ import annotations
import argparse, json, subprocess, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from tex2png import tex_to_image  # reuse the proven decoder


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gd-dir", required=True, type=Path)
    ap.add_argument("--out-dir", required=True, type=Path)
    ap.add_argument("--max-dim", type=int, default=512, help="downscale longest side to this")
    ap.add_argument("--quality", type=int, default=85)
    ap.add_argument("--include-nebula", action="store_true")
    args = ap.parse_args(argv)

    arc = args.gd_dir / "resources/UI.arc"
    tool = args.gd_dir / "ArchiveTool.exe"
    if not arc.exists() or not tool.exists():
        print(f"need UI.arc + ArchiveTool under {args.gd_dir}", file=sys.stderr)
        return 2

    listing = subprocess.run([str(tool), str(arc), "-list"], capture_output=True, text=True).stdout
    entries = [ln.strip() for ln in listing.splitlines()
               if ln.strip().lower().startswith("skills/devotion/") and ln.strip().lower().endswith(".tex")]
    if not args.include_nebula:
        entries = [e for e in entries if "nebula" not in e.lower()]

    args.out_dir.mkdir(parents=True, exist_ok=True)
    images: dict[str, str] = {}
    skipped: list[str] = []
    with tempfile.TemporaryDirectory() as td:
        for e in entries:
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
            w, h = img.size
            scale = min(1.0, args.max_dim / max(w, h))
            if scale < 1.0:
                img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))))
            stem = tex.stem
            out = args.out_dir / f"{stem}.webp"
            img.save(out, "WEBP", quality=args.quality, method=6)
            images[f"{stem}.tex"] = f"assets/devotions/{stem}.webp"
            images[f"{stem}.png"] = f"assets/devotions/{stem}.webp"

    (args.out_dir / "manifest.json").write_text(json.dumps({"images": images}, indent=2))
    total = sum(p.stat().st_size for p in args.out_dir.glob("*.webp"))
    converted = len(images) // 2
    print(f"Wrote {converted} images, {total/1_048_576:.1f} MB, manifest -> {args.out_dir}")
    if skipped:
        print(f"{len(skipped)} skipped:", file=sys.stderr)
        for s in skipped:
            print(f"  - {s}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
