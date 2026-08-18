# The /items/ skill item finder page

Status: design, awaiting review.
Supersedes the `### Page` section of
[2026-08-15-skill-item-finder-page-design.md](2026-08-15-skill-item-finder-page-design.md),
whose pipeline half shipped on `feat/skill-item-dataset`. Everything else in that
document stands.

Every number here is measured at game 1.3.0.7, steam build 24756825.

## What this page answers

"I am building this skill. Which items should I hunt, and what do they do to it?"

The dataset holds 315 skills in 146 node groups and 2,397 items. Per skill group the
median is 41 items: 12 that modify the skill's behaviour and 29 that only grant
levels. Cadence is the largest at 137 (35 and 102). Every group has at least three
items, so the page has no empty-result state to design for once a skill is picked.

## Decisions taken before this design

1. **One table, chip facets**, not a modifier section above a levels section. This
   matches the RR page idiom and keeps one sort state. The modifier/levels split is a
   chip facet, not a layout.
2. **Full game-card fidelity for effect text**, verified against grimtools. Not
   label-plus-value.
3. **One spec, phased**, with a single review gate at the end.

## No game access is required

All inputs are on disk and committed or pinned: `data/skill-items.json`,
`data/skill-icons.{png,json}`, `data/stat-item-tags.json`, the 13
`data/i18n/game.<locale>.json` tables, all 13 `extracted/text_*` trees, and
`data/deposit/*.parquet`. Only `just deposit` and the extraction half of
`just i18n-tables` need the game closed, and neither is needed here. Phase 2 splits
the extraction out of `i18n-tables` so even the tag-table rebuild stays offline.

## What the oracle found

Two silent errors were caught by reading real grimtools cards during design. Both
belong to this branch's established bug class: a plausible, incomplete result that
never throws.

**Damage-over-time records store damage per second; the card shows the total.**

| item | record | card |
| --- | --- | --- |
| Badge of the Crimson Company | `offensiveSlowBleedingMin 150`, `DurationMin 2` | 300 Bleeding Damage over 2 Seconds |
| Scarstone Memento | `offensiveSlowPoisonMin 80`, `DurationMin 5` | 400 Poison Damage over 5 Seconds |

Two independent confirmations across different damage types and durations. Rendering
the stored number understates every DoT line by its duration factor.

**Refresh lines carry a trigger and a target skill the pipeline drops.** The same
badge reads "25% Chance on Attack to reduce cooldown of Leap by 1 Second". The
qualifiers come from `refreshCooldownTrigger = AttackEnemy` and
`refreshCooldownSkill = records/skills/playerclass10/leap1.dbr`, both present in the
deposit and absent from the derived schema. Deposit-wide: `refreshCooldownTrigger` on
964 Skill_Modifier records, `refreshDurationTrigger` on 920, `refreshCooldownSkill` on
115, `refreshDurationSkill` on 61.

Note that the target skill is a different skill from the block the modifier sits on.
Code that assumes the refresh applies to the modified skill will mislabel 115 records.

**Most trigger values are the template default, not a selection.** 851 of the 964
`refreshCooldownTrigger` values are the complete 13-token enum
(`OnEquip;OnKill;LowHealth;LowMana;AttackEnemy;...`), which means the record made no
choice. Only 117 records name a real trigger, and just five distinct values occur:
`AttackEnemy` (63), `AttackEnemyCrit` (25), `Block` (12), `HitByEnemy` (11), `OnKill`
(6). `refreshDurationTrigger` is the same shape, 861 defaulted of 920. A reader that
trusts the field verbatim prints the whole enum onto the card. Any multi-token value
is treated as absent.

The game names each trigger with a numbered condition tag, and all five used values
have one: `AttackEnemy` is `tagRefreshSkillCondition07` ("Chance on Attack"),
`HitByEnemy` is 03, `AttackEnemyCrit` is 10, `Block` is 11, `OnKill` is 12. Twelve
condition tags exist against thirteen enum tokens; `CastDebuf` has no tag and is never
used alone, so the mapping is total over the data.

## Effect text: the model

The game composes a stat line from its own tag tables. We reproduce that composition
rather than invent wording, which is what makes the result localizable into all 13
locales for free.

Measured over the 287 distinct stats the payload uses:

