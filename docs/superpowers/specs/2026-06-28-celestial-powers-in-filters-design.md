# Celestial powers in benefit filters — design

Status: design for review (brainstormed 2026-06-28). Not yet planned or built.

## Goal

Make celestial-power effects participate in the planner's benefit filters, so a
power that deals "burn damage over 2 seconds" matches the **Burn** filter, and so
high-value debuffs that powers grant (resistance reduction, crowd control) become
filterable. Add a right-sidebar list of still-pickable celestial powers, mirroring
the left panel's list of powers already gained.

## Background

A celestial power (`Star.celestialPower`, granted on a constellation's last star,
drawn as a diamond) stores its effects as a structured `stats: Record<string,
number>` map using the **same stat-id vocabulary** as star `bonuses` (see
`docs/devotion-system.md`). So "1125 Poison over 5s" is `offensiveSlowPoisonMin` +
`offensiveSlowPoisonDurationMin`, the same ids a Poison star carries. No parsing of
the freeform `description` is needed.

The gap today: `starsGranting()` / `starsGrantingPet()` in `core/aggregate.ts` scan
only `star.bonuses` / `star.petBonuses`, never `star.celestialPower.stats`, so
powers are invisible to filters. The benefit catalog (`condensedRows` over
`canonicalStatIds`, in `statFormat.ts`) is likewise built from star bonuses only.

Data facts (v1.2.1.x, 63 powers): every clean damage type players filter on (Fire,
Burn, Cold, Frostburn, Poison, Physical, Chaos, Vitality, Bleeding, Lightning,
Aether, Acid, Electrocute, Internal Trauma, all resistances, attributes, leech,
retaliation-by-type) already exists as a star-bonus subject, so those match with no
new categories. Powers additionally carry ~16 debuff/CC/RR concepts that no star
grants. The power `stats` map also holds ability-meta fields (cooldown, projectile
count, weapon %, radius, healing, absorb) that must stay out of filters.

## Decisions

1. **Matching scope.** `starsGranting()` also scans `celestialPower.stats`. A match
   highlights the power's diamond star with the existing benefit-match treatment
   (no new map visual language). Pet `attack_stats` from summon powers are out of
   v1 (a poison-summoning power does not match Poison). `starsGrantingPet()` is
   unchanged.

2. **In/out boundary (one rule).** A power stat id joins the benefit vocabulary
   **iff `decompose(id).group !== "Other"`.** This single rule auto-excludes the
   meta bucket (`skillCooldownTime`, `projectile*`, `weaponDamagePct`,
   `skillTargetRadius`, `damageAbsorption`, `skillLife*`, `skillMana*`) and keeps
   every Offense/Defense/Attributes/Retaliation concept. Star-bonus "Other" ids are
   unaffected (they remain real player bonuses); only power "Other" ids are dropped.

