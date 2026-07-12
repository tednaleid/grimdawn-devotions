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

The filter contract maps onto these directly: facet groups are predicates on
`entities` columns (domain, type, slot, rarity, level range, expansion),
semi-joins on `stats`+`families` (stat families, OR within a family) and
`relations` (applies-to, crafts, sets), and text search joins `labels` (active
locale with per-tag English fallback) over `name_tag`, `text_tag`, and the
granted skill's name/description tags. `scripts/derived_queries/` holds eight
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
- `factions.json` - the `factionSource`-value-to-`tagFaction*` tag map (13
  rows at build 19149150, following the game's own `tagFaction<value>` tag
  convention, kept explicit so new factions are reviewed) plus
  `unsold_augments`, the pinned list of faction-sourced augments no vendor
  sells (8 dev template blanks).

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
physique/cunning/spirit - no positive attribute literals exist at build
19149150, so in practice the formulas decide); otherwise the record's
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
  `relations`, `families`, `sources`) register alongside `facts`/`labels`/`meta`
- `just q-ae-all` - the eight acceptance recipes (AE1-AE8). Each gates its
  output on pinned oracle checks, so zero rows AND oracle drift both fail;
  after a game patch, expect count pins (97 ring/amulet augments, 14 legendary
  2h axes, 284 vendor-sourced augments) to fail until re-checked against
  grimtools and re-pinned.
- `just clean-derived` - delete the artifacts

After a patch: `just extract` -> `just i18n-tables` -> `just deposit` ->
`just derive` -> `just q-ae-all`.

## Known gaps

- **Affix applicability** (which affixes roll on which gear) needs the
  weighted loot-table graph - the affix domain's gear-type buttons stay inert
  until then. Same graph resolves the 58 `blueprints_without_crafts`
  (random-gear blueprints whose `artifactName` is a dynamic loot table).
- **Scaled offensive bonus lines** display a wider, level-linked upside on
  grimtools than plain jitter reproduces (`variance.json` `known_gap`).
- **Middle attack-speed tiers** are interpolated pending card oracles.
- **Pet-skill stats** are not rolled up; pet chains exist as `spawns_pet`
  relations only.
- **Unnamed records** (740 affixes without `lootRandomizerName`, 97 pure
  monster-equipment gear pieces, 5 blueprints) keep `group_key = record` and
  no display name; a UI filters them out by requiring a name label.
- **Proc trigger text** ("30% Chance on Block") is not modeled;
  `skillProcChance` is a stats row, the trigger type stays a facts join on
  the item's `itemSkillAutoController` record.
