# Onboarding

A fan-made toolkit for Grim Dawn: Python parsers turn the game's own `.dbr`
records into clean committed datasets, and static, in-browser pages render them.
Three pages ship today, sharing one deploy and one localization/app-menu chrome
but each with its own hexagonal core: the **devotion planner** (`data/devotions.json`,
`web/src/`) renders the devotion starmap and lets you plan builds; the
**resistance-reduction reference** (`data/resistance-reduction.json`, `web/src/rr/`)
tabulates every RR source with a debuff ledger; the **monster resistance explorer**
(`data/monsters.json`, `web/src/monsters/`) ranks damage types by how well enemies
resist them and lets you filter/sort the underlying monster table. Deployed to
GitHub Pages; no backend, no accounts.

## Stack
- Language: TypeScript (planner), Python 3 (parser), Rust (reachability core)
- Frameworks: none; vanilla TS + SVG, bundled by Bun
- Build: Bun (web), uv (parser, stdlib-only), cargo + wasm32 (reachability)
- Task runner: `just` (authoritative; the justfile is cross-platform via bash)

## Common commands
- Install: `just web-install`
- Build: `just build`
- Test: `just test`
- Lint: `just lint`
- Typecheck: `just typecheck`
- Format: `just fmt`
- Run: `just serve` (builds, serves http://localhost:5173)
- Check (gate, run before commit; also CI): `just check`
- Reachability WASM core (optional fast path): `just wasm`
- Per-click engine perf: `just perf` (times `selectionView`, the exact cost one UI click pays = the core
  to optimize; deployed WASM path) or `just perf --ts` (the pure TS core algorithm you iterate on)
- Reachability correctness: `just fuzz` (forward-built valid builds) and `just harvest-false-dims`
  (downward-closure false-dim finder; the `test.failing` guards in `web/test/` lock in the engine's
  known gaps - see BACKLOG "Reachability engine: current state and known gaps")
- Reachability correctness fixtures: regenerate with `just gen-reach-fixtures`
- Reachability heavy validation (minutes, before big engine changes): `just validate-reach`
- Headless browser smoke: `just e2e` (run `just install-e2e` once first)
- Pre-commit hook (opt-in, runs `just check`): `just install-hooks`
- Tool/data check: `just doctor`

## Architecture
Each page is a parser-to-dataset half plus a browser-rendered half, sharing
common infrastructure. (1) The parsers (`scripts/parse_devotions.py`,
`scripts/parse_rr.py`, `scripts/parse_monsters.py`) read extracted game records
into `data/devotions.json`, `data/resistance-reduction.json`, and
`data/monsters.json`; extraction itself (`just extract`/`parse`/`parse-rr`/
`parse-monsters`) is Windows-only (Crate's ArchiveTool.exe), but every dataset
is committed so the pages build anywhere. (2) Each page (`web/src/`, `web/src/rr/`,
`web/src/monsters/`) is hexagonal: `core/` is pure domain logic, `ports/` defines
interfaces, `adapters/` do I/O and rendering, and `app/main.ts` wires them. The
planner and RR share `web/src/core/hashCodec.ts` for multi-select facet encoding;
all three share `web/src/adapters/localizationAdapter.ts` and `web/src/adapters/appMenu.ts`
for the header chrome and i18n. Reachability (which constellations are still
completable under the current selection + point budget, planner-only) runs in a
Rust core compiled to `data/reach.wasm`, with a TS fallback in
`web/src/core/reachability.ts`; a precomputed `data/cover-table.bin` accelerates
dimming. Every page's full view state lives in its own URL hash
(`core/urlState.ts` under each page's tree) so links are shareable.

## Key paths
- `scripts/parse_devotions.py` / `parse_rr.py` / `parse_monsters.py` -- parsers:
  game `.dbr` records to `devotions.json` / `resistance-reduction.json` / `monsters.json`
- `data/devotions.json`, `data/resistance-reduction.json`, `data/monsters.json`
  -- committed datasets, each page's source of truth
- `web/src/app/main.ts` -- planner entry point and wiring
- `web/src/core/` -- pure planner logic: model, rules, reachability, aggregate, affinity
- `web/src/core/urlState.ts` -- encode/decode the planner's shareable URL-hash state
- `web/src/adapters/` -- SVG render, sidebar, tooltip, HTTP, WASM resolver, and the
  shared localization/app-menu adapters every page uses
- `web/src/rr/` -- resistance-reduction page (hexagonal: `core/`, `adapters/`, `app/main.ts`)
- `web/src/monsters/` -- monster resistance explorer page (same hexagonal shape)
- `web/wasm/` -- Rust reachability core, built to `data/reach.wasm`
- `web/scripts/` -- bundler, cover-table builder, perf harness, correctness fuzzer
- `web/e2e/smoke.ts`, `web/e2e/rr-smoke.ts`, `web/e2e/mon-smoke.ts` -- headless-Chromium
  smoke tests (one per page), driven over CDP and run together by `just e2e`

## How to run
`just serve`, then open:
- Planner: http://localhost:5173/
- Resistance reduction: http://localhost:5173/resistance-reduction/
- Monster resistances: http://localhost:5173/monster-resistances/

The deployed site is at https://tednaleid.github.io/grimdawn-devotions/ (GitHub
Pages, auto-deployed from `main`).

## Dig deeper
- `README.md` -- project overview, `devotions.json` schema, extraction steps
- `docs/dbr-format.md` -- reverse-engineered game data model
- `docs/devotion-system.md` -- the devotion rules + non-obvious construction consequences (read first)
- `docs/reachability-performance.md` -- reachability resolver perf findings
- `docs/reachability-engine.md` -- shipped vs costed engine comparison + the current-state decision
- `docs/superpowers/specs/` -- design specs for the planner, RR, and monster explorer pages
- `BACKLOG.md` -- planned enhancements with implementation pointers