3. **Catalog source: union.** Each subject's id-set is the union of star-bonus ids
   and recognized power-stat ids. This closes a small "flat-only" gap (6 subjects,
   e.g. a power's flat `offensiveColdMax` where no star grants that exact id) and is
   future-proof if a patch adds these stats to stars. Applies to the active-benefit
   catalog and to "Available to get" (`availableBonusIds` also considers power stats
   on unselected stars in completable constellations).

4. **All ~16 debuff/CC/RR concepts, curated.** Add concept families to
   `statFormat.ts` so the raw ids get real Grim Dawn names and collapse their
   `Min`/`Chance`/`Duration` facets into one subject each (the same kind of curation
   `OVERRIDES` and the damage-type maps already do). Without curation these render as
   ~37 raw rows like "Offensive Slow Defensive Ability Duration Min"; with it they
   become ~16 readable subjects.

5. **New sidebar sections.** Split the offense and defense clusters more finely in
   both sidebars (active benefits on the left, "Available to get" on the right).

6. **Power stats are NOT summed into Benefits totals** (non-goal). `sumBonuses`
   stays bonus-only; ability stats are not additive player bonuses. The left
   "Celestial Powers" list stays a name list.

7. **Right-side "Celestial Powers" list.** A new section under the Affinity panel
   listing powers still validly pickable, independent of the active benefit filter,
   with hover showing the full description (as on the left).

## The ~16 curated concepts

Each row is one curated subject; the raw ids listed collapse into it.

Resistance reduction (own section):
- **Reduced target's Resistances** (flat, all) — `offensiveTotalResistanceReductionAbsolute{Min,DurationMin}` (Acid Spray, Tip the Scales)
- **Reduced target's Elemental Resistances** (flat) — `offensiveElementalResistanceReductionAbsolute{Min,DurationMin}` (Elemental Storm)
- **Reduced target's Elemental Resistances** (%) — `offensiveElementalResistanceReductionPercent{Min,DurationMin}` (Viper star + Hand of Ultos power; already labelled via OVERRIDES, now folds in the power)
- **Reduced target's Physical Resistance** (%) — `offensivePhysicalReductionPercent{Min,DurationMin}` (Fist of Vire)

Crowd control (own section):
- **Stun** — `offensiveStun{Min,Chance}`
- **Freeze** — `offensiveFreeze{Min,Chance}`
- **Petrify** — `offensivePetrify{Min,Chance}`
- **Knockdown** — `offensiveKnockdown{Min,Chance}`
- **Confusion** — `offensiveConfusion{Min,Chance}`
- **Fumble** — `offensiveFumble{Min,DurationMin}`
- **Impaired Aim** (projectile fumble) — `offensiveProjectileFumble{Min,DurationMin}`
- **Slow target's Movement** — `offensiveSlowRunSpeed{Min,DurationMin}`
- **Slow target's Total Speed** — `offensiveSlowTotalSpeed{Min,DurationMin}`
- **Slow target's Attack Speed** — `offensiveSlowAttackSpeed{Min,DurationMin}`
- **Reduced target's Offensive Ability** — `offensiveSlowOffensiveAbility{Min,DurationMin}`
- **Reduced target's Defensive Ability** — `offensiveSlowDefensiveAbility{Min,DurationMin}`
- **Reduced target's Damage** — `offensiveTotalDamageReductionPercent{Min,DurationMin}` (reduces what the enemy deals; a survival debuff, so CC not RR)

Retaliation (own section, see below):
- **Chaos Retaliation** — `retaliationChaosMin` (clean type; no star grants flat chaos retaliation)
- **Fire Retaliation** (%) — `retaliationFireModifier`
- **% Retaliation added to Attack** — `retaliationDamagePct`
- **Fear** — `retaliationFear{Min,Chance}` (a retaliation-triggered CC; lives under Retaliation by id)

## Section taxonomy

`GROUP_ORDER` and `groupFor()` in `statFormat.ts` drive sectioning for both
sidebars. Proposed order and approximate post-curation subject counts (union
catalog, 55 points / empty selection):

| Section | Subjects | Notes |
|---|---|---|
| Attributes | ~26 | unchanged (future: split off requirement-reductions) |
| Offense | ~22 | damage types, crit, total damage, leech, lifesteal |
| Resistance Reduction | ~4 | new; resistance-reduction stats only |
| Crowd Control | ~13 | new; CC + slows + reduced target OA/DA + reduced target damage |
| Retaliation | ~8 | new; all `retaliation*` pulled out of Offense |
| Resistances | 11 | new; damage-type resistances (incl. their max-resist facet) |
| Status Protection | ~13 | new; "Reduced X Duration" + Skill Disruption + Slow/Leech Resistance |
| Armor & Mitigation | ~9 | new; Armor, Armor Absorption, Block, Reflected Damage, racial defense |
| Other | ~1 | residual |

Routing rules in `groupFor()` (id-pattern based; order matters):

- `retaliation*` -> Retaliation.
- `*ResistanceReduction*` or `offensivePhysicalReductionPercent*` -> Resistance
  Reduction. (Note: `offensiveTotalDamageReductionPercent*` is explicitly NOT here;
  it routes to Crowd Control.)
- the CC id families (stun/freeze/petrify/knockdown/confusion/fumble/projectile
  fumble, slow run/total/attack speed, slow offensive/defensive ability, total
  damage reduction percent) -> Crowd Control. Must be an explicit family list, not
  a loose `offensiveSlow*` regex, so DoT damage (`offensiveSlowFire` = Burn) stays
  in Offense.
- damage-type resistances (`defensive<Type>`, `defensive<Type>MaxResist`) ->
  Resistances.
- "Reduced X Duration" (`defensive<DoT>Duration`), Skill Disruption, Slow
  Resistance, leech resistances -> Status Protection.
- remaining `defensive*` (Armor, Armor Absorption, Block, Reflected Damage,
  racial defense) -> Armor & Mitigation.
- `character*` -> Attributes; remaining `offensive*` -> Offense; else Other.

Exact membership of Status Protection vs Armor & Mitigation is tunable during
implementation; the Resistances / everything-else line is firm.

## Right-side Celestial Powers list

- New `availablePowers(model, selected, completable)` in `aggregate.ts`: the
  `{ starId, power }` for each constellation in `reach.completable` that is not yet
  complete (power not already gained). "Validly pickable" = completable from the
  current selection, consistent with how "Available to get" benefits use
  `reach.completable`. Independent of the active benefit filter.
- Render reuses the left list's markup: `<div class="power" data-star-id="...">
  name</div>`, placed under the Affinity panel where the other "Available to get"
  lists already render (`affinityEl`, main.ts).
- Hover: add the same `.power[data-star-id]` `mousemove` delegate that `benefitsEl`
  has (main.ts:229) to `affinityEl`, so hovering a right-side power shows the full
  description tooltip exactly like the left. (Touch has no hover here, same as the
  left list today; acceptable.)

## Components and touchpoints

- `core/aggregate.ts` — `starsGranting()` scans `celestialPower.stats`;
  `availableBonusIds()` includes power stats on unselected stars in completable
  constellations; new `availablePowers()`.
- `core/statFormat.ts` — curated label maps + `decompose`/`classify` families for
  the ~16 concepts; `GROUP_ORDER` + `groupFor()` for the new sections.
- `core/urlState.ts` — `canonicalStatIds`/`canonicalBenefitIds` (or a sibling)
  include recognized power-stat ids so the new subjects are taggable and round-trip
  in the `b=` URL param. Stale-link tolerance is unchanged (unknown tags ignored).
- `adapters/sidebarView.ts` — render the right-side available-powers section
  (returned to the caller like `availHtml`).
- `app/main.ts` — build the catalog over the union vocabulary; render the
  available-powers section into `affinityEl`; add the power hover delegate to
  `affinityEl`.
- `adapters/svgRenderer.ts` — no change; it already emphasizes the stars in the
  tagged set, which now includes power diamonds.

## URL state

Benefit tags already live in the `b=` param as raw stat ids
(`urlState.ts`/`taggedStars`). The new subjects' ids are ordinary stat ids, so they
ride the existing mechanism and round-trip; a stale link with an unknown tag is
ignored as today. No new param.

## Testing (headless)

- `aggregate.test.ts`: a power-only stat matches in `starsGranting`; a summon
  power's `attack_stats` do NOT match; `availablePowers` returns completable,
  not-yet-obtained powers and excludes obtained/uncompletable ones.
- `statFormat.test.ts`: each new concept's curated label; `Min`/`Chance`/`Duration`
  collapse into one subject; section routing for the tricky cases (Burn stays
  Offense; `offensiveTotalDamageReductionPercent` -> Crowd Control, not Resistance
  Reduction; `retaliationFear` -> Retaliation; elemental RR percent vs absolute are
  distinct subjects); a power "Other" id (e.g. `skillCooldownTime`) is excluded from
  the vocabulary.
- `urlState.test.ts`: a power-only subject's tag round-trips through
  encode/decode.

## Non-goals / deferred to backlog

- Pet `attack_stats` filtering (summoned-creature damage).
- Narrowing the right-side Celestial Powers list by the active filter.
- Summing power stats into Benefits totals.
- Finer splits of Attributes (requirement-reductions) and any further CC breakdown.
- Distinct map visual treatment for power matches vs bonus matches.
