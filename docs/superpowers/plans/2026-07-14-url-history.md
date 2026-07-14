# History-Aware URL State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Back/Forward traverse planner states, bookmark clicks and hand-edited hashes apply to the open app, and the points-bar drag or arrow-key burst costs one history entry per gesture.

**Architecture:** All changes live in `web/src/app/main.ts` (the wiring hub) plus e2e coverage in `web/e2e/smoke.ts`. `refresh()` gains a `"push" | "replace"` URL mode with a dedupe guard; the boot-time decode-and-repair block is extracted into `applyHash()` and reused by a new `hashchange` listener; the points bar routes `"replace"` through `setCap()` mid-gesture.

**Tech Stack:** Vanilla TypeScript, Bun, `just` task runner, CDP-driven headless-Chromium e2e.

**Spec:** `docs/superpowers/specs/2026-07-14-url-history-design.md`

## Global Constraints

- The hash format does not change: `web/src/core/urlState.ts` (`encodeHash`/`decodeHash`) must not be modified. Existing bookmarks must decode to identical state.
- Locale stays out of the hash (existing invariant, unaffected).
- No new user-facing strings, so no i18n catalog keys are needed.
- No new dependencies.
- Use `just` recipes, never raw tool invocations: `just check` (format, unit tests, lint, typecheck), `just e2e` (builds dist, then runs the smoke test).
- Match surrounding code style; never rewrite unrelated code. `main.ts` and `smoke.ts` already have ABOUTME headers; no new files are created.
- The keyboard coalescing window is exactly 500 ms, measured with `e.timeStamp` (monotonic, no wall clock).

---

### Task 1: Discrete actions push history entries; hashchange applies incoming hashes

**Files:**
- Modify: `web/src/app/main.ts:91-111` (extract `applyHash`), `web/src/app/main.ts:557` (refresh signature), `web/src/app/main.ts:632-638` (URL write), `web/src/app/main.ts:757` (boot call + listener)
- Test: `web/e2e/smoke.ts` (insert before the `// --- Narrow viewport + touch emulation` comment, currently line 393)

**Interfaces:**
- Consumes: existing `decodeHash`, `encodeHash`, `repairSelection`, `refresh()` internals (unchanged).
- Produces: `function refresh(urlMode: "push" | "replace" = "push"): void` and `function applyHash(hash: string): void`. Task 2 relies on the `refresh` signature exactly as written here.

- [ ] **Step 1: Write the failing e2e checks**

In `web/e2e/smoke.ts`, immediately after the check `"Update Baseline exits compare mode and drops cs= from the URL"` (currently ends at line 391) and before the `// --- Narrow viewport + touch emulation (responsive drawers, gestures, popover) ---` comment, insert:

```ts
  // --- History-aware URL state (docs/superpowers/specs/2026-07-14-url-history-design.md) ---
  // Restore budget first: the earlier "empties" check parked the cap at the validity floor,
  // so nothing is selectable until End lifts it back to 55.
  await cdp.evaluate(
    `(() => { const b = document.getElementById('point-bar'); b.focus(); b.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); })()`,
  );
  await Bun.sleep(150);
  const hashBeforeClick = await cdp.evaluate<string>("location.hash");
  const histStar = await cdp.evaluate<string>(
    "document.querySelector('circle.hit.selectable:not(.selected)')?.getAttribute('data-star-id') || ''",
  );
  check(histStar.length > 0, "history: found a selectable star to click");
  await cdp.evaluate(
    `document.querySelector('circle[data-star-id="${histStar}"]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))`,
  );
  await Bun.sleep(150);
  check(
    (await cdp.evaluate<string>("location.hash")) !== hashBeforeClick,
    "history: clicking a star changes the hash",
  );
  await cdp.evaluate("history.back()");
  await Bun.sleep(300);
  check(
    (await cdp.evaluate<string>("location.hash")) === hashBeforeClick,
    "history: Back reverts the hash to the pre-click state",
  );
  check(
    await cdp.evaluate<boolean>(
      `(() => { const c = document.querySelector('circle[data-star-id="${histStar}"]'); return !!c && !c.classList.contains('selected'); })()`,
    ),
    "history: Back deselects the star (the app applied the old hash)",
  );
  await cdp.evaluate("history.forward()");
  await Bun.sleep(300);
  check(
    await cdp.evaluate<boolean>(
      `!!document.querySelector('circle[data-star-id="${histStar}"]')?.classList.contains('selected')`,
    ),
    "history: Forward reselects the star",
  );
  // A live "bookmark click": assigning a bookmarked hash applies it to the open app.
  const hashSelected = await cdp.evaluate<string>("location.hash");
  await cdp.evaluate("history.back()");
  await Bun.sleep(300);
  await cdp.evaluate(`location.hash = "${hashSelected.slice(1)}"`);
  await Bun.sleep(300);
  check(
    await cdp.evaluate<boolean>(
      `!!document.querySelector('circle[data-star-id="${histStar}"]')?.classList.contains('selected')`,
    ),
    "history: assigning a bookmarked hash applies it to the open app",
  );
