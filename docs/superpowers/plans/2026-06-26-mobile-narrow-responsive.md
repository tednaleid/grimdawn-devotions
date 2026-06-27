# Mobile / narrow-window responsive support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the planner usable at narrow viewport widths and on touch (phone first-class), without changing the desktop experience above the breakpoint.

**Architecture:** All work lives in the adapter and presentation layers; `core/` domain logic, `ports/`, and the URL hash format are untouched. Two pure DOM-free modules carry the only real logic (drawer view-state, commit-button legality) and are unit tested without a browser. Layout collapse keys off viewport width (matchMedia + a `body.narrow` class, because the breakpoint is compare-mode-dependent and pure `@media` would duplicate the whole drawer block); interaction mode keys off input modality (`matchMedia('(hover: none) and (pointer: coarse)')`). The map and slider migrate from mouse events to Pointer Events (one driving adapter for mouse/touch/pen) and gain pinch-zoom and double-tap-to-fit.

**Tech Stack:** TypeScript, Bun (test + bundler), Biome (fmt/lint), raw CSS, a raw-CDP headless-Chrome e2e harness (`web/e2e/smoke.ts`), `just` recipes.

## Global Constraints

- Every new code file starts with two `// ABOUTME: ` comment lines.
- No emojis, em-dashes, or hyperbole in code or docs.
- The URL hash format (`core/urlState.ts`) does not change. Drawer open/closed and touch-mode are ephemeral view chrome held in memory, never URL-encoded.
- `core/`, `ports/`, and the reachability engine are not modified. New pure logic goes in new `core/` modules that import only types and existing pure functions.
- Layout collapse threshold: viewport `< 1060px` normally; `< 1400px` while `body.comparing` is set (docked sidebars exceed 50% of the viewport). Overlay drawer widths are viewport-relative (`max-width: 85vw`).
- Reuse the existing `toggleStar` / `toggleConstellation` paths for all selection changes. Selection on touch happens only via the popover button, never on a bare tap.
- Use `just` recipes, never raw tool invocations: `just test [file]`, `just e2e`, `just check`, `just fmt`.
- The pre-commit hook runs `just check` (fmt-check + unit tests + lint + typecheck). It does NOT run e2e; run `just e2e` manually where a step calls for it.
- Match the surrounding code style (the files use 2-space indent, no semicolon-free style; Biome enforces it -- run `just fmt` before committing).

---

### Task 1: Desktop tooltip-stays-up fix

The map dispatches `onHover` only from its own `mousemove`, so crossing into the right sidebar never fires `onHover(null)` and the tooltip stays painted over the sidebar. Add a `mouseleave` handler on the map container that dispatches a null hover.

**Files:**
- Modify: `web/src/adapters/svgRenderer.ts` (the `mousemove` listener block near line 300)
- Modify: `web/e2e/smoke.ts` (append one assertion in the desktop section, after the existing tooltip checks near line 250)

**Interfaces:**
- Consumes: `deps.onHover(target, clientX, clientY)` (existing `SvgDeps` member).
- Produces: nothing new.

- [ ] **Step 1: Add the failing e2e assertion**

In `web/e2e/smoke.ts`, immediately after the `"power tooltip shows the level-25 ability stat lines"` check (around line 250), insert:

```ts
  // Tooltip must hide when the cursor leaves the map (otherwise it stays painted over the sidebar).
  await cdp.evaluate(
    `document.querySelector('circle[data-star-id="akeron_s_scorpion:4"]').dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:200,clientY:200}))`,
  );
  await cdp.evaluate(
    `document.getElementById('map-container').dispatchEvent(new MouseEvent('mouseleave',{bubbles:false}))`,
  );
  check(
    (await cdp.evaluate<string>("getComputedStyle(document.getElementById('tooltip')).display")) === "none",
    "tooltip hides when the cursor leaves the map container",
  );
```

- [ ] **Step 2: Run e2e to verify it fails**

Run: `just e2e`
Expected: FAIL on `"tooltip hides when the cursor leaves the map container"` (tooltip display is still `block`).

- [ ] **Step 3: Add the mouseleave handler**

In `web/src/adapters/svgRenderer.ts`, directly after the `container.addEventListener("mousemove", ...)` block that ends near line 306, add:

```ts
  // Leaving the map clears any hover so the tooltip never lingers over a sidebar (mousemove alone
  // stops firing at the container edge, so it would otherwise stay painted).
  container.addEventListener("mouseleave", (e) => {
    container.classList.remove("con-hover");
    deps.onHover(null, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
  });
```

- [ ] **Step 4: Run e2e to verify it passes**

Run: `just e2e`
Expected: PASS, all checks green including the new one.

- [ ] **Step 5: Commit**

```bash
git add web/src/adapters/svgRenderer.ts web/e2e/smoke.ts
git commit -m "fix(ui): hide the map tooltip when the cursor leaves the map"
```

---

### Task 2: Drawer view-state pure module

A pure reducer for which drawer (if any) is open. No DOM. "Opening one closes the other; re-tapping the open side closes it."

**Files:**
- Create: `web/src/core/drawerState.ts`
- Test: `web/test/drawer-state.test.ts`

**Interfaces:**
- Produces:
  - `type DrawerState = "none" | "left" | "right"`
  - `type DrawerSide = "left" | "right"`
  - `function toggleDrawer(state: DrawerState, side: DrawerSide): DrawerState` -- returns `side` unless that side is already open, in which case `"none"`.

