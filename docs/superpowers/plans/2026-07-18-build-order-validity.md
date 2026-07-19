# Build Order Validity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The build-order panel emits only orders that are legal in-game at every step (adds and refunds), guarded by an independent legality oracle, a seeded regression net, and a verified-or-absent production gate.

**Architecture:** A new pure core module `orderLegality.ts` holds the oracle (promoted from the transition spike) and the gate. `buildOrderPath` in `reachability.ts` gets two fixes: canonicalized member input (output depends on the build set, not caller array order) and dependency-order refund draining (a scaffold is refunded only when nothing standing is stranded; unsafe refunds carry forward; an undrainable schedule returns null). `selectionView` renders only oracle-verified orders.

**Tech Stack:** TypeScript, Bun (bun test), just recipes. No new dependencies.

**Spec:** docs/superpowers/specs/2026-07-18-build-order-validity-design.md

## Global Constraints

- Branch `build-order-validity`. Never push; Ted pushes.
- The owner's bar, verbatim from the spec: "the build order must be valid at every step, and no order is better than an illegal order."
- Verified or absent: the panel renders only orders that passed the oracle; a failing order is withheld and the existing honest empty state (`NoOrderInfo`) shows instead. No new user-facing strings, no catalog changes.
- Oracle independence: `web/src/core/orderLegality.ts` imports ONLY types from `reachability.ts` (`import type`), never engine helpers. It re-derives validity from scratch.
- Canonical contract: same build set, any member order, any call site: identical output.
- Reachability semantics untouched: no change to which selections are reachable/dimmed. Legality-driven honest nulls (an order withheld rather than emitted illegally) are the one permitted behavior change.
- Every new code file starts with two `// ABOUTME:` comment lines.
- Docs: no emojis, no emdashes, no hyperbole. Living docs are rewritten in place, never appended with dated updates.
- Use `just` recipes (`just check`, `just test`, `just fuzz`, `just perf`, `just e2e`). The pre-commit hook runs the full gate (format, full `bun test`, lint, typecheck), so a red test can never be committed: within a task, verify red locally, then implement, then commit only when green.
- Determinism everywhere: pinned seeds only, no `Date.now()`/`Math.random()` in tests, scripts, or engine paths.

## File Structure

- Create `web/src/core/orderLegality.ts` - the independent legality oracle (`verifyBuildOrder`) and the verified-or-absent gate (`gateBuildOrder`).
- Create `web/test/order-legality.test.ts` - oracle unit tests on synthetic constellations.
- Create `web/test/build-order-oracle.test.ts` - the regression net: seeded panel-path sweep, the live reproduction URL, the selectionView gate check.
- Create `web/scripts/hunt-tight-cap.ts` and (generated) `web/test/fixtures/tight-cap-builds.json` - the tight-cap adversarial corpus harvester and its output.
- Create `web/test/build-order-tightcap.test.ts` - tight-cap corpus guard plus `minBuildableCap` escalated-path coverage.
- Modify `web/src/core/reachability.ts` - `buildOrderPath` (canonicalize input, legal refund draining, lines 697-757) and `selectionView` (gate, lines 1119-1131).
- Modify `web/test/build-order-path.test.ts` - `replayLegal` delegates to the oracle; determinism-pinning tests.
- Modify `web/scripts/build-order-validate.ts` - its weak local `replayLegal` is replaced by the strict oracle.
- Modify `justfile` - `hunt-tight-cap` recipe.
- Modify `docs/devotion-system.md`, `docs/reachability-engine.md`, `CLAUDE.md` - the strict refund rule, the build-order contract, the invariant entry.

## Background every implementer needs

The devotion rules live in docs/devotion-system.md. The short version: a constellation activates only when its affinity requirement is already met by OTHER completed constellations' grants; its own grant appears only at completion; and (rule 5, confirmed in-game) a star cannot be refunded if doing so would drop any still-selected constellation below its requirement. The live bug: `buildOrderPath` emits scaffold-refund batches in held-array order with no stranding check, so roughly 1 in 23 builds gets a step a player physically cannot click in-game. Reproduction (live site): `#p=55&s=_38AQAIAAAAAAOAfAAAAAADAAYAHAMAHAAAAAPADPwAAAAAAPw` - step 5 says Refund Falcon while completed Berserker (requires 5 Ascendant, 5 Eldritch) still leans on Falcon's grant.

`ReachCon` is `{ id: string; size: number; req: Vec; grant: Vec }` where `Vec` is a 5-tuple of affinity amounts. `BuildStep` is `{ kind: "complete" | "scaffold-add" | "scaffold-refund"; conId: string; points: number; heldAfter: number }` (points negative on refund). `selectionSummary(model, selected).built` is the panel's member array; a partially-selected constellation appears there as a synthetic ReachCon with `size` = selected star count and a ZERO grant (it imposes its requirement but supplies nothing).

---

### Task 1: The legality oracle (core module + unit tests)

**Files:**
- Create: `web/src/core/orderLegality.ts`
- Create: `web/test/order-legality.test.ts`

**Interfaces:**
- Consumes: `import type { BuildStep, ReachCon, Vec } from "./reachability"` (types only - never runtime imports; independence is the point).
- Produces: `verifyBuildOrder(allCons: ReachCon[], target: ReachCon[], steps: BuildStep[], cap: number): string | null` (null = legal, else first violation) and `gateBuildOrder(allCons: ReachCon[], target: ReachCon[], steps: BuildStep[] | null, cap: number): BuildStep[] | null`. Tasks 2, 4, and 5 import both.

- [ ] **Step 1: Write the failing tests**

Create `web/test/order-legality.test.ts`:

```ts
// ABOUTME: Unit tests for the build-order legality oracle (core/orderLegality): hand-built schedules
// ABOUTME: exercising every rule - stranding refunds, cap, heldAfter, end state, partial members.
import { test, expect } from "bun:test";
import { verifyBuildOrder, gateBuildOrder } from "../src/core/orderLegality";
import type { BuildStep, ReachCon, Vec } from "../src/core/reachability";

const z = (): Vec => [0, 0, 0, 0, 0];
const v = (asc = 0, cha = 0, eld = 0, ord = 0, pri = 0): Vec => [asc, cha, eld, ord, pri];
const con = (id: string, size: number, req: Vec, grant: Vec): ReachCon => ({ id, size, req, grant });

const G = con("g", 1, z(), v(1)); // free granter: 1 Ascendant, no requirement
const M = con("m", 2, v(1), v(1)); // needs 1 Ascendant, grants 1 back on completion
const N = con("n", 3, v(1), z()); // needs 1 Ascendant, grants nothing
const CONS = [G, M, N];

const complete = (c: ReachCon, held: number): BuildStep => ({ kind: "complete", conId: c.id, points: c.size, heldAfter: held });
const scaffold = (c: ReachCon, held: number): BuildStep => ({ kind: "scaffold-add", conId: c.id, points: c.size, heldAfter: held });
const refund = (c: ReachCon, held: number): BuildStep => ({ kind: "scaffold-refund", conId: c.id, points: -c.size, heldAfter: held });

test("a legal scaffold/complete/refund schedule passes", () => {
  // G bootstraps M; once M stands (self-sustaining), G refunds legally.
  const steps = [scaffold(G, 1), complete(M, 3), refund(G, 2)];
  expect(verifyBuildOrder(CONS, [M], steps, 55)).toBeNull();
});

test("a refund that strands a standing dependent is illegal", () => {
  // N grants nothing back: refunding G leaves N's requirement uncovered.
  const steps = [scaffold(G, 1), complete(N, 4), refund(G, 3)];
  expect(verifyBuildOrder(CONS, [N], steps, 55)).toMatch(/mid-refund.*uncovered/);
});

test("an add whose requirement is not yet covered is illegal", () => {
  const steps = [complete(N, 3)];
  expect(verifyBuildOrder(CONS, [N], steps, 55)).toMatch(/pre-add.*uncovered/);
});

test("an add that lands over the cap is illegal", () => {
  const steps = [complete(G, 1)];
  expect(verifyBuildOrder(CONS, [G], steps, 0)).toMatch(/cap exceeded/);
});

test("a wrong heldAfter is rejected", () => {
  const steps: BuildStep[] = [{ kind: "complete", conId: "g", points: 1, heldAfter: 5 }];
  expect(verifyBuildOrder(CONS, [G], steps, 55)).toMatch(/heldAfter/);
});

test("an end state that does not equal the target is rejected", () => {
  expect(verifyBuildOrder(CONS, [M], [complete(G, 1)], 55)).toMatch(/end state/);
});

test("refunding a constellation that is not standing is rejected", () => {
  expect(verifyBuildOrder(CONS, [G], [refund(G, -1)], 55)).toMatch(/not standing/);
});

test("an unknown constellation id is rejected", () => {
  const steps: BuildStep[] = [{ kind: "complete", conId: "nope", points: 1, heldAfter: 1 }];
  expect(verifyBuildOrder(CONS, [G], steps, 55)).toMatch(/unknown/);
});

test("target members override allCons lookups (the panel's synthetic partials)", () => {
  // The real "p" is a 5-star granter; the panel models a 2-star partial of it as size 2, zero grant.
  const fullP = con("p", 5, v(1), v(0, 0, 3));
  const partialP = con("p", 2, v(1), z());
  const steps = [scaffold(G, 1), { kind: "complete", conId: "p", points: 2, heldAfter: 3 } as BuildStep];
  // Judged at the partial's size (2 points) and with its zero grant; G must stay to cover p's req.
  expect(verifyBuildOrder([G, fullP], [G, partialP], steps, 55)).toBeNull();
});

test("gateBuildOrder passes a legal order through, nulls an illegal or absent one", () => {
  const legal = [scaffold(G, 1), complete(M, 3), refund(G, 2)];
  const illegal = [scaffold(G, 1), complete(N, 4), refund(G, 3)];
  expect(gateBuildOrder(CONS, [M], legal, 55)).toBe(legal);
  expect(gateBuildOrder(CONS, [N], illegal, 55)).toBeNull();
  expect(gateBuildOrder(CONS, [M], null, 55)).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && bun test test/order-legality.test.ts`
Expected: FAIL - cannot resolve `../src/core/orderLegality`.

- [ ] **Step 3: Implement the oracle**

Create `web/src/core/orderLegality.ts`:

```ts
// ABOUTME: Independent legality oracle for guided build orders: replays a BuildStep schedule from an
// ABOUTME: empty board and enforces the in-game rules at every step (the verified-or-absent gate).
import type { BuildStep, ReachCon, Vec } from "./reachability";

const CAP_MAX: Vec = [20, 8, 20, 10, 20];
const zero = (): Vec => [0, 0, 0, 0, 0];
const addCap = (g: Vec, x: Vec): Vec => g.map((n, i) => Math.min(n + x[i]!, CAP_MAX[i]!)) as Vec;
const maxV = (a: Vec, b: Vec): Vec => a.map((n, i) => Math.max(n, b[i]!)) as Vec;
const covers = (g: Vec, d: Vec): boolean => g.every((n, i) => n >= d[i]!);

/**
 * Replay `steps` from an empty board; null when every step is legal in-game, else a description of the
 * first violation. Deliberately independent of the engine that produced the schedule: type-only imports,
 * no shared helpers, validity re-derived from scratch at every step. Rules enforced, at the conservative
 * mid-step point (a step's requirement stands at its first star, its grant only at completion; a refund
 * loses the grant at the first refunded star while the requirement stands until zero):
 *  - every standing constellation's requirement is covered by standing completed grants (the in-game
 *    "removal cannot strand a dependent" rule, docs/devotion-system.md, the refunded one included);
 *  - an add lands at or under `cap`, and `heldAfter` matches the running total at every step;
 *  - the end state is exactly `target`.
 * `target` members take precedence over `allCons` in lookups so the panel's synthetic partial members
 * (selected-star size, zero grant) are judged at their real standing size.
 */
export function verifyBuildOrder(
  allCons: ReachCon[],
  target: ReachCon[],
  steps: BuildStep[],
  cap: number,
): string | null {
  const conOf = new Map(allCons.map((c) => [c.id, c]));
  for (const t of target) conOf.set(t.id, t);
  const standing = new Set<string>();
  let running = 0;
  // Standing-state validity; `pending` is a constellation whose requirement must count but whose
  // grant must not (the conservative mid-step point).
  const check = (label: string, pending: string | null): string | null => {
    let grant = zero();
    let req = zero();
    for (const id of standing) {
      const c = conOf.get(id)!;
      req = maxV(req, c.req);
      if (id !== pending) grant = addCap(grant, c.grant);
    }
    if (pending && !standing.has(pending)) req = maxV(req, conOf.get(pending)!.req);
    return covers(grant, req) ? null : `${label}: requirement uncovered`;
  };
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    const c = conOf.get(s.conId);
    if (!c) return `step ${i}: unknown constellation ${s.conId}`;
    if (s.kind === "scaffold-refund") {
      if (!standing.has(s.conId)) return `step ${i} (${s.conId}): refund of a constellation not standing`;
      if (s.points !== -c.size) return `step ${i} (${s.conId}): refund points ${s.points}, expected ${-c.size}`;
      const mid = check(`step ${i} (${s.conId}) mid-refund`, s.conId);
      if (mid) return mid;
      standing.delete(s.conId);
      running -= c.size;
      const end = check(`step ${i} (${s.conId}) post-refund`, null);
      if (end) return end;
    } else {
      if (standing.has(s.conId)) return `step ${i} (${s.conId}): added while already standing`;
      if (s.points !== c.size) return `step ${i} (${s.conId}): add points ${s.points}, expected ${c.size}`;
      const mid = check(`step ${i} (${s.conId}) pre-add`, s.conId);
      if (mid) return mid;
      standing.add(s.conId);
      running += c.size;
      if (running > cap) return `step ${i} (${s.conId}): cap exceeded (${running} > ${cap})`;
      const end = check(`step ${i} (${s.conId}) post-add`, null);
      if (end) return end;
    }
    if (s.heldAfter !== running) return `step ${i} (${s.conId}): heldAfter=${s.heldAfter}, running total is ${running}`;
  }
  const want = new Set(target.map((c) => c.id));
  if (want.size !== standing.size) return `end state: ${standing.size} standing, ${want.size} wanted`;
  for (const id of want) if (!standing.has(id)) return `end state: ${id} missing`;
  return null;
}

/** The verified-or-absent gate: pass a schedule through only when the oracle proves it legal. */
export function gateBuildOrder(
  allCons: ReachCon[],
  target: ReachCon[],
  steps: BuildStep[] | null,
  cap: number,
): BuildStep[] | null {
  return steps && verifyBuildOrder(allCons, target, steps, cap) === null ? steps : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && bun test test/order-legality.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/tednaleid/Library/CloudStorage/Dropbox/code/grimdawn-devotions
git add web/src/core/orderLegality.ts web/test/order-legality.test.ts
git commit -m "feat(order): independent build-order legality oracle and verified-or-absent gate"
```

---

### Task 2: Legal refund draining (red regression net first, then the fix)

**Files:**
- Create: `web/test/build-order-oracle.test.ts`
- Modify: `web/src/core/reachability.ts:697-757` (`buildOrderPath` body)
- Modify: `web/test/build-order-path.test.ts:30-65` (`replayLegal` delegates to the oracle)
- Modify: `web/scripts/build-order-validate.ts` (strict oracle replaces its local `replayLegal`)

**Interfaces:**
- Consumes: `verifyBuildOrder` from Task 1. Existing exports: `buildOrderPath`, `selectionSummary`, `BUDGET` (= 55) from `web/src/core/reachability.ts`; `model`, `cons`, `table`, `generateValidBuild`, `mulberry32` from `web/scripts/reachability-fuzz.ts`; `decodeHash(hash, canonical)` (returns `{ selected: Set<string>, ... } | null`) and `canonicalStarIds(model)` from `web/src/core/urlState.ts`.
- Produces: `buildOrderPath` whose every emitted refund is legal (or an honest null). Signature unchanged.

IMPORTANT: the red tests in Step 1 CANNOT be committed on their own - the pre-commit hook runs the full test suite. Verify red locally, then implement Steps 3-5, and commit everything together once green.

- [ ] **Step 1: Write the failing regression net**

Create `web/test/build-order-oracle.test.ts`:

```ts
// ABOUTME: The build-order regression net: every order the panel-path search emits for seeded valid
// ABOUTME: builds (and the live-site reproduction URL) must pass the independent legality oracle.
import { test, expect } from "bun:test";
import { buildOrderPath, selectionSummary, BUDGET } from "../src/core/reachability";
import { verifyBuildOrder } from "../src/core/orderLegality";
import { model, cons, table, generateValidBuild, mulberry32 } from "../scripts/reachability-fuzz";
import { canonicalStarIds, decodeHash } from "../src/core/urlState";

const SEEDS = 150; // pinned: a deterministic corpus, identical on every run

test("seeded panel-path orders all pass the legality oracle", () => {
  let orders = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const B = generateValidBuild(mulberry32(seed));
    const selected = new Set<string>();
    for (const m of B) for (const sid of model.constellations.get(m.id)!.starIds) selected.add(sid);
    const members = selectionSummary(model, selected).built; // the panel's exact member path
    const steps = buildOrderPath(cons, table, members, BUDGET, 16);
    if (!steps) continue; // an honest null is legal; the oracle judges only emitted orders
    const err = verifyBuildOrder(cons, members, steps, BUDGET);
    if (err) console.error(`seed ${seed}: ${err}`);
    expect(err).toBeNull();
    orders++;
  }
  expect(orders).toBeGreaterThan(SEEDS / 2); // the net must actually be judging orders
});

// The live-site illegal-refund reproduction found by the project owner: the panel's step 5 said
// "Refund Falcon" while completed Berserker (5 Ascendant / 5 Eldritch) still leaned on Falcon's grant.
const REPRO_HASH = "p=55&s=_38AQAIAAAAAAOAfAAAAAADAAYAHAMAHAAAAAPADPwAAAAAAPw";

test("the reproduction URL gets a legal order end to end", () => {
  const decoded = decodeHash(REPRO_HASH, canonicalStarIds(model));
  expect(decoded).not.toBeNull();
  const members = selectionSummary(model, decoded!.selected).built;
  const steps = buildOrderPath(cons, table, members, 55, 16);
  expect(steps).not.toBeNull();
  const err = verifyBuildOrder(cons, members, steps!, 55);
  if (err) console.error(err);
  expect(err).toBeNull();
});
```

- [ ] **Step 2: Run the net to verify it fails (the bug, reproduced)**

Run: `cd web && bun test test/build-order-oracle.test.ts`
Expected: BOTH tests FAIL with `mid-refund: requirement uncovered` violations (the seeded sweep at roughly the measured 1-in-23 rate; the URL test at the Falcon refund). Record the first failing seed and the exact violation strings in the task report. If the URL test happens to pass, STOP and report - that means the panel path changed and the reproduction must be re-verified, not papered over.

- [ ] **Step 3: Implement legal refund draining in buildOrderPath**

In `web/src/core/reachability.ts`, replace the whole `buildOrderPath` function (currently lines 697-757, immediately after the `BuildStep` type) and its doc comment with:

```ts
/**
 * A legal constellation-level order that assembles the self-covering build `B` within `budget` points
 * held at once, including the transient scaffold to ADD before a step and REFUND once the build's own
 * grants cover it. Replays the sampled construction order (sampledConstruction) and, at each step, asks
 * peakToReach for the actual scaffold SET to hold (crossroads-biased), diffing consecutive sets into
 * add/refund events. Refunds obey the in-game rule (docs/devotion-system.md, "removal cannot strand a
 * dependent"): a scaffold is refunded only when everything still standing keeps its requirement covered
 * without it; refunds not yet safe stay held and are retried after later adds. Returns null when no
 * sampled order fits the budget, or when a held scaffold can never be legally refunded - the honest
 * "not validly buildable" signal. No order is better than an illegal order.
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
  let mreq: Vec = zero(); // max requirement incl. the member being placed (drives the scaffold need-set)
  let creq: Vec = zero(); // max requirement over COMPLETED members only (drives refund legality)
  let held: ReachCon[] = [];
  let running = 0;
  // In-game refund rule: a scaffold may be refunded only if everything still standing (completed
  // members plus the other held scaffolds) keeps its requirement covered without the scaffold's grant.
  const canRefund = (s: ReachCon, keep: ReachCon[]): boolean => {
    let g = grant;
    let r = maxV(creq, s.req);
    for (const k of keep) {
      g = addCap(g, k.grant);
      r = maxV(r, k.req);
    }
    return covers(g, r);
  };
  // Refund every held scaffold outside `needIds` that is safe to drop; unsafe ones stay held and are
  // retried after later adds supply replacement grants. Fixed point: one refund can unlock another.
  const drainRefunds = (needIds: Set<string>): void => {
    for (let progress = true; progress; ) {
      progress = false;
      for (const s of [...held]) {
        if (needIds.has(s.id)) continue;
        const keep = held.filter((k) => k.id !== s.id);
        if (!canRefund(s, keep)) continue;
        held = keep;
        running -= s.size;
        steps.push({ kind: "scaffold-refund", conId: s.id, points: -s.size, heldAfter: running });
        progress = true;
      }
    }
  };
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
    drainRefunds(needIds);
    const heldIds = new Set(held.map((s) => s.id));
    for (const s of need)
      if (!heldIds.has(s.id)) {
        held.push(s);
        running += s.size;
        steps.push({ kind: "scaffold-add", conId: s.id, points: s.size, heldAfter: running });
      }
    drainRefunds(needIds); // retry refunds the new scaffolds' grants may have made safe
    if (running > budget) return null; // soundness guard
    running += m.size;
    steps.push({ kind: "complete", conId: m.id, points: m.size, heldAfter: running });
    if (running > budget) return null;
    grant = addCap(grant, m.grant);
    creq = maxV(creq, m.req);
  }
  drainRefunds(new Set());
  if (held.length) return null; // a scaffold no drain can legally refund: honest null, never an illegal step
  for (const t of sc.tail) {
    running += t.size;
    steps.push({ kind: "complete", conId: t.id, points: t.size, heldAfter: running });
    if (running > budget) return null;
  }
  return steps;
}
```

