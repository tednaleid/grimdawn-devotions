# Grim Dawn Devotion parser — task runner
# Run `just` with no args to list recipes. Requires git-bash (Windows) or bash.

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

# Verify all tools and extracted data are present
doctor:
    #!/usr/bin/env bash
    set -uo pipefail
    ok=0; fail=0
    check() { if command -v "$1" >/dev/null 2>&1; then echo "  ok   $1 ($("$1" --version 2>&1 | head -1))"; ok=$((ok+1)); else echo "  MISS $1  — $2"; fail=$((fail+1)); fi; }
    echo "Tools:"
    check git  "install Git for Windows"
    check uv   "run 'just install-uv'"
    check winget "Windows package manager (ships with Win10/11)"
    check bun  "run 'just install' (winget install Oven-sh.Bun) then open a new shell"
    check jq   "run 'just install' (winget install jqlang.jq) then open a new shell"
    echo "Game install:"
    if [ -f "{{gd_dir}}/database/database.arz" ]; then echo "  ok   Grim Dawn at {{gd_dir}}"; else echo "  MISS Grim Dawn not found at {{gd_dir}} — set GD_DIR or pass gd_dir=..."; fail=$((fail+1)); fi
    echo "Extracted data:"
    if [ -d "{{records_dir}}/records/ui/skills/devotion" ]; then echo "  ok   records extracted"; else echo "  MISS records — run 'just extract'"; fail=$((fail+1)); fi
    if ls "{{text_dir}}"/*/tags_skills.txt >/dev/null 2>&1 || ls "{{text_dir}}"/tags_skills.txt >/dev/null 2>&1; then echo "  ok   text_en extracted"; else echo "  MISS text_en — run 'just extract'"; fail=$((fail+1)); fi
    echo "---"
    if [ "$fail" -eq 0 ]; then echo "All good ($ok checks passed)."; else echo "$fail item(s) need attention."; exit 1; fi

# --- Installers -------------------------------------------------------------

# Install uv (Python manager) via winget if missing
install-uv:
    #!/usr/bin/env bash
    set -euo pipefail
    if command -v uv >/dev/null 2>&1; then echo "uv already installed: $(uv --version)"; exit 0; fi
    echo "Installing uv via winget..."
    winget install --id astral-sh.uv -e --accept-source-agreements --accept-package-agreements
    echo "uv installed. NOTE: open a new shell (or restart your terminal) so 'uv' is on PATH."

# Install bun (web toolchain) via winget if missing
install-bun:
    #!/usr/bin/env bash
    set -euo pipefail
    if command -v bun >/dev/null 2>&1; then echo "bun already installed: $(bun --version)"; exit 0; fi
    echo "Installing bun via winget..."
    winget install --id Oven-sh.Bun -e --accept-source-agreements --accept-package-agreements
    echo "bun installed. NOTE: open a new shell so 'bun' is on PATH."

# Install jq (JSON CLI) via winget if missing
install-jq:
    #!/usr/bin/env bash
    set -euo pipefail
    if command -v jq >/dev/null 2>&1; then echo "jq already installed: $(jq --version)"; exit 0; fi
    echo "Installing jq via winget..."
    winget install --id jqlang.jq -e --accept-source-agreements --accept-package-agreements
    echo "jq installed. NOTE: open a new shell so 'jq' is on PATH."

# Install everything needed to run the parser (uv + a managed Python)
install: install-uv install-bun install-jq
    @command -v uv >/dev/null 2>&1 && uv python install || echo "Re-run 'just install' in a fresh shell so uv is on PATH."

# --- Pipeline ---------------------------------------------------------------

# Extract records + English text from the game install (needs ~5 GB free)
extract:
    #!/usr/bin/env bash
    set -euo pipefail
    GD="{{gd_dir}}"
    [ -f "$GD/database/database.arz" ] || { echo "Grim Dawn not found at $GD"; echo "Set GD_DIR env var or pass gd_dir=... See README."; exit 1; }
    mkdir -p "{{records_dir}}" "{{text_dir}}"
    echo "Extracting database.arz -> records ..."
    "$GD/ArchiveTool.exe" "$GD/database/database.arz" -database "{{records_dir}}"
    echo "Extracting Text_EN.arc -> text_en ..."
    "$GD/ArchiveTool.exe" "$GD/resources/Text_EN.arc" -extract "{{text_dir}}"
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

# Extract + optimize devotion artwork into git-ignored assets/ (WebP + manifest)
assets *ARGS:
    uv run scripts/build_assets.py --gd-dir "{{gd_dir}}" \
        --out-dir "{{justfile_directory()}}/assets/devotions" {{ARGS}}

# Install web dependencies (bun)
web-install:
    cd "{{justfile_directory()}}/web" && bun install

# Run the core test suite
test:
    cd "{{justfile_directory()}}/web" && bun test

# Build the static site into web/dist (bundles JS, copies html/css/data/assets)
build:
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{justfile_directory()}}/web"
    # Clean dist contents in place (not the dir itself), so a running `serve` holding
    # dist does not cause `rm -rf dist` to fail with "Device or resource busy".
    mkdir -p dist
    rm -rf dist/* dist/.[!.]* 2>/dev/null || true
    mkdir -p dist/data
    bun build src/app/main.ts --outdir dist --target browser
    cp index.html dist/index.html
    cp src/styles.css dist/styles.css
    cp "{{justfile_directory()}}/data/devotions.json" dist/data/devotions.json
    cp "{{justfile_directory()}}/data/stat_labels.json" dist/data/stat_labels.json
    if [ -d "{{justfile_directory()}}/assets" ]; then cp -r "{{justfile_directory()}}/assets" dist/assets; fi
    echo "Built web/dist"

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
