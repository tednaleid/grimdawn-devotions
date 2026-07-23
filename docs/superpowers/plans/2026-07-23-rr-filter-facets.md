# RR filter facets — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the resistance-reduction page's five filter dropdowns and the broken group-by with a text search plus three button facets (damage type, reduction, category), multi-select with OR-within / AND-across semantics.

**Architecture:** Pure core (`ViewState` + `filter`) holds facet sets and the fold-in/coarse logic; the adapter (`tableView`) renders chips and wires toggles; `main.ts` stays a thin wiring layer. All view state round-trips through the URL hash.

**Tech Stack:** TypeScript, Bun test, biome, the existing RR hexagonal layout under `web/src/rr/`.

**Design spec:** `docs/superpowers/specs/2026-07-23-rr-filter-facets-design.md` (read it first; it fixes the facet model, the damage fold-in, the coarse category table, and the hash encoding).

## Global Constraints

- URL-state invariant: every filter round-trips through `encodeHash`/`decodeHash` and tolerates stale/malformed links. No view state outside the hash.
- i18n invariant: no hardcoded user-facing string; every label is a catalog key, guarded by `web/test/appCatalog.test.ts`.
- ABOUTME header on any new file; match surrounding style; smallest reasonable change; run `just check` (pre-commit) before each commit; never `--no-verify`.
- Coarse category keys are `devotion | skill | item`. Reduction values are `stacking | reduced-percent | reduced-flat`. Damage tokens are the resistance strings as stored on sources.

## File Structure

- `web/src/rr/core/urlState.ts` — `ViewState` facet fields become `Set<string>`; drop `fPar`/`fTrig`/`group`; hash codec gains multi-select encode/decode with per-facet validation.
- `web/src/rr/core/filter.ts` — `matchesFilters` goes multi-select; add `coarseCategory`; drop `fPar`/`fTrig`; delete `groupView` (flat list).
- `web/src/rr/adapters/tableView.ts` — dropdown skeleton/sync/wire become the chip bar; body renders a flat sorted list; add reset + live count.
- `web/src/rr/app/main.ts` — drop group/`parentKeyOf` plumbing; render the flat list.
- `web/src/rr/rr.css` — chip styles (port from the mockup); remove dropdown-only rules.
- `web/src/i18n/app.en.json` + `web/test/appCatalog.test.ts` — add `rr.coarse.*`, `rr.ctl.reset`; reword `rr.ctl.category`; remove dead keys.
- Tests: `web/test/rr/urlState.test.ts`, `filter.test.ts`, `tableView.test.ts`, `appCatalog.test.ts`, `web/e2e/rr-smoke.ts`.

---

### Task 1: ViewState + hash codec for multi-select facets

**Files:**
- Modify: `web/src/rr/core/urlState.ts`
- Test: `web/test/rr/urlState.test.ts`

**Interfaces:**
- Produces: `ViewState` with `fType: Set<string>`, `fRR: Set<string>`, `fCat: Set<string>`; fields `fPar`, `fTrig`, `group` removed. `encodeHash(view)` / `decodeHash(hash, knownIds)` unchanged signatures.
- Consumes: nothing new.

- [ ] **Step 1: Write failing tests.** In `urlState.test.ts` add:
  - round-trip: a view with `fType={"Fire","Cold"}`, `fRR={"stacking"}`, `fCat={"item","skill"}` survives `decodeHash(encodeHash(v), known)` as equal sets.
  - stale single value: `decodeHash("#type=Fire&rr=stacking&cat=devotion", known)` yields `fType={"Fire"}`, `fRR={"stacking"}`, `fCat={"devotion"}`.
  - tolerance: `decodeHash("#type=Fire,Bogus&cat=item%20granted&par=x&trig=y&group=item", known)` drops `Bogus`, drops the old fine `item granted` (not a coarse value), and ignores `par`/`trig`/`group`, leaving `fType={"Fire"}`, `fCat` empty.
  - defaults: `DEFAULT_VIEW` has three empty sets and no `group`.

- [ ] **Step 2: Run tests, verify they fail** (`fPar` gone, sets not implemented). Run: `cd web && bun test test/rr/urlState.test.ts`.

- [ ] **Step 3: Implement.** Replace the three string facet fields with sets; drop `fPar`/`fTrig`/`group` from the interface and `DEFAULT_VIEW`. Define known-value guards:

```ts
const RR_VALUES = new Set(["stacking", "reduced-percent", "reduced-flat"]);
const CAT_VALUES = new Set(["devotion", "skill", "item"]);
const DMG_VALUES = new Set([
  "Physical", "Pierce", "Fire", "Cold", "Lightning",
  "Poison & Acid", "Aether", "Chaos", "Vitality", "Bleeding",
]);

function putSet(parts: string[], key: string, set: Set<string>): void {
  if (set.size) parts.push(`${key}=${[...set].map(encodeURIComponent).join(",")}`);
}
function readSet(val: string, allowed: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const raw of val.split(",")) {
    let t: string;
    try { t = decodeURIComponent(raw); } catch { continue; }
    if (allowed.has(t)) out.add(t);
  }
  return out;
}
```

  In `encodeHash`, replace the `put("type"/"rr"/"cat"/"par"/"trig")` calls with `putSet(parts, "type", view.fType)` etc. (three facets, no par/trig); drop the `group` line. In `decodeHash`, the `type`/`rr`/`cat` cases call `readSet(val, DMG_VALUES|RR_VALUES|CAT_VALUES)`; delete the `par`/`trig`/`group` cases. Keep `q`, `sort`, `r0`, `sel` exactly as they are.

- [ ] **Step 4: Run tests, verify pass.** `cd web && bun test test/rr/urlState.test.ts`.

- [ ] **Step 5: Commit.** `git add web/src/rr/core/urlState.ts web/test/rr/urlState.test.ts && git commit`.

---

### Task 2: Multi-select filter + coarse category, drop group

**Files:**
- Modify: `web/src/rr/core/filter.ts`
- Test: `web/test/rr/filter.test.ts`

**Interfaces:**
- Produces: `applyView(sources, view, nameOf, parentOf?)` unchanged signature but multi-select internally. `coarseCategory(fine: string): "devotion" | "skill" | "item"` exported. `groupView` deleted.
- Consumes: `sourceHits` from `./ledger` (unchanged), `ViewState` sets from Task 1.

- [ ] **Step 1: Write failing tests.** In `filter.test.ts`:
  - fold-in OR: `applyView(logical, view({ fType: new Set(["Fire"]) }), nameOf)` includes at least one source whose `resistances` is `"Elemental"` and one whose `resistances` is `"All"`, and every result satisfies `sourceHits(s, "Fire")`.
  - AND across: with `fType={"Fire"}` and `fCat={"devotion"}`, every result is `coarseCategory(s.category) === "devotion"` and hits Fire.
  - coarse mapping unit: `coarseCategory("relic") === "item"`, `coarseCategory("mastery skill") === "skill"`, `coarseCategory("modifier") === "skill"`, `coarseCategory("devotion") === "devotion"`, `coarseCategory("item skill modifier") === "item"`.
  - empty facet = no constraint: `fType=new Set()` returns all (subject to other facets).
  - update existing tests that passed `fRR: "stacking"` / `fType: "Fire"` strings to sets; delete the group-by test.

- [ ] **Step 2: Run tests, verify they fail.** `cd web && bun test test/rr/filter.test.ts`.

- [ ] **Step 3: Implement.**

```ts
const COARSE: Record<string, "devotion" | "skill" | "item"> = {
  devotion: "devotion",
  "mastery skill": "skill",
  modifier: "skill",
};
export function coarseCategory(fine: string): "devotion" | "skill" | "item" {
  return COARSE[fine] ?? "item";
}
```

  Rewrite `matchesFilters` to use sets:

```ts
function matchesFilters(s: LogicalSource, view: ViewState, nameOf: NameOf, parentOf: NameOf): boolean {
  if (view.fRR.size && !view.fRR.has(s.rrType)) return false;
  if (view.fCat.size && !view.fCat.has(coarseCategory(s.category))) return false;
  if (view.fType.size && ![...view.fType].some((t) => sourceHits(s, t))) return false;
  if (view.q) {
    const q = view.q.toLowerCase();
    const hay = `${nameOf(s)} ${parentOf(s)} ${s.category} ${s.resistances.join(" ")}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}
