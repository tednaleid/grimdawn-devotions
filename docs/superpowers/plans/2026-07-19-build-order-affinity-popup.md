# Build-Order Affinity Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hovering (or tapping, on touch) a build-order step shows a popup with the post-step affinity have/need state and the step constellation's requires/grants, sourced from the same oracle replay that verifies the order.

**Architecture:** One replay, two outputs: `orderLegality.ts` gains `replayBuildOrder` returning `{ error, states }`; `verifyBuildOrder` becomes a thin wrapper (verdict semantics frozen); the gate returns the states with the verified order and `selectionView` exposes both. A pure content helper in `buildOrderView.ts` renders one step's popup in the Affinity panel's visual language; `main.ts` wires hover (desktop) and tap-toggle (touch) with a fixed singleton popup element.

**Tech Stack:** TypeScript, Bun (bun test), CDP-driven e2e (web/e2e/smoke.ts). No new dependencies.

**Spec:** docs/superpowers/specs/2026-07-19-build-order-affinity-popup-design.md

## Global Constraints

- Branch `build-order-validity`. Never push; Ted pushes.
- No new replayer and no extra walk: one replay per click, the popup data comes from the verifying replay.
- `verifyBuildOrder`'s verdict semantics are FROZEN: identical error strings, identical verdicts. Its existing callers and tests (corpus nets, replayLegal, build-order-validate) must pass without modification.
- The oracle module keeps type-only imports from reachability (`import type`) — the independence invariant is about code, not outputs.
- No new user-facing strings. Every popup label resolves through existing catalog keys: `aff.<affinity>`, `ui.affinity.have`, `ui.affinity.need`, `ui.affinity.neededBy`, `ui.tooltip.requires`, `ui.tooltip.grants`, `ui.buildOrder.crossroads`, `ui.buildOrder.dir.*`. No catalog or appCatalog-guard changes.
- Popup affinity rows must NOT carry the sidebar's `data-gkey`/`data-gtoggle`/`data-ids` attributes (those wire filter toggles; the popup is display-only).
- No URL state: the popup is view chrome, hidden on every panel re-render.
- Pure functions, no caller-visible mutation: `replayBuildOrder` builds fresh vectors/maps per state entry; no out-parameters.
- Every new code file starts with two `// ABOUTME:` lines. Docs: no emojis, no emdashes, no hyperbole.
- The pre-commit hook runs the full gate (format, full bun test, lint, typecheck): verify red locally within a task, commit only green. Never `--no-verify`. Commits can take up to 3 minutes.
- Determinism: no `Date.now()`/`Math.random()` anywhere in the changes.

## File Structure

- Modify `web/src/core/orderLegality.ts` — add `StepState`, `replayBuildOrder`, `GatedOrder`; `verifyBuildOrder` becomes a wrapper; `gateBuildOrder` returns `GatedOrder | null`.
- Modify `web/src/core/reachability.ts:1136-1166` — `SelectionView` gains `buildOrderStates`; `selectionView` uses the rich gate.
- Modify `web/test/order-legality.test.ts` — state-assertion tests; gate test updated to the new shape.
- Modify `web/test/build-order-oracle.test.ts` — port test + panel-agreement fixture test.
- Modify `docs/superpowers/specs/2026-07-19-build-order-affinity-popup-design.md` — one wording correction (states prefix semantics).
- Modify `web/src/adapters/buildOrderView.ts` — rows gain `data-step-i`; shared `stepConName` helper; new `buildStepPopupHtml`; ABOUTME refresh.
- Create `web/test/build-order-popup.test.ts` — popup content tests against the reproduction URL's real order.
- Modify `web/src/app/main.ts` — `curBuildOrderStates`, popup singleton, hover + tap wiring, tap-away dismiss.
- Modify `web/src/styles.css` — `#bo-pop` styles (after the `.bo-empty-sub` block).
- Modify `web/e2e/smoke.ts` — popup hover checks and a touch tap-toggle check, appended before the results summary.

---

### Task 1: One replay, two outputs (oracle module + selectionView port)

**Files:**
- Modify: `web/src/core/orderLegality.ts` (whole file below)
- Modify: `web/src/core/reachability.ts:1136-1166` (`SelectionView` + `selectionView`), and its line 7 import
- Modify: `web/test/order-legality.test.ts` (new tests appended; gate test replaced)
- Modify: `web/test/build-order-oracle.test.ts` (two tests appended)
- Modify: `docs/superpowers/specs/2026-07-19-build-order-affinity-popup-design.md` (one sentence)

**Interfaces:**
- Consumes: existing `verifyBuildOrder`/`gateBuildOrder` call sites; `selectionSummary`, `selectionView`, `decodeHash`, `canonicalStarIds` (already imported where used).
- Produces (Tasks 2-3 rely on these exact names):
  - `interface StepState { have: Vec; need: Vec; needSource: Map<number, string[]>; conReq: Vec; conGrant: Vec }` exported from `web/src/core/orderLegality.ts`
  - `replayBuildOrder(allCons: ReachCon[], target: ReachCon[], steps: BuildStep[], cap: number): { error: string | null; states: StepState[] }`
  - `interface GatedOrder { steps: BuildStep[]; states: StepState[] }`; `gateBuildOrder(allCons, target, steps: BuildStep[] | null, cap): GatedOrder | null`
  - `SelectionView.buildOrderStates: StepState[] | null` (present exactly when `buildOrder` is)

