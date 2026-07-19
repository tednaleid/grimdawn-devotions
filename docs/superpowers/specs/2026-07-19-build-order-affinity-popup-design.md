# Build-order affinity popup: the have/need progression at every step

Point-in-time design record. The build-order panel renders only
oracle-verified orders (see 2026-07-18-build-order-validity-design.md), but
following one manually is hard: to check a step you must replay the affinity
math in your head. This feature makes each step self-explaining. Hovering a
build-order step (or tapping it on touch) shows a popup with the affinity
state as it would be with that step applied, in the same visual language as
the Affinity panel in the upper right, plus what the step's own
constellation requires and grants.

Decided during design:

- Built on the `build-order-validity` branch, on top of the shipped validity
  work (the owner's sequencing choice).
- Touch gets full parity: tap a step to show the popup, tap elsewhere or
  re-tap to dismiss, mirroring the map tooltip's touch-popover pattern.
- The popup shows the state AFTER the hovered step (the step is considered
  applied), for refunds as well as adds.
- "Need" means what it means in the Affinity panel, applied to the mid-build
  state: the elementwise max requirement over the constellations standing at
  that point, with met/missing coloring and "needed by" attribution.
- No separate progression module. The oracle's replay already computes the
  per-step standing state on every gated render and discarded it; the
  redundancy was raised during design review and the design changed to a
  single replay with two outputs. The popup's numbers are the numbers the
  judge saw when it admitted the order - they cannot drift from the
  verdict, by construction.

## Architecture: one replay, two outputs

Three units, engine untouched, no new replayer:

**1. Rich replay in the oracle module.** `web/src/core/orderLegality.ts`
gains a pure function

    replayBuildOrder(allCons, target, steps, cap):
      { error: string | null, states: StepState[] }

It is the existing verification walk, now also building one fresh
`StepState` per step (pure: new vectors and maps per entry, no caller-owned
structures mutated, no out-parameters):

- `have: Vec` - capped sum of grants of standing COMPLETE constellations
  after the step;
- `need: Vec` - elementwise max requirement over standing constellations
  after the step;
- `needSource: Map<number, string[]>` - per color index, the ids of the
  standing constellations demanding it (feeds the "needed by" title exactly
  like the Affinity panel);
- `conReq: Vec`, `conGrant: Vec` - the step's own constellation requirement
  and grant, from the same target-override lookup the verdict uses (a
  synthetic partial member keeps its selected-star size and zero grant).

`verifyBuildOrder` becomes a thin wrapper returning `.error`, so its
existing callers and tests (the corpus nets, replayLegal, the validate
harness) are untouched; the gate is the one caller that changes, moving to
the rich function (unit 2), and its unit tests update with its new return
shape. On an illegal schedule, `states` holds one
entry per step that completed its checks (a step failing pre-add or
mid-refund contributes no state); callers that only want the verdict never
see it. The oracle module still imports only types from
reachability - the independence invariant is about code, not outputs - and
state collection is write-only bookkeeping with no effect on the verdict
path. The existing oracle unit tests extend to assert the collected states
on the same hand-built schedules, making the oracle's internal state
observable rather than trusted.

**2. Gate returns the states with the order.** `gateBuildOrder` calls
`replayBuildOrder` once and returns the order together with its states when
legal (null otherwise); `selectionView` exposes both on the `SelectionView`
port (states are present exactly when `buildOrder` is). One walk per click,
same as today - the popup data is free.

**3. Popup content renderer and wiring.** A pure content helper in
`web/src/adapters/buildOrderView.ts` renders one step's popup HTML from its
`StepState` via the `Localization` port:

- A five-row have/need table mirroring `renderAffinities`
  (web/src/adapters/sidebarView.ts): affinity orb, localized name
  (`aff.<affinity>`), have value, need cell with `met`/`missing` classes
  and the `ui.affinity.neededBy` title, plus the `ui.affinity.have` /
  `ui.affinity.need` column heads. Header and rows share one CSS grid
  template scoped under the popup, so the column heads sit exactly over
  their numbers in every locale (long heads like German widen their column
  rather than drifting; the popup sizes to content).
- The step's own effect folds INTO the table (a display iteration decided
  with the owner after first use; earlier separate Requires/Grants lines
  were dropped): its grant appears in the have column as a dimmed signed
  parenthetical placed before the value so the post-step numbers stay
  column-aligned (`(+4) 11`, or `(-5)` on a refund), its requirement in the
  need column as `(1) 5`. The heading above the table is the step's
  localized name (game text; crossroads via the existing
  `ui.buildOrder.crossroads` and direction keys). Parentheses and signs are
  punctuation, not translatable copy, so no catalog keys are involved.