```

  Delete the `fPar`/`fTrig` checks and the entire `groupView` function.

- [ ] **Step 4: Run tests, verify pass.** `cd web && bun test test/rr/filter.test.ts`.

- [ ] **Step 5: Commit.**

---

### Task 3: i18n keys — add coarse + reset, remove dead keys

**Files:**
- Modify: `web/src/i18n/app.en.json`, `web/test/appCatalog.test.ts`

**Interfaces:**
- Produces catalog keys: `rr.coarse.devotion` = "Devotion", `rr.coarse.skill` = "Skill", `rr.coarse.item` = "Item", `rr.ctl.reset` = "Reset"; `rr.ctl.category` reworded to "Source".

- [ ] **Step 1: Update the guard first (failing).** In `appCatalog.test.ts` REQUIRED: add the four new keys; remove `rr.ctl.parent`, `rr.ctl.allParents`, `rr.ctl.trigger`, `rr.ctl.allTriggers`, `rr.ctl.allTypes`, `rr.ctl.allRr`, `rr.ctl.allCategories`, `rr.ctl.group`, `rr.group.none`, `rr.group.mastery`, `rr.group.constellation`, `rr.group.item`, `rr.group.ungrouped`.

- [ ] **Step 2: Run, verify fail** (`rr.coarse.*` missing from en.json). Run: `cd web && bun test test/appCatalog.test.ts`.

- [ ] **Step 3: Edit `app.en.json`.** Add the four keys; reword `rr.ctl.category` to "Source"; delete the removed keys listed above. Leave `rr.trigger.*` and `rr.badge.*` untouched (still used for display).

- [ ] **Step 4: Run, verify pass.** `cd web && bun test test/appCatalog.test.ts`. Then `cd web && bun test test/appCatalog.test.ts -t "stray"` context: the per-locale stray-key test will now flag any locale file that still carries a removed key — remove those from every `app.<locale>.json` too (they fail the "no stray keys" test otherwise).

- [ ] **Step 5: Commit.**

---

### Task 4: Chip-bar controls + flat table body

**Files:**
- Modify: `web/src/rr/adapters/tableView.ts`
- Modify: `web/src/rr/rr.css`
- Test: `web/test/rr/tableView.test.ts`

**Interfaces:**
- Produces: `renderTable(el, loc, all, sorted, view, handlers)` — the `groups` param becomes the flat `sorted: LogicalSource[]`. `bodyMarkup(loc, rows, view)` renders a flat list (no group heads). `triggerLabel`, `typesLabel` unchanged and still exported.
- Consumes: `ViewState` facet sets. The chips use fixed value lists and translate `rr.coarse.*` directly, so no import from `filter.ts` is needed (the fine category column is unchanged).

- [ ] **Step 1: Write failing tests.** In `tableView.test.ts`:
  - update `bodyMarkup` calls to the flat signature `bodyMarkup(loc, [nc], view)`; assert no `rr-group-head` in output.
  - a rendered damage chip carries `aria-pressed="true"` when its token is in `view.fType`, `"false"` otherwise (call the exported chip-row builder or assert via `renderTable` into a detached element).
  - keep the existing name/badge/selection tests (flat body still emits `data-id`, `selrow`, `aria-pressed`).

- [ ] **Step 2: Run, verify fail.** `cd web && bun test test/rr/tableView.test.ts`.

- [ ] **Step 3: Implement the skeleton.** Replace the `.rr-controls` block in `skeleton()` with a search input plus three `.chips` groups and a footer (count + reset):

```ts
const DMG = ["Physical","Pierce","Fire","Cold","Lightning","Poison & Acid","Aether","Chaos","Vitality","Bleeding"];
const RR_CHIPS: { value: LogicalSource["rrType"]; }[] = [{value:"stacking"},{value:"reduced-percent"},{value:"reduced-flat"}];
const CAT_CHIPS = ["devotion","skill","item"] as const;
```

  Chip markup helper (data attributes drive the delegated click handler):

```ts
function chip(facet: string, value: string, label: string, pressed: boolean, cls = ""): string {
  return `<button type="button" class="chip ${cls}" data-facet="${facet}" data-val="${esc(value)}" aria-pressed="${pressed}">${esc(label)}</button>`;
}
```

  Damage labels are the tokens; reduction labels are `loc.translate('rr.badge.'+v)` with class `rr-<short>`; category labels are `loc.translate('rr.coarse.'+v)`. Group labels reuse `rr.ctl.type` / `rr.ctl.rr` / `rr.ctl.category`. Footer: `<span id="rr-count">` and `<button id="rr-reset">` (label `rr.ctl.reset`).

- [ ] **Step 4: Implement sync + wire.** `syncControls` sets each chip's `aria-pressed` from the matching `view.f*` set and syncs the search value (no more `<select>` population). Replace the per-select `wire` handlers with one delegated listener on the chips container:

```ts
el.querySelector(".rr-facets")!.addEventListener("click", (e) => {
  const b = (e.target as Element).closest<HTMLElement>(".chip"); if (!b || !ctx) return;
  const facet = b.dataset.facet as "fType" | "fRR" | "fCat"; const val = b.dataset.val!;
  const next = new Set(ctx.view[facet]); next.has(val) ? next.delete(val) : next.add(val);
  ctx.handlers.onView({ ...ctx.view, [facet]: next });
});
```

  Map `data-facet` values to `fType|fRR|fCat`. Wire `#rr-reset` to fire `onView` with the three sets cleared and `q:""`. Keep the search-input and sort-header handlers as they are.