Notes for the implementer: `zero`, `covers`, `addCap`, `maxV`, `INF`, `buildParts`, `peakToReach`, `sampledConstruction` all already exist in this file (module-level). The differences from the old body: `creq` tracks completed-member requirements separately from `mreq` (a not-yet-placed member's requirement must not block a refund); refunds go through `canRefund`/`drainRefunds` instead of being emitted blindly; unsafe refunds carry forward in `held`; a second drain runs after the step's adds; a final undrainable scaffold nulls the schedule. Adds are unchanged - the measured violations were 43 of 999 orders, all at refund steps, never at adds; the oracle net now guards adds too, so any future add violation fails CI.

- [ ] **Step 4: Run the net to verify it passes**

Run: `cd web && bun test test/build-order-oracle.test.ts`
Expected: PASS, both tests. The seeded sweep must report zero oracle errors.

- [ ] **Step 5: Strengthen replayLegal (test helper) and build-order-validate (harness) to the strict oracle**

In `web/test/build-order-path.test.ts`, replace the whole `replayLegal` function (lines 30-65, including its comment) with:

```ts
// Replay a schedule through the independent legality oracle (core/orderLegality): every step must be
// legal in-game, refunds included. Target = the schedule's own net end state; callers assert that set
// equals the intended build. Returns the end-state member ids.
function replayLegal(steps: BuildStep[], allCons: ReachCon[], cap: number): Set<string> {
  const cById = new Map(allCons.map((c) => [c.id, c]));
  const present = new Set<string>();
  for (const s of steps) {
    if (s.kind === "scaffold-refund") present.delete(s.conId);
    else present.add(s.conId);
  }
  const target = [...present].map((id) => cById.get(id)!);
  expect(verifyBuildOrder(allCons, target, steps, cap)).toBeNull();
  return present;
}
```

Add to the imports at the top of that file: `import { verifyBuildOrder } from "../src/core/orderLegality";`. The local `addCapV`/`coversV` helpers inside the old body disappear with it; `z()` stays (other tests use it).

In `web/scripts/build-order-validate.ts`: delete the local `replayLegal` function (lines 52-77 and its comment), add `import { verifyBuildOrder } from "../src/core/orderLegality";`, and replace its two call sites in `classify`:

```ts
  const live = buildOrderPath(cons, table, B, BUDGET, LIVE_TRIES);
  if (live && verifyBuildOrder(cons, B, live, BUDGET) !== null) {
```

and

```ts
  const esc = buildOrderPath(cons, table, B, BUDGET, ESC_TRIES);
  if (esc && verifyBuildOrder(cons, B, esc, BUDGET) !== null) {
```

Also update the file's ABOUTME header to name the strict oracle. Replace exactly these two lines:

```
// ABOUTME: each sampled selection it runs the live (tries=16) and escalated (tries=4096) search, replays any
// ABOUTME: order for legality, and on a no-witness result consults the oracle: an order the oracle proves
```

with:

```
// ABOUTME: each sampled selection it runs the live (tries=16) and escalated (tries=4096) search, checks any
// ABOUTME: order with the strict legality oracle (core/orderLegality); on no witness the cost oracle decides: an order it proves
```

(the following lines "exists but the search missed is a FALSE-NEGATIVE ..." stay unchanged).

- [ ] **Step 6: Run the full suite**

Run: `cd web && bun test`
Expected: PASS. The 152-fixture replay (`build-order-path.test.ts`) now enforces refund legality; with the drain fix in place it must stay green. If a fixture build now returns null where it used to return an order, that test tolerates it (`if (!steps) continue`) - but note any such fixture in the task report with its label.

- [ ] **Step 7: Commit**

```bash
cd /Users/tednaleid/Library/CloudStorage/Dropbox/code/grimdawn-devotions
git add web/src/core/reachability.ts web/test/build-order-oracle.test.ts web/test/build-order-path.test.ts web/scripts/build-order-validate.ts
git commit -m "fix(order): refunds drain in dependency order; no step can strand a standing constellation"
```

---

### Task 3: Canonical input (order depends on the build set, not the caller's array)

**Files:**
- Modify: `web/src/core/reachability.ts` (`buildOrderPath` entry, the function Task 2 rewrote)
- Modify: `web/test/build-order-path.test.ts` (determinism-pinning tests appended)

**Interfaces:**
- Consumes: Task 2's `buildOrderPath`. `mulberry32(seed): () => number` from `web/test/support/reach-oracle.ts`.
- Produces: `buildOrderPath` output that is a pure function of the build SET. No signature change.

- [ ] **Step 1: Write the failing tests**

Append to `web/test/build-order-path.test.ts` (add `import { mulberry32 } from "./support/reach-oracle";` to the imports):

```ts
test("buildOrderPath is canonical: any member-array order yields byte-identical steps", () => {
  const rng = mulberry32(0xc0ffee);
  let checked = 0;
  for (const c of fixture.cases.slice(0, 20)) {
    const members = membersOf(c.sel);
    if (members.length < 2) continue;
    const base = JSON.stringify(buildOrderPath(realCons, realTable, members, 55, 16));
    for (let k = 0; k < 3; k++) {
      const shuffled = [...members];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      expect(JSON.stringify(buildOrderPath(realCons, realTable, shuffled, 55, 16))).toBe(base);
    }
    checked++;
  }
  expect(checked).toBeGreaterThan(0);
});

test("buildOrderPath is byte-identical across repeated calls", () => {
  const members = membersOf(fixture.cases[0]!.sel);
  const a = JSON.stringify(buildOrderPath(realCons, realTable, members, 55, 16));
  const b = JSON.stringify(buildOrderPath(realCons, realTable, members, 55, 16));
  expect(a).toBe(b);
});
```

- [ ] **Step 2: Run to verify the canonical test fails**

Run: `cd web && bun test test/build-order-path.test.ts`
Expected: the "canonical" test FAILS (shuffled member arrays currently steer `sampledConstruction`'s stable sort and shuffle start state to different orders). The "repeated calls" test passes already (in-process determinism was never the bug).

- [ ] **Step 3: Canonicalize at buildOrderPath entry**

In `web/src/core/reachability.ts`, add as the FIRST line of the `buildOrderPath` body (before `const sc = ...`):

```ts
  B = [...B].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); // canonical: the order is a function of the build SET
```

(Plain comparison, not `localeCompare` - locale-dependent collation would break byte-identical output across environments.) Append to the function's doc comment, after the first sentence: `Input is canonicalized (sorted by constellation id), so the output is a pure function of the build set - every caller (panel, test, script) gets the identical order.`

- [ ] **Step 4: Run the full suite**

Run: `cd web && bun test`
Expected: PASS. Canonicalization changes which concrete orders the sampler finds for some builds; the oracle-backed tests judge legality, not specific step sequences, so they stay green. If anything fails, investigate before proceeding - do not weaken a test to pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/tednaleid/Library/CloudStorage/Dropbox/code/grimdawn-devotions
git add web/src/core/reachability.ts web/test/build-order-path.test.ts
git commit -m "fix(order): canonicalize buildOrderPath input; identical order for identical build set"
```

---

### Task 4: Tight-cap adversarial corpus

**Files:**
- Create: `web/scripts/hunt-tight-cap.ts`
- Create: `web/test/fixtures/tight-cap-builds.json` (generated by the script, committed)
- Create: `web/test/build-order-tightcap.test.ts`
- Modify: `justfile` (recipe after `build-order-validate`, line 346)

**Interfaces:**
- Consumes: `buildOrderPath`, `minBuildableCap(cons, table, B, fromCap, budget?, tries?)`, `BUDGET` from reachability; `verifyBuildOrder` from Task 1; `cons`, `table`, `generateValidBuild`, `mulberry32` from `web/scripts/reachability-fuzz.ts`.
- Produces: the pinned fixture file; no code interfaces consumed by later tasks.

- [ ] **Step 1: Write the harvester script**

Create `web/scripts/hunt-tight-cap.ts`:

```ts
// ABOUTME: Harvests the tight-cap adversarial build-order corpus: sweeps seeded valid builds, ranks
// ABOUTME: their live orders by construction peak (closeness to the 55 cap) and refund count, and pins
// ABOUTME: the worst offenders into web/test/fixtures/tight-cap-builds.json.
// ABOUTME: Run `just hunt-tight-cap [--seeds N] [--keep K]`. Deterministic: same flags, same file.
import { resolve } from "node:path";
import { buildOrderPath, BUDGET } from "../src/core/reachability";
import { cons, table, generateValidBuild, mulberry32 } from "./reachability-fuzz";

const argNum = (flag: string, def: number): number => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] !== undefined ? Number(process.argv[i + 1]) : def;
};
const SEEDS = argNum("--seeds", 2000);
const KEEP = argNum("--keep", 12);

