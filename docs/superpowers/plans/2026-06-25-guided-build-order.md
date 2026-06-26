# Guided Build Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the player a legal constellation-by-constellation order (including transient scaffold add/refund) that assembles their current selection within their point cap, and an honest "no valid order" when it cannot be built.

**Architecture:** A pure engine function `buildOrderPath(cons, table, members, cap)` reuses the existing sampled construction witness (`sampledConstruction`/`peakToReach`) and emits a constellation-level step list with a running points-held total. It is computed live inside `selectionView` (the per-click engine throat, already timed by the perf guard and harness) at a cheap `tries=16`; an on-demand "Find valid order" button runs a higher-tries escalation off the live path. The right-sidebar adapter renders the steps with constellation art and map hover-sync.

**Tech Stack:** TypeScript, Bun test, the existing `web/src/core/reachability.ts` engine, DOM adapters in `web/src/adapters/`, `just` recipes.

## Global Constraints

- All new code files MUST start with two `// ABOUTME: ` comment lines.
- No emojis, emdashes, or hyperbole in code or docs.
- Use `just` recipes: `just test` (full suite + lint + typecheck via the pre-commit hook), `just typecheck`, `just validate-reach`. Prefer them over raw `bun`/`bunx`.
- URL state invariant: the build path is a PURE FUNCTION of the existing `(selection, cap)`. Add NO new client or URL state; it rides the existing share link (`web/src/core/urlState.ts` is untouched).
- The engine change to `peakToReach` MUST be additive: the existing no-options call sites (the hot sampling path) must behave byte-identically, so `just validate-reach` Part B (real-model false-dims = 0) and the existing `reach-peakcost.test.ts` stay green unchanged.
- v1 scope = live `tries=16` + an on-demand high-tries escalation button. The tier-3 bounded exact `minPeakCost` verify is OUT of v1 (fast-follow); leave the escalation button as its future hook but do not port `minPeakCost` into core here.
- Point cap (budget) constant is `BUDGET = 55` (`web/src/core/reachability.ts:13`); per-color affinity caps are fixed in the engine. Do not hardcode 55 in new code; thread `cap`/`BUDGET`.

---

### Task 1: `peakToReach` returns its chosen scaffold subset (with a crossroads bias)

**Files:**
- Modify: `web/src/core/reachability.ts` (`peakToReach`, currently lines 407-456)
- Test: `web/test/build-order-path.test.ts` (Create)

**Interfaces:**
- Consumes: existing `peakToReach(cons, table, deficit, base?, peakNodeCap?)` returning the min scaffold SIZE.
- Produces: `peakToReach(cons, table, deficit, base?, peakNodeCap?, opts?)` where `opts?: { collect?: ReachCon[]; preferSmall?: boolean }`. When `opts.collect` is passed, the function fills it with the granting constellations of one minimum-size scaffold subset that covers `deficit` given `base`. When `opts.preferSmall` is true, ties among equal scaffolds are broken toward requirement-free, smaller constellations (crossroads), so the collected subset reads as crossroads when they suffice. The returned number (size) is unchanged for all existing no-`opts` callers.

- [ ] **Step 1: Write the failing test**

Add to a new file `web/test/build-order-path.test.ts`:

```ts
// ABOUTME: Tests the build-order engine: peakToReach's scaffold-subset collection (Task 1) and
// ABOUTME: buildOrderPath's constellation-level construction schedule (Task 2), including the replay
// ABOUTME: legality invariant and the no-path (false-reach) cases.
import { test, expect } from "bun:test";
import {
  buildCoverTable,
  peakToReach,
  type ReachCon,
  type Vec,
} from "../src/core/reachability";

const z = (): Vec => [0, 0, 0, 0, 0];
const v = (asc = 0, cha = 0, eld = 0, ord = 0, pri = 0): Vec => [asc, cha, eld, ord, pri];
const con = (id: string, size: number, req: Vec, grant: Vec): ReachCon => ({ id, size, req, grant });
const cx = (i: number, id = `x${i}`): ReachCon => {
  const g = z();
  g[i] = 1;
  return { id, size: 1, req: z(), grant: g };
};
const anchor = (req: Vec): ReachCon => con("anchor", 1, req, z());

test("peakToReach collects a minimum scaffold subset covering the deficit", () => {
  // Deficit asc 1 + eld 1: the two crossroads (x0 asc, x2 eld) cover it, size 2.
  const cons = [cx(0), cx(2), anchor(v(1, 0, 1))];
  const table = buildCoverTable(cons);
  const collect: ReachCon[] = [];
  const size = peakToReach(cons, table, v(1, 0, 1), z(), 300_000, { collect });
  expect(size).toBe(2);
  expect(collect.map((c) => c.id).sort()).toEqual(["x0", "x2"]);
});

test("peakToReach preferSmall picks crossroads over an equal-size larger granter", () => {
  // Two ways to get eld 1 at size 1: the eldritch crossroads (req-free) or 'big' (also size 1 but
  // carries a requirement). preferSmall must choose the req-free crossroads.
  const big = con("big", 1, v(1, 0, 0), v(0, 0, 1)); // size 1, but needs asc 1 to place
  const cons = [cx(0), cx(2, "eldx"), big, anchor(v(0, 0, 1))];
  const table = buildCoverTable(cons);
  const collect: ReachCon[] = [];
  const size = peakToReach(cons, table, v(0, 0, 1), z(), 300_000, { collect, preferSmall: true });
  expect(size).toBe(1);
  expect(collect.map((c) => c.id)).toEqual(["eldx"]);
});

test("peakToReach without opts is unchanged (no allocation, same size)", () => {
  const cons = [cx(0), cx(2), anchor(v(1, 0, 1))];
  const table = buildCoverTable(cons);
  expect(peakToReach(cons, table, v(1, 0, 1))).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun test build-order-path.test.ts`