- [ ] **Step 1: Write the failing tests**

Append to `web/test/order-legality.test.ts` (and add `replayBuildOrder` to its import from `../src/core/orderLegality`):

```ts
test("replayBuildOrder exposes post-step states for a legal schedule", () => {
  const steps = [scaffold(G, 1), complete(M, 3), refund(G, 2)];
  const { error, states } = replayBuildOrder(CONS, [M], steps, 55);
  expect(error).toBeNull();
  expect(states.length).toBe(3);
  // after adding G: have = G's grant, nothing standing requires anything
  expect(states[0]!.have).toEqual(v(1));
  expect(states[0]!.need).toEqual(z());
  expect(states[0]!.conGrant).toEqual(v(1));
  // after completing M: have = G + M, need = M's requirement, demanded by m
  expect(states[1]!.have).toEqual(v(2));
  expect(states[1]!.need).toEqual(v(1));
  expect(states[1]!.needSource.get(0)).toEqual(["m"]);
  expect(states[1]!.conReq).toEqual(v(1));
  // after refunding G: have drops by exactly the refunded grant; m still demands and is still met
  expect(states[2]!.have).toEqual(v(1));
  expect(states[2]!.need).toEqual(v(1));
  expect(states[2]!.needSource.get(0)).toEqual(["m"]);
  expect(states[2]!.conGrant).toEqual(v(1));
});

test("on an illegal schedule, states hold only the steps that completed their checks", () => {
  const steps = [scaffold(G, 1), complete(N, 4), refund(G, 3)];
  const { error, states } = replayBuildOrder(CONS, [N], steps, 55);
  expect(error).toMatch(/mid-refund.*uncovered/);
  expect(states.length).toBe(2); // the failing refund contributes no state
});

test("verifyBuildOrder is the replay's verdict (wrapper equivalence)", () => {
  const legal = [scaffold(G, 1), complete(M, 3), refund(G, 2)];
  const illegal = [scaffold(G, 1), complete(N, 4), refund(G, 3)];
  expect(verifyBuildOrder(CONS, [M], legal, 55)).toBe(replayBuildOrder(CONS, [M], legal, 55).error);
  expect(verifyBuildOrder(CONS, [N], illegal, 55)).toBe(replayBuildOrder(CONS, [N], illegal, 55).error);
});

test("a synthetic partial member's state carries its zero grant", () => {
  const fullP = con("p", 5, v(1), v(0, 0, 3));
  const partialP = con("p", 2, v(1), z());
  const steps = [scaffold(G, 1), { kind: "complete", conId: "p", points: 2, heldAfter: 3 } as BuildStep];
  const { error, states } = replayBuildOrder([G, fullP], [G, partialP], steps, 55);
  expect(error).toBeNull();
  expect(states[1]!.conGrant).toEqual(z()); // judged at the partial's zero grant, not the full con's
  expect(states[1]!.have).toEqual(v(1)); // only G supplies
});
```

REPLACE the existing final test ("gateBuildOrder passes a legal order through, nulls an illegal or absent one") with:

```ts
test("gateBuildOrder passes a legal order through with its states, nulls an illegal or absent one", () => {
  const legal = [scaffold(G, 1), complete(M, 3), refund(G, 2)];
  const illegal = [scaffold(G, 1), complete(N, 4), refund(G, 3)];
  const gated = gateBuildOrder(CONS, [M], legal, 55);
  expect(gated).not.toBeNull();
  expect(gated!.steps).toBe(legal);
  expect(gated!.states.length).toBe(legal.length);
  expect(gateBuildOrder(CONS, [N], illegal, 55)).toBeNull();
  expect(gateBuildOrder(CONS, [M], null, 55)).toBeNull();
});
```

Append to `web/test/build-order-oracle.test.ts` (all names it uses are already imported there):

```ts
test("selectionView returns states exactly when it returns an order", () => {
  const decoded = decodeHash(REPRO_HASH, canonicalStarIds(model));
  const view = selectionView(model, cons, table, decoded!.selected, 55);
  expect(view.buildOrder).not.toBeNull();
  expect(view.buildOrderStates).not.toBeNull();
  expect(view.buildOrderStates!.length).toBe(view.buildOrder!.length);
});

test("the final step's state agrees with the Affinity panel (supply/target)", () => {
  const decoded = decodeHash(REPRO_HASH, canonicalStarIds(model));
  const view = selectionView(model, cons, table, decoded!.selected, 55);
  const last = view.buildOrderStates![view.buildOrderStates!.length - 1]!;
  const summary = selectionSummary(model, decoded!.selected);
  expect(last.have).toEqual(summary.supply);
  expect(last.need).toEqual(summary.target);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && bun test test/order-legality.test.ts test/build-order-oracle.test.ts`
