# Baseline Build Comparison - Design

Date: 2026-06-24
Status: Draft for review
Builds on: the Benefits panel (`web/src/adapters/sidebarView.ts`), the bonus
aggregation/condensing in `web/src/core/aggregate.ts` + `web/src/core/statFormat.ts`,
the shareable URL hash (`web/src/core/urlState.ts`), the SVG map renderer
(`web/src/adapters/svgRenderer.ts`), and the wiring/`refresh()` loop in
`web/src/app/main.ts`. Implements the "Baseline build comparison" backlog item.

## Summary

Let a planner snapshot the current build as a "baseline", then keep editing the live
build while the Benefits panel shows a side-by-side comparison: a frozen Baseline
column, the live Now column, and a signed Delta, with red/green coloring for
worse/better. Swapping one constellation for another immediately shows what the trade
costs and gains. The whole comparison is bookmarkable: the baseline build rides in the
URL hash alongside the existing state, so a shared link restores the comparison exactly.

This is an adapters + URL-state feature. The pure core (`model`, `reachability`,
`affinity`) is untouched; `aggregate.sumBonuses` is reused as-is. Scope is the Benefits
panel only (player bonuses + the "Bonus to All Pets" section). The Affinity panel and
the points display stay single-value.

## Decisions taken during design

Settled with Ted during brainstorming; not open:

1. **Scope: Benefits panel only (player + pet).** The delta treatment covers the left
   Benefits panel. Affinity totals and points stay single-value (a later follow-up
   could extend them).
2. **Layout B1: the Benefits panel widens into a Base / Now / Delta table.** When a
   baseline is set, the Benefits sidebar widens (over the map edge) and each row gains
   Base / Now / Delta columns with a header. A "Comparing to baseline" bar sits at the
   top with the Update and Clear actions.
