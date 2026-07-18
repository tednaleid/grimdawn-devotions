# Compare Swap Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Swap button in the compare controls row that exchanges the live build and the baseline (selection and point cap) in place, keeping the comparison active.

**Architecture:** A new `cmp-swap` branch in `onBenefitClick` in `web/src/app/main.ts` swaps the `state` and `baseline` objects and calls `refresh()`. Everything else falls out of existing machinery: `encodeHash` writes `s=`/`p=` from the live state and `cs=`/`cp=` from the baseline (so the pairs exchange automatically), and `refresh()` pushes one history entry only when the hash changed (so swapping identical builds is a natural no-op). The button renders in the compare branch of `renderBenefits` in `web/src/adapters/sidebarView.ts`.

**Tech Stack:** Vanilla TypeScript, Bun test, headless-Chromium e2e over CDP, `just` task runner.

**Spec:** `docs/superpowers/specs/2026-07-18-compare-swap-design.md`

## Global Constraints

- The button label is "Swap" via new catalog key `ui.compare.swap`. No user-facing string may be hardcoded in app code (i18n invariant, enforced by `web/test/i18nBoundary.test.ts`); every new key goes in all 13 catalogs (`web/src/i18n/app.<locale>.json`) plus the `REQUIRED` list in `web/test/appCatalog.test.ts`.
- All planner state must round-trip through `web/src/core/urlState.ts`. This feature requires NO changes there; do not modify it.
- No emojis. Match surrounding code style exactly (string-concatenation HTML in sidebarView, template-literal CDP snippets in smoke.ts).
- The pre-commit hook runs the full gate (`just check`: format, all tests, lint, typecheck, about 90 seconds). Every commit must pass it; never use `--no-verify`.
- Run single test files during TDD with `cd web && bun test <name>`; the e2e is `just e2e` (requires `just install-e2e` once and a built site; `just e2e` handles the build).

---

### Task 1: Catalog key `ui.compare.swap` in all locales

**Files:**
- Modify: `web/test/appCatalog.test.ts:76` (the `REQUIRED` list)
- Modify: `web/src/i18n/app.en.json:33` and the 12 other `web/src/i18n/app.*.json` catalogs

**Interfaces:**
- Produces: catalog key `ui.compare.swap` (plain string, no placeholders), resolvable via `loc.translate("ui.compare.swap")`. Task 2 consumes it.

- [ ] **Step 1: Write the failing test**

In `web/test/appCatalog.test.ts`, add one line to the `REQUIRED` array, after `"ui.compare.setBaseline",`:

```ts
  "ui.compare.setBaseline",
  "ui.compare.swap",
  "ui.compare.base",
```

