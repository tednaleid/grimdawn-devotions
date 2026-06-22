# Reachability Engine Extension + Cover-Table Blob Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the reachability core to score raw star selections (with honest partial picks) and ship the cover table as a precomputed, cache-coherent build artifact, so the app can later drive selection from it.

**Architecture:** Pure functions in `web/src/core/reachability.ts` gain a selection-aware layer built on a shared `ReachState` summary; the existing whole-constellation functions delegate to the same core so their tests keep proving no behavior change. A build-time script serializes the cover table to `data/cover-table.bin` (gitignored, rebuilt by CI from committed data), tagged with a content-hash `buildId` for cache busting.

**Tech Stack:** TypeScript, bun (test + build), justfile task runner, GitHub Actions Pages deploy. No new dependencies.

**Scope:** This is the first of two plans. It produces a tested engine and a working blob pipeline but does not change app behavior. Plan 2 (selection-rules rewrite, URL repair, renderer/panel/tooltip, `main.ts` wiring, `styles.css`) consumes what this builds.

## Global Constraints

- Hexagonal: `web/src/core/**` stays pure (no DOM, no IO, no fetch). IO lives in `web/src/adapters/**`.
- TDD throughout. Run tests with `cd web && bun test`; the full gate is `just check` (test + biome lint + tsc --noEmit).
- Affinity order is `AFFINITIES = ["ascendant","chaos","eldritch","order","primordial"]`. Per-color hard cap `CAP_MAX = [20,8,20,10,20]`. `BUDGET = 55`. These already exist in `reachability.ts`; reuse them, do not redefine.
- Every new file starts with a 2-line `// ABOUTME: ` header.
- Commit messages use conventional prefixes (`feat(core):`, `test(core):`, `build:`, `feat(adapter):`). Do NOT add any AI co-author trailer.
- Do NOT modify files owned by the other active instance: `data/devotions.json` (read only), `scripts/parse_devotions.py`, `web/src/core/statFormat.ts`, `web/src/styles.css`.
- Match the existing terse, single-line-helper style in `reachability.ts`.

---

## File Structure

- `web/src/core/reachability.ts` (MODIFY): add `ReachState`, `selectionSummary`, the `*From(state)` core (`lowerBoundFrom`, `greedyFrom`, `reachableExactFrom`), `classifyForSelection`, `completionMinCost`, and `reachabilityForSelection`. Refactor the existing `coverLowerBound`/`greedyMinCost`/`reachableExact` to delegate to the `*From` core.
- `web/test/reachability.test.ts` (MODIFY): extend the brute oracle to partial selections; add tests for every new function.
- `web/src/ports/DataSource.ts` (MODIFY): `LoadedData` gains `coverTable: CoverTable | null`.
- `web/src/adapters/coverTableBlob.ts` (CREATE): pure-ish encode/decode of the blob format (`encodeCoverBlob`, `decodeCoverBlob`). Encoding is used by the generator, decoding by the loader.
- `web/scripts/build-cover-table.ts` (CREATE): build-time generator that writes `data/cover-table.bin`.
- `web/test/coverTableBlob.test.ts` (CREATE): round-trip + validation tests.
- `web/src/adapters/httpDataSource.ts` (MODIFY): fetch the blob and `devotions.json` with `?v=<buildId>`, decode, return the `CoverTable`, degrade gracefully.
- `justfile` (MODIFY): `cover-table` recipe; `build`/`serve` depend on it; `build` copies the blob and bakes `__BUILD_ID__`.
- `.gitignore` (MODIFY): ignore `data/cover-table.bin`.
- `.github/workflows/deploy.yml` (MODIFY): generate the blob, bake `__BUILD_ID__`, copy the blob into `dist/data`.

---

## Task 1: `selectionSummary` and the `ReachState` summary

**Files:**
- Modify: `web/src/core/reachability.ts`
- Test: `web/test/reachability.test.ts`

**Interfaces:**
- Consumes: `DevotionModel` (from `./types`), existing private helpers `zero`, `addCap`, `maxV`, `vecOf`, and `Vec`.
- Produces:
  - `export interface ReachState { own: number; supply: Vec; target: Vec; startedIds: Set<string>; partialFinish: { id: string; remaining: number; grant: Vec; req: Vec }[] }`
  - `export function selectionSummary(model: DevotionModel, selected: Set<StarId>): ReachState`

`selected` is a set of star ids (`${conId}:${index}`). `started` = constellations with at least one selected star (each imposes its requirement). `completed` = all stars selected (each supplies its grant). A started-but-incomplete constellation that grants affinity becomes a `partialFinish` entry (it can be finished as cheap scaffolding later).

- [ ] **Step 1: Write the failing test**

Add to `web/test/reachability.test.ts` (it already imports from `../src/core/reachability` and `buildModel`, and has `realModel`/`cons`/`id`):

```ts
import { selectionSummary } from "../src/core/reachability";

test("selectionSummary splits started vs completed and tracks partial finishes", () => {
  const lev = realModel.constellations.get(id("Leviathan"))!;     // grants nothing, requires eldritch+ascendant
  const tree = realModel.constellations.get(id("Tree of Life"))!; // grants nothing
  // Fully select Leviathan, partially select Tree of Life (first star only).
  const sel = new Set<string>([...lev.starIds, tree.starIds[0]!]);
  const s = selectionSummary(realModel, sel);
  expect(s.own).toBe(lev.starIds.length + 1);
  expect(s.startedIds.has(id("Leviathan"))).toBe(true);
  expect(s.startedIds.has(id("Tree of Life"))).toBe(true);
  // supply has NO Tree grant (partial) and no Leviathan grant (grants nothing): all zero here.
  expect(s.supply).toEqual([0, 0, 0, 0, 0]);
  // target covers Leviathan's eldritch 13 + ascendant 13 AND Tree's primordial 20 + order 7.
  expect(s.target).toEqual([13, 0, 13, 7, 20]);
  // Tree grants nothing, so it is NOT a partial-finish candidate.
  expect(s.partialFinish.length).toBe(0);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd web && bun test reachability.test.ts -t "selectionSummary"`
