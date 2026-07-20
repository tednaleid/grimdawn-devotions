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

# Install the Rust toolchain + wasm32 target (only needed to rebuild the reachability WASM core).
# The site builds and runs without it: the engine falls back to the (slower) TS resolver when
# data/reach.wasm is absent. cargo lands in ~/.cargo/bin; open a new shell for it on PATH.
install-rust:
    #!/usr/bin/env bash
    set -euo pipefail
    rustup_bin() { command -v rustup 2>/dev/null || { [ -x "$HOME/.cargo/bin/rustup" ] && echo "$HOME/.cargo/bin/rustup"; }; }
    if [ -z "$(rustup_bin)" ]; then
        if command -v winget >/dev/null 2>&1; then
            echo "Installing rustup via winget..."
            winget install --id Rustlang.Rustup -e --silent --accept-source-agreements --accept-package-agreements
        elif command -v brew >/dev/null 2>&1; then
            echo "Installing rustup via brew..."; brew install rustup-init && rustup-init -y --no-modify-path
        else
            echo "No winget/brew found. Install rustup from https://rustup.rs then re-run."; exit 1
        fi
    fi
    RUSTUP="$(rustup_bin)"; [ -n "$RUSTUP" ] || { echo "rustup not found after install; open a new shell and re-run."; exit 1; }
    "$RUSTUP" target add wasm32-unknown-unknown
    echo "Rust + wasm32 target ready. If 'cargo' is not on PATH yet, open a new shell."

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

# Parse extracted records into devotions.json (passes version + steam build id). Game text tables
# (including English) are built separately by `just i18n-tables`, the single generic builder.
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
all: extract parse i18n-tables

# KEEPS the committed dataset (data/devotions.json, data/stat_labels.json) — those only
# regenerate via `just parse` on Windows, so clean must never delete them.
# Remove build artifacts: web/dist, data/cover-table.bin, data/reach.wasm, web/wasm/target, csv dump.
clean:
    rm -rf "{{justfile_directory()}}/web/dist" \
           "{{justfile_directory()}}/web/wasm/target" \
           "{{justfile_directory()}}/data/cover-table.bin" \
           "{{justfile_directory()}}/data/reach.wasm" \
           "{{justfile_directory()}}/data/devotion_records.csv"

# Extract + optimize devotion artwork from the base + expansion UI.arc archives into assets/ (WebP + manifest)
assets *ARGS: _require-game-closed
    uv run scripts/build_assets.py --gd-dir "{{gd_dir}}" \
        --out-dir "{{justfile_directory()}}/assets/devotions" {{ARGS}}

# Build data/i18n/game.<lang>.json for every installed language, or just the ones you name:
#   `just i18n-tables`  (all)  |  `just i18n-tables es fr`  (some)  |  `just i18n-tables en`  (english).
# This is the single, generic builder of ALL game text tables. English is special only in WHERE its
# text comes from: it is merged across the base game + expansions into extracted/text_en by
# `just extract`, so `en` reuses that (run `just extract` first). Each non-English language ships as
# one consolidated resources/Text_<LANG>.arc, extracted here (Windows-only; needs ArchiveTool). New
# languages Crate adds are picked up automatically by discovery.
# ArchiveTool needs an ABSOLUTE -extract path (a relative one fails to open the output file: it prints
# progress and exits 0 but writes zero files, and pops an archivewriter.cpp assert on debug builds) and
# stdin redirected (`< /dev/null`, else it blocks). Both are handled below.
i18n-tables *LANGS:
    #!/usr/bin/env bash
    set -euo pipefail
    GD="{{gd_dir}}"
    AT="$GD/ArchiveTool.exe"
    # Named languages, or every installed resources/Text_*.arc discovered.
    langs="{{LANGS}}"
    if [ -z "$langs" ]; then
      langs=$(ls "$GD"/resources/Text_*.arc 2>/dev/null \
        | sed -E 's#.*/Text_(.*)\.arc#\1#' | tr '[:upper:]' '[:lower:]' | sort | tr '\n' ' ')
    fi
    built=""; skipped=""
    for L in $langs; do
      L=$(echo "$L" | tr '[:upper:]' '[:lower:]')
      if [ "$L" = "en" ]; then
        # English text is the merged base+expansion table produced by `just extract`, not a single arc.
        tdir="{{text_dir}}"
        if [ "$(find "$tdir" -name '*.txt' 2>/dev/null | wc -l)" -eq 0 ]; then
          echo "skip en (no {{text_dir}}; run 'just extract' first)"; skipped="$skipped en"; continue
        fi
      else
        [ -x "$AT" ] || { echo "ArchiveTool not found at $AT (set GD_DIR; needs a local Grim Dawn install)"; exit 1; }
        U=$(echo "$L" | tr '[:lower:]' '[:upper:]')
        arc="$GD/resources/Text_$U.arc"
        [ -f "$arc" ] || { echo "skip $L (no $arc)"; skipped="$skipped $L"; continue; }
        tdir="{{justfile_directory()}}/extracted/text_$L"   # absolute path is required (see header)
        rm -rf "$tdir" && mkdir -p "$tdir"
        echo "extracting $U ..."
        "$AT" "$arc" -extract "$tdir" < /dev/null >/dev/null 2>&1 || true
        if [ "$(find "$tdir" -name '*.txt' | wc -l)" -eq 0 ]; then
          echo "skip $L (extracted 0 files - arc unreadable? try Steam 'verify integrity of game files')"
          skipped="$skipped $L"; continue
        fi
      fi
      uv run scripts/build_game_tables.py --devotions "{{out}}" --stat-tags data/stat-tags.json \
        --stat-format-tags data/stat-format-tags.json \
        --text-dir "$tdir" --lang "$L" --out "data/i18n/game.$L.json"
      built="$built $L"
    done
    echo "built:$built"
    [ -n "$skipped" ] && echo "skipped:$skipped" || true

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

