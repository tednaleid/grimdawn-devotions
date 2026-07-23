# Game version migration workflow (Fangs of Asterkarn / 1.3.0.0)

Date: 2026-07-23

## Goal

Regenerate every committed game dataset against Grim Dawn 1.3.0.0 (the Fangs of
Asterkarn expansion, Steam build 24346246), confirm nothing structurally broke,
surface the tuning changes for review, and deploy. Along the way, harden the
pipeline so the next version bump is a near-one-command operation, because more
minor releases are expected as the developer settles the new expansion.

## Background: the current pipeline

Extraction is Windows-only (Crate's `ArchiveTool.exe`) and drives a set of `just`
recipes:

- `just extract` unpacks every `*.arz` database plus `Text_EN.arc` from the base
  game and each expansion. Expansions are discovered by the `gdx*` glob and
  overlaid in load order, so Fangs of Asterkarn (installed as `gdx3`) is picked
  up with no recipe change.
- `just parse` runs `scripts/parse_devotions.py` into `data/devotions.json`.
- `just parse-rr` runs `scripts/parse_rr.py` into `data/resistance-reduction.json`.
- `just i18n-tables` runs `scripts/build_game_tables.py` into
  `data/i18n/game.<lang>.json` for every installed language.
- `just assets` runs `scripts/build_assets.py`, extracting devotion artwork into
  `assets/devotions/*.webp` plus a manifest. The art is committed (155 files); the
  GitHub Pages Action deploys the committed copies and cannot regenerate them (no
  game in CI).
- `just all` chains `extract parse parse-rr i18n-tables`.
- `just build` runs `cover-table`, bundles both pages, and copies data + assets
  into `web/dist`.

The human-readable game version is the only genuinely manual input. It lives as a
hardcoded default: `gd_version := env_var_or_default("GD_VERSION", "1.2.1.x")`.
The Steam build id is read automatically from `appmanifest_219990.acf` and, with
the version, is written into each dataset's `meta` (`gameVersion`, `steamBuildid`).
Both hamburger About panels read `meta.gameVersion`, so once the version is set and
data regenerated, both pages update on their own.

Deployment is a GitHub Action (`.github/workflows/deploy.yml`) that runs
`just wasm` + `just build` on push to `main`. The `?v=<assetVersion>` cache-bust
shipped on 2026-07-23 means returning visitors fetch the new data immediately, so
no stale-catalog window remains.

## Design

Four build deliverables plus the migration run.

### 1. Steam buildid to human version mapping

Replace the hardcoded `gd_version` default with a committed lookup table,
`data/steam-build-versions.json`:

```json
{
  "19149150": "1.2.1.x",
  "24346246": "1.3.0.0"
}
```

Version resolution runs in one place: a private `_game-version` helper recipe
(bash plus `jq`, already a declared dependency) that emits the resolved buildid
and version. `parse` and `parse-rr` both consume it via command substitution and
pass `--steam-buildid` and `--game-version` to the (unchanged) Python scripts.
This removes the buildid read currently duplicated across those two recipes.

Resolution steps inside `_game-version`:

1. Read the Steam buildid from `appmanifest_219990.acf` (existing behavior).
2. If `GD_VERSION` is set and non-empty, use it (an override that also bootstraps
   a brand-new build before its mapping is added).
3. Otherwise look the buildid up in `data/steam-build-versions.json` with `jq`.
4. If found, use the mapped version.
5. If not found and no `GD_VERSION` override, fail loudly:
   `Unknown Steam buildid <id>: add it to data/steam-build-versions.json (GrimTools
   shows the version), or pass GD_VERSION=...`.

This removes the silent-stale-default risk (a build could otherwise ship last
release's version label) and removes the re-typing (a known build resolves
automatically). The convention for the version string matches GrimTools' four
segments (`1.3.0.0`, not `1.3.0.x`).

Grim Dawn exposes no plain version file we could read instead; the appmanifest
carries only the buildid, so the mapping is the deliberate source of truth.

### 2. `just diff-data`: semantic diff and verification gate

A committed script (`scripts/diff_data.py`, uv/stdlib) compares the regenerated
working-tree data against the git-committed baseline
(`git show HEAD:data/devotions.json`, `git show HEAD:data/resistance-reduction.json`).
It runs after regeneration and before commit.

Structural assertions apply to the devotions dataset only, which the developer
confirmed is stable (no new/removed constellations, no point-count change). Any
of these differing from the committed baseline is reported as an ERROR and makes
the tool exit non-zero, so `just migrate` halts on a silent parser break or an
unexpected content change:

- Same set of constellation ids and names.
- Same star count per constellation and overall.
- Same total devotion point cap and same affinity types.

The RR dataset has no hard structural gate: Fangs adds items, skills, and set
bonuses, so new RR sources are expected and must not fail the migration. Removed
RR sources are surfaced as a warning to review (they can be a legitimate removal
or a parser regression) but do not fail the gate.

Change report (informational, exit zero):

- Devotion tuning: per constellation/star, list changed granted stats and values
  (old to new).
- RR sources: count and list new sources, removed sources (warned), and value
  changes on existing sources.
- Meta: note the version and buildid change (expected).

Output is grouped and human-readable, e.g. `STRUCTURE: stable ...`,
`DEVOTION TUNING CHANGES (N): ...`, `RR SOURCES: +N new, -M removed, K changed`.
When a dataset is unchanged, it says so rather than printing an empty section.

### 3. `just migrate`: orchestrator up to the review gate

One recipe chains the mechanical path and stops before commit:

1. Resolve the version (deliverable 1); fail on an unknown buildid.
2. `just extract`
3. `just parse`
4. `just parse-rr`
5. `just i18n-tables`
6. `just assets`
7. `just build` (includes `cover-table`)
8. `just diff-data` (prints the report; fails on a structural break)
9. `just check`

It then prints a reminder: review the report above, run `just e2e`, then
`git commit` and `git push` to deploy. No auto-commit and no auto-deploy: the
human reviews the tuning diff and confirms the app is green before shipping. If
any step fails (structural assertion, `just check`), `migrate` fails and the run
stops for a fix.

`assets` is included every bump: the art is committed and deployed, so skipping it
risks shipping stale textures, and re-running is a safe no-op when nothing changed
(same input plus fixed WebP quality yields byte-identical output). The first run
confirms the re-encode is deterministic (an unchanged texture produces no git
diff); if it proves noisy, revisit whether to keep `assets` in the chain.

### 4. Run the 1.3.0.0 migration

Execute the new tooling end to end:

- Run `just migrate` (buildid 24346246 resolves to 1.3.0.0 via the seeded map).
- Triage what the parsers and `diff-data` surface: accept expected tuning changes;
  fix any parser break the new records expose (new or changed `.dbr` fields from
  Fangs). Automate or document any additional rough edge found.
- Confirm `just check` (currently 505 tests) and `just e2e` (both suites) are
  green.
- Hand the `diff-data` report over for review, then commit the regenerated data
  and push so the Action deploys.

### 5. Fix the stale `build_assets.py` docstring

`scripts/build_assets.py` line 9 states "Output dir is git-ignored," which is the
opposite of the truth: the art is committed for the Pages build. Correct it to say
the output (`assets/devotions`) is committed and regenerated with `just assets`.
Left stale, that comment invites a future migration to skip artwork and ship a
stale texture.

## What the app already absorbs

No app-code change is needed to take on Fangs content: `gdx3` is auto-discovered;
new RR sources, mastery skills, and game-text tags flow through the existing
parsers and `i18n-tables`; both hamburger menus update from `meta.gameVersion`;
and the `?v=` cache-bust delivers the new data to returning visitors immediately.

## Verification and gates

The migration is done when all of these pass and the change report shows only
expected changes:

- `just diff-data` structural assertions pass (no constellation/star/affinity or
  point-cap change).
- `just check` passes.
- `just e2e` passes (planner and RR suites).
- The tuning diff report has been reviewed and the changes are expected for a
  balance patch.

## Non-goals

- No Fangs-specific features or new devotion modeling (the developer confirmed no
  new constellations and no point-count change).
- No attempt to auto-detect the version from game internals; the buildid mapping
  is the chosen source of truth.
- No change to the app data model or schema unless a parser break forces it.
- Extraction stays Windows-only; nothing here targets other platforms.

## Rough edges captured (fix or automate here)

- Hardcoded `gd_version` default replaced by the buildid mapping (deliverable 1).
- Buildid read duplicated across `parse` and `parse-rr`, factored into the shared
  resolution step (deliverable 1).
- No orchestrator for a bump: `just migrate` (deliverable 3).
- No data verification or diff: `just diff-data` (deliverable 2).
- Stale `build_assets.py` docstring corrected (deliverable 5).
- Any parser fragility the 1.3.0.0 records expose is fixed during the run
  (deliverable 4) and, if it is a recurring rough edge, automated.