- 253 resolve through `data/stat-item-tags.json` onto 190 distinct game tags. Several
  stats routinely share one tag, which is what section "Grouping stats into lines"
  below exists to resolve.
- 158 of those 190 tags embed their own value template, for example
  `DamageFire = "{%t0} Fire Damage"` and `tagCharAttackSpeed = "{%+.0f0}% Attack Speed"`.
  They cover 5,319 of the 7,821 stat occurrences.
- The other 32 tags are plain labels with no template (`CooldownTime = "Skill Recharge"`,
  `ManaCost = "Energy Cost"`), covering 2,101 occurrences, and need a composer chosen
  per group.
- The remaining 34 stats are declared non-display in `build_stat_item_tags.py`. Twelve
  of those are marked "composed into ..." and become real lines in phase 1: 281
  occurrences across 108 items. The other 22 are weapon-class requirement tokens and
  engine geometry the game genuinely never renders, and they stay excluded.

Eleven placeholder shapes appear across the tags currently in the narrowed tables:

```
{%.0f0} {%+.0f0} {%.1f0} {%+.1f0} {%d0} {%d1} {-%.0f0} {%.0f0%} {%t0} {%s1} {%s2}
```

`{%s1}` and `{%s2}` are the string arguments of
`tagDamageConversion = "{%.0f0}% {%s1} converted to {%s2}"`, already carried in the
payload as `from_tag` and `to_tag` on 795 entries. Most of the rest are numeric
formats differing in precision, forced sign, and negation.

The composed-line tags that phase 2 adds bring one more shape and overload an
existing one, so the formatter must handle both from the start:

```
tagSkillCooldownRefreshName = "{%t0} to reduce cooldown of {%s1} by {%.1f2} {%z3}"
tagSkillCooldownRefresh     = "{%t0} to reduce cooldown by {%.1f1} {%z2}"
tagSkillDurationRefresh     = "{%t0} to extend duration by {%.1f1} {%z2}"
tagRefreshSkillCondition07  = "{%d0}% Chance on Attack"
```

- **`{%t0}` is overloaded.** In `DamageFire` it is a numeric min-max range. In
  `tagSkillCooldownRefreshName` it is a nested text slot holding an already-rendered
  condition line. The formatter resolves an argument by its supplied type, not by the
  placeholder spelling, so a `Text` argument nests and a number pair ranges.
- **`{%zN}` is a pluralizing unit**, resolved to `tagSecond` or `tagSeconds` against
  the accompanying value. Both tags exist in every locale, so plural selection stays
  in the game's vocabulary rather than in our code.

The composers are game tags too, so they localize with everything else:

```
DamageSingleFormatTime      = " over {%.1f0} Seconds"
DamageRangeFormatTime       = " over {%.1f0}-{%.1f1} Seconds"
DamageFixedSingleFormatTime = " for {%.1f0} Seconds"
SkillSecondFormat           = "{%.1f0 Second %s1}"
SkillDistanceFormat         = "{%.1f0 Meter %s1}"
SkillCostFormat             = "{%.1f0 %s1}"
SkillPercentFormat          = "{%.0f0% %s1}"
SkillIntFormat              = "{%d0 %s1}"
```

Raw tag text carries the game's inline colour markup (`{^E}` normal, `{^H}` highlight).
It is stripped at table-build time, as the existing tables already do.

### Grouping stats into lines

A modifier block is a set of stats, not a set of lines: 32 percent of blocks contain
two or more stats that share one tag. Four rules cover them, applied in order.

1. **Damage over time.** `offensiveSlow<Type>Min` with `offensiveSlow<Type>DurationMin`
   becomes one line whose value is the product, suffixed with `DamageSingleFormatTime`.
   The largest family, about 400 collision instances across the 591 blocks. A block can
   collide more than once, so the four rules do not partition the 591 cleanly.
2. **Range.** `<X>Min` with `<X>Max` becomes one line through `{%t0}`. A lone `<X>Min`
   renders as a single value, which is the common case: min appears without max 1,715
   times against 80 paired.
3. **Refresh.** `refreshCooldownAmount` with `refreshCooldownChance`, plus the
   `refreshCooldownSkill` and `refreshCooldownTrigger` added in phase 1, compose one
   line. Same for the duration family.
