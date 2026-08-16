# Skill item finder page: design

Status: designed 2026-08-15
Date: 2026-08-15
Game version at design: 1.3.0.7

Ship `/items/`, a fourth page alongside the planner, the resistance-reduction
reference, and the monster explorer. It answers one question: which items in the
game affect this skill, and is chasing them worth it.

A build picks a mastery and puts points into a subset of its skills. Many items
raise a skill's rank, and some also attach extra stats to that specific skill.
The reference case is Chosen Visage, a rare helmet giving `+4 to Flame Touched`
and `+4 to Summon Hellhound`, plus a distinct stat block under each. Today
nothing in this repo surfaces that relationship, and grimtools only shows it one
item at a time.

## Scope decisions

Ratified with Ted during design:

- **One mastery and one skill at a time.** Not two masteries with multi-select
  skills. The narrower model makes the skill-detail panel coherent (it has a
  single subject) and matches the question actually being asked: show me every
  item that touches Summon Hellhound.
- **Match on the node group, not the bare skill.** Selecting a base skill
  selects it together with its modifier and transmuter nodes, all toggleable
  individually and all on by default, so the grouping is visible in the UI
  rather than implied. Items granting mastery-wide bonuses sit behind an
  off-by-default toggle.
- **Domains: gear, relic, augment.** Affixes are excluded. All three included
  domains carry either a slot or an `applies_to` gear-type edge, so the slot
  facet is meaningful on every row. Affixes carry neither, and affix-to-gear
  applicability is the loot-graph gap tracked as roadmap step 3 in BACKLOG.
- **Top tier per family only.** The page targets endgame, so each `group_key`
  contributes its highest item level. Chosen Visage's ladder is 20/40/55/70/84/94
  and the page shows the 94. The ladder renders as a subtle line using the item
  CLI's honest convention: real item levels, never the words "Empowered" or
  "Mythical", which the data does not carry.
- **Skill icons are in scope.** Extraction and decoding are both cheap (below).
- **Item source is out of scope.** Every row carries a grimtools link instead.
  Source is only 7.8% populated for gear, so answering "where does this drop"
  honestly waits on the loot-graph walk.

## Feasibility: what the game data already holds

Every finding below was verified against `records/items/gearhead/b201f_head.dbr`,
the item level 94 tier of Chosen Visage, and reproduces its in-game card.

| Card element | Source | Already derived |
| --- | --- | --- |
| `+4 to Flame Touched` | `augmentSkillName<N>` / `augmentSkillLevel<N>` | yes, `boosts.parquet` |
| The nested per-skill stat block | `modifiedSkillName<N>` paired with `modifierSkillName<N>` | no |
| `Bonus to All Pets` | `petBonusName` | yes, `stats.source = 'pet_bonus'` |
| Skill to mastery membership | `records/skills/playerclassNN/_classtree_classNN.dbr` | no |
| Skill tree position and node shape | `records/ui/skills/classNN/skill*.dbr` | no |
| What a skill does at each rank | `;`-separated arrays on the skill record | no |
| Player-investable and hard caps | `skillMaxLevel`, `skillUltimateLevel` | no |

Nothing requires a new game export beyond the icons. Scale at build 24756825:
6,191 modifier pairs across 3,362 item records; 2,406 top-tier items across the
three in-scope domains, carrying 7,456 boost rows, 1,896 modifier rows, and
27,485 stat rows. 20 of the 315 skills are pet summons.

### The link-walking resolver

Skill records are frequently thin shells. `augmentSkillName1` on Chosen Visage
points at `playerclass02/blastshield1.dbr`, which holds four keys and no display
name; "Flame Touched" lives one `buffSkillName` hop away in
`blastshield1_buff.dbr` along with its icon, caps, and rank arrays.

