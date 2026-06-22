# Grim Dawn Devotion parser — task runner
# Run `just` with no args to list recipes. Works on macOS, Linux, and Windows (git-bash provides bash).

set shell := ["bash", "-uc"]
set windows-shell := ["bash", "-uc"]

# --- Configurable paths -----------------------------------------------------
# Override on the CLI, e.g.  just gd_dir="D:/Games/Grim Dawn" extract
gd_dir      := env_var_or_default("GD_DIR", "C:/Program Files (x86)/Steam/steamapps/common/Grim Dawn")
gd_version  := env_var_or_default("GD_VERSION", "1.2.1.x")
records_dir := justfile_directory() / "extracted/records"
text_dir    := justfile_directory() / "extracted/text_en"
out         := justfile_directory() / "data/devotions.json"

# Default: show available recipes
default:
    @just --list

# --- Prerequisite checks ----------------------------------------------------

# Check tools + committed data needed to build/serve (extraction prereqs optional, Windows-only)
doctor:
    #!/usr/bin/env bash
    set -uo pipefail
    ok=0; fail=0
    check() { if command -v "$1" >/dev/null 2>&1; then echo "  ok   $1 ($("$1" --version 2>&1 | head -1))"; ok=$((ok+1)); else echo "  MISS $1  — $2"; fail=$((fail+1)); fi; }
    echo "Tools:"
    check git "install Git"
    check uv  "run 'just install-uv'"
    check bun "run 'just install-bun'"
    check jq  "run 'just install-jq'"
    case "$(uname -s)" in
      Darwin|Linux) check brew "package manager — https://brew.sh" ;;
      *)            check winget "package manager — ships with Windows 10/11" ;;
    esac
    echo "Web data (committed; needed for build/serve):"
    for f in data/devotions.json; do
      if [ -f "{{justfile_directory()}}/$f" ]; then echo "  ok   $f"; ok=$((ok+1)); else echo "  MISS $f — run 'just parse'"; fail=$((fail+1)); fi
    done
    if [ -d "{{justfile_directory()}}/assets/devotions" ]; then echo "  ok   assets/devotions"; ok=$((ok+1)); else echo "  warn assets/devotions missing — run 'just assets' (artwork is optional)"; fi
    echo "Extraction prereqs (optional; Windows-only, only needed to re-extract game data):"
    if [ -f "{{gd_dir}}/database/database.arz" ]; then echo "  ok   Grim Dawn at {{gd_dir}}"; else echo "  n/a  Grim Dawn not found at {{gd_dir}} (set GD_DIR to extract)"; fi
    if [ -d "{{records_dir}}/records/ui/skills/devotion" ]; then echo "  ok   records extracted"; else echo "  n/a  records not extracted (run 'just extract' on Windows)"; fi
    if ls "{{text_dir}}"/*/tags_skills.txt >/dev/null 2>&1 || ls "{{text_dir}}"/tags_skills.txt >/dev/null 2>&1; then echo "  ok   text_en extracted"; else echo "  n/a  text_en not extracted (run 'just extract' on Windows)"; fi
    echo "---"
    if [ "$fail" -eq 0 ]; then echo "All good ($ok checks passed). Ready to build/serve."; else echo "$fail item(s) need attention."; exit 1; fi

# --- Installers -------------------------------------------------------------
# brew on macOS/Linux, winget on Windows. Each tool is skipped if already
# present, so these are safe to re-run.

# Install one CLI via the platform package manager if it is missing
_install-tool tool brew_formula winget_id:
    #!/usr/bin/env bash
    set -euo pipefail
    if command -v "{{tool}}" >/dev/null 2>&1; then echo "{{tool}} already installed: $({{tool}} --version 2>&1 | head -1)"; exit 0; fi
    if command -v brew >/dev/null 2>&1; then
        echo "Installing {{tool}} via brew..."
        brew install "{{brew_formula}}"
    elif command -v winget >/dev/null 2>&1; then
        echo "Installing {{tool}} via winget..."
        winget install --id "{{winget_id}}" -e --accept-source-agreements --accept-package-agreements
        echo "{{tool}} installed. NOTE: open a new shell so '{{tool}}' is on PATH."
    else
        echo "No supported package manager found (need brew on macOS/Linux, or winget on Windows)."
        echo "Install {{tool}} manually, then re-run."
        exit 1
    fi

# Install uv (Python manager) if missing
install-uv: (_install-tool "uv" "uv" "astral-sh.uv")

# Install bun (web toolchain) if missing
install-bun: (_install-tool "bun" "bun" "Oven-sh.Bun")

# Install jq (JSON CLI) if missing
install-jq: (_install-tool "jq" "jq" "jqlang.jq")

# Install everything needed to run the parser + web build (uv + bun + jq + a managed Python)
install: install-uv install-bun install-jq
    @command -v uv >/dev/null 2>&1 && uv python install || echo "Re-run 'just install' once 'uv' is on PATH."

# --- Pipeline ---------------------------------------------------------------

# Abort if Grim Dawn is running: it holds its .arc resource archives open, so
# ArchiveTool extracts nothing from them (silently producing empty text/art).
_require-game-closed:
    #!/usr/bin/env bash
    set -euo pipefail
    if command -v tasklist >/dev/null 2>&1 && tasklist 2>/dev/null | grep -qi "Grim Dawn.exe"; then
        echo "ERROR: Grim Dawn is running. Fully exit the game (to desktop), then re-run."
        echo "       The open game locks its .arc resource archives, so the output would be missing."
        exit 1
    fi

# Extract records + English text from the base game and expansions (Windows-only: runs the game's ArchiveTool.exe; needs ~5 GB free)
extract: _require-game-closed
    #!/usr/bin/env bash
    set -euo pipefail
    GD="{{gd_dir}}"
    [ -f "$GD/database/database.arz" ] || { echo "Grim Dawn not found at $GD"; echo "Set GD_DIR env var or pass gd_dir=... See README."; exit 1; }
    # Start clean so a constellation removed by a patch cannot linger as a stale file.
    rm -rf "{{records_dir}}" "{{text_dir}}"
    mkdir -p "{{records_dir}}" "{{text_dir}}"
    AT="$GD/ArchiveTool.exe"
    # Extract one layer: every *.arz database and the Text_EN.arc under a game dir.
    extract_layer() { # <label> <dir>
        local arz arc
        for arz in "$2"/database/*.arz; do
            [ -e "$arz" ] || continue
            echo "Extracting $1 records ($(basename "$arz")) ..."
            "$AT" "$arz" -database "{{records_dir}}" >/dev/null
        done
        arc="$2/resources/Text_EN.arc"
        [ -f "$arc" ] && { echo "Extracting $1 text ..."; "$AT" "$arc" -extract "{{text_dir}}" >/dev/null; }
    }
    # Base game first, then every official expansion (gdx1 = Ashes of Malmouth,
    # gdx2 = Forgotten Gods, gdx3+ = future) in version/load order. Later archives
    # override and extend earlier ones (Forgotten Gods reworked the devotion map and
    # adds constellations like Lotus and Scarab), so they overlay the same dirs.
    # Expansions are discovered by the gdx* convention, so a new release is picked
    # up with no recipe change. Crucible (survivalmode*) and mods are excluded by
    # design - they carry no campaign devotion constellations.
    extract_layer "base game" "$GD"
    while IFS= read -r dir; do
        [ -n "$dir" ] && extract_layer "$(basename "${dir%/}")" "${dir%/}"
    done < <(ls -d "$GD"/gdx*/ 2>/dev/null | sort -V)
    echo "Done."