- [ ] **Step 1: Write the failing test**

Create `web/test/drawer-state.test.ts`:

```ts
// ABOUTME: Tests toggleDrawer, the pure reducer for which overlay sidebar (if any) is open.
// ABOUTME: Covers opening, the "opening one closes the other" rule, and re-tap-to-close.
import { test, expect } from "bun:test";
import { toggleDrawer, type DrawerState } from "../src/core/drawerState";

test("opening a side from none opens that side", () => {
  expect(toggleDrawer("none", "left")).toBe("left");
  expect(toggleDrawer("none", "right")).toBe("right");
});

test("opening one side closes the other", () => {
  expect(toggleDrawer("left", "right")).toBe("right");
  expect(toggleDrawer("right", "left")).toBe("left");
});

test("re-tapping the open side closes it", () => {
  expect(toggleDrawer("left", "left")).toBe("none");
  expect(toggleDrawer("right", "right")).toBe("none");
});

test("the result is always a valid DrawerState", () => {
  const states: DrawerState[] = ["none", "left", "right"];
  for (const s of states) for (const side of ["left", "right"] as const) expect(states).toContain(toggleDrawer(s, side));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `just test test/drawer-state.test.ts`
Expected: FAIL (cannot find module `../src/core/drawerState`).

- [ ] **Step 3: Write the module**

Create `web/src/core/drawerState.ts`:

```ts
// ABOUTME: Pure reducer for the narrow-layout overlay sidebars: which one (if any) is open.
// ABOUTME: No DOM; the layout adapter maps the returned state to CSS classes.
export type DrawerState = "none" | "left" | "right";
export type DrawerSide = "left" | "right";