Expected: FAIL (`selectionSummary` is not exported).

- [ ] **Step 3: Implement `selectionSummary`**

Add to `web/src/core/reachability.ts` (after `claimSummary`):

```ts
/** A normalized start point for the minCost bracket, derived from a raw star selection. */
export interface ReachState {
  own: number;        // total selected stars (all count against budget)
  supply: Vec;        // affinity from COMPLETED constellations only
  target: Vec;        // elementwise-max requirement over STARTED constellations
  startedIds: Set<string>;
  partialFinish: { id: string; remaining: number; grant: Vec; req: Vec }[];
}

/** Reduce a raw star selection to the data the bracket needs (honest partials). */
export function selectionSummary(model: DevotionModel, selected: Set<StarId>): ReachState {
  const selByCon = new Map<string, number>();
  let own = 0;
  for (const sid of selected) {
    const star = model.stars.get(sid);
    if (!star) continue;
    own++;
    selByCon.set(star.constellationId, (selByCon.get(star.constellationId) ?? 0) + 1);
  }
  let supply = zero(), target = zero();
  const startedIds = new Set<string>();
  const partialFinish: ReachState["partialFinish"] = [];
  for (const [conId, count] of selByCon) {
    const c = model.constellations.get(conId);
    if (!c) continue;
    startedIds.add(conId);
    const req = vecOf(c.affinityRequired);
    target = maxV(target, req);
    const grant = vecOf(c.affinityBonus);
    if (count >= c.starIds.length) supply = addCap(supply, grant);
    else if (grant[0] || grant[1] || grant[2] || grant[3] || grant[4]) partialFinish.push({ id: conId, remaining: c.starIds.length - count, grant, req });
  }
  return { own, supply, target, startedIds, partialFinish };
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `cd web && bun test reachability.test.ts -t "selectionSummary"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/reachability.ts web/test/reachability.test.ts
git commit -m "feat(core): selectionSummary derives reach state from a raw star selection"
```

---

## Task 2: The shared `*From(state)` bracket, with partial-finish soundness

> **CORRECTION (2026-06-21, post-review):** The code below is UNSOUND as written and
> must not be transcribed verbatim. A review caught that it drops the
> `constructible` check the proven engine relies on, going "order-free" where the
> real model is constructibility-aware (a build must be orderable from the
> Crossroads seed, not merely cover its requirements). The corrected design:
> (1) `ReachState` gains `built: ReachCon[]` (completed as `{size: full, req, grant}`,
> partials as `{size: selectedCount, req, grant: [0,0,0,0,0]}`); (2) `greedyFrom`
> auto-places `built` in seed-unlock order exactly as the committed `greedyMinCost`
> auto-places claimed; (3) `reachableExactFrom` restores
> `covers(...) && constructible([...st.built, ...chosen])` at its base case;
> (4) `lowerBoundFrom` guards the INF sentinel (`cov >= INF` before adding `own`);
> (5) the prune stays admissible (skip the cover-table prune when `partialFinish`
> is non-empty); (6) the new `bruteSelection` oracle MUST check `covers` AND
> `constructible` (partials as grant-0), matching the existing `isValidBuild`.
> With `built` carried, `coverLowerBound`/`greedyMinCost`/`reachableExact` still
> delegate cleanly. This section will be rewritten to match once the implementation
> is green.

**Files:**
- Modify: `web/src/core/reachability.ts`
- Test: `web/test/reachability.test.ts`

**Interfaces:**
- Consumes: `ReachState` (Task 1); existing helpers `covers`, `addCap`, `maxV`, `coverCostAt`, `SEED`, `INF`, `BUDGET`, `CoverTable`, `ReachCon`.
- Produces:
  - `export function lowerBoundFrom(table: CoverTable, st: ReachState): number`
  - `export function greedyFrom(cons: ReachCon[], st: ReachState, budget?: number): number`
  - `export function reachableExactFrom(cons: ReachCon[], table: CoverTable, st: ReachState, budget?: number): boolean`
  - `export function classifyForSelection(model: DevotionModel, cons: ReachCon[], table: CoverTable, selected: Set<StarId>, budget?: number): Reach`
- The existing `coverLowerBound`, `greedyMinCost`, `reachableExact` are refactored to delegate here. Their existing tests MUST stay green (that is the proof the refactor changed no behavior).

The lower bound credits partial finishes (a started granting constellation can be completed at its remaining-star cost, which is cheaper than a fresh filler), or it could falsely dim. The greedy and resolver get those finishes as extra filler entries.

- [ ] **Step 1: Write the failing tests**

Extend the brute oracle in `web/test/reachability.test.ts` to selections, then assert the bracket never lies. Add:

```ts
import { selectionSummary, lowerBoundFrom, greedyFrom, reachableExactFrom, classifyForSelection, type ReachState } from "../src/core/reachability";

// Brute min-cost for a raw selection: complete any subset of the not-yet-completed
// GRANTING constellations (the only useful additions), keep partials' sunk stars,
// and check the order-free validity rule (supply covers every started req).
function bruteSelection(model: any, cons: ReachCon[], selected: Set<string>, budget: number): number {
  const byId = new Map(cons.map((c) => [c.id, c]));
  const selByCon = new Map<string, number>();
  for (const sid of selected) { const cid = sid.split(":")[0]!; selByCon.set(cid, (selByCon.get(cid) ?? 0) + 1); }
  const own0 = selected.size;
  const started = new Set(selByCon.keys());
  let baseTarget = zero(), baseSupply = zero();
  for (const [cid, n] of selByCon) { const c = byId.get(cid)!; baseTarget = maxV(baseTarget, c.req); if (n >= c.size) baseSupply = addCap(baseSupply, c.grant); }
  // pool = granting constellations not fully completed (unstarted, or started-partial)
  const pool = cons.filter((c) => c.grant.some((x) => x > 0) && (selByCon.get(c.id) ?? 0) < c.size);
  let best = INF;
  for (let m = 0; m < 1 << pool.length; m++) {
    let cost = own0, supply = baseSupply.slice() as Vec, target = baseTarget.slice() as Vec;
    const done = new Set(started);
    for (let i = 0; i < pool.length; i++) if (m & (1 << i)) { const c = pool[i]!; cost += c.size - (selByCon.get(c.id) ?? 0); supply = addCap(supply, c.grant); target = maxV(target, c.req); done.add(c.id); }
    if (cost >= best || cost > budget) continue;
    if (covers(supply, target)) best = Math.min(best, cost);
  }
  return best;
}