interface Row { seed: number; peak: number; refunds: number; sel: Record<string, number> }
const rows: Row[] = [];
for (let seed = 1; seed <= SEEDS; seed++) {
  const B = generateValidBuild(mulberry32(seed));
  const steps = buildOrderPath(cons, table, B, BUDGET, 16);
  if (!steps) continue;
  const peak = Math.max(...steps.map((s) => s.heldAfter));
  const refunds = steps.filter((s) => s.kind === "scaffold-refund").length;
  if (!refunds) continue; // only refund-bearing orders stress the drain logic
  const sel: Record<string, number> = {};
  for (const c of B) sel[c.id] = c.size;
  rows.push({ seed, peak, refunds, sel });
}
rows.sort((a, b) => b.peak - a.peak || b.refunds - a.refunds || a.seed - b.seed);
const cases = rows.slice(0, KEEP).map((r) => ({ label: `tight-cap-s${r.seed}-peak${r.peak}-r${r.refunds}`, sel: r.sel }));
const out = resolve(import.meta.dir, "..", "test", "fixtures", "tight-cap-builds.json");
await Bun.write(out, JSON.stringify({ cases }, null, 2) + "\n");
console.log(`kept ${cases.length} of ${rows.length} refund-bearing orders (${SEEDS} seeds swept) -> ${out}`);
for (const c of cases) console.log(`  ${c.label}`);
```

- [ ] **Step 2: Add the just recipe**

In `justfile`, directly after the `build-order-validate` recipe (line 346), add:

```
# Harvest the tight-cap adversarial build-order corpus (near-cap, refund-heavy orders) into
# web/test/fixtures/tight-cap-builds.json.  e.g. just hunt-tight-cap --seeds 5000 --keep 12
hunt-tight-cap *ARGS:
    cd "{{justfile_directory()}}/web" && bun scripts/hunt-tight-cap.ts {{ARGS}}
