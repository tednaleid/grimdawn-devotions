# Grim Dawn Devotions

A free, open-source devotion planner and dataset for
**[Grim Dawn](https://www.grimdawn.com/)**, built by a fan, for players.

## Try it: https://tednaleid.github.io/grimdawn-devotions/

The planner runs entirely in your browser. No ads, no paywall, no account. Every
part of it (the planner, the dataset, and the parser that builds the dataset) is
open source you can read, fork, and run yourself.

## Features

- **Interactive devotion starmap.** Pan and zoom the full constellation map; click
  or tap a star to take or refund it. Works on desktop and on mobile/touch.
- **Knows the real rules.** Models affinity gating, activation-before-self-sustain,
  refundable Crossroads, and the temporary scaffolding/refund pattern that decides
  whether a build is actually constructible within your point budget. See
  [docs/devotion-system.md](docs/devotion-system.md).
- **Reachability-aware.** A Rust/WASM core (with a TypeScript fallback) dims the
  constellations you can no longer complete under your current selection and point
  cap, so you only see legal moves.
- **Guided build order.** For a self-covering selection, the planner shows a legal
  order to construct it, including when to borrow and refund scaffolding.
- **Benefit filters.** Highlight the stars that grant a stat, damage type, or
  affinity you care about. Celestial-power effects participate too: filtering on
  Burn, Resistance Reduction, Stun, and the like lights up the powers that grant
  them.
- **Celestial powers surfaced.** See the powers a build grants and the powers still
  validly pickable, each with its full description.
- **Build comparison.** Set a baseline and diff any build against it.
- **Shareable links.** The entire build state lives in the URL, so a copied link
  restores exactly what you saw. Nothing is stored server-side.

## Dataset

Under the planner is a clean, queryable dataset. `scripts/parse_devotions.py`
reads the game's extracted `.dbr` records into one
[`data/devotions.json`](data/devotions.json): every constellation, its affinity
unlock cost and the affinity it grants, and each star's stat bonuses, celestial
power, weapon requirement, map position, and intra-constellation pick order.
Current output: **109 constellations, 559 stars** (game build `19149150`,
v1.2.1.x). It is committed to the repo and re-runnable after every patch, so the
planner builds anywhere without touching the game.

Everything is reproducible from your own game install; see Quick start below.

## Fan project & disclaimer

This is an **unofficial, non-commercial fan project**. It is **not affiliated
with, endorsed by, or supported by Crate Entertainment**.

*Grim Dawn* and all of its game data, names, artwork, and other content are the
property of **© Crate Entertainment**. This repository contains a tool that reads
data from a copy of the game **you already own**, plus a derived dataset of game
facts (stat values, names, structure) provided purely to help fellow players
understand and plan their characters. Game **artwork/asset files are not
redistributed here**; they stay in your local install and are
regenerated/extracted on your own machine (see
[docs/assets-and-textures.md](docs/assets-and-textures.md)).

Our own code, scripts, and documentation are open source (see [LICENSE](LICENSE)).
That license covers **only our work**; it does not grant any rights to Crate's
game content. If anyone at Crate would prefer something here be changed or
removed, please reach out and we'll comply. Made with respect and
gratitude for the game and a mod-friendly studio.

## Quick start

Prereqs are managed for you via [`just`](https://github.com/casey/just),
[`bun`](https://bun.sh/), and [`uv`](https://docs.astral.sh/uv/). The recipes run
on macOS, Linux, and Windows (git-bash provides `bash`).

```bash
just doctor       # check tools + data are present, tells you what's missing
just install      # install uv + bun + jq (brew on macOS/Linux, winget on Windows)
```

`just install` uses your platform's package manager. If `just` itself isn't on
`PATH` yet, install it once with `brew install just` (macOS/Linux) or `winget
install Casey.Just` (Windows), then re-run.

### Web planner

The dataset and artwork are committed, so you can build and serve the planner on
any platform without extracting anything from the game:

```bash
just web-install  # install web dependencies (bun)
just serve        # build, then serve at http://localhost:5173
just check        # tests + lint + type-check (the full verification gate)
just test         # run the test suite
just lint         # lint with Biome (just lint-fix to auto-fix the safe ones)
just typecheck    # type-check with tsc (no emit)
just build        # build the static site into web/dist
```

### Regenerating the dataset (Windows only)

`data/devotions.json` ships in the repo; you only need this to rebuild it from a
patched game. Extraction runs Crate's `ArchiveTool.exe`, which is **Windows-only**:

```bash
just extract      # decompile database.arz + Text_EN.arc  (~5 GB free needed)
just parse        # produce devotions.json + validation report
# or just:
just all          # extract then parse
```

The parser script itself is self-executable via a uv shebang
(`#!/usr/bin/env -S uv run --script`) with inline PEP 723 metadata and **zero
dependencies**; it also runs directly:

```bash
uv run scripts/parse_devotions.py \
  --records-dir extracted/records --text-dir extracted/text_en \
  --out data/devotions.json --stat-labels
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

## Getting the data (extraction, Windows only)

`just extract` runs Crate's own `ArchiveTool.exe` (ships in the game install, so
extraction only runs on Windows):

```
ArchiveTool.exe "<GD>/database/database.arz" -database "extracted/records"
ArchiveTool.exe "<GD>/resources/Text_EN.arc" -extract "extracted/text_en"
```

Records land in `extracted/records/records/ui/skills/devotion/` and translations
in `extracted/text_en/text_en/*.txt`. The `extracted/` tree is **git-ignored**
(~5 GB); regenerate it anytime with `just extract`.

> Alternative: `AssetManager.exe → Tools → Extract Game Files` does the same via UI.

## Output schema (`devotions.json`)

```jsonc
{
  "meta": {
    "game_version": "1.2.1.x",
    "steam_buildid": "19149150",
    "extracted_from": "records/ui/skills/devotion/",
    "generated_utc": "2026-06-21T19:06:05Z",
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
      "background": { "image": "ui/skills/devotion/devotion_constellation001_bat.tex",
                      "x": -953, "y": 38, "dbr": "...constellation01_background.dbr" },
      "point_cost": 5,                       // = number of stars (1 point each)
      "stars": [
        {
          "index": 0,
          "dbr": "records/skills/devotion/tier1_01a.dbr",
          "predecessors": [],                // star indices within THIS constellation
          "position": { "x": -968, "y": 80 },// (x,y) on the shared devotion-map canvas
          "bonuses": { "offensiveLifeModifier": 15, "offensiveSlowBleedingModifier": 15 },
          "celestial_power": null,           // or { name, description, proc, level, stats, pet } on the last star
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
  best-effort human label. Note a GD quirk: internal `Life` = **Vitality**.
- `predecessors` are 0-based star indices; a star unlocks only after its
  predecessor(s) are taken. Tree/forest rooted at star 0.
- `position` is each star's `(x, y)` on a single shared map canvas (negative
  origin), and `background` is the constellation's artwork (`.tex`) + its
  placement on that same canvas, enough to redraw the in-game starmap. The
  `.tex` images themselves aren't extracted here (export via AssetManager).
- Tier‑3 constellations have an empty `affinity_bonus` (they grant none).
- Crossroads is 5 single-star constellations, ids `crossroads_<affinity>`.
- Stars that grant pet stats also carry `pet_bonuses` / `pet_bonus_dbr`.
- Stars with a vs-race bonus (`racialBonusPercentDamage/Defense`) carry
  `racial_target` (resolved race names, e.g. `["Beast"]`).
- Every object keeps its source `dbr` path for traceability.

`--duckdb` additionally emits `data/devotion_records.csv`, a long-format
`(dbr, key, value)` table of all devotion records for ad-hoc querying (DuckDB
reads the CSV, not `.dbr`). It's git-ignored (~32 MB).

## Validation

Every `just parse` prints a report and exits non-zero on anomalies: constellation
count, total stars, affinity-key sanity (must be the five known affinities),
predecessor-index bounds, unresolved `tag…` name leaks, celestial-power /
weapon-requirement counts, and a per-tier breakdown.

## Re-running after a patch

The parser **discovers** keys/paths at runtime and logs anything unexpected; it
does not hard-code the full key list. After any game update (notably **Fangs of
Asterkarn / v1.3, 2026‑07‑23**, which will likely change devotion balance), just:

```bash
just all          # re-extract + re-parse against the patched install
```

and the swapped-in `devotions.json` is current. Bump `GD_VERSION` to taste.

## Layout

```
LICENSE                      # MIT (covers our code only; game content is Crate's)
justfile                     # doctor / install / build / serve / test / extract / parse
ONBOARDING.md                # stack, commands, architecture, key paths (start here as a contributor)
scripts/parse_devotions.py   # the parser (uv self-executable, stdlib only)
web/                         # the in-browser planner (hexagonal TS: core / ports / adapters / app)
web/wasm/                    # Rust reachability core, built to data/reach.wasm
docs/devotion-system.md      # the devotion rules + non-obvious construction consequences
docs/dbr-format.md           # the reverse-engineered game data model
docs/reachability-engine.md  # reachability resolver design + tradeoffs
docs/display-model.md        # the map's display language (brightness / color / emphasis)
docs/assets-and-textures.md  # how to extract + convert the .tex artwork to PNG
data/devotions.json          # parser output (committed; the planner's source of truth)
data/stat_labels.json        # parser output (--stat-labels, committed)
data/devotion_records.csv    # parser output (--duckdb, git-ignored)
extracted/                   # game files, git-ignored; `just extract` to rebuild
```