// Toggle a side: open it, unless it is already open, in which case close (opening one side
// therefore also closes the other, since only one value can be held at a time).
export function toggleDrawer(state: DrawerState, side: DrawerSide): DrawerState {
  return state === side ? "none" : side;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `just test test/drawer-state.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/drawerState.ts web/test/drawer-state.test.ts
git commit -m "feat(core): pure drawer view-state reducer"
```

---

### Task 3: Commit-button legality pure mapping

A pure mapping from the engine's existing `clickable` / `completable` / `selected` signals to the popover's Add/Remove button label and enabled state. Mirrors `toggleStar` / `toggleConstellation` exactly (see `core/rules.ts`): a selected star removes freely; an unselected star adds only if `clickable`; a fully-selected constellation removes freely; an otherwise constellation adds only if `completable`.

**Files:**
- Create: `web/src/core/commitAction.ts`
- Test: `web/test/commit-action.test.ts`

**Interfaces:**
- Consumes: `DevotionModel` (`core/types`), `ReachView` (`core/reachability`), `StarId` (`core/types`).
- Produces:
  - `type CommitTarget = { kind: "star" | "constellation"; id: string }`
  - `interface CommitButton { label: "Add" | "Remove"; enabled: boolean }`
  - `function commitButton(model: DevotionModel, selected: Set<StarId>, reach: ReachView, target: CommitTarget): CommitButton`

- [ ] **Step 1: Write the failing test**

Create `web/test/commit-action.test.ts`:

```ts
// ABOUTME: Tests commitButton, the pure Add/Remove label+enabled mapping for the touch popover.
// ABOUTME: Asserts it mirrors toggleStar/toggleConstellation legality (clickable/completable/selected).
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { commitButton } from "../src/core/commitAction";
import type { ReachView } from "../src/core/reachability";

const model = buildModel(doc as any);
const con = [...model.constellations.values()].find((c) => c.starIds.length >= 2)!;
const starA = con.starIds[0]!;
const starB = con.starIds[1]!;

// A ReachView is just the dimming/availability summary; build minimal ones for each case.
function reachWith(clickable: string[], completable: string[]): ReachView {
  return {
    completable: new Set(completable),
    clickable: new Set(clickable),
    have: [0, 0, 0, 0, 0],
    need: [0, 0, 0, 0, 0],
    needSource: new Map(),
  };
}

test("selected star -> Remove, enabled", () => {
  const r = reachWith([], []);
  expect(commitButton(model, new Set([starA]), r, { kind: "star", id: starA })).toEqual({ label: "Remove", enabled: true });
});

test("unselected clickable star -> Add, enabled", () => {
  const r = reachWith([starA], []);
  expect(commitButton(model, new Set(), r, { kind: "star", id: starA })).toEqual({ label: "Add", enabled: true });
});

test("unselected non-clickable star -> Add, disabled", () => {
  const r = reachWith([], []);
  expect(commitButton(model, new Set(), r, { kind: "star", id: starA })).toEqual({ label: "Add", enabled: false });
});

test("fully selected constellation -> Remove, enabled", () => {
  const r = reachWith([], []);
  const sel = new Set(con.starIds);
  expect(commitButton(model, sel, r, { kind: "constellation", id: con.id })).toEqual({ label: "Remove", enabled: true });
});

test("partially selected, completable constellation -> Add, enabled", () => {
  const r = reachWith([], [con.id]);
  expect(commitButton(model, new Set([starA]), r, { kind: "constellation", id: con.id })).toEqual({ label: "Add", enabled: true });
});

test("unselected, non-completable constellation -> Add, disabled", () => {
  const r = reachWith([], []);
  expect(commitButton(model, new Set(), r, { kind: "constellation", id: con.id })).toEqual({ label: "Add", enabled: false });
  void starB;
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `just test test/commit-action.test.ts`
Expected: FAIL (cannot find module `../src/core/commitAction`).

- [ ] **Step 3: Write the module**

Create `web/src/core/commitAction.ts`:

```ts
// ABOUTME: Pure mapping from engine legality (clickable/completable/selected) to the touch popover's
// ABOUTME: Add/Remove button label + enabled state. Mirrors toggleStar/toggleConstellation in rules.ts.
import type { DevotionModel, StarId } from "./types";
import type { ReachView } from "./reachability";

export type CommitTarget = { kind: "star" | "constellation"; id: string };
export interface CommitButton {
  label: "Add" | "Remove";
  enabled: boolean;
}

export function commitButton(
  model: DevotionModel,
  selected: Set<StarId>,
  reach: ReachView,
  target: CommitTarget,
): CommitButton {
  if (target.kind === "star") {
    if (selected.has(target.id)) return { label: "Remove", enabled: true };
    return { label: "Add", enabled: reach.clickable.has(target.id) };
  }
  const con = model.constellations.get(target.id);
  const starIds = con?.starIds ?? [];
  // Mirror toggleConstellation: fully selected removes freely; otherwise it adds, gated by completable.
  if (starIds.length > 0 && starIds.every((id) => selected.has(id))) return { label: "Remove", enabled: true };
  return { label: "Add", enabled: reach.completable.has(target.id) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `just test test/commit-action.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/commitAction.ts web/test/commit-action.test.ts
git commit -m "feat(core): pure commit-button legality mapping for the touch popover"
```

---

### Task 4: Responsive layout, header, and overlay drawers

Collapse the three-column grid to a full-width map with overlay drawers below the breakpoint. Add corner toggle buttons and a scrim. The breakpoint is compare-mode-dependent, so it is computed in JS via two `matchMedia` queries and reflected as a `body.narrow` class; all collapse CSS is gated on `body.narrow` (no `@media` duplication). Drawer open/closed comes from Task 2's `toggleDrawer`.

**Files:**
- Modify: `web/index.html` (add the two toggle buttons + scrim as siblings of `<main>`, before `#tooltip`)
- Modify: `web/src/styles.css` (drawer/scrim/toggle styles gated on `body.narrow`; `--header-h` var usage)
- Modify: `web/src/app/main.ts` (header-height var; narrow detection; drawer wiring)
- Modify: `web/e2e/smoke.ts` (append a narrow-viewport section that enables device emulation and asserts drawers)

**Interfaces:**
- Consumes: `toggleDrawer`, `DrawerState` (Task 2).
- Produces: `body.narrow` class semantics; the `body` CSS var `--header-h`; the DOM ids `#drawer-left-btn`, `#drawer-right-btn`, `#drawer-scrim`; a `setDrawer(next: DrawerState)` helper and the `updateNarrow()` function in `main.ts` that later tasks may rely on for emulated-touch tests.

- [ ] **Step 1: Add the failing e2e assertions**

In `web/e2e/smoke.ts`, immediately before the final `check(cdp.consoleErrors.length === 0, ...)` line (near line 349), insert the narrow/touch emulation block (later tasks append more checks inside it):

```ts
  // --- Narrow viewport + touch emulation (responsive drawers, gestures, popover) ---
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await Bun.sleep(200);
  check(
    await cdp.evaluate<boolean>("document.body.classList.contains('narrow')"),
    "below the breakpoint the layout collapses (body.narrow)",
  );
  check(
    (await cdp.evaluate<string>("getComputedStyle(document.getElementById('drawer-left-btn')).display")) !== "none",
    "corner toggle buttons are visible when narrow",
  );
  await cdp.evaluate("document.getElementById('drawer-right-btn').click()");
  await Bun.sleep(250);
  check(
    await cdp.evaluate<boolean>("document.getElementById('affinity').classList.contains('open')"),
    "tapping the right toggle opens the affinity drawer",
  );
  await cdp.evaluate("document.getElementById('drawer-left-btn').click()");
  await Bun.sleep(250);
  check(
    await cdp.evaluate<boolean>(
      "document.getElementById('benefits').classList.contains('open') && !document.getElementById('affinity').classList.contains('open')",
    ),
    "opening the left drawer closes the right one",
  );
  await cdp.evaluate("document.getElementById('drawer-scrim').click()");
  await Bun.sleep(250);
  check(
    await cdp.evaluate<boolean>(
      "!document.getElementById('benefits').classList.contains('open') && !document.getElementById('affinity').classList.contains('open')",
    ),
    "tapping the scrim closes the open drawer",
  );
```

- [ ] **Step 2: Run e2e to verify it fails**

Run: `just e2e`
Expected: FAIL on `"below the breakpoint the layout collapses (body.narrow)"` (no `body.narrow`, no toggle buttons yet).

- [ ] **Step 3: Remove the Reset view button and add the toggle + scrim markup**

In `web/index.html`, delete this line from the header:

```html
    <button id="reset-view">Reset view</button>
```

Then, between `</main>` and `<div id="tooltip"></div>`, add:

```html
  <button id="drawer-left-btn" class="drawer-toggle drawer-left" type="button" aria-label="Show benefits">Benefits</button>
  <button id="drawer-right-btn" class="drawer-toggle drawer-right" type="button" aria-label="Show affinity">Affinity</button>
  <div id="drawer-scrim"></div>
```

- [ ] **Step 4: Add the CSS**

In `web/src/styles.css`, replace the `#reset-view` rule (lines ~104-107):

```css
/* Reset points stays next to the points group; only Reset view is pushed far right. */
#reset-view {
  margin-left: auto;
}
```

with:

```css
/* With Reset view removed, push Reset points to the far right of the top bar. */
#reset-points {
  margin-left: auto;
}
```

Then append, at the end of `web/src/styles.css`:

```css
/* --- Narrow layout: overlay drawers + corner toggles (body.narrow set by JS via matchMedia) --- */
.drawer-toggle {
  display: none;
}
#drawer-scrim {
  display: none;
}
body.narrow main {
  grid-template-columns: 1fr;
}
body.narrow .sidebar {
  position: fixed;
  top: 0;
  bottom: 0;
  z-index: 30;
  width: 85vw;
  transition: transform 0.2s ease;
}
body.narrow #benefits {
  left: 0;
  max-width: 380px;
  transform: translateX(-110%);
}
body.narrow #affinity {
  right: 0;
  max-width: 320px;
  transform: translateX(110%);
}
body.narrow #benefits.open,
body.narrow #affinity.open {
  transform: translateX(0);
}
body.narrow .drawer-toggle {
  display: flex;
  position: fixed;
  top: calc(var(--header-h, 52px) + 8px);
  z-index: 24;
  align-items: center;
  background: #21262d;
  color: #e6edf3;
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 0.35rem 0.7rem;
  font-size: 0.8rem;
  cursor: pointer;
}
body.narrow .drawer-left {
  left: 8px;
}
body.narrow .drawer-right {
  right: 8px;
}
body.narrow #drawer-scrim.show {
  display: block;
  position: fixed;
  inset: 0;
  z-index: 25;
  background: rgba(0, 0, 0, 0.5);
}
```

- [ ] **Step 5: Wire the header var, narrow detection, and drawers in `main.ts`**

In `web/src/app/main.ts`, add to the imports near the top (after the `tooltipView` import on line 8):

```ts
import { toggleDrawer, type DrawerState } from "../core/drawerState";
```

Remove the `resetBtn` element lookup (line 94):

```ts
  const resetBtn = document.getElementById("reset-view") as HTMLButtonElement;
```

and remove its listener (line 254):

```ts
  resetBtn.addEventListener("click", () => nav.reset());
```

After the other `document.getElementById` lookups (near line 95), add:

```ts
  const headerEl = document.querySelector("header") as HTMLElement;
  const leftBtn = document.getElementById("drawer-left-btn") as HTMLButtonElement;
  const rightBtn = document.getElementById("drawer-right-btn") as HTMLButtonElement;
  const scrim = document.getElementById("drawer-scrim") as HTMLElement;
```

Then, just before the final `refresh();` call at the end of `boot()` (line 449), add the wiring:

```ts
  // Expose the header height to CSS so the corner toggles sit just below the top bar.
  function setHeaderH() {
    document.body.style.setProperty("--header-h", `${headerEl.offsetHeight}px`);
  }
  setHeaderH();
  window.addEventListener("resize", setHeaderH);

  // Narrow layout: collapse when the docked sidebars would exceed half the viewport. The threshold is
  // compare-mode-dependent (the left panel widens to 450px when comparing), so it is computed here from
  // two width queries rather than duplicated across @media blocks. body.narrow gates all collapse CSS.
  const mqNarrow = matchMedia("(max-width: 1060px)");
  const mqNarrowCompare = matchMedia("(max-width: 1400px)");
  let drawer: DrawerState = "none";
  function renderDrawer() {
    benefitsEl.classList.toggle("open", drawer === "left");
    affinityEl.classList.toggle("open", drawer === "right");
    scrim.classList.toggle("show", drawer !== "none");
  }
  function setDrawer(next: DrawerState) {
    drawer = next;
    renderDrawer();
  }
  function updateNarrow() {
    const narrow = mqNarrow.matches || (baseline !== null && mqNarrowCompare.matches);
    document.body.classList.toggle("narrow", narrow);
    if (!narrow && drawer !== "none") setDrawer("none"); // docked layout must not keep a drawer/scrim open
  }
  mqNarrow.addEventListener("change", updateNarrow);
  mqNarrowCompare.addEventListener("change", updateNarrow);
  leftBtn.addEventListener("click", () => setDrawer(toggleDrawer(drawer, "left")));
  rightBtn.addEventListener("click", () => setDrawer(toggleDrawer(drawer, "right")));
  scrim.addEventListener("click", () => setDrawer("none"));
  updateNarrow();
```

Finally, make compare-mode changes re-evaluate the narrow threshold: in `refresh()`, directly after the line `document.body.classList.toggle("comparing", baseline !== null);` (line 408), add:

```ts
    updateNarrow();
```

Note: `updateNarrow` is declared after `refresh` in source order but both are closures in the same `boot()` scope, so the call inside `refresh()` resolves at call time (the first `refresh()` runs after `updateNarrow` is defined). No hoisting issue because `function updateNarrow` is a declaration.

- [ ] **Step 6: Run e2e to verify it passes**

Run: `just e2e`
Expected: PASS, including the four new narrow-layout checks.

- [ ] **Step 7: Run the full check gate**

Run: `just check`
Expected: PASS (fmt, unit tests, lint, typecheck). If fmt rewrites anything, re-stage.

- [ ] **Step 8: Commit**

```bash
git add web/index.html web/src/styles.css web/src/app/main.ts web/e2e/smoke.ts
git commit -m "feat(ui): collapse sidebars into overlay drawers at narrow widths"
```

---

### Task 5: Pointer Events migration, pinch-zoom, double-tap-to-fit

Migrate the map nav and the points slider from mouse events to Pointer Events. Add two-pointer pinch-zoom on the map and double-tap-to-fit (the replacement for the removed Reset view button). Pan, tap-vs-drag discrimination, and keyboard handling are preserved.

**Files:**
- Modify: `web/src/adapters/navController.ts` (mouse -> pointer; pinch; double-tap)
- Modify: `web/src/app/main.ts` (attach `pointerdown` instead of `mousedown` for nav; slider mouse -> pointer)
- Modify: `web/e2e/smoke.ts` (append pinch + double-tap checks inside the emulated section)

**Interfaces:**
- Consumes: `zoomViewBox`, `panViewBox`, `fitViewBox`, `ViewBox` (`core/viewbox`, unchanged); `navHandlers()` store.
- Produces: `NavHandlers.onDown(e: PointerEvent)` (signature changes from `MouseEvent`); `onWheel(e: WheelEvent)` and `onClickCapture(e: MouseEvent)` unchanged.

- [ ] **Step 1: Add the failing e2e assertions**

In `web/e2e/smoke.ts`, append inside the emulated section (after the scrim-close check from Task 4):

```ts
  // Pinch-zoom: two pointers spreading apart must zoom in (shrink the viewBox width).
  const vbWidth = () =>
    cdp.evaluate<number>("parseFloat(document.querySelector('#map-container svg').getAttribute('viewBox').split(' ')[2])");
  const beforePinch = await vbWidth();
  await cdp.evaluate(`(() => {
    const c = document.getElementById('map-container');
    const down = (id, x, y) => c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: 'touch' }));
    const move = (id, x, y) => window.dispatchEvent(new PointerEvent('pointermove', { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: 'touch' }));
    const up = (id, x, y) => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: 'touch' }));
    down(1, 180, 400); down(2, 210, 400);
    move(1, 120, 400); move(2, 270, 400);
    move(1, 60, 400); move(2, 330, 400);
    up(1, 60, 400); up(2, 330, 400);
  })()`);
  await Bun.sleep(150);
  check((await vbWidth()) < beforePinch - 1, "pinching two pointers apart zooms the map in (viewBox shrinks)");

  // Double-tap-to-fit: after a zoom, two quick taps refit to the base view (viewBox width returns up).
  const afterPinch = await vbWidth();
  await cdp.evaluate(`(() => {
    const c = document.getElementById('map-container');
    const tap = () => {
      c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, clientX: 195, clientY: 420, bubbles: true, pointerType: 'touch' }));
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, clientX: 195, clientY: 420, bubbles: true, pointerType: 'touch' }));
    };
    tap(); tap();
  })()`);
  await Bun.sleep(150);
  check((await vbWidth()) > afterPinch + 1, "double-tap refits the map (viewBox returns toward base)");
```