Expected: FAIL - the two `collect` tests fail because `peakToReach` ignores the 6th argument today (collect stays empty). The third (no-opts) test passes.

- [ ] **Step 3: Implement the minimal change**

In `web/src/core/reachability.ts`, change the `peakToReach` signature and body. The current signature is:

```ts
export function peakToReach(
  cons: ReachCon[],
  table: CoverTable,
  deficit: Vec,
  base: Vec = [0, 0, 0, 0, 0],
  peakNodeCap = 300_000,
): number {
```

Change it to add the options object:

```ts
export function peakToReach(
  cons: ReachCon[],
  table: CoverTable,
  deficit: Vec,
  base: Vec = [0, 0, 0, 0, 0],
  peakNodeCap = 300_000,
  opts?: { collect?: ReachCon[]; preferSmall?: boolean },
): number {
```

Replace the scaffold sort line (currently `const scaffolds = cons.filter(grants).sort((a, b) => ratio(b) - ratio(a));`) with a sort that biases toward crossroads only when requested:

```ts
  const reqFree = (c: ReachCon) => c.req[0] === 0 && c.req[1] === 0 && c.req[2] === 0 && c.req[3] === 0 && c.req[4] === 0;
  const scaffolds = cons
    .filter(grants)
    .sort(
      opts?.preferSmall
        ? (a, b) => (reqFree(b) ? 1 : 0) - (reqFree(a) ? 1 : 0) || a.size - b.size || ratio(b) - ratio(a)
        : (a, b) => ratio(b) - ratio(a),
    );
```

Track the best subset. Just before `let best = INF;`, add:

```ts
  let bestUsed: ReachCon[] | null = null;
```

In the `dfs` function, where it records a covering subset (currently `best = size; return;` inside the `if (rem[...] === 0 ...)` block), record the chosen scaffolds when collecting:

```ts
    if (rem[0] === 0 && rem[1] === 0 && rem[2] === 0 && rem[3] === 0 && rem[4] === 0) {
      best = size;
      if (opts?.collect) bestUsed = scaffolds.filter((_, i) => used[i]!);
      return;
    }
```

After `dfs(zero(), 0);` and before `return best;`, copy the subset out:

```ts
  if (opts?.collect) {
    opts.collect.length = 0;
    if (bestUsed) opts.collect.push(...bestUsed);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && bun test build-order-path.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Verify the hot path is unchanged**

Run: `just validate-reach`
Expected: `PASS` with `CONFIRMED false-dims ... =0` (real-model false-dims still 0). The existing `reach-peakcost.test.ts` must also still pass: `cd web && bun test reach-peakcost.test.ts` -> PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/core/reachability.ts web/test/build-order-path.test.ts
git commit -m "feat(reach): peakToReach can collect its chosen scaffold subset (crossroads-biased)"
```

---

### Task 2: `buildOrderPath` emits the constellation-level construction schedule

**Files:**
- Modify: `web/src/core/reachability.ts` (add `BuildStep`, `buildOrderPath`, `buildOrderEscalated` near `minPeakSampledOrder`, around line 593)
- Test: `web/test/build-order-path.test.ts` (extend)