4. **Conversion.** `conversionPercentage` and `conversionPercentage2` are two separate
   conversions on one item, each with its own `from_tag` and `to_tag`. They render as
   two lines. They are not a collision to merge, and a naive shared-tag merge would
   wrongly fuse them on 148 blocks.

Anything left over is one stat, one line.

### The 32 plain labels

Each needs a composer and a unit. The grouping is regular, and every row is verified
against a grimtools card before it is trusted:

| group | composer |
| --- | --- |
| `DamageDuration*` (11 tags, about 1,100 occurrences) | rule 1 above |
| label already starting with `%` ("% Slow target") | value prefix, no composer |
| `CooldownTime`, `ActiveDuration`, `ComboChargeDuration`, `SkillChargeDuration` | `SkillSecondFormat` |
| `TargetRadius`, `ExplosionRadius` | `SkillDistanceFormat` |
| `ManaCost` | `SkillCostFormat` |
| `ComboChargeLevels` | `SkillIntFormat` |
| remainder | value prefix |

The table is data in the source, one row per tag with the grimtools card that pins it
named in a comment. A tag reaching the formatter without a row fails the build rather
than guessing, following the `NON_DISPLAY` precedent.

### Localization

The formatter returns `Text` descriptors, never strings, per the project invariant. It
needs one new descriptor kind in `web/src/core/localization.ts`:

```ts
| { k: "gameFormat"; tag: string; args: (string | number | Text)[] }
```

`resolveText` looks the tag up in the active locale's table and substitutes the
placeholders. This is what makes a Czech reader see the Czech template with the same
numbers, rather than an English sentence with translated nouns. Adding a kind touches
shared core, so `i18nBoundary.test.ts` and `appCatalog.test.ts` both need to know
about it.

## Architecture

`/items/`, at `web/src/items/`, hexagonal and following `web/src/rr/` closely. The RR
page is 1,615 lines including 534 of CSS; the monster explorer is 1,376 including 407.
This page is larger because of the tree picker.

```
web/src/items/
  core/
    model.ts        parse skill-items.json into camelCase; pure, tolerant
    effectText.ts   the formatter above; pure, i18n-free
    filter.ts       filter + sort over items for a ViewState
    facets.ts       the ordered facet lists, single source of truth
    urlState.ts     encode/decode the hash
  adapters/
    dataSource.ts   fetch the payload
    treeView.ts     the skill picker (SVG)
    tableView.ts    the result table and chips
    detailView.ts   expanded item row
  app/main.ts
  items.css
```

`effectText.ts` is the only novel component. Everything else has a working sibling to
follow.

## The page

**Skill picker.** An SVG tree per mastery, rendered from `ui_x`/`ui_y` and the sprite
sheet. Layout data is clean: 311 of 315 skills are positioned, there are zero position
collisions, and every mastery occupies the same box (x 246-886, y 39-459), so one fixed
viewBox serves all ten. Base skills draw as squares, modifiers and transmuters as
circles to their right, which makes the node group visible without explaining it.
Icons come from `data/skill-icons.png`, a 32-pixel cell grid 26 columns wide indexed by
`data/skill-icons.json`; all 315 skill icons are present in the sheet.

The four unpositioned skills are the Fangs of Asterkarn shapeshift abilities
(Werewolf and Wereraven forms). They are genuinely off-tree, granted by the transform
skill rather than placed on it, and render in a labelled strip below the tree.

**Selection model.** Choosing a mastery shows every item touching any skill in that
mastery, which answers "what should a Soldier hunt". Choosing a skill narrows to that
node group. With nothing chosen the page shows the ten masteries and an empty table.

**Table.** One row per item, columns: name, slot, rarity, item level, levels granted
to the selected scope, and effect. The effect cell renders the formatted lines for the
selected skill only. Clicking a row expands it to every skill the item touches, plus
its grimtools link.

**Facets.** OR within a group, AND across groups, matching the Vault Zero shape.

| group | behaviour |
| --- | --- |
| mastery | single select |
| skill node group | single select within the chosen mastery |
| effect kind (modifies / grants levels) | multi, all on |
| slot | multi, all on |
| rarity | multi, all on |
| domain (gear, relic) | multi, all on |
| mastery-wide boosts | toggle, off by default |
| text search | free text, ANDed |
| sort key and direction | |