# Add the wasm32 target if it is not already installed (cheap check; no-op when present).
# Kept separate from install-rust so `just wasm` can self-heal a missing target without ever
# triggering a full rustup install (winget/brew). If rustup itself is absent, point at install-rust.
_ensure-wasm-target:
    #!/usr/bin/env bash
    set -euo pipefail
    RUSTUP="$(command -v rustup 2>/dev/null || true)"; [ -n "$RUSTUP" ] || RUSTUP="$HOME/.cargo/bin/rustup"
    "$RUSTUP" --version >/dev/null 2>&1 || { echo "rustup not found - run 'just install-rust' (open a new shell after install)."; exit 1; }
    if ! "$RUSTUP" target list --installed 2>/dev/null | grep -q '^wasm32-unknown-unknown$'; then
        echo "wasm32-unknown-unknown target missing; adding it ..."
        "$RUSTUP" target add wasm32-unknown-unknown
    fi

# Depends on _ensure-wasm-target, which cheaply adds the wasm32 target if missing (run
# `just install-rust` first if you have no rust toolchain at all). The engine loads this for the
# fast resolver; absent, it falls back to the TS resolver, so this is optional for a working build.
# Build the reachability core to WebAssembly (raw wasm32, no wasm-bindgen) into data/reach.wasm.
wasm: _ensure-wasm-target
    #!/usr/bin/env bash
    set -euo pipefail
    CARGO="$(command -v cargo 2>/dev/null || true)"; [ -n "$CARGO" ] || CARGO="$HOME/.cargo/bin/cargo"
    "$CARGO" --version >/dev/null 2>&1 || { echo "cargo not found - run 'just install-rust' (open a new shell after install)."; exit 1; }
    cd "{{justfile_directory()}}/web/wasm"
    "$CARGO" build --release --target wasm32-unknown-unknown
    cp target/wasm32-unknown-unknown/release/reach.wasm "{{justfile_directory()}}/data/reach.wasm"
    echo "built data/reach.wasm ($(wc -c < "{{justfile_directory()}}/data/reach.wasm") bytes)"

# Run the core test suite. Pass args to target a file or filter, e.g.
#   just test test/reachability.test.ts   (one file)   |   just test -t Oklaine   (by name)
# The heavy downward-closure walk is gated out of this run; see `just test-slow`.
test *ARGS:
    cd "{{justfile_directory()}}/web" && bun test {{ARGS}}

# Slow reachability property tier: the heavy metamorphic downward-closure walk, gated behind REACH_SLOW
# so the default suite (and the pre-commit hook) stay fast. Run before big engine changes.
test-slow:
    cd "{{justfile_directory()}}/web" && REACH_SLOW=1 bun test test/reachability-monotonicity.test.ts

# Per-click engine perf harness. Times selectionView (the validity-floor search + dimming sweep) = the
# EXACT work one UI click costs; this is the pure core engine to optimize so the UI is fast (no DOM). Two
# passes: demanding singletons (each non-self-covering constellation whole from empty - the freeze cases)
# and seeded random play. `just perf` uses the deployed WASM path; `just perf --ts` measures the pure TS
# core algorithm you iterate on. Flags: --seeds N --start S --cap C --max-ms M --replay <seed> --ts.
perf *ARGS:
    cd "{{justfile_directory()}}/web" && bun scripts/perf-reachability.ts {{ARGS}}

