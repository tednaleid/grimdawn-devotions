# Skill Item Dataset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data half of the `/items/` skill item finder: three new derived
parquet tables, a committed skill-icon sprite sheet, and the committed
`data/skill-items.json` that the page will render.

**Architecture:** Extend `just derive` (`scripts/build_derived.py`) with
`skills`, `skill_ranks`, and `skill_modifiers` tables built by SQL over the raw
deposit, sharing one link-walking resolver. A new `just skill-icons` recipe
extracts and decodes skill icons from the game's `UI.arc`. A new
`just skill-items` recipe emits the committed page dataset from the derived
tables. No page code in this plan; the page is a separate plan that consumes
`data/skill-items.json` and `data/skill-icons.png`.

**Tech Stack:** Python 3 with uv shebangs, DuckDB, Pillow (icons only), `just`
recipes, parquet, ArchiveTool.exe (Windows, game install required).

Design spec: [docs/superpowers/specs/2026-08-15-skill-item-finder-page-design.md](../specs/2026-08-15-skill-item-finder-page-design.md)

**One deliberate deviation from the spec's testing section.** The spec asks for
Python legs in `just test-scripts` covering the resolver, the grouping rule and
the array clamp. Those three are implemented in SQL inside `just derive`, and
this repo has no unit-test suite for the derived pipeline: it is proven by
oracle-gated acceptance queries under `scripts/derived_queries/`, which fail on
zero rows and on pin mismatch alike. This plan follows that established pattern
(AE12 through AE15) rather than introducing a parallel Python harness for SQL.
The one genuinely pure-Python piece, the `.tex` decoder, does get a Python test.

## Global Constraints

- Every code file starts with two `# ABOUTME: ` (or `// ABOUTME: `) comment lines.
- Never use `--no-verify` when committing. The pre-commit hook runs `just check`.
- Prefer `just` recipes over invoking tools directly; add to the justfile rather
  than bypassing it.
- Generated parquet is NEVER committed. `data/derived/` is released via
  `just publish-deposit` and pinned by `deposit.lock`.
- Committed datasets under `data/` ARE committed and must build anywhere.
- Docs and comments: no emojis, no emdashes, no hyperbole.
- Python scripts are uv-shebang standalone scripts, matching the existing
  `scripts/*.py` style. The exact header order every sibling script uses is:
  shebang, then the two `# ABOUTME: ` lines, then the `# /// script` metadata
  block with `requires-python = ">=3.10"`. Do not reorder these.
- Extraction recipes that need the game installed are Windows-only and must
  fail loudly with a clear message when the game is absent, like `just extract`.
- All numbers in this plan are measured at Steam build 24756825 (game 1.3.0.7),
  which is the currently committed baseline and the release pinned by
  `deposit.lock` (`deposit-24756825.1`).
- Adding a derived table requires updating BOTH `scripts/dataset_release.py`
  `ASSETS` and `scripts/gditems_duckdb.py` `DERIVED_TABLES`.
  `scripts/test_dataset_release.py` cross-checks them in both directions and
  will fail if you update only one.
- Two justfile comments count the acceptance recipes by hand and go stale as
  this plan adds four: the header above `_q-derived` ("all nine below") and the
  one above `q-ae-all` ("All eleven derived acceptance queries"). Update both in
  the task that adds the last recipe (Task 6) so the final state reads
  correctly, rather than editing them four times.

---

### Task 1: Grim Dawn `.tex` decoder

A `.tex` file is a 12-byte wrapper around a DDS whose 4-byte magic reads `DDSR`
instead of `DDS `. The icons are uncompressed 32-bit BGRA with all four channel
masks set to zero, which is why Pillow's own DDS plugin decodes them to solid
black. This task builds a decoder with no game dependency, tested against a
synthetic file.

**Files:**
- Create: `scripts/gd_tex.py`
- Test: `scripts/test_gd_tex.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `decode_tex(raw: bytes) -> tuple[int, int, bytes]` returning
  `(width, height, rgba_bytes)` where `rgba_bytes` is `width * height * 4` bytes
  in RGBA order. Raises `ValueError` on any file it cannot decode faithfully.
  Also `TEX_HEADER_LEN = 12`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test_gd_tex.py`:

```python
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run scripts/test_gd_tex.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'gd_tex'`

- [ ] **Step 3: Write the decoder**

Create `scripts/gd_tex.py`:

```python
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
    """Return (width, height, rgba) for an uncompressed 32-bit .tex.

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
    if bitcount != 32:
        raise ValueError(f"unsupported bit count {bitcount} (expected uncompressed 32)")

    data = payload[4 + _DDS_HEADER_LEN:]
    expected = width * height * 4
    if len(data) < expected:
        raise ValueError(f"truncated pixels: have {len(data)}, need {expected}")

    # Base mip level only. The channel masks in these files are all zero, so the
    # layout cannot be read from the header; it is BGRA, confirmed against the
    # in-game Summon Hellhound icon.
    base = data[:expected]
    rgba = bytearray(expected)
    rgba[0::4] = base[2::4]
    rgba[1::4] = base[1::4]
    rgba[2::4] = base[0::4]
    rgba[3::4] = base[3::4]
    return width, height, bytes(rgba)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run scripts/test_gd_tex.py`
Expected: all `ok`, `FAILURES: 0`, exit 0

- [ ] **Step 5: Confirm the suite picks it up**

`just test-scripts` globs `scripts/test_*.py`, so no registration is needed.

Run: `just test-scripts`
Expected: `--- test_gd_tex.py` appears in the output and the run exits 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/gd_tex.py scripts/test_gd_tex.py
git commit -m "feat(icons): decode Grim Dawn .tex textures to RGBA"
```

---

### Task 2: `just skill-icons` sprite sheet

Extract the skill icons from `UI.arc` and pack them into one committed sprite
sheet. Windows-only, like `just extract`.

**Files:**
- Create: `scripts/build_skill_icons.py`
- Modify: `justfile` (add the `skill-icons` recipe to the `deposit` group)
- Create (generated, committed): `data/skill-icons.png`, `data/skill-icons.json`

**Interfaces:**
- Consumes: `gd_tex.decode_tex` from Task 1, after this task extends it (Step 0).
- Produces: `data/skill-icons.json`, shape
  `{"meta": {...}, "cell": 32, "columns": N, "icons": {"<archive path>": [col, row]}}`
  where the archive path is exactly as it appears in the extracted tree,
  **including the leading `ui/`**, for example
  `ui/skills/icons/class03/skillicon_hellhoundsummon1up.tex`. That is
  byte-identical to the `skillUpBitmapName` value on the skill record, so Task 4
  joins on it directly with no string surgery.

**Three corrections to the original design, all established empirically:**

1. **The extracted tree keeps the `ui/` prefix.** An earlier reading of
   `ArchiveTool -list` output suggested the archive stripped it. Extracting for
   real produces `ui/skills/icons/...`, which is what the skill records
   reference. Do not strip anything.
2. **Expansion archives must be layered.** Base `resources/UI.arc` contains
   class01 through class06 only. Inquisitor, Necromancer, Oathkeeper and
   Berserker icons live in `gdx1/`, `gdx2/` and `gdx3/` `resources/UI.arc`.
   Layer them in order, exactly as `just extract` layers records and text, or
   four masteries have no icons at all.
3. **138 of the 671 icons are 24-bit,** including real mastery skills
   (`class03/skillicon_curse1up.tex`, `class03/skillicon_possession1up.tex`).
   Task 1's decoder raises on anything but 32-bit, so it must learn 24-bit
   first. That is Step 0 below.

Measured at build 24756825: 671 `*up.tex` icons under `ui/skills/icons/`
excluding the `_red` variants, every one 32x32, 533 at 32-bit and 138 at 24-bit.

- [ ] **Step 0: Teach the decoder 24-bit, with tests**

24-bit `.tex` files store BGR with no alpha channel. In `scripts/gd_tex.py`,
replace the bit-count guard:

```python
    if bitcount not in (24, 32):
        raise ValueError(f"unsupported bit count {bitcount} (expected uncompressed 24 or 32)")
