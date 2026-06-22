# Reachability UI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the strict bottom-up selection model with reachability-driven claiming: claim any constellation that can still be finished within budget, place partial stars when they keep the build reachable, deselect freely, dim what has gone unreachable, and show a two-column have/need affinity panel.

**Architecture:** `main.ts` computes one `ReachView` per refresh via `reachabilityForSelection` (Plan 1) and threads it to the renderer, the panel, and the click handlers. `rules.ts` becomes pure set-transforms gated by that `ReachView` (no engine calls). The renderer applies two-layer dimming; the panel renders have/need; the tooltip shows a completion minimum for un-completable constellations.

**Tech Stack:** TypeScript, bun, the existing SVG renderer and DOM sidebar adapters. Consumes Plan 1's `reachabilityForSelection`, `completionMinCost`, `ReachView`, and the loaded `coverTable`.

**Depends on:** Plan 1 (reachability engine + blob) must be merged first. This plan uses `reachabilityForSelection`, `completionMinCost`, `ReachView`, and `LoadedData.coverTable`.

## Global Constraints

- Hexagonal: `web/src/core/**` stays pure (no DOM/IO). `rules.ts` takes a precomputed `ReachView`; it does not fetch, render, or call the engine sweep itself.
- TDD throughout. Tests: `cd web && bun test`. Full gate: `just check`. This plan changes observable behavior, so also verify in the browser preview before the final review.
- Affinity order is `AFFINITIES = ["ascendant","chaos","eldritch","order","primordial"]`.
- Commit messages use conventional prefixes; NO AI co-author trailer.
- The URL hash stays the source of truth for shareable state (`urlState.ts` round-trip). Star-level encoding is unchanged; restore gains a reachability repair. Do not introduce client state that lives only in memory or the DOM.
- `web/src/styles.css` is owned by another active instance. Task 6 specifies the CSS but MUST be coordinated (applied after the other instance's edits land, or by the human). Do not clobber their changes. All other tasks avoid `styles.css`.
- Match the existing terse style of each file.

## Reach model recap (from the design spec)

- `started` = constellations with at least one selected star (each imposes its requirement). `completed` = all stars selected (each grants affinity).
- A constellation is **completable** when finishing it stays within budget. A star is **clickable** when placing it (predecessors first) keeps the selection reachable. These are two gates and can disagree (a startable-but-not-completable constellation has a clickable first star but faded art).
- Deselection is always free; removal cascades to dependents and never strands (minCost is monotone under removal because of Plan 1's partial-finish credit).

---

## File Structure

- `web/src/core/rules.ts` (REWRITE): reachability-gated `toggleStar`/`toggleConstellation`, `removeWithDependents`, `repairSelection`. Keep `recapValue`. Remove `validClosure`, `selectableStars`, `canRemove`, `removalBlockers`.
- `web/test/rules-toggle.test.ts`, `web/test/rules-constellation.test.ts` (REWRITE): reachability-driven toggle tests.
- `web/test/rules-closure.test.ts`, `web/test/rules-selectable.test.ts`, `web/test/rules-blockers.test.ts` (DELETE): they encode the strict gating being replaced.
- `web/test/rules-recap.test.ts` (KEEP unchanged).
- `web/test/rules-repair.test.ts` (CREATE): `repairSelection` tests.
- `web/src/adapters/svgRenderer.ts` (MODIFY): consume `ReachView` for two-layer dimming; drop `selectableStars` + the requirement fade.
- `web/test/svgRenderer.test.ts` (MODIFY): dimming-class tests from a `ReachView`.
- `web/src/adapters/sidebarView.ts` (MODIFY): two-column have/need `renderAffinities`.
- `web/test/affinity.test.ts` or a new `web/test/sidebar-affinity.test.ts` (ADD): have/need rendering test.
- `web/src/adapters/tooltipView.ts` (MODIFY): completion-minimum line.
- `web/src/app/main.ts` (MODIFY): compute `ReachView` per refresh, gate clicks, free deselection, restore repair, hover completion cost, uncapped/degraded handling, drop the blocked-removal flash.
- `web/src/styles.css` (MODIFY, COORDINATION-GATED): two-column panel + two-layer dimming styles.

---

## Task 1: Reachability-gated selection rules

**Files:**
- Rewrite: `web/src/core/rules.ts`
- Rewrite: `web/test/rules-toggle.test.ts`, `web/test/rules-constellation.test.ts`
- Create: `web/test/rules-repair.test.ts`
- Delete: `web/test/rules-closure.test.ts`, `web/test/rules-selectable.test.ts`, `web/test/rules-blockers.test.ts`

**Interfaces:**
- Consumes: `ReachView` (Plan 1: `{ completable: Set<string>; clickable: Set<StarId>; have: Vec; need: Vec; needSource: Map<number,string[]> }`), `classifyForSelection`, `buildReachCons`, `CoverTable` (Plan 1).
- Produces:
  - `export function toggleStar(model: DevotionModel, state: SelectionState, reach: ReachView, starId: StarId): SelectionState`
  - `export function toggleConstellation(model: DevotionModel, state: SelectionState, reach: ReachView, conId: string): SelectionState`
  - `export function removeWithDependents(model: DevotionModel, selected: Set<StarId>, starId: StarId): Set<StarId>`
  - `export function repairSelection(model: DevotionModel, cons: ReachCon[], table: CoverTable | null, selected: Set<StarId>, cap: number): Set<StarId>`
  - `export function recapValue(...)` unchanged.

- [ ] **Step 1: Delete the obsolete strict-gate tests**

These encode the strict model we are replacing (per the approved design):

```bash
git rm web/test/rules-closure.test.ts web/test/rules-selectable.test.ts web/test/rules-blockers.test.ts
```

- [ ] **Step 2: Write the failing reachability-toggle tests**

Replace the contents of `web/test/rules-toggle.test.ts`:

```ts
// ABOUTME: Reachability-driven star toggles: add only what the ReachView marks clickable,
// ABOUTME: remove freely (cascading to dependents), never block a removal.
import { test, expect } from "bun:test";
import { buildModel } from "../src/core/model";
import { toggleStar, removeWithDependents } from "../src/core/rules";
import type { ReachView } from "../src/core/reachability";
import type { SelectionState } from "../src/core/types";

// A tiny two-constellation model: A (2 stars, a0 -> a1), B (1 star).
const doc = {
  meta: { affinities: ["ascendant","chaos","eldritch","order","primordial"] },
  constellations: [
    { id: "A", name: "A", tier: 1, affinityRequired: {}, affinityBonus: { ascendant: 2 }, background: null,
      stars: [{ index: 0, predecessors: [], position: { x: 0, y: 0 }, bonuses: {} }, { index: 1, predecessors: [0], position: { x: 1, y: 0 }, bonuses: {} }] },
    { id: "B", name: "B", tier: 1, affinityRequired: {}, affinityBonus: {}, background: null,
      stars: [{ index: 0, predecessors: [], position: { x: 2, y: 0 }, bonuses: {} }] },
  ],
} as any;
const model = buildModel(doc);
const view = (clickable: string[], completable: string[] = []): ReachView => ({ completable: new Set(completable), clickable: new Set(clickable), have: [0,0,0,0,0], need: [0,0,0,0,0], needSource: new Map() });
const st = (ids: string[]): SelectionState => ({ selected: new Set(ids), pointCap: 55 });

test("adds a clickable star; rejects a non-clickable one", () => {
  const reach = view(["A:0"]);
  expect(toggleStar(model, st([]), reach, "A:0").selected.has("A:0")).toBe(true);
  expect(toggleStar(model, st([]), reach, "A:1")).toEqual(st([])); // not clickable -> unchanged
});

test("removing a star cascades to its dependents and is never blocked", () => {
  const reach = view([]); // clickability is irrelevant for removals
  const next = toggleStar(model, st(["A:0", "A:1"]), reach, "A:0"); // remove the predecessor
  expect(next.selected.has("A:0")).toBe(false);
  expect(next.selected.has("A:1")).toBe(false); // dependent removed too
});

test("removeWithDependents drops only the forward cone", () => {
  const next = removeWithDependents(model, new Set(["A:0", "A:1", "B:0"]), "A:1");
  expect([...next].sort()).toEqual(["A:0", "B:0"]); // A:1 gone, A:0 and B:0 stay
});
```

Replace the contents of `web/test/rules-constellation.test.ts`:

```ts
// ABOUTME: Reachability-driven constellation claims: claim whole only when completable,
// ABOUTME: remove the whole constellation freely.
import { test, expect } from "bun:test";
import { buildModel } from "../src/core/model";
import { toggleConstellation } from "../src/core/rules";
import type { ReachView } from "../src/core/reachability";
import type { SelectionState } from "../src/core/types";

const doc = {
  meta: { affinities: ["ascendant","chaos","eldritch","order","primordial"] },
  constellations: [
    { id: "A", name: "A", tier: 1, affinityRequired: {}, affinityBonus: { ascendant: 2 }, background: null,
      stars: [{ index: 0, predecessors: [], position: { x: 0, y: 0 }, bonuses: {} }, { index: 1, predecessors: [0], position: { x: 1, y: 0 }, bonuses: {} }] },
  ],
} as any;
const model = buildModel(doc);
const view = (completable: string[]): ReachView => ({ completable: new Set(completable), clickable: new Set(), have: [0,0,0,0,0], need: [0,0,0,0,0], needSource: new Map() });
const st = (ids: string[]): SelectionState => ({ selected: new Set(ids), pointCap: 55 });

test("claims all stars when completable", () => {
  const next = toggleConstellation(model, st([]), view(["A"]), "A");
  expect([...next.selected].sort()).toEqual(["A:0", "A:1"]);
});
test("rejects a claim when not completable", () => {
  expect(toggleConstellation(model, st([]), view([]), "A")).toEqual(st([]));
});
test("removes the whole constellation freely when fully selected", () => {
  const next = toggleConstellation(model, st(["A:0", "A:1"]), view([]), "A");
  expect(next.selected.size).toBe(0);
});
```

- [ ] **Step 3: Run them and confirm failure**

Run: `cd web && bun test rules-toggle.test.ts rules-constellation.test.ts`
Expected: FAIL (new signatures / `removeWithDependents` not present).

- [ ] **Step 4: Rewrite `rules.ts`**

```ts
// ABOUTME: Reachability-driven selection rules: add only ReachView-approved targets, remove freely.
// ABOUTME: No engine calls here; the controller passes a precomputed ReachView. recapValue is unchanged.
import type { DevotionModel, SelectionState, StarId } from "./types";
import { classifyForSelection, type CoverTable, type ReachCon, type ReachView } from "./reachability";

// (recapValue unchanged - keep the existing implementation verbatim.)
export function recapValue(selectedSize: number, lastFiniteCap: number, maxCap = 55): number | null {
  if (selectedSize > maxCap) return null;
  return Math.min(maxCap, Math.max(lastFiniteCap, selectedSize));
}

// Remove starId and every star that (transitively) depends on it within its constellation.
export function removeWithDependents(model: DevotionModel, selected: Set<StarId>, starId: StarId): Set<StarId> {
  const next = new Set(selected);
  const stack = [starId];
  while (stack.length) {
    const id = stack.pop()!;
    if (!next.has(id)) continue;
    next.delete(id);
    for (const s of model.stars.values()) if (next.has(s.id) && s.predecessors.includes(id)) stack.push(s.id);
  }
  return next;
}

export function toggleStar(model: DevotionModel, state: SelectionState, reach: ReachView, starId: StarId): SelectionState {
  if (state.selected.has(starId)) return { selected: removeWithDependents(model, state.selected, starId), pointCap: state.pointCap };
  if (!reach.clickable.has(starId)) return state; // not a valid target right now
  const next = new Set(state.selected); next.add(starId);
  return { selected: next, pointCap: state.pointCap };
}

export function toggleConstellation(model: DevotionModel, state: SelectionState, reach: ReachView, conId: string): SelectionState {
  const con = model.constellations.get(conId);
  if (!con || con.starIds.length === 0) return state;
  if (con.starIds.every((id) => state.selected.has(id))) { // fully selected -> remove all (free)
    const next = new Set(state.selected);
    for (const id of con.starIds) next.delete(id);
    return { selected: next, pointCap: state.pointCap };
  }
  if (!reach.completable.has(conId)) return state; // cannot finish within budget
  const next = new Set(state.selected);
  for (const id of con.starIds) next.add(id);
  return { selected: next, pointCap: state.pointCap };
}

// Drop selected stars whose predecessors are absent (malformed link), keeping predecessor-closure.
function predecessorClosure(model: DevotionModel, selected: Set<StarId>): Set<StarId> {
  let cur = new Set(selected);
  for (;;) {
    const next = new Set<StarId>();
    for (const id of cur) { const s = model.stars.get(id); if (s && s.predecessors.every((p) => cur.has(p))) next.add(id); }
    if (next.size === cur.size) return next;
    cur = next;
  }
}

// Best-effort repair for a restored selection: enforce predecessor-closure, then drop the largest
// started constellation until the set is reachable within cap. App-generated links are already
// reachable, so this only fires for stale or hand-edited links. Null table -> accept as-is (degraded).
export function repairSelection(model: DevotionModel, cons: ReachCon[], table: CoverTable | null, selected: Set<StarId>, cap: number): Set<StarId> {
  let cur = predecessorClosure(model, selected);
  if (!table) return cur;
  while (cur.size > 0 && classifyForSelection(model, cons, table, cur, cap) === "dim") {
    const started = new Map<string, number>();
    for (const id of cur) { const cid = model.stars.get(id)?.constellationId; if (cid) started.set(cid, (started.get(cid) ?? 0) + 1); }
    let drop = "", best = -1;
    for (const [cid, n] of started) if (n > best) { best = n; drop = cid; }
    const con = model.constellations.get(drop);
    if (!con) break;
    for (const id of con.starIds) cur.delete(id);
  }
  return cur;
}
```

- [ ] **Step 5: Write `repairSelection` tests**

`web/test/rules-repair.test.ts`:

```ts
// ABOUTME: repairSelection enforces predecessor-closure and drops claims until reachable within cap.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { buildReachCons, buildCoverTable } from "../src/core/reachability";
import { repairSelection } from "../src/core/rules";

const model = buildModel(doc as any);
const cons = buildReachCons(model);
const table = buildCoverTable(cons);
const nameToId = new Map([...model.constellations.values()].map((c) => [c.name, c.id]));
const lev = model.constellations.get(nameToId.get("Leviathan")!)!;

test("keeps a reachable selection unchanged", () => {
  const sel = new Set(lev.starIds);                       // Leviathan claimed, cap 55 -> reachable (26)
  expect(repairSelection(model, cons, table, sel, 55)).toEqual(sel);
});
test("drops a claim that cannot fit the cap", () => {
  const sel = new Set(lev.starIds);                       // needs 26
  const repaired = repairSelection(model, cons, table, sel, 10); // cap 10 < 26 -> must drop Leviathan
  expect([...repaired].some((id) => lev.starIds.includes(id))).toBe(false);
});
test("null table accepts the selection as-is (degraded)", () => {
  const sel = new Set(lev.starIds);
  expect(repairSelection(model, cons, null, sel, 10)).toEqual(sel);
});
```

- [ ] **Step 6: Run the rules suite and confirm pass**

Run: `cd web && bun test rules-toggle.test.ts rules-constellation.test.ts rules-repair.test.ts rules-recap.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/core/rules.ts web/test/rules-toggle.test.ts web/test/rules-constellation.test.ts web/test/rules-repair.test.ts
git commit -m "feat(core): reachability-driven selection rules, free deselection, restore repair"
```

---

## Task 2: Two-layer dimming in the renderer

**Files:**
- Modify: `web/src/adapters/svgRenderer.ts`
- Modify: `web/test/svgRenderer.test.ts`

**Interfaces:**
- Consumes: `ReachView` (Plan 1).
- Produces: `renderSvgMarkup(model, state, opts)` and `mountSvg(...).update(state, highlight, reach)` accept an optional `reach?: ReachView`. Star classes become `selected` / `selectable` (clickable) / `locked`. Art gains `unmet` (un-completable but startable) and `unreachable` (un-completable and unstartable). When `reach` is omitted, nothing is dimmed and every frontier star is selectable (the permissive default for uncapped / table-not-loaded).

- [ ] **Step 1: Write the failing renderer test**

Add to `web/test/svgRenderer.test.ts` (it already builds a small model and calls `renderSvgMarkup`; mirror its existing setup):

```ts
import type { ReachView } from "../src/core/reachability";

test("two-layer dimming: completable normal, startable faded, unstartable dark", () => {
  // Reuse the test's existing `model` with constellations; pick three ids present in it.
  const ids = [...model.constellations.keys()];
  const reach: ReachView = { completable: new Set([ids[0]!]), clickable: new Set(), have: [0,0,0,0,0], need: [0,0,0,0,0], needSource: new Map() };
  // mark a clickable first star for ids[1] so it is "startable"
  const firstStar = model.constellations.get(ids[1]!)!.starIds[0]!;
  reach.clickable.add(firstStar);
  const svg = renderSvgMarkup(model, { selected: new Set(), pointCap: 55 }, { manifest: null, reach });
  // ids[0] completable -> its art has neither unmet nor unreachable
  // ids[2] not completable and no clickable star -> unreachable
  expect(svg).toContain(`data-con-id="${ids[2]}"`);
  // the clickable first star renders as selectable
  expect(svg).toMatch(new RegExp(`class="star (circle )?selectable`));
});
```

(Adjust the assertions to the test file's existing model shape; the key checks are that `selectable` appears for a clickable star and that an `unreachable` class is emitted for a constellation that is neither completable nor startable.)

- [ ] **Step 2: Run and confirm failure**

Run: `cd web && bun test svgRenderer.test.ts -t "two-layer"`
Expected: FAIL (`reach` not handled; no `unreachable` class).

- [ ] **Step 3: Modify `svgRenderer.ts`**

Change `RenderOpts` and the star/art logic. Replace the `selectableStars` import and the per-constellation `reachable` computation:

```ts
import type { Constellation, DevotionModel, SelectionState, StarId } from "../core/types";
import type { ReachView } from "../core/reachability";
// (remove: import { selectableStars } from "../core/rules";)
// (remove the affinity import only if it becomes unused; keep presentAffinities usage.)

