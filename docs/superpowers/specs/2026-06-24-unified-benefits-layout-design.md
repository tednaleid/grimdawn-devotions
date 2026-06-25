# Unified Benefits Layout - Design

Date: 2026-06-24
Status: Draft for review
Supersedes: the condensed multi-value chip rendering in `renderBenefits`
(`web/src/adapters/sidebarView.ts`) and the B1 compare table from
`docs/superpowers/specs/2026-06-24-baseline-build-comparison-design.md`. The
comparison feature's behavior (snapshot a baseline, live delta, URL round-trip,
map added/removed marks) is kept; only the panel's row rendering and the
compare controls change.

## Summary

Render the Benefits panel as one row per value in both modes, replacing the
current mix (sometimes a flat+percent collapsed onto one chip line, sometimes a
subject split into damage/duration sub-rows). Each value gets its own
right-aligned column cell so values line up as scalars. The subject name shows
once on its first row; a second dimension group (`duration`, `max`) gets a short
indented sub-label; later values in a group are bare. Comparison mode is the
exact same rows with `Now` and `Delta` columns added to the right of the value
column (which becomes `Base`), plus a two-button control header.

This is an adapters + view-model change. The pure aggregation
(`aggregate.sumBonuses`/`sumPetBonuses`, `statFormat.condensedRows`) is reused.
Scope is the Benefits panel (player + pet). Affinity, points, the "Available to
get" catalog list, and Celestial Powers are unchanged.

## Decisions taken during design

Settled with Ted on the rendered mockup (`web/.llm/mock-sidebar-unified.html`);
not open:

1. **One row per value, both modes.** No collapsed multi-value chips. The
   regular panel and the compare panel share one row layout and one renderer.
2. **Minimal labels.** Order a subject's values by the existing `DIM_ORDER`
   (`flat, pct, max, durFlat, durPct`). The first row shows the subject name
   (gold, the group click target). A value entering the `max` dimension shows an
   indented muted sub-label `max`; the first `duration` value (`durFlat`) shows
   an indented `duration`; any later value in the same sub-group is bare
   (value-only, keeping the indent). Continuation `pct` after `flat` in the main
   group is bare.
3. **Compact density.** Match the current regular sidebar: tight line height,
   narrow. Compare mode keeps that density and only widens to fit the extra two
   columns.
4. **Compare columns: Base / Now / Delta.** The single value column the regular
   view shows becomes `Base` in compare mode; `Now` and `Delta` are added to its
   right. Delta semantics are unchanged from the shipped feature (signed
   `now - base` on the displayed value, green up / red down / neutral dash;
   flat ranges color with no number when changed, dash when unchanged).
5. **Controls: Keep / Update Baseline, both resolve the comparison.** The
   control header sits under the "Comparing to baseline" bar. `Keep` is
   positioned over the `Base` column; `Update Baseline` spans over `Now`/`Delta`.
   Compare mode is a "preview a change, then decide" flow:
   - `Keep`: revert the live build to the baseline snapshot and exit compare
     (`state.selected := baseline.selected`, `baseline := null`).
   - `Update Baseline`: adopt the live build and exit compare (`state` unchanged,
     `baseline := null`).
   Both return to the single-column panel. This replaces the old
   `Update` (re-baseline, stay) / `Clear` (exit, keep current) pair.
6. **Two-level selection (tagging).** Clicking the subject name toggles the whole
   subject (all its value rows); clicking an individual value row toggles just
   that value. Matches the existing two-level benefit tagging
   (`data-gkey`/`data-ids` on the subject, `data-vid` per value). The selected
   row shows the row highlight + left accent (the current compare treatment),
   applied in both modes. The `duration`/`max` sub-label cells are display-only.

## Row model

A single per-scope builder turns the bonus map(s) into render rows, so one
renderer serves both modes. For each `StatGroup`, for each subject (ordered as
`condensedRows` already orders them), emit one row per value part:

```ts
type RowRole = "subject" | "sub" | "cont"; // subject name | indented sub-label | bare
interface BenefitRow {
  role: RowRole;
  subject: string;      // the subject display name (used when role === "subject")
  subLabel: string;     // "duration" | "max" (used when role === "sub")
  id: string;           // the value's stat id, namespaced per scope (player bare, pet `pet:`)
  // value cells: regular mode uses `now` only; compare mode uses all three.
  base: string;         // "" in regular mode
  now: string;          // the displayed value (regular: the build's value; compare: current)
  delta: string;        // "" in regular mode
  verdict: "up" | "down" | "same" | ""; // "" in regular mode
}
interface BenefitSubject {
  key: string;          // subject key (group toggle target), namespaced per scope
  ids: string[];        // all value ids in this subject (for the group toggle / gsel state)
  rows: BenefitRow[];
}
interface BenefitGroup { group: StatGroup; subjects: BenefitSubject[]; }
```

