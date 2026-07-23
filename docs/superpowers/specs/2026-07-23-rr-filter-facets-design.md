# RR filter facets design

Point-in-time design record for replacing the resistance-reduction page's dropdown
filters with button facets plus search. Superseded parts live in git history, not here.

## Goal

Replace the source table's five dropdowns and the group-by control with a text search
and three button facets (damage type, reduction type, category), so filtering is
always-visible, multi-select, and reads like a build planner instead of a form.

## Why

- The parent dropdown ("Mastery / constellation / item") holds **222 distinct entries,
  114 of them on a single row**. It is unusable as a control and fully covered by text
  search, which now matches the resolved parent/item name.
- The group-by control is broken: all three modes (mastery/constellation/item) group by
  `parent` identically, so it produces 200+ one-row sections. Its one real idea, "organize
  by devotion / skill / item," is the coarse category, which becomes a facet.
- Dropdowns are single-select and hidden until opened. A build planner wants to ask "Fire
  or Cold, from an item" at a glance and toggle it directly.

Model reference: the user's own faceted armor tool (OR within a group, AND across groups,
reset-all). We add text search, which that tool lacks, because RR sources are named things.

## The filter model

Three button facets plus a search box. **OR within a facet, AND across facets.** Empty
facet = no constraint. This matches the validated mockup
(artifact `55341fdd-6726-4070-b9de-e7dde32c373d`).

### Damage type (10 chips)

Physical, Pierce, Fire, Cold, Lightning, Poison & Acid, Aether, Chaos, Vitality, Bleeding.

**Aggregate fold-in (the one behavior a naive filter breaks).** A source that reduces
"All" (67 rows) or "Elemental" (38 rows) is the strongest reduction a single-element build
has. Selecting **Fire** must surface Fire-specific rows *plus* every Elemental and All
source. There are no separate "Elemental" or "All" chips; they fold in. This reuses the
existing `sourceHits(source, token)` predicate, which already encodes the fold-in for the
current single-select dropdown; multi-select is `OR` over the selected tokens.

### Reduction (3 chips)

Stacking, Reduced %, Reduced flat. Chips carry the same semantic colors as the badges and
ledger (green / violet / ember-red).

### Category (3 chips) — coarse

Devotion, Skill, Item. Coarse keys map from the fine category on each row:

| Coarse   | Fine categories                                                                             |
| -------- | ------------------------------------------------------------------------------------------- |
| devotion | devotion                                                                                     |
| skill    | mastery skill, modifier                                                                     |
| item     | augment, component, item granted, item skill modifier, monster infrequent, relic, set bonus |

The **fine category still shows on each row** (the Category column is unchanged). Only the
filter is coarsened. Present split: Devotion 21, Skill 43, Item 370.

## Removed

- Parent filter dropdown (`fPar`) and its "all parents" option.
- Trigger filter dropdown (`fTrig`) and its "all triggers" option. The Trigger *column*
  and its `rr.trigger.*` display labels stay; only the filter goes.
- Group-by control (`group`) and `groupView`. The table renders a flat sorted list.

Kept unchanged: text search (`q`), sortable column headers (`sortKey`/`sortDir`), row
selection and the ledger (`sel`, `r0`).

## ViewState and URL encoding

The shareable-URL invariant holds: every filter round-trips through the hash and tolerates
stale or malformed links.

`fType`, `fRR`, `fCat` change from `string` to `Set<string>`. `fPar`, `fTrig`, and `group`
are removed.

Hash keys `type`, `rr`, `cat` become comma-joined selection lists (the `sel` encoding:
`map(encodeURIComponent).join(",")`), omitted when empty. Facet values are stable slugs:
damage tokens are the resistance strings ("Fire", "Poison & Acid"); reduction values are
`stacking` / `reduced-percent` / `reduced-flat`; category values are `devotion` / `skill` /
`item`. Decoding validates each token against its facet's known set and drops unknowns,
exactly as `sel` drops ids not in `knownIds`.

Stale-link behavior: an old single-value `type=Fire` or `rr=stacking` link decodes to a
one-element set and still works. Old `par=`, `trig=`, `group=` keys are ignored. Old
`cat=<fine>` links (e.g. `cat=item%20granted`) no longer match a coarse value and silently
drop the category filter; the rest of the link (selection, search, sort) restores. This is
acceptable for a view preference on a young feature and is the only intentional break.

## Internationalization

New catalog keys (guarded by `appCatalog.test.ts`): `rr.coarse.devotion`, `rr.coarse.skill`,
`rr.coarse.item`, and a "Reset" key `rr.ctl.reset`. Facet group labels reuse existing
`rr.ctl.type` / `rr.ctl.rr` / `rr.ctl.category` (the last reworded to "Source"). Reduction
chip labels reuse `rr.badge.*`. Damage chip labels use the resistance token strings as the
table already renders them (no new keys), keeping current behavior.

Removed keys (delete from `app.en.json` and from the `appCatalog.test.ts` REQUIRED list):
`rr.ctl.parent`, `rr.ctl.allParents`, `rr.ctl.trigger`, `rr.ctl.allTriggers`,
`rr.ctl.allTypes`, `rr.ctl.allRr`, `rr.ctl.allCategories`, `rr.ctl.group`,
`rr.group.none`, `rr.group.mastery`, `rr.group.constellation`, `rr.group.item`,
`rr.group.ungrouped`.

## Testing

- `urlState.test`: multi-select round-trip for all three facets; a stale single-value link
  decodes to a one-element set; unknown tokens and old `par/trig/group/cat` keys are
  dropped without error.
- `filter.test`: OR within damage with fold-in (Fire matches an Elemental and an All source);
  AND across facets; coarse-category mapping (a relic row matches `item`, Vulnerability
  matches `skill`); `fPar`/`fTrig` no longer exist.
- `tableView.test`: chips render per facet; `aria-pressed` reflects set membership; the body
  is a flat list with no group-head rows.
- `appCatalog.test`: `rr.coarse.*` and `rr.ctl.reset` present; the removed keys are gone.
- `rr-smoke` e2e: the existing `#rr=stacking` narrowing check still passes (now a set of
  one); row-count thresholds unchanged.

## Out of scope

Localizing concrete damage-type names, per-facet counts on chips, and re-attributing the
excluded modifier rows. Captured in BACKLOG.md if wanted later.
