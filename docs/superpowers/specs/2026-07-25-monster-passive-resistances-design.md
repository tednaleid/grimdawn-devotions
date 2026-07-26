# Monster passive resistance grants: design

Status: implemented 2026-07-25
Date: 2026-07-25
Game version at investigation: 1.3.0.0 (Fangs of Asterkarn)

Supersedes the "passive resistance grants are not modelled" known limitation in
[2026-07-24-monster-resistance-pipeline-design.md](2026-07-24-monster-resistance-pipeline-design.md).

## Goal

Fold the resistance a monster gains from its own skills into `data/monsters.json`,
so the dataset reports the resistance a player actually faces rather than the
inline record value alone.

## Why this is not optional

The v1 pipeline treated passive grants as a small, uniform understatement. That
was wrong, and the error is concentrated in one damage type.

**No creature record in the game carries a bleeding resistance field.** A search
across every record under `records/creatures/` returns zero matches for any
`defensive*Bleed*` field. The v1 dataset therefore reports bleeding resistance as
0 for all 1,637 logical monsters.

In the game, 592 monster records (about 20 percent) gain bleeding resistance from
a skill passive, at a median of 80 percent. The v1 dataset reports every one of
them as 0.

The consequence for the explorer page is direct: its centerpiece ranks damage
types by how little enemies resist them, so bleeding would always rank weakest
and the page's single most prominent answer would be false, against exactly the
bosses a player plans around. This work is a prerequisite for that page, not a
refinement of it.

## Investigation findings

Measured against the extracted 1.3.0.0 records. Counts run over the 3,023 creature
records that are `Class,Monster` with one of the six valid classifications. That is
a superset of the pipeline's 2,728 kept records, which additionally exclude
`hiddenFromCombat` (87), `invincible` (11), unnamed (6), and the devotion role (191).

### Passive contribution per resistance

Resolved at each monster's pinned skill level, counting only self-passive classes
(see "Class allowlist"):

| Type | inline >0 | passive >0 | passive only | stacks on inline | median add | max add |
| --- | --- | --- | --- | --- | --- | --- |
| Bleeding | 0 | 592 | 592 | 0 | 80 | 300 |
| Vitality | 1,234 | 134 | 35 | 99 | 30 | 500 |
| Pierce | 1,545 | 130 | 51 | 79 | 30 | 30 |
| Physical | 1,316 | 100 | 63 | 37 | 15 | 30 |
| Chaos | 666 | 78 | 47 | 31 | 20 | 50 |
| Cold | 1,071 | 76 | 27 | 49 | 1 | 25 |
| Poison & Acid | 765 | 56 | 23 | 33 | 6 | 100 |
| Fire | 1,044 | 25 | 10 | 15 | 14 | 32 |
| Aether | 792 | 21 | 7 | 14 | 6 | 25 |
| Lightning | 912 | 20 | 5 | 15 | 1 | 14 |

Every type is affected. For nine of them the passive is a modest correction on
100 or fewer monsters, but those monsters are disproportionately heroes and
bosses, which is where accuracy matters most. Bleeding is categorically
different: the passive is the entire signal.

These counts are raw-record counts over the 3,023-record superset described
above, not the shipped dataset's logical-row grain: the corresponding
logical-row counts are smaller once records collapse into logical monsters
(245 rows carry bleeding, 404 carry any resident grant).

"Stacks on inline" is the count of monsters where a passive adds to a nonzero
inline value, so the combination rule cannot simply be "use whichever is set".

### Records that grant resistance, by Class

401 records under `records/skills/nonplayerskills*` set at least one tracked
resistance above zero:

| Class | Records |
| --- | --- |
| Skill_Passive | 212 |
| Monster | 122 |
| SkillBuff_Passive | 33 |
| Turret | 18 |
| Skill_BuffSelfDuration | 7 |
| Skill_PassiveOnLifeBuffSelf | 3 |
| Skill_BuffSelfToggled | 2 |
| Skill_BuffAttackRadiusToggled | 1 |
| AttributePak | 1 |
| SpiritHost | 1 |
| PetPlayerScaling | 1 |