**Interfaces:**
- Consumes: the module-private `sampledConstruction` and `buildParts`, the in-module `zero`/`maxV`/`addCap`/`covers`/`INF`/`BUDGET`/`Vec`/`CoverTable`/`ReachCon`, and `peakToReach(..., { collect, preferSmall })` from Task 1.
- Produces:
  - `export type BuildStep = { kind: "complete" | "scaffold-add" | "scaffold-refund"; conId: string; points: number; heldAfter: number }` (`points` is the constellation star count, negative for refunds; `heldAfter` is the running total points held after the step, never exceeding the cap).
  - `export function buildOrderPath(cons: ReachCon[], table: CoverTable, B: ReachCon[], budget?: number, tries?: number, peakNodeCap?: number): BuildStep[] | null` - the ordered schedule, or `null` when no sampled order fits the budget (B not self-covering, or peak over budget at the given `tries`).
  - `export function buildOrderEscalated(cons: ReachCon[], table: CoverTable, B: ReachCon[], budget?: number): BuildStep[] | null` - the on-demand high-tries retry (`tries=4096`).

- [ ] **Step 1: Write the failing test**

Add to `web/test/build-order-path.test.ts` (it already imports from `../src/core/reachability`; extend the import to add `buildOrderPath`, `buildOrderEscalated`, `buildCoverTable` is already imported, and add `type BuildStep`). Also add the real-model imports and a replay-legality helper:

```ts
import doc from "../../data/devotions.json";
import fixtureJson from "./fixtures/reachable-builds.json";
import { buildModel } from "../src/core/model";
import {
  buildReachCons,
  buildOrderPath,
  buildOrderEscalated,
  type BuildStep,
} from "../src/core/reachability";

const fixture = fixtureJson as unknown as { cases: { label: string; sel: Record<string, number> }[] };
const model = buildModel(doc as any);
const realCons = buildReachCons(model);
const realTable = buildCoverTable(realCons);
const byId = new Map(realCons.map((c) => [c.id, c]));
// Each fixture key is a completed constellation (the fixtures are complete self-covering builds), so map
// keys to their whole-constellation ReachCon - matching the existing buildOf helper in build-order.test.ts.
const membersOf = (sel: Record<string, number>): ReachCon[] =>
  Object.keys(sel)
    .map((id) => byId.get(id))
    .filter((c): c is ReachCon => !!c);

// Replay a schedule and assert it is a LEGAL construction: at each step held points <= cap, a member's
// requirement is covered by the affinity already supplied when it is completed, and the final completed
// set (completes minus refunds) equals B with the build self-covering. Returns the end-state member ids.
function replayLegal(steps: BuildStep[], allCons: ReachCon[], cap: number): Set<string> {
  const cById = new Map(allCons.map((c) => [c.id, c]));
  let held = 0;
  let supply: Vec = z();
  const present = new Set<string>();
  const addCapV = (a: Vec, b: Vec): Vec => [
    Math.min(a[0] + b[0], 20), Math.min(a[1] + b[1], 8), Math.min(a[2] + b[2], 20),
    Math.min(a[3] + b[3], 10), Math.min(a[4] + b[4], 20),
  ];
  const coversV = (g: Vec, d: Vec) => g.every((x, i) => x >= d[i]!);
  for (const s of steps) {
    const c = cById.get(s.conId)!;
    if (s.kind === "scaffold-refund") {
      held -= c.size;
      present.delete(s.conId);
      // recompute supply from present completed members
      supply = z();
      for (const id of present) supply = addCapV(supply, cById.get(id)!.grant);
    } else {
      // both complete and scaffold-add must have their requirement met by current supply
      expect(coversV(supply, c.req)).toBe(true);
      held += c.size;
      present.add(s.conId);
      supply = addCapV(supply, c.grant);
    }
    expect(held).toBeLessThanOrEqual(cap);
    expect(s.heldAfter).toBe(held);
  }
  return present;
}

test("buildOrderPath: a hand build needing a chaos crossroads bootstrap adds then refunds it", () => {
  // Self-covering build that still needs a crossroads to BOOTSTRAP. V needs chaos 1 to enter and grants
  // chaos 6 (size 5); CAP needs chaos 6 (size 2), grants 0. supply chaos 6 covers CAP, so B is self-
  // covering - but V's own chaos-1 entry is met only by holding the chaos crossroads, refunded once V is
  // in (V then self-supplies its chaos 1). Peak when V is placed with the crossroads held = 5 + 1 = 6.
  const vulture = con("V", 5, v(0, 1, 0, 0, 0), v(0, 6, 0, 0, 0));
  const cap6 = con("CAP", 2, v(0, 6, 0, 0, 0), z());
  const all = [vulture, cap6, cx(1, "chaosx")];
  const table = buildCoverTable(all);
  const steps = buildOrderPath(all, table, [vulture, cap6], 55, 16)!;
  expect(steps).not.toBeNull();
  const kinds = steps.map((s) => `${s.kind}:${s.conId}`);
  expect(kinds).toContain("scaffold-add:chaosx");
  expect(kinds).toContain("scaffold-refund:chaosx");
  expect(steps.filter((s) => s.kind === "complete").map((s) => s.conId).sort()).toEqual(["CAP", "V"]);
  replayLegal(steps, all, 55);
});

test("buildOrderPath: real reachable fixtures all replay as legal constructions within 55", () => {
  let checked = 0;
  for (const c of fixture.cases) {
    const members = membersOf(c.sel);
    if (!members.length) continue;
    const steps = buildOrderPath(realCons, realTable, members, 55, 16);
    if (!steps) continue; // tries=16 cliff miss; covered by escalation test
    const end = replayLegal(steps, realCons, 55);
    expect([...end].sort()).toEqual(members.map((m) => m.id).sort());
    checked++;
  }
  expect(checked).toBeGreaterThan(0);
});

test("buildOrderPath: the confirmed false-reach build has no order within 55", () => {
  // seed 5563 from the real-map hunt: engine lights it, exact min-peak is 56.
  const names = [
    "Akeron's Scorpion", "Fiend", "Lion", "Mantis", "Wretch", "Assassin", "Dire Bear",
    "Revenant", "Rhowan's Crown", "Solael's Witchblade", "Ulo the Keeper of the Waters",
  ];
  const nameToId = new Map([...model.constellations.values()].map((c) => [c.name, c.id]));
  const members = names.map((n) => byId.get(nameToId.get(n)!)!);
  expect(buildOrderPath(realCons, realTable, members, 55, 16)).toBeNull();
  expect(buildOrderEscalated(realCons, realTable, members, 55)).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun test build-order-path.test.ts`