- [ ] **Step 5: Flat body.** Change `bodyMarkup`/`renderBody`/`renderTable` to take `sorted: LogicalSource[]` and iterate rows directly (delete the group-head branch). Update `renderCount` to `sorted.length` / `all.length` / `view.sel.size`.

- [ ] **Step 6: CSS.** Port the `.chip`, `.chips`, `.rr-facets`, chip `aria-pressed` and `rr-stacking/percent/flat` active colors, and the count/reset footer from the mockup (artifact `55341fdd`) into `rr.css`, scoped under `.rr-page`. Remove now-dead `.rr-controls select` / `.rr-groupby` / `.rr-group-head` rules.

- [ ] **Step 7: Run tests, verify pass.** `cd web && bun test test/rr/tableView.test.ts`.

- [ ] **Step 8: Commit.**

---

### Task 5: Wire main.ts to the flat, group-free render

**Files:**
- Modify: `web/src/rr/app/main.ts`

**Interfaces:**
- Consumes: `applyView` (Task 2), `renderTable` flat signature (Task 4).

- [ ] **Step 1: Edit render loop.** Remove `groupView` import and the `parentKeyOf` resolver. `render()` becomes:

```ts
const sorted = applyView(logical, view, nameOf, parentNameOf);
renderTable(tableEl, localization, logical, sorted, view, handlers);
const selected = logical.filter((s) => view.sel.has(s.id));
renderLedger(ledgerEl, localization, resolveLedger(selected, view.r0), view.r0, ledgerHandlers);
```

- [ ] **Step 2: Verify build + boot.** Run: `just build` then `just check` (tsc catches any leftover `group`/`fPar` references). Manually load `http://localhost:5173/resistance-reduction/` and confirm chips filter, reset works, and a hash like `#type=Fire,Cold&cat=item` restores.

- [ ] **Step 3: Commit.**

---

### Task 6: e2e + full verification

**Files:**
- Modify: `web/e2e/rr-smoke.ts`

- [ ] **Step 1: Update the smoke filter step.** The existing `location.hash = "#rr=stacking"` check still holds (decodes to `fRR={"stacking"}`); add a step that clicks a damage chip and asserts the row count drops and every remaining row hits that token via the rendered damage cell. Keep the threshold-based catalogue count.

- [ ] **Step 2: Full gate.** Run: `just check` (all bun tests + biome + tsc), `just build`, `just e2e` (planner + rr smoke), and `uv run scripts/test_parse_rr.py` (unaffected, but confirm green). All must pass.

- [ ] **Step 3: Commit**, then run superpowers:finishing-a-development-branch to close out.

## Self-review notes

- `sourceHits` already encodes the Fire→Elemental/All fold-in; Task 2 only wraps it in `some(...)`. Do not reimplement the fold-in.
- The only intentional break is old `cat=<fine>` links dropping the category filter (spec §URL). Selection, search, and sort still restore, so no crash and no data loss.
- Reduction chip color classes must match the badge classes (`rr-stacking` uses `--rr-stack`, etc.) so the facet and the row badge read as the same family.