This mix is the reason a naive join would be wrong. The `Monster`, `Turret`,
`SpiritHost`, and `PetPlayerScaling` records are summoned-entity definitions that
happen to live under the skills tree. Crediting a summoner with its minion's
resistances would corrupt exactly the boss records this work exists to fix. The
lone `AttributePak` is a balancing record rather than a skill and is handled by
the unclassified rule below.

### The hero/boss passive is crowd control, not damage

`nonplayerskills/passive/resists_heroboss.dbr`, referenced widely by hero and boss
records, grants no damage resistance at all. It grants Disruption, Confusion,
Fear, Convert, Freeze, Stun, Taunt, Petrify, Sleep, Knockdown, Trap, Slow, Mana
Burn, reduction to current health, and leech resistances. The community wiki page
"Hero/Boss Resistances" documents this same record and confirms the reading.

An earlier note in the v1 spec described this record as a shared resistance grant
that understated hero and boss damage resistance. That description was incorrect
and this spec supersedes it.

### Validation against community values

Computed as inline plus passive at the pinned level:

| Monster | Computed | Community reported | Difference |
| --- | --- | --- | --- |
| Alkamos (`ghost_stepsoftorment_01`) | 100 bleeding | 118 | 18 |
| Kaisan, the Eldritch Scion | 45 bleeding | 63 | 18 |

Both differ by exactly 18, which is the Ultimate difficulty offset for bleeding
(the 1.3.0.0 table carries 9 at one player rising to 17 at four). Base plus
passive plus difficulty therefore reproduces community figures to within a point,
across two independent monsters, and the residual is version drift rather than a
modelling error.

Excluding the toggled and duration buff classes did not produce a shortfall in
either case, which is evidence that the exclusion is correct.

Community posts stating that Kaisan is the only nemesis above 18 bleeding
resistance are outdated. The 1.3.0.0 records give Death Revenant 100, Nyarlathon,
Vinn, and Reaper of Rot 51 each, and Obsidian Cluster (`obsidiandefiler_clustersummon`)
100 poison and 100 bleeding, not a uniform 500 across every type. Where the
extraction and a forum post disagree, the extraction is authoritative for the
installed version.

## Design

### Resolution rule

For each kept creature record, iterate `skillName{n}` and its pinned
`skillLevel{n}` sibling. Resolve the referenced record. When its `Class` is in the
allowlist below, read each tracked `defensive<Type>` field, select the entry at
the pinned level, and add it to that resistance.

Level selection reuses `gd_dbr.level_array_value`, which already implements this
exact rule for the RR pipeline: pick the entry at the 1-based level, clamped to
the final entry, never extrapolating past the array. A missing or unparseable
`skillLevel{n}` defaults to level 1.

Contributions are **additive**, both between multiple passives and on top of the
inline value. The validation above confirms addition, not maximum, reproduces
the community numbers.

### Class allowlist

Include, as the caster's own resident resistance:

- `Skill_Passive`
- `SkillBuff_Passive`
- `Skill_PassiveOnLifeBuffSelf`

Exclude as a summoned entity's own stats, not the summoner's:

- `Monster`, `Turret`, `SpiritHost`, `PetPlayerScaling`

Record separately, as conditional rather than resident:

- `Skill_BuffSelfDuration`, `Skill_BuffSelfToggled`, `Skill_BuffAttackRadiusToggled`

These are the 555 references measured in the data (`Skill_BuffAttackRadiusToggled`
217, `Skill_BuffSelfToggled` 173, `Skill_BuffSelfDuration` 165). Whether a
monster's toggled aura is "really" always active is a judgment call, so rather
than deciding it, the parser captures these into their own `aura_resistances`
field. They stay out of the headline total, remain available to the page as an
opt-in, and can be validated against community figures later. Capturing them as
data replaces a guess with a measurement.

Summoned-entity and unclassified references contribute nothing and are counted by
reason in the parser summary, so they are reported rather than silently dropped.

A `Class` that appears in neither list contributes nothing and is counted under
an "unclassified skill class" reason, so a future patch introducing a new class
surfaces in the summary instead of being silently ignored.