Expected: FAIL — `replayBuildOrder` is not exported; `buildOrderStates` does not exist on `SelectionView` (type error surfaces at runtime as undefined property assertions failing).

- [ ] **Step 3: Rewrite orderLegality.ts**

Replace the whole of `web/src/core/orderLegality.ts` with:

```ts
// ABOUTME: Independent legality oracle for guided build orders: replays a BuildStep schedule from an
// ABOUTME: empty board, enforcing the in-game rules at every step, and exposes the per-step standing
// ABOUTME: states so the panel's popup shows exactly what the judge saw (the verified-or-absent gate).
import type { BuildStep, ReachCon, Vec } from "./reachability";

// Deliberately duplicated from reachability.ts (its private CAP_MAX): the oracle must not import engine code. Keep in sync.
const CAP_MAX: Vec = [20, 8, 20, 10, 20];
const zero = (): Vec => [0, 0, 0, 0, 0];
const addCap = (g: Vec, x: Vec): Vec => g.map((n, i) => Math.min(n + x[i]!, CAP_MAX[i]!)) as Vec;
const maxV = (a: Vec, b: Vec): Vec => a.map((n, i) => Math.max(n, b[i]!)) as Vec;
const covers = (g: Vec, d: Vec): boolean => g.every((n, i) => n >= d[i]!);

/** Post-step affinity state for one build-order step, from the same replay that judges legality. */
export interface StepState {
  have: Vec; // capped grant sum of standing complete constellations after the step
  need: Vec; // elementwise max requirement over standing constellations after the step
  needSource: Map<number, string[]>; // per color index, the standing constellation ids demanding it
  conReq: Vec; // the step's own constellation requirement (target-override lookup)
  conGrant: Vec; // the step's own constellation grant (zero for synthetic partials)
}

/**
 * The verification walk with its states exposed. Replays `steps` from an empty board, enforcing the
 * in-game rules at the conservative mid-step point (a step's requirement stands at its first star,
 * its grant only at completion; a refund loses the grant at the first refunded star while the
 * requirement stands until zero):
 *  - every standing constellation's requirement is covered by standing completed grants (the in-game
 *    "removal cannot strand a dependent" rule, docs/devotion-system.md, the refunded one included);
 *  - an add lands at or under `cap`, and `heldAfter` matches the running total at every step;
 *  - the end state is exactly `target`.
 * `target` members take precedence over `allCons` in lookups so the panel's synthetic partial members
 * (selected-star size, zero grant) are judged at their real standing size. `error` is null when the
 * whole schedule is legal, else the first violation; `states` holds one post-step entry per step that
 * completed its checks (a step failing pre-add or mid-refund contributes no state). Pure: fresh
 * vectors and maps per entry, nothing of the caller's is mutated.
 */
export function replayBuildOrder(
  allCons: ReachCon[],
  target: ReachCon[],
  steps: BuildStep[],
  cap: number,
): { error: string | null; states: StepState[] } {
  const conOf = new Map(allCons.map((c) => [c.id, c]));
  for (const t of target) conOf.set(t.id, t);
  const standing = new Set<string>();
  const states: StepState[] = [];
  let running = 0;
  const fail = (error: string) => ({ error, states });
  // The post-step standing state (fresh structures per call). covers(have, need) IS the post-step
  // legality check, so what the popup renders is literally what the judge saw.
  const standingState = (): { have: Vec; need: Vec; needSource: Map<number, string[]> } => {
    let have = zero();
    let need = zero();
    const needSource = new Map<number, string[]>();
    for (const id of standing) {
      const c = conOf.get(id)!;
      have = addCap(have, c.grant);
      need = maxV(need, c.req);
      for (let i = 0; i < 5; i++)
        if (c.req[i]! > 0) {
          const list = needSource.get(i) ?? [];
          list.push(id);
          needSource.set(i, list);
        }
    }
    return { have, need, needSource };
  };
  // Mid-step validity; `pending` is a constellation whose requirement must count but whose grant
  // must not (the conservative mid-step point).
  const check = (label: string, pending: string): string | null => {
    let grant = zero();
    let req = zero();
    for (const id of standing) {
      const c = conOf.get(id)!;
      req = maxV(req, c.req);
      if (id !== pending) grant = addCap(grant, c.grant);
    }
    if (!standing.has(pending)) req = maxV(req, conOf.get(pending)!.req);
    return covers(grant, req) ? null : `${label}: requirement uncovered`;
  };
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    const c = conOf.get(s.conId);
    if (!c) return fail(`step ${i}: unknown constellation ${s.conId}`);
    if (s.kind === "scaffold-refund") {
      if (!standing.has(s.conId)) return fail(`step ${i} (${s.conId}): refund of a constellation not standing`);
      if (s.points !== -c.size) return fail(`step ${i} (${s.conId}): refund points ${s.points}, expected ${-c.size}`);
      const mid = check(`step ${i} (${s.conId}) mid-refund`, s.conId);
      if (mid) return fail(mid);
      standing.delete(s.conId);
      running -= c.size;
      const st = standingState();
      if (!covers(st.have, st.need)) return fail(`step ${i} (${s.conId}) post-refund: requirement uncovered`);
      states.push({ ...st, conReq: c.req, conGrant: c.grant });
    } else {
      if (standing.has(s.conId)) return fail(`step ${i} (${s.conId}): added while already standing`);
      if (s.points !== c.size) return fail(`step ${i} (${s.conId}): add points ${s.points}, expected ${c.size}`);
      const mid = check(`step ${i} (${s.conId}) pre-add`, s.conId);
      if (mid) return fail(mid);
      standing.add(s.conId);
      running += c.size;
      if (running > cap) return fail(`step ${i} (${s.conId}): cap exceeded (${running} > ${cap})`);
      const st = standingState();
      if (!covers(st.have, st.need)) return fail(`step ${i} (${s.conId}) post-add: requirement uncovered`);
      states.push({ ...st, conReq: c.req, conGrant: c.grant });
    }
    if (s.heldAfter !== running) return fail(`step ${i} (${s.conId}): heldAfter=${s.heldAfter}, running total is ${running}`);
  }
  const want = new Set(target.map((c) => c.id));
  if (want.size !== standing.size) return fail(`end state: ${standing.size} standing, ${want.size} wanted`);
  for (const id of want) if (!standing.has(id)) return fail(`end state: ${id} missing`);
  return { error: null, states };
}

/** The replay's verdict alone: null when every step is legal in-game, else the first violation. */
export function verifyBuildOrder(
  allCons: ReachCon[],
  target: ReachCon[],
  steps: BuildStep[],
  cap: number,
): string | null {
  return replayBuildOrder(allCons, target, steps, cap).error;
}

/** A verified order together with the per-step states its verifying replay produced. */
export interface GatedOrder {
  steps: BuildStep[];
  states: StepState[];
}

/** The verified-or-absent gate: pass a schedule through, with its states, only when the replay proves it legal. */
export function gateBuildOrder(
  allCons: ReachCon[],
  target: ReachCon[],
  steps: BuildStep[] | null,
  cap: number,
): GatedOrder | null {
  if (!steps) return null;
  const r = replayBuildOrder(allCons, target, steps, cap);
  return r.error === null ? { steps, states: r.states } : null;
}
```