(The `"ui.compare.base",` line already exists; the insertion is the middle line.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun test appCatalog`
Expected: FAIL, one failing expect per catalog (13 locales), because `cat["ui.compare.swap"]` is undefined.

- [ ] **Step 3: Add the key to all 13 catalogs**

In `web/src/i18n/app.en.json`, the `ui.compare` block is NOT alphabetized; insert after `"ui.compare.setBaseline": "Set baseline",`:

```json
  "ui.compare.setBaseline": "Set baseline",
  "ui.compare.swap": "Swap",
```

The other 12 catalogs ARE alphabetized within the block; in each, insert between `"ui.compare.setBaseline"` and `"ui.compare.updateBaseline"`:

| File | Line to insert |
|---|---|
| `app.cs.json` | `"ui.compare.swap": "Prohodit",` |
| `app.de.json` | `"ui.compare.swap": "Tauschen",` |
| `app.es.json` | `"ui.compare.swap": "Intercambiar",` |
| `app.fr.json` | `"ui.compare.swap": "Échanger",` |
| `app.it.json` | `"ui.compare.swap": "Scambia",` |
| `app.ja.json` | `"ui.compare.swap": "入れ替え",` |
| `app.ko.json` | `"ui.compare.swap": "맞바꾸기",` |
| `app.pl.json` | `"ui.compare.swap": "Zamień",` |
| `app.pt.json` | `"ui.compare.swap": "Trocar",` |
| `app.ru.json` | `"ui.compare.swap": "Поменять местами",` |
| `app.vi.json` | `"ui.compare.swap": "Hoán đổi",` |
| `app.zh.json` | `"ui.compare.swap": "交换",` |

Each translation matches the grammatical style of that catalog's existing compare buttons (imperative in pl/it, infinitive in pt/fr/es, noun form in ja/ko).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun test appCatalog`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/test/appCatalog.test.ts web/src/i18n/app.cs.json web/src/i18n/app.de.json web/src/i18n/app.en.json web/src/i18n/app.es.json web/src/i18n/app.fr.json web/src/i18n/app.it.json web/src/i18n/app.ja.json web/src/i18n/app.ko.json web/src/i18n/app.pl.json web/src/i18n/app.pt.json web/src/i18n/app.ru.json web/src/i18n/app.vi.json web/src/i18n/app.zh.json
git commit -F - <<'EOF'
feat(compare): ui.compare.swap catalog key in all locales
EOF
```

---

### Task 2: Swap button renders in the compare controls row

**Files:**
- Modify: `web/test/compare-render.test.ts`
- Modify: `web/src/adapters/sidebarView.ts:180-183` (the `controls` string in the compare branch of `renderBenefits`)
- Modify: `web/src/styles.css:433-465` (the `.cmp-controls` rules)

**Interfaces:**
- Consumes: catalog key `ui.compare.swap` from Task 1.
- Produces: a `<button id="cmp-swap" type="button">` inside the `cmp-controls` row, rendered only in compare mode. Task 3's click handler and e2e target this id.

- [ ] **Step 1: Write the failing tests**

In `web/test/compare-render.test.ts`:

Update the second ABOUTME line (line 2), which still names the old "Keep" button, to the current controls:

```ts
// ABOUTME: Swap / Revert / Update Baseline controls. Tag attributes stay on the subject name and value cells.
```

In the off-mode test, add one assertion after the `cmp-bar` one:

```ts
  expect(html).not.toContain("cmp-bar");
  expect(html).not.toContain('id="cmp-swap"');
```

Rename the compare-mode test and add one assertion after the `cmp-update` one:

```ts
test("compare mode renders the bar, Swap / Revert / Update Baseline controls, and Base/Now/Delta cells", () => {
  const html = render(new Set([starGranting("offensiveTotalDamageModifier")]), new Set());
  expect(html).toContain("cmp-bar");
  expect(html).toContain('id="cmp-revert"');
  expect(html).toContain('id="cmp-update"');
  expect(html).toContain('id="cmp-swap"');
  expect(html).not.toContain('id="cmp-clear"');
  expect(html).toContain("brow-v base"); // the Base cell
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun test compare-render`
Expected: FAIL on `expect(html).toContain('id="cmp-swap"')` in the compare-mode test (the off-mode assertion already passes).

- [ ] **Step 3: Render the button**

In `web/src/adapters/sidebarView.ts`, the compare branch currently builds:

```ts
    const controls =
      `<div class="cmp-controls"><span class="cmp-spacer"></span>` +
      `<span class="cmp-revert-slot"><button id="cmp-revert" type="button">${loc.translate("ui.compare.revert")}</button></span>` +
      `<span class="cmp-upd-slot"><button id="cmp-update" type="button">${loc.translate("ui.compare.updateBaseline")}</button></span></div>`;
```

Replace with (Swap slot first, before the flex spacer, so the existing Revert/Update column alignment is untouched):

```ts
    const controls =
      `<div class="cmp-controls"><span class="cmp-swap-slot"><button id="cmp-swap" type="button">${loc.translate("ui.compare.swap")}</button></span>` +
      `<span class="cmp-spacer"></span>` +
      `<span class="cmp-revert-slot"><button id="cmp-revert" type="button">${loc.translate("ui.compare.revert")}</button></span>` +
      `<span class="cmp-upd-slot"><button id="cmp-update" type="button">${loc.translate("ui.compare.updateBaseline")}</button></span></div>`;
```

- [ ] **Step 4: Style the slot and button**

In `web/src/styles.css`, update the comment above `.cmp-controls` (line 433):

```css
/* compare control row: Swap at the left, Revert over Base, Update Baseline over Now+Delta */
```

Add a slot rule after the `.cmp-controls .cmp-spacer` block:

```css
.cmp-controls .cmp-swap-slot {
  width: 64px;
  text-align: center;
}
```

Add a button rule after the `#cmp-update` block:

```css
#cmp-swap {
  width: 60px;
  color: #6cb6ff;
}
```

(`#6cb6ff` is the app's existing interactive blue, used for hover/selection in the benefit rows; Swap is a view action, not an adopt-a-column action like the gold Revert and green Update Baseline.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && bun test compare-render`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add web/test/compare-render.test.ts web/src/adapters/sidebarView.ts web/src/styles.css
git commit -F - <<'EOF'
feat(compare): Swap button renders in the compare controls row
EOF
```

---

### Task 3: Swap handler exchanges live build and baseline

**Files:**
- Modify: `web/src/app/main.ts:396-401` (the `onBenefitClick` handler, after the `cmp-update` branch)
- Modify: `web/e2e/smoke.ts:391` (insert after the "Update Baseline exits compare mode" check, before the history section)

**Interfaces:**
- Consumes: the `cmp-swap` button id from Task 2; the module-level `state: SelectionState` and `baseline: SelectionState | null` and `refresh()` already in `main.ts`.
- Produces: the complete user-facing feature; nothing downstream consumes it.

- [ ] **Step 1: Write the failing e2e checks**

`main.ts` is wiring with no unit-test harness; the e2e smoke is its test (the same convention `cmp-revert`/`cmp-update` follow). In `web/e2e/smoke.ts`, insert after the `"Update Baseline exits compare mode and drops cs= from the URL"` check and before the `// --- History-aware URL state` section:

```ts
  // Swap: exchanges the live build and the baseline in place; the comparison stays active
  // (docs/superpowers/specs/2026-07-18-compare-swap-design.md). Restore the budget first:
  // the cap is still parked at the validity floor from the "empties" check above.
  await cdp.evaluate(
    `(() => { const b = document.getElementById('point-bar'); b.focus(); b.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); })()`,
  );
  await Bun.sleep(150);
  await cdp.evaluate(`document.getElementById('set-baseline').click()`);
  for (let i = 0; i < 20; i++) {
    await Bun.sleep(100);
    if (await cdp.evaluate<boolean>("document.querySelector('.cmp-bar') !== null")) break;
  }
  // Diverge the live build from the baseline in both dimensions: add a star, drop the cap by one.
  const swapStar = await cdp.evaluate<string>(
    "document.querySelector('circle.hit.selectable:not(.selected)')?.getAttribute('data-star-id') || ''",
  );
  check(swapStar.length > 0, "swap: found a selectable star to diverge the live build");
  await cdp.evaluate(
    `document.querySelector('circle[data-star-id="${swapStar}"]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))`,
  );
  await Bun.sleep(150);
  await cdp.evaluate(
    `(() => { const b = document.getElementById('point-bar'); b.focus(); b.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); })()`,
  );
  await Bun.sleep(150);
  const readParam = (k: string) =>
    cdp.evaluate<string>(`new URLSearchParams(location.hash.slice(1)).get('${k}') || ''`);
  const sPre = await readParam("s");
  const csPre = await readParam("cs");
  const pPre = await readParam("p");
  const cpPre = await readParam("cp");
  check(sPre !== csPre && pPre !== cpPre, "swap: live build and baseline differ before the swap");
  await cdp.evaluate(`document.getElementById('cmp-swap').click()`);
  await Bun.sleep(150);
  check((await readParam("s")) === csPre && (await readParam("cs")) === sPre, "Swap exchanges s= and cs= in the URL");
  check((await readParam("p")) === cpPre && (await readParam("cp")) === pPre, "Swap exchanges p= and cp= in the URL");
  check(await cdp.evaluate<boolean>("document.querySelector('.cmp-bar') !== null"), "Swap keeps the comparison active");
  await cdp.evaluate(`document.getElementById('cmp-swap').click()`);
  await Bun.sleep(150);
  check(
    (await readParam("s")) === sPre && (await readParam("cs")) === csPre,
    "Swap again restores the original orientation",
  );
  // Exit compare and restore the pre-swap build so the sections below start from the same state.
  await cdp.evaluate(`document.getElementById('cmp-revert').click()`);
  await Bun.sleep(150);
```

- [ ] **Step 2: Run e2e to verify it fails**

Run: `just e2e`
Expected: FAIL at `"Swap exchanges s= and cs= in the URL"` (the button exists from Task 2 but clicking it does nothing).

- [ ] **Step 3: Implement the handler**

In `web/src/app/main.ts`, `onBenefitClick` currently ends its button branches with:

```ts
    if (t.id === "cmp-update") {
      // Adopt the live (Now) build and exit compare.
      baseline = null;
      refresh();
      return;
    }
```

Add after that branch:

```ts
    if (t.id === "cmp-swap" && baseline) {
      // Swap: the baseline becomes the live build and vice versa; the comparison stays active.
      // refresh() pushes one history entry, or none when the two builds are identical (hash unchanged).
      const live = state;
      state = { selected: new Set(baseline.selected), pointCap: baseline.pointCap };
      baseline = { selected: new Set(live.selected), pointCap: live.pointCap };
      refresh();
      return;
    }
```

Fresh `Set` copies on both sides keep the baseline snapshot from ever aliasing the live selection set, which other handlers mutate in place.

- [ ] **Step 4: Run e2e to verify it passes**

Run: `just e2e`
Expected: PASS, including the five new swap checks.

- [ ] **Step 5: Run the full gate**

Run: `just check`
Expected: format no fixes, all tests pass, lint clean, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/main.ts web/e2e/smoke.ts
git commit -F - <<'EOF'
feat(compare): Swap exchanges the live build and the baseline
EOF
```

---

## Final verification (after all tasks)

Browser check via `just serve` (drive with the playwright-cli skill or by hand), loading a comparison link such as `http://localhost:5173/#p=55&s=...&cs=...&cp=55`:

- Swap: the map flips to the former baseline build, the Base and Now columns exchange values, the delta column and map diff outlines flip sign, the comparison stays active.
- Swap again: original orientation restored.
- Back after one swap: undoes the swap (one history entry per swap).
- Set baseline then Swap immediately (identical builds): nothing changes and Back does NOT land on a duplicate entry (no-op swap pushes nothing).
- Copy the URL after a swap into a new tab: the swapped state restores exactly (shareable-URL invariant).