### The `buffSkillName` hop

Grim Dawn's dominant aura pattern is `Skill_BuffRadiusToggled` (or
`Skill_BuffOther`/`Skill_BuffAttackRadiusDuration` and similar host classes) ->
`buffSkillName` -> `SkillBuff_Passive`: the parent record carries no
`defensive<Type>` field of its own, and the grant lives one hop away on the
child it applies. A resolver that only reads the depth-1 record misses this
shape entirely.

When a depth-1 skill grants nothing inline, the resolver follows its
`buffSkillName` reference and resolves the child at the same pinned level.
Only a child classed as one of the resident allowlist classes above (in
practice `SkillBuff_Passive`) counts; the grant reached this way is recorded
as an **aura**, not resident, regardless of how the child itself is classed,
because reaching a grant through a host record makes it conditional on
whatever the host's own semantics are (toggled, radius, duration).

A sibling family, `SkillBuff_Debuf` (and its `SkillBuff_DebufFreeze` /
`SkillBuff_DebufTrap` / `SkillBuff_Contageous` relatives), is deliberately
excluded from the hop. Every measured reference in that family carries
**negative** `defensive<Type>` values: those are resistance-reduction debuffs
the monster applies to the player, not resistance the monster holds for
itself, and they belong to the resistance-reduction pipeline
(`scripts/parse_rr.py`), not here. Gating the hop on the child's `Class`
separates the two populations perfectly on current data (167 `SkillBuff_Passive`
references, all positive; 149+6+5+4 debuff-family references, all negative).

### Ordering

Passives resolve **per raw record, before the grain collapse**. The representative
record's combined total is what reaches the dataset, and `variants_disagree`
compares combined totals rather than inline values. This matters because two
variants of one monster can carry different skill loadouts.

### Data shape

`resistances` keeps all ten keys always present and becomes the **combined**
inline plus passive total. This is the value every consumer should use, and it
preserves the v1 contract that the explorer page was designed against.

Two new sparse objects carry provenance, each holding only nonzero entries and
omitted entirely when empty, so the roughly 80 percent of monsters with no grants
gain no bulk:

- `passive_resistances`: the resident contributions already folded into
  `resistances`. Present so a surprising total can be traced to its source.
- `aura_resistances`: the toggled and duration buff contributions, deliberately
  **not** included in `resistances`.

```json
{
  "id": "enemies.boss-quest.ghost_stepsoftorment_01",
  "name_tag": "tagGhostBoss05",
  "classification": "Quest",
  "resistances": {
    "physical": 15, "pierce": 25, "fire": 0, "cold": 25,
    "lightning": 0, "poison": 0, "aether": 0, "chaos": 0,
    "vitality": 40, "bleeding": 100
  },
  "passive_resistances": { "bleeding": 100 }
}
```

The difficulty offset stays separate and page-applied, exactly as in v1:
`effective = resistances + offset[difficulty][players]`.

### Summoned creatures stay in the dataset

Creatures that exist only as summons remain their own rows, unchanged from v1.
They are the enemy's adds, not the player's minions: Loghorrean's Dreadguards, a
nemesis's Ice Crystal, the Obsidian Cluster, and Mogdrogen's Briarthorn are all
things a player has to kill, so a resistance survey should cover them.

This was considered and rejected as an exclusion. A substring rule on "summon"
also matches "summoner" and would have deleted `cultist_summoner_01`, which is
Karroz, Sigil of Ch'thon, a real quest boss. A precise suffix rule avoids that
trap but still removes 24 rows of genuine adds, which is the wrong outcome.

`is_summon` remains a per-monster facet, so the page can offer summons as a
filter toggle rather than the dataset making the choice for every consumer.

## Testing

Extends `scripts/test_parse_monsters.py`, following its existing harness.

Pure unit tests:

- Level selection picks the pinned entry, clamps past the end of the array, and
  defaults to level 1 when `skillLevel{n}` is missing or unparseable.
- Each allowlisted class contributes to `resistances`; each summoned-entity class
  contributes nothing anywhere.