- [ ] **Step 2: Run e2e to verify it fails**

Run: `just e2e`
Expected: FAIL on `"pinching two pointers apart zooms the map in"` (nav listens to mouse events only; pointer events do nothing).

- [ ] **Step 3: Rewrite `navController.ts` for Pointer Events**

Replace the body of `web/src/adapters/navController.ts` from the `let dragging = false,` declaration (line 46) through the `onClickCapture` function (line 91) with:

```ts
  let dragging = false,
    moved = false,
    lastX = 0,
    lastY = 0;
  // Active pointers by id (for pinch); the gesture is a pinch whenever two are down.
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchPrevDist = 0;
  // Double-tap-to-fit (replaces the old Reset view button): two quick taps near the same point refit.
  let lastTapTime = 0,
    lastTapX = 0,
    lastTapY = 0;

  function onWheel(e: WheelEvent) {
    const svg = svgGetter();
    if (!svg) return;
    e.preventDefault();
    const w = clientToWorld(svg, e.clientX, e.clientY);
    const factor = e.deltaY > 0 ? 1.1 : 1 / 1.1;
    apply(zoomViewBox(current(), w.x, w.y, factor, 80, baseVb.w * 1.5));
  }
  function onDown(e: PointerEvent) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      // entering a pinch: stop any single-pointer pan and seed the reference distance
      dragging = false;
      opts.onDragStateChange?.(false);
      const [a, b] = [...pointers.values()];
      pinchPrevDist = Math.hypot(a.x - b.x, a.y - b.y);
      return;
    }
    if (pointers.size > 2) return;
    if ((e.target as Element)?.getAttribute?.("data-star-id")) return; // let star taps through
    dragging = true;
    moved = false;
    lastX = e.clientX;
    lastY = e.clientY;
    opts.onDragStateChange?.(true);
  }
  function onMove(e: PointerEvent) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) {
      const svg = svgGetter();
      if (!svg) return;
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchPrevDist > 0 && dist > 0) {
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const w = clientToWorld(svg, midX, midY);
        // fingers apart -> dist grows -> factor < 1 -> zoom in, about the gesture midpoint.
        apply(zoomViewBox(current(), w.x, w.y, pinchPrevDist / dist, 80, baseVb.w * 1.5));
      }
      pinchPrevDist = dist;
      return;
    }
    if (!dragging) return;
    const svg = svgGetter();
    if (!svg) return;
    const vb = current();
    const rect = svg.getBoundingClientRect();
    const dx = ((e.clientX - lastX) / rect.width) * vb.w;
    const dy = ((e.clientY - lastY) / rect.height) * vb.h;
    if (Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY) > DRAG_THRESHOLD) moved = true;
    apply(panViewBox(vb, dx, dy));
    lastX = e.clientX;
    lastY = e.clientY;
  }
  function onUp(e: PointerEvent) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchPrevDist = 0;
    if (pointers.size === 0 && dragging) {
      dragging = false;
      opts.onDragStateChange?.(false);
    }
    // A tap (no drag) on empty map: detect a double-tap and refit. Skip when the tap landed on a star,
    // so double-tapping a star does not also reset the view.
    if (!moved && !(e.target as Element)?.getAttribute?.("data-star-id")) {
      const now = Date.now();
      if (now - lastTapTime < 300 && Math.abs(e.clientX - lastTapX) + Math.abs(e.clientY - lastTapY) < 20) {
        apply(baseVb);
        lastTapTime = 0;
      } else {
        lastTapTime = now;
        lastTapX = e.clientX;
        lastTapY = e.clientY;
      }
    }
  }
  function onClickCapture(e: MouseEvent) {
    if (moved) {
      e.stopPropagation();
      moved = false;
    }
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
```