// Random model + a random partial-or-complete selection over its multi-star constellations.
function randSelectionCase(seed: number) {
  const rng = mulberry32(seed);
  const model = randModel(rng, 6 + Math.floor(rng() * 4));   // includes 5 crossroads
  const realCons = model.filter((c) => !c.id.startsWith("x"));
  const selected = new Set<string>();
  for (const c of realCons) {
    if (rng() < 0.5) continue;
    const take = 1 + Math.floor(rng() * c.size);              // 1..size stars (partial or full)
    for (let k = 0; k < take; k++) selected.add(`${c.id}:${k}`);
  }
  return { model, selected, budget: 8 + Math.floor(rng() * 12) };
}

// selectionSummary needs a DevotionModel; build a minimal stand-in from ReachCon[].
function modelFromCons(cons: ReachCon[]): any {
  const constellations = new Map<string, any>();
  const stars = new Map<string, any>();
  for (const c of cons) {
    const starIds = Array.from({ length: c.size }, (_, k) => `${c.id}:${k}`);
    constellations.set(c.id, { id: c.id, name: c.id, starIds, affinityRequired: affMap(c.req), affinityBonus: affMap(c.grant) });
    for (const sid of starIds) stars.set(sid, { id: sid, constellationId: c.id });
  }
  return { constellations, stars };
}
const AFF = ["ascendant", "chaos", "eldritch", "order", "primordial"] as const;
function affMap(v: Vec): Record<string, number> { const o: Record<string, number> = {}; for (let i = 0; i < 5; i++) if (v[i]) o[AFF[i]!] = v[i]!; return o; }

test("classifyForSelection never lies vs the brute oracle on 400 random partial selections", () => {
  let falseDim = 0, falseReach = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const { model, selected, budget } = randSelectionCase(seed);
    const table = buildCoverTable(model);
    const dm = modelFromCons(model);
    const v = classifyForSelection(dm, model, table, selected, budget);
    const truthReachable = bruteSelection(model, model, selected, budget) <= budget;
    if (v === "dim" && truthReachable) falseDim++;
    if (v === "reachable" && !truthReachable) falseReach++;
  }
  expect(falseDim).toBe(0);
  expect(falseReach).toBe(0);
});

