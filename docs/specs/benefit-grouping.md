# Proposal: condense benefits by concept

Status: proposal for review (backlog "condense related benefit dimensions"). Not
yet approved or built.

## Goal

The Benefits panel lists every stat dimension as its own row, so a single concept
spreads across several lines. Frostburn alone is four rows today:
`offensiveSlowColdModifier` (+%), `offensiveSlowColdMin`/`Max` (flat),
`offensiveSlowColdDurationModifier` (+% duration), `offensiveSlowColdDurationMin`
(+ flat duration). A Frostburn build wants all of those, so show them on one
"Frostburn" line. Resistances stay a separate concept from damage: "Fire Damage"
(offense) and "Fire Resistance" (defense) are different lines in different
sections, never merged.

## Model: category -> subject -> dimension

Decompose each raw stat id into three parts:

- **category** - the existing top-level group (`GROUP_ORDER`: Attributes, Offense,
  Defense, Other). Unchanged; sections stay in this order.
- **subject** - the concept a row belongs to: a damage type (Fire, Frostburn,
  Bleeding), a resistance type (Fire, Poison & Acid), an attribute (Physique,
  Health), or a standalone stat (Armor, Attack Speed). This is the new grouping
  key and the unit a future filter tag would select (see the filter backlog item).
- **dimension** - which facet of the subject the value is: `pct` (+N%), `flat`
  (+N or +N-M), `durPct` (+N% duration), `durFlat` (+N sec duration), `maxResist`
  (max +N%). One subject line shows its dimensions together in a fixed order.

`classify()` in `web/src/core/statFormat.ts` already extracts the type segment for
most families via its regexes; this adds `subject` + `dimension` to its result.

## Subject taxonomy (grounded in the current data, 147 distinct ids)

Offense - damage by type, each line collapsing the dimensions it has:
- Instant types (`pct` + `flat`): Physical, Pierce, Fire, Cold, Lightning,
  Elemental, Aether, Chaos, Acid (internal Poison), Vitality (internal Life).
- Damage-over-time types (`pct` + `flat` + `durPct` + `durFlat`): Bleeding,
  Internal Trauma (Physical), Burn (Fire), Frostburn (Cold), Electrocute
  (Lightning), Poison, Vitality Decay (Life).
- Offense, non-type (stay as their own one-off lines, not merged): Total Damage,
  Crit Damage, Offensive Ability (flat + %), Life Leech, Energy Leech, Reduced
  target's Elemental Resistances, Chance for Lightning Damage, racial damage.
- Retaliation: a small "Retaliation" subgroup, one line per type (flat) plus
  Total Retaliation Damage (%).

Defense:
- Resistances, one line per type collapsing `base` + `maxResist`: Physical,
  Pierce, Fire, Cold, Lightning, Aether, Chaos, Poison & Acid, Vitality,
  Bleeding, plus Elemental (a single combined id).
- Armor: flat (`defensiveProtection`) + % (`defensiveProtectionModifier`) on one
  line; Armor Absorption separate.
- Standalone (already single rows): Shield Block Chance/Damage Blocked, the
  duration-reduction protections (Stun, Freeze, Petrify, Entrapment, Skill
  Disruption), Slow Resistance, Reflected Damage Reduction, leech resistances,
  avoidance (Avoid Melee / Projectiles).

Attributes & core, each collapsing flat + %:
- Physique, Cunning, Spirit, Health, Energy, Health Regeneration, Energy
  Regeneration, Offensive Ability, Defensive Ability.
- Speeds (each a single %): Attack, Casting, Movement, Total. Plus Constitution,
  energy absorption, requirement reductions (one-offs).

## Layout - three options to choose from

Wider sidebar is on the table (`main { grid-template-columns: 240px 1fr 200px }`
in `styles.css`); these assume ~260-300px on the left.

Option A - one line, label left, value cluster right (recommended):

```
Offense
  Frostburn      +18%  10-15  +20%/+0.5s dur
  Fire           +13%  5-8
  Bleeding       +25%  12-18  +35%/+1.2s dur
  Physical       +17%
Defense
  Fire Res       +13% (max +3%)
  Chaos Res      +10%
  Armor          +120  +9%
```

Option B - subject line + indented Damage/Duration sub-rows (clearest labels,
taller):

```
Frostburn
   Damage     +18%   10-15
   Duration   +20%   +0.5s
```

Option C - aligned columns (subject | % | flat | dur), scannable but lots of
empty cells when a subject has few dimensions.

Recommendation: A. It matches "all the values on one line", stays compact, and
the dimension hints (`%`, a bare range for flat, `dur`) are enough once the
section/subject give context. Fall back to B's sub-row only for a subject with so
many dimensions that A would wrap.

## What stays ungrouped

Single-dimension concepts (most resists with no max, speeds, the duration-
reduction protections, Total Damage, etc.) render as today, just one value. The
merge only changes subjects that currently span multiple rows.

## Implementation pointers

- `web/src/core/statFormat.ts`: have `classify()` (or a sibling) also return
  `subject` and `dimension`. Add a `condensedRows(bonuses, opts)` that runs
  `bonusEntries`, groups by `(group, subject)`, orders the dimensions, and returns
  `{ group, rows: { subject, parts: { dimension, value, id }[] }[] }`. Keep the
  existing `groupedBonusRows` for any caller that wants the flat list (the
  constellation tooltip could stay flat or adopt the condensed form too).
- `web/src/adapters/sidebarView.ts` `renderBenefits`: render each condensed row as
  a label + its ordered value parts.
- Change-flash: `changeClass` keys on the raw stat id today. For a merged line,
  tag each value part with its id so only the part that changed flashes (or flash
  the whole line if that reads better).
- This defines the tag granularity for the filter backlog item: a tag = a subject,
  expanding to its set of raw ids.

## Open questions for Ted

1. Layout A, B, or C (or a mix)?
2. New sidebar width (260? 300?).
3. Should the constellation hover tooltip adopt the same condensed form, or stay
   the current flat list?
4. For DoT duration, show both `durPct` and `durFlat` together (`+20%/+0.5s`), or
   only one?