```

- [ ] **Step 3: Run the harvest**

Run: `just hunt-tight-cap`
Expected: prints `kept 12 of ...` and 12 labels with peaks at or near 55, then writes `web/test/fixtures/tight-cap-builds.json`. Inspect the file: 12 cases, labels like `tight-cap-s123-peak55-r4`. If every peak is far below 55, raise the sweep (`just hunt-tight-cap --seeds 5000`) and report the distribution.

- [ ] **Step 4: Write the corpus guard test**

Create `web/test/build-order-tightcap.test.ts`:

```ts
// ABOUTME: Tight-cap adversarial corpus guard: near-cap, refund-heavy builds pinned by
// ABOUTME: scripts/hunt-tight-cap.ts must always get an oracle-legal order; minBuildableCap too.
import { test, expect } from "bun:test";
import { buildOrderPath, minBuildableCap, buildReachCons, buildCoverTable } from "../src/core/reachability";
import { verifyBuildOrder } from "../src/core/orderLegality";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import fixtureJson from "./fixtures/tight-cap-builds.json";

const fixture = fixtureJson as unknown as { cases: { label: string; sel: Record<string, number> }[] };
const model = buildModel(doc as any);
const cons = buildReachCons(model);
const table = buildCoverTable(cons);
const byId = new Map(cons.map((c) => [c.id, c]));
const membersOf = (sel: Record<string, number>) => Object.keys(sel).map((id) => byId.get(id)!);

test("tight-cap corpus: every pinned build gets an oracle-legal order at 55", () => {
  expect(fixture.cases.length).toBeGreaterThan(0);
  for (const c of fixture.cases) {
    const members = membersOf(c.sel);
    const steps = buildOrderPath(cons, table, members, 55, 16);
    expect(steps).not.toBeNull();
    const err = verifyBuildOrder(cons, members, steps!, 55);
    if (err) console.error(`${c.label}: ${err}`);
    expect(err).toBeNull();
  }
});

