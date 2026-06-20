# Grim Dawn Devotion Parser

Parses Grim Dawn's extracted `.dbr` game records into a single clean
`devotions.json` describing the whole Devotion constellation system:
every constellation, its affinity unlock requirement, the affinity it grants on
completion, and each of its stars (stat bonuses, celestial power, weapon
requirement, and intra-constellation pick ordering).

This JSON is meant as a drop-in data file for a separate devotion-path optimizer
(built later). **This repo is only the parser + schema.**

Current output: **86 constellations, 438 stars** from game build `19149150`
(~v1.2.1.x).

## Quick start

Prereqs are managed for you via [`just`](https://github.com/casey/just) and
[`uv`](https://docs.astral.sh/uv/). On Windows with git-bash:

```bash
just doctor       # check tools + data are present, tells you what's missing
just install      # install uv (+ a managed Python) via winget, if needed
just extract      # decompile database.arz + Text_EN.arc  (~5 GB free needed)
just parse        # produce devotions.json + validation report
# or just:
just all          # extract then parse
```

`just install` shells out to `winget` for `uv`; if `just`/`uv` aren't installed
yet, install once with `winget install Casey.Just astral-sh.uv` then **open a new
shell** so they're on `PATH`.

The parser script itself is self-executable via a uv shebang
(`#!/usr/bin/env -S uv run --script`) with inline PEP 723 metadata and **zero
dependencies** — it also runs directly:

```bash
uv run scripts/parse_devotions.py \
  --records-dir extracted/records --text-dir extracted/text_en \
  --out devotions.json --stat-labels
```

### Config / overrides

The justfile reads these (env var or `just var=… recipe`):

| Var | Default |
|---|---|
| `GD_DIR` | `C:/Program Files (x86)/Steam/steamapps/common/Grim Dawn` |
| `GD_VERSION` | `1.2.1.x` (stamped into `meta.game_version`) |

```bash
GD_DIR="D:/Games/Grim Dawn" just extract
```

## Getting the data (extraction)

`just extract` runs Crate's own `ArchiveTool.exe` (ships in the game install):

```
ArchiveTool.exe "<GD>/database/database.arz" -database "extracted/records"
ArchiveTool.exe "<GD>/resources/Text_EN.arc" -extract "extracted/text_en"
```

Records land in `extracted/records/records/ui/skills/devotion/` and translations
in `extracted/text_en/text_en/*.txt`. The `extracted/` tree is **git-ignored**
(~5 GB) — regenerate it anytime with `just extract`.

> Alternative: `AssetManager.exe → Tools → Extract Game Files` does the same via UI.

## Output schema (`devotions.json`)

```jsonc
{
  "meta": {
    "game_version": "1.2.1.x",
    "steam_buildid": "19149150",
    "extracted_from": "records/ui/skills/devotion/",
    "generated_utc": "2026-06-20T00:00:00Z",
    "affinities": ["ascendant","chaos","eldritch","order","primordial"]
  },
  "constellations": [
    {
      "id": "bat",
      "name": "Bat",
      "tier": 1,
      "dbr": "records/ui/skills/devotion/constellations/constellation01.dbr",
      "affinity_required": { "eldritch": 1 },
      "affinity_bonus":    { "chaos": 2, "eldritch": 3 },
      "point_cost": 5,                       // = number of stars (1 point each)
      "stars": [
        {
          "index": 0,
          "dbr": "records/skills/devotion/tier1_01a.dbr",
          "predecessors": [],                // star indices within THIS constellation
          "bonuses": { "offensiveLifeModifier": 15, "offensiveSlowBleedingModifier": 15 },
          "celestial_power": null,           // or { name, dbr, skill_class, description }
          "weapon_requirement": null         // or { weapons: ["Sword","Sword2h"], description }
        }
        // … the celestial-power star looks like:
        // { "index": 4, "celestial_power": { "name": "Twin Fangs", ... }, "bonuses": {} }
      ]
    }
  ]
}
```

Notes:
- `bonuses` keys are **raw internal stat ids** (stable; the optimizer needs
  these). `--stat-labels` also writes `stat_labels.json` mapping each id to a
  best-effort human label. Beware GD quirks: internal `Life` = **Vitality**.
- `predecessors` are 0-based star indices; a star unlocks only after its
  predecessor(s) are taken. Tree/forest rooted at star 0.
- Tier‑3 constellations have an empty `affinity_bonus` (they grant none).
- Crossroads is 5 single-star constellations, ids `crossroads_<affinity>`.
- Stars that grant pet stats also carry `pet_bonuses` / `pet_bonus_dbr`.
- Stars with a vs-race bonus (`racialBonusPercentDamage/Defense`) carry
  `racial_target` (resolved race names, e.g. `["Beast"]`).
- Every object keeps its source `dbr` path for traceability.

`--duckdb` additionally emits `devotion_records.csv` — a long-format
`(dbr, key, value)` table of all devotion records for ad-hoc querying (DuckDB
reads the CSV, not `.dbr`).

## Validation

Every `just parse` prints a report and exits non-zero on anomalies: constellation
count, total stars, affinity-key sanity (must be the five known affinities),
predecessor-index bounds, unresolved `tag…` name leaks, celestial-power /
weapon-requirement counts, and a per-tier breakdown.

## Re-running after a patch

The parser **discovers** keys/paths at runtime and logs anything unexpected — it
does not hard-code the full key list. After any game update (notably **Fangs of
Asterkarn / v1.3, 2026‑07‑23**, which will likely change devotion balance), just:

```bash
just all          # re-extract + re-parse against the patched install
```

and the swapped-in `devotions.json` is current. Bump `GD_VERSION` to taste.

## Layout

```
justfile                    # doctor / install / extract / parse / all / clean
scripts/parse_devotions.py  # the parser (uv self-executable, stdlib only)
docs/dbr-format.md          # the reverse-engineered data model
devotions.json              # output (committed)
stat_labels.json            # output (--stat-labels)
extracted/                  # game files, git-ignored — `just extract` to rebuild
```
