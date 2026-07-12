# Partial-Constellation Reachability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Light every star (and edge) whose path fits the remaining budget inside constellations that cannot be fully completed, list their bonuses and powers as "available to get," and let one click claim a star plus its unselected predecessors.

**Architecture:** `ReachView` gains a `reachableStars: Set<StarId>` signal computed by a per-constellation binary search over star counts (`maxK`), reusing the existing `classifyForSelection` entry point (the WASM resolver beneath it is untouched). Consumers migrate one at a time (display, rules, commit button, aggregation, tooltip); the old `clickable` frontier signal is then removed. The spec is `docs/superpowers/specs/2026-07-12-partial-constellation-reachability-design.md`.

**Tech Stack:** TypeScript (vanilla, no framework), Bun for build/test, `just` as the task runner. Tests are `bun:test`.

## Global Constraints

- All implementation work happens on a feature branch off `main`. Before Task 1, run
  `git checkout -b partial-constellation-reachability` (or create it via a worktree with the
  superpowers:using-git-worktrees skill). Every task's commit lands on that branch; merging back to
  `main` is a decision for the end of the work (superpowers:finishing-a-development-branch), not part
  of this plan.
- Every new code file starts with two `// ABOUTME: ` comment lines describing the file.
- Documentation prose: no emojis, no em-dashes (use " - "), no hyperbole.
- No user-facing string literals in app code: new strings need a key in `web/src/i18n/app.en.json`, translations in the 12 other `app.<locale>.json` files, and an entry in the `REQUIRED` list of `web/test/appCatalog.test.ts`.
- All planner state must round-trip through the URL hash. This feature adds no new state kind (star selections already round-trip), so do not touch `web/src/core/urlState.ts`.
- Use `just` recipes, not raw tool invocations: `just test [file]`, `just check`, `just perf`, `just fuzz`, `just validate-wasm`, `just test-slow`. All are run from the repo root.
- The pre-commit hook runs `just check` (format check, full test suite, lint, typecheck) and takes about 90 seconds. Do not use `--no-verify`.
- Do not modify `web/wasm/` (the Rust resolver) or `data/` blobs. This feature requires no changes there.
- Match surrounding code style exactly (formatting is enforced by biome).
- Commit messages follow the repo's conventional style (`feat:`, `test:`, `refactor:`, `docs:`, `perf:`) and end with the line: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## Domain background (read before Task 1)

Read these two files first; every task depends on the concepts:

- `docs/devotion-system.md` - the game rules. Key facts: stars cost 1 point each; a constellation's affinity is granted only when ALL its stars are selected; a partial constellation imposes its activation requirement but grants nothing; "reachable" means "extends to a valid build within the point budget."
- `docs/superpowers/specs/2026-07-12-partial-constellation-reachability-design.md` - the approved design this plan implements.

Three engine facts this plan exploits (proofs in the spec):

1. `classifyForSelection` (in `web/src/core/reachability.ts`) already decides arbitrary partial selections exactly, including through the injected WASM resolver.
2. The verdict for "selection + k stars of constellation C" depends only on the count k, not which stars (`selectionSummary` reduces selections to per-constellation counts).
3. That verdict is monotone in k for proper prefixes (bigger prefix = more cost, no more grant), so the largest reachable k (`maxK`) is binary-searchable.

Reference URL-hash states (real user states; used as test fixtures):

```
HASH_51 = "#p=55&s=AAAAAAEHAAAAOAAAOAA8PAA8APgHAAB4AHwAAAAAAAAAAAAAAAAAAAB8AAAAAAAAAAAAAAAAAAAAAAAAAADAHw"
HASH_55 = "#p=55&s=AAAAAAEHAAAAOAAAOAA8PAA8APgHAAB4AHwAAAAAAAAAAAAAAAAAAAB8AAAAAAAAAAAAAAAAAAAAAOACAADAHw"
```

`HASH_51` is a 51-point build with 4 spare points; `korvaak_the_eldritch_sun` (6 stars, power "Eye of Korvaak" on star index 4, predecessors 0-1-2 then 2 branching to 3, 4, 5) and `tortoise` (5 stars, power "Turtle Shell" on star index 4, chain 0-1-2 then 2 branching to 3 and 4) are enterable but not completable: every star's path costs at most 4. `HASH_55` is the same build after spending the 4 points on Korvaak stars {0,1,2,4}.

## File structure

| File | Change |
| --- | --- |
| `web/src/core/reachability.ts` | Add `pathToStar`; add `reachableStars` to `ReachView` + maxK search; later remove `clickable` |
| `web/src/core/displayState.ts` | Star/edge brightness from `reachableStars` |
| `web/src/core/rules.ts` | `toggleStar` path-add; `toggleConstellation` all-in/all-out |
| `web/src/core/commitAction.ts` | Popover Add/Remove mirrors the new rules |
| `web/src/core/aggregate.ts` | `available*` functions iterate `reachableStars` |
| `web/src/app/main.ts` | `permissiveReach`, aggregate call sites, tooltip path cost |
| `web/src/adapters/tooltipView.ts` | Optional `pathCost` line in the star tooltip |
| `web/src/adapters/buildOrderView.ts` | Partial-count marker on complete steps smaller than their constellation |
| `web/src/styles.css` | `.tip-path-cost` and `.bo-partial` rules |
| `web/src/i18n/app.*.json` (13 files) | `ui.tooltip.pointsToReach` and `ui.buildOrder.partial` keys |
| `web/scripts/perf-reachability.ts`, `web/scripts/reachability-fuzz.ts` | Read `reachableStars` instead of `clickable` |
| `web/test/reachability-partial.test.ts` | New: engine tests for the new signal |
| `web/test/*.test.ts` (8 existing files) | Mock/assert updates per task |
| `docs/display-model.md`, `docs/reachability-engine.md` | Living-doc rewrites |

---

### Task 1: `pathToStar` helper

The predecessor-closure walk every later task uses: the star plus its unselected transitive predecessors (the set a click must add, and whose size is the tooltip cost).

**Files:**
- Modify: `web/src/core/reachability.ts` (near `selectionSummary`, around line 160)
- Create: `web/test/reachability-partial.test.ts`

**Interfaces:**
- Consumes: `DevotionModel`, `StarId` from `web/src/core/types.ts`; `model.stars.get(id).predecessors` (global `StarId[]`, always within the same constellation).
- Produces: `export function pathToStar(model: DevotionModel, selected: Set<StarId>, starId: StarId): Set<StarId>` - used by Tasks 2, 4, 7.

- [ ] **Step 1: Write the failing test**

Create `web/test/reachability-partial.test.ts`:

```ts
// ABOUTME: Tests for partial-constellation reachability: pathToStar and the reachableStars signal
// ABOUTME: (deep-star attainability inside constellations that cannot be fully completed).
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { pathToStar } from "../src/core/reachability";

const realModel = buildModel(doc as any);

test("pathToStar walks unselected predecessors within the constellation", () => {
  // korvaak_the_eldritch_sun: chain 0-1-2, then 2 branches to 3, 4, 5. Star 4 is Eye of Korvaak.
  const eye = "korvaak_the_eldritch_sun:4";
  const fromEmpty = pathToStar(realModel, new Set(), eye);
  expect([...fromEmpty].sort()).toEqual([
    "korvaak_the_eldritch_sun:0",
    "korvaak_the_eldritch_sun:1",
    "korvaak_the_eldritch_sun:2",
    "korvaak_the_eldritch_sun:4",
  ]);
  // Already-selected predecessors are excluded: only the unselected remainder is the path.
  const partial = pathToStar(realModel, new Set(["korvaak_the_eldritch_sun:0", "korvaak_the_eldritch_sun:1"]), eye);
  expect([...partial].sort()).toEqual(["korvaak_the_eldritch_sun:2", "korvaak_the_eldritch_sun:4"]);
  // A selected star has an empty path (nothing to add).
  expect(pathToStar(realModel, new Set([eye, "korvaak_the_eldritch_sun:0"]), eye).size).toBe(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `just test test/reachability-partial.test.ts`
Expected: FAIL - `pathToStar` is not exported (`SyntaxError` or "not a function").

- [ ] **Step 3: Implement `pathToStar`**

In `web/src/core/reachability.ts`, after `selectionSummary` (line ~192), add:

```ts
/** The unselected path to a star: the star plus every unselected transitive predecessor. Predecessors
 *  never cross constellations, so the path stays within the star's own constellation. This is the set
 *  a click on the star must add, and its size is the star's point cost from the current selection. */