Expected: FAIL - `buildOrderPath`/`buildOrderEscalated` are not exported yet (import error / not a function).

- [ ] **Step 3: Implement `BuildStep`, `buildOrderPath`, `buildOrderEscalated`**

In `web/src/core/reachability.ts`, immediately after `minPeakSampledOrder` (ends around line 593), add:

```ts
/** One step of a guided build order. `points` is the constellation's star count (negative on refund);
 *  `heldAfter` is the running points held after the step, which never exceeds the cap. */
export type BuildStep =
  | { kind: "complete"; conId: string; points: number; heldAfter: number }
  | { kind: "scaffold-add"; conId: string; points: number; heldAfter: number }
  | { kind: "scaffold-refund"; conId: string; points: number; heldAfter: number };

/**
 * A legal constellation-level order that assembles the self-covering build `B` within `budget` points
 * held at once, including the transient scaffold to ADD before a step and REFUND once the build's own
 * grants cover it. Replays the sampled construction order (sampledConstruction) and, at each step, asks
 * peakToReach for the actual scaffold SET to hold (crossroads-biased), diffing consecutive sets into
 * add/refund events. Returns null when no sampled order fits the budget (B not self-covering, or the
 * construction peak exceeds budget at the given `tries` - the honest "not validly buildable" signal).
 */
export function buildOrderPath(
  cons: ReachCon[],
  table: CoverTable,
  B: ReachCon[],
  budget = BUDGET,
  tries = 16,
  peakNodeCap = 3000,
): BuildStep[] | null {
  const sc = sampledConstruction(cons, table, B, budget, tries, peakNodeCap);
  if (sc.peak > budget) return null;
  const parts = buildParts(cons, B);
  if (!parts) return null; // not self-covering
  const pool = parts.pool;
  const REPLAY_CAP = 300_000; // cold path: find the exact min subset, immune to the sampling node cap
  const steps: BuildStep[] = [];
  let grant: Vec = zero();
  let mreq: Vec = zero();
  let held: ReachCon[] = [];
  let running = 0;
  for (const m of sc.order) {
    mreq = maxV(mreq, m.req);
    const def: Vec = [
      Math.max(0, mreq[0] - grant[0]),
      Math.max(0, mreq[1] - grant[1]),
      Math.max(0, mreq[2] - grant[2]),
      Math.max(0, mreq[3] - grant[3]),
      Math.max(0, mreq[4] - grant[4]),
    ];
    const need: ReachCon[] = [];
    const sz = peakToReach(pool, table, def, grant, REPLAY_CAP, { collect: need, preferSmall: true });
    if (sz >= INF) return null;
    const needIds = new Set(need.map((s) => s.id));
    for (const s of held)
      if (!needIds.has(s.id)) {
        running -= s.size;
        steps.push({ kind: "scaffold-refund", conId: s.id, points: -s.size, heldAfter: running });
      }
    const heldIds = new Set(held.map((s) => s.id));
    for (const s of need)
      if (!heldIds.has(s.id)) {
        running += s.size;
        steps.push({ kind: "scaffold-add", conId: s.id, points: s.size, heldAfter: running });
      }
    held = need;
    if (running > budget) return null; // soundness guard
    running += m.size;
    steps.push({ kind: "complete", conId: m.id, points: m.size, heldAfter: running });
    if (running > budget) return null;
    grant = addCap(grant, m.grant);
  }
  for (const s of held) {
    running -= s.size;
    steps.push({ kind: "scaffold-refund", conId: s.id, points: -s.size, heldAfter: running });
  }
  for (const t of sc.tail) {
    running += t.size;
    steps.push({ kind: "complete", conId: t.id, points: t.size, heldAfter: running });
    if (running > budget) return null;
  }
  return steps;
}

/** The on-demand escalation behind the "Find valid order" button: the same schedule at high tries, to
 *  recover cliff builds the live tries=16 pass missed. Off the live/per-click path. */
export function buildOrderEscalated(
  cons: ReachCon[],
  table: CoverTable,
  B: ReachCon[],
  budget = BUDGET,
): BuildStep[] | null {
  return buildOrderPath(cons, table, B, budget, 4096, 3000);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && bun test build-order-path.test.ts`