Then update the `NavHandlers` interface (lines 10-14) so `onDown` takes a `PointerEvent`:

```ts
export interface NavHandlers {
  onWheel(e: WheelEvent): void;
  onDown(e: PointerEvent): void;
  onClickCapture(e: MouseEvent): void;
}
```

And delete the now-removed `window.addEventListener("mousemove", onMove);` / `window.addEventListener("mouseup", onUp);` lines (old lines 93-94) -- they are replaced by the pointer listeners above. Keep the `(attachNav as unknown as NavHandlerStore)._handlers = { onWheel, onDown, onClickCapture };` line and the `return { reset() {...} }` block unchanged.

- [ ] **Step 4: Attach the nav pointer handler and migrate the slider in `main.ts`**

In `web/src/app/main.ts`, change the nav container listener (line 252) from:

```ts
  mapContainer.addEventListener("mousedown", h.onDown);
```

to:

```ts
  mapContainer.addEventListener("pointerdown", h.onDown);
```

Then migrate the points-bar drag (lines 295-310). Replace:

```ts
  let dragging = false;
  const onBarMove = (e: MouseEvent) => {
    if (dragging) setCap(capFromClientX(e.clientX));
  };
  const onBarUp = () => {
    dragging = false;
    window.removeEventListener("mousemove", onBarMove);
    window.removeEventListener("mouseup", onBarUp);
  };
  barEl.addEventListener("mousedown", (e) => {
    if (!Number.isFinite(state.pointCap)) return; // uncapped: the bar is read-only
    dragging = true;
    setCap(capFromClientX(e.clientX));
    window.addEventListener("mousemove", onBarMove);
    window.addEventListener("mouseup", onBarUp);
  });
```

