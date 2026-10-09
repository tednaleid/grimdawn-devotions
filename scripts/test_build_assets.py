#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow"]
# ///
# ABOUTME: Tests build_assets' re-encode decision: a texture is re-encoded only when its source
# ABOUTME: bytes, the encoder settings, or its output file changed. No game install needed.
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build_assets import is_current, source_key  # noqa: E402

FAILURES = 0


def check(label, ok):
    global FAILURES
    if ok:
        print(f"  ok   {label}")
    else:
        print(f"  FAIL {label}")
        FAILURES += 1


SETTINGS = "webp q85 method6 maxdim0"

with tempfile.TemporaryDirectory() as td:
    out = Path(td) / "star.webp"
    out.write_bytes(b"encoded")
    key = source_key(b"texture bytes")
    previous = {"settings": SETTINGS, "textures": {"star": key}}

    check("unchanged source, settings and output is current",
          is_current("star", key, SETTINGS, previous, out))
    check("changed source bytes is not current",
          not is_current("star", source_key(b"patched texture"), SETTINGS, previous, out))
    check("changed encoder settings is not current",
          not is_current("star", key, "webp q90 method6 maxdim0", previous, out))
    check("a missing output file is not current",
          not is_current("star", key, SETTINGS, previous, Path(td) / "gone.webp"))
    check("a texture with no recorded hash is not current",
          not is_current("new", key, SETTINGS, previous, out))
    check("no previous record at all is not current",
          not is_current("star", key, SETTINGS, {}, out))

check("source_key is stable for the same bytes", source_key(b"abc") == source_key(b"abc"))

print(f"FAILURES: {FAILURES}")
sys.exit(1 if FAILURES else 0)
