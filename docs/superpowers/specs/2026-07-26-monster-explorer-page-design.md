# Monster resistance explorer page: design

Status: implemented 2026-07-26
Date: 2026-07-26
Game version at design: 1.3.0.0 (Fangs of Asterkarn)

Second sub-project of the monster data initiative. The first
([2026-07-24-monster-resistance-pipeline-design.md](2026-07-24-monster-resistance-pipeline-design.md),
corrected by [2026-07-25-monster-passive-resistances-design.md](2026-07-25-monster-passive-resistances-design.md))
produced `data/monsters.json`. Nothing renders it. This page does.

## Goal

Ship `/monster-resistances` alongside the planner and the resistance-reduction
page, answering one question directly: which damage types do enemies resist
least, and which enemies break the pattern.

## What the data says, and why it shapes the page

Measured at Ultimate, one player, over the 1,635 rows that remain after the trap
exclusion below:

| Rank | By mean | | By median | |
| --- | --- | --- | --- | --- |
| 1 | physical | 11.5 | physical | 2 |
| 2 | chaos | 12.4 | chaos | 5 |
| 3 | aether | 13.7 | aether | 5 |
| 4 | cold | 16.1 | cold | 5 |
| 5 | fire | 16.9 | pierce | 5 |
| 6 | pierce | 17.1 | fire | 8 |
| 7 | bleeding | 19.1 | bleeding | 9 |
| 8 | poison | 20.0 | poison | 10 |
| 9 | lightning | 20.1 | lightning | 10 |
| 10 | vitality | 25.6 | vitality | 12 |

Two findings drove the design:

**The two statistics agree.** Mean and median produce nearly the same ordering,
so the choice between them is not the fork it appeared to be. The page leads
with the mean and shows the median beside it.

**The ranking is nearly invariant under filtering.** Restricting to
Hero/Boss/SuperBoss/Quest (946 of 1,635 rows) barely moves it. The one real
swing is pierce, which goes from fifth-weakest by median overall to the most
resisted of all ten types among heroes and bosses.

Because the headline ordering barely moves, the page's value is not the ordering
itself but the **shape** of each type's distribution: where the resistant
minority sits, and which enemies form it. That is why the ranking stays the
centerpiece and carries an inline histogram per type, rather than being reduced
to a summary strip above a lookup table.

An earlier concern that bleeding would dominate the ranking proved wrong. It
places seventh by both statistics: the Ultimate offset lifts every base-zero
monster, and the 245 rows carrying bleeding resistance are too few to pull the
mean down.

## Prerequisite: exclude traps from the dataset

Two rows are traps rather than monsters, and both distort aggregates:
`enemies.trap_mineexplosive_a01` (500 in nine of ten types, classification
`Common`) and `enemies.trap_chthonicshard_zap_a01_summon` (a +500 vitality
passive).

`scripts/parse_monsters.py` gains a `trap` exclusion reason, joining the existing
reason-reported rules. It matches on the **`trap_` filename prefix**, never on a
substring. A substring rule would also match five genuine monsters that merely
have "trap" in the name: three Ugdenbog ghosts, `chthonianfiend_trappedandalone_01`,
and `chthonianservitor_mourndaletrap`. This is the same failure mode that nearly
deleted Karroz during the passive-resistance work, where a substring rule on
"summon" matched `cultist_summoner_01`.

The dataset drops from **1,637 to 1,635** logical monsters. Row-count assertions
in `scripts/test_parse_monsters.py` and the `just diff-data` expectation move with
it. This lands before any page work.

`enemies.special.beaver_01x`, a SuperBoss with 100 resistance in all ten types,
**stays**. It is a real enemy a player can fight. One row in 1,635 barely moves a
mean, and excluding real content for being inconvenient is a precedent this
dataset should not set.

## Architecture

Mirrors the resistance-reduction page, which is the pattern this codebase has
already proven. Page-specific code lives under `web/src/monsters/`; shared chrome
(localization, app menu, language picker) is imported from `web/src/core/` and
`web/src/adapters/` exactly as `web/src/rr/` does.

Core stays pure and locale-independent: it computes over numbers and returns
`Text` descriptors. Adapters render and resolve text through the `Localization`
port. The entry point owns the render loop and the URL round-trip.

### Files

