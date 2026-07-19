# Build-order affinity popup: the have/need progression at every step

Point-in-time design record. The build-order panel now renders only
oracle-verified orders (see
2026-07-18-build-order-validity-design.md), but following one manually is
hard: to check a step you must replay the affinity math in your head. This
feature makes each step self-explaining. Hovering a build-order step (or
tapping it on touch) shows a popup with the affinity state as it would be
with that step applied, in the same visual language as the Affinity panel in
the upper right, plus what the step's own constellation requires and grants.

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

## Architecture (approach A: pure progression, adapter render, thin wiring)

Three units, one per layer, engine and oracle untouched:

**1. Core progression helper.** A new pure module
`web/src/core/buildOrderProgression.ts` exporting
`buildOrderProgression(cons, members, steps)`. It replays the `BuildStep[]`
once over a standing set: an add or complete puts the constellation in the
set, a scaffold-refund removes it. Constellation lookup prefers the build's
`members` over the global `cons` list (the same override the oracle uses),
so the panel's synthetic partial members keep their selected-star size and
zero grant. For each step index it returns the post-step state:

- `have: Vec` - the capped sum (per-color affinity caps) of grants of
  standing COMPLETE constellations;
- `need: Vec` - the elementwise max requirement over standing
  constellations;
- `needSource: Map<number, string[]>` - per color index, the ids of the
  standing constellations demanding it (feeds the "needed by" title, exactly
  like the Affinity panel);
- `conReq: Vec` and `conGrant: Vec` - the hovered step's own constellation
  requirement and grant (for a partial member the grant is zero, matching
  what it contributes).

Deterministic, allocation-light, computed once per panel render (roughly 35
steps by 5 colors).

**2. Popup content renderer.** A pure content helper in
`web/src/adapters/buildOrderView.ts` that renders one step's popup HTML from
the progression entry via the `Localization` port:

- A five-row have/need table mirroring `renderAffinities`
  (web/src/adapters/sidebarView.ts): affinity orb, localized name
  (`aff.<affinity>`), have value, need cell with `met`/`missing` classes and
  the `ui.affinity.neededBy` title, plus the `ui.affinity.have` /
  `ui.affinity.need` column heads.
- A constellation section: the step's localized name (game text; crossroads
  via the existing `ui.buildOrder.crossroads` and direction keys), then
  Requires and Grants lines reusing the `ui.tooltip.requires` /
  `ui.tooltip.grants` keys with orb-and-number affinity rendering.

No hardcoded strings: every label resolves through existing catalog keys.
If any new key proves necessary during implementation it is added to all 13
catalogs and the `web/test/appCatalog.test.ts` REQUIRED guard; the current
design needs none.

**3. Wiring in main.ts.** The build-order panel already renders `.bo-step`
rows carrying `data-con-id`; rows gain `data-step-i` (their index into the
progression array). Desktop: delegated `pointerenter`/`pointerleave` on the
panel shows/hides the popup for the hovered row. Touch (the existing
`isTouch()` media query): tap toggles the popup for that row; a tap
elsewhere or on the same row dismisses it, following the map tooltip's
pointerup popover pattern. The popup is one absolutely positioned element
beside the hovered row, clamped to the viewport, re-rendered per row from
the precomputed progression. It is view chrome: no URL state, dismissed on
selection change or panel re-render.

## Error handling

The popup derives only from data already rendered (the verified order and
the model). If a step's constellation id is somehow unknown to both lookups
the popup is skipped for that row (no throw, no partial popup). A null
build order renders no rows, so there is nothing to hover; the empty states
are unchanged.

## Testing

- Core: `web/test/build-order-progression.test.ts` replays hand-built
  schedules (add, scaffold-add, refund, partial member) and asserts
  have/need/needSource after each step, including that a refund drops
  exactly the refunded grant and its needSource entries. A fixture test
  replays the validity work's reproduction URL
  (`#p=55&s=_38AQAIAAAAAAOAfAAAAAADAAYAHAMAHAAAAAPADPwAAAAAAPw`) end to
  end and asserts the final step's have/need equals the live selection's
  Affinity-panel values (`selectionSummary` supply/target) - the popup and
  the panel must agree where they meet.
- Adapter: content-helper tests asserting the rendered table (five rows,
  met/missing classes, neededBy titles) and the Requires/Grants section,
  through the test localization.
- i18n: the appCatalog guard confirms every referenced key exists (no new
  keys expected; the guard still protects the reuse).
- e2e: hovering (and tapping, in the touch profile) a step shows a popup
  whose have values match the step's expected state; dismissing works.

## Non-goals

- No engine or oracle changes; `buildOrderPath`, `orderLegality`, and their
  nets are untouched.
- No URL state; hover is ephemeral view chrome.
- No change to step ordering or step content beyond the added hover data
  attributes.
- No pinned/sticky popup or step-to-step keyboard navigation (candidates
  for later polish).

## Acceptance

- Hovering any step of the reproduction URL's order shows the post-step
  have/need state and the step constellation's requires/grants; the final
  step's popup matches the Affinity panel.
- Touch: tap shows, re-tap and tap-away dismiss.
- `just check` green (including the appCatalog and i18n boundary guards);
  `just e2e` green with the new checks; no perf regression (`just perf`
  unchanged - the progression computes once per render, off the hover
  path).