export interface RenderOpts { manifest: AssetManifest | null; highlight?: Set<StarId>; reach?: ReachView }
```

In `renderSvgMarkup`, drop `const selectable = selectableStars(model, state);` and the `totals`/`meetsRequirement` art-fade block. Compute per-constellation art class from `reach`:

```ts
  const reach = opts.reach;
  const conArtClass = (c: Constellation): string => {
    if (!reach) return "";                                   // permissive (uncapped / no table)
    if (c.starIds.some((id) => state.selected.has(id))) return "";        // you are in it
    if (reach.completable.has(c.id)) return "";                            // can finish it
    if (c.starIds.some((id) => reach.clickable.has(id))) return " unmet";  // can start, not finish
    return " unreachable";                                                 // cannot even start
  };
```

Use `conArtClass(c)` where the old `dim` variable was set for the `<image class="art...">` and the `<rect class="art-tint...">`. For star state:

```ts
    let st = "locked";
    if (state.selected.has(star.id)) st = "selected";
    else if (!reach || reach.clickable.has(star.id)) st = "selectable";
```

Update `SvgHandle.update` and the internal `render` to thread `reach`:

```ts
export interface SvgHandle { update(state: SelectionState, highlight?: Set<StarId>, reach?: ReachView): void; svg: SVGSVGElement }
// inside mountSvg:
  function render(state: SelectionState, highlight?: Set<StarId>, reach?: ReachView) {
    container.innerHTML = renderSvgMarkup(model, state, { manifest: deps.manifest, highlight, reach });
  }
  // ... update(state, highlight, reach) { ... render(state, highlight, reach); ... }