No hardcoded strings: every label resolves through existing catalog keys.
If any new key proves necessary during implementation it is added to all 13
catalogs and the `web/test/appCatalog.test.ts` REQUIRED guard; the current
design needs none.

`main.ts` wiring: `.bo-step` rows gain `data-step-i` (their index into the
states array). Desktop: delegated `pointerenter`/`pointerleave` on the
panel shows/hides the popup for the hovered row. Touch (the existing
`isTouch()` media query): tap toggles the popup for that row; a tap
elsewhere or on the same row dismisses it, following the map tooltip's
pointerup popover pattern. The popup is one absolutely positioned element
beside the hovered row, clamped to the viewport. It is view chrome: no URL
state, dismissed on selection change or panel re-render.

Mid-step boundary, stated so it is not an accidental omission: legality at
the conservative mid-step points (a refund loses its grant at the first
refunded star while its own requirement stands until zero - the rule that
makes tearing down a net-positive constellation illegal once its bootstrap
is gone) is judged by the same replay that produces the states, and nothing
reaches the panel without passing it. The popup displays POST-step states;
because only verified orders render, `have` covers `need` after every
rendered step and the popup never shows a missing cell - all green at every
step is the visible form of the verdict.

## Error handling

The popup derives only from data already rendered. If a step's
constellation id is unknown to both lookups the replay reports it as a
verdict error (existing behavior) and the gate withholds the order - there
is no popup-specific failure path. A null build order renders no rows, so
there is nothing to hover; the empty states are unchanged.

## Testing

- Oracle module: the existing hand-built schedules in
  `web/test/order-legality.test.ts` extend to assert `replayBuildOrder`'s
  per-step states (have/need/needSource/conReq/conGrant), including that a
  refund drops exactly the refunded grant and its needSource entries, and
  that `verifyBuildOrder` still returns the identical verdicts (wrapper
  equivalence).
- Panel agreement: a fixture test replays the validity work's reproduction
  URL (`#p=55&s=_38AQAIAAAAAAOAfAAAAAADAAYAHAMAHAAAAAPADPwAAAAAAPw`) and
  asserts the final step's have/need equals the live selection's
  Affinity-panel values (`selectionSummary` supply/target) - the replay and
  the panel are independent computations and must agree where they meet.
- Port: `selectionView` returns states exactly when it returns an order,
  and the states array length equals the step count.
- Adapter: content-helper tests asserting the rendered table (five rows,
  met/missing classes, neededBy titles) and the Requires/Grants section,
  through the test localization.
- i18n: the appCatalog guard confirms every referenced key exists (no new
  keys expected; the guard still protects the reuse).
- e2e: hovering (and tapping, in the touch profile) a step shows a popup
  whose have values match the step's expected state; dismissing works.

## Non-goals

- No engine changes; `buildOrderPath` and its nets are untouched. The
  oracle module changes only by exposing what its walk already computed;
  its verdict semantics are frozen by the existing corpus tests.
- No URL state; hover is ephemeral view chrome.
- No change to step ordering or step content beyond the added hover data
  attributes.
- No pinned/sticky popup or step-to-step keyboard navigation (candidates
  for later polish).

## Acceptance

- Hovering any step of the reproduction URL's order shows the post-step
  have/need state and the step constellation's requires/grants; the final
  step's popup matches the Affinity panel; no step shows a missing cell.
- Touch: tap shows, re-tap and tap-away dismiss.
- `just check` green (including the appCatalog and i18n boundary guards);
  `just e2e` green with the new checks; no perf regression (`just perf`
  unchanged - one replay per click, same as before this feature).
