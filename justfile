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
out         := justfile_directory() / "devotions.json"

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

# Install everything needed to run the parser (uv + a managed Python)
install: install-uv
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
    uv run scripts/parse_devotions.py \
        --records-dir "{{records_dir}}" --text-dir "{{text_dir}}" --out "{{out}}" \
        --game-version "{{gd_version}}" ${buildid:+--steam-buildid "$buildid"} {{ARGS}}

# Full pipeline: extract then parse
all: extract parse

# Remove generated output (keeps extracted game files)
clean:
    rm -f "{{out}}" "{{justfile_directory()}}/stat_labels.json"