# Parse extracted records into devotions.json (passes version + steam build id)
parse *ARGS:
    #!/usr/bin/env bash
    set -euo pipefail
    # Best-effort: read the Steam build id from the app manifest for provenance.
    manifest="{{gd_dir}}/../../appmanifest_219990.acf"
    buildid=$(grep -oE '"buildid"[[:space:]]+"[0-9]+"' "$manifest" 2>/dev/null | grep -oE '[0-9]+' || true)
    mkdir -p "$(dirname "{{out}}")"
    uv run scripts/parse_devotions.py \
        --records-dir "{{records_dir}}" --text-dir "{{text_dir}}" --out "{{out}}" \
        --game-version "{{gd_version}}" ${buildid:+--steam-buildid "$buildid"} {{ARGS}}

# Full pipeline: extract then parse
all: extract parse

# Remove generated output (keeps extracted game files)
clean:
    rm -f "{{out}}" "{{justfile_directory()}}/data/stat_labels.json" "{{justfile_directory()}}/data/devotion_records.csv"

# Extract + optimize devotion artwork from the base + expansion UI.arc archives into assets/ (WebP + manifest)
assets *ARGS: _require-game-closed
    uv run scripts/build_assets.py --gd-dir "{{gd_dir}}" \
        --out-dir "{{justfile_directory()}}/assets/devotions" {{ARGS}}