```

- [ ] **Step 4: Run and confirm pass**

Run: `cd web && bun test svgRenderer.test.ts`
Expected: PASS (including the file's pre-existing tests; adjust any that asserted the old requirement-fade behavior to use a `reach` instead).

- [ ] **Step 5: Commit**

```bash
git add web/src/adapters/svgRenderer.ts web/test/svgRenderer.test.ts
git commit -m "feat(web): two-layer reachability dimming in the map renderer"
```

---

## Task 3: Two-column have/need affinity panel

**Files:**
- Modify: `web/src/adapters/sidebarView.ts`
- Create: `web/test/sidebar-affinity.test.ts`

**Interfaces:**
- Consumes: `ReachView`'s `have`, `need`, `needSource` (Plan 1), `DevotionModel` (to map source ids to names).
- Produces: `renderAffinities(el, model, have: Vec, need: Vec, needSource: Map<number, string[]>, prev?: Record<Affinity, number>): Record<Affinity, number>` — renders one row per affinity with the current total and, when `need[i] > 0`, a second value colored met/unmet, whose `title` lists the demanding constellation names. Returns the have-totals for the caller's change-flash.

- [ ] **Step 1: Write the failing panel test**

`web/test/sidebar-affinity.test.ts`:

```ts
// ABOUTME: The affinity panel renders have/need columns: need is red when unmet, green when met.
import { test, expect } from "bun:test";
import { buildModel } from "../src/core/model";
import { renderAffinities } from "../src/adapters/sidebarView";
import type { Vec } from "../src/core/reachability";