| File | Responsibility |
| --- | --- |
| `web/monster-resistances.html` | Shell and boot-fail recovery, modelled on `resistance-reduction.html` |
| `web/src/core/hashCodec.ts` | `putSet`/`readSet`, lifted from `rr/core/urlState.ts`; RR imports it |
| `web/src/monsters/core/facets.ts` | Tier, role and damage-type constants, and defaults |
| `web/src/monsters/core/model.ts` | `Monster`, `Stats`, difficulty-offset and aura application |
| `web/src/monsters/core/filter.ts` | `ViewState` to filtered rows |
| `web/src/monsters/core/stats.ts` | Mean, median, bucket counts, shared peak |
| `web/src/monsters/core/urlState.ts` | `ViewState`, `encodeHash`, `decodeHash` |
| `web/src/monsters/adapters/dataSource.ts` | Fetch and parse `monsters.json` |
| `web/src/monsters/adapters/rankView.ts` | Ranking rows with inline histograms |
| `web/src/monsters/adapters/tableView.ts` | Sortable table, heat cells, provenance markers |
| `web/src/monsters/app/main.ts` | Boot, render loop, hash round-trip, app menu |
| `web/src/monsters/monsters.css` | Page styles, scoped under `.monsters-page` |
| `web/test/monsters/*.test.ts` | Six suites mirroring `web/test/rr/` |
| `web/scripts/bundle.ts` | Third page block, modelled on the RR block |
| `justfile` | `serve` echo line and an `open-monsters` recipe |

### The one shared extraction

`putSet` and `readSet` in `rr/core/urlState.ts` move to
`web/src/core/hashCodec.ts` and RR is updated to import them. They are identical
in both pages and they encode the URL round-trip tolerance this project
maintains as an invariant, so a single definition is worth having.

Nothing else is extracted. RR's filter operates on string facets over sources
with a stacking ledger; this page filters numeric ranges over ten resistance
columns with histograms. One abstraction over both would distort both, and
refactoring a shipped page is not a prerequisite for new work.

## Page behaviour

Layout, top to bottom: shared header chrome, ranking, controls, table.

### Ranking

Ten rows, one per damage type, sorted by mean ascending so the weakest comes
first. Each row carries its distribution inline, roughly 4rem tall, with counts
above each bar and a bucket-label header above the list. `Mean` and `Median` are
labelled columns on the right; leaving them unlabelled was confusing in the
prototype.

All ten histograms share **one vertical scale**. Normalising each row to its own
peak would make shapes incomparable across types, which is the whole point of
showing them together.

Buckets, computed on the **effective** value: `<0`, `0`, ten-wide `1-9` through
`90-99`, then `100+`. Thirteen in total. The `0` bucket reads empty on Elite and
Ultimate, because a nonzero offset lifts every base-zero monster out of it, and
populates on Normal where several offsets are zero. This is accepted rather than
special-cased: the page reports effective resistance, and that is what the
buckets describe.

The `<0` bucket is meaningful and must not be folded into `0`: those monsters
take extra damage from that type.

### Controls

Every control drives both the ranking and the table.

- **Difficulty**: Normal, Elite, Ultimate. Default Ultimate.
- **Players**: 1 to 4. Default 1.
- Together these select the offset: `effective = base + offset[difficulty][players]`.
- **Tier**: the six classifications, multi-select, empty means all.
- **Role**: multi-select, empty means all.
- **Search**: case-insensitive substring match on the resolved monster name, so
  it works against the name the user sees in their own locale.
- **Min level**: threshold on `max_level`.
- **Hide summons**: excludes rows flagged `is_summon`.
- **Include auras**: see below.

### The aura toggle

Off by default: `resistances` is used as shipped, with resident passives folded
in and aura grants excluded.

On: `aura_resistances` is added to the total. This moves table cells, means,
medians, and can reorder the ranking. It is a second genuine view of the data,
not a display flourish, so it round-trips through the URL like every other
control.

This is what makes the 140 rows carrying aura grants useful rather than inert.
The pessimistic reading ("assume every toggled aura is active") becomes a
first-class answer the page can give.

### Provenance markers

In the table, a filled dot marks a cell whose value includes a resident passive
grant; a hollow ring marks a cell for which an aura grant exists. 403 rows carry
a passive grant, 140 an aura.

The ring's meaning depends on the aura toggle: with it off, the ring means "an
aura exists and is **not** in this number"; with it on, "an aura exists and **is**
in this number". Its tooltip text is therefore toggle-dependent. Getting this
wrong would misreport the number the user is looking at.

`variants_disagree` rows keep a warning marker, as in the prototype.

### Table

Every matching row renders; there is no cap. 1,635 rows proved fast in the
prototype. Any column sorts. Cells are heat-shaded in their damage type's hue.

The default sort is by name ascending, so an unfiltered page opens on a stable
alphabetical reference rather than on whichever type happens to sort first.
Clicking a resistance column sorts it descending first, since "who resists this
most" is the question worth asking of a resistance column.

### Degenerate states

