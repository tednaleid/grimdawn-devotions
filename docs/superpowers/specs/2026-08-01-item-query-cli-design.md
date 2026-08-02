# Item Query CLI Design

Status: approved for planning, 2026-08-01.

## Problem

The item database built by `just deposit` and `just derive` holds every Grim Dawn item
fact losslessly, but the only way to ask it a question is hand-written SQL. Build
questions are multi-criteria and awkward to express that way: "I want an Infiltrator
that switches to piercing damage, what should I target if Amarasta's Blade Burst and a
second skill are my primaries" touches masteries, skill bonuses, damage conversion,
slots, and level requirements at once, and every hand-written query re-derives the same
domain traps.

grimtools cannot answer these questions either, and not for want of polish. Its advanced
search ANDs across skill filters: measured against the live site, one skill filter
matched 122 items, a second matched 123, and both together matched zero. "Items granting
skill X or skill Y" is inexpressible there. That ceiling is what makes a local query tool
worth building rather than a better front end for someone else's search.

## Goal

A standalone CLI that a Claude Code instance drives to answer build questions, returning
ranked candidates with enough structure to reason about, and links that open the chosen
items on grimtools for detail. The human running it directly gets a readable table; the
agent gets JSON and turns it into a report.

## Scope

In scope:

- Three derived-schema extensions promoting data that already exists in the deposit:
  damage conversion, per-skill bonuses, and per-mastery bonuses.
- One CLI, `scripts/gditems.py`, with `search`, `vocab`, and `show` commands, covering
  both gear questions and modifier questions (augments, components) through the same
  filter-score-rank path.
- A skill packaging the workflow so a fresh session drives the CLI correctly.

Out of scope, deliberately:

- The reverse loot-table graph, and therefore world-drop attribution and affix
  applicability for monster infrequents. This is a separate spec. See "Deferred" below.
- The website. The CLI comes first and the artifact reports act as a design probe for it.

## Established facts

These are measured, not assumed. Implementation must not contradict them.

### Source attribution is thin for gear and absent for affixes

Coverage of `sources.parquet` by domain, measured against the committed deposit
(build 19149150). Count records with `count(DISTINCT record)`, not `count(*)` across a
join to `sources`, since an item with several source rows would otherwise be counted
several times and deflate its coverage:

| domain | records | with a source row | coverage |
| --- | --- | --- | --- |
| gear | 6,109 | 439 | 7.2% |
| affix | 6,657 | 0 | 0% |
| blueprint | 765 | 0 | 0% |
| augment | 340 | 332 | 97.6% |
| component | 107 | 84 | 78.5% |
| relic | 84 | 82 | 97.6% |
| quest | 68 | 1 | 1.5% |

An item with no source row is unattributed, which is not the same as a world drop. The
CLI never labels an unattributed item a world drop.

### The data for the three extensions already exists

Record counts for the raw keys, aggregated across categories from the deposit census:

| meaning | raw keys | records | in derived schema today |
| --- | --- | --- | --- |
| "+N to a specific skill" | `augmentSkillName1/2`, `augmentSkillLevel1/2` | 7,585 | no |
| "+N to a mastery" | `augmentMasteryName1/2`, `augmentMasteryLevel1/2` | 919 | no |
| damage conversion | `conversionInType`, `conversionOutType`, `conversionPercentage` | ~2,800 | no |
| granted skill | `itemSkillName` | 2,342 | yes, as `entities.granted_skill` |

The two kinds of skill bonus are structurally distinct, so no heuristic is needed to tell
them apart. A mastery bonus names a class-training record
(`records/skills/playerclass03/_classtraining_class03.dbr`, as on Blackwood Wand). A
skill bonus names an individual skill record
(`records/skills/playerclass04/shadowstrike.dbr`). The `playerclassNN` segment is what
links a specific skill back to its mastery.

### Single items are addressable without grimtools ids

grimtools item ids are internal and cannot be derived from game files, and the project
already rules out depending on them. They are not needed. An advanced-search query of
item name plus an exact `itemLevel` isolates one item: measured 2026-08-01, the name
alone returned all three Sellecor's March variants, name plus itemLevel 30 returned only
the base, and name plus itemLevel 84 returned only the Mythical. Both fields sit on one
`entities` row alongside `name_tag`, so the link is built from data the query already has.

## Architecture

The existing pipeline gains one stage and no new runtime. `just deposit` builds the
lossless facts from the game files. `just derive` builds the typed tables and gains the
three extensions. The CLI reads only the derived parquet through DuckDB, touching neither
the game files nor the network, so it runs anywhere after `just fetch-deposit`.

Layering follows the repository's hexagonal convention, with the port at query level
rather than row level so that filtering stays in SQL where it belongs.

- `scripts/gditems_core.py` is pure and imports no database driver. It owns the
  `Criteria` value object, the scoring function, tier collapsing with level filtering,
  and grimtools link construction.
- The repository port takes a `Criteria` and returns candidate rows.
  `scripts/gditems_duckdb.py` implements it and is the only module that knows about
  parquet or SQL. Tests supply a fake implementation returning fixture rows.
- Table rendering and JSON serialisation are output adapters over the same core result
  objects, which prevents the two views from drifting apart.
- Opening a browser is a one-method port, so `--open` is tested by asserting the URL
  handed to it.

Module and test layout follows the existing flat `scripts/*.py` plus `scripts/test_*.py`
convention, run by `just test-scripts`.

The CLI is standalone. `scripts/gditems.py` carries a uv shebang and runs directly from
any working directory. It resolves the deposit and derived directories from an explicit
flag, then an environment variable, then repo-relative defaults, and never reads justfile
variables. The `just items` recipe is a passthrough for convenience, not the interface.

