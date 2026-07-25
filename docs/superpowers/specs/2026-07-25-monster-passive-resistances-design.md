# Monster passive resistance grants: design

Status: approved, not yet implemented
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
| Alkamos (`ghost_stepsoftorment_03`) | 100 bleeding | 118 | 18 |
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
Vinn, and Reaper of Rot 51 each, and Obsidian Cluster 500 across every type.
Where the extraction and a forum post disagree, the extraction is authoritative
for the installed version.

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

Exclude as not permanently resident:

- `Skill_BuffSelfDuration`, `Skill_BuffSelfToggled`, `Skill_BuffAttackRadiusToggled`

Every excluded reference that carried a resistance is counted by reason and
printed in the parser summary. In the measured data that is 555 references
(`Skill_BuffAttackRadiusToggled` 217, `Skill_BuffSelfToggled` 173,
`Skill_BuffSelfDuration` 165). They are reported rather than silently dropped,
so the decision stays visible and reversible.

A `Class` that appears in neither list contributes nothing and is counted under
an "unclassified skill class" reason, so a future patch introducing a new class
surfaces in the summary instead of being silently ignored.

### Ordering

Passives resolve **per raw record, before the grain collapse**. The representative
record's combined total is what reaches the dataset, and `variants_disagree`
compares combined totals rather than inline values. This matters because two
variants of one monster can carry different skill loadouts.

### Data shape

`resistances` keeps all ten keys always present and becomes the **combined**
inline plus passive total. This is the value every consumer should use, and it
preserves the v1 contract that the explorer page was designed against.

A new sparse `passive_resistances` object carries only the nonzero passive
contributions, so a surprising number can be traced to its source without
inflating the roughly 80 percent of monsters that have no passive grant at all.
A monster with no contributions omits the key entirely.

```json
{
  "id": "enemies.boss-quest.ghost_stepsoftorment_03",
  "name_tag": "tagGhostBoss05",
  "classification": "Quest",
  "resistances": {
    "physical": 20, "pierce": 30, "fire": 0, "cold": 25,
    "lightning": 0, "poison": 0, "aether": 0, "chaos": 0,
    "vitality": 40, "bleeding": 100
  },
  "passive_resistances": { "bleeding": 100 }
}
```

The difficulty offset stays separate and page-applied, exactly as in v1:
`effective = resistances + offset[difficulty][players]`.

## Testing

Extends `scripts/test_parse_monsters.py`, following its existing harness.

Pure unit tests:

- Level selection picks the pinned entry, clamps past the end of the array, and
  defaults to level 1 when `skillLevel{n}` is missing or unparseable.
- Each allowlisted class contributes; each excluded class does not.
- Contributions from two passives add together, and add on top of a nonzero
  inline value.
- An unknown `Class` contributes nothing and is counted.

Integration assertions against the real records:

- Alkamos (`enemies.boss-quest.ghost_stepsoftorment_03`) reports 100 bleeding.
- Kaisan reports 45 bleeding.
- Bleeding is no longer uniformly zero: the count of monsters with nonzero
  bleeding is in a band around the measured 592 raw records.
- Valdaran keeps his v1 values plus the small passive contribution his record
  actually grants (1 each to lightning and aether), guarding against a change
  that would silently inflate every monster.
- No monster's `passive_resistances` contains a zero-valued key.

The numbers are data-derived and move on a game patch, so counts are asserted as
bands, matching how the v1 guards were written.

## Known limitations

- **Difficulty offsets are still page-applied**, so a value in the dataset is
  base plus passive and does not include the difficulty bonus. This is
  deliberate and unchanged from v1.
- **Toggled and aura buffs are excluded.** A monster's toggled aura is plausibly
  always active in practice, which would make this an understatement on the 555
  affected references. The two validated monsters showed no shortfall, so the
  exclusion is the better default, but it is a judgment call rather than a
  certainty. The parser summary reports the count so the decision can be
  revisited against evidence.
- **Skill grants are resolved one level deep.** A passive that itself references
  further skills is not followed. No evidence was found that monster resistance
  passives do this, but it is not proven absent.
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