const doc = { meta: { affinities: ["ascendant","chaos","eldritch","order","primordial"] }, constellations: [
  { id: "Lev", name: "Leviathan", tier: null, affinityRequired: { eldritch: 13, ascendant: 13 }, affinityBonus: {}, background: null, stars: [{ index: 0, predecessors: [], position: { x: 0, y: 0 }, bonuses: {} }] },
] } as any;
const model = buildModel(doc);

function render(have: Vec, need: Vec, src: Map<number, string[]>) {
  const el = { innerHTML: "" } as any as HTMLElement;
  renderAffinities(el, model, have, need, src, undefined);
  return (el as any).innerHTML as string;
}

test("unmet need is flagged missing; met need is flagged met", () => {
  // ascendant index 0, eldritch index 2.
  const html = render([5,0,0,0,0], [13,0,13,0,0], new Map([[0, ["Lev"]], [2, ["Lev"]]]));
  expect(html).toMatch(/ascendant[\s\S]*?missing[\s\S]*?13/);     // have 5 < need 13 -> missing
  const met = render([13,0,13,0,0], [13,0,13,0,0], new Map([[0, ["Lev"]], [2, ["Lev"]]]));
  expect(met).toMatch(/met/);                                     // have 13 >= need 13 -> met
  expect(html).toContain("Leviathan");                            // need source name in a title
});