When a filter matches nothing, mean and median are undefined. The ranking shows
an honest empty state rather than `NaN`, a zero-filled chart, or a silently
dropped section. This follows the same discipline as the build-order panel, which
withholds an order it cannot prove legal.

## Look and feel

The page must read as a sibling of the existing pages, not as a visitor.

The shared palette, taken from `web/src/styles.css` and mirrored by
`web/src/rr/rr.css`, is a cool dark ground with a gold accent: background
`#0d1117`, panel `#161b22`, rule `#30363d`, ink `#e6edf3`, muted `#9aa4b2`,
ember `#f0c14b`. Typography is `system-ui` at 14px/1.45 with `ui-monospace` for
figures. The app is dark-only; there is no theme switch.

`monsters.css` scopes under `.monsters-page` and declares `--mon-*` tokens
mirroring that palette, exactly as `rr.css` declares `--rr-*`. The ten
damage-type hues are this page's own semantics, in the same way RR declares three
hues for stack, multiplicative and flat. They are chosen against the cool `#0d1117`
ground, with `-dim` background variants in RR's idiom for the heat cells.

The throwaway prototype used a warm near-black ground, a brass accent, a serif
display face, and a light/dark theme system. None of that carries over. Its
structure, interactions and computed logic do.

## URL state

Every control round-trips through the hash, per the project invariant. Keys:
`diff`, `players`, `tier`, `role`, `q`, `minlv`, `summons`, `auras`, and
`sort=key:dir`.

Values at their default are omitted, so a shared link stays short. Unlike RR's
`source` facet, tier and role both default to empty, so there is no "cleared to
show all" state distinct from "absent": the key is simply omitted whenever the
set is empty, and an absent key decodes to that same empty default.

Decoding tolerates malformed input: unknown keys are ignored, undecodable tokens
are dropped individually rather than discarding the whole list, and out-of-range
or unparseable values fall back to their default. A stale link never throws.

## Internationalization

No user-facing literal appears in app code. Core modules return `Text`
descriptors; adapters resolve them through the `Localization` port.

Roughly 55 new `monsters.*` keys go into `web/src/i18n/app.en.json` and are added
to the `REQUIRED` list in `web/test/appCatalog.test.ts`.

The other twelve locales are initially left to the English fallback. The guard
enforces completeness only for English; for other locales it enforces no stray
keys and matching placeholder sets, both of which hold when a key is simply
absent. Translations can land later without breaking CI.

Monster names and damage-type names resolve from the extracted game tag tables,
never from the app catalogue. Selection state in the URL stays language
independent.

## Error handling

A failed fetch reuses RR's boot-fail recovery: one automatic reload attempt,
then a visible retry control.

A `monsters.json` that parses but lacks expected fields fails loudly at load
rather than rendering blank cells, so a pipeline regression surfaces as an error
instead of a page that quietly shows nothing.

## Testing

Six suites under `web/test/monsters/`, mirroring `web/test/rr/`:

- **stats**: mean, median, bucket edges including `<0` and `100+`, the shared
  peak across types, and the empty-set case returning an explicit no-data result
  rather than `NaN`.
- **filter**: each facet in isolation and in combination.
- **urlState**: round-trip for every field, defaults omitted, and tolerance of
  stale or malformed hashes.
- **model**: offset application across all three difficulties and all four player
  brackets, and the aura toggle changing totals.
- **rankView**: ordering by mean, histogram bucket counts, and the empty state.
- **tableView**: sort behaviour, provenance markers, and the toggle-dependent
  ring tooltip.

On the pipeline side, `scripts/test_parse_monsters.py` gains a test that the
`trap_` prefix excludes exactly the two traps and that the five monsters merely
named "trap" survive.

## Known limitations

- **The ranking is a population statistic, not build advice.** It reports what
  the 1,635 surveyed monsters resist, weighted equally. A player does not meet
  them equally often, so a type that is weak on average may still be resisted by
  the specific bosses that matter to a given build.
- **Difficulty offsets are a flat global adjustment.** They are applied at
  display time, not stored per monster, and they do not model any per-monster
  scaling a patch might introduce.
- **Aura totals are an upper bound.** Including auras assumes every toggled or
  duration buff is active, which overstates a monster that rarely casts one.
- **Resistance is representative-derived for collapsed groups.** A group whose
  variants disagree shows its representative's values, flagged rather than
  reconciled.

## Not in this page

- Health, offensive ability, defensive ability, and attack data. Those remain
  deferred phases of the wider monster initiative.
- Translations beyond English.
- Any change to how resistance is resolved. This page consumes
  `data/monsters.json` as the pipeline produces it, with the single exception of
  the trap exclusion above.