with:

```ts
  let dragging = false;
  const onBarMove = (e: PointerEvent) => {
    if (dragging) setCap(capFromClientX(e.clientX));
  };
  const onBarUp = () => {
    dragging = false;
    window.removeEventListener("pointermove", onBarMove);
    window.removeEventListener("pointerup", onBarUp);
  };
  barEl.addEventListener("pointerdown", (e) => {
    if (!Number.isFinite(state.pointCap)) return; // uncapped: the bar is read-only
    dragging = true;
    setCap(capFromClientX(e.clientX));
    window.addEventListener("pointermove", onBarMove);
    window.addEventListener("pointerup", onBarUp);
  });
```

- [ ] **Step 5: Run e2e to verify it passes**

Run: `just e2e`
Expected: PASS, including the pinch and double-tap checks. The earlier desktop checks (synthetic `MouseEvent('click')` selection, keyboard cap) still pass because the container `click` listener and the bar `keydown` handler are unchanged.

- [ ] **Step 6: Run the full check gate**

Run: `just check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/adapters/navController.ts web/src/app/main.ts web/e2e/smoke.ts
git commit -m "feat(ui): pointer-events nav with pinch-zoom and double-tap-to-fit"
```

---

### Task 6: Tap-to-inspect popover with Add/Remove commit

In touch mode only, a tap on a star or constellation shows the tooltip as an interactive popover carrying an Add/Remove button. Selection happens only via that button. Desktop hover is unchanged. Modality is detected live with `matchMedia('(hover: none) and (pointer: coarse)')` so a hybrid device (and the emulated e2e) behaves correctly per interaction.

**Files:**
- Modify: `web/src/adapters/svgRenderer.ts` (pass tap coordinates through `onStarClick` / `onConstellationClick`)
- Modify: `web/src/adapters/tooltipView.ts` (optional `commit` button param; toggle `pointer-events`)
- Modify: `web/src/app/main.ts` (touch-mode tap -> popover; button + outside-tap wiring)
- Modify: `web/src/styles.css` (popover button style)
- Modify: `web/e2e/smoke.ts` (append popover checks inside the emulated section)

**Interfaces:**
- Consumes: `commitButton`, `CommitTarget`, `CommitButton` (Task 3); existing `toggleStar` / `toggleConstellation`.
- Produces:
  - `SvgDeps.onStarClick(id: StarId, clientX: number, clientY: number)` and `SvgDeps.onConstellationClick(id: string, clientX: number, clientY: number)` (coordinates added).
  - `tooltipView` `show` / `showConstellation` gain a trailing optional `commit?: { label: string; enabled: boolean }` param; the returned API is otherwise unchanged.