3. **One comparison line per part.** A condensed subject can carry several parts (a
   damage type's flat range + percent; a resistance's base + max; an attribute's flat +
   percent; a damage-over-time's damage + duration). In compare mode each part gets its
   own Base / Now / Delta line under the subject, extending the chip sub-structure
   `sidebarView` already renders. This keeps every Delta cell a single aligned scalar.
4. **Tagging is unchanged; left labels are the click targets.** The subject label
   toggles the whole group and each part label toggles that one stat, exactly as the
   current two-level benefit tagging (subject vs chip). The Base / Now / Delta value
   cells are display-only. Tagging still highlights the live build's granting stars on
   the map and feeds "Available to get"; the baseline does not change tagging behavior.
5. **Delta semantics.** Delta = current - baseline per stat. Green when the change helps
   (current larger; for reduction-style stats this still reads as the signed numeric
   change), red when smaller, neutral dash when unchanged. Flat damage **ranges**
   (merged min-max, e.g. `+40-80`) have no meaningful scalar delta, so an unchanged
   range shows a neutral dash and a changed one colors the value with no number.
6. **Map: added/removed vs baseline.** A star selected now but not in the baseline gets
   a green "added" ring; a star in the baseline but deselected now gets a red dashed
   "removed" outline. Only active while comparing.
7. **Controls: Set baseline -> Update -> Clear.** "Set baseline" (shown when none)
   snapshots the current build and enters compare mode. "Update baseline" re-snapshots
   (baseline := current, deltas reset to zero, stays in compare mode). "Clear" exits
   comparison and returns to the single-column Benefits panel, keeping the current build
   and its edits intact.
8. **URL: baseline stars + cap only.** The baseline build adds parallel hash params for
   its star selection and point cap (`cs=`, `cp=`); compare mode is active iff `cs=` is
   present. The benefit-tag highlights stay a single global `b=` (one set of highlights
   applies to the live view; a baseline has no tag set of its own). Decoding is tolerant
   of a stale or malformed `cs=`/`cp=` exactly as the existing params are.

## State and data model

A baseline is the same shape as the live selection: `{ selected: Set<StarId>;
pointCap: number }` (the existing `SelectionState`). `main.ts` gains one field beside
`state` and `selectedBenefits`:

```ts
let baseline: SelectionState | null = null; // null = not comparing
```

`baseline === null` is the single source of truth for "compare mode off". Setting a
baseline copies the current `state` (a fresh `Set`, not a shared reference). Update
re-copies the current `state`. Clear sets it back to `null`. The live `state` the user
edits is never touched by these actions.

The baseline's `pointCap` is stored for round-trip fidelity and to remember "the points"
at snapshot time; bonus totals do not depend on cap (`sumBonuses` sums over the selected
stars only), so the comparison numbers are independent of it.

## URL encoding

Extend `encodeHash`/`decodeHash` (`web/src/core/urlState.ts`) with an optional baseline:

```ts
export function encodeHash(
  selected, pointCap, canonical, benefits, statCanonical,
  baseline: { selected: Set<StarId>; pointCap: number } | null = null,
): string
```

When `baseline` is present, append `&cs=<bitset>&cp=<cap>` using the same `encodeBitset`
and the same `p=0`-is-uncapped sentinel as the live params. When absent, emit nothing
(a link with no comparison is byte-identical to today's, so existing links are
unaffected).

`decodeHash` returns `baseline: { selected, pointCap } | null` as an added field: present
only when `cs` parses to a non-empty selection. A malformed/empty `cs` decodes to `null`
(no comparison) rather than erroring, matching the existing tolerance. `cp` follows the
same clamping as `p` (with `0` = uncapped).

`main.ts` passes `baseline` into `encodeHash` in `refresh()` (the `history.replaceState`
call at main.ts:381) and restores it from `decodeHash` at startup.

## Benefits panel in compare mode

`renderBenefits` (`web/src/adapters/sidebarView.ts`) gains a `baselineSelected:
Set<StarId> | null` input; when set, it computes the baseline's `sumBonuses` /
`sumPetBonuses` the same way it already computes the current ones, so both sides go
through one code path. Behavior:

- **Off (baseline null):** unchanged from today - single value per chip, normal width.
- **On:** the panel renders the B1 table. For each scope (player, then pet) it builds the
  condensed groups over the **union** of stat ids in the baseline and current bonus maps,
  so a benefit that exists in only one side still appears (a removed benefit shows a
  Baseline value, a Now dash, and a negative Delta; a newly added one shows a Baseline
  dash and a positive Delta). Each subject renders its label row, then one line per part
  with three cells: Baseline value, Now value, Delta.
  - **Delta cell:** for a scalar part, `current[id] - baseline[id]`, signed, colored
    green/red/neutral. For a merged flat range part, compare both min and max ids: a
    neutral dash if both unchanged, otherwise the value is colored with no numeric delta.
  - **Tagging:** the subject label keeps its group tag (`data-gkey`/`data-ids`) and each
    part label keeps its stat tag (`data-vid`), with the existing `gsel`/`vsel` selected
    styling moved onto the left label cell. The value cells carry no tag data.
- **Header control:** the Benefits panel header renders a "Set baseline" button when
  `baseline` is null, and the "Comparing to baseline | Update | Clear" bar when it is set.
  These dispatch through the existing main.ts click-delegation to set/update/clear
  `baseline` and `refresh()`.

The widening is a `comparing` CSS class on the Benefits aside, toggled by main.ts;
`core/viewbox.ts` map math is unaffected (the map simply gets less width while comparing,
like any sidebar width change today).

## Map: added / removed indication

`svgRenderer`'s `update(state, highlight, reach)` gains an optional compare diff:
`{ added: Set<StarId>; removed: Set<StarId> }`, computed in main.ts as
`added = current \ baseline`, `removed = baseline \ current`. The renderer adds an
`add` class to a selected star in `added`, and renders a `removed` star (which is not in
`state.selected`) with a dashed `rm` outline at its position. When the diff is null
(not comparing) nothing changes. Styling: green ring for `add`, red dashed for `rm`,
defined alongside the existing `.star` states in `styles.css`. Removed stars are a new
case the renderer must draw even though they are unselected; they render at their normal
position with only the `rm` outline (no fill), so they read as "was here, now gone".

## Architecture / files touched

- `web/src/core/urlState.ts` - `encodeHash`/`decodeHash` gain the optional baseline
  (`cs=`/`cp=`); add `canonical`-based bitset reuse. New round-trip surface.
- `web/src/app/main.ts` - hold `baseline: SelectionState | null`; set/update/clear
  handlers; compute the added/removed diff; pass baseline to `renderBenefits`, the diff
  to `handle.update`, and baseline to `encodeHash`; restore from `decodeHash`; toggle the
  `comparing` class.
- `web/src/adapters/sidebarView.ts` - `renderBenefits` compare-mode rendering (B1 table,
  union of ids, per-part Base/Now/Delta, left-label tagging, header control). This is the
  largest change; keep the off-path identical and branch into a compare renderer so the
  single-value path is not entangled.
- `web/src/core/statFormat.ts` - a small pure helper that, given a `CondensedPart` and
  the current + baseline bonus maps, returns the rendered Baseline value, Now value, and
  the signed numeric Delta (or the colored-no-number verdict for a merged flat range,
  detected by the part's min/max ids). Built on the existing `sumBonuses` maps +
  `condensedRows`; no new aggregation.
- `web/src/adapters/svgRenderer.ts` - `add`/`rm` classes from the compare diff.
- `web/src/styles.css` - `#benefits` widened `.comparing` state, the B1 table columns,
  the compare bar + Set baseline button, and the `.star.add` / `.star.rm` map styles.

## Testing

- **urlState round-trip:** a state with a baseline encodes to `...&cs=...&cp=...` and
  decodes back to an equal baseline; a hash with no `cs` decodes `baseline: null`; a
  malformed `cs`/`cp` decodes to `null` without throwing; a no-baseline encode is
  byte-identical to today's output (guards existing links).
- **Delta computation:** given two selections, the per-stat delta is `current - baseline`;
  a benefit present only in baseline yields a negative delta and a "removed" row; one
  present only in current yields a positive delta; an unchanged stat yields a neutral
  delta; a changed flat range yields the colored-no-number case.
- **Render (compare mode):** `renderBenefits` with a baseline produces the Base/Now/Delta
  columns and the union of subjects; the subject and part labels still carry their tag
  data attributes (`data-gkey`/`data-vid`); value cells carry none. Off-mode render is
  unchanged (snapshot/equality against current output).
- **Map diff:** added/removed sets produce `add`/`rm` classes on the right stars; null
  diff produces neither.
- Tests use the real `data/devotions.json` model and the detached-element render pattern
  already used by `sidebar-benefits.test.ts` / `tooltip-*.test.ts`.

## Out of scope

- Affinity-panel and points deltas (decision 1) - a later extension.
- A baseline tag set in the URL (decision 8) - `b=` stays single.
- Comparing more than one baseline at a time / a history of baselines.
- Animating the panel slide; the widen can be an instant CSS state for v1.
