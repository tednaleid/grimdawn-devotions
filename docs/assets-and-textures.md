# Devotion artwork: archives + the `.tex` format (as found in v1.2)

How to get the actual constellation/star *images* out of the game, reverse-
engineered by inspection in this session. Not yet automated (no script ships for
this yet — see "Status"). Re-verify after any patch.

## Where the art lives

The devotion records (`database.arz`, what `just extract` pulls) reference
textures by name, e.g. `ui/skills/devotion/devotion_constellation001_bat.tex`,
but the **images themselves are not in `database.arz`** — they're in a separate
resource archive: `resources/UI.arc`.

- `UI.arc` holds **153** devotion-related entries, including **87** constellation
  art files (`skills/devotion/devotion_constellationNNN_<name>.tex`) plus the
  shared sprites: `devotion_star_{up,down,over,disabled}.tex`,
  `devotion_connector{on,off,disabled}.tex`, `devotion_affinity0{1..5}.tex`, etc.
- List / extract with the game's own `ArchiveTool.exe` (same tool `just extract`
  already uses for `database.arz` / `Text_EN.arc`):

  ```bash
  GD="C:/Program Files (x86)/Steam/steamapps/common/Grim Dawn"
  "$GD/ArchiveTool.exe" "$GD/resources/UI.arc" -list                      # list entries
  "$GD/ArchiveTool.exe" "$GD/resources/UI.arc" -extract <dir> [entry]     # extract one or all
  ```

## Game tools: what works, what doesn't

| Tool | Use here |
|---|---|
| `ArchiveTool.exe` | ✅ extract `.tex` files out of `UI.arc` (`-list`, `-extract`) |
| `TextureCompiler.exe` | ❌ goes the **wrong way** — compiles an image **into** `.tex` |
| `TexViewer.exe` | GUI viewer only; no usable CLI for batch export |
| `AssetManager.exe` | GUI "Extract Game Files"; works but manual |

So there is **no shipped CLI that converts `.tex` → png**. We don't need one —
the format is trivial to decode ourselves (below).

## The `.tex` format

A `.tex` is a 12-byte Grim Dawn wrapper around a standard **DDS** image. First
64 bytes of `devotion_constellation001_bat.tex`:

```
54 45 58 02 00 00 00 00 68 7d 04 00  | "TEX\x02", 4 zero bytes, uint32 dataSize
44 44 53 52 7c 00 00 00 07 10 00 00  | "DDSR", then DDS_HEADER: dwSize=124, dwFlags
ab 00 00 00 ae 01 00 00 ...          | dwHeight=0xab=171, dwWidth=0x1ae=430
```

Layout (offsets into the `.tex` file):

| Offset | Bytes | Meaning |
|---|---|---|
| 0 | `54 45 58 02` | magic `TEX` + version `0x02` |
| 4 | `00 00 00 00` | reserved |
| 8 | uint32 LE | size of the payload that follows |
| 12 | `44 44 53 52` | `"DDSR"` — where a real DDS would have magic `"DDS "` |
| 16 | DDS_HEADER (124 B) | `dwSize=124`, `dwFlags`, `dwHeight`@24, `dwWidth`@28, … |
| 16+80 | `00 00 00 00` | `ddspf.dwFourCC` = 0 → **uncompressed** (no DXT/BC) |
| 16+84 | `20` | `ddspf.dwRGBBitCount` = 32 |
| 128 | pixels | width·height·4 bytes, **BGRA** byte order |

Notes found by inspection:
- The channel masks (`dwR/G/B/ABitMask`) are all **zero**; GD relies on a fixed
  **BGRA** byte order rather than masks. Decoding raw as BGRA gives correct color
  + alpha (verified: alpha range 0–253, RGB 17–255 on the bat).
- The **shape is in the alpha channel** — RGB is roughly a flat glow color. If you
  drop alpha (e.g. let Pillow open it as `RGB`), you get a near-blank rectangle
  (a tell-tale ~300-byte "PNG"). Always keep alpha.
- Payload size matches exactly: 430·171·4 = 294,120 bytes (= file 294,260 − 140
  of headers/wrapper), confirming uncompressed 32-bit.
- Verified uniform across samples: `bat` 430×171, `devotion_star_up` 64×64,
  `devotion_connectoron` 78×16 — all `TEX\x02`, fourCC 0, 32-bit BGRA.

## Converting `.tex` → png (proven recipe)

Reconstruct a valid DDS (drop the 12-byte wrapper, restore the `"DDS "` magic),
then decode the raw BGRA with Pillow:

```python
data = open("constellation.tex", "rb").read()
dds  = b"DDS " + data[16:]            # 12-byte wrapper gone; magic fixed
# DDS = magic(4) + header(124); pixels start at 128
import struct
h = struct.unpack_from("<I", dds, 12)[0]   # dwHeight @ header+8 = dds+12
w = struct.unpack_from("<I", dds, 16)[0]   # dwWidth  @ header+12 = dds+16
from PIL import Image
img = Image.frombytes("RGBA", (w, h), dds[128:], "raw", "BGRA")
img.save("constellation.png")
```

This produced a correct 430×171 RGBA PNG (~155 KB) for the bat. A robust
converter should still branch on `dwFourCC != 0` / DX10 headers in case a future
expansion ships a compressed texture, but nothing in v1.2 devotion art needs it.

## Redistribution / repo policy (important)

These images are **Crate Entertainment's copyrighted game art**. Extracting them
for personal/local use is fine; **committing them to a public repo redistributes
them.** Default plan is therefore to treat extracted art like `extracted/` —
**git-ignored and regenerated locally** (e.g. `just assets` → `data/assets/`,
git-ignored) — and to keep the eventual HTML starmap working from plain SVG
dots/lines (pure `devotions.json`) as the always-available baseline, layering the
real artwork in only when the local assets are present. Committing the PNGs is a
deliberate opt-in, not a default.

## Status

Not yet implemented. Next step would be `scripts/tex2png.py` + a `just assets`
recipe (extract the 87 constellation `.tex` from `UI.arc` via `ArchiveTool`,
convert with the recipe above) writing to a git-ignored `data/assets/devotions/`.
The star positions + `background` image names needed to place these are already
in `devotions.json` (see [dbr-format.md](dbr-format.md)).