The behavior-preservation invariant: the original post-add/post-refund checks called `check(label, null)`, which computes exactly `covers(have, need)` over the standing set — the new `standingState` + `covers` path produces the identical verdicts and identical error strings. The heldAfter check stays after the state push, preserving the original error precedence.

- [ ] **Step 4: Update selectionView in reachability.ts**

Change line 7 from `import { gateBuildOrder } from "./orderLegality";` to:

```ts
import { gateBuildOrder, type StepState } from "./orderLegality";
```

In the `SelectionView` interface (line 1136-1141), after the `buildOrder` line, add:

```ts
  buildOrderStates: StepState[] | null; // per-step post-states from the verifying replay; present exactly when buildOrder is
```

In `selectionView`, replace:

```ts
  const raw = members.length ? buildOrderPath(cons, table, members, cap, 16) : null;
  // Verified or absent: render only orders the independent oracle proves legal at every step;
  // anything else is withheld and the panel shows its honest empty state instead.
  const buildOrder = gateBuildOrder(cons, members, raw, cap);
  return { minCost, reach, buildOrder };
```

with:

```ts
  const raw = members.length ? buildOrderPath(cons, table, members, cap, 16) : null;
  // Verified or absent: render only orders the independent oracle proves legal at every step;
  // anything else is withheld and the panel shows its honest empty state instead. The verifying
  // replay's per-step states ride along for the step popup - one walk, two outputs.
  const gated = gateBuildOrder(cons, members, raw, cap);
  return { minCost, reach, buildOrder: gated?.steps ?? null, buildOrderStates: gated?.states ?? null };
```

- [ ] **Step 5: Correct the spec sentence**

In `docs/superpowers/specs/2026-07-19-build-order-affinity-popup-design.md`, replace:

```
On an illegal schedule, `states` covers the
steps up to and including the failing one; callers that only want the
verdict never see it.
```

with:

```
On an illegal schedule, `states` holds one
entry per step that completed its checks (a step failing pre-add or
mid-refund contributes no state); callers that only want the verdict never
see it.
```

- [ ] **Step 6: Run the focused tests, then the full suite**

Run: `cd web && bun test test/order-legality.test.ts test/build-order-oracle.test.ts`
Expected: PASS (all new tests green).
Run: `cd web && bun test`
Expected: PASS — the frozen-verdict constraint means the corpus nets, replayLegal, tightcap, and validate-harness tests pass untouched. If any of them fails, the rewrite changed verdict semantics: STOP and fix the rewrite, never the tests.

- [ ] **Step 7: Commit**