**The walk is iterative, not a fixed sequence of steps.** From a starting
record, follow either `buffSkillName` or `petSkillName` repeatedly until a
record carrying `skillDisplayName` is reached. Chains genuinely mix the two:
six pet-modifier nodes go `petSkillName` and then `buffSkillName`, so an
ordered direct-then-buff-then-pet rule leaves them unresolved. Cap the depth
and guard against cycles rather than trusting the data to terminate.

Measured at build 24756825, the walk names **every** target it is pointed at:

| starting set | resolved | direct | one hop | two hops |
| --- | --- | --- | --- | --- |
| the 315 mastery skills | 315 of 315 | 266 | 43 | 6 |
| the 272 distinct skill-boost targets | 272 of 272 | 223 | 43 | 6 |

Maximum observed depth is 2. No chain requires more.

`docs/item-cli.md` currently asserts that 46 boost targets are "genuinely
nameless (hidden buff-carrier records carrying no `skillDisplayName` fact at
all)" and that deriving a name "would assert one the game does not have". That
claim is wrong. Its own cited example, `playerclass01/cadence3.dbr`, carries a
`buffSkillName` pointing at a named record. Correct that doc when this work
lands.

Modifier stats are reached by walking the same links, but the two walks are NOT
the same function and must not be shared. Chosen Visage's `modifierSkillName2`
is a `SkillSecondary_PetModifier` shell whose `petSkillName` reaches
`playerclass03/pets/modifier_head_b201_summonhellhound.dbr`, holding exactly
`offensiveFireMin 200` and `offensiveCritDamageModifier 18`, which is the card's
Summon Hellhound block.

**The two walks stop on different conditions, because they answer different
questions.** Naming stops at a record carrying `skillDisplayName`. Stat-reading
stops at the first record carrying a non-zero numeric stat. That distinction is
load-bearing: anonymous carrier records like the one above hold real numbers and
no name at all, so a name-gated walk stops short and the block silently
disappears rather than coming back wrong. Measured, reusing the naming walk for
stats drops every modifier stat for 203 in-scope items, including half of the
reference card.

### Roster from the class tree, layout from the UI records

The two sources answer different questions and only one of them is
authoritative.

**Roster: `records/skills/playerclassNN/_classtree_classNN.dbr`.** 325 distinct
entries across the ten masteries, of which 10 are the mastery bars themselves
(`_classtraining_classNN`), leaving **315 skills**. Every entry resolves to a
record that exists.

**Layout: `records/ui/skills/classNN/skill*.dbr`.** 314 buttons carrying
`bitmapPositionX` / `bitmapPositionY` and `isCircular` (107 base, 207 modifier
or transmuter). Join these onto the roster for tree position and node shape.

Two traps, both of which silently corrupt counts:

- **Scope the glob precisely.** `records/ui/skills/` also holds `classcommon`,
  `classselection`, `devotion`, `hiddendevskills`, and `skillselectwheel`. A
  `class%` pattern sweeps up the first two. Match `class01` through `class10`,
  and the `skill*` filename prefix within them, or page chrome (`classtable`,
  `classimage`, `classtrainingbar`) lands in the node set.
- **The UI carries dangling references; the class tree does not.** Three UI
  buttons name records with zero facts in the tree (for example
  `playerclass03/bloodofdreeg1b.dbr`). `_classtree` correctly omits those, so
  it is the superset and the UI adds nothing to the roster. Filter any UI-side
  node to records that actually exist.

311 skills therefore have a tree button. The remaining 4 are `playerclass10`
transform abilities (Wereraven and Werewolf forms) that are granted by the form
rather than allocated, so having no button is correct. Render them outside the
tree grid rather than dropping them, since items do boost them.

### Grouping: the name tag is the key

The game encodes the node group in the skill's own display-name tag:
`tagClass<NN>SkillName<GG><L>`, where `GG` numbers the group and the trailing
letter `L` identifies the member. Dreeg's Evil Eye is `tagClass03SkillName11A`
and its four modifier and transmuter nodes are `11B` through `11E`; Summon
Hellhound is `tagClass03SkillName02A` with its three pet modifiers at `02B`,
`02C`, `02D`.