# Install web dependencies (bun)
web-install:
    cd "{{justfile_directory()}}/web" && bun install

# Generate the precomputed cover table from data/devotions.json (only if stale)
cover-table:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ ! -f "{{justfile_directory()}}/data/cover-table.bin" ] || [ "{{justfile_directory()}}/data/devotions.json" -nt "{{justfile_directory()}}/data/cover-table.bin" ]; then
        cd "{{justfile_directory()}}/web" && bun scripts/build-cover-table.ts
    else
        echo "cover-table.bin is up to date"
    fi

# Run the core test suite
test:
    cd "{{justfile_directory()}}/web" && bun test

# Type-check the web sources (no emit)
typecheck:
    cd "{{justfile_directory()}}/web" && bunx tsc --noEmit

# Lint the web sources with Biome
lint:
    cd "{{justfile_directory()}}/web" && bunx biome lint

# Auto-fix the safe lint findings Biome can resolve on its own
lint-fix:
    cd "{{justfile_directory()}}/web" && bunx biome lint --write

# Full verification gate: tests, lint, and type-check
check: test lint typecheck

# Build the static site into web/dist (bundles JS, copies html/css/data/assets)
build: cover-table
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{justfile_directory()}}/web"
    # Clean dist contents in place (not the dir itself), so a running `serve` holding
    # dist does not cause `rm -rf dist` to fail with "Device or resource busy".
    mkdir -p dist
    rm -rf dist/* dist/.[!.]* 2>/dev/null || true
    mkdir -p dist/data
    BUILD_ID=$(bun -e 'import {computeBuildId} from "./src/adapters/coverTableBlob"; console.log(computeBuildId(await Bun.file("../data/devotions.json").text()))')
    bun build src/app/main.ts --outdir dist --target browser --define __BUILD_ID__="\"$BUILD_ID\""
    cp index.html dist/index.html
    cp src/styles.css dist/styles.css
    cp "{{justfile_directory()}}/data/devotions.json" dist/data/devotions.json
    cp "{{justfile_directory()}}/data/cover-table.bin" dist/data/cover-table.bin
    if [ -d "{{justfile_directory()}}/assets" ]; then cp -r "{{justfile_directory()}}/assets" dist/assets; fi
    echo "Built web/dist (buildId $BUILD_ID)"

# Serve web/dist locally for development (does not cd into dist, so rebuilds are not blocked)
serve: build
    bunx serve "{{justfile_directory()}}/web/dist" -l 5173

# Install the headless Chromium the e2e check drives (run once)
install-e2e:
    cd "{{justfile_directory()}}/web" && bunx playwright@1.61.0 install chromium

# Build, then verify the page works in a real headless browser.
# Drives Chromium with a raw CDP client over bun's native WebSocket; playwright's
# own pipe and ws transports do not connect under bun on Windows. Run install-e2e once first.
e2e: build
    cd "{{justfile_directory()}}/web" && bun e2e/smoke.ts