test("minBuildableCap's reported cap replays legally (escalated-path coverage)", () => {
  const members = membersOf(fixture.cases[0]!.sel);
  const size = members.reduce((n, c) => n + c.size, 0);
  const cap = minBuildableCap(cons, table, members, size);
  expect(cap).not.toBeNull();
  const steps = buildOrderPath(cons, table, members, cap!, 256);
  expect(steps).not.toBeNull();
  const err = verifyBuildOrder(cons, members, steps!, cap!);
  if (err) console.error(err);
  expect(err).toBeNull();
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && bun test test/build-order-tightcap.test.ts`
Expected: PASS. (These are guards over already-fixed behavior, so they are born green; their value is drift protection. If either fails, the drain fix has a hole - report it, do not adjust the corpus.)

- [ ] **Step 6: Commit**

```bash
cd /Users/tednaleid/Library/CloudStorage/Dropbox/code/grimdawn-devotions
git add web/scripts/hunt-tight-cap.ts web/test/fixtures/tight-cap-builds.json web/test/build-order-tightcap.test.ts justfile
git commit -m "test(order): tight-cap adversarial corpus, harvester, and minBuildableCap coverage"
```

---

### Task 5: Verified or absent (the selectionView gate)

**Files:**
- Modify: `web/src/core/reachability.ts:1119-1131` (`selectionView`)
- Modify: `web/test/build-order-oracle.test.ts` (gate wiring test appended)

**Interfaces:**
- Consumes: `gateBuildOrder` from Task 1; `selectionView(model, cons, table, selected, cap)` returning `{ minCost, reach, buildOrder }`.
- Produces: `selectionView.buildOrder` that is null unless the oracle passed it. No signature change; `web/src/app/main.ts` needs no edits (a null `buildOrder` already renders the existing `NoOrderInfo` empty states).

- [ ] **Step 1: Write the failing test**

Append to `web/test/build-order-oracle.test.ts` (add `selectionView` to the reachability import; `REPRO_HASH` is already defined above):

```ts
test("selectionView's rendered order is gated: verified or absent", () => {
  const decoded = decodeHash(REPRO_HASH, canonicalStarIds(model));
  const view = selectionView(model, cons, table, decoded!.selected, 55);
  expect(view.buildOrder).not.toBeNull();
  const members = selectionSummary(model, decoded!.selected).built;
  expect(verifyBuildOrder(cons, members, view.buildOrder!, 55)).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && bun test test/build-order-oracle.test.ts`
Expected: this new test PASSES on the assertion values (the fix already produces legal orders) but the point of the task is the structural gate. Verify the test is red first by its import: it will FAIL to compile only if `selectionView` was not exported - it is, so expect this test to pass immediately. That is acceptable here: the gate is structural insurance whose trip-path is unit-tested in Task 1 (`gateBuildOrder` nulls an illegal order); this test pins the wiring. Note this in the task report rather than manufacturing a fake red.

- [ ] **Step 3: Wire the gate into selectionView**

In `web/src/core/reachability.ts`, add a new import line directly after the existing line 6 (`import { AFFINITIES, type DevotionModel, type StarId } from "./types";`):

```ts
import { gateBuildOrder } from "./orderLegality";
```

(No cycle at runtime: `orderLegality.ts` imports only types from this file.) Then in `selectionView` replace:

```ts
  const members = selectionSummary(model, selected).built;
  const buildOrder = members.length ? buildOrderPath(cons, table, members, cap, 16) : null;
  return { minCost, reach, buildOrder };
```

with:

```ts
  const members = selectionSummary(model, selected).built;
  const raw = members.length ? buildOrderPath(cons, table, members, cap, 16) : null;
  // Verified or absent: render only orders the independent oracle proves legal at every step;
  // anything else is withheld and the panel shows its honest empty state instead.
  const buildOrder = gateBuildOrder(cons, members, raw, cap);
  return { minCost, reach, buildOrder };
```

Also update the `SelectionView` interface comment on `buildOrder` (line 1108) from `// live (tries=16) constellation-level order to assemble the selection, or null` to `// live (tries=16) oracle-verified order to assemble the selection, or null (verified or absent)`.

- [ ] **Step 4: Run the full suite and the perf guard**

Run: `cd web && bun test`
Expected: PASS, including `reachability-perf-guard.test.ts` (the gate adds one linear sub-millisecond replay per click).

- [ ] **Step 5: Commit**

```bash
cd /Users/tednaleid/Library/CloudStorage/Dropbox/code/grimdawn-devotions
git add web/src/core/reachability.ts web/test/build-order-oracle.test.ts
git commit -m "feat(order): selectionView renders only oracle-verified build orders"
```

---

### Task 6: Living docs and the acceptance sweep

**Files:**
- Modify: `docs/devotion-system.md` (rule 5, lines 92-94)
- Modify: `docs/reachability-engine.md` (new section before "## Verifying after a resolver change")
- Modify: `CLAUDE.md` (new invariant section after the Internationalization section)

**Interfaces:** none (docs only), plus the full verification sweep.

- [ ] **Step 1: Sharpen the refund rule in devotion-system.md**

Replace rule 5 (lines 92-94):

```markdown
5. **Removal cannot strand a dependent.** You may remove (refund) any star, but not
   if doing so would drop a still-selected constellation below its affinity
   requirement. The game keeps every selected constellation valid at all times.
```

with:

```markdown
5. **Removal cannot strand a dependent.** You may remove (refund) any star, but not
   if doing so would drop a still-selected constellation below its affinity
   requirement. The rule is strict (confirmed in-game): it protects every
   constellation with at least one selected star, including the one being refunded
   mid-teardown, and the game blocks the refund rather than allowing a temporarily
   invalid state. The game keeps every selected constellation valid at all times.
```

- [ ] **Step 2: Add the build-order contract to reachability-engine.md**

Insert a new section immediately before `## Verifying after a resolver change`:

```markdown
## The guided build order: legal at every step, verified or absent

`buildOrderPath` (web/src/core/reachability.ts) turns a self-covering selection
into a step-by-step construction schedule: complete the members in a sampled
peak-minimizing order, adding transient scaffold constellations before the steps
that need them and refunding scaffolds once the build's own grants cover them.
Its contract:

- **Canonical input.** The member array is sorted by constellation id at entry,
  so the output is a pure function of the build set. Panel, tests, and scripts
  get the identical order for the identical selection.
- **Legal at every step.** Every emitted step obeys the in-game rules, refunds
  included: a scaffold is refunded only when everything still standing keeps its
  requirement covered without it (docs/devotion-system.md, "Removal cannot
  strand a dependent"). Refunds not yet safe stay held and are retried after
  later adds; a schedule whose scaffolds can never be legally refunded returns
  null instead of emitting an illegal step.
- **Verified or absent.** An independent oracle (`verifyBuildOrder` in
  web/src/core/orderLegality.ts) replays every schedule from an empty board and
  re-derives validity at each step with no shared engine code. `selectionView`
  renders only orders the oracle proves legal; anything else is withheld and the
  panel shows its honest empty state. No order is better than an illegal order.

The regression net: oracle unit tests (web/test/order-legality.test.ts), the
real-build fixture replay and determinism pins (web/test/build-order-path.test.ts),
a seeded 150-build panel-path sweep plus the live-site reproduction URL
(web/test/build-order-oracle.test.ts), the tight-cap adversarial corpus
(web/test/build-order-tightcap.test.ts, harvested by `just hunt-tight-cap`), and
the offline harness `just build-order-validate`, whose illegal-path count must
stay zero.
```

- [ ] **Step 3: Add the invariant to CLAUDE.md**

After the Internationalization section, add:

```markdown
## Build order is verified (invariant we maintain)

The build-order panel renders only schedules proven legal at every step (adds
and refunds, per the in-game rules in docs/devotion-system.md) by the
independent oracle in `web/src/core/orderLegality.ts`. `selectionView` withholds
anything the oracle rejects and the panel shows its honest empty state instead:
no order is better than an illegal order. Keep `buildOrderPath` a pure function
of the build set (canonicalized input), and keep the oracle free of engine
helpers so it stays an independent check.
```

- [ ] **Step 4: Run the full acceptance sweep**

```bash
just check
just fuzz --seeds 50
just build-order-validate --seeds 500 --subsets 300
just perf
just e2e
```

Expected: `just check` green (fmt, full test suite, lint, typecheck). `just fuzz` reports zero violations. `just build-order-validate` reports `FALSE-POSITIVE (illegal path): 0` in every group (this line is now backed by the strict oracle, so it finally means what it says); record the false-negative percentages in the task report for comparison, small movement is expected since legality-driven nulls shift categories. `just perf` shows no per-click regression (record the numbers). `just e2e` green.

- [ ] **Step 5: Commit**

```bash
cd /Users/tednaleid/Library/CloudStorage/Dropbox/code/grimdawn-devotions
git add docs/devotion-system.md docs/reachability-engine.md CLAUDE.md
git commit -m "docs: the strict refund rule, the build-order contract, and the verified-or-absent invariant"
```

---

## Acceptance (from the spec)

- The owner's reproduction URL renders a legal order end to end (Task 2's fixture test, permanent).
- CI replays seeded panel-path orders through the oracle at zero failures (Task 2's sweep, permanent).
- Same build set, any member order, any call site: identical output (Task 3's pins).
- `just check`, `just fuzz`, perf guard green; `just perf` confirms no per-click regression (Task 6).