- **Group key** = the tag with its trailing letter removed.
- **Base skill** = the member whose tag ends in `A`.

Measured at build 24756825 this yields 142 groups over 311 skills, and **every
group has exactly one `A` member**: none has two, none has zero. The remaining 4
skills are the `playerclass10` transform abilities, whose tags do not match the
pattern; each stands alone as its own group.

Two rules that look plausible and both fail, recorded so they are not retried:

- **Record stem** (`pox1b` belongs to `pox1`) breaks on 55 of 315 skills. Many
  base skills carry no digit at all (`shadowstrike.dbr`), some groups have an
  unnumbered base with numbered children (`arcanemissile` with
  `arcanemissile2/3/4`), and worst, it silently merges `passive01` through
  `passive04`, which are four separate Arcanist skills, into one group.
- **UI geometry** (walk a row by `bitmapPositionX`, each `isCircular = 0` opens a
  group) leaves 80 of 207 modifier nodes with no base to their left on the same
  row. The offset transmuters are genuinely ambiguous: `evileye1b` and `pox1b`
  both sit at y=211, 32 below `evileye1` at y=179 and 38 above `pox1` at y=249.

`isCircular` remains the right signal for **node shape** when drawing the tree
(square versus circle), which is a display concern and independent of grouping.
Note the two do not coincide: there are 142 groups but only 107 `isCircular = 0`
nodes, so a group's base is not always drawn as a square.

### The three breakpoints

Every stat on a skill record is a `;`-separated array, one entry per rank. The
panel reports three columns:

| | first point | point max | fully maxed |
| --- | --- | --- | --- |
| index | rank 1 | `skillMaxLevel` | `skillUltimateLevel` |

Verified on Flame Touched (12/22): Fire Damage runs +10% / +100% / +210%,
Offensive Ability 12 / 133 / 220, flat Fire Damage 5 / 33 / 76, Energy Reserved
75 / 185 / 285. These match the game.

The two gaps are the two decisions a player makes. First-to-max answers "is this
worth points"; max-to-ultimate answers "is this worth chasing +skill gear",
which is exactly what a `+4` buys.

Two display constraints. `skillMaxLevel` is per skill, not a constant (Flame
Touched 12/22, Summon Hellhound 16/26, several 10/20), so column headers are
per-skill. Transmuters and some modifier nodes cap at 1, where all three columns
collapse and the panel shows a single value instead of three identical ones.

**Array lengths are not uniformly `skillUltimateLevel`.** Of the 1,370 numeric
stat arrays on the roster's effect records, 1,353 match, 9 are shorter and 8 are
longer (`arcaneseal1` carries a 26-entry `skillManaCost` against an ultimate of
22). The emitter must clamp to the array's own length and emit a diagnostic
counting mismatches, so a patch that changes the shape is visible instead of
silently producing a wrong number.

Count only NUMERIC arrays. Skill records also carry semicolon-separated lists of
record paths and effect names (`spawnObjects`, `fxChanges`, `petChanges`,
`skillConnectionOn`), whose lengths have nothing to do with rank counts.
Including them inflates the mismatch count roughly sixfold and makes the
diagnostic meaningless as a drift signal.

### Icons

`resources/UI.arc` holds them at `ui/skills/icons/classNN/skillicon_*.tex`,
extracted by the same ArchiveTool invocation `just extract` already uses for
`Text_EN.arc`. Base `Menu.arc` is a 2 KB stub with zero entries and is not the
source. The extracted path keeps the `ui/` prefix, so it is byte-identical to
the `skillUpBitmapName` value on the skill record and the two join directly.

**Layer the expansion archives.** Base `resources/UI.arc` carries class01
through class06 only. Inquisitor, Necromancer, Oathkeeper and Berserker icons
ship in `gdx1/`, `gdx2/` and `gdx3/` `resources/UI.arc`, discovered by the same
`gdx*` convention `just extract` already uses. Without layering, four masteries
have no icons at all.