# Seeded reachability correctness fuzzer: build known-valid builds forward (ground-truth rule), replay
# them claim-anywhere, assert the engine never dims a valid-build member. Flags: --seeds N --start S
# --ts.  e.g. just fuzz --seeds 200.  Uses the WASM resolver if built (just wasm).
fuzz *ARGS:
    cd "{{justfile_directory()}}/web" && bun scripts/reachability-fuzz.ts {{ARGS}}

# Regenerate the reachable-builds fixture (web/test/fixtures/reachable-builds.json): ground-truth-reachable
# builds the engine wrongly dims (confirmed by the constructor) plus guards. Run after a data change.
gen-reach-fixtures:
    cd "{{justfile_directory()}}/web" && bun scripts/gen-reach-fixtures.ts

# Metamorphic false-dim harvester: seeded ADDITIVE star walks. Reachability is downward-closed, so any
# constellation that becomes viable after an additive pick was a false-dim before (oracle-free, real model).
# Reports the rate and dumps cases to web/test/fixtures/false-dims.json. Flags: --seeds N --start S
# --max-pts P --cap C --ts --no-dump.  e.g. just harvest-false-dims --seeds 30.  Re-run after a data change.
harvest-false-dims *ARGS:
    cd "{{justfile_directory()}}/web" && bun scripts/harvest-false-dims.ts {{ARGS}}

# Heavy reachability validation for big algorithm changes (minutes): cross-checks the engine against the
# BFS oracle at scale (both directions) and harvests ground-truth real-model false-dims. Exits non-zero
# on any disagreement. Flags: --a-seeds N (small-model oracle) --b-seeds N (real-model harvest).
validate-reach *ARGS:
    cd "{{justfile_directory()}}/web" && bun scripts/validate-reach.ts {{ARGS}}

# Verify the Rust/WASM resolver is verdict-equivalent to the TS resolver (run after `just wasm`).
validate-wasm:
    cd "{{justfile_directory()}}/web" && bun scripts/validate-wasm.ts

# Audit the engine's false-reach (soundness) gap vs the BFS oracle: which classify path emits it, whether
# the rate shrinks with budget, and a real-model upper bound via the sound peak witness. See
# docs/reachability-engine.md "Update 2026-06-25: false-reach audit".
audit-false-reach:
    cd "{{justfile_directory()}}/web" && bun scripts/audit-false-reach.ts

# Shape-biased reachability fuzz: stress the engine on the shape that caused our real trouble (multi-color
# requirement, partial self-payback) at real-map-like abundance, against the BFS oracle in both directions.
# Surfaces the construction-PEAK false-reach when two such constellations are stacked in a tight budget.
# Flags: --seeds N --start S --dump K.  See docs/reachability-engine.md "shape-biased fuzz".
shape-fuzz *ARGS:
    cd "{{justfile_directory()}}/web" && bun scripts/reachability-shape-fuzz.ts {{ARGS}}

# Real-map false-reach hunt: generate tight near-budget self-covering REAL builds that stack the
# Affliction-like shape, ask the SHIPPED engine if it lights them, and PROVE which are unconstructible
# within 55 via the costed branch's exactMinPeak (vendored as a 3-way oracle). A build the engine lights
# that the oracle proves unreachable is a confirmed real-map false-reach. Flags: --seeds N --start S --dump K.
realmap-hunt *ARGS:
    cd "{{justfile_directory()}}/web" && bun scripts/reachability-realmap-hunt.ts {{ARGS}}

# Validate the guided-build-order engine: measure buildOrderPath's false-negative rate (misses an order the
# exact minPeakCost oracle proves exists) and false-positive rate (shows an illegal path) across typical
# self-covering builds, single-constellation partials, and random subsets. Flags: --seeds N --subsets M.
build-order-validate *ARGS:
    cd "{{justfile_directory()}}/web" && bun scripts/build-order-validate.ts {{ARGS}}

# Harvest the tight-cap adversarial build-order corpus (near-cap, refund-heavy orders) into
# web/test/fixtures/tight-cap-builds.json.  e.g. just hunt-tight-cap --seeds 5000 --keep 12
hunt-tight-cap *ARGS:
    cd "{{justfile_directory()}}/web" && bun scripts/hunt-tight-cap.ts {{ARGS}}

# Build-order quality metrics on the pinned 150-seed corpus + the reproduction URL: per-build
# churn/steps CSV on stdout, aggregates on stderr. The launch-gate before/after comparison tool.
order-quality:
    cd "{{justfile_directory()}}/web" && bun scripts/order-quality.ts

# Type-check the web sources (no emit)
typecheck:
    cd "{{justfile_directory()}}/web" && bunx tsc --noEmit

# Lint the web sources with Biome (warnings fail too, so check/CI catch them)
lint:
    cd "{{justfile_directory()}}/web" && bunx biome lint --error-on-warnings