```

and replace the pixel-expansion block that follows it:

```python
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
```

Add these cases to `scripts/test_gd_tex.py`, keeping the existing ones. Note the
existing `make_tex` helper already takes a `bitcount` argument:

```python
# 24-bit BGR: one opaque red pixel, no alpha channel stored.
w, h, rgba = decode_tex(make_tex(1, 1, bytes([0x00, 0x00, 0xFF]), bitcount=24))
check("decodes a 24-bit image", (w, h) == (1, 1))
check("24-bit reorders BGR to RGB", rgba[:3] == bytes([0xFF, 0x00, 0x00]))
check("24-bit is fully opaque", rgba[3] == 0xFF)

# 24-bit truncation is still rejected.
try:
    decode_tex(make_tex(4, 4, bytes([0x00, 0x00, 0xFF]), bitcount=24))
    check("rejects a truncated 24-bit buffer", False)
except ValueError:
    check("rejects a truncated 24-bit buffer", True)
```

The existing "rejects a non-32-bit image" case uses `bitcount=16`, which is
still rejected, so it stays valid unchanged.

Run: `uv run scripts/test_gd_tex.py`
Expected: all checks pass, `FAILURES: 0`.

- [ ] **Step 1: Write the builder**

Create `scripts/build_skill_icons.py`:

```python
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
    found = [gd_dir / "resources" / "UI.arc"]
    found += [p / "resources" / "UI.arc" for p in sorted(gd_dir.glob("gdx*"))]
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
```

- [ ] **Step 2: Add the justfile recipe**

Add to `justfile`, in the `deposit` group beside `extract`:

```just
# Pack the game's skill icons into a committed sprite sheet (Windows; needs the game)
[group("deposit")]
skill-icons: _require-game-closed
    #!/usr/bin/env bash
    set -euo pipefail
    read -r buildid version < <(just _game-version)
    uv run scripts/build_skill_icons.py --gd-dir "{{gd_dir}}" \
        --out-png "{{justfile_directory()}}/data/skill-icons.png" \
        --out-json "{{justfile_directory()}}/data/skill-icons.json" \
        --game-version "$version" --steam-buildid "$buildid"