A `.tex` is a 12-byte wrapper around a DDS whose 4-byte magic reads `DDSR`.
Strip the wrapper, replace the magic with `DDS `, and the standard 124-byte
header follows. Every icon is 32x32 and uncompressed, with all four channel
masks set to zero, which is why Pillow's DDS plugin decodes them to solid black.
Decoding the bytes directly as BGR(A) produces the correct image; this was
verified end to end on `skillicon_hellhoundsummon1up.tex`.

**Two pixel formats, both required.** Of the 671 `*up.tex` skill icons
(excluding the `_red` variants), 533 are 32-bit BGRA and 138 are 24-bit BGR with
no alpha. The 24-bit set includes real mastery skills, among them
`class03/skillicon_curse1up.tex` (Curse of Frailty) and
`skillicon_possession1up.tex`, so a decoder that accepts only 32-bit hard-fails
the build on ordinary skills. Treat 24-bit as fully opaque. Anything that is
neither, in particular a block-compressed icon, must fail loudly rather than be
guessed at.

All 315 skills resolve an icon, drawn from 277 distinct files (a base skill and
one of its modifier nodes sometimes share one). The sprite sheet carries all 671
regardless: the surplus is item, rune, potion and shrine skill icons, which cost
almost nothing at 32x32 and spare the page a missing-icon failure if a skill
outside the mastery trees is ever displayed.

## Approach

Extend `just derive` with the skill tables, then emit the page's dataset from
them.

Rejected alternatives:

- **Page-local parser straight to JSON** (the `parse_monsters.py` shape) ships
  faster but strands the link-walking resolver, node grouping, and pet-chain walk
  in a page-specific script. All three are generally useful to `gditems.py` and
  to any future item page.
- **DuckDB-WASM over the released parquet** would force the unresolved
  facet-bitmaps versus DuckDB bake-off, conflict with the self-contained deploy
  ethos, and spend the first-load byte budget, all to serve one narrow page.
  That engine choice deserves its own spec.

### Pipeline

**1. `just skill-icons`** (new, Windows-only like `just extract`). ArchiveTool
over `UI.arc` for `skills/icons/**`, decode per above, pack one committed sprite
sheet plus a coordinate index.

**2. `just derive` gains three tables** in `data/derived/`, never committed,
released with the rest.

| table | shape |
| --- | --- |
| `skills.parquet` | one row per skill in the class-tree roster (315). `record`, `mastery_record`, `group_record` (the base skill it hangs under), `node_kind` (base / modifier / transmuter / pet_modifier), `ui_x` / `ui_y` (null for the 4 transform abilities with no button), `name_tag`, `icon`, `max_level`, `ultimate_level`, `effect_record` (the walk-resolved record carrying the stats) |
| `skill_ranks.parquet` | `(skill_record, stat_id, at_first, at_max, at_ultimate)`, each clamped to the array's real length |
| `skill_modifiers.parquet` | `(item_record, modified_skill, modifier_record, stat_id, value)`, stats resolved by the same walk |
| `pet_ranks.parquet` | `(skill_record, pet_record, source_kind, source_record, stat_id, at_first, at_max, at_ultimate)`, the pet chain for the 20 pet summon skills |

The pet-chain walk (`spawnObjects` to the per-rank pet record, then to that
creature's `defensive*`/`character*` stats and to the `petskill_*` abilities it
grants at the rank the creature record names) feeds its OWN table, `pet_ranks`,
not `skill_ranks`. It has to: one summon routinely has two sources naming the
same stat, so `skill_ranks`' `(skill_record, stat_id)` key would collide them,
and a pet's damage is not the player's stat line. The 17 summons carrying
`spawnObjects` are joined by the 3 nodes that swap the pet outright
(`modSpawnObjects`), which are one-rank nodes indexed by their group base's rank.
Those three are `node_kind = 'modifier'`, not `'pet_modifier'`, despite one of
them being named `stormtotem01b_petmodifier`; none of the 22 `pet_modifier` rows
reaches `pet_ranks`, so filtering on that kind returns a disjoint set.