test("colors with no requirement show only the current total", () => {
  const html = render([0,0,0,0,0], [0,0,0,0,0], new Map());
  expect(html).not.toContain("missing");
  expect(html).not.toContain("met");
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd web && bun test sidebar-affinity.test.ts`
Expected: FAIL (signature mismatch / no have-need markup).

- [ ] **Step 3: Rewrite `renderAffinities`**

Replace the existing `renderAffinities` in `sidebarView.ts`:

```ts
import { AFFINITIES, type Affinity, type DevotionModel, type StarId } from "../core/types";
import type { Vec } from "../core/reachability";
// ... existing imports (affinityOrb, etc.) stay.

export function renderAffinities(
  el: HTMLElement,
  model: DevotionModel,
  have: Vec,
  need: Vec,
  needSource: Map<number, string[]>,
  prev?: Record<Affinity, number>,
): Record<Affinity, number> {
  const totals = { ascendant: have[0], chaos: have[1], eldritch: have[2], order: have[3], primordial: have[4] } as Record<Affinity, number>;
  const rows = AFFINITIES.map((a, i) => {
    const flash = changeClass(prev, a, totals as Record<string, number>);
    const n = need[i]!;
    let needCell = "";
    if (n > 0) {
      const met = have[i]! >= n;
      const names = (needSource.get(i) ?? []).map((cid) => model.constellations.get(cid)?.name ?? cid).join(", ");
      needCell = `<span class="aff-need ${met ? "met" : "missing"}" title="${names ? `needed by ${names}` : ""}">${n}</span>`;
    }
    return `<div class="affinity affinity-${a}${flash}"><span>${affinityOrb(a)}${a}</span><span class="aff-have">${have[i]}</span>${needCell}</div>`;
  }).join("");
  el.innerHTML = `<h2>Affinity</h2><div class="affinity-head"><span></span><span class="aff-have">have</span><span class="aff-need-h">need</span></div>${rows}`;
  return totals;
}
```

`changeClass` already exists in this file (it is used by `renderBenefits`); reuse it. Note: `renderAffinities` no longer calls `affinityTotals` (the controller supplies `have`), so remove the now-unused `affinityTotals` import only if nothing else in the file uses it.

- [ ] **Step 4: Run and confirm pass**

Run: `cd web && bun test sidebar-affinity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/adapters/sidebarView.ts web/test/sidebar-affinity.test.ts
git commit -m "feat(web): two-column have/need affinity panel"
```

---

## Task 4: Completion-minimum line in the constellation tooltip

**Files:**
- Modify: `web/src/adapters/tooltipView.ts`
- Modify: `web/test/` (add a tooltip assertion if a tooltip test exists; otherwise assert via the returned HTML string by exporting a small formatter)

**Interfaces:**
- Produces: `showConstellation(model, conId, x, y, totals?, dim?: { needs: number; cap: number })` — when `dim` is present, append a line "Needs N of your M points". The controller passes `dim` only for un-completable constellations.

- [ ] **Step 1: Write the failing test**

Add `web/test/tooltip-dim.test.ts`:

```ts
// ABOUTME: A faded constellation's tooltip shows its completion minimum ("Needs N of your M points").
import { test, expect } from "bun:test";
import { buildModel } from "../src/core/model";
import { tooltipView } from "../src/adapters/tooltipView";

const doc = { meta: { affinities: ["ascendant","chaos","eldritch","order","primordial"] }, constellations: [
  { id: "Lev", name: "Leviathan", tier: null, affinityRequired: { eldritch: 13, ascendant: 13 }, affinityBonus: {}, background: null, stars: [{ index: 0, predecessors: [], position: { x: 0, y: 0 }, bonuses: {} }] },
] } as any;
const model = buildModel(doc);

test("shows the completion minimum when dim info is supplied", () => {
  const el = { style: {}, innerHTML: "", offsetWidth: 0, offsetHeight: 0 } as any as HTMLElement;
  const tip = tooltipView(el);
  tip.showConstellation(model, "Lev", 0, 0, undefined, { needs: 26, cap: 55 });
  expect((el as any).innerHTML).toContain("Needs 26 of your 55");
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd web && bun test tooltip-dim.test.ts`
Expected: FAIL (extra param/line not present).

- [ ] **Step 3: Modify `tooltipView.ts`**

Extend `showConstellation`'s signature and append the line:

```ts
    showConstellation(model: DevotionModel, conId: string, clientX: number, clientY: number, totals?: AffinityTotals, dim?: { needs: number; cap: number }) {
      const con = model.constellations.get(conId);
      if (!con) return;
      const stars = new Set(con.starIds);
      const powers = powersGained(model, stars).map((p) => `<div class="tip-power">${p.power.name}</div>`).join("");
      const head = `<strong>${con.name}</strong> <span class="tip-cost">${con.starIds.length} pts</span>`;
      const dimLine = dim ? `<div class="tip-dim">Needs ${dim.needs} of your ${dim.cap} points</div>` : "";
      el.innerHTML = `${head}${powers}${bonusRowsHtml(sumBonuses(model, stars), racialTargets(model, stars))}${petBonusHtml(sumPetBonuses(model, stars))}${affinitySections(con, totals)}${dimLine}`;
      place(clientX, clientY);
    },
```

- [ ] **Step 4: Run and confirm pass**

Run: `cd web && bun test tooltip-dim.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/adapters/tooltipView.ts web/test/tooltip-dim.test.ts
git commit -m "feat(web): show completion minimum on a faded constellation tooltip"
```

---

## Task 5: Wire the controller (`main.ts`)

**Files:**
- Modify: `web/src/app/main.ts`

**Interfaces:**
- Consumes: `reachabilityForSelection`, `completionMinCost`, `buildReachCons`, `ReachView`, `LoadedData.coverTable` (Plan 1); the new `rules.ts` toggles and `repairSelection` (Task 1); the new renderer/panel/tooltip signatures (Tasks 2-4).

- [ ] **Step 1: Replace the engine-facing wiring**

Update imports and `boot()`:

```ts
import { toggleStar, toggleConstellation, recapValue, repairSelection } from "../core/rules";
import { buildReachCons, reachabilityForSelection, completionMinCost, type ReachView, type ReachCon } from "../core/reachability";
```

After `const model = data.model;` add:

```ts
  const cons: ReachCon[] = buildReachCons(model);
  const table = data.coverTable;                                 // null -> dimming disabled (degraded)
```

Replace the restore line `selected: validClosure(model, restored.selected)` with the reachability repair:

```ts
  let state: SelectionState = restored
    ? { selected: repairSelection(model, cons, table, restored.selected, restored.pointCap), pointCap: restored.pointCap }
    : { selected: new Set(), pointCap: 55 };
```

- [ ] **Step 2: Add the ReachView computation and a permissive fallback**

Add near the other helpers in `boot()`:

```ts
  // The frontier stars (predecessors satisfied) - used to build a permissive view when dimming is off.
  function permissiveView(): ReachView {
    const completable = new Set<string>([...model.constellations.keys()]);
    const clickable = new Set<string>();
    for (const s of model.stars.values()) if (!state.selected.has(s.id) && s.predecessors.every((p) => state.selected.has(p))) clickable.add(s.id);
    const st = reachabilityForSelection(model, cons, table!, state.selected, Infinity); // only for have/need
    return { completable, clickable, have: st.have, need: st.need, needSource: st.needSource };
  }
  let reach: ReachView;
  function computeReach(): ReachView {
    if (table && Number.isFinite(state.pointCap)) return reachabilityForSelection(model, cons, table, state.selected, state.pointCap);
    // uncapped or no table: do not dim. have/need still come from the selection summary.
    if (!table) {
      // no engine: derive have/need directly so the panel still works.
      const st = reachabilityForSelection; void st; // (panel falls back below)
    }
    return permissiveView();
  }
```

Note: `permissiveView` calls `reachabilityForSelection` only to obtain `have`/`need`, which do not depend on budget. If `table` is null, guard it: compute `have`/`need` from `selectionSummary` instead. Simpler: always expose a `selectionSummary`-based have/need. Use this cleaner form:

```ts
  import { selectionSummary } from "../core/reachability";
  // ...
  function computeReach(): ReachView {
    const s = selectionSummary(model, state.selected);
    const needSource = new Map<number, string[]>();
    for (let i = 0; i < 5; i++) { if (s.target[i] === 0) continue; const src: string[] = []; for (const cid of s.startedIds) { const c = model.constellations.get(cid)!; const r = [c.affinityRequired.ascendant ?? 0, c.affinityRequired.chaos ?? 0, c.affinityRequired.eldritch ?? 0, c.affinityRequired.order ?? 0, c.affinityRequired.primordial ?? 0]; if (r[i] === s.target[i]) src.push(cid); } needSource.set(i, src); }
    if (table && Number.isFinite(state.pointCap)) return reachabilityForSelection(model, cons, table, state.selected, state.pointCap);
    const completable = new Set<string>([...model.constellations.keys()]);
    const clickable = new Set<string>();
    for (const st of model.stars.values()) if (!state.selected.has(st.id) && st.predecessors.every((p) => state.selected.has(p))) clickable.add(st.id);
    return { completable, clickable, have: s.supply, need: s.target, needSource };
  }
```

(Prefer this second form; `reachabilityForSelection` already builds `have`/`need`/`needSource`, so when the engine path runs you get them for free; the fallback recomputes them from `selectionSummary`.)

- [ ] **Step 3: Use ReachView in click handlers and refresh; drop the flash**

In `mountSvg({ ... })`, replace the handlers:

```ts
    onStarClick: (id) => { const next = toggleStar(model, state, reach, id); if (next !== state) { state = next; refresh(); } },
    onConstellationClick: (id) => { const next = toggleConstellation(model, state, reach, id); if (next !== state) { state = next; refresh(); } },
    onHover: (t, x, y) => {
      if (!t) { tip.hide(); return; }
      const totals = affinityTotals(model, state.selected);
      if (t.kind === "star") tip.show(model, t.id, x, y, totals);
      else {
        const dim = reach.completable.has(t.id) || state.selected.has(...[...model.constellations.get(t.id)!.starIds][0] ? [] as any : [])
          ? undefined : completionInfo(t.id);
        tip.showConstellation(model, t.id, x, y, totals, dim);
      }
    },
```

Simplify the hover branch to avoid the awkward expression - use a helper:

```ts
  const completionCache = new Map<string, number>();           // cleared each refresh
  function completionInfo(conId: string): { needs: number; cap: number } | undefined {
    if (!table || !Number.isFinite(state.pointCap)) return undefined;
    if (reach.completable.has(conId)) return undefined;        // completable -> no "needs" line
    if (!completionCache.has(conId)) completionCache.set(conId, completionMinCost(model, cons, table, state.selected, conId, state.pointCap));
    const needs = completionCache.get(conId)!;
    return Number.isFinite(needs) ? { needs, cap: state.pointCap } : undefined;
  }
```

and the hover else-branch becomes `tip.showConstellation(model, t.id, x, y, totals, completionInfo(t.id));`.

Delete `flashBlockers` and the removal-flash code paths (the `if (next === state)` rejection branches that called `flashBlockers`/`removalBlockers`). Keep `flashEl` (still used by the cap-toggle blocked-recap). Remove the now-unused `removalBlockers` import.

In `refresh()`:

```ts
  function refresh() {
    completionCache.clear();
    reach = computeReach();
    handle.update(state, starsGranting(model, selectedBenefits), reach);
    slider.min = String(Math.max(1, state.selected.size));
    renderBenefitsPanel();
    prevAffinity = renderAffinities(affinityEl, model, reach.have, reach.need, reach.needSource, prevAffinity);
    const uncapped = !Number.isFinite(state.pointCap);
    usedEl.textContent = String(state.selected.size);
    capToggle.textContent = uncapped ? "∞" : String(state.pointCap);
    capToggle.title = uncapped ? "Click to restore the 55-point limit" : "Click to remove the point limit";
    slider.disabled = uncapped;
    if (!uncapped) slider.value = String(state.pointCap);
    history.replaceState(null, "", `#${encodeHash(state.selected, state.pointCap, canonical, selectedBenefits, statCanonical)}`);
  }
```

`renderAffinities`'s old call site (`renderAffinities(affinityEl, model, state.selected, prevAffinity)`) is replaced by the have/need form above. `prevAffinity` stays `Record<Affinity, number> | undefined`.

- [ ] **Step 4: Type-check and run the whole suite**

Run: `just check`
Expected: green. Resolve any unused-import or signature errors (e.g., `affinityTotals` may still be used by the tooltip hover; keep that import).

- [ ] **Step 5: Verify in the browser preview**

Start the dev server and exercise the feature: from an empty map, claim Leviathan (it activates with red eldritch/ascendant in the panel), confirm distant constellations dim as you add a second capstone, deselect freely, and drag the slider down to watch the floor reveal. Capture a screenshot for the change.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/main.ts
git commit -m "feat(web): drive selection from reachability (claim-anywhere, free deselect, dimming)"
```

---

## Task 6: Styles for the panel and dimming (COORDINATION-GATED)

**Files:**
- Modify: `web/src/styles.css` (owned by another active instance - coordinate before editing)

**Interfaces:** none (presentation). Classes introduced by earlier tasks: `.aff-have`, `.aff-need`, `.aff-need.met`, `.aff-need.missing`, `.affinity-head`, `.art.unreachable`, `.tip-dim`. The renderer reuses the existing `.art.unmet` and `.star.selectable`/`.star.locked`/`.star.selected`.

**Coordination:** Confirm the other instance has finished its `styles.css` edits (or hand these rules to the human to apply) before committing, so their work is not clobbered.

- [ ] **Step 1: Add the panel columns**

Append to `styles.css`:

```css
/* Affinity panel: two columns (have / wanted max). */
.affinity { display: grid; grid-template-columns: 1fr auto auto; gap: .6rem; align-items: baseline; }
.affinity-head { display: grid; grid-template-columns: 1fr auto auto; gap: .6rem; font-size: .7rem; text-transform: uppercase; letter-spacing: .04em; color: #6b7480; padding-bottom: .2rem; }
.aff-have { font-variant-numeric: tabular-nums; color: #cdd6e3; min-width: 1.6em; text-align: right; }
.aff-need { font-variant-numeric: tabular-nums; min-width: 1.6em; text-align: right; cursor: help; }
.aff-need.missing { color: #e0696a; }
.aff-need.met { color: #83c995; }
.aff-need-h { min-width: 1.6em; text-align: right; }
```

- [ ] **Step 2: Add the second dimming layer and the tooltip line**

```css
/* Reachability dimming: .art.unmet (startable, cannot finish) already fades; .unreachable is darker. */
.art.unreachable { opacity: calc(var(--art-opacity) * 0.08); }
.art-tint.unreachable { opacity: 0; }
.tip-dim { margin-top: .35rem; color: #e0a96a; font-size: .9em; }
```

- [ ] **Step 3: Verify in the preview**

Reload and confirm: the panel shows aligned have/need columns with red/green needs; un-completable-but-startable constellations are faintly visible while fully unreachable ones are darker; the faded-constellation tooltip shows the amber "Needs N" line.

- [ ] **Step 4: Commit (after coordination)**

```bash
git add web/src/styles.css
git commit -m "style(web): two-column affinity panel and second dimming layer"
```

---

## Self-Review

**Spec coverage (Plan 2 portion):**
- Strict gating replaced by reachability-driven toggles, free deselection: Task 1.
- Restore repair (replaces `validClosure`): Task 1 (`repairSelection`), wired in Task 5.
- Two-layer dimming: Task 2 + Task 6 CSS.
- Two-column have/need panel with hover source: Task 3 + Task 6 CSS.
- Completion-minimum tooltip: Task 4.
- Controller wiring (ReachView per refresh, gate clicks, uncapped/degraded handling, drop flash): Task 5.
- Engine, blob, loader: delivered by Plan 1 (not repeated here).

**Placeholder scan:** Task 5 deliberately shows two forms of `computeReach`; the prose names the second as canonical. An implementer must use the `selectionSummary`-based form. Flag resolved here: use the second form and delete the first sketch.

**Type consistency:** `ReachView` shape (`completable`, `clickable`, `have`, `need`, `needSource`) is used identically across rules, renderer, panel, and controller. `repairSelection` returns `Set<StarId>`. `showConstellation`'s new `dim` param is `{ needs: number; cap: number }`. `renderAffinities` takes `(el, model, have, need, needSource, prev)`.

**Coordination risk:** Task 6 touches `styles.css` (other instance). It is last and explicitly gated. Tasks 1-5 are independent of it and fully testable without it (the CSS only affects appearance, not the unit tests).

**Behavior-change verification:** Tasks 5 and 6 include a browser-preview check, since unit tests do not exercise the live DOM wiring.