Expected: PASS (all Task 1 + Task 2 tests). If the false-reach test's `buildOrderEscalated` unexpectedly returns a path, that would be a real finding - stop and report, do not weaken the test.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/reachability.ts web/test/build-order-path.test.ts
git commit -m "feat(reach): buildOrderPath emits the constellation-level construction schedule"
```

---

### Task 3: Fold `buildOrder` into `selectionView` (live, timed) + perf guard

**Files:**
- Modify: `web/src/core/reachability.ts` (`SelectionView` interface line 884, `selectionView` line 897)
- Modify: `web/test/reachability-perf-guard.test.ts` (add the false-reach states)
- Test: `web/test/reachability.test.ts` (add a selectionView.buildOrder assertion)

**Interfaces:**
- Consumes: `buildOrderPath` (Task 2), `selectionSummary(model, selected).built` (the member list), `BuildStep`.
- Produces: `SelectionView` gains `buildOrder: BuildStep[] | null`, computed live at `tries=16` with `budget = cap`. Every `selectionView` caller (main.ts, perf guard, perf harness) now also pays and measures the build-order cost.

- [ ] **Step 1: Write the failing test**

Add to `web/test/reachability.test.ts` (it already builds `realModel`, `cons`, `cover`, and has the `id(name)` helper):

```ts
test("selectionView returns a legal buildOrder for a reachable build and null for a false-reach", () => {
  // A small reachable build: Crossroads(chaos) is implicit; pick a simple self-covering pair via a hash
  // already used above is overkill - use the Imp Wraith state which classifies reachable.
  const sel = decodeHash("p=55&s=AAAAAAAAAAAAwAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAHAAAAAAB-AAD4AQ", starCanon)!.selected;
  const view = selectionView(realModel, cons, cover, sel, 55);
  expect(view.buildOrder).not.toBeNull();
  // every heldAfter is within the cap
  for (const s of view.buildOrder!) expect(s.heldAfter).toBeLessThanOrEqual(55);

  // The confirmed false-reach (seed 5563) classifies reachable but has no valid order within 55.
  const names = [
    "Akeron's Scorpion", "Fiend", "Lion", "Mantis", "Wretch", "Assassin", "Dire Bear",
    "Revenant", "Rhowan's Crown", "Solael's Witchblade", "Ulo the Keeper of the Waters",
  ];
  const fr = new Set<string>();
  for (const n of names) for (const sid of realModel.constellations.get(id(n))!.starIds) fr.add(sid);
  const frView = selectionView(realModel, cons, cover, fr, 55);
  expect(frView.reach).toBeDefined();
  expect(frView.buildOrder).toBeNull();
}, 30_000);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun test reachability.test.ts -t "buildOrder"`
Expected: FAIL - `view.buildOrder` is undefined (property does not exist yet).

- [ ] **Step 3: Implement the integration**

In `web/src/core/reachability.ts`, extend the `SelectionView` interface:

```ts
export interface SelectionView {
  minCost: number; // selectionMinCost: fewest points that keep this selection a legal build (the slider floor)
  reach: ReachView; // reachabilityForSelection: dimming, clickable stars, and the affinity panel vectors
  buildOrder: BuildStep[] | null; // live (tries=16) constellation-level order to assemble the selection, or null
}
```

And `selectionView`:

```ts
export function selectionView(
  model: DevotionModel,
  cons: ReachCon[],
  table: CoverTable,
  selected: Set<StarId>,
  cap = BUDGET,
): SelectionView {
  const minCost = selectionMinCost(model, cons, table, selected);
  const reach = reachabilityForSelection(model, cons, table, selected, Math.max(cap, minCost));
  const members = selectionSummary(model, selected).built;
  const buildOrder = members.length ? buildOrderPath(cons, table, members, cap, 16) : null;
  return { minCost, reach, buildOrder };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && bun test reachability.test.ts -t "buildOrder"`
Expected: PASS.

- [ ] **Step 5: Add the perf guard states**

In `web/test/reachability-perf-guard.test.ts`, the `TED_STATES` array guards tight builds through `selectionView` (which now includes build-order). Add the two confirmed false-reach builds (where `buildOrder` runs all 16 passes with no early exit - the worst build-order cost) so the guard explicitly covers it. Append to `TED_STATES`:

```ts
  // The two confirmed real-map false-reaches: selectionView now also computes buildOrder (tries=16),
  // which on these unreachable builds runs all 16 passes (no early exit) - the worst build-order cost.
  "#p=55&s=HwAAAAAAAD4AAAAABzwAAAAAAAAAAACABwDAHwAAAAAA4AcAAAAAAACA_wMA8AEAAAAf",
  "#p=55&s=AADwAQCADwAAAAAfAAAAAAAAAAAAAD4AAAAAAPADAAAA4AcAAAAAPwCA_wMAAMAP",
```

- [ ] **Step 6: Run the perf guard and the full suite**

Run: `cd web && bun test reachability-perf-guard.test.ts`
Expected: PASS, `worst.ms < 1500`. If it logs a slowest state, confirm it is well under 1500ms (build-order at tries=16 adds tens of ms at most).

Run: `just validate-reach`
Expected: `PASS` (real-model false-dims still 0 - the resolver is untouched).

- [ ] **Step 7: Commit**

```bash
git add web/src/core/reachability.ts web/test/reachability.test.ts web/test/reachability-perf-guard.test.ts
git commit -m "feat(reach): selectionView computes the live build order (timed by the perf guard)"
```

---

### Task 4: Build-order sidebar view (step-list with constellation art)

**Files:**
- Create: `web/src/adapters/buildOrderView.ts`
- Test: `web/test/build-order-view.test.ts` (Create)

**Interfaces:**
- Consumes: `BuildStep` (Task 2), `DevotionModel`, the art manifest shape used by `svgRenderer.ts` (`manifest.images[name]`, keyed by the basename of `c.background.image`).
- Produces: `export function buildOrderHtml(model: DevotionModel, manifest: ArtManifest | undefined, steps: BuildStep[] | null): string` - the panel HTML. When `steps` is null it returns the empty-state HTML containing a `data-find-order` button. Each step row carries `data-con-id` for map hover-sync.

- [ ] **Step 1: Write the failing test**

Create `web/test/build-order-view.test.ts`:

```ts
// ABOUTME: Tests buildOrderHtml - the right-sidebar build-order panel markup: numbered complete rows with
// ABOUTME: constellation art, distinct scaffold add/refund rows with the running held total, and the
// ABOUTME: null/empty state with the on-demand "Find valid order" button.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { buildOrderHtml } from "../src/adapters/buildOrderView";
import type { BuildStep } from "../src/core/reachability";

const model = buildModel(doc as any);
const firstCon = [...model.constellations.values()][0]!;

test("buildOrderHtml renders complete and scaffold rows with held totals and con ids", () => {
  const steps: BuildStep[] = [
    { kind: "scaffold-add", conId: firstCon.id, points: 1, heldAfter: 1 },
    { kind: "complete", conId: firstCon.id, points: 5, heldAfter: 6 },
    { kind: "scaffold-refund", conId: firstCon.id, points: -1, heldAfter: 5 },
  ];
  const html = buildOrderHtml(model, undefined, steps);
  expect(html).toContain(`data-con-id="${firstCon.id}"`);
  expect(html).toContain(firstCon.name);
  expect(html).toContain("bo-add");
  expect(html).toContain("bo-refund");
  expect(html).toContain("6"); // a held total
});

test("buildOrderHtml null renders the empty state with a find-order button", () => {
  const html = buildOrderHtml(model, undefined, null);
  expect(html).toContain("data-find-order");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun test build-order-view.test.ts`
Expected: FAIL - `buildOrderView.ts` does not exist.

- [ ] **Step 3: Implement `buildOrderHtml`**

First confirm the manifest/art shape used in the renderer (read `web/src/adapters/svgRenderer.ts` around lines 81-82 and 172-186: `const name = c.background?.image?.split("/").pop() ?? ""; const art = manifest?.images[name];`). Mirror that lookup. Create `web/src/adapters/buildOrderView.ts`:

```ts
// ABOUTME: Renders the guided build-order panel for the right sidebar: a numbered step list with
// ABOUTME: constellation art on complete rows, distinct scaffold add/refund rows, and a running held
// ABOUTME: total. Pure string output; the null state offers an on-demand "Find valid order" button.
import type { DevotionModel } from "../core/types";
import type { BuildStep } from "../core/reachability";

type ArtManifest = { images: Record<string, { href: string; width: number; height: number }> };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildOrderHtml(model: DevotionModel, manifest: ArtManifest | undefined, steps: BuildStep[] | null): string {
  if (!steps) {
    return (
      `<h2>Build order</h2>` +
      `<div class="bo-empty">No quick build order found.` +
      ` <button type="button" data-find-order>Find valid order</button></div>`
    );
  }
  let n = 0;
  const rows = steps
    .map((s) => {
      const c = model.constellations.get(s.conId);
      const name = c ? c.name : s.conId;
      const artName = c?.background?.image?.split("/").pop() ?? "";
      const art = manifest?.images[artName];
      const img = art && s.kind === "complete" ? `<img class="bo-art" src="${esc(art.href)}" alt=""/>` : "";
      const held = `<span class="bo-held">${s.heldAfter}</span>`;
      if (s.kind === "complete") {
        n++;
        return `<div class="bo-step bo-complete" data-con-id="${esc(s.conId)}"><span class="bo-n">${n}</span>${img}<span class="bo-name">${esc(name)}</span><span class="bo-pts">+${s.points}</span>${held}</div>`;
      }
      const label = s.kind === "scaffold-add" ? "Add" : "Refund";
      const cls = s.kind === "scaffold-add" ? "bo-add" : "bo-refund";
      return `<div class="bo-step ${cls}" data-con-id="${esc(s.conId)}"><span class="bo-n"></span><span class="bo-name">${label} ${esc(name)}</span><span class="bo-pts">${s.points > 0 ? "+" : ""}${s.points}</span>${held}</div>`;
    })
    .join("");
  return `<h2>Build order</h2><div class="bo-list">${rows}</div>`;
}
```

Note: confirm the actual `ArtManifest`/`manifest.images` value type by reading `svgRenderer.ts`; if `art` exposes a different field than `href` (for example `image` or a data URL), use that field name here and in the test. Keep the type local to this file unless a shared type already exists.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && bun test build-order-view.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/adapters/buildOrderView.ts web/test/build-order-view.test.ts
git commit -m "feat(ui): build-order sidebar panel markup (step list with constellation art)"
```

---

### Task 5: Wire the panel into `main.ts` (render, escalation button, hover-sync) + styles

**Files:**
- Modify: `web/src/app/main.ts` (the `refresh()` body around lines 396-401)
- Modify: `web/src/styles.css` (add `.bo-*` styles)
- Test: manual (DOM wiring); the build + full suite must stay green.

**Interfaces:**
- Consumes: `view.buildOrder` from `selectionView` (Task 3), `buildOrderHtml` (Task 4), `buildOrderEscalated` (Task 2), `data.manifest`, and the existing `affinityEl` panel container and map hover/`data-con-id` infrastructure.
- Produces: the rendered panel under the Affinity panel; a working "Find valid order" button; row hover highlights the constellation on the map.

- [ ] **Step 1: Add a `paintBuildOrder` helper that renders the panel and wires it**

`affinityEl.innerHTML` is rebuilt every `refresh()` (by `renderAffinities`), so the build-order panel is destroyed and must be re-created each refresh. Render it into a wrapper `#build-order-panel` so the escalation button can repaint it in place WITHOUT a full refresh (a full refresh would recompute the live `tries=16` result and discard the escalation). Add the import near the other adapter imports (line 6 area):

```ts
import { buildOrderHtml } from "../adapters/buildOrderView";
```

Add `selectionSummary` and `buildOrderEscalated` to the existing `from "../core/reachability"` import block (line 11 area), and import the type: add `import type { BuildStep } from "../core/reachability";`.

Define a `paintBuildOrder` helper alongside `renderBenefitsPanel` (near line 348). It creates the wrapper if missing, sets its HTML, and re-wires the button + hover each time (handlers are on freshly-created nodes, so no leak):

```ts
  function paintBuildOrder(steps: BuildStep[] | null) {
    let panel = document.getElementById("build-order-panel");
    if (!panel) {
      affinityEl.insertAdjacentHTML("beforeend", `<hr class="panel-sep"/><div id="build-order-panel"></div>`);
      panel = document.getElementById("build-order-panel")!;
    }
    panel.innerHTML = buildOrderHtml(model, data.manifest, steps);
    const findBtn = panel.querySelector<HTMLButtonElement>("[data-find-order]");
    findBtn?.addEventListener("click", () => {
      findBtn.disabled = true;
      findBtn.textContent = "Searching...";
      // defer one tick so the disabled/searching state paints before the synchronous escalation runs
      setTimeout(() => {
        const members = selectionSummary(model, state.selected).built;
        paintBuildOrder(members.length ? buildOrderEscalated(cons, table, members, state.pointCap) : null);
      }, 0);
    });
    // Hover-sync. The build-order rows ALSO carry data-con-id, so the map lookup MUST be scoped to the map
    // container - confirm its id by reading index.html / where svgRenderer mounts (e.g. `#map-container`).
    const mapRoot = document.getElementById("map-container");
    panel.querySelectorAll<HTMLElement>(".bo-step[data-con-id]").forEach((row) => {
      const art = mapRoot?.querySelector<SVGElement>(`[data-con-id="${row.dataset.conId}"]`);
      if (!art) return;
      row.addEventListener("mouseenter", () => art.classList.add("bo-highlight"));
      row.addEventListener("mouseleave", () => art.classList.remove("bo-highlight"));
    });
  }
```

If a highlight class already exists for constellation emphasis, reuse it instead of `bo-highlight` (and drop the `.bo-highlight` style in Step 3).

- [ ] **Step 2: Capture the live build order and paint it each refresh**

In `refresh()`, capture the live result and paint after the existing avail/pet insertions. In the capped branch (line 378-382):

```ts
      const view = selectionView(model, cons, table, state.selected, state.pointCap);
      curMin = view.minCost;
      if (state.pointCap < curMin) state = { selected: state.selected, pointCap: curMin };
      reach = view.reach;
      curBuildOrder = view.buildOrder;
```

Declare `let curBuildOrder: BuildStep[] | null = null;` next to the other `let` holders (near `let availHtml = "";`, line 344). In the degraded branch (line 383-386) set `curBuildOrder = null;`.

After the avail/pet `insertAdjacentHTML` calls (after line 401), paint the panel:

```ts
    paintBuildOrder(curBuildOrder);
```

This recreates the panel with the live `tries=16` result every refresh; the escalation button repaints `#build-order-panel` in place until the next selection change.

- [ ] **Step 3: Add styles**

In `web/src/styles.css`, add (match the existing panel/affinity styling conventions in that file):

```css
.bo-list { display: flex; flex-direction: column; gap: 2px; }
.bo-step { display: grid; grid-template-columns: 1.5em 1.4em 1fr auto auto; align-items: center; gap: 6px; padding: 2px 4px; border-radius: 3px; }
.bo-step:hover { background: rgba(255, 255, 255, 0.06); }
.bo-n { text-align: right; opacity: 0.6; }
.bo-art { width: 1.4em; height: 1.4em; object-fit: contain; }
.bo-add { opacity: 0.85; font-style: italic; }
.bo-refund { opacity: 0.6; font-style: italic; }
.bo-pts { opacity: 0.7; font-variant-numeric: tabular-nums; }
.bo-held { min-width: 2.2em; text-align: right; opacity: 0.5; font-variant-numeric: tabular-nums; }
.bo-empty { opacity: 0.8; font-size: 0.9em; }
.bo-highlight { outline: 2px solid #ffd479; }
```

- [ ] **Step 4: Verify build, types, and suite**

Run: `just typecheck`
Expected: no errors.

Run: `just test`
Expected: full suite green (the pre-commit hook runs format + test + lint + typecheck).

- [ ] **Step 5: Manual verification**

Start the dev server (`just dev` or the project's run recipe) and:
- Open `http://localhost:5173/#p=55&s=HwAAAAAAAD4AAAAABzwAAAAAAAAAAACABwDAHwAAAAAA4AcAAAAAAACA_wMA8AEAAAAf` (false-reach seed 5563): the build-order panel shows "No quick build order found" with a "Find valid order" button; clicking it searches and still reports none (it is genuinely unbuildable at 55).
- Open a normal complete build: the panel lists numbered constellation steps with art; any bootstrap build (e.g. one needing a chaos crossroads) shows the Add/Refund scaffold rows and a running held total that never exceeds the cap.
- Hover a step row: the matching constellation highlights on the map.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/main.ts web/src/styles.css
git commit -m "feat(ui): wire the build-order panel, escalation button, and map hover-sync"
```

---

## Notes for the executor

- The tier-3 bounded exact `minPeakCost` verify is intentionally OUT of v1. The "Find valid order" button is its future hook: when tier 3 lands, that button (or a second press) runs the bounded exact check to turn "couldn't find" into a definitive "not buildable". Do not port `minPeakCost` into core in this plan.
- If any real reachable fixture in Task 2 Step 1 fails the replay-legality assertion, that is a genuine engine bug in `buildOrderPath` (an invalid path), not a test to relax - debug `buildOrderPath`.
- If the perf guard (Task 3 Step 6) exceeds 1500ms, the live `tries=16` build-order is too expensive on some state - capture which state it logs and report before lowering tries; do not raise `MAX_MS`.
