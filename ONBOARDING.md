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
GitHub Pages, plus one small Cloudflare Worker (`worker/`) whose only job is to
fetch a grimtools build past its CORS header, and save one, for the devotion
planner's import and export.

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
- Python script suites (also CI, after `just fetch-deposit`): `just test-scripts`. The legs that
  read `extracted/` skip loudly anywhere the game is not installed, so run this on a machine with
  the game before changing a parser.
- Reachability WASM core (optional fast path): `just wasm`
- Per-click engine perf: `just perf` (times `selectionView`, the exact cost one UI click pays = the core
  to optimize; deployed WASM path) or `just perf --ts` (the pure TS core algorithm you iterate on)
- Reachability correctness: `just fuzz` (forward-built valid builds) and `just harvest-false-dims`
  (downward-closure false-dim finder); the engine's known limits are in docs/reachability-engine.md
- Reachability correctness fixtures: regenerate with `just gen-reach-fixtures`
- Reachability heavy validation (minutes, before big engine changes): `just validate-reach`
- Headless browser smoke: `just e2e` (run `just install-e2e` once first)
- Grimtools import/export worker, local dev (no Cloudflare account needed): `just worker-dev`
- Grimtools import/export worker, first-time/manual deploy (normal deploys are from CI): `just deploy-worker`
- Grimtools import/export worker, one-time Cloudflare token setup/rotation: `just setup-worker-auth`
- Regenerate `data/grimtools-stars.json` (needs headless Chrome: `just install-e2e`): `just gt-star-table`
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
- `web/src/core/search.ts` -- pure text-search corpus and matcher over the devotion map
- `web/src/core/urlState.ts` -- encode/decode the planner's shareable URL-hash state
- `web/src/adapters/` -- SVG render, sidebar, tooltip, HTTP, WASM resolver, and the
  shared localization/app-menu adapters every page uses
- `web/src/rr/` -- resistance-reduction page (hexagonal: `core/`, `adapters/`, `app/main.ts`)
- `web/src/monsters/` -- monster resistance explorer page (same hexagonal shape)
- `web/wasm/` -- Rust reachability core, built to `data/reach.wasm`
- `web/scripts/` -- bundler, cover-table builder, perf harness, correctness fuzzer
- `web/e2e/smoke.ts`, `web/e2e/rr-smoke.ts`, `web/e2e/mon-smoke.ts` -- headless-Chromium
  smoke tests (one per page), driven over CDP and run together by `just e2e`
- `worker/` -- Cloudflare Worker that fetches a grimtools build server-side (CORS blocks
  reading it from the browser) for the devotion planner's import and export features; see
  `worker/README.md`

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
- `docs/deposit.md` -- raw game-data deposit: schema, recipes, refresh flow
- `docs/item-schema.md` -- derived typed item schema: tables, curated inputs, known gaps
- `docs/item-cli.md` -- the item query CLI: flags, name resolution, tier semantics
- `docs/grimtools-build-audit.md` -- reading a shared grimtools build and auditing it against our data
- `docs/grimtools-import.md` -- importing a build's devotions: the three pieces, the mapping table's gates, why a worker exists
- `worker/README.md` -- the grimtools import worker: contract, local dev, deployment, one-time Cloudflare setup
- `docs/devotion-system.md` -- the devotion rules + non-obvious construction consequences (read first)
- `docs/reachability-performance.md` -- reachability resolver perf findings
- `docs/reachability-engine.md` -- shipped vs costed engine comparison + the current-state decision
- `docs/superpowers/specs/` -- design specs for the planner, RR, and monster explorer pages
- `BACKLOG.md` -- planned enhancements with implementation pointers