export function pathToStar(model: DevotionModel, selected: Set<StarId>, starId: StarId): Set<StarId> {
  const path = new Set<StarId>();
  const stack: StarId[] = [starId];
  while (stack.length) {
    const id = stack.pop()!;
    if (path.has(id) || selected.has(id)) continue;
    path.add(id);
    const star = model.stars.get(id);
    if (star) for (const p of star.predecessors) stack.push(p);
  }
  return path;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `just test test/reachability-partial.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/reachability.ts web/test/reachability-partial.test.ts
git commit -m "feat(reach): pathToStar computes a star's unselected predecessor path

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `reachableStars` engine signal

The core change: `ReachView` gains `reachableStars`, computed per constellation - all unselected stars when completable, else via the maxK binary search. `clickable` stays for now but becomes a pure projection of `reachableStars` (its per-frontier-star classify calls are deleted; the verdicts are identical because a frontier star's verdict IS the count `selCount+1` verdict). Every `ReachView` constructor (engine, permissive path, test mocks) gains the field so the repo compiles.

**Files:**
- Modify: `web/src/core/reachability.ts:1001-1063` (`ReachView`, `reachabilityForSelection`)
- Modify: `web/src/app/main.ts:211-235` (`permissiveReach`)
- Modify (mechanical, add `reachableStars` to `ReachView` literals):
  - `web/test/rules-toggle.test.ts:37`
  - `web/test/rules-constellation.test.ts:27`
  - `web/test/commit-action.test.ts:16`
  - `web/test/displayState.test.ts:18`
  - `web/test/svgRenderer.test.ts:87,124,158,231`
  - `web/test/i18nCharacterization.test.ts:~42`
  - `web/test/reachability.test.ts:113` (sweep-equivalence assertions)
- Test: `web/test/reachability-partial.test.ts`

**Interfaces:**
- Consumes: `classifyForSelection`, `selectionSummary`, `pathToStar` (Task 1).
- Produces: `ReachView.reachableStars: Set<StarId>` - every unselected star whose path (star + unselected predecessors) keeps the selection reachable at the sweep budget. Contains ONLY unselected stars. Used by Tasks 3-7.

- [ ] **Step 1: Write the failing tests**

Append to `web/test/reachability-partial.test.ts`:

```ts
import {
  buildReachCons,
  buildCoverTable,
  classifyForSelection,
  selectionSummary,
  reachabilityForSelection,
  type Vec,
} from "../src/core/reachability";
import type { DevotionModel } from "../src/core/types";
import { decodeHash, canonicalStarIds } from "../src/core/urlState";

// Build a synthetic DevotionModel from constellation specs. Each star's predecessors default to a
// chain (star k depends on star k-1); `preds` overrides them (local indices) for branching shapes.
function modelFromCons(
  conSpecs: Array<{ id: string; size: number; req: Vec; grant: Vec; preds?: Record<number, number[]> }>,
): DevotionModel {
  const stars = new Map();
  const constellations = new Map();
  const affinities = ["ascendant", "chaos", "eldritch", "order", "primordial"] as const;
  for (const spec of conSpecs) {
    const starIds: string[] = [];
    for (let k = 0; k < spec.size; k++) {
      const starId = `${spec.id}:${k}`;
      starIds.push(starId);
      const predIdx = spec.preds?.[k] ?? (k === 0 ? [] : [k - 1]);
      stars.set(starId, {
        id: starId,
        constellationId: spec.id,
        index: k,
        predecessors: predIdx.map((i) => `${spec.id}:${i}`),
        position: { x: 0, y: 0 },
        bonuses: {},
        celestialPower: null,
        weaponRequirement: null,
      });
    }
    const affinityRequired: Record<string, number> = {};
    const affinityBonus: Record<string, number> = {};
    for (let i = 0; i < 5; i++) {
      if (spec.req[i]) affinityRequired[affinities[i]!] = spec.req[i]!;
      if (spec.grant[i]) affinityBonus[affinities[i]!] = spec.grant[i]!;
    }
    constellations.set(spec.id, {
      id: spec.id,
      nameTag: spec.id,
      tier: null,
      affinityRequired,
      affinityBonus,
      background: null,
      starIds,
    });
  }
  return { stars, constellations } as DevotionModel;
}

// G (1 star, grants eldritch 3, no requirement) and X (4 stars, requires eldritch 1, grants nothing,
// branching: 0-1, then 1 branches to 2 and 3). X full costs 5 with G, so it is never completable at
// budget 4, but proper prefixes are reachable: maxK = 3 at budget 4, maxK = 2 at budget 3.
const branchy = () =>
  modelFromCons([
    { id: "G", size: 1, req: [0, 0, 0, 0, 0], grant: [0, 0, 3, 0, 0] },
    { id: "X", size: 4, req: [0, 0, 1, 0, 0], grant: [0, 0, 0, 0, 0], preds: { 2: [1], 3: [1] } },
  ]);

test("reachableStars: proper prefixes of a non-completable constellation light up to maxK", () => {
  const m = branchy();
  const c = buildReachCons(m);
  const t = buildCoverTable(c);
  // Budget 4: X's tips (paths of 3) fit, X complete (4 + G's 1 = 5) does not.
  const v4 = reachabilityForSelection(m, c, t, new Set(), 4);
  expect(v4.completable.has("X")).toBe(false);
  expect(v4.completable.has("G")).toBe(true);
  expect(v4.reachableStars.has("X:0")).toBe(true);
  expect(v4.reachableStars.has("X:1")).toBe(true);
  expect(v4.reachableStars.has("X:2")).toBe(true); // path {0,1,2} = 3 <= maxK 3
  expect(v4.reachableStars.has("X:3")).toBe(true); // path {0,1,3} = 3 <= maxK 3
  // Budget 3: maxK drops to 2; the branch tips (path 3) go dark, the stem stays.
  const v3 = reachabilityForSelection(m, c, t, new Set(), 3);
  expect(v3.reachableStars.has("X:0")).toBe(true);
  expect(v3.reachableStars.has("X:1")).toBe(true);
  expect(v3.reachableStars.has("X:2")).toBe(false);
  expect(v3.reachableStars.has("X:3")).toBe(false);
});

test("reachableStars: a started partial constellation with no spare points admits nothing more", () => {
  const m = branchy();
  const c = buildReachCons(m);
  const t = buildCoverTable(c);
  // {X:0, X:1} + G's 1 star = 3 points, budget 3: adding any X star needs a 4th point.
  const v = reachabilityForSelection(m, c, t, new Set(["X:0", "X:1"]), 3);
  expect(v.completable.has("X")).toBe(false);
  expect(v.reachableStars.has("X:2")).toBe(false);
  expect(v.reachableStars.has("X:3")).toBe(false);
  expect(v.reachableStars.has("G:0")).toBe(true); // G itself still completes within 3
});

test("reachableStars: all unselected stars of a completable constellation are present", () => {
  const m = branchy();
  const c = buildReachCons(m);
  const t = buildCoverTable(c);
  const v = reachabilityForSelection(m, c, t, new Set(), 55);
  for (const con of m.constellations.values())
    for (const sid of con.starIds) expect(v.reachableStars.has(sid)).toBe(true);
});

const starCanon = canonicalStarIds(realModel);
const realCons = buildReachCons(realModel);
const realTable = buildCoverTable(realCons);
const HASH_51 =
  "#p=55&s=AAAAAAEHAAAAOAAAOAA8PAA8APgHAAB4AHwAAAAAAAAAAAAAAAAAAAB8AAAAAAAAAAAAAAAAAAAAAAAAAADAHw";
const HASH_55 =
  "#p=55&s=AAAAAAEHAAAAOAAAOAA8PAA8APgHAAB4AHwAAAAAAAAAAAAAAAAAAAB8AAAAAAAAAAAAAAAAAAAAAOACAADAHw";

test("real map: Korvaak and Tortoise stars all light at the 51-point reference state", () => {
  const sel = decodeHash(HASH_51, starCanon)!.selected;
  expect(sel.size).toBe(51);
  const v = reachabilityForSelection(realModel, realCons, realTable, sel, 55);
  // Neither constellation is completable (6 and 5 stars against 4 spare points)...
  expect(v.completable.has("korvaak_the_eldritch_sun")).toBe(false);
  expect(v.completable.has("tortoise")).toBe(false);
  // ...but every star's path costs at most 4, so all of them are reachable.
  for (let i = 0; i < 6; i++) expect(v.reachableStars.has(`korvaak_the_eldritch_sun:${i}`)).toBe(true);
  for (let i = 0; i < 5; i++) expect(v.reachableStars.has(`tortoise:${i}`)).toBe(true);
}, 60_000);

test("real map: after spending the 4 points on Eye of Korvaak, the siblings go dark", () => {
  const sel = decodeHash(HASH_55, starCanon)!.selected;
  expect(sel.size).toBe(55);
  const v = reachabilityForSelection(realModel, realCons, realTable, sel, 55);
  expect(v.reachableStars.has("korvaak_the_eldritch_sun:3")).toBe(false);
  expect(v.reachableStars.has("korvaak_the_eldritch_sun:5")).toBe(false);
  for (let i = 0; i < 5; i++) expect(v.reachableStars.has(`tortoise:${i}`)).toBe(false);
}, 60_000);

test("reachableStars is downward-closed along the predecessor DAG", () => {
  const sel = decodeHash(HASH_51, starCanon)!.selected;
  const v = reachabilityForSelection(realModel, realCons, realTable, sel, 55);
  for (const sid of v.reachableStars) {
    const star = realModel.stars.get(sid)!;
    for (const p of star.predecessors) expect(sel.has(p) || v.reachableStars.has(p)).toBe(true);
  }
}, 60_000);

// Ground-truth agreement on small random models: membership must equal a direct classification of
// "selection + the star's path" - the exact question reachableStars answers. Small models keep the
// exact resolver fast, so this sweeps every star of every model.
test("reachableStars membership agrees with classifyForSelection on random small models", () => {
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let trial = 0; trial < 20; trial++) {
    const specs = [];
    const n = 3 + Math.floor(rnd() * 3); // 3-5 constellations
    for (let i = 0; i < n; i++) {
      const req: Vec = [0, 0, 0, 0, 0];
      const grant: Vec = [0, 0, 0, 0, 0];
      if (rnd() < 0.7) req[Math.floor(rnd() * 5)] = 1 + Math.floor(rnd() * 3);
      if (rnd() < 0.7) grant[Math.floor(rnd() * 5)] = 1 + Math.floor(rnd() * 4);
      specs.push({ id: `c${i}`, size: 1 + Math.floor(rnd() * 4), req, grant });
    }
    const m = modelFromCons(specs);
    const c = buildReachCons(m);
    const t = buildCoverTable(c);
    const budget = 3 + Math.floor(rnd() * 6);
    const v = reachabilityForSelection(m, c, t, new Set(), budget);
    for (const star of m.stars.values()) {
      const withPath = new Set(pathToStar(m, new Set(), star.id));
      const verdict = classifyForSelection(c, t, selectionSummary(m, withPath), budget) === "reachable";
      expect(v.reachableStars.has(star.id)).toBe(verdict);
    }
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `just test test/reachability-partial.test.ts`
Expected: FAIL - `reachableStars` is undefined on the returned view (TypeScript compile error or `undefined.has`).

- [ ] **Step 3: Implement the engine change**

In `web/src/core/reachability.ts`, replace the `ReachView` interface (line ~1001) with:

```ts
export interface ReachView {
  completable: Set<string>;
  clickable: Set<StarId>;
  // Every unselected star whose path (the star plus its unselected predecessors) keeps the selection
  // reachable at the sweep budget: all unselected stars of a completable constellation, plus the stars
  // within reach of a partially enterable one (path cost <= maxK - see reachabilityForSelection).
  reachableStars: Set<StarId>;
  have: Vec;
  need: Vec;
  needSource: Map<number, string[]>;
}
```

Replace the body of `reachabilityForSelection` (lines ~1010-1063) with:

```ts
export function reachabilityForSelection(
  model: DevotionModel,
  cons: ReachCon[],
  table: CoverTable,
  selected: Set<StarId>,
  budget = BUDGET,
): ReachView {
  const st = selectionSummary(model, selected);
  const completable = new Set<string>();
  const reachableStars = new Set<StarId>();
  // A constellation already fully selected "completes" to the current selection unchanged, so its
  // verdict is the current selection's - classify that once and reuse it instead of re-running the
  // (sometimes costly) resolver per complete constellation.
  const selfReachable = classifyForSelection(cons, table, st, budget) === "reachable";
  for (const c of model.constellations.values()) {
    const size = c.starIds.length;
    let selCount = 0;
    for (const sid of c.starIds) if (selected.has(sid)) selCount++;
    if (selCount === size) {
      if (selfReachable) completable.add(c.id);
      continue;
    }
    // The verdict for "selection + k stars of c" depends only on the count k (selectionSummary reduces
    // a selection to per-constellation counts), so the probe set is the selection plus unselected stars
    // of c in index order until the count reaches k - WHICH stars is immaterial to the verdict.
    const reachableAt = (k: number): boolean => {
      const withK = new Set(selected);
      let count = selCount;
      for (const sid of c.starIds) {
        if (count >= k) break;
        if (!withK.has(sid)) {
          withK.add(sid);
          count++;
        }
      }
      return classifyForSelection(cons, table, selectionSummary(model, withK), budget) === "reachable";
    };
    if (reachableAt(size)) {
      completable.add(c.id);
      for (const sid of c.starIds) if (!selected.has(sid)) reachableStars.add(sid);
      continue;
    }
    // Not completable: find maxK, the largest star count that stays reachable. Probe the cheapest
    // entry (selCount+1) first - most non-completable constellations admit nothing, and that probe is
    // the same dim proof the old per-frontier-star pass paid - then binary search the rest (the
    // verdict is monotone in k: a bigger proper prefix costs more and grants nothing until complete).
    let lo = selCount + 1;
    const last = size - 1; // k = size is the completable question, already answered dim above
    if (lo > last || !reachableAt(lo)) continue;
    let hi = last;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (reachableAt(mid)) lo = mid;
      else hi = mid - 1;
    }
    const maxK = lo;
    for (const sid of c.starIds) {
      if (selected.has(sid)) continue;
      if (selCount + pathToStar(model, selected, sid).size <= maxK) reachableStars.add(sid);
    }
  }
  // clickable is now a pure projection: a frontier star's verdict IS the count selCount+1 verdict,
  // which reachableStars already encodes. (Removed entirely once all consumers migrate.)
  const clickable = new Set<StarId>();
  for (const star of model.stars.values()) {
    if (selected.has(star.id)) continue;
    if (!star.predecessors.every((p) => selected.has(p))) continue;
    if (reachableStars.has(star.id)) clickable.add(star.id);
  }
  // panel: have = supply, need = target, needSource = started cons defining each color's max.
  const needSource = new Map<number, string[]>();
  for (let i = 0; i < 5; i++) {
    if (st.target[i] === 0) continue;
    const src: string[] = [];
    for (const conId of st.startedIds) {
      const c = model.constellations.get(conId)!;
      if ((vecOf(c.affinityRequired)[i] ?? 0) === st.target[i]) src.push(conId);
    }
    needSource.set(i, src);
  }
  return { completable, clickable, reachableStars, have: st.supply, need: st.target, needSource };
}
```

- [ ] **Step 4: Update every other `ReachView` constructor (mechanical)**

In `web/src/app/main.ts` `permissiveReach` (line ~211): after the `clickable` loop, add the permissive `reachableStars` (every unselected star - the degraded path lights everything) and return it:

```ts
    const reachableStars = new Set<string>();
    for (const st of model.stars.values()) if (!state.selected.has(st.id)) reachableStars.add(st.id);
    return { completable, clickable, reachableStars, have: s.supply, need: s.target, needSource };
```

In each test file below, add `reachableStars: new Set<string>()` beside the existing `clickable:` entry in the `ReachView` literal(s):

- `web/test/rules-toggle.test.ts:37` (the `view` helper)
- `web/test/rules-constellation.test.ts:27` (the `view` helper)
- `web/test/commit-action.test.ts:16` (the `reachWith` helper)
- `web/test/displayState.test.ts:18` (the `reach` helper defaults, before the `...over` spread)
- `web/test/svgRenderer.test.ts` (four literals at lines ~87, ~124, ~158, ~231)
- `web/test/i18nCharacterization.test.ts` (the stand-in at line ~42)

In `web/test/reachability.test.ts:113`, after the `clickable` sweep-equivalence assertion, add:

```ts
  expect([...view.reach.reachableStars].sort()).toEqual([...direct.reachableStars].sort());
```

- [ ] **Step 5: Run the new tests, then the full suite**

Run: `just test test/reachability-partial.test.ts`
Expected: PASS (7 tests).

Run: `just test`
Expected: PASS - the derived `clickable` is verdict-identical to the old per-star pass, so no existing test changes verdicts. If `reachability.test.ts` "startable-but-not-completable" (line ~258) fails, the maxK search has a bug - the old and new `clickable` must agree exactly.

- [ ] **Step 6: Run the fuzz gate (engine semantics changed)**

Run: `just fuzz --seeds 50`
Expected: `0 violations` (the fuzzer asserts valid-build members are never dimmed; `clickable` still exists at this point and is read by the script).

- [ ] **Step 7: Commit**

```bash
git add web/src/core/reachability.ts web/src/app/main.ts web/test
git commit -m "feat(reach): reachableStars signal - deep-star attainability via per-constellation maxK search

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Display - star and edge brightness from `reachableStars`

Brightness channel only (see `docs/display-model.md`): stars light iff selected or reachable; edges light iff taken or their deeper endpoint is on a reachable path. Constellation brightness is untouched, so a dimmed enterable constellation keeps dim art while its reachable stars and edges light.

**Files:**
- Modify: `web/src/core/displayState.ts:56-84` (`starDisplay`, `edgeDisplay`)
- Test: `web/test/displayState.test.ts`

**Interfaces:**
- Consumes: `ReachView.reachableStars` (Task 2).
- Produces: unchanged record shapes (`StarDisplay`, `EdgeDisplay`); the `StarDisplay.clickable` boolean now means "in `reachableStars`" (the renderer's colored-vs-locked styling flag, `svgRenderer.ts:318`, needs no change).

- [ ] **Step 1: Update and extend the tests**

In `web/test/displayState.test.ts`, replace the two star tests at lines ~89-107 and the edge test at ~137-149 with:

```ts
test("star brightness: active selected; attainable iff in reachableStars; else unattainable", () => {
  const c = con("c", ["c:0", "c:1"]);
  const s0 = star("c:0", "c");
  expect(starDisplay(s0, c, settings({ selected: new Set(["c:0"]), reach: reach() })).brightness).toBe("active");
  expect(starDisplay(s0, c, settings({ reach: reach({ reachableStars: new Set(["c:0"]) }) })).brightness).toBe(
    "attainable",
  );
  // A deep star of a non-completable constellation lights when its path fits (it is in reachableStars).
  expect(starDisplay(star("c:1", "c"), c, settings({ reach: reach({ reachableStars: new Set(["c:0", "c:1"]) }) })).brightness).toBe(
    "attainable",
  );
  expect(starDisplay(s0, c, settings({ reach: reach() })).brightness).toBe("unattainable");
});

test("star immediacy: clickable true iff in reachableStars (or no reach)", () => {
  const c = con("c", ["c:0"]);
  expect(
    starDisplay(star("c:0", "c"), c, settings({ reach: reach({ reachableStars: new Set(["c:0"]) }) })).clickable,
  ).toBe(true);
  expect(starDisplay(star("c:0", "c"), c, settings({ reach: reach() })).clickable).toBe(false);
  expect(starDisplay(star("c:0", "c"), c, settings()).clickable).toBe(true);
});

test("edge brightness: active when taken; attainable iff the deeper endpoint is on a reachable path", () => {
  const c = con("c", ["c:0", "c:1"]);
  const both = settings({ selected: new Set(["c:0", "c:1"]), reach: reach() });
  expect(edgeDisplay(c, "c:0", "c:1", both).taken).toBe(true);
  expect(edgeDisplay(c, "c:0", "c:1", both).brightness).toBe("active");
  // The deeper endpoint is reachable: the edge lights even though the constellation is not completable.
  expect(
    edgeDisplay(c, "c:0", "c:1", settings({ reach: reach({ reachableStars: new Set(["c:0", "c:1"]) }) })).brightness,
  ).toBe("attainable");
  // From a selected star toward an unreachable sibling: the edge goes dark (the sibling branch dims).
  expect(
    edgeDisplay(c, "c:0", "c:1", settings({ selected: new Set(["c:0"]), reach: reach() })).brightness,
  ).toBe("unattainable");
  expect(edgeDisplay(c, "c:0", "c:1", settings({ reach: reach() })).brightness).toBe("unattainable");
});
```

- [ ] **Step 2: Run to verify the new expectations fail**

Run: `just test test/displayState.test.ts`
Expected: FAIL on the reachableStars-driven cases (old code reads `clickable`/`completable`).

- [ ] **Step 3: Implement**

In `web/src/core/displayState.ts`, replace `starDisplay` (lines ~56-69) and `edgeDisplay` (lines ~77-84) with:

```ts
export function starDisplay(star: Star, con: Constellation, s: DisplaySettings): StarDisplay {
  const selected = s.selected.has(star.id);
  // reachableStars holds every unselected star whose path fits the budget (deep stars of partially
  // enterable constellations included), so it is both the brightness and the click affordance.
  const clickable = !s.reach || s.reach.reachableStars.has(star.id);
  let brightness: Brightness;
  if (selected) brightness = "active";
  else if (clickable) brightness = "attainable";
  else brightness = "unattainable";
  // Stars carry no affinity halo; the affinity axis only mutes them (when their constellation
  // provides none of the filtered colors) or leaves them at identity.
  const conColor = constellationColor(con, s);
  const color: StarDisplay["color"] = conColor.kind === "mute" ? { kind: "mute" } : { kind: "identity" };
  const diff = s.diff ? (s.diff.added.has(star.id) ? "add" : s.diff.removed.has(star.id) ? "remove" : null) : null;
  return { brightness, color, clickable, selected, benefitMatch: s.benefitMatch?.has(star.id) ?? false, diff };
}
```

```ts
export function edgeDisplay(con: Constellation, fromId: StarId, toId: StarId, s: DisplaySettings): EdgeDisplay {
  const taken = s.selected.has(fromId) && s.selected.has(toId);
  // The deeper endpoint's path contains the shallower one, so the edge sits on a reachable path iff
  // `to` is selected or reachable. Brightness is endpoint-level; the constellation art stays dim.
  const toOnPath = !s.reach || s.selected.has(toId) || s.reach.reachableStars.has(toId);
  const brightness: Brightness = taken ? "active" : toOnPath ? "attainable" : "unattainable";
  const conColor = constellationColor(con, s);
  const color: EdgeDisplay["color"] = conColor.kind === "mute" ? { kind: "mute" } : { kind: "identity" };
  return { brightness, color, taken };
}
```

- [ ] **Step 4: Run the tests, then the full suite**

Run: `just test test/displayState.test.ts` - Expected: PASS.
Run: `just test` - Expected: PASS. `svgRenderer.test.ts` "immediacy state" (line ~84) will fail if its mock still puts the star in `clickable` only - move that star id into `reachableStars` in the mock (line ~96: change `reach.clickable.add(firstStar)` to `reach.reachableStars.add(firstStar)`).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/displayState.ts web/test/displayState.test.ts web/test/svgRenderer.test.ts
git commit -m "feat(display): star and edge brightness from reachableStars (deep paths light in dimmed constellations)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Rules - click-to-path and all-in/all-out background click

**Files:**
- Modify: `web/src/core/rules.ts:28-60` (`toggleStar`, `toggleConstellation`)
- Test: `web/test/rules-toggle.test.ts`, `web/test/rules-constellation.test.ts`

**Interfaces:**
- Consumes: `ReachView.reachableStars`, `pathToStar` (import from `./reachability`).
- Produces: same signatures. New semantics: `toggleStar` on an unselected star adds `pathToStar(...)`; `toggleConstellation` clears when ANY star is selected, adds all only when none is selected and completable.

- [ ] **Step 1: Update and extend the tests**

In `web/test/rules-toggle.test.ts`, update the `view` helper (first param now feeds `reachableStars`):

```ts
const view = (reachable: string[], completable: string[] = []): ReachView => ({
  completable: new Set(completable),
  clickable: new Set(),
  reachableStars: new Set(reachable),
  have: [0, 0, 0, 0, 0],
  need: [0, 0, 0, 0, 0],
  needSource: new Map(),
});
```

Replace the first test and add the path-add case:

```ts
test("adds a reachable star; rejects one not in reachableStars", () => {
  const reach = view(["A:0"]);
  expect(toggleStar(model, st([]), reach, "A:0").selected.has("A:0")).toBe(true);
  expect(toggleStar(model, st([]), reach, "A:1")).toEqual(st([])); // not reachable -> unchanged
});

test("clicking a deep reachable star adds its whole unselected path", () => {
  const reach = view(["A:1"]); // the deep star is reachable; a click claims A:0 too
  const next = toggleStar(model, st([]), reach, "A:1");
  expect([...next.selected].sort()).toEqual(["A:0", "A:1"]);
  // With the predecessor already selected, only the star itself is added.
  const next2 = toggleStar(model, st(["A:0"]), reach, "A:1");
  expect([...next2.selected].sort()).toEqual(["A:0", "A:1"]);
});
```

In `web/test/rules-constellation.test.ts`, update the `view` helper the same way (add `reachableStars: new Set<string>()`), and replace the tests:

```ts
test("claims all stars when none are selected and the constellation is completable", () => {
  const next = toggleConstellation(model, st([]), view(["A"]), "A");
  expect([...next.selected].sort()).toEqual(["A:0", "A:1"]);
});
test("rejects a claim when not completable (no deterministic partial path to pick)", () => {
  expect(toggleConstellation(model, st([]), view([]), "A")).toEqual(st([]));
});
test("clears a PARTIALLY selected constellation instead of completing it (all-in / all-out)", () => {
  const next = toggleConstellation(model, st(["A:0"]), view(["A"]), "A");
  expect(next.selected.size).toBe(0); // even though completable, any-selected means clear
});
test("removes the whole constellation freely when fully selected", () => {
  const next = toggleConstellation(model, st(["A:0", "A:1"]), view([]), "A");
  expect(next.selected.size).toBe(0);
});
```

- [ ] **Step 2: Run to verify the new expectations fail**

Run: `just test test/rules-toggle.test.ts test/rules-constellation.test.ts`
Expected: FAIL - deep add returns unchanged state (gated on `clickable`), partial constellation click currently completes.

- [ ] **Step 3: Implement**

In `web/src/core/rules.ts`, update the import and both toggles:

```ts
import {
  classifyForSelection,
  pathToStar,
  selectionSummary,
  type CoverTable,
  type ReachCon,
  type ReachView,
} from "./reachability";
```

```ts
export function toggleStar(
  model: DevotionModel,
  state: SelectionState,
  reach: ReachView,
  starId: StarId,
): SelectionState {
  if (state.selected.has(starId))
    return { selected: removeWithDependents(model, state.selected, starId), pointCap: state.pointCap };
  if (!reach.reachableStars.has(starId)) return state; // not a valid target right now
  // Claim the star plus its unselected predecessors: one click takes the whole path. For a frontier
  // star the path is just the star itself, so the old single-add behavior is preserved exactly.
  const next = new Set(state.selected);
  for (const id of pathToStar(model, state.selected, starId)) next.add(id);
  return { selected: next, pointCap: state.pointCap };
}

export function toggleConstellation(
  model: DevotionModel,
  state: SelectionState,
  reach: ReachView,
  conId: string,
): SelectionState {
  const con = model.constellations.get(conId);
  if (!con || con.starIds.length === 0) return state;
  if (con.starIds.some((id) => state.selected.has(id))) {
    // Any selected -> clear the constellation (all-in / all-out). Completing a started constellation
    // is done by clicking its remaining star(s); a partial claim has no deterministic star choice.
    const next = new Set(state.selected);
    for (const id of con.starIds) next.delete(id);
    return { selected: next, pointCap: state.pointCap };
  }
  if (!reach.completable.has(conId)) return state; // cannot finish within budget
  const next = new Set(state.selected);
  for (const id of con.starIds) next.add(id);
  return { selected: next, pointCap: state.pointCap };
}
```

- [ ] **Step 4: Run the tests, then the full suite**

Run: `just test test/rules-toggle.test.ts test/rules-constellation.test.ts` - Expected: PASS.
Run: `just test` - Expected: PASS (rules-repair and rules-recap do not touch these paths).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/rules.ts web/test/rules-toggle.test.ts web/test/rules-constellation.test.ts
git commit -m "feat(rules): click-to-path star adds; constellation background click is all-in or all-out

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Commit button mirrors the new rules

**Files:**
- Modify: `web/src/core/commitAction.ts:13-29`
- Test: `web/test/commit-action.test.ts`

**Interfaces:**
- Consumes: `ReachView.reachableStars`.
- Produces: same `commitButton` signature; star Add enabled iff in `reachableStars`; constellation shows Remove (enabled) when ANY star is selected, else Add gated on `completable`.

- [ ] **Step 1: Update and extend the tests**

In `web/test/commit-action.test.ts`, update `reachWith` so the first param feeds `reachableStars`:

```ts
function reachWith(reachable: string[], completable: string[]): ReachView {
  return {
    completable: new Set(completable),
    clickable: new Set(),
    reachableStars: new Set(reachable),
    have: [0, 0, 0, 0, 0],
    need: [0, 0, 0, 0, 0],
    needSource: new Map(),
  };
}
```

Rename the star tests ("clickable" wording to "reachable") - the bodies already pass the id through the first param. Replace the "partially selected, completable constellation" test with:

```ts
test("partially selected constellation -> Remove, enabled (all-in / all-out)", () => {
  const r = reachWith([], [con.id]); // completable, but any-selected means the button clears
  expect(commitButton(model, new Set([starA]), r, { kind: "constellation", id: con.id })).toEqual({
    label: appT("ui.commit.remove"),
    enabled: true,
  });
});

test("unselected, completable constellation -> Add, enabled", () => {
  const r = reachWith([], [con.id]);
  expect(commitButton(model, new Set(), r, { kind: "constellation", id: con.id })).toEqual({
    label: appT("ui.commit.add"),
    enabled: true,
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `just test test/commit-action.test.ts`
Expected: FAIL - a partially selected completable constellation currently maps to Add.

- [ ] **Step 3: Implement**

In `web/src/core/commitAction.ts`, replace `commitButton`:

```ts
export function commitButton(
  model: DevotionModel,
  selected: Set<StarId>,
  reach: ReachView,
  target: CommitTarget,
): CommitButton {
  if (target.kind === "star") {
    if (selected.has(target.id)) return { label: appT("ui.commit.remove"), enabled: true };
    return { label: appT("ui.commit.add"), enabled: reach.reachableStars.has(target.id) };
  }
  const con = model.constellations.get(target.id);
  const starIds = con?.starIds ?? [];
  // Mirror toggleConstellation (all-in / all-out): any selected star means the button clears the
  // constellation; otherwise it adds the whole thing, gated by completable.
  if (starIds.some((id) => selected.has(id))) return { label: appT("ui.commit.remove"), enabled: true };
  return { label: appT("ui.commit.add"), enabled: reach.completable.has(target.id) };
}
```

Also update the file's second ABOUTME line to name the new gate:

```ts
// ABOUTME: Pure mapping from engine legality (reachableStars/completable/selected) to the touch popover's
// ABOUTME: Add/Remove button label + enabled state. Mirrors toggleStar/toggleConstellation in rules.ts.
```

- [ ] **Step 4: Run the tests, then the full suite**

Run: `just test test/commit-action.test.ts` - Expected: PASS.
Run: `just test` - Expected: PASS (`i18nCharacterization.test.ts` calls `commitButton` with a stand-in whose `reachableStars` is empty; its expectations are label-side only - if it asserted an enabled Add for a star via `clickable`, move that star id into `reachableStars` in the stand-in).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/commitAction.ts web/test/commit-action.test.ts web/test/i18nCharacterization.test.ts
git commit -m "feat(commit): popover Add/Remove mirrors path-add and all-in/all-out rules

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: "Available to get" from reachable stars

**Files:**
- Modify: `web/src/core/aggregate.ts:104-157` (`availableBonusIds`, `availablePetKeys`, `availablePowers`)
- Modify: `web/src/app/main.ts` (call sites at lines ~497-498 and ~566)
- Test: `web/test/aggregate.test.ts`, `web/test/reachability-partial.test.ts`

**Interfaces:**
- Consumes: `ReachView.reachableStars` (contract: contains only unselected stars).
- Produces:
  - `availableBonusIds(model: DevotionModel, reachableStars: Set<StarId>): Set<string>`
  - `availablePetKeys(model: DevotionModel, reachableStars: Set<StarId>): Set<string>`
  - `availablePowers(model: DevotionModel, reachableStars: Set<StarId>): { starId: StarId; power: CelestialPower }[]`
  - The `selected` and `completable` parameters are gone: `reachableStars` already excludes selected stars and encodes reachability.

- [ ] **Step 1: Update the aggregate tests and add the integration case**

In `web/test/aggregate.test.ts`, add a helper near the top and rewrite the five `available*` tests to pass star sets:

```ts
// The unselected stars of a constellation - what reachableStars contains for a completable one.
const unselectedStarsOf = (conId: string, selected: Set<string> = new Set()): Set<string> => {
  const out = new Set<string>();
  for (const sid of model.constellations.get(conId)!.starIds) if (!selected.has(sid)) out.add(sid);
  return out;
};
```

- "union of bonus ids..." test: `availableBonusIds(model, unselectedStarsOf(bat.id))`.
- "skips already-selected stars" test: build `selected`, pass `unselectedStarsOf(bat.id, selected)`.
- "availablePetKeys returns pet: keys..." test: `availablePetKeys(model, unselectedStarsOf(con.id))`; the empty case becomes `availablePetKeys(model, new Set())`.
- "availablePetKeys skips already-selected stars": `availablePetKeys(model, unselectedStarsOf(con.id, new Set(con.starIds)))` - an empty set in, empty out.
- "includes recognized power stats..." test: `availableBonusIds(model, unselectedStarsOf(conId!))`.
- "availablePowers lists..." test: `availablePowers(model, unselectedStarsOf(bat.id))`; the gained case passes `unselectedStarsOf(bat.id, new Set([powerStar.id]))`; the not-completable case `availablePowers(model, new Set())`.

Append to `web/test/reachability-partial.test.ts` (end-to-end: engine plus aggregation):

```ts
import { availablePowers } from "../src/core/aggregate";

test("real map: Eye of Korvaak and Turtle Shell are available to get at the 51-point state", () => {
  const sel = decodeHash(HASH_51, starCanon)!.selected;
  const v = reachabilityForSelection(realModel, realCons, realTable, sel, 55);
  const powerStars = availablePowers(realModel, v.reachableStars).map((p) => p.starId);
  expect(powerStars).toContain("korvaak_the_eldritch_sun:4");
  expect(powerStars).toContain("tortoise:4");
}, 60_000);
```

- [ ] **Step 2: Run to verify failure**

Run: `just test test/aggregate.test.ts test/reachability-partial.test.ts`
Expected: FAIL - signatures do not match (TypeScript errors).

- [ ] **Step 3: Implement**

In `web/src/core/aggregate.ts`, replace the three functions (keep each function's doc comment, updated):

```ts
// The stat ids still obtainable from the current selection: every bonus carried by a reachable star
// (reachableStars: unselected stars whose path fits the budget - all stars of completable
// constellations plus the in-reach stars of partially enterable ones). Drives "Available to get".
export function availableBonusIds(model: DevotionModel, reachableStars: Set<StarId>): Set<string> {
  const out = new Set<string>();
  for (const sid of reachableStars) {
    const star = model.stars.get(sid);
    if (!star) continue;
    for (const k of Object.keys(star.bonuses)) out.add(k);
    const power = star.celestialPower;
    if (power) for (const k of Object.keys(power.stats)) if (isFilterableStat(k)) out.add(k);
  }
  return out;
}

// The pet bonuses still obtainable, as pet:-scoped tag keys (see availableBonusIds for the
// reachableStars contract). Drives the pet "Available to get" list.
export function availablePetKeys(model: DevotionModel, reachableStars: Set<StarId>): Set<string> {
  const out = new Set<string>();
  for (const sid of reachableStars) {
    const pet = model.stars.get(sid)?.petBonuses;
    if (!pet) continue;
    for (const k of Object.keys(pet)) out.add(petTagId(k));
  }
  return out;
}

// The celestial powers still validly pickable: the power star of any reachable star set (a gained
// power's star is selected, so it is never in reachableStars). Drives the "Celestial Powers" list.
export function availablePowers(
  model: DevotionModel,
  reachableStars: Set<StarId>,
): { starId: StarId; power: CelestialPower }[] {
  const out: { starId: StarId; power: CelestialPower }[] = [];
  for (const sid of reachableStars) {
    const star = model.stars.get(sid);
    if (star?.celestialPower) out.push({ starId: sid, power: star.celestialPower });
  }
  return out;
}
```

In `web/src/app/main.ts`, update the three call sites:

- Line ~497: `const availableIds = availableBonusIds(model, reach.reachableStars);`
- Line ~498: `const availPetKeys = availablePetKeys(model, reach.reachableStars);`
- Line ~566: `const availPowers = availablePowers(model, state.selected, reach.completable);` becomes `const availPowers = availablePowers(model, reach.reachableStars);`

- [ ] **Step 4: Run the tests, then the full suite**

Run: `just test test/aggregate.test.ts test/reachability-partial.test.ts` - Expected: PASS.
Run: `just test` - Expected: PASS (`sidebar-benefits`/`sidebar-affinity` render from precomputed sets, unaffected).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/aggregate.ts web/src/app/main.ts web/test/aggregate.test.ts web/test/reachability-partial.test.ts
git commit -m "feat(panel): available-to-get lists draw from reachable stars, not completable constellations

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Tooltip path-cost line

An unselected reachable star whose path costs 2 or more shows "N points to reach" in its hover tooltip and touch popover. The threshold lives in the controller (frontier stars keep today's lineless tooltip).

**Files:**
- Modify: `web/src/i18n/app.en.json` and the 12 other `web/src/i18n/app.<locale>.json` files
- Modify: `web/test/appCatalog.test.ts` (the `REQUIRED` list)
- Modify: `web/src/adapters/tooltipView.ts` (`show`)
- Modify: `web/src/app/main.ts` (`onHover` star branch ~line 282, `showCommitPopover` star branch ~line 652; import `pathToStar`)
- Modify: `web/src/styles.css` (after the `.tip-dim` rule, line ~574)

**Interfaces:**
- Consumes: `pathToStar` (Task 1), `reach.reachableStars` (Task 2).
- Produces: `tooltipView(...).show(loc, model, starId, clientX, clientY, totals?, commit?, selectedBenefits?, pathCost?: number)` - the new optional last parameter renders the cost line when defined.

- [ ] **Step 1: Write the failing guard test**

In `web/test/appCatalog.test.ts`, add to the `REQUIRED` array after `"ui.tooltip.partialGate"`:

```ts
  "ui.tooltip.pointsToReach",
```

Run: `just test test/appCatalog.test.ts`
Expected: FAIL - key missing from `app.en.json`.

- [ ] **Step 2: Add the catalog keys**

In `web/src/i18n/app.en.json`, after `"ui.tooltip.partialGate"`:

```json
  "ui.tooltip.pointsToReach": "{count} points to reach",
```

Add the translated line at the same position in each locale file:

| File | Value |
| --- | --- |
| `app.cs.json` | `"Dosažitelné za {count} bodů"` |
| `app.de.json` | `"Mit {count} Punkten erreichbar"` |
| `app.es.json` | `"Se alcanza con {count} puntos"` |
| `app.fr.json` | `"Atteignable en {count} points"` |
| `app.it.json` | `"Raggiungibile con {count} punti"` |
| `app.ja.json` | `"到達には{count}ポイント"` |
| `app.ko.json` | `"도달하려면 {count} 포인트 필요"` |
| `app.pl.json` | `"Osiągalne za {count} punktów"` |
| `app.pt.json` | `"Alcançável com {count} pontos"` |
| `app.ru.json` | `"Достижимо за {count} очков"` |
| `app.vi.json` | `"Cần {count} điểm để đạt tới"` |
| `app.zh.json` | `"需要{count}点才能到达"` |

Run: `just test test/appCatalog.test.ts`
Expected: PASS (including the placeholder-set and stray-key guards for all locales).

- [ ] **Step 3: Render the line in the tooltip adapter**

In `web/src/adapters/tooltipView.ts`, add the parameter to `show` and render the line right after the constellation name header:

```ts
    show(
      loc: Localization,
      model: DevotionModel,
      starId: StarId,
      clientX: number,
      clientY: number,
      totals?: AffinityTotals,
      commit?: { label: Text; enabled: boolean },
      selectedBenefits: Set<string> = new Set(),
      pathCost?: number,
    ) {
      const star = model.stars.get(starId);
      if (!star) return;
      const con = model.constellations.get(star.constellationId)!;
      const power = star.celestialPower ? powerHtml(loc, star.celestialPower) : "";
      const weaponReqTag = star.weaponRequirement?.descriptionTag;
      // The cost of claiming this star from here (its unselected predecessor path). The controller
      // passes it only for deep reachable stars (cost >= 2); frontier stars keep the plain tooltip.
      const costLine =
        pathCost !== undefined
          ? `<div class="tip-path-cost">${loc.translate("ui.tooltip.pointsToReach", { count: pathCost })}</div>`
          : "";
      el.innerHTML = `<strong>${loc.gameText(con.nameTag)}</strong>${costLine}${power}${bonusRowsHtml(loc, star.bonuses, selectedBenefits, (id) => id, star.racialTarget)}${weaponReqHtml(weaponReqTag ? loc.gameText(weaponReqTag) : null)}${petBonusHtml(loc, star.petBonuses, selectedBenefits)}${affinitySections(loc, con, totals, selectedBenefits)}${commitHtml(loc, commit)}`;
      el.style.pointerEvents = commit ? "auto" : "";
      place(clientX, clientY);
    },
```

In `web/src/styles.css`, after the `.tip-dim` rule (line ~574):

```css
.tip-path-cost {
  margin-top: 0.15rem;
  color: #9aa4b2;
  font-size: 0.9em;
}
```

- [ ] **Step 4: Pass the cost from the controller**

In `web/src/app/main.ts`:

Add `pathToStar` to the `../core/reachability` import list (line ~20-31).

Add a helper near `completionInfo` (line ~241):

```ts
  // The path cost to show in a star tooltip: the star's unselected predecessor path size, only for
  // an unselected reachable star whose path is 2+ (frontier stars keep the plain tooltip).
  function starPathCost(starId: StarId): number | undefined {
    if (state.selected.has(starId) || !reach.reachableStars.has(starId)) return undefined;
    const cost = pathToStar(model, state.selected, starId).size;
    return cost >= 2 ? cost : undefined;
  }
```

In `onHover` (line ~282), the star branch becomes:

```ts
      if (t.kind === "star")
        tip.show(localization, model, t.id, x, y, totals, undefined, selectedBenefits, starPathCost(t.id));
```

In `showCommitPopover` (line ~652), the star branch becomes:

```ts
    if (target.kind === "star")
      tip.show(localization, model, target.id, x, y, totals, btn, selectedBenefits, starPathCost(target.id));
```

- [ ] **Step 5: Run the full suite and verify in the browser**

Run: `just test` - Expected: PASS.
Run: `just serve`, open `http://localhost:5173/#p=55&s=AAAAAAEHAAAAOAAAOAA8PAA8APgHAAB4AHwAAAAAAAAAAAAAAAAAAAB8AAAAAAAAAAAAAAAAAAAAAAAAAADAHw` and verify: Korvaak's and Tortoise's stars render colored in dimmed constellation art with lit edges; hovering Eye of Korvaak (the deep diamond star) shows "4 points to reach"; clicking it selects 4 stars and dims the Korvaak siblings and all of Tortoise; the right panel lists Eye of Korvaak and Turtle Shell under Celestial Powers before the click and drops them after.

- [ ] **Step 6: Commit**

```bash
git add web/src/i18n web/test/appCatalog.test.ts web/src/adapters/tooltipView.ts web/src/app/main.ts web/src/styles.css
git commit -m "feat(tooltip): deep reachable stars show their path cost (N points to reach)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Build order renders a partial constellation as partial

With click-to-path, a deliberately partial constellation (4 of Korvaak's 6 stars for Eye of Korvaak) becomes a normal final state. The build-order ENGINE already handles it: `selectionSummary` commits the partial as a zero-grant member sized at its selected count, so `buildOrderPath` places it in the schedule's tail (zero-grant members go last) with the partial point count on its step - verify this, do not change it. The PANEL is what needs work: a complete step currently reads as the whole constellation. Annotate any complete step whose points are less than its constellation's star count with a partial marker, "(4/6)".

**Files:**
- Modify: `web/src/adapters/buildOrderView.ts` (the `kind === "complete"` row branch, line ~94-97)
- Modify: `web/src/i18n/app.en.json` and the 12 other locale files (`ui.buildOrder.partial`)
- Modify: `web/test/appCatalog.test.ts` (the `REQUIRED` list)
- Modify: `web/src/styles.css` (after the `.tip-path-cost` rule from Task 7)
- Test: `web/test/build-order-view.test.ts`, `web/test/reachability-partial.test.ts`

**Interfaces:**
- Consumes: `BuildStep` (unchanged from `web/src/core/reachability.ts`), `model.constellations.get(conId).starIds.length`.
- Produces: no API change - a rendering annotation only. The `BuildStep` type and `buildOrderPath` are untouched.

- [ ] **Step 1: Write the failing tests**

In `web/test/appCatalog.test.ts`, add to the `REQUIRED` array after `"ui.buildOrder.selectPrompt"`:

```ts
  "ui.buildOrder.partial",
```

In `web/test/build-order-view.test.ts`, add:

```ts
test("buildOrderHtml marks a complete step smaller than its constellation as a partial pick", () => {
  const con = [...model.constellations.values()].find((c) => c.starIds.length >= 3)!;
  const size = con.starIds.length;
  const partial = buildOrderHtml(enLoc, model, null, [
    { kind: "complete", conId: con.id, points: size - 1, heldAfter: size - 1 },
  ]);
  expect(partial).toContain(`(${size - 1}/${size})`);
  expect(partial).toContain("bo-partial");
  // A full-size step carries no partial marker.
  const full = buildOrderHtml(enLoc, model, null, [
    { kind: "complete", conId: con.id, points: size, heldAfter: size },
  ]);
  expect(full).not.toContain("bo-partial");
});
```

Append to `web/test/reachability-partial.test.ts` (locks in the ENGINE behavior this task relies on - the partial member lands in the order's tail with its partial point count):

```ts
// Add buildOrderPath and selectionView to the existing import from "../src/core/reachability".

test("build order: a deliberate partial is scheduled last with its partial point count", () => {
  // branchy(): G (1 star, grants eldritch 3) covers X's requirement (eldritch 1), so {X:0, X:1} + G
  // is a valid, self-covering selection with X held partial forever.
  const m = branchy();
  const c = buildReachCons(m);
  const t = buildCoverTable(c);
  const members = selectionSummary(m, new Set(["X:0", "X:1", "G:0"])).built;
  const steps = buildOrderPath(c, t, members, 55)!;
  expect(steps).not.toBeNull();
  const last = steps[steps.length - 1]!;
  expect(last).toEqual({ kind: "complete", conId: "X", points: 2, heldAfter: 3 });
});

test("real map: the Eye of Korvaak build's order carries Korvaak as a 4-point tail step", () => {
  const sel = decodeHash(HASH_55, starCanon)!.selected;
  const view = selectionView(realModel, realCons, realTable, sel, 55);
  expect(view.buildOrder).not.toBeNull();
  const korvaak = view.buildOrder!.findIndex(
    (s) => s.conId === "korvaak_the_eldritch_sun" && s.kind === "complete",
  );
  expect(korvaak).toBeGreaterThanOrEqual(0);
  expect(view.buildOrder![korvaak]!.points).toBe(4); // the partial count, not Korvaak's 6 stars
  // Zero-grant members form the order's tail: everything after the partial is also a complete step.
  for (const s of view.buildOrder!.slice(korvaak)) expect(s.kind).toBe("complete");
}, 60_000);
```

The `branchy` helper is already defined earlier in this same test file (Task 2).

- [ ] **Step 2: Run to verify failure**

Run: `just test test/appCatalog.test.ts test/build-order-view.test.ts test/reachability-partial.test.ts`
Expected: appCatalog FAILS (missing key); build-order-view FAILS (no marker rendered). The two engine tests should PASS already (the tail behavior exists today) - if they fail, stop: the engine assumption is wrong and the task needs rethinking, not a display patch.

- [ ] **Step 3: Add the catalog keys**

In `web/src/i18n/app.en.json`, after `"ui.buildOrder.selectPrompt"`:

```json
  "ui.buildOrder.partial": "({taken}/{total})",
```

Add the SAME value `"({taken}/{total})"` at the same position in all 12 other `web/src/i18n/app.<locale>.json` files (a numeric star-count marker; language-neutral, but each locale must carry the key with matching placeholders so the catalog guards pass).

- [ ] **Step 4: Render the marker**

In `web/src/adapters/buildOrderView.ts`, replace the `if (s.kind === "complete")` block (line ~94-97):

```ts
      if (s.kind === "complete") {
        n++;
        const artCell = img || dot;
        // A step smaller than its constellation is a deliberate partial pick (e.g. 4 of 6 stars to
        // reach a celestial power): annotate it so the row does not read as the full constellation.
        const partial =
          c && s.points < c.starIds.length
            ? ` <span class="bo-partial">${loc.translate("ui.buildOrder.partial", { taken: s.points, total: c.starIds.length })}</span>`
            : "";
        return `<div class="bo-step bo-complete" data-con-id="${esc(s.conId)}"><span class="bo-n">${n}</span>${artCell}<span class="bo-name">${esc(name)}${partial}</span><span class="bo-pts">+${s.points}</span>${held}</div>`;
      }
```

In `web/src/styles.css`, after the `.tip-path-cost` rule added in Task 7:

```css
.bo-partial {
  color: #9aa4b2;
  font-size: 0.85em;
}
```

- [ ] **Step 5: Run the tests, then the full suite**

Run: `just test test/appCatalog.test.ts test/build-order-view.test.ts test/reachability-partial.test.ts` - Expected: PASS.
Run: `just test` - Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/adapters/buildOrderView.ts web/src/i18n web/src/styles.css web/test
git commit -m "feat(build-order): partial constellation steps carry a (taken/total) marker

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Remove the `clickable` signal

Every consumer now reads `reachableStars`; `clickable` is a dead projection. Remove it from `ReachView`, the engine, the permissive path, the scripts, and the test mocks.

**Files:**
- Modify: `web/src/core/reachability.ts` (interface, the projection loop in `reachabilityForSelection`, the `SelectionView.reach` comment at line ~1068)
- Modify: `web/src/app/main.ts` (`permissiveReach` and its comment at line ~207-208)
- Modify: `web/scripts/perf-reachability.ts` (the `Step` interface and its three log lines)
- Modify: `web/scripts/reachability-fuzz.ts` (`Violation.kind`, the first-star check at line ~74)
- Modify: test mocks - remove the `clickable:` entry from every `ReachView` literal touched in Task 2, and update `web/test/reachability.test.ts` (line ~113 comparison, the "startable-but-not-completable" test at ~258, the skipped test at ~332)

**Interfaces:**
- Produces: final `ReachView = { completable, reachableStars, have, need, needSource }`. No consumer of `clickable` may remain (the `StarDisplay.clickable` boolean in `displayState.ts` is a different, kept field - it is the renderer's click-affordance flag).

- [ ] **Step 1: Remove the field and the projection**

In `web/src/core/reachability.ts`: delete `clickable: Set<StarId>;` from `ReachView`, delete the "clickable is now a pure projection" loop, and return `{ completable, reachableStars, have: st.supply, need: st.target, needSource }`. Update the `SelectionView` comment at line ~1068 to `// reachabilityForSelection: dimming, reachable stars, and the affinity panel vectors`.

In `web/src/app/main.ts` `permissiveReach`: delete the `clickable` loop and its mention in the comment above the function (the permissive view is now "every constellation completable, every unselected star reachable").

- [ ] **Step 2: Follow the compiler**

Run: `just typecheck`
Expected errors at every remaining `clickable` site; fix each:

- `web/scripts/perf-reachability.ts`: in `Step`, rename `clickable: number` to `reachable: number`; the assignment becomes `reachable: lastView.reachableStars.size`; the three log lines print `reachable ${...}` instead of `clickable ${...}`.
- `web/scripts/reachability-fuzz.ts`: `kind: "completable" | "clickable"` becomes `kind: "completable" | "first-star"`; the check at line ~74 becomes `!view.reachableStars.has(first)` pushing `kind: "first-star"`; update the doc comment ("its first star must be reachable").
- Test mocks from Task 2 (rules-toggle, rules-constellation, commit-action, displayState, svgRenderer, i18nCharacterization): delete the `clickable:` line from each literal.
- `web/test/reachability.test.ts`: line ~113 delete the `clickable` comparison (keep `reachableStars`); in the test at ~258, replace the two `view.clickable` assertions with `expect(view.reachableStars.has("Anvil:0")).toBe(true);` and `expect(view.reachableStars.has("Anvil:1")).toBe(false); // 5 + 2 = 7 > 6, over budget`; in the skipped test at ~332, change `view.clickable.size` to `view.reachableStars.size`.

Run: `just typecheck` until clean, then `grep -rn "\.clickable" web/src web/scripts web/test` - the only hits must be the `StarDisplay.clickable` field (`displayState.ts`, `svgRenderer.ts:318`, `displayState.test.ts`).

- [ ] **Step 3: Run the full suite and the fuzz gate**

Run: `just test` - Expected: PASS.
Run: `just fuzz --seeds 50` - Expected: 0 violations.
Run: `just validate-wasm` - Expected: verdict-equivalent (the resolver is untouched; this guards the callers).

- [ ] **Step 4: Commit**

```bash
git add web/src web/scripts web/test
git commit -m "refactor(reach): remove the clickable frontier signal - reachableStars subsumes it

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Perf fixtures and measurement

The maxK searches add near-budget classify calls. The coarse CI guard gets the two reference states; the fine measurement is a manual before/after `just perf` comparison (agreed bar: same order of magnitude, p95 ~19ms today, no click over 400ms).

**Files:**
- Modify: `web/test/reachability-perf-guard.test.ts` (the `TED_STATES` array, line ~32)

- [ ] **Step 1: Add the reference states to the coarse guard**

In `web/test/reachability-perf-guard.test.ts`, append to `TED_STATES` with a comment:

```ts
  // Partial-constellation reachability states: 4 spare points with Korvaak and Tortoise enterable but
  // not completable - the maxK binary searches run on exactly these near-budget sweeps.
  "#p=55&s=AAAAAAEHAAAAOAAAOAA8PAA8APgHAAB4AHwAAAAAAAAAAAAAAAAAAAB8AAAAAAAAAAAAAAAAAAAAAAAAAADAHw",
  "#p=55&s=AAAAAAEHAAAAOAAAOAA8PAA8APgHAAB4AHwAAAAAAAAAAAAAAAAAAAB8AAAAAAAAAAAAAAAAAAAAAOACAADAHw",
```

Run: `just test test/reachability-perf-guard.test.ts`
Expected: PASS well under the 1500ms bound. If a state exceeds it, stop and investigate before proceeding (the budget-shift fallback in the spec is the documented lever).

- [ ] **Step 2: Measure the per-click distribution before/after**

```bash
git stash              # measure the pre-feature baseline
just perf --ts
git stash pop
just perf --ts
```

(Use `--ts` so both runs measure the TS core; the WASM resolver is unchanged. If `data/reach.wasm` is built, also run plain `just perf` after.) Record mean/median/p95/p99/max from both runs in the commit message. Acceptance: p95 the same order of magnitude as the baseline and no click over 400ms. If it regresses beyond that, implement the budget-shift dedup described in the spec's "Why the engine is already close" fallback paragraph before merging.

- [ ] **Step 3: Run the remaining regression gates**

```bash
just test-slow      # metamorphic downward-closure walk
just fuzz --seeds 200
just validate-wasm
```

Expected: all pass / 0 violations.

- [ ] **Step 4: Commit**

```bash
git add web/test/reachability-perf-guard.test.ts
git commit -m "perf(reach): guard the partial-constellation sweep states; before/after distribution in message

<paste the two just perf summary lines here>

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Living-doc updates

The reference docs describe the system as it is now; rewrite the superseded parts in place (no changelog sections).

**Files:**
- Modify: `docs/display-model.md`
- Modify: `docs/reachability-engine.md`

- [ ] **Step 1: Update `docs/display-model.md`**

- In "Brightness: Attainability", replace the intro line with: `Sourced from the ReachView (completable per constellation, reachableStars per star) with no changes to the resolver beneath the reachability engine.`
- Replace the "Stars" subsection bullets with:

```markdown
- **Active**: selected.
- **Attainable**: in `reachableStars` - the star plus its unselected predecessors fits the remaining
  budget. This covers every unselected star of a completable constellation and the in-reach stars of
  a partially enterable one (a constellation too expensive to finish can still light the stars whose
  path fits, computed exactly by the engine's per-constellation maxK search).
- **Unattainable**: otherwise.
```

- Delete the paragraph "This approximation deliberately avoids computing true deep-star attainability, which would require a per-star resolver run." (it is no longer true).
- Replace the "Edges" subsection bullets with:

```markdown
- **Active**: both endpoints selected (taken).
- **Attainable**: the deeper endpoint is selected or in `reachableStars` (its path contains the
  shallower endpoint, so the whole edge sits on a reachable path).
- **Unattainable**: otherwise. Edge brightness is endpoint-level, so the lit path through a dimmed
  constellation reads star-to-star while the constellation art stays dim.
```

- In "What Did Not Change", update the second bullet to: `The reachability resolver and its performance path. The ReachView gained reachableStars (per-star attainability) and dropped the frontier-only clickable signal.`

- [ ] **Step 2: Update `docs/reachability-engine.md`**

After the "How a verdict is decided" section, add:

```markdown
## The per-selection sweep

`reachabilityForSelection` emits the per-element signals one UI refresh needs:

- `completable` (per constellation): classify "selection + the whole constellation".
- `reachableStars` (per star): every unselected star whose path (the star plus its unselected
  predecessors) keeps the selection reachable. For a completable constellation that is all its
  unselected stars. For one that is enterable but not completable, the engine finds `maxK`, the
  largest per-constellation star count that still classifies reachable, by binary search over the
  count (at most 3 classify calls for an 8-star constellation): the verdict depends only on the
  count (selectionSummary reduces selections to counts) and is monotone in it (a bigger proper
  prefix costs more and grants nothing until complete). A star is reachable iff its path keeps the
  count at or under `maxK`. This is what lights a 4-point path to a celestial power inside a
  constellation too expensive to finish.
```

- [ ] **Step 3: Verify doc rules and commit**

Run: `grep -n '—\|–' docs/display-model.md docs/reachability-engine.md` - Expected: no matches.

```bash
git add docs/display-model.md docs/reachability-engine.md
git commit -m "docs: display model and reachability engine reflect the reachableStars signal

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

```bash
just check          # format, full tests, lint, typecheck (the CI gate)
just test-slow
just fuzz --seeds 200
just validate-wasm
just perf           # confirm the deployed-path distribution one more time
just e2e            # headless smoke (run `just install-e2e` once first if needed)
```

Then load the two reference URLs in `just serve` and re-verify the Task 7 Step 5 walkthrough by hand, plus one build-order check: at the HASH_55 state the right panel's build order ends with a `Korvaak, the Eldritch Sun (4/6)` step showing `+4` points.
