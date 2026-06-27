# Mobile / narrow-window responsive support

Date: 2026-06-26
Status: approved, ready for implementation plan

## Goal

Make the planner usable at narrow viewport widths and on touch devices
(phone is a first-class target), without changing the desktop experience above
the breakpoint. Three problems are in scope:

1. At narrow widths the left and right sidebars cover the map.
2. The map, the points slider, and the tooltip are mouse-only, so a touchscreen
   cannot pan, zoom, drag the cap, or inspect-before-selecting.
3. A desktop annoyance: the constellation tooltip stays painted over the right
   sidebar after the cursor leaves the map.

## Two orthogonal axes

Everything keys off one of two independent axes. They must not be conflated.

- **Layout** keys off viewport *width* (`@media (max-width: ...)`): the
  three-column grid collapses to a full-width map with overlay drawers.
- **Interaction** keys off input *modality*
  (`@media (hover: none) and (pointer: coarse)`): hover tooltips become a
  tap-to-inspect popover with an explicit commit button.

Consequences of keeping them separate:

- A narrow desktop window gets drawers but keeps hover tooltips.
- A phone gets drawers and the tap model.
- A wide desktop touchscreen gets the tap model at full width.

## Breakpoint

Collapse to drawers when the docked sidebars would take more than half the
viewport. Docked widths today: left 280px + right 250px = 530px normally; the
left panel widens to 450px in compare mode (`body.comparing`), so 450 + 250 =
700px. "More than 50%" means viewport < 2 x chrome:

- `@media (max-width: 1060px)` collapses to drawers (always).
- `@media (max-width: 1400px) { body.comparing ... }` collapses to drawers
  while compare mode is on.

Net effect: collapse below 1060px normally; the threshold widens to 1400px the
moment compare mode is enabled (because the left panel balloons to 450px).
Between 1060 and 1400px the app is docked normally but collapses if compare mode
is turned on.

Overlay drawer widths are viewport-relative (`max-width: 85vw`) so they fit a
phone regardless of the docked widths above.

## Work unit 1: responsive layout, header, corner toggles

- The top bar holds the points slider, the point total / cap-toggle, and
  "Reset points", full width. **"Reset view" is removed** (see unit 2 for its
  touch replacement).
- Below the breakpoint, `<main>`'s grid collapses to a single full-width map.
  The two `<aside>` sidebars become fixed-position overlay drawers: Benefits
  slides from the left, Affinity slides from the right, each over a dim scrim.
- Two floating toggle buttons are pinned to the top-left and top-right corners
  of the map region, just below the top bar. Top-left opens Benefits, top-right
  opens Affinity. Opening one closes the other. Tapping the scrim or a close (x)
  control dismisses the open drawer. These buttons appear only below the
  breakpoint; above it the sidebars are docked as today and the buttons are
  hidden.
- Drawer open/closed state is ephemeral view chrome held in memory. It is
  deliberately **not** URL-encoded: it is not planner state, so the URL-state
  invariant (build selection plus point cap live in the hash) is untouched.
  This matches how pan/zoom is already non-shareable.

## Work unit 2: touch input for map and points slider

The map pan/zoom (`web/src/adapters/navController.ts`) and the points slider
drag (`web/src/app/main.ts`) are both mouse-event-only
(`mousedown`/`mousemove`/`mouseup`/`wheel`). Migrate both to **Pointer Events**
(`pointerdown`/`pointermove`/`pointerup`), which unify mouse, touch, and pen.
This replaces the mouse handlers rather than adding a parallel `touch*` path
(approved: avoids the duplicated input path).

- Map: one-pointer drag pans (preserving the existing `moved` /
  `DRAG_THRESHOLD` tap-vs-drag discrimination and keyboard support). A
  two-pointer gesture pinch-zooms about the gesture midpoint, reusing
  `zoomViewBox` with the same min/max clamps the wheel handler uses. A
  no-movement tap still passes through to selection/inspect.
- Slider: pointer drag sets the cap exactly as the mouse drag did; keyboard
  handling is unchanged.
- **Double-tap-to-fit** on the map replaces the removed "Reset view" button,
  calling the same `nav.reset()` (refit viewBox). This keeps a recovery path
  from a bad zoom on touch, where accidental zoom is easy.

## Work unit 3: tap-to-inspect popover (modality-based)

In touch mode only, a tap on a star or constellation shows the existing tooltip
as a sticky, interactive popover (`pointer-events: auto`) carrying an explicit
**Add / Remove** button.

- The button label and enabled state mirror the engine's existing legality
  signals (`clickable` / `completable` / `selected`); selection happens **only**
  via the button, so a mis-tap never alters the build.
- The button reuses the same `toggleStar` / `toggleConstellation` paths the
  click handlers already call.
- The popover stays anchored near the tap point using the existing on-screen
  clamping in `tooltipView`'s `place()`. Tapping the scrim or a close control
  dismisses it.
- Desktop / hover mode is unchanged: the passive `pointer-events: none` tooltip,
  no button.

## Work unit 4: desktop tooltip-stays-up fix (independent)

Root cause: the map container dispatches `onHover` only from its own
`mousemove`. There is no `mouseleave`, so when the cursor crosses into the right
sidebar, `onHover(null)` never fires, `tip.hide()` is never called, and the
tooltip (fixed, `pointer-events: none`, flipped to the cursor's left) is left
painted over the sidebar.

Fix: add a `mouseleave` (or `mouseout`) handler on the map container that
dispatches `onHover(null)`. Self-contained and shippable independently of the
mobile work.

## Files touched

- `web/index.html`: remove the Reset view button; the corner toggle buttons and
  scrim markup (or create them in `main.ts`).
- `web/src/styles.css`: the width media queries, drawer + scrim + corner-toggle
  styles, the modality media query for the interactive popover.
- `web/src/adapters/navController.ts`: pointer-events migration plus pinch and
  double-tap-to-fit.
- `web/src/app/main.ts`: slider pointer-events migration; drawer open/close
  wiring; corner-toggle wiring; remove Reset view wiring; touch-mode popover
  commit wiring; map `mouseleave` hover-hide.
- `web/src/adapters/tooltipView.ts`: the interactive popover variant (button,
  `pointer-events`), reused commit callbacks.

## Testing

- The existing suite stays green (`just test`, `just e2e`, validation gates).
  None of this touches the reachability core or URL encoding.
- New unit tests: drawer open/close state logic (opening one closes the other);
  the popover Add/Remove legality mapping (label and enabled state derived from
  `clickable` / `completable` / `selected`).
- New e2e (CDP harness in `web/e2e/`): a narrow viewport plus synthesized
  touch/pointer events assert that the corner toggles open and close drawers,
  a pinch zooms the map, double-tap refits, and a tap-inspect shows the popover
  button without altering the selection.

## Non-goals

- No change to the reachability engine, build-order panel, or URL hash format.
- No bottom-sheet redesign of the tooltip; the anchored popover is reused.
- No offline/PWA or install support.