Role assignment while walking a subject's `DIM_ORDER`-sorted parts:
- First part: `role = "subject"`.
- A part whose dim is `max`: `role = "sub"`, `subLabel = "max"`.
- The first `durFlat`/`durPct` part of the subject: `role = "sub"`,
  `subLabel = "duration"`.
- Any other non-first part (continuation `pct`; later `durPct` after a
  `duration` sub-label): `role = "cont"`.

Compare mode unions the baseline and current subjects/parts exactly as the
current `compareBenefits` does (a value present on only one side appears, with a
dash on the absent side and a signed delta). Regular mode just uses the current
map and leaves `base`/`delta`/`verdict` empty.

This builder replaces `compareBenefits.ts`'s output shape and the
`condensedRows`-to-chips logic in `sidebarView`; both call the same builder
(compare passes the baseline map, regular passes only the current map).

## Rendering

One renderer emits, per group: an `<h3>` group header, then per subject its
rows. Each row is a flex line: a left label cell (subject name with the group
click target / indented sub-label / empty) that flexes, then one value cell
(regular) or three (`Base`/`Now`/`Delta`, compare). The subject name carries
`data-gtoggle` + the subject's `data-gkey`/`data-ids`; each value cell's row
carries `data-vid` for the per-value toggle. Selected rows get the
`row highlight + left accent` styling; a fully-selected subject and a selected
single value reuse the existing `gsel`/`vsel` semantics on the row.

Compare mode additionally renders, above the rows: the "Comparing to baseline"
bar, then a control row with `Keep` aligned over the `Base` column and
`Update Baseline` spanning the `Now`/`Delta` columns, then the
`Base / Now / Delta` column-label header.

## Controls wiring (main.ts)

The benefits click delegation gains the two control ids:
- `#cmp-keep`: `state = { selected: new Set(baseline.selected), pointCap: baseline.pointCap }; baseline = null; refresh();`
- `#cmp-update`: `baseline = null; refresh();` (live build stays; just exit)

`#set-baseline` is unchanged (snapshot current, enter compare). The old
`#cmp-clear` id is removed. The URL still carries an active comparison as
`cs=`/`cp=` while comparing; on either button the baseline goes null so `cs=`
drops on the next `refresh()`.

## Architecture / files touched

- `web/src/core/compareBenefits.ts` - reshaped into the unified row-model builder
  described above (still pure; still reuses `sumBonuses`/`condensedRows`). Likely
  renamed to reflect that it now serves both modes (e.g. `benefitRows.ts`); the
  exact name is an implementation detail for the plan.
- `web/src/adapters/sidebarView.ts` - `renderBenefits` uses the one row renderer
  for both modes; the `activeSubject` chip path and `compareListHtml` are
  removed. The "Available to get" catalog rendering and Celestial Powers are
  untouched.
- `web/src/app/main.ts` - replace the `cmp-update`/`cmp-clear` handlers with
  `cmp-keep`/`cmp-update` per decision 5.
- `web/src/styles.css` - the unified row styles (one value-row class, the
  sub-label indent, the selected row highlight), the compare column widths, and
  the new control header (Keep over Base, Update Baseline over Now/Delta).
  Removes the now-unused `bgroup`/`bsub`/`bsingle`/`bchip` and `cmp-grp`/
  `cmp-part`/`cmp-subj` rules they replace.
- Tests: `web/test/sidebar-benefits.test.ts`, `web/test/compare-render.test.ts`,
  and `web/test/compareBenefits.test.ts` update to the new markup/model. The URL
  round-trip and map-diff tests are unaffected.

## Testing

- **Row model:** a subject with flat+pct yields two rows (`subject`, `cont`); a
  DoT with damage-pct + duration yields `subject`, `sub:duration`, `cont`; a
  resistance with pct + max yields `subject`, `sub:max`; a single-value subject
  yields one `subject` row. Ids and the subject's `ids` list are correct and
  scope-namespaced (pet `pet:` prefix).
- **Compare model:** base/now/delta/verdict per row as today (reuse the shipped
  delta and flat-range and mixed-verdict cases against the new shape); a
  value present only in baseline still renders with a dash `now` and a down
  verdict.
- **Render (both modes):** regular render emits one value cell per row and the
  `set-baseline` button; compare render emits three cells, the `Keep` and
  `Update Baseline` controls, and the `Base/Now/Delta` header. Subject rows carry
  `data-gkey`/`data-ids`/`data-gtoggle`; value rows carry `data-vid`; sub-label
  cells carry no tag data.
- **Controls (e2e):** Set baseline enters compare and adds `cs=`; `Keep` exits
  compare, drops `cs=`, and the selection equals the baseline snapshot;
  re-enter, edit, `Update Baseline` exits, drops `cs=`, and the selection equals
  the edited (now) build.

## Out of scope

- Affinity / points deltas (unchanged single-value).
- The "Available to get" catalog list layout (still subject-name-only rows).
- Persistent / multi-baseline comparison (both controls resolve the comparison).
