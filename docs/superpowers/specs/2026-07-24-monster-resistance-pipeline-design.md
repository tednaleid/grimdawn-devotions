# Monster resistance survey pipeline: design

Status: implemented
Date: 2026-07-24
Game version at investigation: 1.3.0.0 (Fangs of Asterkarn)

## Goal

Extract every combat-relevant monster in Grim Dawn into a committed, re-runnable
dataset (`data/monsters.json`) that answers aggregate questions about enemy
defenses: what resistances enemies actually have, how they are distributed across
a filtered subset, and therefore what damage types are worth building into.

This is the pipeline half. The explorer page that consumes it is a separate
sub-project with its own spec (see "Sub-project sequence").

## Scope decision

v1 is **resistances-first**. The investigation below establishes three tiers of
extraction difficulty; v1 commits only to the clean tier, and the harder tiers
become follow-on phases with their own specs. This keeps the first shippable
version low-risk while still answering the primary question.

In scope for v1:

- Every combat-relevant monster, deduplicated to a logical grain.
- Per-monster base resistances for the ten damage types.
- The global difficulty and player-count offset table.
- Identity and filter facets: classification, path role, race, level range.

Out of scope for v1 (each a defined follow-on, not an omission):

- Health, offensive ability, defensive ability (needs a level-equation evaluator).
- Attacks, burst damage, and damage types (needs skill classification and
  aggregation across many records).
- Passive resistance grants from a monster's own skills (see "Known limitations").

## Sub-project sequence

1. **Extraction pipeline** (this spec): `scripts/parse_monsters.py` produces
   `data/monsters.json`.
2. **Explorer page**: `web/src/monsters/`, modelled on `web/src/rr/`. Brainstormed
   and specced against the real dataset once phase 1 lands. This spec pins the
   data contract phase 2 depends on so no rework is needed.
3. **Defense and attack phases**: HP/DA/OA, then attacks.

## Investigation findings

All numbers below were measured against the extracted 1.3.0.0 records during
design. They are a point-in-time record, not a living reference.

### Population

`records/creatures/` holds 5,239 `.dbr` files, of which 3,074 are real monsters
(`Class,Monster`). The remaining 2,165 are props, animation tables, and other
non-combat records. The `*_boss.dbr` siblings are `charanimationtable.tpl`
animation tables, not stat records, and must not be read as monsters.

After the exclusion rules in "Filtering" below, 2,728 raw records remain.

`monsterClassification` distribution across the 3,074 monsters:

| Classification | Count |
| --- | --- |
| Hero | 1,183 |
| Champion | 847 |
| Common | 559 |
| Quest | 359 |
| (absent) | 51 |
| Boss | 46 |
| SuperBoss | 29 |

Note that "Nemesis" is not a classification. Nemeses are Boss or SuperBoss
records living under `creatures/enemies/nemesis/`, so nemesis-tier filtering
must come from the path role, not the classification.

The 51 records with no `monsterClassification` are excluded from v1 (see
"Filtering"), so every monster in the dataset carries one of the six real
classification values.

### Stat tiers

**Resistances are the clean tier.** They are bare `defensive<Type>` fields
stored inline on the creature record, where a positive value is a resistance
percentage and an absent field means 0. Coverage across all monster records:

| Field | Records nonzero | Min | Max |
| --- | --- | --- | --- |
| defensivePierce | 1,595 | 4 | 500 |
| defensivePhysical | 1,366 | -15 | 500 |
| defensiveLife | 1,234 | 8 | 500 |
| defensiveCold | 1,071 | 8 | 500 |
| defensiveFire | 1,044 | -25 | 500 |
| defensiveLightning | 912 | 8 | 500 |
| defensiveAether | 823 | 8 | 500 |
| defensivePoison | 801 | 8 | 500 |
| defensiveChaos | 697 | 8 | 500 |
| defensiveBleeding | 0 | n/a | n/a |
| defensiveElemental | 0 | n/a | n/a |

The spread is real and meaningful: negative values are genuine vulnerabilities,
and 500 encodes effective immunity. `defensiveBleeding` is never set inline, so
monster bleeding resistance comes only from difficulty offsets and passives.
`defensiveElemental` is never set inline either; elemental is always stored as
the three separate Fire, Cold, and Lightning fields.