An ability named on the creature record is frequently a shell carrying only a
`buffSkillName`, so this walk is stat-gated (stop at the first record carrying a
rank-scaling stat), never name-gated. Name-gating it silently cost Wind Devil,
Thermite Mine, Wendigo Totem and Inquisitor Seal every damage number they have.

Without this a summon's panel is its mana cost and cooldown and nothing else:
Summon Hellhound's own record has four rank rows and the pet chain adds 25.

Two pieces stay outside it and stay tracked in BACKLOG: the pet's base life,
offensive and defensive ability come from a `characterAttributeEquations` record
written in `charLevel`, and pet stats are not folded into the filterable
`stats.parquet`. Numbers stay caveated in the UI for a third reason: pet damage
also scales off the player's pet bonuses, so a static maxed value is an upper
reference, not a prediction.

**3. `just skill-items`** emits two committed files from the derived tables
joined to `entities`, `stats` and `boosts`, top tier per `group_key`:

| file | contents | raw | gzipped |
| --- | --- | --- | --- |
| `data/skill-items.json` | meta, masteries, skills with their rank breakpoints, and items without stats | 2.78 MB | 242 KB |
| `data/skill-items-stats.json` | `{"stats": {"<item record>": [...]}}`, keyed by item record | 3.11 MB | 125 KB |

**Item stats live in a second file, fetched only when a row is expanded.** The
table view needs name, slot, boosts, modifiers and tiers; the per-item stat rows
were most of the payload and none of the first paint. An earlier single-file
design put everything in one document and came out at 5.9 MB, five times the
estimate, so the split is what keeps first load at 242 KB.

Four correctness rules the emitter must hold, all of which were violated by an
earlier revision and are easy to get wrong again:

- **Grimtools links carry the English item name, not the tag.** grimtools
  matches on the real name, so passing `name_tag` produces a well-formed link
  that finds nothing. Resolve the English label locally through
  `labels` at `locale = 'en'`, purely to build the URL. This does not breach the
  i18n invariant: the dataset still stores tags for display, and only the
  outbound URL string carries English, which is unavoidable because grimtools
  understands nothing else. An item with no resolvable name gets no link at all
  rather than a degenerate one that matches everything.
- **Top-tier selection needs a total order.** About 97 families have two records
  tied at the winning item level, typically an Awakened variant against a plain
  one sharing a name tag. Order by item level, then rarity descending, then
  record path, so the higher-rarity variant wins on an endgame-focused page and
  the committed output is reproducible across runs.
- **A modifier stat is identified by its carrier as well as its skill.** One item
  can attach two carrier records to the same skill and both can name the same
  stat: Bloodlord's Blade gives Possession `skillCooldownReduction` 100 on the
  chance-gated reset carrier and 5 on the flat one, two real card lines. Neither
  may be dropped or summed, and the carrier belongs in the sort key, or the two
  rows come out in an order the query never fixed and the committed file churns
  between runs on unchanged input. A `conversionPercentage` row carries
  `from_type`/`to_type` alongside its value, since a conversion percentage with
  no damage types reads as a bare number.
- **The tier ladder is a list of distinct levels.** `tiers` is the family's rungs
  (20/40/55/70/84/94), not its records: 137 families hold more than one record at
  a level, typically an Awakened copy beside its plain one, and listing records
  repeats the rung.

The route is `/items/` but the dataset is `skill-items.json` deliberately: the
route is the durable public URL and is named broadly so the page can grow, while
the file name describes the narrow slice it actually contains. A later,
genuinely general item dataset should be a new file rather than a silent
redefinition of this one.

**4. `build_game_tables.py` gains `--skill-items`**, alongside the existing
`--devotions`, `--rr`, and `--monsters`, so skill and item name tags reach
`data/i18n/game.<locale>.json` for all 13 locales.