Two corrections against the 2026-08-15 sketch. The domain facet has two values, not
three: augments were excluded from the dataset, so offering an augment chip would
promise data that does not exist. Rarity is added because the distribution demands it
(1,004 Legendary, 729 Epic, 623 Rare, 41 Common) and it is the first thing a player
filters on. Mastery-wide boosts stay off by default because 651 items carry them and
they apply to every skill in the mastery, so they would swamp a skill-specific list.

**Pets.** Twenty skills carry a pet block, 743 stat rows. Pet stats describe the
summon, not the item, so they render in a collapsible panel on the selected skill's
header rather than in the item table. 579 of the 743 rows have no source name; they
are the pet's own stat sheet, largely crowd-control immunity plumbing, and render
under the pet's name with no source attribution.

## URL state

Everything above lives in the hash through `web/src/items/core/urlState.ts`, reusing
`web/src/core/hashCodec.ts` for the multi-selects. Three rules, unchanged from the
earlier sketch:

- Ids are record-derived and language independent, never display names, so a shared
  link resolves identically in any locale.
- Decode is tolerant. An unknown skill or mastery id falls back to no selection rather
  than throwing; unknown slot, rarity, or domain tokens are dropped.
- A group at its default encodes as absent, so a bare `/items/` link stays short.

## Phases

**Phase 1, pipeline.** Carry `refreshCooldownSkill`, `refreshCooldownTrigger`,
`refreshDurationSkill`, `refreshDurationTrigger`, and `refreshDurationMax` through
`build_derived.py` into `skill_modifiers.parquet`, and emit them on the modifier stat
entries in `build_skill_items.py`. Move the twelve "composed into" ids out of
`NON_DISPLAY` and give them tags. Add acceptance queries under
`scripts/derived_queries/`, each proved non-vacuous by breaking the code and watching
it fail. Regenerates `data/skill-items.json` from the pinned deposit, no game needed.

**Phase 2, tag tables.** Split `i18n-tables` into extraction and table build so the
build can run against the existing `extracted/text_*` trees without the game closed.
The extraction half keeps `_require-game-closed`. Widen the tag selection in
`build_game_tables.py` to include the composer tags and the composed-line tags.
Rebuild all 13 locales. Re-run `scripts/test_dataset_i18n_fresh.py`.

**Phase 3, formatter.** `web/src/items/core/effectText.ts` plus the new `gameFormat`
descriptor kind. Test-first against pinned grimtools cards. This phase carries the
risk; nothing downstream should start before its oracles pass.

**Phase 4, page core.** `model`, `filter`, `facets`, `urlState`, `dataSource`,
`tableView`, `detailView`, `app/main.ts`. Unit tests for filter and a urlState
round-trip including a stale link.

**Phase 5, tree picker and pets.** `treeView.ts`, the off-tree strip, the pet panel.

**Phase 6, finishing.** `items.css`, `web/e2e/items-smoke.ts` added to `just e2e`, the
app menu entry, `docs/` updates, and the `/items/` entry in the page catalogue.

## Testing

- Pinned grimtools oracles for the formatter, each naming the item and the card line
  it reproduces. Minimum coverage: a DoT with duration, a min-max range, a conversion,
  a refresh line with a cross-skill target, a plain label from each composer group.
- Unit tests for `filter` and a `urlState` round-trip with a stale-link case.
- The existing `i18nBoundary` and `appCatalog` guards apply automatically. Every
  user-facing string is a catalog key or a game tag.
- `web/e2e/items-smoke.ts`, added to `just e2e`.
- Drift guards in `just derive`: a stat tag reaching the formatter with no composer
  row, and a refresh record whose target skill does not resolve.

## Known gaps carried, not closed

- **Scaled offensive bonus lines.** Chosen Visage's card reads +40/+60% Fire Damage
  where the jitter rule yields 29/43. Recorded in `variance.json` under
  `calibration.known_gap` and affecting any percentage damage line.
- **Item source.** Not modelled; the grimtools link stands in, and it pins by name plus
  item level rather than by id, so it is a "find this item" link and not always unique.
- **Affixes.** 1,264 affix families carry skill bonuses and stay excluded until the
  loot graph can say which gear they roll on.
- **Item-level roll ranges.** Grimtools shows two numbers per affix line (+70/+103%);
  the dataset carries the single modifier value. Skill modifier lines are fixed, so
  this does not affect the effect column, but it will look different from a card
  viewed side by side.
