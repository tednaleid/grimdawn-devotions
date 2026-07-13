# Raw game-data deposit

The deposit is a lossless, language-free, queryable extraction of the entire
`records/` tree plus per-locale label tables, stored as parquet under
`data/deposit/` (never committed; see "Home: GitHub Releases" below). It exists
so schema exploration, the item-database work, and any future mining run
anywhere with DuckDB - only archive extraction itself needs Windows and the
game install.

## Artifacts

Built by `just deposit` (`scripts/build_deposit.py`), all stamped with the
Steam build id from the same run:

| file | shape | contents |
|---|---|---|
| `facts.parquet` | `(record, idx, key, value, value_num)` | one row per `key,value` line of every `.dbr` file, in file order. `record` is the forward-slash path relative to the extracted root (`records/...`), matching the form `.dbr` reference values use. Duplicate keys within a record are preserved as separate rows; `idx` orders them. `value` is the raw text; `value_num` is a best-effort DOUBLE (NULL when non-numeric) so range queries work without a typing pass. Multi-value cells stay `;`-packed in `value`; exploding them is downstream SQL. |
| `labels.parquet` | `(locale, tag, text, source)` | the full tag table of every extracted language (13 currently), unfiltered, with Grim Dawn formatting codes stripped. Localized display is a join; active-locale-then-English fallback is `COALESCE(loc.text, en.text)`. `source` is the stem of the earliest tag file defining the tag (schema v2): `tags_items` = base game, `tagsgdx1_items` = Ashes of Malmouth, `tagsgdx2_items` = Forgotten Gods - the expansion-attribution signal for the derived item schema. Text keeps last-wins semantics across files (expansion text overrides base). |
| `meta.parquet` | `(key, value)` | provenance: steam build id, game version, generation timestamp, file/row counts, locale coverage (built / missing / stale / skipped). |

Not represented: `.tpl` template inheritance. The deposit carries raw `.dbr`
content only, so template-inherited defaults are absent. The census's
template-usage tables keep the gap visible; resolving inheritance is future
work (see BACKLOG "Item-database follow-ups").

Known label quirk: non-English text can carry Grim Dawn grammar annotations
(for example a leading `[fs]` gender marker in German item names). They are
part of the game's own localization data and are kept as-is; stripping them
is a display concern for whatever consumes the labels.

## Recipes

Everything runs through `just`; no artifact exists that a recipe cannot
regenerate, and no inspection requires leaving the terminal.

- `just deposit` - regenerate facts/labels/meta from the extracted tree
- `just census` - schema census: per-category key stats, canonical-key
  coverage, template usage, dangling-reference and zero-row diagnostics.
  Writes `census.md` plus uncapped `census_keys.csv` / `census_templates.csv`
  next to the deposit.
- `just q "SELECT ..."` - ad-hoc SQL; the views `facts`, `labels`, and `meta`
  are pre-registered
- `just q-cold-components` / `just q-compound-facets` / `just q-search-de` -
  named acceptance queries proving the target filter model (OR within a facet
  group, AND across groups, numeric ranges, ANDed text search, localized
  labels with English fallback). They print row counts and exit non-zero on
  zero rows: an empty result is ambiguous between "correctly nothing" and
  "broken join", so it is treated as failure.
- `just publish-deposit` - upload the deposit + derived parquet as an
  immutable GitHub Release and write `deposit.lock` (Windows box; gated on
  `just derive` and all nine acceptance queries passing fresh; add
  `--dry-run` to print the would-be lockfile with no side effects)
- `just fetch-deposit` - download exactly what `deposit.lock` pins into
  `data/deposit/` + `data/derived/`, verifying every checksum (any machine;
  needs no `gh`, no auth, no game install; idempotent)
- `just clean-deposit` - delete the deposit. Deliberately separate from
  `just clean`, which never touches it (regeneration needs Windows + the
  game install).

Raw `.dbr` stat ids (`offensiveLightningMin`, `levelRequirement`, ...) are the
deposit's schema by design; queries name them as literals. Mapping them to
display labels is deferred stat-label work.

## Refresh flow after a game patch

Windows box, game fully closed:

1. `just extract` - records + English text (destructive re-extract)
2. `just i18n-tables` - every other installed language's text
3. `just deposit` - rebuild the deposit (captures the new Steam build id)
4. `just publish-deposit` - release the new build's parquet and commit the
   updated `deposit.lock`

Skipping step 2 leaves the non-English label tables stale; `just deposit`
warns when any `extracted/text_*` directory is older than the extracted
records, and warns about repo-known locales with no extracted text at all.

Every other machine picks up the new build with `git pull` and
`just fetch-deposit` - no game install, no derive step.

## Home: GitHub Releases, never git

Measured at build 19149150 (game 1.2.1.x, 2026-07-03): `facts.parquet`
12.1 MB (18,971,672 rows covering all 61,530 records), `labels.parquet`
5.7 MB (229,584 tags across 13 locales), `meta.parquet` 1 KB - about 18 MB
total. The 818 MB raw tree compresses roughly 45:1; parquet dictionary
encoding thrives on DBR key/value repetition.

Generated parquet never enters git at any stability level: parquet does not
delta-diff, so every format iteration would bake a full ~18 MB blob into
history. Instead, `just publish-deposit` uploads the three deposit files plus
the five derived files (`docs/item-schema.md`) as assets of an immutable
GitHub Release tagged `deposit-<steam buildid>.<rev>` - a format change
between game patches re-publishes the same buildid under the next `<rev>`,
and existing releases are never modified or deleted. Git commits only
`deposit.lock`, a ~1 KB JSON manifest at the repo root pinning one exact tag
with a sha256 per asset; `just fetch-deposit` downloads and verifies exactly
what it pins. The census CSV byproducts next to the deposit are not released.

These releases are internal build artifacts for this repo's own tooling, not
a public dataset: no stability promise, no consumer documentation. The
machinery lives in `scripts/dataset_release.py` (`lock`/`publish`/`fetch`).
