# Backlog

Planned enhancements for the web planner that are not yet started. Each item
should include implementation pointers for whoever picks it up.

## UI: benefits panel

### 1. Condense related benefit dimensions onto one line
Proposal (for review): `docs/specs/benefit-grouping.md`.

Many benefit rows are different dimensions of the same concept and clutter the
list. Example: Frostburn appears as +N% damage, +N-M flat damage, +N% duration,
and +N flat duration; a Frostburn user wants all of those, so show them on one
"Frostburn" line. Resistances stay a separate concept from damage. The proposal
defines a category -> subject -> dimension model, the subject taxonomy grounded
in the data, three layout options, and the open questions (layout, sidebar width,
whether the tooltip adopts it too).

Notes:
- `web/src/core/statFormat.ts` is where stat ids are classified/labeled; the
  proposal adds `subject`/`dimension` to `classify` and a `condensedRows` builder.
- `web/src/adapters/sidebarView.ts` `renderBenefits` renders the rows; the change
  flash (`changeClass`) keys on the raw stat id, so a merged line needs a rule for
  which part flashes.
- Sets the tag granularity for item 2 (a tag = a subject).

### 2. Filter/highlight the map by benefit (tag) - needs design
Not ready to build; capture the idea first. Show ALL benefits in the left panel,
with the ones the current selection already grants at the top and the rest below.
Clicking a benefit (for example "Elemental Resistance") acts like a tag: the
stars/constellations that grant it get highlighted on the map so the user can see
where to pick up more of it.

Open design questions (resolve before building):
- Tag granularity: a subject from item 1, or a single raw stat id. (Depends on
  item 1.)
- How multiple selected tags combine (AND vs OR), and how to clear them.
- How the highlight reads on the map and coexists with the affinity-requirement
  coloring and the unmet fade (outline matching stars? dim everything else?).

Pointers:
- Enumerating all benefits: scan `model.stars` for `bonuses` keys; `statFormat`
  already formats and groups stat ids.
- `web/src/adapters/sidebarView.ts` `renderBenefits` currently shows only the
  summed bonuses of the current selection, not the full catalog.
- Highlighting would pass a set of matching star ids into `renderSvgMarkup` plus a
  CSS highlight state.

## UI: feedback

### 3. Flash the constellations that grant a missing affinity on a blocked activation
When clicking a constellation you cannot yet activate because its affinity
requirement is unmet, flash the unselected constellations that would grant points
toward the missing affinities, so the user can see how to unlock it. This mirrors
the blocked-deselection flash, but points "forward" (what to pick up) instead of
"backward" (what to remove first).

Notes:
- `web/src/core/rules.ts` `toggleConstellation` already rejects the add when the
  requirement is unmet (returns the same state); `main.ts` `onConstellationClick`
  already detects the rejection (`next === state`). Today the add-rejection path
  does nothing.
- Compute the missing affinities: `con.affinityRequired` minus the current totals
  (from completed constellations, excluding this one). For each affinity still
  short, find the unselected/incomplete constellations whose `affinityBonus`
  includes it. A small pure helper in `rules.ts` (or `affinity.ts`) keeps it
  testable.
- Reuse the flash machinery: `flashEl` + the `data-con-id` art images in
  `main.ts`/`svgRenderer.ts`. Consider a distinct color from the red
  blocked-deselection flash (this is "go get these", e.g. the affinity color or a
  helpful hue) and decide whether to also flash their stars.
- Watch for flashing too many constellations if a missing affinity is widely
  granted; consider limiting or just accept it.

## Known limitations (accepted)

- `racialBonusPercentDamage` aggregation in the sidebar uses the union of all
  selected stars' `racial_target`; if different races are mixed it lumps them
  together. Acceptable given how rare these stars are.
