# Onboarding

A fan-made toolkit for Grim Dawn's Devotion constellation system: a Python parser
turns the game's own `.dbr` records into a clean committed dataset
(`data/devotions.json`), and a static, in-browser planner renders the devotion
starmap and lets you plan builds against that data. Deployed to GitHub Pages; no
backend, no accounts.

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
- Raw game-data deposit (full records tree + labels as parquet): `just deposit`, then
  `just census` / `just q "SQL"` to mine it - see `docs/deposit.md`
- Derived typed item schema (entities/stats/relations parquet): `just derive`, then
  `just q-ae-all` for the acceptance queries - see `docs/item-schema.md`
- Dataset releases (parquet lives in GitHub Releases, pinned by `deposit.lock`):
  `just fetch-deposit` pulls it on any machine; `just publish-deposit` (Windows)
  releases a new build - see `docs/deposit.md`

## Architecture
Two halves. (1) The parser (`scripts/parse_devotions.py`) reads extracted game
records into `data/devotions.json`; extraction itself (`just extract`/`parse`)
is Windows-only (Crate's ArchiveTool.exe), but the dataset is committed so the
planner builds anywhere. (2) The planner (`web/`) is hexagonal: `core/` is pure
domain logic, `ports/` defines interfaces, `adapters/` do I/O and rendering, and
`app/main.ts` wires them. Reachability (which constellations are still completable
under the current selection + point budget) runs in a Rust core compiled to
`data/reach.wasm`, with a TS fallback in `core/reachability.ts`; a precomputed
`data/cover-table.bin` accelerates dimming. All planner state lives in the URL
hash (`core/urlState.ts`) so links are shareable.

## Key paths
- `scripts/parse_devotions.py` -- parser: game `.dbr` records to `devotions.json`
- `data/devotions.json` -- committed dataset, the planner's source of truth
- `web/src/app/main.ts` -- planner entry point and wiring
- `web/src/core/` -- pure logic: model, rules, reachability, aggregate, affinity
- `web/src/core/urlState.ts` -- encode/decode the shareable URL-hash state
- `web/src/adapters/` -- SVG render, sidebar, tooltip, HTTP, WASM resolver
- `web/wasm/` -- Rust reachability core, built to `data/reach.wasm`
- `web/scripts/` -- cover-table builder, perf harness, correctness fuzzer
- `web/e2e/smoke.ts` -- headless-Chromium smoke test driven over CDP

## How to run
`just serve`, then open http://localhost:5173. The deployed site is at
https://tednaleid.github.io/grimdawn-devotions/ (GitHub Pages, auto-deployed from
`main`).

## Dig deeper
- `README.md` -- project overview, `devotions.json` schema, extraction steps
- `docs/dbr-format.md` -- reverse-engineered game data model
- `docs/deposit.md` -- raw game-data deposit: schema, recipes, refresh flow
- `docs/item-schema.md` -- derived typed item schema: tables, curated inputs, known gaps
- `docs/devotion-system.md` -- the devotion rules + non-obvious construction consequences (read first)
- `docs/reachability-performance.md` -- reachability resolver perf findings
- `docs/reachability-engine.md` -- shipped vs costed engine comparison + the current-state decision
- `docs/superpowers/specs/` -- planner and path-predictor design specs
- `BACKLOG.md` -- planned enhancements with implementation pointers