test("lowerBoundFrom credits a partial finish (no false dim when finishing is the cheap path)", () => {
  // Two granting cons: A is partially picked and is the cheapest eldritch source.
  const cons: ReachCon[] = [
    { id: "x0", size: 1, req: [0,0,0,0,0], grant: [1,0,0,0,0] },
    { id: "A", size: 3, req: [0,0,0,0,0], grant: [0,0,6,0,0] },   // finishing adds eldritch 6
    { id: "B", size: 1, req: [0,0,6,0,0], grant: [0,0,0,0,0] },   // needs eldritch 6
  ];
  const table = buildCoverTable(cons);
  const dm = modelFromCons(cons);
  const selected = new Set<string>(["A:0", "A:1", "B:0"]);        // A partial (2/3), B started
  const s = selectionSummary(dm, selected);
  // Finishing A costs 1 more star and supplies eldritch 6, covering B. own=3, +1 = 4.
  expect(lowerBoundFrom(table, s)).toBeLessThanOrEqual(4);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd web && bun test reachability.test.ts -t "classifyForSelection"`
Expected: FAIL (functions not exported).

- [ ] **Step 3: Implement the `*From` core and refactor the existing functions to delegate**

In `web/src/core/reachability.ts`, add the helpers and refactor. First a small deficit helper and `stateFromClaimed`:

```ts
const deficitOf = (target: Vec, have: Vec): Vec => [Math.max(0, target[0] - have[0]), Math.max(0, target[1] - have[1]), Math.max(0, target[2] - have[2]), Math.max(0, target[3] - have[3]), Math.max(0, target[4] - have[4])];

/** A ReachState equivalent to "these constellations are all completed" (no partials). */
function stateFromClaimed(claimed: ReachCon[]): ReachState {
  const { req, grant, own } = claimSummary(claimed);
  return { own, supply: grant, target: req, startedIds: new Set(claimed.map((c) => c.id)), partialFinish: [] };
}

/** Lower bound on minCost from a ReachState. Sound for "dim". Credits partial finishes. */
export function lowerBoundFrom(table: CoverTable, st: ReachState): number {
  let best = st.own + coverCostAt(table, deficitOf(st.target, st.supply));
  const pf = st.partialFinish;
  for (let mask = 1; mask < 1 << pf.length; mask++) {
    let addCost = 0, sup = st.supply;
    for (let i = 0; i < pf.length; i++) if (mask & (1 << i)) { addCost += pf[i]!.remaining; sup = addCap(sup, pf[i]!.grant); }
    const c = st.own + addCost + coverCostAt(table, deficitOf(st.target, sup));
    if (c < best) best = c;
  }
  return best;
}

/** Filler universe for a state: granting constellations not already started, plus partial finishes. */
function fillerFor(cons: ReachCon[], st: ReachState): ReachCon[] {
  const out: ReachCon[] = [];
  for (const c of cons) if (!st.startedIds.has(c.id) && (c.grant[0] || c.grant[1] || c.grant[2] || c.grant[3] || c.grant[4])) out.push(c);
  for (const p of st.partialFinish) out.push({ id: `finish:${p.id}`, size: p.remaining, req: p.req, grant: p.grant });
  return out;
}

/** Refund-aware greedy from a ReachState. Sound for "reachable" (upper bound). */
export function greedyFrom(cons: ReachCon[], st: ReachState, budget = BUDGET): number {
  const filler = fillerFor(cons, st);
  const placed = new Array(filler.length).fill(false);
  let build = st.supply, maxReqPlaced = st.target, cost = st.own;
  for (;;) {
    if (covers(build, maxReqPlaced)) return cost <= budget ? cost : INF;
    const gain = addCap(SEED, build);
    const deficit = deficitOf(maxReqPlaced, build);
    let best = -1, bestScore = 0;
    for (let i = 0; i < filler.length; i++) {
      if (placed[i] || !covers(gain, filler[i]!.req)) continue;
      let red = 0; for (let j = 0; j < 5; j++) red += Math.min(filler[i]!.grant[j]!, deficit[j]!);
      const score = red / filler[i]!.size;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0 || bestScore === 0) return INF;
    placed[best] = true; cost += filler[best]!.size; build = addCap(build, filler[best]!.grant); maxReqPlaced = maxV(maxReqPlaced, filler[best]!.req);
    if (cost > budget) return INF;
  }
}

/** Exact reachability from a ReachState (settles the bracket gap). */
export function reachableExactFrom(cons: ReachCon[], table: CoverTable, st: ReachState, budget = BUDGET): boolean {
  const filler = fillerFor(cons, st).sort((a, b) => (b.grant[0]+b.grant[1]+b.grant[2]+b.grant[3]+b.grant[4]) / b.size - (a.grant[0]+a.grant[1]+a.grant[2]+a.grant[3]+a.grant[4]) / a.size);
  let found = false;
  function rec(i: number, build: Vec, cost: number, maxReqPlaced: Vec): void {
    if (found) return;
    if (covers(build, maxReqPlaced)) { found = true; return; }
    if (i >= filler.length) return;
    if (cost + coverCostAt(table, deficitOf(maxReqPlaced, build)) > budget) return;
    const c = filler[i]!;
    if (cost + c.size <= budget) { rec(i + 1, addCap(build, c.grant), cost + c.size, maxV(maxReqPlaced, c.req)); }
    if (!found) rec(i + 1, build, cost, maxReqPlaced);
  }
  rec(0, st.supply, st.own, st.target);
  return found;
}

/** Classify a raw star selection: dim / reachable, settling the gap with the resolver. */
export function classifyForSelection(model: DevotionModel, cons: ReachCon[], table: CoverTable, selected: Set<StarId>, budget = BUDGET): Reach {
  const st = selectionSummary(model, selected);
  if (lowerBoundFrom(table, st) > budget) return "dim";
  if (greedyFrom(cons, st, budget) <= budget) return "reachable";
  return reachableExactFrom(cons, table, st, budget) ? "reachable" : "dim";
}
```

Note on the resolver: starting `maxReqPlaced` at `st.target` means every started constellation's requirement is honored, and constructibility is implied by the order-free crossroads-refund rule (covered by Task 2's oracle, which uses the same rule). Now refactor the three existing functions to delegate (keep their exported signatures):

```ts
export function coverLowerBound(table: CoverTable, claimed: ReachCon[]): number {
  return lowerBoundFrom(table, stateFromClaimed(claimed));
}
```

For `greedyMinCost(cons, claimedIds, budget)` and `reachableExact(cons, table, claimedIds, budget)`, build the claimed `ReachCon[]` from ids and delegate:

```ts
export function greedyMinCost(cons: ReachCon[], claimedIds: string[], budget = BUDGET): number {
  const byId = new Map(cons.map((c) => [c.id, c]));
  return greedyFrom(cons, stateFromClaimed(claimedIds.map((id) => byId.get(id)!)), budget);
}
export function reachableExact(cons: ReachCon[], table: CoverTable, claimedIds: string[], budget = BUDGET): boolean {
  const byId = new Map(cons.map((c) => [c.id, c]));
  return reachableExactFrom(cons, table, stateFromClaimed(claimedIds.map((id) => byId.get(id)!)), budget);
}
```

- [ ] **Step 4: Run the full reachability suite**

Run: `cd web && bun test reachability.test.ts`
Expected: PASS, including the pre-existing whole-constellation tests (proving the delegation changed no behavior) and the new selection tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/reachability.ts web/test/reachability.test.ts
git commit -m "feat(core): selection-aware minCost bracket with partial-finish soundness"
```

---

## Task 3: `completionMinCost` (the tooltip's "needs N" number)

**Files:**
- Modify: `web/src/core/reachability.ts`
- Test: `web/test/reachability.test.ts`

**Interfaces:**
- Consumes: `classifyForSelection` and friends (Task 2).
- Produces: `export function completionMinCost(model: DevotionModel, cons: ReachCon[], table: CoverTable, selected: Set<StarId>, conId: string, maxBudget?: number): number` — the minimum total stars to complete `conId` on top of the current selection, or `INF` if not completable within `maxBudget`.

- [ ] **Step 1: Write the failing test**

```ts
import { completionMinCost } from "../src/core/reachability";

test("completionMinCost reports Leviathan 26 and Tree of Life 27 from an empty selection", () => {
  expect(completionMinCost(realModel, cons, cover, new Set(), id("Leviathan"))).toBe(26);
  expect(completionMinCost(realModel, cons, cover, new Set(), id("Tree of Life"))).toBe(27);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd web && bun test reachability.test.ts -t "completionMinCost"`
Expected: FAIL (not exported).

- [ ] **Step 3: Implement via budget binary search over the definitive decision**

```ts
/** Minimum total stars to COMPLETE conId on top of `selected`, or INF if not within maxBudget. */
export function completionMinCost(model: DevotionModel, cons: ReachCon[], table: CoverTable, selected: Set<StarId>, conId: string, maxBudget = BUDGET): number {
  const con = model.constellations.get(conId);
  if (!con) return INF;
  const withCon = new Set(selected);
  for (const sid of con.starIds) withCon.add(sid);
  const st = selectionSummary(model, withCon);
  let lo = st.own;                                            // cannot cost less than the stars already required
  if (lo > maxBudget) return INF;
  if (reachableExactFrom(cons, table, st, maxBudget) === false) return INF;
  let hi = maxBudget;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (reachableExactFrom(cons, table, st, mid)) hi = mid; else lo = mid + 1;
  }
  return lo;
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `cd web && bun test reachability.test.ts -t "completionMinCost"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/reachability.ts web/test/reachability.test.ts
git commit -m "feat(core): completionMinCost for the dimmed-constellation tooltip"
```

---

## Task 4: `reachabilityForSelection` (the per-refresh API)

**Files:**
- Modify: `web/src/core/reachability.ts`
- Test: `web/test/reachability.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `export interface ReachView { completable: Set<string>; clickable: Set<StarId>; have: Vec; need: Vec; needSource: Map<number, string[]> }`
  - `export function reachabilityForSelection(model: DevotionModel, cons: ReachCon[], table: CoverTable, selected: Set<StarId>, budget?: number): ReachView`

`completable` = constellations whose full completion keeps minCost within budget (the faded-art layer). `clickable` = not-yet-selected stars whose predecessors are all selected and whose placement keeps the selection reachable (the per-star gate; this is what Plan 2's `toggleStar` will consult). `have`/`need` are the panel vectors (`need[i]` is the started-set max requirement for affinity `i`); `needSource` maps an affinity index to the started constellation ids that define that max.

- [ ] **Step 1: Write the failing tests (the Crook/Anvil case and the budget floor)**

```ts
import { reachabilityForSelection } from "../src/core/reachability";

test("reachabilityForSelection: a startable-but-not-completable constellation keeps a clickable first star", () => {
  // Synthetic Crook/Anvil at budget 6: Crook (5 stars, grants ascendant 5) is complete; Anvil (4 stars, needs ascendant 1).
  const model: any = modelFromCons([
    { id: "x0", size: 1, req: [0,0,0,0,0], grant: [1,0,0,0,0] },
    { id: "Crook", size: 5, req: [0,0,0,0,0], grant: [5,0,0,0,0] },
    { id: "Anvil", size: 4, req: [1,0,0,0,0], grant: [0,0,0,2,0] },
  ]);
  const mc = buildReachCons(model);
  const table = buildCoverTable(mc);
  const selected = new Set<string>(["Crook:0","Crook:1","Crook:2","Crook:3","Crook:4"]);
  const view = reachabilityForSelection(model, mc, table, selected, 6);
  expect(view.completable.has("Anvil")).toBe(false);   // 5 + 4 = 9 > 6
  expect(view.clickable.has("Anvil:0")).toBe(true);    // first star fits (cost 6, deficit 0)
  expect(view.clickable.has("Anvil:1")).toBe(false);   // predecessor (Anvil:0) not yet selected
  expect(view.have[0]).toBe(5);                          // ascendant supply from completed Crook
});

test("reachabilityForSelection: empty map dims nothing at 55 and dims Leviathan below its floor", () => {
  const full = reachabilityForSelection(realModel, cons, cover, new Set(), 55);
  expect(full.completable.size).toBe(realModel.constellations.size);
  const tight = reachabilityForSelection(realModel, cons, cover, new Set(), 19);
  expect(tight.completable.has(id("Leviathan"))).toBe(false);
  // Leviathan's first star needs minCost 20, so below 20 even its first star is not clickable.
  expect(tight.clickable.has(`${id("Leviathan")}:0`)).toBe(false);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd web && bun test reachability.test.ts -t "reachabilityForSelection"`
Expected: FAIL (not exported).

- [ ] **Step 3: Implement the sweep**

```ts
export interface ReachView { completable: Set<string>; clickable: Set<StarId>; have: Vec; need: Vec; needSource: Map<number, string[]> }

/** One full sweep for a selection: what can be completed, what stars can be clicked, and the panel vectors. */
export function reachabilityForSelection(model: DevotionModel, cons: ReachCon[], table: CoverTable, selected: Set<StarId>, budget = BUDGET): ReachView {
  const st = selectionSummary(model, selected);
  const completable = new Set<string>();
  const clickable = new Set<StarId>();
  // completable: completing the whole constellation stays within budget (already-complete ones are trivially "completable").
  for (const c of model.constellations.values()) {
    const withCon = new Set(selected);
    for (const sid of c.starIds) withCon.add(sid);
    if (classifyForSelection(model, cons, table, withCon, budget) === "reachable") completable.add(c.id);
  }
  // clickable: each not-selected star whose predecessors are all selected, if placing it keeps the selection reachable.
  for (const star of model.stars.values()) {
    if (selected.has(star.id)) continue;
    if (!star.predecessors.every((p) => selected.has(p))) continue;
    const withStar = new Set(selected); withStar.add(star.id);
    if (classifyForSelection(model, cons, table, withStar, budget) === "reachable") clickable.add(star.id);
  }
  // panel: have = supply, need = target, needSource = started cons defining each color's max.
  const needSource = new Map<number, string[]>();
  for (let i = 0; i < 5; i++) {
    if (st.target[i] === 0) continue;
    const src: string[] = [];
    for (const conId of st.startedIds) { const c = model.constellations.get(conId)!; if ((vecOf(c.affinityRequired)[i] ?? 0) === st.target[i]) src.push(conId); }
    needSource.set(i, src);
  }
  return { completable, clickable, have: st.supply, need: st.target, needSource };
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `cd web && bun test reachability.test.ts -t "reachabilityForSelection"`
Expected: PASS.

- [ ] **Step 5: Run the full gate**

Run: `just check`
Expected: all tests pass, lint clean, types clean. Fix any biome/tsc findings before committing.

- [ ] **Step 6: Commit**

```bash
git add web/src/core/reachability.ts web/test/reachability.test.ts
git commit -m "feat(core): reachabilityForSelection sweep (completable, clickable, panel vectors)"
```

---

## Task 5: Cover-table blob encode/decode + generator

**Files:**
- Create: `web/src/adapters/coverTableBlob.ts`
- Create: `web/scripts/build-cover-table.ts`
- Create: `web/test/coverTableBlob.test.ts`

**Interfaces:**
- Produces:
  - `export function encodeCoverBlob(table: CoverTable, buildId: string): Uint8Array`
  - `export function decodeCoverBlob(bytes: Uint8Array, cons: ReachCon[]): { table: CoverTable; buildId: string }` (derives `caps`/`strides` from `cons` the way `buildCoverTable` does, validates the body length, throws on mismatch).
  - `export function computeBuildId(devotionsJsonText: string): string` (16-hex-char content hash).

Blob layout: bytes `0..3` = magic `"GDCT"`; byte `4` = version `1`; bytes `5..20` = 16-byte ASCII `buildId`; bytes `21..` = the `Uint16Array` cost grid in little-endian. `caps`/`strides` are NOT stored; the loader recomputes them from the model (they are a deterministic function of it), so the blob is almost pure payload.

- [ ] **Step 1: Write the failing round-trip test**

`web/test/coverTableBlob.test.ts`:

```ts
// ABOUTME: Round-trips the cover-table blob (encode then decode reconstructs the same table)
// ABOUTME: and checks buildId stamping plus body-length validation.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { buildReachCons, buildCoverTable } from "../src/core/reachability";
import { encodeCoverBlob, decodeCoverBlob, computeBuildId } from "../src/adapters/coverTableBlob";

const cons = buildReachCons(buildModel(doc as any));
const table = buildCoverTable(cons);

test("encode then decode reconstructs the identical cover table and buildId", () => {
  const bytes = encodeCoverBlob(table, "abcdef0123456789");
  const { table: back, buildId } = decodeCoverBlob(bytes, cons);
  expect(buildId).toBe("abcdef0123456789");
  expect(back.caps).toEqual(table.caps);
  expect(back.strides).toEqual(table.strides);
  expect(back.cost.length).toBe(table.cost.length);
  expect(back.cost[0]).toBe(table.cost[0]);
  expect(back.cost[12345]).toBe(table.cost[12345]);
});

test("decode rejects a truncated body", () => {
  const bytes = encodeCoverBlob(table, "abcdef0123456789").slice(0, 100);
  expect(() => decodeCoverBlob(bytes, cons)).toThrow();
});

test("computeBuildId is stable and 16 hex chars", () => {
  const a = computeBuildId('{"x":1}');
  expect(a).toMatch(/^[0-9a-f]{16}$/);
  expect(computeBuildId('{"x":1}')).toBe(a);
  expect(computeBuildId('{"x":2}')).not.toBe(a);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd web && bun test coverTableBlob.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `coverTableBlob.ts`**

```ts
// ABOUTME: Encode/decode the precomputed cover-table blob (magic + version + buildId + Uint16 grid).
// ABOUTME: caps/strides are recomputed from the model on decode, so the blob is almost pure payload.
import { createHash } from "node:crypto";
import { coverDims, type CoverTable, type ReachCon } from "../core/reachability";

const MAGIC = "GDCT";
const VERSION = 1;
const HEADER = 4 + 1 + 16; // magic + version + 16-byte buildId

export function computeBuildId(devotionsJsonText: string): string {
  return createHash("sha256").update(devotionsJsonText).digest("hex").slice(0, 16);
}

export function encodeCoverBlob(table: CoverTable, buildId: string): Uint8Array {
  if (buildId.length !== 16) throw new Error(`buildId must be 16 chars, got ${buildId.length}`);
  const body = new Uint8Array(table.cost.buffer, table.cost.byteOffset, table.cost.byteLength);
  const out = new Uint8Array(HEADER + body.byteLength);
  out.set([...MAGIC].map((c) => c.charCodeAt(0)), 0);
  out[4] = VERSION;
  out.set([...buildId].map((c) => c.charCodeAt(0)), 5);
  out.set(body, HEADER);
  return out;
}

export function decodeCoverBlob(bytes: Uint8Array, cons: ReachCon[]): { table: CoverTable; buildId: string } {
  if (String.fromCharCode(...bytes.slice(0, 4)) !== MAGIC) throw new Error("cover blob: bad magic");
  if (bytes[4] !== VERSION) throw new Error(`cover blob: unsupported version ${bytes[4]}`);
  const buildId = String.fromCharCode(...bytes.slice(5, 21));
  const dims = coverDims(cons);                                   // caps/strides depend only on the model's reqs
  const expected = dims.caps.reduce((a, c) => a * (c + 1), 1);
  const body = bytes.slice(HEADER);
  if (body.byteLength !== expected * 2) throw new Error(`cover blob: body ${body.byteLength} bytes, expected ${expected * 2}`);
  const cost = new Uint16Array(body.buffer, body.byteOffset, expected).slice();
  return { table: { cost, caps: dims.caps, strides: dims.strides }, buildId };
}
```

`decodeCoverBlob` needs `coverDims`, so add it to `reachability.ts` first (extracted from the opening lines of `buildCoverTable`, which should then call it to avoid duplication):

```ts
/** The cover grid dimensions (caps + strides) for a model, without building the cost table. */
export function coverDims(cons: ReachCon[]): { caps: Vec; strides: Vec } {
  const caps: Vec = zero();
  for (const c of cons) for (let i = 0; i < 5; i++) caps[i] = Math.max(caps[i]!, c.req[i]!);
  for (let i = 0; i < 5; i++) caps[i] = Math.min(caps[i]!, CAP_MAX[i]!);
  const sizes = caps.map((c) => c + 1);
  const strides = sizes.map((_, i) => sizes.slice(i + 1).reduce((a, b) => a * b, 1)) as Vec;
  return { caps, strides };
}
```

The blob stores raw `Uint16` in platform endianness; every deploy target (browsers on x86/ARM, CI on x64) is little-endian, so encode and decode agree.

- [ ] **Step 4: Implement the generator `web/scripts/build-cover-table.ts`**

```ts
// ABOUTME: Build-time generator: serialize the cover table to data/cover-table.bin with a buildId.
// ABOUTME: Run by `just cover-table`; the blob is gitignored and rebuilt from committed devotions.json.
import { buildModel } from "../src/core/model";
import { buildReachCons, buildCoverTable } from "../src/core/reachability";
import { encodeCoverBlob, computeBuildId } from "../src/adapters/coverTableBlob";

const root = new URL("../../", import.meta.url);                 // repo root from web/scripts/
const jsonText = await Bun.file(new URL("data/devotions.json", root)).text();
const buildId = computeBuildId(jsonText);
const cons = buildReachCons(buildModel(JSON.parse(jsonText)));
const blob = encodeCoverBlob(buildCoverTable(cons), buildId);
await Bun.write(new URL("data/cover-table.bin", root), blob);
console.log(`wrote data/cover-table.bin (${blob.byteLength} bytes, buildId ${buildId})`);
```

- [ ] **Step 5: Run the blob tests and the generator**

Run: `cd web && bun test coverTableBlob.test.ts`
Expected: PASS.
Run: `cd web && bun scripts/build-cover-table.ts`
Expected: prints the byte count and a 16-char buildId; `data/cover-table.bin` now exists.

- [ ] **Step 6: Commit**

```bash
git add web/src/adapters/coverTableBlob.ts web/scripts/build-cover-table.ts web/test/coverTableBlob.test.ts web/src/core/reachability.ts
git commit -m "feat(build): cover-table blob encode/decode and generator"
```

---

## Task 6: justfile recipe, gitignore, and CI wiring

**Files:**
- Modify: `justfile`
- Modify: `.gitignore`
- Modify: `.github/workflows/deploy.yml`

**Interfaces:** none (build infra). `__BUILD_ID__` is the bundler-injected global the loader reads in Task 7.

- [ ] **Step 1: Ignore the blob**

Append to `.gitignore` (under the "Web app" group):

```
# Precomputed cover table (build artifact, regenerated from data/devotions.json)
/data/cover-table.bin
```

- [ ] **Step 2: Add the `cover-table` recipe and wire `build`/`serve`**

In `justfile`, add a recipe (place it after `web-install`):

```just
# Generate the precomputed cover table from data/devotions.json (only if stale)
cover-table:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ ! -f "{{justfile_directory()}}/data/cover-table.bin" ] || [ "{{justfile_directory()}}/data/devotions.json" -nt "{{justfile_directory()}}/data/cover-table.bin" ]; then
        cd "{{justfile_directory()}}/web" && bun scripts/build-cover-table.ts
    else
        echo "cover-table.bin is up to date"
    fi
```

Then make `build` depend on it and copy the blob + bake the buildId. Change the `build:` recipe body: add `cover-table` as a dependency in the recipe signature (`build: cover-table`), add a line to compute the id and pass `--define`, and copy the blob:

```just
build: cover-table
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{justfile_directory()}}/web"
    mkdir -p dist
    rm -rf dist/* dist/.[!.]* 2>/dev/null || true
    mkdir -p dist/data
    BUILD_ID=$(bun -e 'import {computeBuildId} from "./src/adapters/coverTableBlob"; console.log(computeBuildId(await Bun.file("../data/devotions.json").text()))')
    bun build src/app/main.ts --outdir dist --target browser --define __BUILD_ID__="\"$BUILD_ID\""
    cp index.html dist/index.html
    cp src/styles.css dist/styles.css
    cp "{{justfile_directory()}}/data/devotions.json" dist/data/devotions.json
    cp "{{justfile_directory()}}/data/cover-table.bin" dist/data/cover-table.bin
    if [ -d "{{justfile_directory()}}/assets" ]; then cp -r "{{justfile_directory()}}/assets" dist/assets; fi
    echo "Built web/dist (buildId $BUILD_ID)"
```

(`serve` already depends on `build`, so it inherits the blob.)

- [ ] **Step 3: Mirror it in CI**

In `.github/workflows/deploy.yml`, replace the inlined build block so it generates the blob and bakes the id (or, simpler and DRY, call `just build`). Minimal direct edit to the `run:` step:

```yaml
      - name: Build static site
        working-directory: web
        run: |
          bun install
          bun scripts/build-cover-table.ts
          BUILD_ID=$(bun -e 'import {computeBuildId} from "./src/adapters/coverTableBlob"; console.log(computeBuildId(await Bun.file("../data/devotions.json").text()))')
          bun build src/app/main.ts --outdir dist --target browser --define __BUILD_ID__="\"$BUILD_ID\""
          cp index.html dist/index.html
          cp src/styles.css dist/styles.css
          mkdir -p dist/data
          cp ../data/devotions.json dist/data/
          cp ../data/cover-table.bin dist/data/
          if [ -d ../assets ]; then cp -r ../assets dist/assets; fi
```

- [ ] **Step 4: Verify the build end to end**

Run: `just build`
Expected: prints `Built web/dist (buildId <16 hex>)`; `web/dist/data/cover-table.bin` and `web/dist/main.js` exist. Confirm the id is baked: `grep -c "$(bun -e 'import {computeBuildId} from "./web/src/adapters/coverTableBlob"; console.log(computeBuildId(await Bun.file("data/devotions.json").text()))')" web/dist/main.js` should print at least `1`.

- [ ] **Step 5: Commit**

```bash
git add justfile .gitignore .github/workflows/deploy.yml
git commit -m "build: generate + ship the cover-table blob with a cache-busting buildId"
```

---

## Task 7: Loader fetches and decodes the blob

**Files:**
- Modify: `web/src/ports/DataSource.ts`
- Modify: `web/src/adapters/httpDataSource.ts`
- Test: `web/test/coverTableBlob.test.ts` (add loader-path coverage that does not need the network)

**Interfaces:**
- Consumes: `decodeCoverBlob` (Task 5), `__BUILD_ID__` (Task 6), `buildReachCons` (to give `decodeCoverBlob` the model's `cons`).
- Produces: `LoadedData` gains `coverTable: CoverTable | null`. `httpDataSource` fetches `./data/devotions.json?v=<id>` and `./data/cover-table.bin?v=<id>`, decodes the blob, returns the table or `null` on any failure (degrade to dimming-disabled). Declares the injected global: `declare const __BUILD_ID__: string;` with a runtime fallback to `"dev"`.

- [ ] **Step 1: Write the failing test for the degrade path**

Add to `web/test/coverTableBlob.test.ts`:

```ts
import { coverTableFromBytesOrNull } from "../src/adapters/httpDataSource";

test("loader returns null (degrade) on a corrupt blob instead of throwing", () => {
  expect(coverTableFromBytesOrNull(new Uint8Array([1, 2, 3]), cons)).toBeNull();
});
test("loader returns a CoverTable for a valid blob", () => {
  const bytes = encodeCoverBlob(table, "abcdef0123456789");
  const t = coverTableFromBytesOrNull(bytes, cons);
  expect(t?.cost.length).toBe(table.cost.length);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd web && bun test coverTableBlob.test.ts -t "loader"`
Expected: FAIL (`coverTableFromBytesOrNull` not exported).

- [ ] **Step 3: Extend the port**

In `web/src/ports/DataSource.ts`, import the type and extend `LoadedData`:

```ts
import type { CoverTable } from "../core/reachability";
// ...
export interface LoadedData {
  model: DevotionModel;
  manifest: AssetManifest | null;
  coverTable: CoverTable | null;
}
```

- [ ] **Step 4: Implement the loader**

Rewrite `web/src/adapters/httpDataSource.ts`:

```ts
// ABOUTME: HTTP adapter for the DataSource port; fetches devotions.json, the asset manifest, and the cover blob.
// ABOUTME: Uses relative base paths and a shared ?v=<buildId> so the data files stay a coherent, cache-busted pair.
import { buildModel, type DevotionsDoc } from "../core/model";
import { buildReachCons, type CoverTable, type ReachCon } from "../core/reachability";
import { decodeCoverBlob } from "./coverTableBlob";
import type { AssetManifest, DataSource, LoadedData } from "../ports/DataSource";

declare const __BUILD_ID__: string;
const buildId = (typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev");

async function getJson<T>(url: string): Promise<T | null> {
  try { const res = await fetch(url); if (!res.ok) return null; return (await res.json()) as T; } catch { return null; }
}

/** Decode blob bytes into a CoverTable, or null on any malformed/mismatched input (degrade to no dimming). */
export function coverTableFromBytesOrNull(bytes: Uint8Array, cons: ReachCon[]): CoverTable | null {
  try {
    const { table, buildId: blobId } = decodeCoverBlob(bytes, cons);
    if (buildId !== "dev" && blobId !== buildId) { console.warn(`cover blob buildId ${blobId} != bundle ${buildId}; disabling dimming`); return null; }
    return table;
  } catch (e) { console.warn("cover blob decode failed; disabling dimming", e); return null; }
}

export function httpDataSource(base = "."): DataSource {
  return {
    async load(): Promise<LoadedData> {
      const v = `?v=${buildId}`;
      const doc = await getJson<DevotionsDoc>(`${base}/data/devotions.json${v}`);
      if (!doc) throw new Error("failed to load data/devotions.json");
      const manifest = await getJson<AssetManifest>(`${base}/assets/devotions/manifest.json`);
      const model = buildModel(doc);
      let coverTable: CoverTable | null = null;
      try {
        const res = await fetch(`${base}/data/cover-table.bin${v}`);
        if (res.ok) coverTable = coverTableFromBytesOrNull(new Uint8Array(await res.arrayBuffer()), buildReachCons(model));
        else console.warn(`cover blob fetch ${res.status}; disabling dimming`);
      } catch (e) { console.warn("cover blob fetch failed; disabling dimming", e); }
      return { model, manifest, coverTable };
    },
  };
}
```

- [ ] **Step 5: Run the loader tests and the full gate**

Run: `cd web && bun test coverTableBlob.test.ts`
Expected: PASS.
Run: `just check`
Expected: green. If `tsc` flags other `LoadedData` consumers needing `coverTable`, the only consumer is `main.ts`'s `boot()` which destructures `data.model`/`data.manifest`; the added optional-by-usage field does not break it. Fix any type error by leaving `main.ts` untouched here (Plan 2 wires `coverTable`).

- [ ] **Step 6: Commit**

```bash
git add web/src/ports/DataSource.ts web/src/adapters/httpDataSource.ts web/test/coverTableBlob.test.ts
git commit -m "feat(adapter): load and decode the cover-table blob with shared cache-bust"
```

---

## Self-Review

**Spec coverage (Plan 1 portion):**
- Engine selection-aware layer (`selectionSummary`, `classifyForSelection`, partial-finish soundness): Tasks 1-2.
- `completionMinCost` for the tooltip number: Task 3.
- `reachabilityForSelection` (completable, clickable, have/need/needSource): Task 4.
- Blob as build artifact, not committed; generator; rebuild-if-stale; CI generate-and-copy: Tasks 5-6.
- Cache coherence (`buildId` content hash, shared `?v=`, blob-embedded id, degrade on mismatch): Tasks 5-7.
- Deferred to Plan 2 (by design): `rules.ts` rewrite, `urlState.ts` repair, `svgRenderer.ts` two-layer dimming, `sidebarView.ts` two-column panel, `tooltipView.ts` line, `main.ts` wiring, `styles.css`.

**Placeholder scan:** none; every code step carries real code.

**Type consistency:** `ReachState`, `ReachView`, `CoverTable`, `ReachCon`, `Vec` are used consistently. `coverDims` is introduced in Task 5 and reused by `decodeCoverBlob`. `__BUILD_ID__` is injected in Task 6 and read in Task 7. `coverTableFromBytesOrNull` is defined and tested in Task 7. The existing `coverLowerBound`/`greedyMinCost`/`reachableExact` keep their signatures and delegate to the new `*From` core.

**Open verification note:** the brute oracle in Task 2 uses `mulberry32`, `randModel`, `zero`, `maxV`, `addCap`, `covers`, and `id`/`realModel`/`cons`/`cover` which already exist in `reachability.test.ts`; `zero`/`maxV`/`addCap`/`covers` are defined as test-local helpers there. Confirm they are in scope when adding the new tests (they are, at the top of the existing file).
