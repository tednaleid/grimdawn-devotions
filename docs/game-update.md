# Updating to a new game release

The runbook for regenerating every committed dataset after a Grim Dawn patch. Run
it on the Windows machine with the game installed and fully closed (an open game
locks its `.arc` archives and extraction silently writes nothing).

Two recipes do the mechanical work; the review steps between and after them are
deliberately manual.

- `just migrate` - regenerate everything from the local install and verify it.
  Stops before committing.
- `just migrate-grimtools` - regenerate the tables that join our data to
  grimtools.com. Needs network access and a grimtools that has already updated
  to the new patch, which often lags the release.

## 1. Pin the version

Steam's buildid is in `steamapps/appmanifest_219990.acf`. Add it to
`data/steam-build-versions.json` with the four-segment version grimtools shows
(for example `"25813250": "1.3.1.1"`). Every parser stamps that version into its
output, and `_game-version` fails on an unknown buildid so a patch cannot ship
under the previous label.

## 2. `just migrate`

Runs, in order:

| Step | Produces | Notes |
|---|---|---|
| `extract` | `extracted/records`, `extracted/text_en` | Destructive re-extract of base game + every `gdx*` expansion |
| `i18n-tables` | `extracted/text_<lang>` | Extracts every other language's text. The tables it also writes are rebuilt below |
| `parse`, `parse-rr`, `parse-monsters` | `data/devotions.json`, `resistance-reduction.json`, `monsters.json` | |
| `assets`, `skill-icons` | `assets/devotions/`, `data/skill-icons.*` | `assets` re-encodes only textures whose bytes or encoder settings changed (`assets/devotions/source-hashes.json`); a full re-encode takes about 8 minutes |
| `deposit`, `derive` | `data/deposit/`, `data/derived/` (parquet, never in git) | `derive` fails on curation drift by design, see below |
| `skill-items`, `stat-item-tags` | `data/skill-items*.json`, `data/stat-item-tags.json` | `stat-item-tags` fails on a stat id it cannot name, see below |
| `i18n-tables-rebuild` | `data/i18n/game.<lang>.json` | Must follow `skill-items` and `stat-item-tags`: the tables include their tags, so building them earlier leaves anything the patch added as a raw tag in every language |
| `build` | `web/dist` | |
| `diff-data` | report | Fails only on a devotion structural break |
| `check`, `test-scripts`, `monster-parity`, `q-ae-all` | | Count pins move on a content patch, see below |

When a step fails, fix the cause and run the remaining steps by name rather than
starting over; every step reads only what the earlier ones wrote.

### Expected failures on a content patch

- **`derive` curation drift.** A new item category, `Class` value, or faction
  stops the build. Classify each one in `data/item-curation/` from the records
  themselves (`docs/item-schema.md`).
- **`stat-item-tags` unresolved stat.** A new stat id with no derivable tag.
  See "Deriving a stat's game tag" in `docs/i18n.md`.
- **Moved count pins** in `test-scripts` and `q-ae-all`. A moved count is the
  patch; a failed structural check or transcribed oracle is a bug. Repin only
  after diffing the old and new data to explain the change, and record that
  explanation in the commit message.
- **URL wire-format pin** (`web/test/urlState.test.ts`, in `check`). A patch that
  adds a benefit stat (a new pet bonus, a new power debuff) produces a benefit id
  the published order does not have. Append the new ids, in the order the test
  reports, to the end of `data/url-wire-ids.json`; never insert or reorder, since
  each id's index is its bit in every shared link. Retired ids need nothing: they
  keep their bit and decode as absent.
- **`diff-data` structural break.** A constellation or star added, removed, or
  rewired. That changes the planner's model: read `docs/devotion-system.md`,
  run `just gen-reach-fixtures`, and run the regression gates at the end of
  `docs/reachability-engine.md` before going further.

## 3. Review the diff

Read the `diff-data` report against the patch notes. Every devotion the notes
mention should appear in it, and nothing else should, unless the notes are
incomplete (check the record before assuming either way). Then look at the page
in `just serve` or run `just e2e`.

## 4. `just migrate-grimtools`

Once grimtools shows the new version:

- `gt-star-table` - `data/grimtools-stars.json`, the star-id join behind the
  planner's grimtools import and export. Its count asserts fail when either
  side's star list moved.
- `gt-monster-links` - `data/grimtools-monsters.json`, keyed on monster row ids,
  so it goes stale whenever `monsters.json` regroups rows.

The monster parity fixture (`scripts/fixtures/gt-monster-resistances.json`) is
grimtools' displayed values and is the oracle for `monster-parity`. Refresh it by
hand with `bun scripts/gt_monster_harvest.mjs` once grimtools shows the new
version, then re-run `just monster-parity`; see `docs/monster-resistances.md`.

If grimtools has not updated yet, ship without this step and come back to it: the
old tables keep working for everything the patch did not change.

## 5. Publish and commit

1. `just publish-deposit` - uploads the new parquet as a GitHub Release and
   rewrites `deposit.lock`. Re-runs `derive` and `q-ae-all` as gates.
2. Commit the regenerated data, `deposit.lock`, and the version map together, so
   later work diffs against current game data rather than a mix of patch drift
   and its own changes.
3. Push to deploy. Other machines pick up the new data with `git pull` and
   `just fetch-deposit`.
