#!/usr/bin/env -S uv run --script
# ABOUTME: Converts Grim Dawn .tex textures (a TEX wrapper around uncompressed DDS) to PNG.
# ABOUTME: Devotion UI art is BGRA with the figure carried in the alpha channel.
# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow"]
# ///
"""Convert Grim Dawn `.tex` textures to PNG.

A `.tex` is a 12-byte `TEX\\x02` wrapper around a standard DDS image (its magic
swapped from "DDS " to "DDSR"). The devotion UI textures are uncompressed 32-bit
BGRA, with the figure carried in the alpha channel. See
docs/assets-and-textures.md for the full format notes.

Usage:
    uv run scripts/tex2png.py --tex-dir extracted/ui_tex --out-dir data/assets/devotions
    uv run scripts/tex2png.py path/to/one.tex out.png
"""
from __future__ import annotations

import argparse
import struct
import sys
from pathlib import Path

from PIL import Image

TEX_MAGIC = b"TEX\x02"
DDS_HEADER_LEN = 124


def tex_to_image(data: bytes) -> Image.Image:
    """Decode one `.tex` byte blob into a Pillow image (raises ValueError on
    anything we don't yet handle, so the caller can report it cleanly)."""
    if data[:4] != TEX_MAGIC:
        raise ValueError(f"not a TEX\\x02 file (magic {data[:4]!r})")

    # Drop the 12-byte TEX wrapper; restore the standard DDS magic in place of
    # the "DDSR" marker that sits where "DDS " would be.
    dds = b"DDS " + data[16:]
    if dds[4:8] != struct.pack("<I", DDS_HEADER_LEN):
        raise ValueError("missing/!=124 DDS header size; unexpected layout")

    # DDS_HEADER fields are relative to the 4-byte magic.
    height = struct.unpack_from("<I", dds, 12)[0]   # dwHeight  (header+8)
    width = struct.unpack_from("<I", dds, 16)[0]    # dwWidth   (header+12)
    # DDS_PIXELFORMAT starts at header+72 -> dds offset 76.
    pf_flags = struct.unpack_from("<I", dds, 76 + 4)[0]   # dwFlags
    four_cc = dds[76 + 8: 76 + 12]                        # dwFourCC
    bit_count = struct.unpack_from("<I", dds, 76 + 12)[0]  # dwRGBBitCount

    DDPF_FOURCC = 0x4
    if (pf_flags & DDPF_FOURCC) or four_cc.strip(b"\x00"):
        raise ValueError(f"compressed/DX10 texture (fourCC={four_cc!r}); "
                         "needs a BC/DXT decoder, not implemented")

    pixels = dds[4 + DDS_HEADER_LEN:]
    expected = width * height * (bit_count // 8)
    if len(pixels) < expected:
        raise ValueError(f"truncated pixel data: {len(pixels)} < {expected}")
    pixels = pixels[:expected]

    if bit_count == 32:
        return Image.frombytes("RGBA", (width, height), pixels, "raw", "BGRA")
    if bit_count == 24:
        return Image.frombytes("RGB", (width, height), pixels, "raw", "BGR")
    raise ValueError(f"unsupported bit depth {bit_count}")


def convert_file(src: Path, dst: Path) -> None:
    img = tex_to_image(src.read_bytes())
    dst.parent.mkdir(parents=True, exist_ok=True)
    img.save(dst)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Convert Grim Dawn .tex textures to PNG")
    ap.add_argument("--tex-dir", type=Path, help="Directory of .tex files (recursive)")
    ap.add_argument("--out-dir", type=Path, help="Output directory for .png files (flattened by stem)")
    ap.add_argument("single", nargs="?", type=Path, help="A single .tex file (with optional out path)")
    ap.add_argument("single_out", nargs="?", type=Path, help="Output .png for the single file")
    args = ap.parse_args(argv)

    if args.single:
        out = args.single_out or args.single.with_suffix(".png")
        convert_file(args.single, out)
        print(f"Wrote {out}")
        return 0

    if not args.tex_dir or not args.out_dir:
        ap.error("provide --tex-dir and --out-dir, or a single .tex file")

    tex_files = sorted(args.tex_dir.rglob("*.tex"))
    if not tex_files:
        print(f"No .tex files under {args.tex_dir}", file=sys.stderr)
        return 2

    ok = 0
    failures: list[str] = []
    for src in tex_files:
        dst = args.out_dir / (src.stem + ".png")
        try:
            convert_file(src, dst)
            ok += 1
        except Exception as exc:  # report, don't abort the batch
            failures.append(f"{src.name}: {exc}")

    print(f"Converted {ok}/{len(tex_files)} .tex -> png in {args.out_dir}")
    if failures:
        print(f"{len(failures)} failed:", file=sys.stderr)
        for f in failures:
            print("  - " + f, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
