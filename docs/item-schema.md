# Derived item schema

The typed, current-build-only parquet contract for the item database: entity,
stat, and relationship tables derived from the raw deposit
([docs/deposit.md](deposit.md)) by SQL plus a whitelisted equation evaluator,
sized for client-side DuckDB-WASM querying in a backend-less SPA. Built by
`just derive` into `data/derived/` (never committed - released alongside the
deposit and fetched via `just fetch-deposit`; see docs/deposit.md); regenerates
anywhere from the deposit and the committed curation files alone - no game
install needed.

## Tables

| file | shape | contents |
|---|---|---|
| `entities.parquet` | one row per in-scope game record | identity (`record` = deposit path), `domain` (gear / augment / component / relic / blueprint / quest / affix), `gear_type` + multi-valued `slots` (curated), `group_key` (name tag; same-name level tiers and empowered copies share one - the card-collapse key), `name_tag`/`text_tag`, `rarity`, `item_level`, computed `req_level`/`req_physique`/`req_cunning`/`req_spirit`, `expansion` (base/aom/fg), `is_empowered`, `attacks_per_sec`, `set_record`, `granted_skill`, `has_blueprint` |
| `stats.parquet` | `(record, source, stat_id, value_min, value_max, display_low, display_high)` | complete raw stats in long form. `source`: `self`, `skill` (granted skill at its granted level), `skill_buff` (one buff hop), `pet_bonus`. `Min`/`Max` sibling keys unify into one row; singles mirror into both value columns. `display_low/high` carry the variance-applied roll range, NULL when the stat never rolls |
| `relations.parquet` | `(src, kind, dst)` | `applies_to` (augment/component -> gear-type token), `crafts` and `reagent` (blueprint edges), `set_member` (item -> set record), `grants_skill` (item -> skill record), `spawns_pet` (item -> pet creature via the granted summon skill) |
| `families.parquet` | `(family, stat_id)` | the filter taxonomy from `stat-families.json`, ids unified to the stats vocabulary - "Cold" as one joinable family instead of 15 raw keys |
| `sources.parquet` | `(item, kind, vendor_record, vendor_tag, faction_tag, tier, provenance)` | item acquisition sources, tier 1. `kind` = `faction_vendor` (derived from the merchant chain: merchant `marketFileName` -> merchant-table tier keys -> tier table `marketStaticItems`; `tier` is friendly/respected/honored/revered from the referencing key, `vendor_tag` the merchant's `description` name tag, `faction_tag` the curated `tagFaction*` tag) or `crafted` (materialized from the `crafts` edges; the blueprint's record and name tag ride in the vendor columns, `faction_tag` and `tier` are NULL). `provenance` = `flat-fact` for derived rows, `curated-oracle` reserved for hand-fixed ones. Items with no rows are unsourced (displayed silently; "world drop" waits for the loot walk). Localized reputation-tier display names exist as `tagFactionState*` label tags when a consumer needs them |
| `boosts.parquet` | `(record, kind, target, mastery_record, level)` | per-skill and per-mastery level bonuses (`augmentSkillName<N>`/`augmentSkillLevel<N>` and `augmentMasteryName<N>`/`augmentMasteryLevel<N>`, the trailing number pairing a name key to its level key). A skill boost and a mastery boost differ structurally, not by heuristic: `kind = 'skill'` has `target` naming a skill record with `mastery_record` resolved from the `playerclassNN` segment of that path; `kind = 'mastery'` has `target` equal to `mastery_record`, both naming the mastery's own `_classtraining_class<NN>` record directly |
| `conversions.parquet` | `(record, from_type, to_type, percent)` | damage conversion as from/to/percent triples, keyed `conversionInType`/`conversionOutType`/`conversionPercentage` with a trailing digit numbering multiple conversions on one record (the unnumbered key is index 1). Joined from `facts` directly rather than pivoted into `entities`: a wide pivot takes `max()` per key, which would collapse a multi-conversion record down to a single row, so a record with several conversions keeps one row per conversion here |
| `skill_effect.parquet` | `(skill_record, effect_record, hops)` | maps every `records/skills/%` record to the record that actually carries its display name, icon and per-rank stat arrays - the link-walking resolver. A skill node is frequently a thin shell holding nothing but a `buffSkillName` or `petSkillName` pointing at the record with the real content, and chains mix both link types (six pet-modifier nodes go `petSkillName` then `buffSkillName`), so the walk is iterative rather than an ordered direct/buff/pet rule. It follows `buffSkillName`/`petSkillName` up to 8 hops and stops at the first record carrying `skillDisplayName`; `hops` is 0 for a record that already carries its own name |
| `skills.parquet` | `(record, mastery_record, group_record, node_kind, ui_x, ui_y, name_tag, icon, max_level, ultimate_level, effect_record)` | the 315-row mastery skill roster. Roster membership comes from `_classtree_class<NN>.dbr`, which is authoritative: every `skillName*` entry it lists resolves to a real record. The `records/ui/skills/class<NN>/skill*.dbr` button records supply `ui_x`/`ui_y` (`bitmapPositionX`/`Y`) but are never trusted for membership - they carry references to records with no facts at all; four playerclass10 transform abilities have no button and keep `ui_x`/`ui_y` NULL rather than an invented position. `group_record` groups a skill with its modifiers: the game encodes this in the display-name tag itself (`tagClass<NN>SkillName<GG><L>`, group number then member letter - Dreeg's Evil Eye is `11A` with modifiers `11B`..`11E`), and every one of the 146 groups has exactly one `A` member, which becomes that group's `group_record` and gets `node_kind = 'base'`. Non-base rows are `transmuter`, `pet_modifier`, or `modifier` from the record's own `Class`. `icon` and the name/cap facts are read off `effect_record` (this table's own `skill_effect` join), not off `record` itself |
| `skill_ranks.parquet` | `(skill_record, stat_id, at_first, at_max, at_ultimate)` | every numeric per-rank stat on a skill's `effect_record`, sampled at the three breakpoints a player actually decides between (rank 1, max rank, ultimate rank). A multi-rank stat is a `;`-separated array; a skill that only ever has one rank (26 of the 35 transmuters, plus Wind Devil and a handful of modifiers) stores the same stat as a bare scalar, which is read as a one-element rank list whose three breakpoints collapse onto one value. A scalar counts only when it is non-zero, since every skill record carries the whole template key set with its unused stats sitting at zero, and only when the game writes that key as a per-rank array on some skill somewhere - its own definition of a rank-scaling stat, and the only thing separating the 90 real stat keys from the 148 shape and presentation keys (`skillMaxLevel`, `cameraShakeAmplitude`, the `Mace2h`/`Shield` weapon-restriction flags) that a bare non-zero test would admit. Array length is not reliably `skillUltimateLevel` - at build 24756825, 17 of 1,370 numeric arrays disagree (9 shorter, 8 longer than `ultimate_level`), tracked by the `rank_array_len_mismatch` diagnostic - so each breakpoint clamps to the array's own length rather than indexing past its end. A skill with no `skillUltimateLevel` (a transmuter) is fully maxed at `max_level`, since gear cannot push a transmuter past its own cap, so `at_ultimate` coalesces to `at_max` for those rows rather than reporting a missing value |
| `pet_ranks.parquet` | `(skill_record, pet_record, source_kind, source_record, stat_id, at_first, at_max, at_ultimate)` | what a summon skill's pet is and does, at the same three breakpoints as `skill_ranks`. A summon's own record is nearly empty - Summon Hellhound carries a mana cost, a cooldown and a pet cap and no damage at all - because the pet is a separate creature record; `spawnObjects` on the summon is a per-rank array of those creature records, so the pet spawned at rank N is entry N and the breakpoints fall out directly. `source_kind = 'pet'` rows are stats on the creature record itself, restricted to the `character*` and `defensive*` prefixes (its resistances and speeds; no pet creature record carries a non-zero `offensive*` key, since a pet's damage lives on its abilities). `source_kind = 'pet_skill'` rows are stats on an ability the creature is granted, read from the ability's own rank array at the level the creature record grants it: that level IS the summon's rank for 38 of the 56 numeric grants, while the other 18 (radius helpers, totem immunities, wraith resists) stay pinned at 1 however far the summon is pushed, so the level is read rather than assumed. `source_record` is in the identity because one summon routinely has two sources naming the same stat - Summon Hellhound's innate gives `offensiveFireMin` 6/110/234 and its detonate ability 58/388/708 - which is also why this is a separate table rather than more `skill_ranks` rows: that table's `(skill_record, stat_id)` key would collide the two, and a pet's damage is not the player's. The 17 summons with `spawnObjects` are joined by the 3 pet-modifier nodes that swap the pet outright (`modSpawnObjects`); those are one-rank nodes whose array is indexed by their group base's rank, so they borrow the base's caps. The `pet_spawn_len_mismatch` diagnostic counts spawn arrays whose length disagrees with the driving summon's ultimate rank (0 at build 24756825) |
| `skill_modifiers.parquet` | `(item_record, modified_skill, modifier_record, stat_id, value, from_type, to_type)` | the extra stats one item attaches to one specific skill, paired by `modifiedSkillName<N>`/`modifierSkillName<N>`'s trailing number. `modified_skill` is constrained to the `skills` roster: a target outside it resolves against nothing (`records/skills/default/defaultevade.dbr` is the only one) and would ship as a blank row. `modifier_record` is frequently a shell of its own - Chosen Visage's Summon Hellhound modifier is a pet-modifier record whose `petSkillName` reaches the record that actually carries 200 fire damage and 18% crit damage - so this has its own link walk, separate from `skill_effect`: it stops at the first record carrying a non-zero numeric stat, not the first carrying a display name, because modifier stats routinely sit on anonymous carrier records the name-gated walk would run past. A carrier stores a stat as a bare scalar or, when the modifier skill has several ranks, as a `;`-separated per-rank array; `value` is the first element of either, because nothing on the item record names a rank (there is no `modifierSkillLevel` key in the deposit), because the 2,471 single-rank carriers are scalars by definition, and because the first elements land in the scalar range where the later ranks do not. `from_type`/`to_type` carry the damage types a `conversionPercentage` row converts between, which are string keys the numeric stat gate would otherwise drop, leaving a bare percentage; they are NULL on every other stat. `(item_record, modified_skill, modifier_record, stat_id)` is the identity: one item can attach two carriers to the same skill that both name a stat, and Bloodlord's Blade legitimately gives Possession `skillCooldownReduction` 100 (the chance-gated reset) on one and 5 (the flat reduction) on the other |

The filter contract maps onto these directly: facet groups are predicates on
`entities` columns (domain, type, slot, rarity, level range, expansion),
semi-joins on `stats`+`families` (stat families, OR within a family) and
`relations` (applies-to, crafts, sets), and text search joins `labels` (active
locale with per-tag English fallback) over `name_tag`, `text_tag`, and the
granted skill's name/description tags. `scripts/derived_queries/` holds sixteen
acceptance queries proving the whole contract; filters evaluate per entity row
(variant), and a card UI collapses rows by `group_key`.

## Curated inputs (`data/item-curation/`, committed)

- `gear-types.json` - the scope map: every `Class` value in a scoped category
  maps to domain/type/slots or an explicit exclusion; categories list their
  allowed domains ([] = structural, out of scope). Four categories outside
  `records/items/` are opted in for the grimtools-visible quest-reward
  wearables (e.g. Wilhelm's Wondrous Wargem).
- `stat-families.json` - devotions-parity filter families over raw stat ids
  (Life=Vitality, Poison=Acid, `offensiveSlow*` DoTs fold into their damage
  family). The `pet` family is the source predicate `source = 'pet_bonus'`.
- `attack-speed.json` - APS = tier base (`characterBaseAttackSpeedTag`) + the
  record's own `characterBaseAttackSpeed` offset; `characterAttackSpeedModifier`
  is the separate "+N% Attack Speed" stat. VeryFast (1.95) and VerySlow (1.65)
  are pinned by card oracles; the middle tiers are interpolated (BACKLOG).
- `variance.json` - the roll-range rule: jitter 20%, inward rounding
  (`display_low = ceil(base*0.8)`, `display_high = floor(base*1.2)`), affix
  stats use their own `lootRandomizerJitter`, plus the exemption vocabulary
  (weapon damage lines, block, chances, durations, skill/mastery bonuses,
  light radius, experience, energy regen, and all augment/component/relic
  stats). Calibration evidence and the one known gap live in the file itself.
- `factions.json` - the `factionSource`-value-to-`tagFaction*` tag map (14
  rows at build 24346246, following the game's own `tagFaction<value>` tag
  convention, kept explicit so new factions are reviewed) plus
  `unsold_augments`, the pinned list of faction-sourced augments no vendor
  sells (8 dev template blanks and 2 dev sandbox runes).

Drift guards run at the top of `just derive` and fail the build loudly:
unknown `records/items/*` category, unknown `Class` in a scoped category,
stat-family id absent from the deposit, unknown attack-speed tier, unmapped
`factionSource` value, and any drift between `unsold_augments` and the
augments the vendor chain actually leaves uncovered. A game patch that grows
the vocabulary breaks the build by design; update the curation file
deliberately and re-run.

## Computed requirements

Precedence per record: positive literal keys win (`levelRequirement`;
`strengthRequirement`/`dexterityRequirement`/`intelligenceRequirement` map to
physique/cunning/spirit - at build 24346246 no in-scope record carries a
positive attribute literal, so in practice the formulas decide); otherwise the record's
`itemCostName` formula record (default `records/game/itemcostformulas.dbr`)
supplies per-gear-kind equations (`daggerIntelligenceEquation`, ...)
evaluated over `itemLevel` and `totalAttCount` with an AST-whitelisted
evaluator (`^` = power, case-insensitive names, never `eval`). Results round
half-up. Required player level falls back to `itemLevel` when no literal
exists (every supplied card shows them equal). `totalAttCount` counts the
record's non-zero unified stat groups plus skill/mastery augment entries -
granted skills do not count (pinned exactly by Avatar of Mercy 267 vs Avatar
of Order 270). The gold-cost equations' extra variables (`damageAvgBase`,
`shieldBlock*`, ...) never appear in requirement equations, so no damage
derivations are needed.

Nine card oracles lock all of this end to end (`just q-ae4-requirement-oracles`):
Sacrificial Knife 74/93, The Guillotine 426, Meat Shield and The Final Stop
both 508, Bramblevine 566, Avatar of Mercy 267, Avatar of Order 270, and
Wilhelm's Wondrous Wargem level 1 / spirit 1.

## Expansion attribution

`labels.parquet` v2 records each tag's earliest defining tag file (`source`);
an entity's expansion is that file's layer for its name tag: `tags_*` = base,
`tagsgdx1_*` = Ashes of Malmouth, `tagsgdx2_*` = Forgotten Gods (any gdx file
counts, so FG keystone blueprints and storyelements-named MIs attribute
correctly). Tags absent from the English labels default to base and are
counted in the `expansion_defaulted` diagnostic.

## Regeneration and acceptance

- `just derive` - rebuild `data/derived/` from the deposit + curation (runs
  the drift guards, prints per-domain counts, diagnostics, artifact sizes)
- `just q "SQL"` - ad-hoc SQL; the derived views (`entities`, `stats`,
  `relations`, `families`, `sources`, `boosts`, `conversions`, `skill_effect`,
  `skills`, `skill_ranks`, `pet_ranks`, `skill_modifiers`) register alongside
  `facts`/`labels`/`meta`
- `just q-ae-all` - the sixteen acceptance recipes (AE1-AE16). Each gates its
  output on pinned oracle checks, so zero rows AND oracle drift both fail;
  after a game patch, expect count pins (97 ring/amulet augments, 14 legendary
  2h axes, 284 vendor-sourced augments) to fail until re-checked against
  grimtools and re-pinned.
- `just clean-derived` - delete the artifacts

After a patch: `just extract` -> `just deposit` -> `just derive` ->
`just skill-items` -> `just i18n-tables` -> `just q-ae-all`.

`i18n-tables` must run after `skill-items`, not before: it reads
`data/skill-items.json` to collect the mastery, skill, pet and item name tags it
resolves into every locale table. Running it first builds all 13 tables from the
previous patch's dataset, so anything the patch added falls through to its raw
tag on the page in every language.

## Known gaps

- **Affix applicability** (which affixes roll on which gear) needs the
  weighted loot-table graph - the affix domain's gear-type buttons stay inert
  until then. Same graph resolves the 58 `blueprints_without_crafts`
  (random-gear blueprints whose `artifactName` is a dynamic loot table).
- **Scaled offensive bonus lines** display a wider, level-linked upside on
  grimtools than plain jitter reproduces (`variance.json` `known_gap`).
- **Middle attack-speed tiers** are interpolated pending card oracles.
- **Player-level pet scaling** is outside `pet_ranks`, which reports a pet at a
  summon RANK. A pet's base life, offensive and defensive ability come from its
  `characterAttributeEquations` bio record, written purely in `charLevel`, and 15
  of its 71 ability grants set their level to a `charLevel` equation (pet armor,
  the global damage adjuster) rather than a number. Neither moves with the
  summon's rank, so neither is evaluated at an invented level. Pet stats are also
  not folded into `stats.parquet`, so an item cannot be filtered by what its
  summoned pet does.
- **Unnamed records** (740 affixes without `lootRandomizerName`, 97 pure
  monster-equipment gear pieces, 5 blueprints) keep `group_key = record` and
  no display name; a UI filters them out by requiring a name label.
- **Proc trigger text** ("30% Chance on Block") is not modeled;
  `skillProcChance` is a stats row, the trigger type stays a facts join on
  the item's `itemSkillAutoController` record.