# Auto-fix the safe lint findings Biome can resolve on its own
lint-fix:
    cd "{{justfile_directory()}}/web" && bunx biome lint --write

# Format the web sources with Biome (writes changes in place)
fmt:
    cd "{{justfile_directory()}}/web" && bunx biome format --write

# Verify formatting without writing (fails if anything is unformatted); used by check + CI
fmt-check:
    cd "{{justfile_directory()}}/web" && bunx biome format

# Full verification gate: formatting, tests, lint, and type-check
check: fmt-check test lint typecheck

# Opt-in (hooks are not tracked): run this once after cloning.
# Install a git pre-commit hook that runs `just check` before each commit.
install-hooks:
    #!/usr/bin/env bash
    set -euo pipefail
    hook="{{justfile_directory()}}/.git/hooks/pre-commit"
    printf '#!/bin/sh\njust check\n' > "$hook"
    chmod +x "$hook"
    echo "Installed pre-commit hook: $hook"

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
    bun scripts/bundle.ts
    cp "{{justfile_directory()}}/data/devotions.json" dist/data/devotions.json
    cp "{{justfile_directory()}}/data/cover-table.bin" dist/data/cover-table.bin
    mkdir -p dist/data/i18n && cp "{{justfile_directory()}}/data/i18n/"*.json dist/data/i18n/
    # Keep the fast resolver in sync with its Rust source: reach.wasm is a gitignored artifact that
    # `build` only copies, so a stale binary ships silently (correct but slow) unless we rebuild it.
    # Rebuild when it is missing or older than web/wasm/src/lib.rs AND cargo is available; without a
    # toolchain we warn rather than fail, and the page falls back to the TS resolver.
    WASM="{{justfile_directory()}}/data/reach.wasm"
    WASM_SRC="{{justfile_directory()}}/web/wasm/src/lib.rs"
    CARGO="$(command -v cargo 2>/dev/null || true)"; [ -n "$CARGO" ] || CARGO="$HOME/.cargo/bin/cargo"
    if [ ! -f "$WASM" ] || [ "$WASM_SRC" -nt "$WASM" ]; then
      if "$CARGO" --version >/dev/null 2>&1; then
        echo "reach.wasm missing or stale vs its Rust source; rebuilding via 'just wasm'..."
        ( cd "{{justfile_directory()}}" && just wasm )
      else
        echo "WARNING: data/reach.wasm is missing or older than web/wasm/src/lib.rs and cargo is unavailable; shipping the existing resolver (may be stale). Run 'just install-rust' then 'just wasm' for the fast path."
      fi
    fi
    if [ -f "{{justfile_directory()}}/data/reach.wasm" ]; then cp "{{justfile_directory()}}/data/reach.wasm" dist/data/reach.wasm; else echo "(no data/reach.wasm; run 'just wasm' for the fast resolver - the page falls back to TS)"; fi
    if [ -d "{{justfile_directory()}}/assets" ]; then cp -r "{{justfile_directory()}}/assets" dist/assets; fi
    cp -r "{{justfile_directory()}}/web/src/i18n" dist/i18n
    echo "Built web/dist"

# Serve web/dist locally for development (does not cd into dist, so rebuilds are not blocked)
serve: build
    bunx serve "{{justfile_directory()}}/web/dist" -l 5173

# Stop a running dev server (frees port 5173). Safe to run when nothing is listening.
stop:
    #!/usr/bin/env bash
    set -uo pipefail
    port=5173
    case "$(uname -s)" in
      MINGW*|MSYS*|CYGWIN*)
        pid=$(netstat -ano 2>/dev/null | grep -E ":$port[[:space:]].*LISTENING" | awk '{print $NF}' | sort -u | head -1)
        if [ -n "${pid:-}" ]; then taskkill //F //T //PID "$pid" >/dev/null 2>&1 && echo "stopped server on :$port (pid $pid)"; else echo "no server on :$port"; fi
        ;;
      *)
        pids=$(lsof -ti "tcp:$port" 2>/dev/null || true)
        if [ -n "${pids:-}" ]; then kill $pids 2>/dev/null && echo "stopped server on :$port (pids $pids)"; else echo "no server on :$port"; fi
        ;;
    esac

# Install the headless Chromium the e2e check drives (run once)
install-e2e:
    cd "{{justfile_directory()}}/web" && bunx playwright@1.61.0 install chromium

# Build, then verify the page works in a real headless browser.
# Drives Chromium with a raw CDP client over bun's native WebSocket; playwright's
# own pipe and ws transports do not connect under bun on Windows. Run install-e2e once first.
e2e: build
    cd "{{justfile_directory()}}/web" && bun e2e/smoke.ts