```

Note the optional chaining (`?.classList`) in every selector that runs after a history navigation: pre-implementation, `history.back()` leaves the app page entirely (the app never pushed an entry, so Back lands on `about:blank`), and these checks must fail cleanly rather than throw.

- [ ] **Step 2: Run the e2e to verify the new checks fail**

Run: `just e2e`

Expected: `E2E FAIL`. The checks from "history: Back reverts the hash" onward FAIL (Back navigates off the app page because no planner entries exist yet). Later pre-existing checks (narrow viewport section onward) may cascade-fail for the same reason; that is expected only at this step. The pre-existing checks BEFORE the new block must still pass.

- [ ] **Step 3: Extract `applyHash()` from the boot decode block**

In `web/src/app/main.ts`, replace lines 91-111:

```ts
  // Restore state from the URL hash if present (validated so a stale link can't be invalid).
  const canonical = canonicalStarIds(model);
  const statCanonical = canonicalStatIds(model);
  const benefitCanonical = canonicalBenefitIds(model);
  const restored = decodeHash(location.hash, canonical, benefitCanonical);
  let state: SelectionState = restored
    ? {
        selected: repairSelection(model, cons, table, restored.selected, restored.pointCap),
        pointCap: restored.pointCap,
      }
    : { selected: new Set(), pointCap: 55 };
  // The cap can never be below the points actually allocated; raise it if a restored
  // link is over budget (the slider also enforces this floor below).
  state = { selected: state.selected, pointCap: Math.max(state.pointCap, state.selected.size) };
  // Baseline for the comparison mode: null when not comparing.
  let baseline: SelectionState | null = restored?.baseline ?? null;
  // The finite cap to fall back to when the user re-imposes the limit after going uncapped.
  let lastFiniteCap = Number.isFinite(state.pointCap) ? state.pointCap : 55;
  // Benefit "tags": the raw stat ids selected in the Benefits panel; they highlight the
  // matching map nodes and are persisted in the URL so a shared link restores them.
  const selectedBenefits = new Set<string>(restored?.benefits ?? []);
```

with:

```ts
  // Restore state from the URL hash if present (validated so a stale link can't be invalid).
  const canonical = canonicalStarIds(model);
  const statCanonical = canonicalStatIds(model);
  const benefitCanonical = canonicalBenefitIds(model);
  let state: SelectionState = { selected: new Set(), pointCap: 55 };
  // Baseline for the comparison mode: null when not comparing.
  let baseline: SelectionState | null = null;
  // The finite cap to fall back to when the user re-imposes the limit after going uncapped.
  let lastFiniteCap = 55;
  // Benefit "tags": the raw stat ids selected in the Benefits panel; they highlight the
  // matching map nodes and are persisted in the URL so a shared link restores them.
  const selectedBenefits = new Set<string>();
  // Decode and repair a hash into planner state. Runs at boot and on every hashchange
  // (Back/Forward, bookmark clicks, hand-edited URLs); an undecodable hash is the empty build.
  function applyHash(hash: string): void {
    const restored = decodeHash(hash, canonical, benefitCanonical);
    state = restored
      ? {
          selected: repairSelection(model, cons, table, restored.selected, restored.pointCap),
          pointCap: restored.pointCap,
        }
      : { selected: new Set(), pointCap: 55 };
    // The cap can never be below the points actually allocated; raise it if a restored
    // link is over budget (the slider also enforces this floor below).
    state = { selected: state.selected, pointCap: Math.max(state.pointCap, state.selected.size) };
    baseline = restored?.baseline ?? null;
    if (Number.isFinite(state.pointCap)) lastFiniteCap = state.pointCap;
    selectedBenefits.clear();
    for (const b of restored?.benefits ?? []) selectedBenefits.add(b);
  }
  applyHash(location.hash);
