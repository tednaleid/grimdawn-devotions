#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
# ABOUTME: Tests the Grim Dawn .tex decoder against synthetic files.
# ABOUTME: No game install needed; every fixture is built in-process.
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from gd_tex import decode_tex  # noqa: E402

FAILURES = 0


def check(label, ok):
    global FAILURES
    if ok:
        print(f"  ok   {label}")
    else:
        print(f"  FAIL {label}")
        FAILURES += 1


def make_tex(width, height, pixels_bgra, magic=b"DDSR", bitcount=32, mips=1):
    """Build a synthetic .tex: 12-byte wrapper + magic + 124-byte DDS header + pixels."""
    header = bytearray(124)
    struct.pack_into("<I", header, 0, 124)          # dwSize
    struct.pack_into("<I", header, 4, 0x1007)       # dwFlags
    struct.pack_into("<I", header, 8, height)
    struct.pack_into("<I", header, 12, width)
    struct.pack_into("<I", header, 24, mips)
    struct.pack_into("<I", header, 76, 0x40)        # ddspf.dwFlags = DDPF_RGB
    struct.pack_into("<I", header, 84, bitcount)    # ddspf.dwRGBBitCount
    payload = magic + bytes(header) + pixels_bgra
    return b"TEX\x02" + b"\x00" * 4 + struct.pack("<I", len(payload)) + payload


# One opaque red pixel, stored BGRA.
red_bgra = bytes([0x00, 0x00, 0xFF, 0xFF])
w, h, rgba = decode_tex(make_tex(1, 1, red_bgra))
check("decodes a 1x1 image", (w, h) == (1, 1))
check("reorders BGRA to RGBA", rgba == bytes([0xFF, 0x00, 0x00, 0xFF]))

# 2x2 keeps row order and length.
px = bytes([1, 2, 3, 4] * 4)
w, h, rgba = decode_tex(make_tex(2, 2, px))
check("decodes a 2x2 image", (w, h) == (2, 2) and len(rgba) == 16)

# Trailing mip levels are ignored; only the base level is returned.
w, h, rgba = decode_tex(make_tex(2, 2, px + b"\xAA" * 4, mips=2))
check("ignores trailing mip data", len(rgba) == 16)

# Everything the decoder cannot decode faithfully must raise, not guess.
for label, blob in (
    ("a non-TEX file", b"NOPE" + b"\x00" * 32),
    ("an unexpected inner magic", make_tex(1, 1, red_bgra, magic=b"JUNK")),
    ("a non-32-bit image", make_tex(1, 1, red_bgra, bitcount=16)),
    ("a truncated pixel buffer", make_tex(4, 4, red_bgra)),
):
    try:
        decode_tex(blob)
        check(f"rejects {label}", False)
    except ValueError:
        check(f"rejects {label}", True)

print(f"FAILURES: {FAILURES}")
raise SystemExit(1 if FAILURES else 0)