## Schema extensions

`just derive` gains three additions, each with pinned acceptance queries in the existing
`q-ae*` style.

1. Damage conversion becomes queryable as a typed relation carrying the source damage
   type, the destination damage type, and the percentage.
2. Per-skill bonuses become a typed relation from item to skill record with the bonus
   level, alongside the mastery that skill belongs to, derived from the `playerclassNN`
   segment. The mastery link is what makes a single `--mastery` flag work instead of
   enumerating every skill in a class.
3. Per-mastery bonuses become a typed relation from item to mastery with the bonus level.

## CLI surface

`vocab` prints the valid tokens for every flag: mastery names, gear types, slots, stat
families, and skill names as spelled in the data. This exists so the agent composes
correct calls rather than guessing at spelling, since a mistyped token would otherwise
produce an empty result indistinguishable from a genuine absence of matches.

`show` prints everything known about one item, for writing justifications into a report.
It accepts either an `entities.record` path or an exact item name, and reports the
ambiguity rather than guessing when a name matches more than one family.

`search` takes flags in three groups.

Scope flags, which restrict the candidate set without contributing to the score:
`--domain` (gear, augment, component, relic), `--slot`, `--gear-type`, `--rarity`,
`--expansion`, `--all-tiers`, `--source` (vendor, crafted, unknown), `--fits`, which uses
the `applies_to` relation to answer which modifiers can go in a given piece, and
`--level N`, which excludes anything whose `req_level` exceeds N and selects which tier of
a family is shown.

Criteria flags, each both a filter and a scored dimension: `--stat <family> --min N`
(repeatable), `--resist <type>` as sugar for the corresponding defensive stat family,
`--converts-to <type>` with `--min-convert`, `--grants-skill`, `--boosts-skill`,
`--boosts-mastery`, and `--mastery`, which is the union of boosting a mastery outright and
boosting any individual skill within it.

Output flags: `--limit`, `--json`, `--explain`, `--weights`, `--open N`.

Worked examples of the two question shapes:

```
scripts/gditems.py search --mastery nightblade,inquisitor --converts-to pierce \
  --boosts-skill "Amarasta's Blade Burst" --level 70 --json

scripts/gditems.py search --domain augment,component --fits chest \
  --resist pierce --source vendor,crafted --limit 10
```

## Result model

One result is one item family, not one record. Tier ladders (base, Empowered, Mythical)
collapse on `entities.group_key`, and the tier shown is the strongest one usable at
`--level`, or the strongest that exists when no level is given. The ladder itself is
reported so the reader sees which tiers exist and at what levels. `--all-tiers` expands
each family into its records.

Every result carries its grimtools link, built from the shown tier's name and item level.

## Scoring

Each criterion produces a sub-score normalised against the best value among the matching
candidates, so a score expresses quality relative to what is actually available rather
than against an invented absolute scale. Sub-scores are summed using weights that default
to equal across the criteria given and are overridable with `--weights`. `--explain`
prints the per-criterion arithmetic.

Skill criteria score by magnitude, since a larger bonus is genuinely better. Conversion
scores by percentage converted. An item missing a criterion scores zero for that
criterion rather than being excluded, unless a `--min` was given for it, which is what
allows a strong two-of-three item to outrank a weak three-of-three.

A mastery-wide bonus contributes to every skill criterion belonging to that mastery, at a
lower weight than a bonus naming the skill directly. Without this, generalist items either
vanish from skill-specific searches or crowd out the specialists. `--explain` states which
kind of bonus produced the points.

## Honesty rules

These are requirements, not guidance, because their failure mode is a confident wrong
answer.

- A score reflects only the criteria the caller passed. Output states this. The score
  ranks candidates and never claims an item is good for a build.
- Source renders as `vendor`, `crafted`, or `unknown`. Nothing renders as "world drop"
  until the loot graph exists.
- A criterion matching nothing is reported per criterion, so an empty result distinguishes
  "no item satisfies all of this" from "one of your criteria is impossible".

## Errors

An unrecognised token for a flag fails with near-matches drawn from `vocab` rather than
returning zero rows. Missing parquet fails with the instruction to run `just fetch-deposit`.
Both exit non-zero so a calling script or agent notices.

## Testing

Two legs, because either alone is insufficient.

Fast tests run the pure core through the fake repository adapter and cover scoring
including the mastery-versus-skill weighting, tier collapsing, level filtering, link
construction, and criteria parsing. These need no database and no fixtures beyond
in-memory rows.

Pinned acceptance queries run against the real derived parquet in the existing `q-ae*`
style, with oracle counts that fail loudly when a join drifts. This leg is required
because unit tests over a fake adapter prove the logic and not the SQL. A defect shipped
on the item-search page in this repository passed every unit test while returning 144
items instead of 3, because the tests agreed with each other about a format the target
system ignored.

One end-to-end test asserts that `--json` and the table render the same query identically,
so the two output adapters cannot diverge.

## Skill packaging

A skill teaches a fresh session the workflow: call `vocab` before composing flags, run
`search` with `--json`, reason over the structured result, then publish an artifact page
carrying the recommendations, the per-item justification, the source labels, and the
grimtools links.

## Deferred

The reverse loot-table graph is the single largest piece of remaining work and unlocks
two things this spec cannot deliver: whether an item is farmable and from where, and which
affixes roll on which gear, which is what monster infrequents need. It gets its own spec.
The source field in this CLI is designed so that resolving unattributed items later
enriches the output without changing the interface.

The website reuses the derived tables and the scoring model, and the artifact reports
produced through this CLI are the cheapest way to learn what it should look like before
committing to it.
