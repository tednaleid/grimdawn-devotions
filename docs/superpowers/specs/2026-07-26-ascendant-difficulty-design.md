# Ascendant Difficulty Design

**Date:** 2026-07-26
**Status:** implemented 2026-07-26
**Branch:** monster-resistance-pipeline

## Goal

Add Ascendant as a fourth option in the monster explorer's difficulty control,
with its resistance offsets derived from the game records rather than aliased to
Ultimate in app code. Ultimate remains the default.

## Why

Ascendant Mode is the headline difficulty of the current expansion, and the
first question players ask about it is whether enemies resist more. The page
cannot answer that question today: the control offers Normal, Elite and
Ultimate only, so a reader is left to guess whether Ascendant is missing because
it matches Ultimate or because we never looked.

We never looked. `scripts/parse_monsters.py` reads one balancing record and
hard-codes `DIFFICULTIES = ("normal", "elite", "ultimate")`. The answer it would
give today happens to be right, but by luck: nothing in the pipeline reads the
record the game actually consults for Ascendant, so a patch that gave Ascendant
a resistance offset would leave the page quietly showing Ultimate's numbers.

## What the game data says

Ascendant is not a fourth difficulty. It is a toggle layered on Ultimate, the
same way Veteran layers on Normal — the internal name is
`tagDifficultyUltimateVeteran` ("Ascendant Mode"), and `tagChallengeDifficulty03Desc`
reads "Ascendant Mode enhances Ultimate Difficulty with new mechanics/loot".

The engine reaches its enemy adjustments through a closed chain of record
pointers:

```
gameengine.dbr
  monsterAttributePak       -> balancingadjustment_mp+difficulty_enemies01.dbr   (already read)
  ascendantRecord           -> gameascendant.dbr
                                 ultimateChallangeAdjustment
                                   -> balancingadjustment_ultramode_enemies01.dbr
```

`ultimateChallangeAdjustment` is the game's own spelling. `gameascendant.dbr` is
the only file in the extracted record tree that references the ultramode record.

In the current data (1.3.0.0, buildid 24346246) every one of the ten resistance
fields on the ultramode record is `0.000000`. What Ascendant does change is
`characterDefensiveAbility` (80, against Veteran's 15). **Ascendant enemies are
harder to hit; their resistances are untouched.**

## Design

### 1. Pipeline derives the offsets

`scripts/parse_monsters.py` gains two things.

**`ascendant_ref(db)`** — resolves the ultramode record by following
`gameengine.dbr -> ascendantRecord -> gameascendant.dbr -> ultimateChallangeAdjustment`,
falling back to the literal path when a hop is missing. This mirrors the existing
`scaler_ref()` idiom exactly, so a patch that relocates the record is followed
instead of silently reading a stale path.

**`flat_adjustment(rec)`** — reads the ten resistance fields as scalars and
returns `{type: value}`. This deliberately does **not** reuse
`split_difficulty_array`: that function models a 3x4 difficulty/player table,
whereas the ultramode record is a single flat adjustment applied on top of
whichever difficulty is active. Broadcasting it through the 12-cell reader would
be a category error that happens to produce the right answer while the values are
zero. A field that is absent contributes 0; a field that is present but not a
single number is recorded in `FAILED_OFFSET_FIELDS` so `print_summary` reports it
loudly, matching how the existing offset reader fails.

`difficulty_offsets(db)` then emits a fourth key:

```
ascendant[players][type] = ultimate[players][type] + adjustment[type]
```

Player brackets carry through from Ultimate; the adjustment is flat across them.

**Assumption, stated because it is not verifiable from current data:** the
adjustment is *additive on top of* Ultimate rather than a replacement for it.
The field is named an "adjustment" and sits parallel to `challengeAdjustment`
(Veteran), which stacks on Normal. Because every value is currently zero, both
readings produce byte-identical output, so no test on real data can distinguish
them. Additive is the better reading of the naming and the Veteran precedent. If
a future patch makes these nonzero and the true semantic turns out to be
replacement, this is the line to change.

### 2. Data schema

`data/monsters.json` gains `difficulty_offsets.ascendant` with the same
`{players: {type: value}}` shape as its three siblings. `diff_data.py` already
unions the difficulty keys, so the regeneration reports the new cells rather than
crashing; its `diff_offsets` docstring claims a fixed shape with no add/remove to
report and needs a one-line correction.

### 3. Web

- `facets.ts`: `DIFFICULTIES` becomes `["normal", "elite", "ultimate", "ascendant"]`.
  Order is dropdown order, hardest last. `Difficulty` derives from it, and
  `urlState.ts` builds `DIFF_VALUES` from the same constant, so `diff=ascendant`
  round-trips through the hash with no further change. `DEFAULT_VIEW.diff` stays
  `"ultimate"`, so existing links and the bare URL are unaffected.
- `model.ts`: `offsetFor` already reads any difficulty key present in the
  document and returns zeros for one that is absent. No change.
- `main.ts`: the difficulty `<select>` is generated from `DIFFICULTIES`, so the
  option appears automatically once the catalog key exists.

### 4. The equivalence note is derived, never asserted

A hardcoded "Ascendant matches Ultimate" line would be a claim in app code that
no test can keep true across patches. Saying nothing at all has the opposite
failure: a reader selects Ascendant, sees identical numbers, and still cannot
tell whether the modes genuinely match or the page failed to model Ascendant and
fell back.

So the page states it only when it computes it. `model.ts` gains a pure
predicate:

```ts
export function sameOffsets(a: Resistances, b: Resistances): boolean
```

When the selected difficulty is Ascendant and its offset row equals Ultimate's
for the current player count, the controls render one line beneath the difficulty
select. Otherwise nothing renders and the numbers speak for themselves.

The wording stays strictly within what the predicate proves — a statement about
this dataset, not about the game's design intent:

> `monsters.note.ascendantSameAsUltimate` = "In this dataset Ascendant applies
> the same resistance offsets as Ultimate."

It carries no claim about defensive ability, loot, or spawns, because none of
those are derived here and all of them could change.

## Testing

`scripts/test_parse_monsters.py`:

- `ascendant_ref` follows the two-hop engine pointer, and falls back when a hop
  is absent
- `flat_adjustment` reads scalars, treats an absent field as 0, and records a
  non-numeric field as a failure rather than silently zeroing it
- `difficulty_offsets` emits all four keys
- **ascendant = ultimate + adjustment, proven with a nonzero fixture.** The real
  record is all zeros, so a fixture built from it cannot tell the correct
  implementation from one that copies Ultimate, ignores the adjustment, or reads
  the wrong record. The fixture must use a nonzero adjustment that differs per
  type. This is the dominant defect class in this branch's history and the single
  most important test here.

Web:

- `urlState`: `diff=ascendant` encodes and decodes; an unknown difficulty token
  is still rejected
- `model`: `offsetFor(doc, "ascendant", players)` reads the new block;
  `sameOffsets` returns false on a single differing type (not just on wholesale
  difference)
- controls markup: the note renders on Ascendant when the rows match, does not
  render on Ultimate, and does not render on Ascendant when the rows differ

`web/e2e/mon-smoke.ts`: selecting Ascendant keeps the table populated and puts
`diff=ascendant` in the hash.

## Out of scope

Veteran mode. The same machinery would cover it (`gameengine.dbr ->
challengeAdjustment`, also all-zero for resistances today), but nobody has asked
for it and the difficulty control would gain an option that duplicates Normal.
Recorded in BACKLOG.md instead.
