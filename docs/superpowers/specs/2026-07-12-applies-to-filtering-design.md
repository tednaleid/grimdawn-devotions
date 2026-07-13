# Applies-to gear-type filtering in the item browser prototype

Point-in-time design record. The core use case: Ted equips a new piece of gear
(say a helmet) and wants to see every augment and component he could put on it.
The prototype (`itemdb.html`) cannot answer this today: its gear-type facet
only sees each entity's own `gear_type`, which for augments and components is
just "augment" or "component". This design makes the gear-type facet answer
"what can go ON this slot" for those domains, so domain=augment + gear
type=medal + expansion + text search compose the way every other facet does.

## Data (no changes)

Everything needed is already extracted, derived, and released:

- Augment and component records carry per-slot applicability flags in the game
  files. `build_derived.py` (`FLAG_TYPE`, `build_relations`) already turns
  flags with value 1 into `applies_to` edges in `relations.parquet`, using the
  same gear-type vocabulary as gear entities (`legs`, `medal`, `sword1h`, ...).
- The game pre-expands applicability classes: "Applied to all armor" is stored
  as seven concrete slot flags. Spiritguard Powder already has edges to
  head/chest/shoulders/hands/legs/feet/waist. No class hierarchy is needed.
- Coverage at build 19149150: 339/340 augments and 107/107 components have
  edges. The one gap is the dev template blank (`a00_blank.dbr`), which is
  correct: with no edges it never matches a gear-type filter.
- Verified examples: Rune of Amatok's Breath -> medal; Ancient Armor Plate ->
  chest, legs; Spiritguard Powder -> the seven armor slots.
- `relations.parquet` ships in the dataset release (deposit-19149150.2), so no
  new release revision is required.

A derive-time alternative (baking a `gear_types` array column into
`entities.parquet`) was rejected: it would force a schema change and a new
release to avoid a 447-row JS join the prototype already does for sources.

## Prototype changes (`itemdb.html` only)

The prototype is the throwaway English-only item browser; it is exempt from
the web/ i18n invariant. All changes live in the one file.

1. **Load the edges.** Register `relations.parquet` alongside the existing
   parquet registrations, query `applies_to` rows, and build an
   `appliesByRecord` map (record -> sorted list of gear-type tokens).
2. **Set-valued gear type.** Each item's `gear_type` facet value set becomes:
   gear -> `[own gear_type]`; augment/component -> its applies-to list. The
   existing `values()` helper and set-aware `matchesExcept`/`vocab`/count
   machinery (built for the source facet) handle arrays already, so the facet,
   counts, and OR-within-group behavior need no new logic. The "augment" and
   "component" values disappear from the gear-type facet; the domain facet
   already covers that distinction.
3. **Card meta line.** The meta line renders the scalar `gear_type` for gear
   and the domain for augments/components (its current effective behavior,
   made explicit now that `gear_type` is an array for those domains).
4. **Applies-to card line.** Augment/component cards gain a line in the
   source-line style: "Applies to all armor" when the edge set exactly matches
   a known group, otherwise a greedy collapse (largest group first) with
   leftovers listed, e.g. "Applies to chest, legs". The groups are a small JS
   map in the file, nothing curated outside it: all armor (7 slots), all
   jewelry (amulet, ring, medal), all weapons (all 11 weapon tokens), 1h melee
   (sword1h, axe1h, mace1h, dagger, scepter), 2h weapons (sword2h, axe2h,
   mace2h, spear2h, ranged2h). Slot tokens render as-is, matching the facet
   buttons.

## Acceptance guard (ae9)

A new `scripts/derived_queries/ae9_applies_to.sql` plus a
`q-ae9-applies-to` justfile recipe joins the `q-ae-all` gate, following the
gated-CTE convention of ae1-ae8. It pins card oracles over already-released
data so a game patch that changes applicability fails the build loudly:

- Spiritguard Powder: exactly the seven armor slots.
- Ancient Armor Plate: exactly chest and legs.
- Rune of Amatok's Breath: exactly medal.
- Coverage pin: every augment and component except the pinned template blank
  has at least one `applies_to` edge.

No new release accompanies this: the queries live in git and run against the
fetched or locally derived data.

## Verification

Extend the existing headless smoke test (`itemdb-smoke.ts`):

- domain=augment + gear type=medal + search "breath" finds Rune of Amatok's
  Breath.
- Spiritguard Powder's card shows "Applies to all armor".
- The legs facet button count includes components (Ancient Armor Plate), not
  just legs armor.
- The gear-type facet no longer offers "augment" or "component" values.

`just q-ae-all` (now nine recipes) stays green.

## Out of scope

- Benefit/stat filtering for augments and components (find augments granting
  a specific stat). Already captured in BACKLOG as the families-facet
  direction.
- Any change to `build_derived.py`, the derived schema, or the release
  assets.
- Readable display names for slot tokens (sword1h etc.) beyond the group
  phrases; the prototype shows raw tokens everywhere today.