Important sign convention: a bare `defensive<Type>` on a **creature** record is
that monster's own resistance. A **negative** `defensive<Type>` on a **skill**
record is a resistance-reduction debuff, which is what the RR pipeline extracts.
Same field name, opposite meaning by context.

**Health, DA, and OA are the equation tier.** `characterLife`,
`characterOffensiveAbility`, and `characterDefensiveAbility` are 0 on the record
for 3,069 of 3,074 monsters. The real values come from
`characterAttributeEquations`, which points at a `creatures/enemies/bios/bio_*.dbr`
record holding level-scaling equations (`charLevel` itself is an equation such as
`(charLevel*1.1)+2`). 3,071 of 3,074 monsters carry such a pointer. Surfacing
these stats therefore requires an equation evaluator and a chosen character
level, which is why they are a follow-on phase rather than v1.

**Attacks are the stretch tier.** A monster's abilities are referenced by
`skillName1..N` and live under `records/skills/nonplayerskills/` plus the
`nonplayerskillsgdx1`, `gdx2`, and `gdx3` expansion directories (gdx3 is new in
Fangs of Asterkarn). These are exactly the records the RR pipeline excludes as
player-irrelevant. Damage is extractable: for example
`bossskills/nemesis/valdaran_lightningbolt.dbr` stores `offensiveLightningMin`
as a 60-entry per-level array running from 106 at level 1 to 3,666 at level 60.
But a single monster carries many skills (Valdaran has 16), only some are
attacks, and turning that into a "burst damage" number requires classifying each
skill by its `Class` and aggregating across damage types. That definitional work
needs its own design pass.

### Difficulty scaling

`records/game/gameengine.dbr` points at the enemy scaler via `monsterAttributePak`,
which resolves to `records/game/balancingadjustment_mp+difficulty_enemies01.dbr`.

That record stores its values as **12-entry arrays: 3 difficulties by 4
player-count brackets**. For example `characterDefensiveAbility` is
`35 x4; 60 x4; 75 x4` (Normal 35, Elite 60, Ultimate 75), and `defensiveFire` is
`0 x4; 4; 6; 8; 11; 8; 10; 13; 16`.

The consequence for this design: difficulty applies a **global additive offset**
to every monster's resistance, on top of that monster's own base. On Ultimate at
4 players, every monster in the game gets +16% fire resistance. A distribution
view that ignores this would misrepresent the endgame that players care about.

Post-migration the scaler still encodes exactly three difficulties: the
difficulty tier Fangs of Asterkarn added above Ultimate is not a fourth column
in this record.

**That tier does not change resistances.** It scales overall monster damage and
health only (roughly +75% damage and +1380% health, against Ultimate's +30% and
+530%). The consequence for this design is a simplification rather than a gap:
the three-difficulty offset table is the complete resistance model for every
difficulty in the game, including the new one. Nothing about the new tier is
missing from v1.

The damage and health scaling matters only to the follow-on defenses phase, and
those announced percentages do not line up exactly with the raw scaler fields
(the record carries `offensiveTotalDamageModifier` 40 and `characterLifeModifier`
580 at Ultimate, alongside a separate per-player-bracket
`characterLifeMultModifier` of 0/90/180/270). That phase must reconcile which
representation is authoritative rather than assume either one.

### Dedup grain

Monsters are heavily variant-versioned, the same problem that item records posed
during the RR work. Filename patterns across monster records: 825 carry an
`_[abc]NN` tier suffix, 247 are `_summon` spawns, and 14 are `_pN` boss phases.

Measured against the kept records, `(resolved name x classification)` collapses
2,728 raw records to **1,637 logical monsters**, of which 608 collapse more than
one record.

The important measurement: of those 608 collapsing groups, only **50 (8%)** have
variants that disagree on their resistance values at all. Choosing a single
representative therefore discards very little, and the 8% is small enough to
report honestly rather than hide.

Classification is part of the key because names genuinely span tiers: "Animated
Preserver" exists as both Champion (12 records) and Common (4 records), and those
are different opponents.

### Facets

Distributions below are across the 2,728 kept records, after every exclusion in
"Filtering".

Classification:

| Classification | Records |
| --- | --- |
| Hero | 992 |
| Champion | 837 |
| Common | 476 |
| Quest | 348 |
| Boss | 46 |
| SuperBoss | 29 |

Path role:

| Role | Records |
| --- | --- |
| base | 957 |
| hero | 582 |
| boss&quest | 517 |
| faction | 229 |
| special | 168 |
| waveevent | 144 |
| bounties | 73 |
| nemesis | 29 |
| anomalies | 13 |
| ambient | 12 |
| npcs | 4 |

`waveevent` and `waveevents` are two spellings of the same concept and normalize
to the single `waveevent` role, which is why that row is the sum of the two
directories. The `devotion` role is excluded entirely (see "Filtering").

246 of the kept records are `_summon` spawns.

`characterRacialProfile` takes 40 distinct `Race0NN` values, which resolve to
display names through `tagRace0NN` translation tags (Race001 Undead, Race002
Beastkin, Race003 Aetherial, Race004 Chthonic, Race005 Aether Corruption, and so
on). Because they are tags, the race facet localizes through the existing game
text table with no extra work, and it shares its id space with the racial damage
bonuses the devotion planner already models.

Every kept record carries a numeric `maxLevel`, so the grain tie-break below
never falls through for want of a level.

## Design

### Filtering

A creature record is kept when all of the following hold:

- `Class` is exactly `Monster`.
- `hiddenFromCombat` is unset or zero.
- `invincible` is unset or zero.
- `description` is present and resolves to a non-empty name through the
  translation tags.
- The path role is not `devotion`. Those 191 records under
  `creatures/enemies/devotion/` are devotion-related content rather than
  opponents a player fights and surveys.
- `monsterClassification` is one of the six real values (Common, Champion, Hero,
  Boss, SuperBoss, Quest). The 51 records without one are dropped as
  scaffolding rather than given a synthetic facet value.

Measured exclusions from the 5,239 files, applied in that order: 2,165 not
`Class,Monster`, 87 `hiddenFromCombat`, 11 `invincible`, 6 with no resolvable
name, 191 `devotion` role, 51 with no classification. Total 2,511 excluded,
leaving 2,728 kept.

The last two rules are deliberate "good enough" calls for v1: both sets are
small and almost certainly not opponents worth surveying. Both are counted in
the parser summary, so if either turns out to matter the evidence is visible
rather than lost.

`_summon` records and `Quest` classification records are **kept**, not dropped,
and each is tagged so the page can filter on it. For `_summon` records that tag
is representative-derived: most `_summon` records fold into a non-summon twin of
the same creature at the logical grain, so `is_summon` on the output row survives
only for monsters that exist solely as summons (see "Known limitations"). Silently
dropping the records would lose real opponents; tagging keeps the population
honest and the choice in the user's hands. Every exclusion is counted and printed
in the parser summary, following the RR parser's `EXCLUSIONS` pattern.

### Grain

One logical monster is one `(resolved name, classification)` pair.

The representative record within a group is chosen by, in order:

1. Highest `maxLevel`.
2. Highest `minLevel`.
3. Lexicographically lowest record path.

The tie-break chain must be total and deterministic so the committed dataset is
reproducible across runs and machines.

