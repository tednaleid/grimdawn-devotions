#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
# ABOUTME: Decodes Grim Dawn .tex textures into raw RGBA bytes.
# ABOUTME: A .tex is a 12-byte wrapper around a DDS whose magic reads DDSR, not "DDS ".
import struct

TEX_HEADER_LEN = 12
_DDS_HEADER_LEN = 124


def decode_tex(raw: bytes) -> tuple[int, int, bytes]:
    """Return (width, height, rgba) for an uncompressed 24- or 32-bit .tex.

    Raises ValueError for anything this cannot decode faithfully. Failing loudly
    matters more than coverage here: a silently wrong icon is worse than a build
    that stops and names the file.
    """
    if len(raw) < TEX_HEADER_LEN or raw[:3] != b"TEX":
        raise ValueError(f"not a TEX file (magic {raw[:4]!r})")
    payload = raw[TEX_HEADER_LEN:]
    if payload[:3] != b"DDS":
        raise ValueError(f"unexpected inner magic {payload[:4]!r}")

    header = payload[4:4 + _DDS_HEADER_LEN]
    if len(header) < _DDS_HEADER_LEN:
        raise ValueError("truncated DDS header")
    height, width = struct.unpack_from("<2I", header, 8)
    bitcount = struct.unpack_from("<I", header, 84)[0]
    if bitcount not in (24, 32):
        raise ValueError(f"unsupported bit count {bitcount} (expected uncompressed 24 or 32)")

    stride = bitcount // 8
    data = payload[4 + _DDS_HEADER_LEN:]
    expected = width * height * stride
    if len(data) < expected:
        raise ValueError(f"truncated pixels: have {len(data)}, need {expected}")

    # Base mip level only. The channel masks in these files are all zero, so the
    # layout cannot be read from the header; it is BGR(A), confirmed against the
    # in-game Summon Hellhound icon. 24-bit icons carry no alpha, so they are
    # fully opaque.
    base = data[:expected]
    rgba = bytearray(b"\xff" * (width * height * 4))
    rgba[0::4] = base[2::stride]
    rgba[1::4] = base[1::stride]
    rgba[2::4] = base[0::stride]
    if stride == 4:
        rgba[3::4] = base[3::4]
    return width, height, bytes(rgba)