```

- [ ] **Step 3: Run it**

Run: `just skill-icons`
Expected: `icons packed: 671` and a 26x26 grid (832x832). That is every
`*up.tex` under `ui/skills/icons/` across the four archive layers, excluding the
`_red` variants, measured at build 24756825. The 315 mastery skills reference
277 of them; the rest are item, rune, potion and shrine skill icons that cost
almost nothing to carry and spare the page a missing-icon failure if a skill
outside the mastery trees is ever shown.

If the count differs, stop and reconcile before committing: a changed count
means the game changed its icon set. In particular a count near 400 means the
expansion overlays were not layered.

- [ ] **Step 4: Verify a known icon decodes to real image content**

Run:

```bash
uv run - <<'PY'
import json
from PIL import Image
doc = json.load(open("data/skill-icons.json"))
col, row = doc["icons"]["ui/skills/icons/class03/skillicon_hellhoundsummon1up.tex"]
c = doc["cell"]
sheet = Image.open("data/skill-icons.png")
tile = sheet.crop((col*c, row*c, col*c+c, row*c+c))
print("distinct colors:", len(tile.getcolors(maxcolors=99999) or []))
PY
```

Expected: several hundred distinct colors, not 1. A count of 1 means the BGRA
reorder or the sheet paste is wrong.

- [ ] **Step 5: Commit**

```bash
git add scripts/build_skill_icons.py justfile data/skill-icons.png data/skill-icons.json
git commit -m "feat(icons): pack skill icons from UI.arc into a committed sprite sheet"
```

---

### Task 3: The link-walking resolver

Skill records are often thin shells. From any starting record, follow either
`buffSkillName` or `petSkillName` repeatedly until a record carrying
`skillDisplayName` is reached. The walk must be iterative, not an ordered
direct-then-buff-then-pet rule: six pet-modifier nodes chain `petSkillName` and
then `buffSkillName`, and an ordered rule leaves them unresolved.

This task adds the resolver as a persisted derived table plus an acceptance
query that pins its coverage.

**It must be a real parquet table, not a temp table.** `_q-derived` runs each
acceptance query in a separate process whose `register_derived()` globs
`data/derived/*.parquet`; a temp table created inside `build_derived.py`'s own
connection is invisible there. Every other AE query works only because its table
is persisted. Persisting also keeps AE12 honest: it tests the shipped artifact
rather than a re-derivation of the same logic. The table is independently useful
beyond this plan, since it is what lets any consumer turn a skill record into
the record that actually carries its name and stats.

**Files:**
- Modify: `scripts/build_derived.py` (add `build_skill_effect_map`, call it from
  `cmd_build` before the new table builders)
- Modify: `scripts/dataset_release.py` (`ASSETS`)
- Modify: `scripts/gditems_duckdb.py` (`DERIVED_TABLES`)
- Create: `scripts/derived_queries/ae12_skill_effect_walk.sql`
- Modify: `justfile` (add `q-ae12-skill-effect-walk` and add it to `q-ae-all`)

**Interfaces:**
- Consumes: the `facts` view from the deposit.
- Produces: `skill_effect.parquet` and a same-named temp table, columns
  `(skill_record VARCHAR, effect_record VARCHAR, hops INTEGER)`, covering every
  record reachable as a walk root. Tasks 4, 5 and 6 all read it.

- [ ] **Step 1: Write the resolver**

Add to `scripts/build_derived.py`, after `build_boosts`:

```python
# ---------------------------------------------------------------------------
# skill effect resolution
# ---------------------------------------------------------------------------

def build_skill_effect_map(con: duckdb.DuckDBPyConnection) -> int:
    """Map every skill-ish record to the record that actually carries its stats.

    Skill records are frequently thin shells: a tree node may hold nothing but a
    buffSkillName pointing at the record with the display name, icon, caps and
    per-rank arrays. The walk must be iterative rather than an ordered
    direct/buff/pet rule, because chains mix the two link types: six pet-modifier
    nodes go petSkillName and then buffSkillName. Depth is capped and visited
    records are tracked so a malformed cycle cannot hang the build.
    """
    con.execute("""
        CREATE TEMP TABLE skill_effect AS
        WITH RECURSIVE roots AS (
            SELECT DISTINCT record AS skill_record FROM facts
            WHERE record LIKE 'records/skills/%'
        ),
        walk(root, cur, depth) AS (
            SELECT skill_record, skill_record, 0 FROM roots
            UNION ALL
            SELECT w.root, f.value, w.depth + 1
            FROM walk w
            JOIN facts f ON f.record = w.cur
                        AND f.key IN ('buffSkillName', 'petSkillName')
                        AND f.value LIKE 'records/skills/%'
            WHERE w.depth < 8
              AND NOT EXISTS (SELECT 1 FROM facts d
                              WHERE d.record = w.cur AND d.key = 'skillDisplayName')
        ),
        named AS (
            SELECT w.root, w.cur, w.depth,
                   row_number() OVER (PARTITION BY w.root ORDER BY w.depth) AS rn
            FROM walk w
            WHERE EXISTS (SELECT 1 FROM facts d
                          WHERE d.record = w.cur AND d.key = 'skillDisplayName')
        )
        SELECT root AS skill_record, cur AS effect_record, depth AS hops
        FROM named WHERE rn = 1""")
    out = out_dir / "skill_effect.parquet"
    con.execute(f"COPY (SELECT * FROM skill_effect ORDER BY skill_record) "
                f"TO {sql_str(out.as_posix())} (FORMAT parquet, COMPRESSION zstd)")
    return con.execute("SELECT count(*) FROM skill_effect").fetchone()[0]
```

Note the signature takes the output directory:
`def build_skill_effect_map(con: duckdb.DuckDBPyConnection, out_dir: Path) -> int:`

Wire it into `cmd_build`, immediately after `build_wide(con, cur)`:

```python
    n_skill_effect = build_skill_effect_map(con, out_dir)
```

Add `"skill_effect"` to `DERIVED_TABLES` in `scripts/gditems_duckdb.py` and
`("skill_effect.parquet", "derived"),` to `ASSETS` in
`scripts/dataset_release.py`. `scripts/test_dataset_release.py` cross-checks the
two lists in both directions and fails if you update only one. Also add
`"skill_effect"` to the artifact size loop near the end of `cmd_build`.

and add to the summary block, after the `conversions` line:

```python
    print(f"  skill effect map: {n_skill_effect}")
```

- [ ] **Step 2: Write the acceptance query**

Create `scripts/derived_queries/ae12_skill_effect_walk.sql`:

```sql
-- ABOUTME: AE12 acceptance: the link-walking resolver names every mastery skill and
-- ABOUTME: every skill-boost target, and the two-hop pet-then-buff chains resolve.
-- Empty result = failure. Counts pinned to build 24756825. The structural checks are
-- what prove the walk; the counts only detect that the game moved underneath it.
WITH roster AS (
    SELECT DISTINCT value AS skill_record
    FROM facts
    WHERE regexp_matches(record, '_classtree_class(0[1-9]|10)\.dbr$')
      AND key LIKE 'skillName%'
      AND value NOT LIKE '%_classtraining_%'
),
targets AS (
    SELECT DISTINCT target AS skill_record FROM boosts WHERE kind = 'skill'
),
roster_named AS (
    SELECT r.skill_record, s.hops
    FROM roster r LEFT JOIN skill_effect s USING (skill_record)
),
target_named AS (
    SELECT t.skill_record, s.hops
    FROM targets t LEFT JOIN skill_effect s USING (skill_record)
),
checks AS (
    SELECT
        (SELECT count(*) FROM roster) = 315 AS roster_count_exact,
        (SELECT count(*) FROM roster_named WHERE hops IS NULL) = 0 AS every_roster_skill_named,
        (SELECT count(*) FROM target_named WHERE hops IS NULL) = 0 AS every_boost_target_named,
        (SELECT max(hops) FROM roster_named) = 2 AS max_two_hops,
        -- The six pet-modifier nodes that need petSkillName then buffSkillName.
        (SELECT count(*) FROM target_named WHERE hops = 2) = 6 AS two_hop_chains_exact
)
SELECT r.skill_record, r.hops
FROM roster_named r CROSS JOIN checks c
WHERE c.roster_count_exact AND c.every_roster_skill_named AND c.every_boost_target_named
  AND c.max_two_hops AND c.two_hop_chains_exact
ORDER BY r.hops DESC, r.skill_record
LIMIT 20;
```

- [ ] **Step 3: Add the recipe**

In `justfile`, beside the other `q-ae*` recipes, add:

```just
# AE12: the link-walking skill effect resolver
[group("deposit")]
q-ae12-skill-effect-walk: (_q-derived "ae12_skill_effect_walk.sql")
```

and add `q-ae12-skill-effect-walk` to the `q-ae-all` dependency list.

- [ ] **Step 4: Run derive and the new acceptance query**

Run: `just derive && just q-ae12-skill-effect-walk`
Expected: derive prints `skill effect map: <N>`; the query returns 20 rows with
the two-hop chains first. A zero-row result means one of the five checks failed.

- [ ] **Step 5: Run the whole acceptance suite**

Run: `just q-ae-all`
Expected: exit 0, all twelve recipes return rows.

- [ ] **Step 6: Commit**

```bash
git add scripts/build_derived.py scripts/derived_queries/ae12_skill_effect_walk.sql justfile
git commit -m "feat(derive): resolve skill records to their effect record by link walking"
```

---

### Task 4: `skills.parquet`

One row per skill in the class-tree roster, joined to the UI records for tree
position and node shape.

The class tree is authoritative: 325 distinct entries, 10 of them mastery bars,
leaving 315 skills, with zero dangling references. The UI records supply layout
only and carry three dangling references of their own, so they are joined, never
used as the roster.

**Files:**
- Modify: `scripts/build_derived.py` (add `build_skills`, call from `cmd_build`)
- Modify: `scripts/dataset_release.py` (`ASSETS`)
- Modify: `scripts/gditems_duckdb.py` (`DERIVED_TABLES`)
- Create: `scripts/derived_queries/ae13_skills_roster.sql`
- Modify: `justfile`

**Interfaces:**
- Consumes: `skill_effect` from Task 3.
- Produces: `skills.parquet` and a temp table `skills` with columns
  `record`, `mastery_record`, `group_record`, `node_kind`, `ui_x`, `ui_y`,
  `name_tag`, `icon`, `max_level`, `ultimate_level`, `effect_record`.
  `node_kind` is one of `base`, `modifier`, `transmuter`, `pet_modifier`.
  `icon` is the archive-relative path matching `data/skill-icons.json` keys.

- [ ] **Step 1: Write the builder**

Add to `scripts/build_derived.py`, after `build_skill_effect_map`:

```python
def build_skills(con: duckdb.DuckDBPyConnection, out_dir: Path, diag: dict) -> int:
    """The mastery skill roster, with tree position joined on where one exists.

    Roster comes from _classtree_classNN.dbr, which is authoritative: every entry
    resolves to a record that exists. The records/ui/skills/classNN/skill*.dbr
    buttons supply bitmapPosition and isCircular, but carry three references to
    records with no facts at all, so they are joined and never trusted as the
    roster. Four playerclass10 transform abilities have no button; their ui_x and
    ui_y stay NULL rather than being invented.
    """
    con.execute("""
        CREATE TEMP TABLE skills AS
        WITH roster AS (
            SELECT DISTINCT
                   value AS record,
                   'records/skills/playerclass'
                     || regexp_extract(record, '_classtree_class(\\d+)', 1)
                     || '/_classtraining_class'
                     || regexp_extract(record, '_classtree_class(\\d+)', 1) || '.dbr'
                     AS mastery_record
            FROM facts
            WHERE regexp_matches(record, '_classtree_class(0[1-9]|10)\\.dbr$')
              AND key LIKE 'skillName%'
              AND value NOT LIKE '%_classtraining_%'
        ),
        button AS (
            SELECT max(CASE WHEN key = 'skillName' THEN value END) AS record,
                   max(CASE WHEN key = 'bitmapPositionX' THEN value END)::INTEGER AS ui_x,
                   max(CASE WHEN key = 'bitmapPositionY' THEN value END)::INTEGER AS ui_y,
                   max(CASE WHEN key = 'isCircular' THEN value END) AS circular
            FROM facts
            WHERE regexp_matches(record, 'records/ui/skills/class(0[1-9]|10)/skill')
            GROUP BY record
        ),
        joined AS (
            SELECT r.record, r.mastery_record, b.ui_x, b.ui_y, b.circular,
                   e.effect_record,
                   (SELECT f.value FROM facts f
                     WHERE f.record = r.record AND f.key = 'Class') AS cls
            FROM roster r
            LEFT JOIN button b ON b.record = r.record
            LEFT JOIN skill_effect e ON e.skill_record = r.record
        )
        tagged AS (
            SELECT j.*,
                   (SELECT f.value FROM facts f
                     WHERE f.record = j.effect_record AND f.key = 'skillDisplayName') AS tag
            FROM joined j
        ),
        grouped AS (
            SELECT t.*,
                   -- The game encodes the group in the display-name tag itself:
                   -- tagClass<NN>SkillName<GG><L>, where GG numbers the group and
                   -- the trailing letter identifies the member. Dreeg's Evil Eye
                   -- is 11A with its modifiers at 11B..11E. Every one of the 142
                   -- groups has exactly one A member. Neither the record stem nor
                   -- the UI geometry works; see the spec for why both were rejected.
                   CASE WHEN regexp_matches(t.tag, 'SkillName[0-9]+[A-Z]?$')
                        THEN regexp_extract(t.tag, '^(.*SkillName[0-9]+)[A-Z]?$', 1)
                        ELSE t.record END AS group_tag,
                   regexp_extract(t.tag, '^.*SkillName[0-9]+([A-Z])?$', 1) AS group_letter
            FROM tagged t
        )
        SELECT
            j.record,
            j.mastery_record,
            -- The group's base is its 'A' member; a skill whose tag does not match
            -- the pattern (the four playerclass10 transform abilities) is its own base.
            coalesce(
                (SELECT b.record FROM grouped b
                  WHERE b.group_tag = j.group_tag AND b.group_letter IN ('A', '')),
                j.record) AS group_record,
            CASE
                WHEN j.cls = 'Skill_Transmuter' THEN 'transmuter'
                WHEN j.cls = 'SkillSecondary_PetModifier' THEN 'pet_modifier'
                WHEN j.group_letter NOT IN ('A', '') THEN 'modifier'
                ELSE 'base'
            END AS node_kind,
            j.ui_x, j.ui_y,
            j.tag AS name_tag,
            -- Stored verbatim: the sprite index in data/skill-icons.json is keyed
            -- by the same `ui/skills/icons/...` path, so this joins with no
            -- string surgery on either side.
            (SELECT f.value FROM facts f
              WHERE f.record = j.effect_record AND f.key = 'skillUpBitmapName') AS icon,
            (SELECT f.value FROM facts f
              WHERE f.record = j.effect_record AND f.key = 'skillMaxLevel')::INTEGER
                AS max_level,
            (SELECT f.value FROM facts f
              WHERE f.record = j.effect_record AND f.key = 'skillUltimateLevel')::INTEGER
                AS ultimate_level,
            j.effect_record
        FROM grouped j""")
    diag["skills_without_button"] = con.execute(
        "SELECT count(*) FROM skills WHERE ui_x IS NULL").fetchone()[0]
    diag["skills_without_name"] = con.execute(
        "SELECT count(*) FROM skills WHERE name_tag IS NULL").fetchone()[0]
    out = out_dir / "skills.parquet"
    con.execute(f"COPY (SELECT * FROM skills ORDER BY mastery_record, record) "
                f"TO {sql_str(out.as_posix())} (FORMAT parquet, COMPRESSION zstd)")
    return con.execute("SELECT count(*) FROM skills").fetchone()[0]
```

Wire into `cmd_build` after `n_conversions = build_conversions(...)`:

```python
    n_skills = build_skills(con, out_dir, diag)
```

Add to the diagnostics dict initialiser:

```python
            "skills_without_button": 0, "skills_without_name": 0,
```

Add to the summary block after the conversions line:

```python
    print(f"  skills: {n_skills}")
```

Add `"skills"` to the artifact size loop tuple.

- [ ] **Step 2: Register the new table**

In `scripts/gditems_duckdb.py`, add `"skills"` to `DERIVED_TABLES`.

In `scripts/dataset_release.py`, add `("skills.parquet", "derived"),` to
`ASSETS`. Leave the two leading comment lines that count the assets in prose
alone for now; Task 6 updates them once, at the final count, so they are not
rewritten on every table.

- [ ] **Step 3: Write the acceptance query**

Create `scripts/derived_queries/ae13_skills_roster.sql`:

```sql
-- ABOUTME: AE13 acceptance: the skills roster is complete, named, grouped and positioned.
-- ABOUTME: Pins the class-tree roster size and the four transform abilities with no button.
-- Empty result = failure. Counts pinned to build 24756825.
WITH checks AS (
    SELECT
        (SELECT count(*) FROM skills) = 315 AS roster_exact,
        (SELECT count(*) FROM skills WHERE name_tag IS NULL) = 0 AS all_named,
        (SELECT count(*) FROM skills WHERE icon IS NULL) = 0 AS all_have_icons,
        (SELECT count(*) FROM skills WHERE effect_record IS NULL) = 0 AS all_resolved,
        -- The four playerclass10 transform abilities are granted by the form
        -- rather than allocated, so they legitimately occupy no tree button.
        (SELECT count(*) FROM skills WHERE ui_x IS NULL) = 4 AS four_without_button,
        (SELECT count(*) FROM skills WHERE ui_x IS NULL
           AND mastery_record NOT LIKE '%playerclass10%') = 0 AS buttonless_all_class10,
        (SELECT count(*) FROM skills WHERE ultimate_level < max_level) = 0 AS caps_ordered,
        -- Every group_record must itself be a skill in the roster.
        (SELECT count(*) FROM skills s
          WHERE NOT EXISTS (SELECT 1 FROM skills g WHERE g.record = s.group_record))
          = 0 AS groups_resolve,
        -- The load-bearing invariant behind the whole grouping rule: each group
        -- has exactly one base. Zero bases orphans a group, two makes the choice
        -- of group_record arbitrary. Pinned at 142 groups over 311 tagged skills
        -- plus the 4 untagged transform abilities standing alone.
        (SELECT count(*) FROM (SELECT group_record FROM skills GROUP BY group_record
                                HAVING count(*) FILTER (WHERE record = group_record) != 1))
          = 0 AS one_base_per_group,
        (SELECT count(DISTINCT group_record) FROM skills) = 146 AS group_count_exact,
        -- Chosen Visage's two boosted skills, one ordinary buff and one pet summon.
        (SELECT max_level || '/' || ultimate_level FROM skills
          WHERE record = 'records/skills/playerclass02/blastshield1.dbr')
          = '12/22' AS flame_touched_caps,
        (SELECT max_level || '/' || ultimate_level FROM skills
          WHERE record = 'records/skills/playerclass03/summon_hellhound1.dbr')
          = '16/26' AS hellhound_caps,
        -- The three Summon Hellhound pet modifiers must group under it.
        (SELECT count(*) FROM skills
          WHERE group_record = 'records/skills/playerclass03/summon_hellhound1.dbr')
          = 4 AS hellhound_group_size
)
SELECT s.record, s.node_kind, s.max_level, s.ultimate_level
FROM skills s CROSS JOIN checks c
WHERE c.roster_exact AND c.all_named AND c.all_have_icons AND c.all_resolved
  AND c.four_without_button AND c.buttonless_all_class10 AND c.caps_ordered
  AND c.groups_resolve AND c.one_base_per_group AND c.group_count_exact
  AND c.flame_touched_caps AND c.hellhound_caps AND c.hellhound_group_size
  AND s.group_record = 'records/skills/playerclass03/summon_hellhound1.dbr'
ORDER BY s.record;
```

- [ ] **Step 4: Add the recipe**

```just
# AE13: the mastery skills roster
[group("deposit")]
q-ae13-skills-roster: (_q-derived "ae13_skills_roster.sql")
```

Add `q-ae13-skills-roster` to `q-ae-all`.

- [ ] **Step 5: Run and reconcile**

Run: `just derive && just q-ae13-skills-roster`
Expected: 4 rows (Summon Hellhound and its three pet modifiers).

If `groups_resolve` or `hellhound_group_size` fails, the stem regex is wrong for
some naming shape. Inspect with:

```bash
just q "select record, group_record, node_kind from skills where mastery_record like '%playerclass03%' order by group_record, record"
```

and correct the regex rather than loosening the check.

- [ ] **Step 6: Confirm the release wiring test still passes**

Run: `uv run scripts/test_dataset_release.py`
Expected: `FAILURES: 0`. This test cross-checks `ASSETS` against
`DERIVED_TABLES`; a failure here means Step 2 updated only one of the two.

- [ ] **Step 7: Commit**

```bash
git add scripts/build_derived.py scripts/gditems_duckdb.py scripts/dataset_release.py \
        scripts/derived_queries/ae13_skills_roster.sql justfile
git commit -m "feat(derive): add the skills roster table with tree position and grouping"
```

---

### Task 5: `skill_ranks.parquet`

Three breakpoints per stat: at rank 1, at `skillMaxLevel` (the most points a
player can spend), and at `skillUltimateLevel` (the hard cap reachable with
+skill gear). The two gaps are the two decisions a player makes.

Array lengths are NOT uniformly `skillUltimateLevel`: of the 1,370 numeric stat
arrays, 1,353 match, 9 are shorter and 8 are longer. Clamp to the array's own length
and report the mismatch count as a diagnostic.

**Files:**
- Modify: `scripts/build_derived.py` (add `build_skill_ranks`)
- Modify: `scripts/dataset_release.py`, `scripts/gditems_duckdb.py`
- Create: `scripts/derived_queries/ae14_skill_ranks.sql`
- Modify: `justfile`

**Interfaces:**
- Consumes: `skills` (Task 4), `skill_effect` (Task 3).
- Produces: `skill_ranks.parquet` with
  `(skill_record VARCHAR, stat_id VARCHAR, at_first DOUBLE, at_max DOUBLE, at_ultimate DOUBLE)`.

- [ ] **Step 1: Write the builder**

Add to `scripts/build_derived.py`:

```python
# Keys that are per-rank lists of records or effects rather than numbers.
_RANK_ARRAY_EXCLUDE = ("skillConnectionOn", "skillConnectionOff", "spawnObjects",
                       "petChanges", "fxChanges", "projectileOverride",
                       "modSpawnObjects", "radiusEffectName", "skillProjectileName")


def build_skill_ranks(con: duckdb.DuckDBPyConnection, out_dir: Path, diag: dict) -> int:
    """Per-stat values at the three breakpoints a player actually decides between.

    Every numeric stat on a skill record is a semicolon-separated array, one entry
    per rank. Array length is not reliably skillUltimateLevel (9 are shorter and
    8 longer at build 24756825), so each breakpoint clamps to the array's own
    length. A mismatch count rides out as a diagnostic so a patch that changes the
    shape is visible instead of silently yielding a wrong number.
    """
    excluded = ", ".join(f"'{k}'" for k in _RANK_ARRAY_EXCLUDE)
    con.execute(f"""
        CREATE TEMP TABLE skill_ranks AS
        WITH arr AS (
            SELECT s.record AS skill_record,
                   f.key AS stat_id,
                   str_split(f.value, ';') AS parts,
                   s.max_level, s.ultimate_level
            FROM skills s
            JOIN facts f ON f.record = s.effect_record
            WHERE f.value LIKE '%;%'
              AND f.key NOT IN ({excluded})
              AND NOT regexp_matches(f.value, '[A-Za-z/]')
        ),
        idx AS (
            SELECT skill_record, stat_id, parts,
                   least(greatest(max_level, 1), len(parts)) AS i_max,
                   least(greatest(ultimate_level, 1), len(parts)) AS i_ult,
                   len(parts) AS n, ultimate_level
            FROM arr
        )
        SELECT skill_record, stat_id,
               TRY_CAST(parts[1] AS DOUBLE) AS at_first,
               TRY_CAST(parts[i_max] AS DOUBLE) AS at_max,
               TRY_CAST(parts[i_ult] AS DOUBLE) AS at_ultimate
        FROM idx
        WHERE TRY_CAST(parts[1] AS DOUBLE) IS NOT NULL""")
    diag["rank_array_len_mismatch"] = con.execute("""
        SELECT count(*) FROM skills s
        JOIN facts f ON f.record = s.effect_record
        WHERE f.value LIKE '%;%'
          AND NOT regexp_matches(f.value, '[A-Za-z/]')
          AND len(str_split(f.value, ';')) != s.ultimate_level""").fetchone()[0]
    out = out_dir / "skill_ranks.parquet"
    con.execute(f"COPY (SELECT * FROM skill_ranks ORDER BY skill_record, stat_id) "
                f"TO {sql_str(out.as_posix())} (FORMAT parquet, COMPRESSION zstd)")
    return con.execute("SELECT count(*) FROM skill_ranks").fetchone()[0]
```

Wire into `cmd_build` after `build_skills`:

```python
    n_skill_ranks = build_skill_ranks(con, out_dir, diag)
```

Add `"rank_array_len_mismatch": 0,` to the diagnostics initialiser, print
`skill ranks: {n_skill_ranks}` in the summary, and add `"skill_ranks"` to the
artifact size loop.

- [ ] **Step 2: Register the table**

Add `"skill_ranks"` to `DERIVED_TABLES` and `("skill_ranks.parquet", "derived"),`
to `ASSETS`.

- [ ] **Step 3: Write the acceptance query**

Create `scripts/derived_queries/ae14_skill_ranks.sql`:

```sql
-- ABOUTME: AE14 acceptance: the three rank breakpoints reproduce Flame Touched exactly.
-- ABOUTME: Pins the values a player sees at 1/12, 12/12 and 22/22 in game.
-- Empty result = failure. Values pinned to build 24756825.
WITH ft AS (
    SELECT stat_id, at_first, at_max, at_ultimate
    FROM skill_ranks
    WHERE skill_record = 'records/skills/playerclass02/blastshield1.dbr'
),
checks AS (
    SELECT
        -- Flame Touched fire damage bonus: +10% at one point, +100% fully
        -- invested, +210% at the hard cap. Verified against the in-game tooltip.
        (SELECT at_first FROM ft WHERE stat_id = 'offensiveFireModifier') = 10 AS ft_first,
        (SELECT at_max FROM ft WHERE stat_id = 'offensiveFireModifier') = 100 AS ft_max,
        (SELECT at_ultimate FROM ft WHERE stat_id = 'offensiveFireModifier') = 210 AS ft_ult,
        (SELECT at_ultimate FROM ft WHERE stat_id = 'characterOffensiveAbility') = 220 AS ft_oa,
        -- Breakpoints must be monotonic in rank for every skill and stat that
        -- starts non-negative; a decreasing series means an index off by one.
        (SELECT count(*) FROM skill_ranks
          WHERE at_first >= 0 AND (at_max < at_first OR at_ultimate < at_max))
          = 0 AS monotonic,
        -- A rank-1 skill collapses all three columns onto the same value.
        (SELECT count(*) FROM skill_ranks r JOIN skills s ON s.record = r.skill_record
          WHERE s.ultimate_level = 1 AND (r.at_max != r.at_first OR r.at_ultimate != r.at_first))
          = 0 AS rank_one_collapses,
        (SELECT count(*) FROM skill_ranks WHERE at_ultimate IS NULL) = 0 AS no_null_ultimate
)
SELECT f.stat_id, f.at_first, f.at_max, f.at_ultimate
FROM ft f CROSS JOIN checks c
WHERE c.ft_first AND c.ft_max AND c.ft_ult AND c.ft_oa
  AND c.monotonic AND c.rank_one_collapses AND c.no_null_ultimate
ORDER BY f.stat_id;
```

- [ ] **Step 4: Add the recipe and run**

```just
# AE14: skill rank breakpoints
[group("deposit")]
q-ae14-skill-ranks: (_q-derived "ae14_skill_ranks.sql")
```

Add to `q-ae-all`. Run: `just derive && just q-ae14-skill-ranks`
Expected: 7 rows (Flame Touched's stats), matching the spec's table.

If `monotonic` fails, inspect the offenders and decide whether the stat is
genuinely a decreasing series (cooldowns and mana costs can fall with rank).
If so, narrow the check to stats that increase rather than deleting it.

- [ ] **Step 5: Record the mismatch diagnostic baseline**

Run: `just derive` and note `rank_array_len_mismatch`. Expected: 17
(9 shorter plus 8 longer, over 1,370 numeric arrays). Add that number to
`docs/item-schema.md` when Task 7 updates the docs, so a future change to it is
noticeable.

- [ ] **Step 6: Commit**

```bash
git add scripts/build_derived.py scripts/gditems_duckdb.py scripts/dataset_release.py \
        scripts/derived_queries/ae14_skill_ranks.sql justfile
git commit -m "feat(derive): add skill rank breakpoints at first, max and ultimate"
```

---

### Task 6: `skill_modifiers.parquet`

The per-skill stat block an item attaches to one specific skill. Encoded as
`modifiedSkillName<N>` (which skill) paired with `modifierSkillName<N>` (the
record holding the stats), the trailing number pairing them. The modifier record
is itself often a shell, so the same walk from Task 3 resolves it.

**Files:**
- Modify: `scripts/build_derived.py` (add `build_skill_modifiers`)
- Modify: `scripts/dataset_release.py`, `scripts/gditems_duckdb.py`
- Create: `scripts/derived_queries/ae15_skill_modifiers.sql`
- Modify: `justfile`

**Interfaces:**
- Consumes: `skill_effect` (Task 3), `scoped` (existing temp table of in-scope
  item records, created by `build_wide`).
- Produces: `skill_modifiers.parquet` with
  `(item_record VARCHAR, modified_skill VARCHAR, modifier_record VARCHAR, stat_id VARCHAR, value DOUBLE)`.

- [ ] **Step 1: Write the builder**

**This walk is NOT `skill_effect`.** An earlier draft reused it and lost the
Summon Hellhound block entirely. The two walks follow the same links but stop on
different conditions, because they answer different questions:

- `skill_effect` stops at a record carrying `skillDisplayName`, because its job
  is to find a skill's NAME.
- This one stops at the first record carrying a non-zero numeric STAT, because
  its job is to find the numbers. Modifier stats routinely sit on anonymous
  carrier records with no display name at all. Chosen Visage's Summon Hellhound
  modifier reaches `pets/modifier_head_b201_summonhellhound.dbr`, which holds
  the 200 fire damage and 18% crit damage but has no `skillDisplayName`, so the
  name-gated walk yields nothing for it and the whole block silently vanishes.
  Measured: reusing `skill_effect` drops all modifier stats for 203 of the
  in-scope items.

Add the shared exclusion list as a module constant beside `_RANK_ARRAY_EXCLUDE`:

```python
# Skill-shape keys that are not stats. Excluded wherever modifier stats are read.
_MODIFIER_STAT_EXCLUDE = ("skillMaxLevel", "skillUltimateLevel", "skillTier",
                          "skillMasteryLevelRequired", "isPetBonusScaling",
                          "instantCast", "petLimit", "petBurstSpawn")
```

```python
def build_skill_modifiers(con: duckdb.DuckDBPyConnection, out_dir: Path) -> int:
    """The extra stats an item attaches to one specific skill.

    modifiedSkillName<N> names the skill and modifierSkillName<N> names the record
    holding the stats, the trailing number pairing them. That modifier record is
    frequently a shell: Chosen Visage's Summon Hellhound modifier is a
    SkillSecondary_PetModifier whose petSkillName reaches the record actually
    carrying 200 fire damage and 18% crit damage.

    This walk stops at the first record carrying a non-zero numeric stat, NOT at
    the first record carrying a display name. Modifier stats routinely sit on
    anonymous carrier records, so the name-gated skill_effect walk stops short of
    them and silently drops the block.
    """
    excluded = ", ".join(f"'{k}'" for k in _MODIFIER_STAT_EXCLUDE)
    con.execute(f"""
        CREATE TEMP TABLE skill_modifiers AS
        WITH RECURSIVE paired AS (
            SELECT s.record AS item_record,
                   lower(trim(m.value)) AS modified_skill,
                   lower(trim(r.value)) AS modifier_record
            FROM scoped s
            JOIN facts m ON m.record = s.record
                        AND m.key LIKE 'modifiedSkillName%' AND trim(m.value) != ''
            JOIN facts r ON r.record = s.record
                        AND r.key = 'modifierSkillName'
                                 || regexp_extract(m.key, 'modifiedSkillName(\\d+)', 1)
                        AND trim(r.value) != ''
        ),
        walk(root, cur, depth) AS (
            SELECT DISTINCT modifier_record, modifier_record, 0 FROM paired
            UNION ALL
            SELECT w.root, f.value, w.depth + 1
            FROM walk w
            JOIN facts f ON f.record = w.cur
                        AND f.key IN ('buffSkillName', 'petSkillName')
                        AND f.value LIKE 'records/skills/%'
            WHERE w.depth < 8
        ),
        stat_record AS (
            SELECT root, cur,
                   row_number() OVER (PARTITION BY root ORDER BY depth) AS rn
            FROM walk w
            WHERE EXISTS (SELECT 1 FROM facts f
                          WHERE f.record = w.cur
                            AND f.value_num IS NOT NULL AND f.value_num != 0
                            AND f.key NOT IN ({excluded}))
        )
        SELECT p.item_record, p.modified_skill, p.modifier_record,
               f.key AS stat_id, f.value_num AS value
        FROM paired p
        JOIN stat_record sr ON sr.root = p.modifier_record AND sr.rn = 1
        JOIN facts f ON f.record = sr.cur
        WHERE f.value_num IS NOT NULL AND f.value_num != 0
          AND f.key NOT IN ({excluded})""")
    out = out_dir / "skill_modifiers.parquet"
    con.execute(f"COPY (SELECT * FROM skill_modifiers "
                f"ORDER BY item_record, modified_skill, stat_id) "
                f"TO {sql_str(out.as_posix())} (FORMAT parquet, COMPRESSION zstd)")
    return con.execute("SELECT count(*) FROM skill_modifiers").fetchone()[0]
```

Not every modifier record carries numbers: 198 of the 3,321 distinct modifier
records hold only effect or pet changes, so they contribute no rows. Across all
records, 3,257 items resolve to modifier stats; the in-scope figure after the
`scoped` join is lower and is what the acceptance query should pin.

Wire into `cmd_build` after `build_skill_ranks`, print
`skill modifiers: {n_skill_modifiers}`, add `"skill_modifiers"` to the artifact
size loop.

- [ ] **Step 2: Register the table**

Add `"skill_modifiers"` to `DERIVED_TABLES` and
`("skill_modifiers.parquet", "derived"),` to `ASSETS`. Update the ASSETS comment
to their final counts: fourteen managed assets, of which the derived are eleven
(the original seven plus `skill_effect`, `skills`, `skill_ranks` and
`skill_modifiers`).

- [ ] **Step 3: Write the acceptance query with the Chosen Visage oracle**

Create `scripts/derived_queries/ae15_skill_modifiers.sql`:

```sql
-- ABOUTME: AE15 acceptance: item skill modifiers reproduce the Chosen Visage card,
-- ABOUTME: including the pet hop that carries the Summon Hellhound block.
-- Empty result = failure. Values read off the in-game item card.
WITH visage AS (
    SELECT modified_skill, stat_id, value
    FROM skill_modifiers
    WHERE item_record = 'records/items/gearhead/b201f_head.dbr'
),
checks AS (
    SELECT
        -- Flame Touched block: 26 fire damage, +12% crit damage, 4% physical resist.
        (SELECT value FROM visage WHERE modified_skill LIKE '%blastshield1.dbr'
           AND stat_id = 'offensiveFireMin') = 26 AS ft_fire,
        (SELECT value FROM visage WHERE modified_skill LIKE '%blastshield1.dbr'
           AND stat_id = 'offensiveCritDamageModifier') = 12 AS ft_crit,
        (SELECT value FROM visage WHERE modified_skill LIKE '%blastshield1.dbr'
           AND stat_id = 'defensivePhysical') = 4 AS ft_phys,
        -- Summon Hellhound block: 200 fire damage, +18% crit damage. These live
        -- two records away, behind a SkillSecondary_PetModifier petSkillName hop,
        -- so this pins the walk as much as the pairing.
        (SELECT value FROM visage WHERE modified_skill LIKE '%summon_hellhound1.dbr'
           AND stat_id = 'offensiveFireMin') = 200 AS hh_fire,
        (SELECT value FROM visage WHERE modified_skill LIKE '%summon_hellhound1.dbr'
           AND stat_id = 'offensiveCritDamageModifier') = 18 AS hh_crit,
        -- Every modified skill must be a real skill record.
        (SELECT count(*) FROM skill_modifiers m
          WHERE NOT EXISTS (SELECT 1 FROM facts f WHERE f.record = m.modified_skill))
          = 0 AS targets_exist,
        -- Measure this once against the built table and pin what you observe, the
        -- way every other AE recipe pins a count. It is strictly below the 3,362
        -- items carrying modifier PAIRS, because 198 modifier records hold only
        -- effect or pet changes and contribute no stat rows. Report the number.
        (SELECT count(DISTINCT item_record) FROM skill_modifiers) = 0 AS item_count_exact
)
SELECT v.modified_skill, v.stat_id, v.value
FROM visage v CROSS JOIN checks c
WHERE c.ft_fire AND c.ft_crit AND c.ft_phys AND c.hh_fire AND c.hh_crit
  AND c.targets_exist AND c.item_count_exact
ORDER BY v.modified_skill, v.stat_id;
```

- [ ] **Step 4: Add the recipe and run**

```just
# AE15: item skill modifiers
[group("deposit")]
q-ae15-skill-modifiers: (_q-derived "ae15_skill_modifiers.sql")
```

Add to `q-ae-all`. Run: `just derive && just q-ae15-skill-modifiers`
Expected: 5 rows, exactly the two stat blocks from the Chosen Visage card.

- [ ] **Step 5: Run the full suite and the release wiring test**

Run: `just q-ae-all && uv run scripts/test_dataset_release.py`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/build_derived.py scripts/gditems_duckdb.py scripts/dataset_release.py \
        scripts/derived_queries/ae15_skill_modifiers.sql justfile
git commit -m "feat(derive): add per-item skill modifier stats"
```

---

### Task 7: Emit `data/skill-items.json`, wire i18n, update docs

The committed dataset the page will render, plus the localisation and
documentation wiring.

**Files:**
- Create: `scripts/build_skill_items.py`
- Modify: `justfile` (add `skill-items`)
- Modify: `scripts/build_game_tables.py` (add `--skill-items`)
- Modify: `scripts/test_build_game_tables.py`
- Modify: `docs/item-schema.md`, `docs/item-cli.md`, `ONBOARDING.md`, `BACKLOG.md`
- Create (generated, committed): `data/skill-items.json`

**Interfaces:**
- Consumes: `skills.parquet`, `skill_ranks.parquet`, `skill_modifiers.parquet`,
  `entities.parquet`, `stats.parquet`, `boosts.parquet`.
- Produces: `data/skill-items.json`:

```
{
  "meta": {"game_version", "steam_buildid", "generated_utc"},
  "masteries": [{"record", "name_tag"}],
  "skills":    [{"record", "mastery", "group", "node_kind", "ui_x", "ui_y",
                 "name_tag", "icon", "max_level", "ultimate_level",
                 "ranks": [{"stat", "first", "max", "ultimate"}]}],
  "items":     [{"record", "name_tag", "domain", "slots", "rarity", "item_level",
                 "tiers": [int], "grimtools": "<url>",
                 "boosts":    [{"skill", "level"}],
                 "mastery_boosts": [{"mastery", "level"}],
                 "modifiers": [{"skill", "stats": [{"stat", "value"}]}],
                 "stats":     [{"stat", "source", "low", "high"}]}]
}
```

- [ ] **Step 1: Write the emitter**

Create `scripts/build_skill_items.py`:

```python
#!/usr/bin/env -S uv run --script
# ABOUTME: Emits data/skill-items.json, the committed dataset behind the /items/ page.
# ABOUTME: Reads the derived parquet only; needs no game install.
# /// script
# requires-python = ">=3.10"
# dependencies = ["duckdb"]
# ///
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import duckdb  # noqa: E402
from build_deposit import open_deposit, read_meta, register_derived  # noqa: E402
from gditems_core import grimtools_url  # noqa: E402

DOMAINS = ("gear", "relic", "augment")


def rows(con, sql, params=None):
    cur = con.execute(sql, params or [])
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Emit the /items/ page dataset")
    ap.add_argument("--deposit-dir", required=True, type=Path)
    ap.add_argument("--derived-dir", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args(argv)

    con = open_deposit(args.deposit_dir.resolve())
    if not register_derived(con, args.derived_dir.resolve(), True):
        return 2
    meta = read_meta(con)

    # Top tier per family: the page targets endgame, so each group_key
    # contributes only its highest item level.
    con.execute(f"""
        CREATE TEMP TABLE top AS
        WITH hit AS (
            SELECT e.* FROM entities e
            WHERE e.domain IN {DOMAINS}
              AND (e.record IN (SELECT record FROM boosts)
                OR e.record IN (SELECT item_record FROM skill_modifiers))
        ),
        ranked AS (
            SELECT *, row_number() OVER (PARTITION BY group_key
                                         ORDER BY item_level DESC) AS rn
            FROM hit
        )
        SELECT * FROM ranked WHERE rn = 1""")

    masteries = rows(con, """
        SELECT DISTINCT s.mastery_record AS record,
               (SELECT f.value FROM facts f
                 WHERE f.record = s.mastery_record AND f.key = 'skillDisplayName')
                 AS name_tag
        FROM skills s ORDER BY 1""")

    ranks_by_skill = {}
    for r in rows(con, "SELECT * FROM skill_ranks ORDER BY skill_record, stat_id"):
        ranks_by_skill.setdefault(r["skill_record"], []).append(
            {"stat": r["stat_id"], "first": r["at_first"],
             "max": r["at_max"], "ultimate": r["at_ultimate"]})

    skills = []
    for s in rows(con, "SELECT * FROM skills ORDER BY mastery_record, record"):
        skills.append({
            "record": s["record"], "mastery": s["mastery_record"],
            "group": s["group_record"], "node_kind": s["node_kind"],
            "ui_x": s["ui_x"], "ui_y": s["ui_y"], "name_tag": s["name_tag"],
            "icon": s["icon"], "max_level": s["max_level"],
            "ultimate_level": s["ultimate_level"],
            "ranks": ranks_by_skill.get(s["record"], []),
        })

    def group(sql, key):
        out = {}
        for r in rows(con, sql):
            out.setdefault(r[key], []).append(r)
        return out

    boosts = group("""SELECT b.record, b.target, b.level, b.kind
                      FROM boosts b JOIN top t ON t.record = b.record
                      ORDER BY b.record, b.target""", "record")
    mods = group("""SELECT m.item_record, m.modified_skill, m.stat_id, m.value
                    FROM skill_modifiers m JOIN top t ON t.record = m.item_record
                    ORDER BY m.item_record, m.modified_skill, m.stat_id""", "item_record")
    stats = group("""SELECT s.record, s.stat_id, s.source, s.display_low, s.display_high,
                            s.value_min, s.value_max
                     FROM stats s JOIN top t ON t.record = s.record
                     ORDER BY s.record, s.source, s.stat_id""", "record")
    tiers = group("""SELECT e.group_key, e.item_level FROM entities e
                     WHERE e.group_key IN (SELECT group_key FROM top)
                     ORDER BY e.group_key, e.item_level""", "group_key")

    items = []
    for t in rows(con, "SELECT * FROM top ORDER BY record"):
        rec = t["record"]
        by_skill = {}
        for m in mods.get(rec, []):
            by_skill.setdefault(m["modified_skill"], []).append(
                {"stat": m["stat_id"], "value": m["value"]})
        name = t.get("name_tag")
        items.append({
            "record": rec,
            "name_tag": name,
            "domain": t["domain"],
            "slots": list(t["slots"]) if t["slots"] else [],
            "rarity": t["rarity"],
            "item_level": t["item_level"],
            "tiers": [r["item_level"] for r in tiers.get(t["group_key"], [])],
            "grimtools": grimtools_url(name, t["item_level"]) if name else None,
            "boosts": [{"skill": b["target"], "level": b["level"]}
                       for b in boosts.get(rec, []) if b["kind"] == "skill"],
            "mastery_boosts": [{"mastery": b["target"], "level": b["level"]}
                               for b in boosts.get(rec, []) if b["kind"] == "mastery"],
            "modifiers": [{"skill": k, "stats": v} for k, v in sorted(by_skill.items())],
            "stats": [{"stat": s["stat_id"], "source": s["source"],
                       "low": s["display_low"] if s["display_low"] is not None
                              else s["value_min"],
                       "high": s["display_high"] if s["display_high"] is not None
                               else s["value_max"]}
                      for s in stats.get(rec, [])],
        })

    doc = {
        "meta": {
            "game_version": meta.get("game_version", ""),
            "steam_buildid": meta.get("steam_buildid", ""),
            "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "masteries": masteries,
        "skills": skills,
        "items": items,
    }
    args.out.write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")
    size_kb = args.out.stat().st_size / 1024
    print(f"Wrote {args.out}  ({len(items)} items, {len(skills)} skills, {size_kb:.1f} KB)")
    if size_kb > 1400:
        print(f"WARNING: {size_kb:.1f} KB exceeds the 1.2 MB monsters.json reference",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

Before running, confirm `grimtools_url` is importable from `scripts/gditems_core.py`
with the signature `(name: str, item_level: int) -> str`. If it lives elsewhere or
is named differently, adjust the import; `scripts/test_gditems_core.py` has a test
named "grimtools url matches the verified fixture" that names it.

- [ ] **Step 2: Add the justfile recipe**

```just
# Emit data/skill-items.json, the committed dataset behind the /items/ page
[group("deposit")]
skill-items:
    uv run scripts/build_skill_items.py --deposit-dir "{{deposit_dir}}" \
        --derived-dir "{{derived_dir}}" \
        --out "{{justfile_directory()}}/data/skill-items.json"
```

- [ ] **Step 3: Run it and check the size**

Run: `just skill-items`
Expected: `2406 items, 315 skills` and a size under 1.2 MB. If it exceeds that,
drop the `stats` array's zero-valued rows first, then reconsider before shrinking
anything the page needs.

- [ ] **Step 4: Add `--skill-items` to the game text table builder**

In `scripts/build_game_tables.py`, change the signature of
`collect_referenced_tags` to accept the new document:

```python
def collect_referenced_tags(
    devotions: dict, stat_tags: dict, stat_format_tags: dict | None = None,
    rr: dict | None = None, monsters: dict | None = None,
    skill_items: dict | None = None
) -> set[str]:
```

Add this loop immediately after the existing `monsters` loop, before
`tags.update(stat_tags.values())`:

```python
    for key in ("masteries", "skills", "items"):
        for row in (skill_items or {}).get(key, []):
            _add(tags, row.get("name_tag"))
```

Extend the docstring's final sentence to mention that skill-items contributes
the name tags of its masteries, skills and items, and that a nameless item
carries a null `name_tag` which `_add` skips.

Add the argument in `main`, after `--monsters`:

```python
    ap.add_argument("--skill-items", type=Path,
                    help="Optional skill-items.json (adds its mastery, skill and item name tags)")
```

Load it beside the others and pass it through:

```python
    skill_items = json.loads(args.skill_items.read_text(encoding="utf-8")) if args.skill_items else {}
    referenced = collect_referenced_tags(devotions, stat_tags, stat_format_tags, rr,
                                         monsters, skill_items)
```

Then pass `--skill-items "data/skill-items.json"` from the `i18n-tables` recipe
in the justfile, alongside the existing `--monsters "{{out_mon}}"`.

- [ ] **Step 5: Extend the game-tables test**

In `scripts/test_build_game_tables.py`, add this case following the shape of the
existing `--monsters` coverage in that file:

```python
skill_items_doc = {
    "masteries": [{"record": "records/skills/playerclass03/_classtraining_class03.dbr",
                   "name_tag": "tagClass03SkillName00"}],
    "skills": [{"record": "records/skills/playerclass03/summon_hellhound1.dbr",
                "name_tag": "tagClass03SkillName02A"},
               {"record": "records/skills/nameless.dbr", "name_tag": None}],
    "items": [{"record": "records/items/gearhead/b201f_head.dbr",
               "name_tag": "tagGDX2HeadB201"}],
}
tags = collect_referenced_tags({}, {}, {}, {}, {}, skill_items_doc)
check("skill-items contributes mastery name tags", "tagClass03SkillName00" in tags)
check("skill-items contributes skill name tags", "tagClass03SkillName02A" in tags)
check("skill-items contributes item name tags", "tagGDX2HeadB201" in tags)
check("a null name_tag is skipped, not added", None not in tags)
```

Match the surrounding file's assertion helper: if it uses `check(label, ok)` as
above, keep that; if it uses plain `assert`, follow that instead.

- [ ] **Step 6: Regenerate the locale tables**

Run: `just i18n-tables`
Expected: every locale rebuilds and `omitted` stays at its current value. The
skill and item name tags are now included, so the tables grow.

- [ ] **Step 7: Run the full gate**

Run: `just check && just test-scripts && just q-ae-all`
Expected: all three exit 0.

- [ ] **Step 8: Update the docs**

- `docs/item-schema.md`: add `skills`, `skill_ranks` and `skill_modifiers` to the
  tables table; document the link-walking resolver, the class-tree-versus-UI
  roster rule, and the `rank_array_len_mismatch` diagnostic baseline from Task 5.
- `docs/item-cli.md`: correct the "Name resolution" section. It currently claims
  46 of 245 boost targets are "genuinely nameless" and that deriving a name
  "would assert one the game does not have". That is wrong: the walk names
  272 of 272, and the doc's own cited example, `playerclass01/cadence3.dbr`,
  carries a `buffSkillName` pointing at a named record.
- `ONBOARDING.md`: add `just skill-icons` and `just skill-items` to Common
  commands, and `data/skill-items.json` plus `data/skill-icons.png` to Key paths.
- `BACKLOG.md`: remove the "Pet-skill stat rollup" follow-up, which this closes.

- [ ] **Step 9: Commit**

```bash
git add scripts/build_skill_items.py scripts/build_game_tables.py \
        scripts/test_build_game_tables.py justfile data/skill-items.json \
        data/i18n docs ONBOARDING.md BACKLOG.md
git commit -m "feat(items): emit the committed skill-items dataset and wire i18n"
```

- [ ] **Step 10: Publish the dataset release**

The three new derived tables are not in the pinned release, so
`just fetch-deposit` on another machine would download a set the item CLI
cannot open.

Run: `just publish-deposit`

This requires the branch to be pushed first (the script refuses to tag a commit
absent from the remote). Then commit the updated `deposit.lock`:

```bash
git add deposit.lock
git commit -m "chore(data): pin deposit.lock to the release carrying the skill tables"
```

---

## Follow-on

The page itself (`/items/` at `web/src/items/`, the facet model, the tree-shaped
skill picker, and the URL state) is a separate plan that consumes
`data/skill-items.json` and `data/skill-icons.png`. Write it after this plan
lands, so the page is built against a real dataset rather than a predicted shape.