Each logical monster records `variant_count` (how many raw records collapsed
into it), `record_paths` (all of them), and `variants_disagree` (true when the
group's members do not share identical resistance values). The last field is what
makes the 8% visible instead of silently averaged away.

### Fields

Per logical monster:

- `id`: stable, language-independent slug derived from the representative record
  path. Ids never contain display text, per the i18n invariant.
- `name_tag`: the `description` tag. Display text resolves through
  `data/i18n/game.<lang>.json`, never stored inline.
- `classification`: one of Common, Champion, Hero, Boss, SuperBoss, Quest. Never
  null, because unclassified records are excluded.
- `role`: normalized path role (nemesis, hero, boss&quest, faction, special,
  waveevent, bounties, npcs, anomalies, ambient, base).
- `race_tag`: the `tagRace0NN` tag, or null.
- `min_level`, `max_level`.
- `is_summon`: derived from the `_summon` filename suffix.
- `resistances`: an object with **all ten types always present**, absent fields
  written as explicit `0`. Types: physical, pierce, fire, cold, lightning,
  poison (Poison and Acid), aether, chaos, vitality (the `defensiveLife` field),
  bleeding, and elemental is not stored because it is always the three
  constituent types.
- `variant_count`, `variants_disagree`, `record_paths`.

Writing all ten resistance keys explicitly is a deliberate choice for the
consumer: aggregate views reduce over arrays with no per-row fallback branch, and
a type-by-classification heatmap becomes a direct read.

### Difficulty offsets

The same JSON carries a companion `difficulty_offsets` block extracted verbatim
from `balancingadjustment_mp+difficulty_enemies01.dbr`, shaped as
`[difficulty][players] -> per-resistance offset`, with difficulties Normal,
Elite, Ultimate and player brackets 1 through 4.

Effective resistance is computed **in the page**, not baked into the data:
`effective = base + offset[difficulty][players]`. Keeping base and offset
separate means the game's balance constants stay in extracted data rather than
app code, they re-extract on every patch with no code change, and the page can
offer a difficulty selector without the pipeline emitting twelve copies of every
monster.

### Output shape

```json
{
  "meta": {
    "game_version": "1.3.0.0",
    "steam_buildid": "12345678",
    "generated_utc": "2026-07-24T00:00:00Z"
  },
  "monsters": [
    {
      "id": "enemies.nemesis.nemesis_aetherial_01",
      "name_tag": "tagNemesis_Aetherial01",
      "classification": "Boss",
      "role": "nemesis",
      "race_tag": "tagRace005",
      "min_level": 60,
      "max_level": 250,
      "is_summon": false,
      "resistances": {
        "physical": 0, "pierce": 0, "fire": 20, "cold": 0,
        "lightning": 50, "poison": 20, "aether": 50, "chaos": 0,
        "vitality": 0, "bleeding": 0
      },
      "variant_count": 2,
      "variants_disagree": true,
      "record_paths": [
        "records/creatures/enemies/nemesis/nemesis_aetherial_01.dbr",
        "records/creatures/enemies/special/fun/nemesis_aetherial_01.dbr"
      ]
    }
  ],
  "difficulty_offsets": {
    "normal":   { "1": { "fire": 0 }, "2": { "fire": 0 },  "3": { "fire": 0 },  "4": { "fire": 0 } },
    "elite":    { "1": { "fire": 4 }, "2": { "fire": 6 },  "3": { "fire": 8 },  "4": { "fire": 11 } },
    "ultimate": { "1": { "fire": 8 }, "2": { "fire": 10 }, "3": { "fire": 13 }, "4": { "fire": 16 } }
  }
}
```

Valdaran is a real worked example of the grain doing its job: a duplicate of the
record lives under `enemies/special/fun/` with different resistances, so the pair
collapses to one logical monster, the tie-break keeps the `nemesis/` record as
representative, and `variants_disagree` marks the pair rather than hiding the
conflict.

Each player-count entry carries the full set of ten resistance keys; only `fire`
is shown above to keep the example readable. The fire numbers are the real
extracted `defensiveFire` array (`0 x4; 4; 6; 8; 11; 8; 10; 13; 16`) split into
its 3 by 4 shape, and the Valdaran resistances are that record's real values.
Both serve as the parser's integration fixtures.

### Wiring

Following the established pattern exactly, so the pipeline is a peer of the
existing two rather than a special case:

- `scripts/parse_monsters.py`, the third consumer of `scripts/gd_dbr.py`
  (`read_dbr`, `load_translations`, `DB`, `register`). No new parsing primitives;
  extend `gd_dbr.py` only if a genuinely shared need appears.
- `just parse-monsters`, mirroring `just parse-rr`, resolving the game version
  through the existing `_game-version` recipe so a new build cannot ship
  mislabelled.
- Added to `just all` and to `just migrate` so a future version bump regenerates
  monsters alongside devotions and RR with no extra step.
- `scripts/build_game_tables.py` extended so monster name tags and `tagRace0NN`
  tags land in `data/i18n/game.<lang>.json` for all 13 languages.
- `scripts/diff_data.py` gains a monster section reporting added, removed, and
  changed monsters between the committed baseline and a regenerated dataset, so
  patch-to-patch tuning changes are visible at review time.
- `just build` copies `data/monsters.json` into `dist/data/`.

### Testing

`scripts/test_parse_monsters.py`, following `scripts/test_parse_rr.py`:

- Pure unit tests of the collapse function: variants collapsing to the
  highest-level representative, the full tie-break chain, `variants_disagree`
  set correctly when members differ and clear when they do not.
- Pure unit tests of the filter predicate: each exclusion rule in isolation.
- Unit test of the difficulty-offset parse: the 12-entry array splits into
  3 difficulties by 4 player brackets in the right order.
- Integration assertions against the real extracted records, pinning the
  measured counts above (2,728 kept, 1,637 logical, Valdaran's exact resistance
  values, that no monster is missing any of the ten resistance keys, and that no
  monster carries a `devotion` role or a null classification).

The counts are data-derived, so they are expected to move on a game patch. They
are assertions with honest bands rather than exact equality where a patch would
reasonably shift them, matching how the RR guard tests were written.

## Page data contract

Recorded here so phase 2 can be designed without reopening the pipeline.

The page filters on `classification`, `role`, `race_tag`, level range,
`is_summon`, and a name search. Every one of those is a first-class field, so no
runtime string-parsing of paths or names is required.

The aggregate view reduces over the filtered subset per resistance type, which
the always-present ten-key resistance object makes a direct array reduce. The
"what are enemies weakest to" answer is the inversion of that aggregate: the
types with the lowest central tendency across the selected subset.

The difficulty and player-count selector reads `difficulty_offsets` and adds the
offset before aggregating.

Per the project invariants: all page state lives in the URL hash so links are
shareable, no user-facing string is hardcoded (catalog keys under a `mon.*`
namespace, guarded by `web/test/appCatalog.test.ts`), and selection ids stay
language independent.

## Known limitations

Stated in the spec and surfaced in the page rather than left implicit:

- **Passive resistance grants are modelled as of 2026-07-25.** A monster's own
  skills contribute to its resistance, resolved at the rank the monster pins. See
  [2026-07-25-monster-passive-resistances-design.md](2026-07-25-monster-passive-resistances-design.md).
  Aura and duration buffs are recorded in `aura_resistances` but deliberately not
  folded into the headline total.
- **8% of collapsed groups have disagreeing variants.** Those carry
  `variants_disagree: true` and the page should mark them rather than present a
  single number as if it were uncontested.
- **`role`, `is_summon`, and the level range describe the representative record,
  not every collapsed member.** Measured: 253 rows collapse records spanning more
  than one path role, 180 rows mix summon and non-summon records, 22 rows carry
  `is_summon: true` against 246 raw `_summon` records, and the `waveevent` role
  collapses from 144 raw records to a single row. This is mostly the grain
  working as designed: wave-event spawns, summon variants, and multi-phase boss
  records are duplicate placements of a creature that already exists elsewhere,
  so they correctly fold into that creature's row instead of appearing as
  separate monsters. The one real consequence: `is_summon` marks monsters that
  exist *only* as summons, not every monster that can be summoned (224 of the
  246 `_summon` records fold into a non-summon twin), so a page defaulting
  summons off hides only summon-only creatures. Role-based filtering is
  otherwise complete for the case that matters most: only one row outside the
  `nemesis` role contains a `/nemesis/` record among its collapsed members
  (`tagEnemySummonIceCrystal`, a summoned prop from a nemesis fight, not a
  nemesis itself), so nemesis-tier filtering is effectively unaffected.
- **Level-dependent stats are absent entirely in v1** (health, DA, OA), so the
  dataset describes defenses by type, not overall durability.
- **242 records are excluded as not-worth-surveying** (191 devotion role, 51
  unclassified). Both are counted in the parser summary; neither is believed to
  contain real opponents.

The difficulty coverage is explicitly **not** a limitation: because the tier
above Ultimate changes only damage and health, the three-difficulty offset table
is complete for resistances across every difficulty in the game.

## Follow-on phases

- **Defenses**: evaluate `characterAttributeEquations` bio equations at a chosen
  level to surface health, offensive ability, and defensive ability. Needs a
  level selector in the page and an equation evaluator in the parser. This is
  the phase where the difficulty tiers stop being resistance-neutral: it must
  model Ultimate's damage and health scaling and the higher tier's (roughly +75%
  damage and +1380% health versus +30% and +530%), and reconcile those announced
  figures against the raw scaler fields noted in "Difficulty scaling".
- **Attacks**: classify `skillName1..N` records by skill `Class`, select the
  per-level damage entry, and aggregate by damage type. Needs its own design pass
  to define what "burst damage" means before any extraction is written.
- **Grounding the RR page**: once real per-difficulty resistance distributions
  exist, the resistance-reduction page's hand-typed starting resistance can offer
  data-derived presets (for example the Ultimate nemesis median per type) instead
  of a bare default.
