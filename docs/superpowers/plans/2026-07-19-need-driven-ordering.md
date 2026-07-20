# Need-Driven Build Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build orders bootstrap from the build's own members (crossroads-only scaffolding in the common case) instead of arbitrary sampled orders, with a measured launch gate: definitively better or not merged, and never anything invalid.

**Architecture:** A pure greedy order generator (`needDrivenOrder`) picks each next member from those activatable by what already stands plus a refundable crossroads seed; the existing emission loop is extracted verbatim into a shared `emitSchedule` used by both the greedy-first path and the untouched sampler fallback. Quality (scaffold churn, step count) gets metrics, a before/after comparison tool, and aggregate CI pins.

**Tech Stack:** TypeScript (bun), bun:test, just recipes. Spec: `docs/superpowers/specs/2026-07-19-need-driven-ordering-design.md`.

**Spec deviation (deliberate, minor):** the spec sketches `needDrivenOrder(cons, table, B)`; the implementation drops the unused `table` parameter because the greedy never consults the cover table (an unused parameter fails lint). No behavior difference.

## Global Constraints

- **Witness boundary (never touch):** `sampledConstruction`, `minPeakSampled`, `minPeakSampledOrder`, `orderPeak`, `peakToReach`, and the classify/dimming path in `web/src/core/reachability.ts` must not change in any way. The sampler is the engine's reachability witness.
- **Oracle independence:** `web/src/core/orderLegality.ts` must not change at all.
- **Extraction, not rewrite:** `emitSchedule` is the existing emission loop moved verbatim (canRefund, drainRefunds, cap guards, push order all unmodified).
- **Public contract unchanged:** `buildOrderPath(cons, table, B, budget = BUDGET, tries = 16, peakNodeCap = 3000): BuildStep[] | null`; canonicalized input (sorted by id at entry); honest null; deterministic (same build set, any member order, any call site, byte-identical output — guarded by `web/test/build-order-path.test.ts`).
- **Launch gate (spec, hard):** aggregate scaffold churn strictly lower than baseline; aggregate steps no higher; zero orders lost (every build with an order on main still has one); reproduction URL at crossroads-only scaffolding and low-twenties steps (down from 35). Failing any line means the branch does not merge.
- **Validity bar (spec, hard):** every displayed order still flows through `gateBuildOrder`; the seeded oracle sweep, tight-cap fixtures, and panel-agreement tests must show zero failures against the greedy's output.
- **Churn definition:** points of `scaffold-add` steps whose `conId` does not start with `"crossroads_"`. Crossroads bootstrapping is free by definition (the objective's "zero when the build can bootstrap from crossroads alone").
- No UI, URL-state, or i18n changes; no new user-facing strings.
- All new files start with two `ABOUTME:` comment lines. Docs: no emojis, emdashes, or hyperbole.
- Run tests via `just` from the repo root (`just test`, `just test test/<file>`). Commit from the repo root with `git commit -F - <<'EOF'` heredoc; never `--no-verify`. The pre-commit hook runs the full gate (`just check`, 1-3 min).
- Measurement artifacts (baseline/after CSVs, harness output) go in `.superpowers/sdd/` (gitignored). Headline numbers additionally go in the task report so they survive.

## Pre-existing test landscape (read before Task 4)

- `web/test/build-order-path.test.ts:131` "the confirmed false-reach build has no order within 55" is backed by an exact-oracle proof (min peak 56). It MUST stay null under the greedy: emission enforces the cap, so no order can be emitted. If this test fails, the wiring is buggy — stop and investigate; do not update the test.
- `web/test/build-order-popup.test.ts`, `web/test/build-order-oracle.test.ts`, `web/test/build-order-tightcap.test.ts`, and `web/e2e/smoke.ts` are order-agnostic (they search by step kind and assert legality/shape, not specific sequences). They should stay green when the repro URL's order changes. One contingency is spelled out in Task 4 Step 4.
- `web/test/build-order.test.ts` and `web/test/reach-peakcost.test.ts` exercise `minPeakSampledOrder`/`minPeakSampled` only — untouched by this work.

---

### Task 1: Churn metrics, quality tool, and the baseline capture

**Files:**
- Create: `web/test/support/order-metrics.ts`
- Create: `web/test/order-metrics.test.ts`
- Create: `web/scripts/order-quality.ts`
- Modify: `justfile` (new recipe after `hunt-tight-cap`)
- Modify: `web/scripts/build-order-validate.ts` (churn/steps in the tallies)

**Interfaces:**
- Consumes: `BuildStep` from `web/src/core/reachability.ts` (existing).
- Produces: `churnPoints(steps: BuildStep[]): number` (imported by Task 5 and by `build-order-validate.ts`); `just order-quality` (CSV per build on stdout, aggregates on stderr); baseline files `.superpowers/sdd/order-quality-baseline.csv` / `.txt`, `.superpowers/sdd/build-order-validate-baseline.txt`, `.superpowers/sdd/perf-baseline.txt` (read by Tasks 4 and 5).

- [ ] **Step 1: Write the failing metric tests**

Create `web/test/order-metrics.test.ts`:

```ts
// ABOUTME: Unit tests for the build-order quality metrics: churn counts non-crossroads scaffold-add
// ABOUTME: points only (crossroads bootstrapping is free by definition; completes are the build itself).
import { test, expect } from "bun:test";
import { churnPoints } from "./support/order-metrics";
import type { BuildStep } from "../src/core/reachability";

test("churn counts non-crossroads scaffold-add points only", () => {
  const steps: BuildStep[] = [
    { kind: "scaffold-add", conId: "crossroads_chaos", points: 1, heldAfter: 1 },
    { kind: "scaffold-add", conId: "falcon", points: 5, heldAfter: 6 },
    { kind: "complete", conId: "berserker", points: 6, heldAfter: 12 },
    { kind: "scaffold-refund", conId: "falcon", points: -5, heldAfter: 7 },
    { kind: "scaffold-refund", conId: "crossroads_chaos", points: -1, heldAfter: 6 },
  ];
  expect(churnPoints(steps)).toBe(5);
});

test("a crossroads-only bootstrap has zero churn", () => {
  const steps: BuildStep[] = [
    { kind: "scaffold-add", conId: "crossroads_order", points: 1, heldAfter: 1 },
    { kind: "complete", conId: "empty_throne", points: 4, heldAfter: 5 },
    { kind: "scaffold-refund", conId: "crossroads_order", points: -1, heldAfter: 4 },
  ];
  expect(churnPoints(steps)).toBe(0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `just test test/order-metrics.test.ts`
Expected: FAIL — cannot resolve `./support/order-metrics`.

- [ ] **Step 3: Implement the metric helper**

Create `web/test/support/order-metrics.ts`:

```ts
// ABOUTME: Build-order quality metrics shared by the corpus pins and the offline harness: scaffold
// ABOUTME: churn (points on non-crossroads scaffolds bought then refunded) for an emitted schedule.
import type { BuildStep } from "../../src/core/reachability";

/** Points spent on non-crossroads scaffolds: the churn the ordering should avoid. Crossroads are
 *  free by definition (the objective is zero when a build bootstraps from crossroads alone). */
export function churnPoints(steps: BuildStep[]): number {
  let pts = 0;
  for (const s of steps)
    if (s.kind === "scaffold-add" && !s.conId.startsWith("crossroads_")) pts += s.points;
  return pts;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `just test test/order-metrics.test.ts`
Expected: 2 pass.

- [ ] **Step 5: Create the quality tool and its recipe**

Create `web/scripts/order-quality.ts`. It replays the EXACT pinned corpus of `web/test/build-order-oracle.test.ts` (same seeds, same member derivation) plus the reproduction URL:

```ts
// ABOUTME: Build-order quality over the pinned 150-seed corpus + the reproduction URL: per-build
// ABOUTME: churn/steps CSV on stdout, aggregates on stderr. The launch-gate before/after tool.
import { buildOrderPath, selectionSummary, BUDGET } from "../src/core/reachability";
import { model, cons, table, generateValidBuild, mulberry32 } from "./reachability-fuzz";
import { canonicalStarIds, decodeHash } from "../src/core/urlState";
import { churnPoints } from "../test/support/order-metrics";

const SEEDS = 150; // must match web/test/build-order-oracle.test.ts
console.log("build,churn,steps");
let orders = 0;
let churn = 0;
let stepsTotal = 0;
for (let seed = 1; seed <= SEEDS; seed++) {
  const B = generateValidBuild(mulberry32(seed));
  const selected = new Set<string>();
  for (const m of B) for (const sid of model.constellations.get(m.id)!.starIds) selected.add(sid);
  const members = selectionSummary(model, selected).built;
  const s = buildOrderPath(cons, table, members, BUDGET, 16);
  if (!s) {
    console.log(`seed-${seed},none,none`);
    continue;
  }
  orders++;
  const c = churnPoints(s);
  churn += c;
  stepsTotal += s.length;
  console.log(`seed-${seed},${c},${s.length}`);
}
const REPRO_HASH = "p=55&s=_38AQAIAAAAAAOAfAAAAAADAAYAHAMAHAAAAAPADPwAAAAAAPw";
const decoded = decodeHash(REPRO_HASH, canonicalStarIds(model))!;
const rm = selectionSummary(model, decoded.selected).built;
const rs = buildOrderPath(cons, table, rm, 55, 16);
console.log(rs ? `repro,${churnPoints(rs)},${rs.length}` : "repro,none,none");
console.error(
  `aggregate: orders=${orders}/${SEEDS} churn=${churn} steps=${stepsTotal}` +
    (rs ? ` | repro: churn=${churnPoints(rs)} steps=${rs.length}` : " | repro: NO ORDER"),
);
```

Add to `justfile` directly after the `hunt-tight-cap` recipe (match surrounding style):

```
# Build-order quality metrics on the pinned 150-seed corpus + the reproduction URL: per-build
# churn/steps CSV on stdout, aggregates on stderr. The launch-gate before/after comparison tool.
order-quality:
    cd "{{justfile_directory()}}/web" && bun scripts/order-quality.ts
```

- [ ] **Step 6: Capture the corpus baseline**

Run from the repo root:

```bash
mkdir -p .superpowers/sdd
just order-quality > .superpowers/sdd/order-quality-baseline.csv 2> .superpowers/sdd/order-quality-baseline.txt
cat .superpowers/sdd/order-quality-baseline.txt
```

Expected: an `aggregate: orders=N0/150 churn=C0 steps=S0 | repro: churn=Cr0 steps=Sr0` line. The repro steps should be about 35 (the wasteful order this effort fixes). Copy the aggregate line into your task report; these are the launch-gate baseline numbers.

- [ ] **Step 7: Add churn/steps to the validate harness**

In `web/scripts/build-order-validate.ts`:

Add the import (with the other local imports):

```ts
import { churnPoints } from "../test/support/order-metrics";
```

In `interface Tally` add two fields, and in `fresh()` initialize them:

```ts
  churn: number; // scaffold churn points across accepted orders (quality, not legality)
  stepsTotal: number; // total steps across accepted orders
```

```ts
  churn: 0,
  stepsTotal: 0,
```

In `classify`, accumulate on each ACCEPTED order. In the live branch:

```ts
  } else if (live) {
    t.liveFound++;
    t.churn += churnPoints(live);
    t.stepsTotal += live.length;
    return "live-found";
  }
```

and in the escalated branch:

```ts
  } else if (esc) {
    t.recoverable++;
    t.churn += churnPoints(esc);
    t.stepsTotal += esc.length;
    return "recoverable";
  }
```

In `report()`, after the FALSE-POSITIVE line, add:

```ts
  const found = t.liveFound + t.recoverable;
  console.log(`  quality: churn=${t.churn} pts, steps=${t.stepsTotal} across ${found} orders`);
```

- [ ] **Step 8: Capture the harness and perf baselines**

```bash
just build-order-validate > .superpowers/sdd/build-order-validate-baseline.txt 2>&1
tail -40 .superpowers/sdd/build-order-validate-baseline.txt
just perf > .superpowers/sdd/perf-baseline.txt 2>&1
tail -20 .superpowers/sdd/perf-baseline.txt
```

Expected: the harness runs its three groups (takes minutes; FALSE-POSITIVE must be 0 in each) and every group report now includes the `quality:` line. Copy each group's `quality:` line and the perf headline timings into your task report.

- [ ] **Step 9: Full suite, then commit**

Run: `just test`
Expected: all pass (the two new tests included).

```bash
git add web/test/support/order-metrics.ts web/test/order-metrics.test.ts web/scripts/order-quality.ts web/scripts/build-order-validate.ts justfile
git commit -F - <<'EOF'
feat(order): churn/step quality metrics, order-quality tool, baseline capture
EOF
```

---

### Task 2: Extract emitSchedule from buildOrderPath (no behavior change)

**Files:**
- Modify: `web/src/core/reachability.ts` (the `buildOrderPath` function, currently ~lines 703-789)

**Interfaces:**
- Consumes: existing private `buildParts`, `sampledConstruction`, `peakToReach`, `zero`, `maxV`, `addCap`, `covers`, `INF`, types `ReachCon`, `Vec`, `CoverTable`, `BuildStep`.
- Produces: private `function emitSchedule(order: ReachCon[], tail: ReachCon[], pool: ReachCon[], table: CoverTable, budget: number): BuildStep[] | null` — Task 4 calls it for both paths.

This is a pure extraction. The emission loop moves verbatim; only `sc.order` becomes the `order` parameter and `sc.tail` becomes `tail`. Every existing test must pass unchanged — the determinism tests (`web/test/build-order-path.test.ts`) prove byte-identical output.

- [ ] **Step 1: Confirm the suite is green before touching anything**

Run: `just test test/build-order-path.test.ts test/build-order-oracle.test.ts test/build-order-tightcap.test.ts`
Expected: all pass.

- [ ] **Step 2: Extract the emission loop**

In `web/src/core/reachability.ts`, immediately above `buildOrderPath`, add the new private function. Its body is the CURRENT `buildOrderPath` body from the `REPLAY_CAP` declaration through the final `return steps;`, moved without modification except `sc.order` -> `order` and `sc.tail` -> `tail`:

```ts
/**
 * Emit the add/complete/refund schedule for a member `order` plus zero-grant `tail`: at each step,
 * hold the exact scaffold SET peakToReach picks (crossroads-biased), draining refunds the moment
 * they are legal (docs/devotion-system.md: removal cannot strand a dependent). Null when any step
 * would exceed `budget` or a held scaffold can never be legally refunded - the honest signal that
 * this ORDER does not work; the caller decides what other order to try. This is buildOrderPath's
 * legality-bearing loop, extracted so more than one order generator can feed it.
 */
function emitSchedule(
  order: ReachCon[],
  tail: ReachCon[],
  pool: ReachCon[],
  table: CoverTable,
  budget: number,
): BuildStep[] | null {
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
  for (const m of order) {
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
        if (running > budget) return null; // an over-cap add is illegal: honest null, never an illegal step
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
  for (const t of tail) {
    running += t.size;
    steps.push({ kind: "complete", conId: t.id, points: t.size, heldAfter: running });
    if (running > budget) return null;
  }
  return steps;
}
```

Then replace `buildOrderPath`'s body (keep its JSDoc and signature exactly as they are) with:

```ts
export function buildOrderPath(
  cons: ReachCon[],
  table: CoverTable,
  B: ReachCon[],
  budget = BUDGET,
  tries = 16,
  peakNodeCap = 3000,
): BuildStep[] | null {
  B = [...B].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); // canonical: the order is a function of the build SET
  const sc = sampledConstruction(cons, table, B, budget, tries, peakNodeCap);
  if (sc.peak > budget) return null;
  const parts = buildParts(cons, B);
  if (!parts) return null; // not self-covering
  return emitSchedule(sc.order, sc.tail, parts.pool, table, budget);
}
```

- [ ] **Step 3: Run the build-order suites, then the full suite**

Run: `just test test/build-order-path.test.ts test/build-order-oracle.test.ts test/build-order-tightcap.test.ts test/build-order-popup.test.ts`
Expected: all pass (byte-identical behavior; the canonicalization test is the proof).

Run: `just test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/core/reachability.ts
git commit -F - <<'EOF'
refactor(order): extract emitSchedule from buildOrderPath (no behavior change)
EOF
```

---

### Task 3: needDrivenOrder, the greedy member ordering (pure, unit-tested)

**Files:**
- Modify: `web/src/core/reachability.ts` (new exported function, placed directly above `emitSchedule`)
- Create: `web/test/need-driven-order.test.ts`

**Interfaces:**
- Consumes: private `buildParts`, helpers `zero`/`addCap`/`covers`, types `ReachCon`, `Vec`.
- Produces: `export function needDrivenOrder(cons: ReachCon[], B: ReachCon[]): { order: ReachCon[]; tail: ReachCon[] } | null` — Task 4 wires it into `buildOrderPath`.

Behavior (from the spec): forward-construct an order of B's granting members. Candidates are unplaced granting members whose requirement is covered by accumulated grants plus the crossroads seed (one point per color, derived from the `crossroads_*` constellations in `cons`). Pick the candidate with the highest (points granted in still-deficient colors) per star, ratio compared exactly by cross-multiplication, ties by id. When no candidate exists, place the unplaced member with the smallest summed deficit against accumulated grants (ties by id) and let the emission replay buy the gap. Zero-grant members go to `tail`. Null only when B is not self-covering.

- [ ] **Step 1: Write the failing unit tests**

Create `web/test/need-driven-order.test.ts`:

```ts
// ABOUTME: Unit tests for needDrivenOrder, the greedy need-driven member ordering: activatable members
// ABOUTME: first (exact ratio tiebreak), smallest-deficit stuck pick, zero-grant tail, null, determinism.
import { test, expect } from "bun:test";
import { needDrivenOrder } from "../src/core/reachability";
import type { ReachCon, Vec } from "../src/core/reachability";

const z = (): Vec => [0, 0, 0, 0, 0];
const v = (asc = 0, cha = 0, eld = 0, ord = 0, pri = 0): Vec => [asc, cha, eld, ord, pri];
const con = (id: string, size: number, req: Vec, grant: Vec): ReachCon => ({ id, size, req, grant });
const unit = (i: number): Vec => {
  const u = z();
  u[i] = 1;
  return u;
};
// The five crossroads: the ever-present refundable one-point granters the seed derives from.
const XR = ["ascendant", "chaos", "eldritch", "order", "primordial"].map((c, i) =>
  con(`crossroads_${c}`, 1, z(), unit(i)),
);

test("a granter chain orders itself: each member activated by what already stands", () => {
  const a = con("a", 2, v(1), v(3)); // enters on the crossroads seed alone
  const b = con("b", 3, v(3), v(6)); // enters once a stands
  const c = con("c", 4, v(6), v(8)); // enters once a+b stand
  const r = needDrivenOrder([...XR, a, b, c], [a, b, c])!;
  expect(r.order.map((x) => x.id)).toEqual(["a", "b", "c"]);
  expect(r.tail).toEqual([]);
});

test("the denser granter goes first (Scholar's Light shape: 4-for-3 beats 5-for-5)", () => {
  const dense = con("dense", 3, z(), v(0, 0, 4)); // 4 Eldritch over 3 stars
  const wide = con("wide", 5, z(), v(0, 0, 5)); // 5 Eldritch over 5 stars
  const sink = con("sink", 2, v(0, 0, 9), v(0, 0, 1)); // keeps Eldritch deficient
  const r = needDrivenOrder([...XR, dense, wide, sink], [dense, wide, sink])!;
  expect(r.order.map((x) => x.id)).toEqual(["dense", "wide", "sink"]);
});

test("when nothing activates, the smallest-deficit member is placed", () => {
  // No crossroads in this universe: the seed is zero, so neither member is a candidate.
  const near = con("near", 3, v(2), v(9)); // summed deficit 2
  const far = con("far", 3, v(0, 7), v(0, 9)); // summed deficit 7
  const r = needDrivenOrder([near, far], [near, far])!;
  expect(r.order.map((x) => x.id)).toEqual(["near", "far"]);
});

test("zero-grant members go to the tail", () => {
  const g = con("g", 2, z(), v(5));
  const leech = con("leech", 4, v(5), z());
  const r = needDrivenOrder([...XR, g, leech], [g, leech])!;
  expect(r.order.map((x) => x.id)).toEqual(["g"]);
  expect(r.tail.map((x) => x.id)).toEqual(["leech"]);
});

test("a non-self-covering set gets the honest null", () => {
  const lone = con("lone", 3, v(5), v(1));
  expect(needDrivenOrder([...XR, lone], [lone])).toBeNull();
});

test("equal scores break by id and the result is a pure function of the set", () => {
  const b1 = con("b1", 2, z(), v(2));
  const b2 = con("b2", 2, z(), v(2)); // identical shape: id decides
  const sink = con("sink", 2, v(4), z());
  const all = [...XR, b1, b2, sink];
  const fwd = needDrivenOrder(all, [b1, b2, sink])!;
  const rev = needDrivenOrder(all, [sink, b2, b1])!;
  expect(fwd.order.map((x) => x.id)).toEqual(["b1", "b2"]);
  expect(fwd.tail.map((x) => x.id)).toEqual(["sink"]);
  expect(JSON.stringify(fwd)).toBe(JSON.stringify(rev));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `just test test/need-driven-order.test.ts`
Expected: FAIL — `needDrivenOrder` is not exported.

- [ ] **Step 3: Implement needDrivenOrder**

In `web/src/core/reachability.ts`, directly above `emitSchedule`, add:

```ts
/**
 * Need-driven greedy member ordering: the build builds itself. Forward-constructs an order of B's
 * granting members so each is activated by the accumulated grants of the members already placed,
 * plus the ever-present crossroads seed (one point per color is always reachable through a
 * refundable crossroads; the emission replay decides whether one is actually bought). Among
 * candidates it picks the densest contributor to the still-deficient colors (points granted in
 * deficient colors per star - the Scholar's Light tiebreak), ratios compared exactly by
 * cross-multiplication, ties broken by id. When nothing activates, the build is genuinely stuck
 * without scaffolding: it places the member with the smallest summed deficit and lets the emission
 * replay buy exactly that gap. Zero-grant members go to `tail`, placed last. Canonicalized and
 * deterministic like buildOrderPath; null only when B is not self-covering (one honest signal).
 */
export function needDrivenOrder(
  cons: ReachCon[],
  B: ReachCon[],
): { order: ReachCon[]; tail: ReachCon[] } | null {
  B = [...B].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); // canonical: a function of the SET
  const parts = buildParts(cons, B);
  if (!parts) return null; // not self-covering
  const { G } = parts;
  const grants = (c: ReachCon) => c.grant[0] || c.grant[1] || c.grant[2] || c.grant[3] || c.grant[4];
  const tail = B.filter((c) => !grants(c));
  let seed = zero();
  for (const c of cons) if (c.id.startsWith("crossroads_")) seed = addCap(seed, c.grant);
  const placed = new Array(G.length).fill(false);
  const order: ReachCon[] = [];
  let grant = zero();
  while (order.length < G.length) {
    const avail = addCap(grant, seed);
    // Deficient colors: what unplaced members still demand beyond the accumulated grants.
    const deficit = zero();
    for (let i = 0; i < G.length; i++) {
      if (placed[i]) continue;
      for (let k = 0; k < 5; k++) {
        const short = G[i]!.req[k]! - grant[k]!;
        if (short > deficit[k]!) deficit[k] = short;
      }
    }
    let pick = -1;
    let pickPts = 0;
    let pickSize = 1;
    for (let i = 0; i < G.length; i++) {
      if (placed[i] || !covers(avail, G[i]!.req)) continue;
      let pts = 0;
      for (let k = 0; k < 5; k++) if (deficit[k]! > 0) pts += G[i]!.grant[k]!;
      if (
        pick < 0 ||
        pts * pickSize > pickPts * G[i]!.size ||
        (pts * pickSize === pickPts * G[i]!.size && G[i]!.id < G[pick]!.id)
      ) {
        pick = i;
        pickPts = pts;
        pickSize = G[i]!.size;
      }
    }
    if (pick < 0) {
      // Genuinely stuck: place the member with the smallest summed deficit; the emission replay's
      // peakToReach buys exactly that gap (crossroads-biased, minimal) and refunds it legally.
      let pickDef = Infinity;
      for (let i = 0; i < G.length; i++) {
        if (placed[i]) continue;
        let d = 0;
        for (let k = 0; k < 5; k++) d += Math.max(0, G[i]!.req[k]! - grant[k]!);
        if (d < pickDef || (d === pickDef && G[i]!.id < G[pick]!.id)) {
          pick = i;
          pickDef = d;
        }
      }
    }
    placed[pick] = true;
    order.push(G[pick]!);
    grant = addCap(grant, G[pick]!.grant);
  }
  return { order, tail };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `just test test/need-driven-order.test.ts`
Expected: 6 pass.

- [ ] **Step 5: Full suite, then commit**

Run: `just test`
Expected: all pass (nothing calls the new function yet).

```bash
git add web/src/core/reachability.ts web/test/need-driven-order.test.ts
git commit -F - <<'EOF'
feat(order): needDrivenOrder greedy member ordering (pure, unit-tested)
EOF
```

---

### Task 4: Wire the greedy first into buildOrderPath, measure the after numbers

**Files:**
- Modify: `web/src/core/reachability.ts` (`buildOrderPath` body and its JSDoc)

**Interfaces:**
- Consumes: `needDrivenOrder(cons, B)` (Task 3), `emitSchedule(order, tail, pool, table, budget)` (Task 2).
- Produces: greedy-first `buildOrderPath` (public contract unchanged); after-measurement files `.superpowers/sdd/order-quality-after.csv` / `.txt` (read by Task 5).

- [ ] **Step 1: Rewire buildOrderPath**

Replace the JSDoc and body of `buildOrderPath` (signature unchanged):

```ts
/**
 * A legal constellation-level order that assembles the self-covering build `B` within `budget` points
 * held at once, including the transient scaffold to ADD before a step and REFUND once the build's own
 * grants cover it. Orders the granting members need-driven first (needDrivenOrder: each member
 * activated by what already stands plus at most a refundable crossroads, scaffolding only when
 * genuinely stuck), and falls back to the sampled peak-minimizing order (sampledConstruction) when
 * the greedy's order cannot be emitted within budget - so any build with an order under the sampler
 * alone still gets one; orders are gained, never lost. Emission (emitSchedule) holds the exact
 * scaffold SET peakToReach picks and drains refunds per the in-game rule (docs/devotion-system.md,
 * "removal cannot strand a dependent"). Returns null when neither order fits the budget or a held
 * scaffold can never be legally refunded - the honest "not validly buildable" signal. No order is
 * better than an illegal order. Input is canonicalized (sorted by constellation id), so the output
 * is a pure function of the build set - every caller (panel, test, script) gets the identical order.
 */
export function buildOrderPath(
  cons: ReachCon[],
  table: CoverTable,
  B: ReachCon[],
  budget = BUDGET,
  tries = 16,
  peakNodeCap = 3000,
): BuildStep[] | null {
  B = [...B].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); // canonical: the order is a function of the build SET
  const parts = buildParts(cons, B);
  if (!parts) return null; // not self-covering
  if (parts.totalSize > budget) return null;
  // Greedy first: the need-driven order usually bootstraps from crossroads alone (zero churn) and
  // skips the sampler entirely. Emission is the authority on whether it fits the cap - orderPeak
  // would be a cheaper pre-check but ignores refunds, so it would wrongly reject orders whose
  // refunds keep the running total under budget.
  const nd = needDrivenOrder(cons, B);
  if (nd) {
    const viaGreedy = emitSchedule(nd.order, nd.tail, parts.pool, table, budget);
    if (viaGreedy) return viaGreedy;
  }
  // Fallback: the sampled witness order, exactly as before the greedy existed.
  const sc = sampledConstruction(cons, table, B, budget, tries, peakNodeCap);
  if (sc.peak > budget) return null;
  return emitSchedule(sc.order, sc.tail, parts.pool, table, budget);
}
```

`buildOrderEscalated` and `minBuildableCap` call `buildOrderPath`, so they inherit both paths with no change.

- [ ] **Step 2: Run the build-order suites**

Run: `just test test/build-order-path.test.ts test/build-order-oracle.test.ts test/build-order-tightcap.test.ts test/need-driven-order.test.ts`
Expected: all pass. In particular:
- "the confirmed false-reach build has no order within 55" MUST still pass (emission enforces the cap; if it fails, the wiring is buggy — stop and investigate, do not touch the test).
- The seeded oracle sweep now judges the greedy's output; zero failures required.
- The canonicalization/determinism tests now prove the greedy path is deterministic.

- [ ] **Step 3: Run the full suite**

Run: `just test`
Expected: all pass. The popup tests (`test/build-order-popup.test.ts`) search steps by kind, not position, so the repro URL's new order should satisfy them.

- [ ] **Step 4: Contingency — only if the popup refund-delta test failed**

If `test/build-order-popup.test.ts` "a refund step's grant delta is negative" fails with `fi = -1`, the repro build's new order needs no scaffolds at all (nothing to refund) — an improvement that starves that test's fixture. In that case widen that one test's search to the first tight-cap fixture build (guaranteed refund-heavy), leaving every other popup test on `REPRO_HASH`:

```ts
import tightCap from "./fixtures/tight-cap-builds.json";

test("a refund step's grant delta is negative", () => {
  const sel = (tightCap as unknown as { cases: { sel: Record<string, number> }[] }).cases[0]!.sel;
  const chosen = new Set<string>();
  for (const conId of Object.keys(sel))
    for (const sid of model.constellations.get(conId)!.starIds) chosen.add(sid);
  const tv = selectionView(model, cons, table, chosen, 55);
  const tSteps = tv.buildOrder!;
  const tStates = tv.buildOrderStates!;
  const fi = tSteps.findIndex(
    (s, i) => s.kind === "scaffold-refund" && tStates[i]!.conGrant.some((n) => n > 0),
  );
  expect(fi).toBeGreaterThanOrEqual(0);
  const g = tStates[fi]!.conGrant.find((n) => n > 0)!;
  expect(buildStepPopupHtml(enLoc, model, tSteps[fi]!, tStates[fi]!)).toContain(
    `<span class="bo-pop-delta">(-${g})</span>`,
  );
});
```

If the test passed, skip this step entirely.

- [ ] **Step 5: Measure the after numbers**

```bash
just order-quality > .superpowers/sdd/order-quality-after.csv 2> .superpowers/sdd/order-quality-after.txt
cat .superpowers/sdd/order-quality-after.txt
paste -d, .superpowers/sdd/order-quality-baseline.csv .superpowers/sdd/order-quality-after.csv | awk -F, '
  NR > 1 && $1 != "repro" {
    if ($2 == "none" && $5 != "none") gained++;
    else if ($2 != "none" && $5 == "none") lost++;
    else if ($2 != "none") { if ($5+0 < $2+0) imp++; else if ($5+0 == $2+0) unch++; else wors++; }
  }
  END { printf "improved=%d unchanged=%d worsened=%d gained=%d lost=%d\n", imp, unch, wors, gained, lost }'
```

Copy into your task report: the after aggregate line, the baseline aggregate line (from Task 1's report), and the distribution line. Expected direction: churn strictly down, steps down, `lost=0`, repro at churn=0 and low-twenties steps. Do NOT hide a miss — Task 5 assembles the launch gate from these numbers and a failing line stops the merge.

If `wors > 0`, also list the worsened builds with their before/after churn:

```bash
paste -d, .superpowers/sdd/order-quality-baseline.csv .superpowers/sdd/order-quality-after.csv | awk -F, 'NR > 1 && $2 != "none" && $5 != "none" && $5+0 > $2+0 { print $1": churn "$2" -> "$5", steps "$3" -> "$6 }'
```

- [ ] **Step 6: Commit**

```bash
git add web/src/core/reachability.ts
git commit -F - <<'EOF'
feat(order): buildOrderPath tries the need-driven order first, sampler as cap fallback
EOF
```

(Include `web/test/build-order-popup.test.ts` in the `git add` only if Step 4's contingency was needed.)

---

### Task 4b: Best-of-both schedule selection (Ted-approved revision after Task 4's measurement)

Task 4's greedy-first-if-legal mechanism failed the launch gate (corpus churn 81 to 610, 87/150 builds worse) while improving the repro build (26 to 4). Ted chose the best-of-both revision: emit BOTH candidate schedules and return the better by the objective (fewer churn points, then fewer steps, greedy on a full tie). Projected from the two per-build CSVs: churn 81 to 35, steps 2741 to 2711, worsened 0, repro (4, 23).

**Files:**
- Modify: `web/src/core/reachability.ts` (add exported `churnPoints` beside `BuildStep`; replace `buildOrderPath` JSDoc + body)
- Delete: `web/test/support/order-metrics.ts` (the metric moves to core — the engine now selects on it)
- Modify: `web/test/order-metrics.test.ts`, `web/scripts/order-quality.ts`, `web/scripts/build-order-validate.ts` (import `churnPoints` from core)

**Interfaces:**
- Consumes: `needDrivenOrder`, `emitSchedule`, `sampledConstruction`, `buildParts` (all existing).
- Produces: `export function churnPoints(steps: BuildStep[]): number` in `web/src/core/reachability.ts` (Task 5 imports it from there); best-of-both `buildOrderPath` (public contract unchanged); refreshed `.superpowers/sdd/order-quality-after.csv` / `.txt`.

- [ ] **Step 1: Move churnPoints into core**

In `web/src/core/reachability.ts`, directly after the `BuildStep` type, add:

```ts
/** Points spent on non-crossroads scaffolds in a schedule: the churn the ordering minimizes
 *  (crossroads are free by definition - the objective is zero when a build bootstraps from
 *  crossroads alone). Exported as the shared quality metric for tests and harnesses. */
export function churnPoints(steps: BuildStep[]): number {
  let pts = 0;
  for (const s of steps) if (s.kind === "scaffold-add" && !s.conId.startsWith("crossroads_")) pts += s.points;
  return pts;
}
```

Delete `web/test/support/order-metrics.ts`. Update the three importers:
- `web/test/order-metrics.test.ts`: `import { churnPoints } from "../src/core/reachability";`
- `web/scripts/order-quality.ts`: fold `churnPoints` into the existing `../src/core/reachability` import
- `web/scripts/build-order-validate.ts`: fold `churnPoints` into the existing `../src/core/reachability` import

Run: `just test test/order-metrics.test.ts`
Expected: 2 pass.

- [ ] **Step 2: Replace buildOrderPath with the best-of-both selection**

```ts
/**
 * A legal constellation-level order that assembles the self-covering build `B` within `budget` points
 * held at once, including the transient scaffold to ADD before a step and REFUND once the build's own
 * grants cover it. Two candidate orders are emitted (emitSchedule holds the exact scaffold SET
 * peakToReach picks and drains refunds per the in-game rules, docs/devotion-system.md): the
 * need-driven greedy order (needDrivenOrder: the build builds itself, usually from crossroads alone)
 * and the sampled peak-minimizing witness order (sampledConstruction). Neither generator dominates -
 * the greedy wins cap-tight builds the sampler scaffolds heavily, the sampler's bootstrap heuristic
 * wins typical builds the greedy misorders - so the better schedule by the ordering objective is
 * returned: fewer churn points (churnPoints), then fewer steps, the greedy on a full tie. Per-build
 * best-of-both is never worse than either generator alone. Returns null when neither order fits the
 * budget or a held scaffold can never be legally refunded - the honest "not validly buildable"
 * signal. No order is better than an illegal order. Input is canonicalized (sorted by constellation
 * id), so the output is a pure function of the build set - every caller gets the identical order.
 */
export function buildOrderPath(
  cons: ReachCon[],
  table: CoverTable,
  B: ReachCon[],
  budget = BUDGET,
  tries = 16,
  peakNodeCap = 3000,
): BuildStep[] | null {
  B = [...B].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); // canonical: the order is a function of the build SET
  const parts = buildParts(cons, B);
  if (!parts) return null; // not self-covering
  if (parts.totalSize > budget) return null;
  const nd = needDrivenOrder(cons, B);
  const viaGreedy = nd ? emitSchedule(nd.order, nd.tail, parts.pool, table, budget) : null;
  const sc = sampledConstruction(cons, table, B, budget, tries, peakNodeCap);
  const viaSampler = sc.peak <= budget ? emitSchedule(sc.order, sc.tail, parts.pool, table, budget) : null;
  if (!viaGreedy || !viaSampler) return viaGreedy ?? viaSampler;
  const g = churnPoints(viaGreedy);
  const s = churnPoints(viaSampler);
  if (g !== s) return g < s ? viaGreedy : viaSampler;
  return viaGreedy.length <= viaSampler.length ? viaGreedy : viaSampler;
}
```

- [ ] **Step 3: Run the build-order suites, then the full suite**

Run: `just test test/build-order-path.test.ts test/build-order-oracle.test.ts test/build-order-tightcap.test.ts test/build-order-popup.test.ts test/need-driven-order.test.ts`
Expected: all pass; "the confirmed false-reach build has no order within 55" must still pass (both emissions enforce the cap).

Run: `just test`
Expected: all pass.

- [ ] **Step 4: Re-measure**

```bash
just order-quality > .superpowers/sdd/order-quality-after.csv 2> .superpowers/sdd/order-quality-after.txt
cat .superpowers/sdd/order-quality-after.txt
paste -d, .superpowers/sdd/order-quality-baseline.csv .superpowers/sdd/order-quality-after.csv | awk -F, '
  NR > 1 && $1 != "repro" {
    if ($2 == "none" && $5 != "none") gained++;
    else if ($2 != "none" && $5 == "none") lost++;
    else if ($2 != "none") { if ($5+0 < $2+0) imp++; else if ($5+0 == $2+0) unch++; else wors++; }
  }
  END { printf "improved=%d unchanged=%d worsened=%d gained=%d lost=%d\n", imp, unch, wors, gained, lost }'
```

Expected (projection; report actuals): aggregate churn 35, steps 2711, repro churn 4 steps 23, `worsened=0 lost=0`. Any `worsened > 0` or `lost > 0` contradicts the selection's no-worse guarantee — report it as a bug rather than accepting it.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/reachability.ts web/test/support/order-metrics.ts web/test/order-metrics.test.ts web/scripts/order-quality.ts web/scripts/build-order-validate.ts
git commit -F - <<'EOF'
feat(order): best-of-both schedule selection (churn, then steps); churnPoints moves to core
EOF
```

---

### Task 5: Quality pins, harness comparison, docs, launch-gate verdict

**Files:**
- Modify: `web/test/build-order-oracle.test.ts` (aggregate pins + repro pins)
- Modify: `docs/reachability-engine.md` (ordering-strategy paragraph, rewritten in place)
- Modify: `BACKLOG.md` (remove the implemented entry)

**Interfaces:**
- Consumes: `churnPoints` (Task 1); the measurement files `.superpowers/sdd/order-quality-{baseline,after}.{csv,txt}`, `.superpowers/sdd/build-order-validate-baseline.txt`, `.superpowers/sdd/perf-baseline.txt`.
- Produces: the CI quality net and the recorded launch-gate verdict.

- [ ] **Step 1: Derive the pin values**

From `.superpowers/sdd/order-quality-after.txt` read `orders=N churn=C steps=S | repro: churn=Cr steps=Sr`. Compute:
- `ORDER_FLOOR = N` (the shipped order count; a future change may not lose any)
- `CHURN_PIN = Math.ceil(C * 1.02)` and `STEPS_PIN = Math.ceil(S * 1.02)` (2% slack: legal reshuffles cannot trip them, a real churn regression can)
- `REPRO_CHURN_PIN = Cr` and `REPRO_STEPS_PIN = Sr` (exact: the function is deterministic)

- [ ] **Step 2: Write the failing pin tests**

In `web/test/build-order-oracle.test.ts`, fold `churnPoints` into the existing `../src/core/reachability` import (it lives in core as of Task 4b).

Append at the end of the file, substituting the derived values (record the raw measured numbers and the baseline in the comment):

```ts
// Aggregate quality pins (the churn CI net, spec 2026-07-19-need-driven-ordering-design.md):
// measured on this corpus with the need-driven greedy, 2% slack. Baseline before the greedy:
// orders=<N0> churn=<C0> steps=<S0>. Measured after: orders=<N> churn=<C> steps=<S>.
// Update these deliberately when the algorithm improves; a silent regression must fail here.
const ORDER_FLOOR = <N>;
const CHURN_PIN = <ceil(C * 1.02)>;
const STEPS_PIN = <ceil(S * 1.02)>;

test("seeded corpus: aggregate churn and steps hold their pins; no orders lost", () => {
  let orders = 0;
  let churn = 0;
  let stepsTotal = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const B = generateValidBuild(mulberry32(seed));
    const selected = new Set<string>();
    for (const m of B) for (const sid of model.constellations.get(m.id)!.starIds) selected.add(sid);
    const members = selectionSummary(model, selected).built;
    const steps = buildOrderPath(cons, table, members, BUDGET, 16);
    if (!steps) continue;
    orders++;
    churn += churnPoints(steps);
    stepsTotal += steps.length;
  }
  expect(orders).toBeGreaterThanOrEqual(ORDER_FLOOR);
  expect(churn).toBeLessThanOrEqual(CHURN_PIN);
  expect(stepsTotal).toBeLessThanOrEqual(STEPS_PIN);
});

test("the reproduction URL's order meets its quality pins", () => {
  const decoded = decodeHash(REPRO_HASH, canonicalStarIds(model));
  const members = selectionSummary(model, decoded!.selected).built;
  const steps = buildOrderPath(cons, table, members, 55, 16);
  expect(steps).not.toBeNull();
  expect(churnPoints(steps!)).toBeLessThanOrEqual(<Cr>); // measured: crossroads-only means 0
  expect(steps!.length).toBeLessThanOrEqual(<Sr>); // measured: low twenties, down from 35
});
```

To prove the pins bite, first set `CHURN_PIN` to `-1`, run `just test test/build-order-oracle.test.ts`, and confirm the new test FAILS; then restore the derived value.

- [ ] **Step 3: Run the pin tests to verify they pass**

Run: `just test test/build-order-oracle.test.ts`
Expected: all pass with the derived values.

- [ ] **Step 4: Run the validate harness after-comparison**

```bash
just build-order-validate > .superpowers/sdd/build-order-validate-after.txt 2>&1
diff <(grep -E "quality:|FALSE" .superpowers/sdd/build-order-validate-baseline.txt) <(grep -E "quality:|FALSE" .superpowers/sdd/build-order-validate-after.txt)
```

Expected: FALSE-POSITIVE remains 0 in every group; each group's `quality:` churn is at or below baseline (typical builds strictly below); FALSE-NEGATIVE not worse (the greedy can only add found orders). Copy both sets of lines into the task report.

- [ ] **Step 5: Rewrite the ordering paragraph in docs/reachability-engine.md**

In the section "The guided build order: legal at every step, verified or absent", replace the opening paragraph (which currently says the schedule completes members "in a sampled peak-minimizing order") with:

```markdown
`buildOrderPath` (web/src/core/reachability.ts) turns a self-covering selection
into a step-by-step construction schedule. It orders the granting members
need-driven first (`needDrivenOrder`): each member is activated by what the
build has already placed plus at most a refundable crossroads, so the build
builds itself and non-crossroads scaffolding is bought only when genuinely
stuck. When that order cannot be emitted within the point cap it falls back to
the sampled peak-minimizing order (`sampledConstruction`), which also remains
the engine's untouched reachability witness (`minPeakSampled`). Either order
feeds the same emission loop, which adds transient scaffold constellations
before the steps that need them and refunds each the moment the in-game rules
allow. Its contract:
```

In the closing regression-net paragraph of the same section, extend the sentence listing the nets so it also names the quality net, e.g. after the tight-cap corpus clause add:

```markdown
the aggregate churn/step quality pins in web/test/build-order-oracle.test.ts
(a silent ordering regression fails CI; `just order-quality` is the
per-build measurement tool),
```

Keep the living-docs rule: rewrite in place, no dated update notes.

- [ ] **Step 6: Remove the implemented BACKLOG entry**

In `BACKLOG.md`, delete the entire "Guided build order: churn-minimizing, need-driven ordering" entry (heading and body). Leave every other entry untouched.

- [ ] **Step 7: Full gate plus the heavy checks**

```bash
just test
just fuzz
just e2e
just perf > .superpowers/sdd/perf-after.txt 2>&1
```

Expected: all green. Compare `perf-after.txt` headline timings against `.superpowers/sdd/perf-baseline.txt`: no regression overall; greedy-hit builds should be at or below baseline (the sampler no longer runs for them). Copy both headline blocks into the task report.

- [ ] **Step 8: Assemble the launch-gate verdict**

Write into the task report a table with one row per criterion, each marked PASS or FAIL with the numbers:

1. Aggregate churn strictly lower than baseline (C < C0)
2. Aggregate steps no higher (S <= S0)
3. Zero orders lost (`lost=0` in Task 4's distribution line)
4. Worsened tail: report `worsened=` count; if > 0, attach the per-build list from Task 4 Step 5
5. Repro URL: churn 0 (crossroads-only) and steps in the low twenties
6. Validity: FALSE-POSITIVE 0 in every harness group; full suite, fuzz, e2e green
7. Perf: no regression

If ANY of 1, 2, 3, 5, 6 is FAIL, or 7 shows a real regression: STOP after committing. Report the verdict to Ted and do not proceed to merging — the spec's launch gate says the branch does not merge. The worsened-tail row (4) is Ted's judgment call; surface it either way.

- [ ] **Step 9: Commit**

```bash
git add web/test/build-order-oracle.test.ts docs/reachability-engine.md BACKLOG.md
git commit -F - <<'EOF'
feat(order): churn/step quality pins, harness comparison, ordering docs
EOF
```