- [ ] **Step 1: Add the failing e2e assertions**

In `web/e2e/smoke.ts`, append inside the emulated section (after the double-tap check). It picks whatever selectable (clickable, unselected) star exists at this point in the flow rather than hardcoding one:

```ts
  // Tap-to-inspect: in touch mode a tap shows the popover with an Add button and does NOT change selection.
  const tapStar = await cdp.evaluate<string>(
    "document.querySelector('circle.hit.selectable:not(.selected)')?.getAttribute('data-star-id') || ''",
  );
  check(tapStar.length > 0, "found a selectable star to tap-inspect");
  const selCountBefore = await cdp.evaluate<number>("document.querySelectorAll('.star.selected').length");
  await cdp.evaluate(
    `document.querySelector('circle[data-star-id="${tapStar}"]').dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:195,clientY:300}))`,
  );
  await Bun.sleep(150);
  check(
    await cdp.evaluate<boolean>("!!document.querySelector('#tooltip .tip-commit')"),
    "touch tap shows the popover with a commit button",
  );
  check(
    (await cdp.evaluate<number>("document.querySelectorAll('.star.selected').length")) === selCountBefore,
    "a bare touch tap does not change the selection",
  );
  check(
    await cdp.evaluate<boolean>("!document.querySelector('#tooltip .tip-commit').disabled"),
    "the Add button is enabled for a clickable star",
  );
  // Pressing the commit button selects it.
  await cdp.evaluate("document.querySelector('#tooltip .tip-commit').click()");
  await Bun.sleep(200);
  check(
    (await cdp.evaluate<number>("document.querySelectorAll('.star.selected').length")) === selCountBefore + 1,
    "the popover Add button commits the selection",
  );
```

- [ ] **Step 2: Run e2e to verify it fails**

Run: `just e2e`
Expected: FAIL on `"touch tap shows the popover with a commit button"` (no `.tip-commit`; the bare tap also currently selects, so the no-change check would fail too).

- [ ] **Step 3: Pass tap coordinates through the SVG click callbacks**

In `web/src/adapters/svgRenderer.ts`, update the `SvgDeps` interface (lines 260-261):

```ts
  onStarClick(id: StarId, clientX: number, clientY: number): void;
  onConstellationClick(id: string, clientX: number, clientY: number): void;
```

Then update the container `click` handler (lines 291-299) to forward coordinates:

```ts
  container.addEventListener("click", (e) => {
    const me = e as MouseEvent;
    const sid = (e.target as Element)?.getAttribute?.("data-star-id");
    if (sid) {
      deps.onStarClick(sid, me.clientX, me.clientY);
      return;
    }
    const cid = conAt(me.clientX, me.clientY);
    if (cid) deps.onConstellationClick(cid, me.clientX, me.clientY);
  });
```

- [ ] **Step 4: Add the optional commit button to `tooltipView`**

In `web/src/adapters/tooltipView.ts`, update the `show` and `showConstellation` signatures and append the button. Change `show` (line 109) to add a trailing param and a button line:

```ts
    show(
      model: DevotionModel,
      starId: StarId,
      clientX: number,
      clientY: number,
      totals?: AffinityTotals,
      commit?: { label: string; enabled: boolean },
    ) {
      const star = model.stars.get(starId);
      if (!star) return;
      const con = model.constellations.get(star.constellationId)!;
      const power = star.celestialPower ? powerHtml(star.celestialPower) : "";
      el.innerHTML = `<strong>${con.name}</strong>${power}${bonusRowsHtml(star.bonuses, star.racialTarget)}${weaponReqHtml(star.weaponRequirement?.description)}${petBonusHtml(star.petBonuses)}${affinitySections(con, totals)}${commitHtml(commit)}`;
      el.style.pointerEvents = commit ? "auto" : "";
      place(clientX, clientY);
    },
```

Change `showConstellation` (line 117) to add a trailing `commit` param after `dim`, and append `${commitHtml(commit)}` to its `el.innerHTML`, and set `el.style.pointerEvents = commit ? "auto" : "";` before `place(...)`:

```ts
    showConstellation(
      model: DevotionModel,
      conId: string,
      clientX: number,
      clientY: number,
      totals?: AffinityTotals,
      dim?: { needs?: number; cap: number },
      commit?: { label: string; enabled: boolean },
    ) {
```

and the end of that method (the `el.innerHTML = ...` line near 152) becomes:

```ts
      el.innerHTML = `${head}${powers}${bonusRowsHtml(sumBonuses(model, stars), racialTargets(model, stars))}${weaponReq}${petBonusHtml(sumPetBonuses(model, stars))}${affinitySections(con, totals)}${dimLine}${commitHtml(commit)}`;
      el.style.pointerEvents = commit ? "auto" : "";
      place(clientX, clientY);
```

In `hide()` (line 155), also reset pointer-events so a passive hover tooltip never stays interactive:

```ts
    hide() {
      el.style.display = "none";
      el.style.pointerEvents = "";
    },
```

Add this helper above the `export function tooltipView` (near line 87):

```ts
// The interactive commit button for the touch popover; empty in passive (hover) mode.
function commitHtml(commit?: { label: string; enabled: boolean }): string {
  if (!commit) return "";
  return `<button class="tip-commit" type="button"${commit.enabled ? "" : " disabled"}>${commit.label}</button>`;
}
```

- [ ] **Step 5: Wire touch-mode tap-to-popover in `main.ts`**