```bash
cd /Users/tednaleid/Library/CloudStorage/Dropbox/code/grimdawn-devotions
git add web/src/core/orderLegality.ts web/src/core/reachability.ts web/test/order-legality.test.ts web/test/build-order-oracle.test.ts docs/superpowers/specs/2026-07-19-build-order-affinity-popup-design.md
git commit -m "feat(order): replayBuildOrder exposes per-step states; selectionView carries them with the verified order"
```

---

### Task 2: Popup content renderer (adapter)

**Files:**
- Modify: `web/src/adapters/buildOrderView.ts`
- Create: `web/test/build-order-popup.test.ts`
- Possibly modify: `web/test/build-order-view.test.ts` (only if its assertions break on the added `data-step-i` attribute — update those assertions to include it, nothing else)

**Interfaces:**
- Consumes: `StepState` and `SelectionView.buildOrderStates` from Task 1; existing `affinityOrb(a: Affinity): string`, `AFFINITIES` (`["ascendant","chaos","eldritch","order","primordial"]` from `../core/types`), `Localization`, catalog keys listed in Global Constraints.
- Produces (Task 3 relies on): `buildStepPopupHtml(loc: Localization, model: DevotionModel, step: BuildStep, state: StepState): string`; build-order rows carrying `data-step-i="<index>"`.

- [ ] **Step 1: Write the failing tests**

Create `web/test/build-order-popup.test.ts`:

```ts
// ABOUTME: Tests the build-order step popup: post-step have/need table in the Affinity panel's visual
// ABOUTME: language plus the step constellation's Requires/Grants lines, rendered from replay states.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { buildReachCons, buildCoverTable, selectionView } from "../src/core/reachability";
import { buildOrderHtml, buildStepPopupHtml } from "../src/adapters/buildOrderView";
import { canonicalStarIds, decodeHash } from "../src/core/urlState";
import { enLoc } from "./helpers/localizeEn";

const model = buildModel(doc as any);
const cons = buildReachCons(model);
const table = buildCoverTable(cons);
const REPRO_HASH = "p=55&s=_38AQAIAAAAAAOAfAAAAAADAAYAHAMAHAAAAAPADPwAAAAAAPw";
const decoded = decodeHash(REPRO_HASH, canonicalStarIds(model))!;
const view = selectionView(model, cons, table, decoded.selected, 55);
const steps = view.buildOrder!;
const states = view.buildOrderStates!;

test("popup renders five affinity rows with have values and no filter-toggle attributes", () => {
  const html = buildStepPopupHtml(enLoc, model, steps[0]!, states[0]!);
  expect(html.match(/class="affinity affinity-/g)?.length).toBe(5);
  expect(html).toContain('class="aff-have"');
  expect(html).not.toContain("data-gtoggle");
  expect(html).not.toContain("data-gkey");
});

test("a verified order's popup never shows a missing need cell", () => {
  for (let i = 0; i < steps.length; i++) {
    expect(buildStepPopupHtml(enLoc, model, steps[i]!, states[i]!)).not.toContain("missing");
  }
});

test("popup shows Grants for a granting step and Requires for a requiring one", () => {
  const gi = states.findIndex((st) => st.conGrant.some((n) => n > 0));
  const ri = states.findIndex((st) => st.conReq.some((n) => n > 0));
  expect(gi).toBeGreaterThanOrEqual(0);
  expect(ri).toBeGreaterThanOrEqual(0);
  expect(buildStepPopupHtml(enLoc, model, steps[gi]!, states[gi]!)).toContain("Grants:");
  expect(buildStepPopupHtml(enLoc, model, steps[ri]!, states[ri]!)).toContain("Requires:");
});

test("a met need renders with the met class and the neededBy title", () => {
  // the last step: the whole build stands, so every demanded color is met
  const html = buildStepPopupHtml(enLoc, model, steps[steps.length - 1]!, states[states.length - 1]!);
  expect(html).toContain('class="aff-need met"');
  expect(html).toContain("needed by");
});

test("build-order rows carry their step index for popup lookup", () => {
  const html = buildOrderHtml(enLoc, model, null, steps, null);
  expect(html).toContain('data-step-i="0"');
  expect(html).toContain(`data-step-i="${steps.length - 1}"`);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && bun test test/build-order-popup.test.ts`
Expected: FAIL — `buildStepPopupHtml` is not exported.

- [ ] **Step 3: Implement in buildOrderView.ts**

Replace the ABOUTME header (lines 1-3) with:

```ts
// ABOUTME: Renders the guided build-order panel: a numbered step list with constellation art, scaffold
// ABOUTME: add/refund rows, a running held total, honest empty states, and the per-step affinity popup
// ABOUTME: (post-step have/need in the Affinity panel's visual language). Pure string output.
```

Extend the imports: add `AFFINITIES` as a value import from `../core/types` (the file already imports `type Affinity, type DevotionModel` from there) and add `import type { StepState } from "../core/orderLegality";`.

Add the shared name helper (place it after the `CROSSROADS` table). It is the row-name logic factored out; then use it in `buildOrderHtml` where `name` is currently computed:

```ts
// The step name shared by rows and the popup: crossroads get a direction label, others their game name.
function stepConName(loc: Localization, model: DevotionModel, conId: string): string {
  const c = model.constellations.get(conId);
  const cr = CROSSROADS[conId];
  return cr
    ? `${c ? loc.gameText(c.nameTag) : loc.translate("ui.buildOrder.crossroads")} (${loc.translate(`ui.buildOrder.dir.${cr.dirKey}`)})`
    : c
      ? loc.gameText(c.nameTag)
      : conId;
}
```

In `buildOrderHtml`, replace the inline `const name = cr ? ... : ...;` block with `const name = stepConName(loc, model, s.conId);`, change the map callback from `.map((s) => {` to `.map((s, si) => {`, and add `data-step-i="${si}"` to BOTH row templates, directly after `data-con-id="${esc(s.conId)}"`:

```ts
        return `<div class="bo-step bo-complete" data-con-id="${esc(s.conId)}" data-step-i="${si}"><span class="bo-n">${n}</span>${artCell}<span class="bo-name">${esc(name)}${partial}</span><span class="bo-pts">+${s.points}</span>${held}</div>`;
```

```ts
      return `<div class="bo-step ${cls}" data-con-id="${esc(s.conId)}" data-step-i="${si}"><span class="bo-n"></span>${artCell}<span class="bo-name">${label} ${esc(name)}</span><span class="bo-pts">${s.points > 0 ? "+" : ""}${s.points}</span>${held}</div>`;
```

Append the popup renderer at the end of the file:

```ts
// One "Requires: "/"Grants: " line with orb+number pairs for the nonzero colors, or "" when all zero.
function popAffinityLine(loc: Localization, labelKey: string, vec: Vec): string {
  const parts = AFFINITIES.map((a, i) =>
    vec[i]! > 0 ? `<span class="bo-pop-aff">${affinityOrb(a)}${vec[i]}</span>` : "",
  ).filter(Boolean);
  if (!parts.length) return "";
  return `<div class="bo-pop-line">${loc.translate(labelKey)}${parts.join(" ")}</div>`;
}

/**
 * The hover/tap popup for one build-order step: the post-step have/need table in the Affinity
 * panel's visual language (same classes, no filter-toggle attributes - the popup is display-only),
 * plus what the step's own constellation requires and grants. `state` comes from the verifying
 * replay via SelectionView.buildOrderStates, so the numbers are the ones the legality judge saw.
 */
export function buildStepPopupHtml(
  loc: Localization,
  model: DevotionModel,
  step: BuildStep,
  state: StepState,
): string {
  const name = esc(stepConName(loc, model, step.conId));
  const rows = AFFINITIES.map((a, i) => {
    const n = state.need[i]!;
    let needCell: string;
    if (n > 0) {
      const met = state.have[i]! >= n;
      const names = (state.needSource.get(i) ?? [])
        .map((cid) => {
          const tag = model.constellations.get(cid)?.nameTag;
          return tag ? loc.gameText(tag) : cid;
        })
        .join(", ");
      needCell = `<span class="aff-need ${met ? "met" : "missing"}" title="${esc(names ? loc.translate("ui.affinity.neededBy", { names }) : "")}">${n}</span>`;
    } else {
      needCell = `<span class="aff-need none">0</span>`;
    }
    return `<div class="affinity affinity-${a}"><span>${affinityOrb(a)}${loc.translate(`aff.${a}`)}</span><span class="aff-have">${state.have[i]}</span>${needCell}</div>`;
  }).join("");
  return (
    `<div class="bo-pop-name">${name}</div>` +
    popAffinityLine(loc, "ui.tooltip.requires", state.conReq) +
    popAffinityLine(loc, "ui.tooltip.grants", state.conGrant) +
    `<div class="affinity-head"><span></span><span class="aff-have">${loc.translate("ui.affinity.have")}</span><span class="aff-need-h">${loc.translate("ui.affinity.need")}</span></div>${rows}`
  );
}
```

- [ ] **Step 4: Run the focused tests, then the full suite**

Run: `cd web && bun test test/build-order-popup.test.ts`
Expected: PASS.
Run: `cd web && bun test`
Expected: PASS. If `build-order-view.test.ts` fails on exact-HTML assertions because of the new `data-step-i` attribute, update ONLY those assertions to include the attribute and note it in your report.

- [ ] **Step 5: Commit**

```bash
cd /Users/tednaleid/Library/CloudStorage/Dropbox/code/grimdawn-devotions
git add web/src/adapters/buildOrderView.ts web/test/build-order-popup.test.ts
git commit -m "feat(order): per-step affinity popup content in the Affinity panel's visual language"
```

(Include `web/test/build-order-view.test.ts` in the `git add` only if Step 4 required updating it.)

---

### Task 3: Wiring, CSS, e2e, acceptance