```

Boot semantics are unchanged: `lastFiniteCap` starts at 55 and is only overwritten by a finite restored cap, which is exactly what the old ternary produced. Mid-session, an uncapped incoming hash keeps the previously remembered finite cap.

- [ ] **Step 4: Give `refresh()` the URL mode and dedupe guard**

Change the signature at `web/src/app/main.ts:557` from:

```ts
  function refresh() {
```

to:

```ts
  function refresh(urlMode: "push" | "replace" = "push") {
```

Replace the URL write at the end of `refresh()` (currently lines 632-638):

```ts
    renderPointBar();
    history.replaceState(
      null,
      "",
      `#${encodeHash(state.selected, state.pointCap, canonical, selectedBenefits, benefitCanonical, baseline)}`,
    );
  }
```

with:

```ts
    renderPointBar();
    const next = `#${encodeHash(state.selected, state.pointCap, canonical, selectedBenefits, benefitCanonical, baseline)}`;
    // Only touch history when the hash actually changed: no-op refreshes (language switch,
    // popover re-renders) must create no entry and leave the current one alone.
    if (next !== location.hash) {
      if (urlMode === "push") history.pushState(null, "", next);
      else history.replaceState(null, "", next);
    }
  }
```

All 15 existing `refresh()` call sites are discrete user actions and keep the `"push"` default; only the boot call changes (next step).

- [ ] **Step 5: Add the hashchange listener and make the boot call replace**

Replace the final boot call at `web/src/app/main.ts:757`:

```ts
  refresh();
}
```

with:

```ts
  // Back/Forward, bookmark clicks, and hand-edited URLs land here; our own pushState/replaceState
  // calls never fire hashchange, so there is no feedback loop. After applying, canonicalize in
  // place: a repaired or non-canonical incoming hash must not mint an extra entry.
  window.addEventListener("hashchange", () => {
    applyHash(location.hash);
    refresh("replace");
  });

  refresh("replace"); // boot render; canonicalize the URL without creating a history entry
}
```

- [ ] **Step 6: Run the e2e to verify the new checks pass**

Run: `just e2e`

Expected: `E2E PASS`, all checks green, including every pre-existing check (the touch/narrow section must be back to passing) and `no console errors or page exceptions`.

- [ ] **Step 7: Run the full gate**

Run: `just check`

Expected: format clean, all unit tests pass (373+), lint clean, typecheck clean. The unit suite does not cover `main.ts`, so failures here would indicate an accidental touch of shared code.

- [ ] **Step 8: Commit**

```bash
git add web/src/app/main.ts web/e2e/smoke.ts
git commit -F - <<'EOF'
feat(history): Back/Forward traverse planner states; live hash edits apply
EOF
```

---

### Task 2: One history entry per points-bar drag or arrow-key burst

**Files:**
- Modify: `web/src/app/main.ts:430-433` (`setCap`), `web/src/app/main.ts:459-461` (`onBarMove`), `web/src/app/main.ts:476-486` (bar keydown)
- Test: `web/e2e/smoke.ts` (append inside the history block added in Task 1, still before the narrow-emulation comment)

**Interfaces:**
- Consumes: `refresh(urlMode: "push" | "replace" = "push")` from Task 1.
- Produces: `function setCap(cap: number, urlMode: "push" | "replace" = "push"): void`. Nothing later depends on it; the bar's `pointerdown` and `keydown` handlers are its only callers.

- [ ] **Step 1: Write the failing e2e checks**

In `web/e2e/smoke.ts`, at the end of the history block added in Task 1 (after the "assigning a bookmarked hash" check, still before the `// --- Narrow viewport + touch emulation` comment), insert:

```ts
  // A pointer drag on the point bar is ONE history entry: pointerdown pushes, moves replace.
  // One Back therefore restores the pre-drag cap; landing mid-drag would mean the moves pushed.
  const capBeforeDrag = await cdp.evaluate<string>("document.getElementById('cap-toggle').textContent");
  await cdp.evaluate(`(() => {
    const b = document.getElementById('point-bar');
    const r = b.getBoundingClientRect();
    const y = r.top + r.height / 2;
    const x = (f) => r.left + r.width * f;
    b.dispatchEvent(new PointerEvent('pointerdown', { clientX: x(0.6), clientY: y, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: x(0.7), clientY: y, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: x(0.8), clientY: y, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: x(0.8), clientY: y, bubbles: true }));
  })()`);
  await Bun.sleep(150);
  const capAfterDrag = await cdp.evaluate<string>("document.getElementById('cap-toggle').textContent");
  check(capAfterDrag !== capBeforeDrag, `history: dragging the point bar moves the cap (${capBeforeDrag} -> ${capAfterDrag})`);
  await cdp.evaluate("history.back()");
  await Bun.sleep(300);
  check(
    (await cdp.evaluate<string>("document.getElementById('cap-toggle').textContent")) === capBeforeDrag,
    "history: one Back undoes the whole drag gesture (moves replaced, not pushed)",
  );
  check(
    await cdp.evaluate<boolean>(
      `!!document.querySelector('circle[data-star-id="${histStar}"]')?.classList.contains('selected')`,
    ),
    "history: Back after the drag does not overshoot into earlier states",
  );
  // A rapid arrow-key burst coalesces into one entry: the first press pushes, the rest replace.
  const capBeforeKeys = await cdp.evaluate<string>("document.getElementById('cap-toggle').textContent");
  await cdp.evaluate(`(() => {
    const b = document.getElementById('point-bar');
    b.focus();
    for (let i = 0; i < 3; i++) b.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  })()`);
  await Bun.sleep(150);
  check(
    (await cdp.evaluate<string>("document.getElementById('cap-toggle').textContent")) === String(Number(capBeforeKeys) - 3),
    "history: three quick ArrowLefts lower the cap by 3",
  );
  await cdp.evaluate("history.back()");
  await Bun.sleep(300);
  check(
    (await cdp.evaluate<string>("document.getElementById('cap-toggle').textContent")) === capBeforeKeys,
    "history: one Back undoes the whole key burst (presses coalesced)",
  );
```

