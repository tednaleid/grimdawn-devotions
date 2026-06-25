# Conditional Bonus Qualifiers - Design

Date: 2026-06-24
Status: Draft for review
Builds on: the tooltip adapter `web/src/adapters/tooltipView.ts`, the model in
`web/src/core/model.ts` / `web/src/core/types.ts`, and the existing (unused)
`weaponRequirements()` helper in `web/src/core/aggregate.ts`. Implements the
"Conditional bonus qualifiers" backlog item.

## Summary

Some devotion star bonuses are conditional, and the planner currently shows the raw
number with no qualifier. Kraken is the motivating case: each of its stars grants
`offensiveTotalDamageModifier` (50 per star, summing toward the "+120% Total Damage"
a user sees), but only while wielding a two-handed weapon. The planner renders that
number with no hint of the condition, so the build reads as if it grants the damage
unconditionally.

The conditional context already survives end to end in the data. `data/devotions.json`
carries a `weapon_requirement: { weapons: [...], description: "Requires a two-handed
melee or two-handed ranged weapon." }` on each gated star (the parser extracts it in
`scripts/parse_devotions.py`, documented in `docs/dbr-format.md`). The model layer
loads it but drops the human-readable `description`, and nothing renders it.

This spec surfaces the qualifier on hover, in both the star tooltip and the
constellation tooltip. It is a display change plus one small model-layer fix. No
parser, dataset, URL-state, or reachability changes.

## Decisions taken during design

Settled with Ted during brainstorming; not open:

1. **Tooltips only, both star and constellation views.** The qualifier appears on the
   star's hover tooltip (one star, one requirement, clean 1:1) and on the
   constellation hover tooltip (aggregated across the constellation's stars). The
   floor Ted asked for was "at the very least on mouseover"; both tooltip surfaces
   satisfy it.
2. **Benefits sidebar left unannotated.** The aggregated benefits number is condensed
   per stat across all selected stars, so a single "Total Damage" line can mix
   conditional and unconditional sources; cleanly flagging it is out of proportion to
   the value. Out of scope for this change (a possible later follow-up).
3. **Neutral styling, not red.** The planner has no character context, so it cannot
   know whether the player meets the requirement. The qualifier is purely
   informational; it must not be styled as an unmet-requirement warning (no red).
4. **Constellation note is verbatim when fully gated, hedged only when partial.**
   Revised after checking the data: all seven weapon-gated constellations (Kraken,
   Oklaine's Lantern, Berserker, Blades of Nadaan, Hydra, Rhowan's Scepter,
   Shieldmaiden) are gated on every star by a single requirement - none is partially
   or multiply gated. So when one requirement covers the whole constellation, the
   tooltip shows it verbatim ("Requires a two-handed melee or two-handed ranged
   weapon."), matching the star tooltip rather than hedging. The "Some bonuses require
   ..." phrasing is kept only as a fallback for a future partial or mixed-requirement
   case (none exists today); the constellation tooltip detects "fully gated" as one
   distinct description covering all of the constellation's stars.
5. **One requirement line per star / per distinct description.** The requirement is a
   star-level fact in the data, so it renders once per star (not repeated under each
   bonus row). In the constellation view, distinct requirement descriptions are
   deduplicated by text.

## Model change

`Star.weaponRequirement` in `web/src/core/types.ts` currently is:

```ts
weaponRequirement: { weapons: string[] } | null;
```

Widen it to carry the description that the dataset already provides:

```ts
weaponRequirement: { weapons: string[]; description: string | null } | null;
```

In `web/src/core/model.ts`, stop dropping the field:

```ts
weaponRequirement: s.weapon_requirement
  ? { weapons: s.weapon_requirement.weapons, description: s.weapon_requirement.description ?? null }
  : null,
```

`weapons` is retained even though this feature renders only `description`: it is
existing model surface, and `description` can be `null` in the data (the parser only
fills it when the source tag begins with `tagDevotion_Requires`), so `weapons` is the
stable fallback signal that a requirement exists.

## Rendering

A single helper builds the qualifier line so the star and constellation paths share
one presentation:

```ts
function weaponReqHtml(description: string | null): string {
  return description ? `<div class="tip-weapon-req">${description}</div>` : "";
}
```

**Star tooltip** (`tooltipView.ts` `show`, the `el.innerHTML` at line 108): insert the
star's requirement line after that star's bonus rows (Grim Dawn shows the requirement
at the foot of the bonus list), before the affinity sections:

```
... ${bonusRowsHtml(star.bonuses, star.racialTarget)}${weaponReqHtml(star.weaponRequirement?.description ?? null)}${petBonusHtml(...)}${affinitySections(...)}
```

**Constellation tooltip** (`tooltipView.ts` `showConstellation`, the `el.innerHTML` at
line 133): render the distinct requirement descriptions present among the
constellation's stars. Extend the existing `weaponRequirements()` helper in
`aggregate.ts` to carry the description, then dedupe by text here:

```ts
// aggregate.ts
export function weaponRequirements(
  model: DevotionModel,
  selected: Set<StarId>,
): { starId: StarId; weapons: string[]; description: string | null }[]
```

The constellation path collects the distinct non-empty descriptions across
`con.starIds`, and renders one "Some bonuses require: ..." line per distinct
description (typically one). When no star in the constellation is gated, nothing is
rendered.

The "Some bonuses require:" prefix is the constellation-only phrasing (decision 4);
the star tooltip shows the bare description (decision 5). Both use the same
`.tip-weapon-req` element so styling is shared.

## Styling

Add a `.tip-weapon-req` rule in `web/src/styles.css` alongside the other `.tip-*`
tooltip classes (`.tip-req` is at line 580). Muted/neutral treatment consistent with
the existing `.tip-bonus` text (`#d7c89a`), explicitly not the `#e0696a` red that
`.tip-req .aff.missing` uses to flag unmet affinities. No icon required for v1.

## Testing

Unit tests, matching the existing `web/test/` style:

1. **Model**: a gated star (Kraken star 0) carries `weaponRequirement.description`
   equal to the dataset text; an ungated star has `weaponRequirement === null`.
2. **Star tooltip**: rendered HTML for a gated star contains the description text and
   the `tip-weapon-req` class; HTML for an ungated star contains neither.
3. **Constellation tooltip**: rendered HTML for Kraken contains exactly one
   `tip-weapon-req` line with the "Some bonuses require:" phrasing (descriptions
   deduped); HTML for a constellation with no gated star contains none.

If `tooltipView` is awkward to assert against directly (it writes to a passed
`HTMLElement`), the tests construct a detached element, call `show` /
`showConstellation`, and assert on `el.innerHTML` - the adapter already takes the
element as a parameter, so no DOM environment beyond what the suite already uses is
needed.

## Files touched

- `web/src/core/types.ts` - widen `weaponRequirement` with `description`
- `web/src/core/model.ts` - carry `description` through (stop dropping it)
- `web/src/core/aggregate.ts` - `weaponRequirements()` returns `description`
- `web/src/adapters/tooltipView.ts` - `weaponReqHtml` helper; render in both tooltips
- `web/src/styles.css` - `.tip-weapon-req` rule (near `.tip-req`, line 580)
- `web/test/` - model + tooltip tests above

## Out of scope

- Benefits-sidebar annotation of aggregated conditional stats (decision 2).
- Map badges / icons on gated stars.
- Any non-weapon conditional type. Only `weapon_requirement` exists in the data today;
  if other conditional types appear later, the same `tip-weapon-req` line generalizes,
  but no speculative handling is built now.