In `web/src/app/main.ts`, add to the imports (after the `commitAction`-adjacent imports; place near line 9):

```ts
import { commitButton, type CommitTarget } from "../core/commitAction";
```

Add a live modality check and popover state near the other `boot()`-scope declarations (for example just after `const tip = tooltipView(tooltipEl);` on line 96):

```ts
  const isTouch = () => matchMedia("(hover: none) and (pointer: coarse)").matches;
  let popoverTarget: CommitTarget | null = null; // the star/constellation the open popover commits
```

Refactor the two map click callbacks (lines 171-184) so a touch tap inspects instead of committing. Replace the `onStarClick` and `onConstellationClick` members of the `mountSvg` deps with:

```ts
    onStarClick: (id, x, y) => {
      if (isTouch()) {
        showCommitPopover({ kind: "star", id }, x, y);
        return;
      }
      const next = toggleStar(model, state, reach, id);
      if (next !== state) {
        state = next;
        refresh();
      }
    },
    onConstellationClick: (id, x, y) => {
      if (isTouch()) {
        showCommitPopover({ kind: "constellation", id }, x, y);
        return;
      }
      const next = toggleConstellation(model, state, reach, id);
      if (next !== state) {
        state = next;
        refresh();
      }
    },
```

Add these helpers just before the final wiring (near line 449, beside the drawer wiring from Task 4):

```ts
  // Touch popover: show the inspect tooltip with an Add/Remove button; commit only via that button.
  function showCommitPopover(target: CommitTarget, x: number, y: number) {
    popoverTarget = target;
    const totals = affinityTotals(model, state.selected);
    const btn = commitButton(model, state.selected, reach, target);
    if (target.kind === "star") tip.show(model, target.id, x, y, totals, btn);
    else tip.showConstellation(model, target.id, x, y, totals, completionInfo(target.id), btn);
  }
  function commitPopover() {
    if (!popoverTarget) return;
    const next =
      popoverTarget.kind === "star"
        ? toggleStar(model, state, reach, popoverTarget.id)
        : toggleConstellation(model, state, reach, popoverTarget.id);
    popoverTarget = null;
    tip.hide();
    if (next !== state) {
      state = next;
      refresh();
    }
  }
  // The button lives inside the tooltip; a tap anywhere else dismisses the popover.
  tooltipEl.addEventListener("click", (e) => {
    if ((e.target as Element)?.closest?.(".tip-commit")) commitPopover();
  });
  document.addEventListener("pointerdown", (e) => {
    if (popoverTarget && !tooltipEl.contains(e.target as Node)) {
      popoverTarget = null;
      tip.hide();
    }
  });
```

Note on the disabled button: a `<button disabled>` does not fire `click`, so `commitPopover` only runs for a legal (enabled) target. An outside tap clears the popover.

- [ ] **Step 6: Style the commit button**

Append to `web/src/styles.css`:

```css
/* Touch popover commit button (only present in the interactive popover, not the passive hover tooltip). */
.tip-commit {
  display: block;
  margin-top: 0.5rem;
  width: 100%;
  background: #21262d;
  color: #e6edf3;
  border: 1px solid #6cb6ff;
  border-radius: 6px;
  padding: 0.4rem 0.75rem;
  font-size: 0.85rem;
  cursor: pointer;
}
.tip-commit:disabled {
  border-color: #30363d;
  color: #6e7681;
  cursor: not-allowed;
}
```

- [ ] **Step 7: Run e2e to verify it passes**

Run: `just e2e`
Expected: PASS, including the three popover checks. The desktop checks still pass: those run before touch emulation is enabled, so `isTouch()` is false and a tap commits as before.

- [ ] **Step 8: Run the full check gate**

Run: `just check`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add web/src/adapters/svgRenderer.ts web/src/adapters/tooltipView.ts web/src/app/main.ts web/src/styles.css web/e2e/smoke.ts
git commit -m "feat(ui): touch tap-to-inspect popover with explicit Add/Remove commit"
```

---

## Final verification

- [ ] **Run the whole suite and gates**

Run: `just check` then `just e2e`
Expected: unit suite green (including the two new pure-module test files), e2e green (including the tooltip-leave, drawer, pinch, double-tap, and popover checks).

- [ ] **Manual smoke (optional)**

Run: `just serve`, open `http://localhost:5173`, narrow the window below ~1000px: sidebars collapse, corner toggles appear, tapping one slides the drawer over the map, the scrim closes it. In a touch-emulating browser devtools session: tap a star to inspect, tap Add to commit, pinch to zoom, double-tap to refit.

## Self-Review notes

- Spec coverage: unit 1 -> Task 4 (+ Reset view removal moved into Task 4 with the header changes; the double-tap replacement lands in Task 5); unit 2 -> Task 5; unit 3 -> Task 6; unit 4 -> Task 1. Two pure modules (Tasks 2, 3) back the spec's "pure DOM-free logic" requirement and its unit-test list. The e2e additions cover the spec's listed e2e (drawers, pinch, double-tap, tap-inspect).
- Breakpoint implemented via matchMedia + `body.narrow` rather than duplicated `@media` blocks, because the threshold depends on compare mode; this is documented inline and is still width-keyed (the spec's intent).
- Modality is checked live (`isTouch()` per interaction) rather than cached, so the emulated e2e and real hybrid devices behave correctly.
- URL hash format and `core/` engine are untouched; the two new `core/` files are pure and import only types plus existing pure code.