- Each aura or duration class populates `aura_resistances` and leaves
  `resistances` untouched.
- Contributions from two passives add together, and add on top of a nonzero
  inline value.
- An unknown `Class` contributes nothing and is counted.

Integration assertions against the real records:

- Alkamos (`enemies.boss-quest.ghost_stepsoftorment_01`) reports 100 bleeding.
- Kaisan reports 45 bleeding.
- Bleeding is no longer uniformly zero: the shipped test asserts a 150-400 band
  and the real figure is 245 logical rows. The 592 figure quoted earlier in
  this document counts raw records over the 3,023-record superset (before the
  hiddenFromCombat/invincible/unnamed/devotion exclusions); the pipeline keeps
  2,728 of those records, 544 of which individually carry nonzero bleeding,
  and those collapse to the 245 logical rows reported here.
- Valdaran keeps his v1 values plus the small passive contribution his record
  actually grants (1 each to lightning and aether), guarding against a change
  that would silently inflate every monster.
- No monster's `passive_resistances` or `aura_resistances` contains a
  zero-valued key, and neither key is present when empty.
- At least one monster carries `aura_resistances`, and its `resistances` does not
  include that contribution.
- Summoned creatures still appear as rows: the row count stays at the v1 value
  and Karroz (`tagBloodswornBoss02`) is present.

The numbers are data-derived and move on a game patch, so counts are asserted as
bands, matching how the v1 guards were written.

## Known limitations

- **Difficulty offsets are still page-applied**, so a value in the dataset is
  base plus passive and does not include the difficulty bonus. This is
  deliberate and unchanged from v1.
- **Aura and duration buffs are recorded but not counted.** They populate
  `aura_resistances` and stay out of `resistances`. A monster's toggled aura is
  plausibly always active in practice, so a consumer that wants the pessimistic
  view can add the two together. Neither validated monster showed a shortfall
  from leaving them out, which is why the headline total excludes them.
- **Skill grants follow one `buffSkillName` hop.** The resolver now follows a
  buff-hosting skill's `buffSkillName` reference one level deep (see "The
  `buffSkillName` hop" above) when the depth-1 record grants nothing itself.
  A chain longer than that (a passive whose child itself only grants through a
  further reference) is not followed. No evidence was found that monster
  resistance grants nest that deep, but it is not proven absent.
- **`SUMMON_CLASSES` is a guard that never fires on current data.** The
  `Monster`/`Turret`/`SpiritHost`/`PetPlayerScaling` exclusion exists to stop a
  summoned entity's own stats from crediting its summoner, but no creature
  record actually reaches one of those classes through `skillName{n}` on
  current data: summon definitions hang off spawn skills below the depth this
  resolver reaches. Kept as a guard against a future patch that changes that.
- **`SkillBuff_Passive` sits in the resident allowlist, but every instance that
  actually grants resistance on current data is reached through a toggled or
  radius host and is therefore recorded as an aura.** A future patch pointing
  a creature straight at a `SkillBuff_Passive` record via `skillName{n}` (no
  host in between) would fold that grant into the headline total instead of
  the aura bucket. Not currently observed, but the allowlist entry means it
  would happen silently if it started.
- **`Skill_PassiveOnLifeBuffSelf` is folded into the headline total although it
  is a low-life trigger**, which is arguably as conditional as a toggled aura
  (34 kept records grant resistance this way, for example `swampcrab_armorup`
  +25 physical and `beetle_goliathresilience` +30 physical). Whether it belongs
  in `resistances` or `aura_resistances` is unresolved, not decided.
- **Community figures are not a perfect oracle.** They lag the installed version;
  both validation monsters differed by the same 18-point difficulty offset. The
  fixtures pin our computed values, not the community ones.

## Impact on later phases

The explorer page (sub-project 2) is unblocked by this work and needs no design
change: it consumes `resistances` exactly as before, and those values are now
truthful. The page's bleeding row stops being degenerate, so the special-case
handling contemplated for it is no longer needed.

The v1 spec's known limitation "Passive resistance grants are not modelled" is
resolved by this work and should be struck when this ships.