### Page

`/items/`, at `web/src/items/`, hexagonal (`core/`, `ports/` as needed,
`adapters/`, `app/main.ts`). The monster explorer is 969 lines across 11 files
and is the size reference.

The skill picker renders the actual in-game tree using `ui_x` / `ui_y` and the
extracted icons: base skills as squares, modifiers and transmuters as circles to
their right. This makes the node group visible without explaining it.

Facet model, matching the "Vault Zero" shape already recorded in BACKLOG (OR
within a group, AND across groups):

| group | behavior |
| --- | --- |
| mastery | single select |
| skill group | single select |
| nodes within the group | multi, all on by default |
| slot | multi, all on by default |
| domain (gear / relic / augment) | multi, all on by default |
| mastery-wide boosts | toggle, off by default |
| real modifier only, versus rank bonus only | toggle |
| text search | free text, ANDed |
| sort column and direction | |

### URL state

Every choice above lives in the hash, per the project invariant, through
`web/src/items/core/urlState.ts` reusing `web/src/core/hashCodec.ts` for the
multi-select groups. Three rules:

- Ids are record-derived and language independent. Never display names, so a
  shared link resolves identically in any locale.
- Decode is tolerant. An unknown skill or mastery id falls back to no selection
  rather than throwing; unknown slot or domain tokens are dropped.
- Groups at their default encode as absent, so a bare `/items/` link stays
  short and only deviations are carried.

## Testing

- Pure-core unit tests for `filter` and a `urlState` round-trip, including a
  stale-link case.
- The existing `i18nBoundary` and `appCatalog` guards apply automatically; every
  user-facing string is a catalog key.
- `web/e2e/items-smoke.ts`, added to `just e2e`.
- Python legs in `just test-scripts` for the link-walking resolver (including a
  two-hop `petSkillName` then `buffSkillName` chain and a cycle guard), the node
  grouping rule across all 10 masteries, and the array clamp.
- Drift guards in `just derive`, failing the build loudly: an unknown skill
  `Class` value, a node the grouping rule cannot place, a boost target the
  resolver cannot name, and the array-length mismatch count moving.
- Oracles, following the existing card-oracle pattern: Chosen Visage pinned end
  to end (both `+4` bonuses and both modifier blocks, including the pet hop
  producing 200 Fire and +18% crit), and the three breakpoints pinned for a
  handful of skills against grimtools, covering a non-pet skill, a pet skill,
  and a transmuter that caps at 1.

## Known gaps carried, not closed

- **Scaled offensive bonus lines.** Chosen Visage's card reads `+40/+60% Fire
  Damage` where the jitter rule yields 29/43. This is the level-linked upscale
  already recorded in `variance.json` under `calibration.known_gap`, and it
  affects any percentage damage line the page displays.
- **Item source.** Not modeled; the grimtools link stands in. The link pins by
  name plus item level and is not always unique (Obsidian War Cleaver repeats
  item level 30 within its own ladder), so it is a "find this item" link rather
  than a guaranteed single record.
- **Affixes.** 1,264 affix families carry skill bonuses and are excluded until
  the loot graph can say which gear they roll on.

## Prerequisite, completed

The whole pipeline was re-run and committed against 1.3.0.7 as a standalone
baseline (`chore(data): rebuild every committed dataset against game 1.3.0.7`)
before any of this work begins, so that patch drift cannot be confused with
drift caused by these changes. Two count pins moved and were re-pinned against
diffed evidence rather than blindly. Every number in this spec is measured at
build 24756825.

One follow-up is deliberately left open: `deposit.lock` still pins the
1.3.0.0 release, so `just fetch-deposit` on a machine without the game
installed still retrieves 1.3.0.0 parquet even though the committed datasets
are 1.3.0.7. Publishing a `deposit-24756825.1` release via
`just publish-deposit` closes that gap and should happen before the derive-side
work here is expected to reproduce on CI or another machine.