**Files:**
- Modify: `web/src/app/main.ts` (import line 16, state near line 555, `paintBuildOrder` at 558-572, refresh at 609/613, dismiss listener near the tooltip's at ~780)
- Modify: `web/src/styles.css` (after the `.bo-empty-sub` block, before `.con-highlight`)
- Modify: `web/e2e/smoke.ts` (new checks appended immediately before the final results summary)

**Interfaces:**
- Consumes: `buildStepPopupHtml` (Task 2), `SelectionView.buildOrderStates` and `StepState` (Task 1), existing `isTouch()`, `handle.highlightCon`, `paintBuildOrder` call site at main.ts:666 (`paintBuildOrder(curBuildOrder, boInfo)` — signature unchanged).
- Produces: the shipped feature; no downstream consumers.

- [ ] **Step 1: Wire main.ts**

Change line 16 to add the popup renderer:

```ts
import { buildOrderHtml, buildStepPopupHtml, type NoOrderInfo } from "../adapters/buildOrderView";
```

Directly below it add:

```ts
import type { StepState } from "../core/orderLegality";
```

Next to `let curBuildOrder: BuildStep[] | null = null;` (line ~555) add:

```ts
  let curBuildOrderStates: StepState[] | null = null; // the verifying replay's per-step states; parallel to curBuildOrder
  let boPopRow: HTMLElement | null = null; // the build-order row whose popup is showing (touch toggle + dismiss)
```

In `refresh`, after `curBuildOrder = view.buildOrder;` (line ~609) add `curBuildOrderStates = view.buildOrderStates;`, and in the degraded `else` branch after `curBuildOrder = null;` (line ~613) add `curBuildOrderStates = null;`.

Add the popup helpers directly above `paintBuildOrder`:

```ts
  // The step popup: a fixed singleton beside the hovered build-order row, showing the post-step
  // have/need state from the verifying replay. Display-only (pointer-events none), so taps pass
  // through and the document-level dismiss handles touch.
  function boPopEl(): HTMLElement {
    let el = document.getElementById("bo-pop");
    if (!el) {
      el = document.createElement("div");
      el.id = "bo-pop";
      document.body.appendChild(el);
    }
    return el;
  }
  function hideBoPop() {
    boPopRow = null;
    boPopEl().style.display = "none";
  }
  function showBoPop(row: HTMLElement) {
    const i = Number(row.dataset.stepI ?? -1);
    if (!curBuildOrder || !curBuildOrderStates || i < 0 || i >= curBuildOrderStates.length) return;
    const el = boPopEl();
    el.innerHTML = buildStepPopupHtml(localization, model, curBuildOrder[i]!, curBuildOrderStates[i]!);
    el.style.display = "block";
    // Beside the row, to its left (the panel hugs the right edge), clamped to the viewport.
    const r = row.getBoundingClientRect();
    el.style.left = `${Math.max(4, r.left - el.offsetWidth - 8)}px`;
    el.style.top = `${Math.min(Math.max(4, r.top - 4), window.innerHeight - el.offsetHeight - 4)}px`;
    boPopRow = row;
  }
```

In `paintBuildOrder`, add `hideBoPop();` as the FIRST line of the function body (a re-render invalidates the showing popup), and extend the row loop (lines 566-571) to:

```ts
    panel.querySelectorAll<HTMLElement>(".bo-step[data-con-id]").forEach((row) => {
      const cid = row.dataset.conId;
      if (!cid) return;
      row.addEventListener("mouseenter", () => {
        handle.highlightCon(cid);
        if (!isTouch()) showBoPop(row);
      });
      row.addEventListener("mouseleave", () => {
        handle.highlightCon(null);
        if (!isTouch()) hideBoPop();
      });
      // Touch: tap toggles this row's popup (the map tooltip's popover pattern).
      row.addEventListener("pointerup", () => {
        if (!isTouch()) return;
        if (boPopRow === row) hideBoPop();
        else showBoPop(row);
      });
    });
```

Register the tap-away dismiss once, directly after the tooltip's existing `document.addEventListener("pointerdown", ...)` block (~line 780):

```ts
  // Tap-away dismiss for the build-order step popup (it is pointer-events none, so any tap lands
  // outside it; tapping the same row is handled by the row's own toggle).
  document.addEventListener("pointerdown", (e) => {
    if (boPopRow && !boPopRow.contains(e.target as Node)) hideBoPop();
  });
```

- [ ] **Step 2: Add the CSS**

In `web/src/styles.css`, directly after the `.bo-empty-sub` rule block, add:

```css
#bo-pop {
  position: fixed;
  display: none;
  pointer-events: none;
  background: #1c2330;
  border: 1px solid #30363d;
  padding: 0.5rem 0.6rem;
  border-radius: 6px;
  font-size: 0.8rem;
  width: 220px;
  /* Same layer as the map tooltip: above corner toggles, scrim, and drawers. */
  z-index: 40;
}
#bo-pop .bo-pop-name {
  font-weight: 600;
  margin-bottom: 4px;
}
#bo-pop .bo-pop-line {
  margin: 2px 0;
  opacity: 0.9;
}
#bo-pop .bo-pop-aff {
  margin-right: 6px;
  white-space: nowrap;
}
```

(The `.affinity`, `.affinity-head`, `.aff-have`, `.aff-need` rules are global, so the popup's table inherits the sidebar panel's exact look.)

- [ ] **Step 3: Manual smoke on localhost**

Run: `just serve` (background), open `http://localhost:5173/#p=55&s=_38AQAIAAAAAAOAfAAAAAADAAYAHAMAHAAAAAPADPwAAAAAAPw`, hover several steps including a refund step. Verify: popup appears left of the row, five affinity rows, no red cells, Requires/Grants lines present where nonzero, popup hides on leave. Kill the server. Record what you saw in the report.

- [ ] **Step 4: Add the e2e checks**

In `web/e2e/smoke.ts`, immediately BEFORE the final results summary (the code that tallies `results` and exits), append:

```ts
  // --- Build-order step popup: hover shows the post-step have/need state ---
  await cdp.evaluate(`location.hash = "#p=55&s=_38AQAIAAAAAAOAfAAAAAADAAYAHAMAHAAAAAPADPwAAAAAAPw"`);
  for (let i = 0; i < 50; i++) {
    if ((await cdp.evaluate<number>("document.querySelectorAll('.bo-step').length")) > 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  check(
    (await cdp.evaluate<number>("document.querySelectorAll('.bo-step').length")) > 0,
    "repro URL renders build-order steps",
  );
  await cdp.evaluate(
    `document.querySelector('.bo-step').dispatchEvent(new MouseEvent('mouseenter',{bubbles:false}))`,
  );
  check(
    (await cdp.evaluate<string>("getComputedStyle(document.getElementById('bo-pop')).display")) === "block",
    "hovering a build-order step shows the popup",
  );
  check(
    (await cdp.evaluate<number>("document.querySelectorAll('#bo-pop .affinity').length")) === 5,
    "popup shows five affinity rows",
  );
  check(
    (await cdp.evaluate<number>("document.querySelectorAll('#bo-pop .aff-need.missing').length")) === 0,
    "popup of a verified order shows no missing need",
  );
  await cdp.evaluate(
    `document.querySelector('.bo-step').dispatchEvent(new MouseEvent('mouseleave',{bubbles:false}))`,
  );
  check(
    (await cdp.evaluate<string>("getComputedStyle(document.getElementById('bo-pop')).display")) === "none",
    "leaving the step hides the popup",
  );

  // --- Build-order step popup: touch tap-toggle (emulated coarse pointer) ---
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "hover", value: "none" },
      { name: "pointer", value: "coarse" },
    ],
  });
  const touchEmulated = await cdp.evaluate<boolean>(
    `matchMedia("(hover: none) and (pointer: coarse)").matches`,
  );
  if (touchEmulated) {
    // Re-render so the rows re-bind under touch semantics, then tap.
    await cdp.evaluate(`location.hash = "#p=55"`);
    await new Promise((r) => setTimeout(r, 300));
    await cdp.evaluate(`location.hash = "#p=55&s=_38AQAIAAAAAAOAfAAAAAADAAYAHAMAHAAAAAPADPwAAAAAAPw"`);
    for (let i = 0; i < 50; i++) {
      if ((await cdp.evaluate<number>("document.querySelectorAll('.bo-step').length")) > 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await cdp.evaluate(
      `document.querySelector('.bo-step').dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))`,
    );
    check(
      (await cdp.evaluate<string>("getComputedStyle(document.getElementById('bo-pop')).display")) === "block",
      "tapping a step (touch) shows the popup",
    );
    await cdp.evaluate(`document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
    check(
      (await cdp.evaluate<string>("getComputedStyle(document.getElementById('bo-pop')).display")) === "none",
      "tap-away dismisses the popup",
    );
  } else {
    check(true, "SKIPPED: hover/pointer media emulation unsupported in this Chrome; tap path shares showBoPop/hideBoPop with the verified hover path");
  }
  await cdp.send("Emulation.setEmulatedMedia", { features: [] });
```

Note: the SKIPPED branch is a named, visible skip, never a silent one — if it fires, say so in your report.

- [ ] **Step 5: Run the full acceptance**

```bash
just check
just e2e
just perf
```

Expected: `just check` green (full suite). `just e2e` green including the new popup checks (report whether the touch branch ran or skipped). `just perf` unchanged within noise (the states ride the replay the gate already runs; record the numbers).

- [ ] **Step 6: Commit**

```bash
cd /Users/tednaleid/Library/CloudStorage/Dropbox/code/grimdawn-devotions
git add web/src/app/main.ts web/src/styles.css web/e2e/smoke.ts
git commit -m "feat(order): hover/tap popup on build-order steps with the post-step affinity state"
```

---

## Acceptance (from the spec)

- Hovering any step of the reproduction URL's order shows the post-step have/need state and the step constellation's requires/grants; the final step's popup matches the Affinity panel (Task 1's agreement test); no step shows a missing cell (Task 2's sweep test, Task 3's e2e check).
- Touch: tap shows, re-tap and tap-away dismiss (Task 3 wiring + e2e touch branch).
- `just check`, `just e2e`, `just perf` green; one replay per click, same as before.