- [ ] **Step 2: Run the e2e to verify the new checks fail**

Run: `just e2e`

Expected: `E2E FAIL`. With Task 1 in place every drag move and key press pushes its own entry, so `"one Back undoes the whole drag gesture"` FAILS (Back lands on the mid-drag cap) and `"one Back undoes the whole key burst"` FAILS (Back lands one press earlier). The two setup checks ("moves the cap", "lower the cap by 3") and everything before the new lines still pass.

- [ ] **Step 3: Route a URL mode through `setCap` and the bar handlers**

In `web/src/app/main.ts`, change `setCap` (currently lines 430-433):

```ts
  function setCap(cap: number): void {
    state = { selected: state.selected, pointCap: cap };
    refresh();
  }
```

to:

```ts
  function setCap(cap: number, urlMode: "push" | "replace" = "push"): void {
    state = { selected: state.selected, pointCap: cap };
    refresh(urlMode);
  }
```

Change `onBarMove` (currently lines 459-461):

```ts
  const onBarMove = (e: PointerEvent) => {
    if (dragging) setCap(capFromClientX(e.clientX));
  };
```

to:

```ts
  const onBarMove = (e: PointerEvent) => {
    // Mid-drag caps replace: the pointerdown already pushed this gesture's single entry.
    if (dragging) setCap(capFromClientX(e.clientX), "replace");
  };
```

The bar's `pointerdown` handler is untouched: its `setCap(capFromClientX(e.clientX))` keeps the `"push"` default, which is the one entry the gesture gets.

Change the bar's `keydown` handler (currently lines 476-486):

```ts
  barEl.addEventListener("keydown", (e) => {
    if (!Number.isFinite(state.pointCap)) return;
    let c = state.pointCap as number;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") c -= 1;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") c += 1;
    else if (e.key === "Home") c = curMin;
    else if (e.key === "End") c = MAX_POINTS;
    else return;
    e.preventDefault();
    setCap(Math.max(curMin, Math.min(MAX_POINTS, c)));
  });
```

to:

```ts
  // Coalesce key bursts into one history entry: the first press pushes, presses within
  // 500 ms of the previous one replace that entry, so a held arrow key is one Back step.
  let lastCapKeyAt = 0;
  barEl.addEventListener("keydown", (e) => {
    if (!Number.isFinite(state.pointCap)) return;
    let c = state.pointCap as number;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") c -= 1;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") c += 1;
    else if (e.key === "Home") c = curMin;
    else if (e.key === "End") c = MAX_POINTS;
    else return;
    e.preventDefault();
    const mode = e.timeStamp - lastCapKeyAt < 500 ? "replace" : "push";
    lastCapKeyAt = e.timeStamp;
    setCap(Math.max(curMin, Math.min(MAX_POINTS, c)), mode);
  });
```

`e.timeStamp` is a monotonic DOMHighResTimeStamp (ms since page load), so no wall-clock reads; the initial `lastCapKeyAt = 0` makes the first-ever press push, as it must.

- [ ] **Step 4: Run the e2e to verify the checks pass**

Run: `just e2e`

Expected: `E2E PASS`, all checks green including `no console errors or page exceptions`.

- [ ] **Step 5: Run the full gate**

Run: `just check`

Expected: format clean, all unit tests pass, lint clean, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/main.ts web/e2e/smoke.ts
git commit -F - <<'EOF'
feat(history): one history entry per point-bar drag or arrow-key burst
EOF
```
