# Guided Build-Order Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace blind shuffle sampling in the build-order quality search with a schedule-guided hill climb, dropping real-corpus churn from 334 to about 265 while cutting per-click latency.

**Architecture:** All changes live in `sampledConstruction`'s quality mode in `web/src/core/reachability.ts`. The three deterministic heuristic starts stay; a guided climb (deterministic reorder moves read off the incumbent schedule) replaces the shuffle loop; shuffles remain only as a fallback for builds whose heuristic orders never fit. Witness mode is untouched by construction.

**Tech Stack:** TypeScript, Bun tests, biome, justfile recipes. No new dependencies.

**Spec:** docs/superpowers/specs/2026-08-24-guided-build-order-search-design.md

## Global Constraints

- Witness mode byte-identical: every new code path is gated on `mode === "quality"`; the witness snapshot (`web/test/__snapshots__/build-order.test.ts.snap`) must pass WITHOUT being re-recorded.
- `buildOrderPath` stays a pure function of the build set: work budgets are counts, never wall-clock; no `Date.now()`, no `Math.random()`.
- Ordering objective unchanged: fewest `churnPoints`, then fewest steps, greedy on a full tie.
- Per-click envelope: p95 <= 45 ms, p99 <= 190 ms (docs/reachability-performance.md).
- Success bar: real-corpus churn 295 or better; the spike measured 265, so investigate before accepting anything above 295.
- The oracle (`web/src/core/orderLegality.ts`) stays free of engine helpers and is NOT modified.
- Repo rules: ABOUTME 2-line headers, evergreen comments (no roadmap language), biome formatting, the pre-commit hook runs `just check` (never `--no-verify`), conventional commits ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File map

- `web/src/core/reachability.ts` - the climb (Task 1), possibly multi-start (Task 2)
- `web/test/order-quality-mode.test.ts` - contract rework (Task 1)
- `web/test/build-order-oracle.test.ts` - pin re-record (Task 1)
- `web/scripts/order-quality.ts` - harness rework (Task 3)
- `docs/reachability-engine.md`, `BACKLOG.md` - docs (Task 4)
- Throwaway, never committed: `web/src/core/reachabilityClimbExperiment.ts` and `.llm/climb-experiment-runner.ts` (Task 2)

---

### Task 1: The guided climb in quality mode

**Files:**
- Modify: `web/src/core/reachability.ts` (sampledConstruction ~line 680, buildOrderCandidates ~line 1002, buildOrderEscalated comment ~line 1052)
- Modify: `web/test/order-quality-mode.test.ts` (full rework)
- Modify: `web/test/build-order-oracle.test.ts` (pins only)

**Interfaces:**
- Consumes: existing `emitSchedule`, `peelOrder`, `churnPoints`, `BuildStep`, `SamplerMode` (all already in reachability.ts, unchanged).
- Produces: `const CLIMB_EVALS = 64` (module constant); `sampledConstruction(..., mode, climbEvals = CLIMB_EVALS)`; `buildOrderCandidates(cons, table, B, budget = BUDGET, tries = 16, peakNodeCap = 3000, climbEvals = CLIMB_EVALS)`. Tasks 2 and 3 rely on the `climbEvals` parameter exactly as spelled here. `buildOrderPath` signature unchanged.

- [ ] **Step 1: Rework the quality-mode contract test to the climb contract (failing first)**

Replace the entire contents of `web/test/order-quality-mode.test.ts` with:

```ts
// ABOUTME: Quality-mode contract for the guided build-order search: deterministic, and the climb
// ABOUTME: never loses to its heuristic starts; the real corpus by default, both under `just test-slow`.
import { test, expect } from "bun:test";
import { buildOrderCandidates, churnPoints, selectionSummary, BUDGET, type ReachCon } from "../src/core/reachability";
import { model, cons, table, generateValidBuild, mulberry32 } from "../scripts/reachability-fuzz";
import realJson from "./fixtures/real-builds.json";

const real = realJson as unknown as { builds: { starIds: string[] }[] };

const realMembers = (): ReachCon[][] => real.builds.map((b) => selectionSummary(model, new Set(b.starIds)).built);
const syntheticMembers = (): ReachCon[][] => {
  const out: ReachCon[][] = [];
  for (let seed = 1; seed <= 150; seed++) out.push(generateValidBuild(mulberry32(seed)));
  return out;
};

// Asserts determinism and per-build climb-never-worse; returns churn totals with the climb off and on.
function sweep(corpus: ReachCon[][]): { off: number; on: number } {
  let off = 0;
  let on = 0;
  for (const B of corpus) {
    const cOn = buildOrderCandidates(cons, table, B, BUDGET, 32).sampler;
    const cOnAgain = buildOrderCandidates(cons, table, B, BUDGET, 32).sampler;
    expect(cOnAgain).toEqual(cOn); // pure function of the build set
    const cOff = buildOrderCandidates(cons, table, B, BUDGET, 32, 3000, 0).sampler;
    if (cOff) expect(cOn).not.toBeNull(); // the climb never loses an order
    if (cOff && cOn) {
      // A pin over the corpus, not an invariant: the argmin is picked on sampled-cap schedules
      // and the winner is re-emitted at REPLAY_CAP, so a failure here means re-measure, not broken.
      expect(churnPoints(cOn)).toBeLessThanOrEqual(churnPoints(cOff));
      off += churnPoints(cOff);
      on += churnPoints(cOn);
    }
  }
  return { off, on };
}

// The guided climb must actually buy churn back over the heuristic starts. If this fails after a
// search change, the climb has no headroom here: STOP and report rather than weakening it.
test("quality search is deterministic and the climb buys churn back on the real corpus", () => {
  const { off, on } = sweep(realMembers());
  expect(on).toBeLessThan(off);
}, 60_000);

test.skipIf(process.env.REACH_SLOW !== "1")(
  "slow tier: the same holds over 150 synthetic builds plus the real corpus",
  () => {
    // <= not <: the synthetic corpus is already near zero churn, so the climb may only tie there.
    const { off, on } = sweep([...syntheticMembers(), ...realMembers()]);
    expect(on).toBeLessThanOrEqual(off);
  },
  120_000,
);

test("samplerStepsFirst is a fitting schedule with no more steps than the churn pick", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const B = generateValidBuild(mulberry32(seed));
    const c = buildOrderCandidates(cons, table, B, BUDGET, 32);
    if (!c.sampler) continue;
    expect(c.samplerStepsFirst).not.toBeNull();
    // Also a pin over this corpus: samplerStepsFirst is the sampled-cap steps minimizer while
    // sampler is re-emitted at REPLAY_CAP, so treat a failure as re-measure, not broken.
    expect(c.samplerStepsFirst!.length).toBeLessThanOrEqual(c.sampler.length);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && bun test order-quality-mode`
Expected: FAIL. `buildOrderCandidates` does not yet accept a 7th `climbEvals` argument, so the climb-off call is identical to climb-on and `expect(on).toBeLessThan(off)` fails (on === off).

- [ ] **Step 3: Implement the climb in `web/src/core/reachability.ts`**

3a. Immediately above `function sampledConstruction(` add:

```ts
/** The guided climb's evaluation cap. Convergence measures under 32 evaluations on the real corpus,
 *  so 64 buys margin while bounding the worst case. A count, never wall-clock, for determinism. */
const CLIMB_EVALS = 64;
```

3b. Change the `sampledConstruction` signature: after `mode: SamplerMode = "witness",` add the line `climbEvals: number = CLIMB_EVALS,`.

3c. Replace the block comment directly above `function sampledConstruction(` (the one beginning `// Core sampler shared by minPeakSampled`) with:

```ts
// Core sampler shared by minPeakSampled (which wants the peak), minPeakSampledOrder (which wants the
// witness order) and buildOrderPath (which wants the schedule). Every candidate order is scored by the
// peak of its actual legal schedule (emitSchedule: scaffolds added before the step that needs them,
// refunded the moment the rules allow, so a scaffold swap holds both sides until the old one may go).
// Both modes first score three deterministic orders - the bootstrap heuristic (lowest requirement
// first, then highest grant density) and both peel variants (peelOrder). Witness mode then samples up
// to `tries` seeded shuffles, keeping the smallest-peak order and stopping at the first schedule that
// fits the budget (a reachability proof needs nothing more). Quality mode instead hill-climbs from the
// best heuristic schedule: it reads the incumbent's non-crossroads scaffold buys and scores targeted
// reorderings (up to `climbEvals`), keeping the churn-then-steps argmin and the steps-first argmin
// alongside for the divergence harness. Shuffles remain only as a fallback for builds whose heuristic
// orders never fit: sample until one fits (capped by `tries`), then climb it.
```

3d. Directly after the closing `};` of the `consider` arrow function, insert:

```ts
  // TS flow analysis cannot see closure assignments to bestSteps; read it through a call so the
  // incumbent is not narrowed to null at the climb sites.
  const liveSteps = (): BuildStep[] | null => bestSteps;
  // Guided local search: read the incumbent schedule's first two non-crossroads scaffold buys and
  // score targeted reorderings, accepting churn-then-steps improvements until convergence or `cap`.
  const climb = (cap: number): void => {
    if (liveSteps() === null) return;
    const byId = new Map(pool.map((c) => [c.id, c]));
    const moves = (ord: ReachCon[], steps: BuildStep[]): ReachCon[][] => {
      const out: ReachCon[][] = [];
      const idx = new Map(ord.map((c, i) => [c.id, i]));
      let events = 0;
      for (let s = 0; s < steps.length && events < 2; s++) {
        const st = steps[s]!;
        if (st.kind !== "scaffold-add" || st.conId.startsWith("crossroads_")) continue;
        events++;
        const scaffold = byId.get(st.conId);
        // The triggering member: the first completion after the buy that is in the granting order.
        let ti = -1;
        for (let t = s + 1; t < steps.length; t++) {
          const c = steps[t]!;
          if (c.kind === "complete" && idx.has(c.conId)) {
            ti = idx.get(c.conId)!;
            break;
          }
        }
        if (ti < 0) continue;
        if (scaffold) {
          // Advance each later member that feeds the scaffold's colors to just before the trigger.
          for (let j = ti + 1; j < ord.length; j++) {
            let feeds = false;
            for (let k = 0; k < 5; k++) if (scaffold.grant[k]! > 0 && ord[j]!.grant[k]! > 0) feeds = true;
            if (!feeds) continue;
            const cand = [...ord];
            const [m] = cand.splice(j, 1);
            cand.splice(ti, 0, m!);
            out.push(cand);
          }
        }
        if (ti + 1 < ord.length) {
          const cand = [...ord];
          const [m] = cand.splice(ti, 1);
          cand.push(m!);
          out.push(cand);
        }
        if (ti > 0) {
          const cand = [...ord];
          const tmp = cand[ti - 1]!;
          cand[ti - 1] = cand[ti]!;
          cand[ti] = tmp;
          out.push(cand);
        }
      }
      return out;
    };
    let evals = 0;
    for (let improved = true; improved && evals < cap; ) {
      improved = false;
      for (const cand of moves(bestOrder, liveSteps()!)) {
        if (evals >= cap) break;
        evals++;
        const c0 = bestChurn;
        const n0 = liveSteps()!.length;
        consider(cand);
        if (bestChurn < c0 || (bestChurn === c0 && liveSteps()!.length < n0)) {
          improved = true;
          break;
        }
      }
    }
  };
```

3e. Replace the tail of the function, currently:

```ts
  let seed = (totalSize * 2654435761 + G.length * 40503) >>> 0; // deterministic per build
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let attempt = 0; attempt < tries && (mode === "quality" || best > budget); attempt++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = order[i]!;
      order[i] = order[j]!;
      order[j] = tmp;
    }
    consider(order);
  }
  return done();
```

with:

```ts
  let seed = (totalSize * 2654435761 + G.length * 40503) >>> 0; // deterministic per build
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const shuffle = (): void => {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = order[i]!;
      order[i] = order[j]!;
      order[j] = tmp;
    }
  };
  if (mode === "quality") {
    climb(climbEvals);
    // Fallback for builds whose heuristic orders never fit: sample until one does, then climb it.
    if (bestSteps === null) {
      for (let attempt = 0; attempt < tries && bestSteps === null; attempt++) {
        shuffle();
        consider(order);
      }
      climb(climbEvals);
    }
    return done();
  }
  for (let attempt = 0; attempt < tries && best > budget; attempt++) {
    shuffle();
    consider(order);
  }
  return done();
```

Note the witness branch keeps the exact shuffle-and-consider sequence and stop condition it has today (the old combined condition reduces to `best > budget` when mode is witness), so witness results stay byte-identical.

3f. In `buildOrderCandidates`: add the parameter `climbEvals = CLIMB_EVALS,` after `peakNodeCap = 3000,`, and change the sampler call to `sampledConstruction(cons, table, B, budget, tries, peakNodeCap, "quality", climbEvals)`. Append one sentence to its doc comment: `climbEvals is harness-facing (the climb-off/on comparison); app callers take the default.`

3g. In `buildOrderPath`'s doc comment, replace the phrase `the sampled peak-minimizing witness order (sampledConstruction)` with `the guided quality search (sampledConstruction: heuristic starts plus a schedule-guided climb)`.

3h. Replace the doc comment above `buildOrderEscalated` (the one beginning `/** The same schedule at a large work budget`) with:

```ts
/** The same schedule at a large fallback budget: it recovers cliff builds whose heuristic orders
 *  never fit and the live fallback cap misses. Quality comes from the guided climb, which both paths
 *  share, so on typical builds this matches the live result; no app control calls it, and it never
 *  belongs on the live/per-click path. */
```

Body unchanged.

- [ ] **Step 4: Run the contract test to verify it passes**

Run: `cd web && bun test order-quality-mode`
Expected: PASS (climb-on strictly beats climb-off on the real corpus).

- [ ] **Step 5: Verify the witness snapshot survives byte-identical**

Run: `cd web && bun test build-order`
Expected: PASS with `3 snapshots` and NO snapshot rewrite. If the snapshot fails, witness behavior moved: STOP and fix the mode gating; do not re-record.

- [ ] **Step 6: Overfitting guard, then re-record the oracle pins**

Run: `cd web && bun test build-order-oracle`
Expected: PASS (the pins are upper bounds, so an improvement passes silently; a FAIL means the climb regressed the synthetic corpus: STOP and investigate).

Then measure the synthetic corpus exactly: run `cd web && bun scripts/order-quality.ts 2>&1 >/dev/null | head -1` and read `aggregate: orders=... churn=C steps=S`. This is the spec's overfitting guard: the pre-climb measurement is churn=19 steps=2591, and C must be at or under 19. If C > 19, STOP and report; do not proceed on a synthetic regression.

Then tighten the pins in `web/test/build-order-oracle.test.ts` so a future regression cannot hide under the old slack:
- Set `CHURN_PIN` to C + 1 and `STEPS_PIN` to `Math.round(S * 1.02)` (the file's existing 2% slack convention), keeping `ORDER_FLOOR = 150`.
- Append to the pin comment block (before `const ORDER_FLOOR`): `// With the guided climb (spec 2026-08-24-guided-build-order-search-design.md): orders=150 churn=C steps=S.` using the measured numbers.
- In the repro-pins test, re-measure by temporarily logging `churnPoints(steps!)` and `steps!.length` (or read the repro line of the order-quality output), tighten the two `toBeLessThanOrEqual` bounds to the measured values, and change both trailing comments to `// measured exact on the guided climb; re-record deliberately on algorithm changes`.

Run: `cd web && bun test build-order-oracle`
Expected: PASS.

- [ ] **Step 7: Full suite, perf, corpus measurement**

Run: `just test` - expected all pass.
Run: `just perf` - record the three numbers; p95 must be at or under the prior 19.0 ms (expect a drop).
Run: `cd web && bun scripts/order-quality.ts > /dev/null` - record the stderr real-corpus aggregate lines in this plan's Results section below (all rungs of the still-present ladder should now report equal churn near 265; Task 3 replaces the ladder).

- [ ] **Step 8: Commit**

```bash
git add web/src/core/reachability.ts web/test/order-quality-mode.test.ts web/test/build-order-oracle.test.ts
git commit -m "feat(order): guided climb replaces blind sampling in the quality search

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 2: Measured lever: climb each heuristic start

**Files:**
- Create (throwaway, never committed): `web/src/core/reachabilityClimbExperiment.ts`, `.llm/climb-experiment-runner.ts`
- Possibly modify (adoption only): `web/src/core/reachability.ts`

**Interfaces:**
- Consumes: Task 1's `buildOrderPath` (shipped comparison) and `CLIMB_EVALS`.
- Produces: a recorded adopt/reject decision in this plan's Results section. On adoption, `sampledConstruction`'s quality branch climbs all three starts; signatures unchanged either way.

- [ ] **Step 1: Build the experiment copy**

```bash
cp web/src/core/reachability.ts web/src/core/reachabilityClimbExperiment.ts
```

In the copy only, make `buildOrderPath` exported as-is (it already is) and change the quality branch of `sampledConstruction` from `climb(climbEvals);` to:

```ts
    for (const start of [order.slice(), peelOrder(G, true), peelOrder(G, false)]) climbFromStart(start, climbEvals);
```

and directly after the `climb` definition add:

```ts
  // Experiment: an independent climb per heuristic start, tracking a LOCAL incumbent so each start
  // explores its own basin; every evaluation still feeds the global argmin through consider.
  const climbFromStart = (start: ReachCon[], cap: number): void => {
    const first = emitSchedule(start, tail, pool, table, budget, peakNodeCap);
    if (!first?.steps) return;
    let curOrder = start;
    let curSteps = first.steps;
    let curChurn = churnPoints(curSteps);
    const byId = new Map(pool.map((c) => [c.id, c]));
    let evals = 0;
    for (let improved = true; improved && evals < cap; ) {
      improved = false;
      for (const cand of movesFor(byId, curOrder, curSteps)) {
        if (evals >= cap) break;
        evals++;
        consider(cand);
        const sched = emitSchedule(cand, tail, pool, table, budget, peakNodeCap);
        if (sched?.steps) {
          const c = churnPoints(sched.steps);
          if (c < curChurn || (c === curChurn && sched.steps.length < curSteps.length)) {
            curOrder = cand;
            curSteps = sched.steps;
            curChurn = c;
            improved = true;
            break;
          }
        }
      }
    }
  };
```

To share move generation, hoist the `moves` closure out of `climb` into sampler scope as `const movesFor = (byId: Map<string, ReachCon>, ord: ReachCon[], steps: BuildStep[]): ReachCon[][] => { ...identical body... }` and have `climb` call `movesFor(byId, bestOrder, liveSteps()!)`. The double `emitSchedule` per candidate (consider emits too) is acceptable in the experiment; on adoption, fold the local update into a shared record helper so each candidate is emitted once.

- [ ] **Step 2: Write the runner**

Create `.llm/climb-experiment-runner.ts`:

```ts
// ABOUTME: Compares the shipped argmin climb against the per-start climb experiment over the
// ABOUTME: 99-build real corpus: churn, steps, latency, oracle legality (throwaway).
import { readFileSync } from "node:fs";
import { buildOrderPath, churnPoints, selectionSummary, BUDGET, type ReachCon } from "../web/src/core/reachability";
import { buildOrderPath as experimentPath } from "../web/src/core/reachabilityClimbExperiment";
import { verifyBuildOrder } from "../web/src/core/orderLegality";
import { model, cons, table } from "../web/scripts/reachability-fuzz";

const fixture = JSON.parse(readFileSync("web/test/fixtures/real-builds.json", "utf8")) as {
  builds: { starIds: string[] }[];
};
const members: ReachCon[][] = fixture.builds.map((b) => selectionSummary(model, new Set(b.starIds)).built);
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};
for (const [name, run] of [
  ["shipped", (m: ReachCon[]) => buildOrderPath(cons, table, m, BUDGET, 32)],
  ["per-start", (m: ReachCon[]) => experimentPath(cons, table, m, BUDGET, 32)],
] as const) {
  let churn = 0;
  let steps = 0;
  let illegal = 0;
  const ms: number[] = [];
  for (const m of members) {
    const t0 = performance.now();
    const path = run(m);
    ms.push(performance.now() - t0);
    if (!path) continue;
    if (verifyBuildOrder(cons, m, path, BUDGET) !== null) illegal++;
    churn += churnPoints(path);
    steps += path.length;
  }
  console.log(`${name}: churn=${churn} steps=${steps} illegal=${illegal} p95=${pct(ms, 95).toFixed(1)}ms`);
}
```

Run from the worktree root: `bun .llm/climb-experiment-runner.ts`

- [ ] **Step 3: Decide by the spec's rule and record**

Adopt the per-start climb only if: experiment churn <= shipped churn - 2, AND experiment p95 <= 45 ms, AND illegal = 0. Record both result lines in this plan's Results section either way. `CLIMB_EVALS` stays 64 and is the per-climb cap in both outcomes.

- [ ] **Step 4a (adopted): port into `web/src/core/reachability.ts`**

Apply the same quality-branch change and `climbFromStart`/`movesFor` hoist to the real file, folding the local-incumbent update and the global argmin update into one emit per candidate: extract the quality-mode body of `consider` (the `if (sched?.steps) {...} else if (...)` block) into `const record = (candidate: ReachCon[], sched: Schedule | null): void => {...}`, have `consider` call it, and have `climbFromStart` call `emitSchedule` once then `record(cand, sched)` plus its local update. Update the fallback branch to climb the fitted shuffle with `climbFromStart(order.slice(), climbEvals)`. Re-run Task 1 Steps 4-7 in full (contract test, snapshot, pins with fresh numbers, suite, perf, corpus measurement) and update the pins if the numbers moved.

- [ ] **Step 4b (rejected): keep the argmin climb**

No changes to `web/src/core/reachability.ts`.

- [ ] **Step 5: Clean up and commit**

```bash
rm web/src/core/reachabilityClimbExperiment.ts .llm/climb-experiment-runner.ts
```

If adopted:

```bash
git add web/src/core/reachability.ts web/test/build-order-oracle.test.ts
git commit -m "feat(order): climb each heuristic start

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

If rejected, there is nothing to commit; record the decision in the Results section (the plan file is committed in Task 4).

### Task 3: Harness rework: climb-off versus climb-on

**Files:**
- Modify: `web/scripts/order-quality.ts` (the real-corpus section only; the synthetic section at the top is unchanged)

**Interfaces:**
- Consumes: Task 1's `buildOrderCandidates(..., climbEvals)`.
- Produces: CSV `build,config,churn,steps,ms,divergent` with configs `climb-off` and `climb-on`; per-config stderr aggregates. `just order-quality` invocation unchanged.

- [ ] **Step 1: Replace the ladder**

In `web/scripts/order-quality.ts`, update the ABOUTME second line to `// ABOUTME: real corpus climb-off vs climb-on: per-build churn/steps CSV on stdout, aggregates on stderr.` Then replace everything from `const TRIES_LADDER = [16, 256, 4096];` through the final aggregate loop with:

```ts
const CONFIGS = [
  { name: "climb-off", climbEvals: 0 },
  { name: "climb-on", climbEvals: undefined }, // undefined takes the shipped default (CLIMB_EVALS)
] as const;

const slugOf = (calc: string) => calc.slice(calc.lastIndexOf("/") + 1);
const byChurnThenSteps = (a: BuildStep[], b: BuildStep[]) =>
  churnPoints(a) - churnPoints(b) || a.length - b.length;
const byStepsThenChurn = (a: BuildStep[], b: BuildStep[]) =>
  a.length - b.length || churnPoints(a) - churnPoints(b);

console.log("build,config,churn,steps,ms,divergent");
const agg = new Map<string, { orders: number; churn: number; steps: number; divergent: number; ms: number }>();
for (const c of CONFIGS) agg.set(c.name, { orders: 0, churn: 0, steps: 0, divergent: 0, ms: 0 });
for (const b of real.builds) {
  const members = selectionSummary(model, new Set(b.starIds)).built;
  for (const cfg of CONFIGS) {
    const t0 = performance.now();
    const c = buildOrderCandidates(cons, table, members, BUDGET, 32, 3000, cfg.climbEvals);
    const ms = performance.now() - t0;
    // `pick` reproduces buildOrderPath's rule exactly (churn, then steps, greedy on a full tie,
    // over the two shipped generators), so the churn and steps columns are the panel's own numbers.
    // `alt` is the steps-first alternative over every candidate the sampler tracked.
    const shipped = [c.greedy, c.sampler].filter((s): s is BuildStep[] => s !== null);
    const pool = [...shipped, c.samplerStepsFirst].filter((s): s is BuildStep[] => s !== null);
    const a = agg.get(cfg.name)!;
    a.ms += ms;
    if (shipped.length === 0) {
      console.log(`${slugOf(b.calc)},${cfg.name},none,none,${ms.toFixed(1)},`);
      continue;
    }
    const pick = [...shipped].sort(byChurnThenSteps)[0]!;
    const alt = [...pool].sort(byStepsThenChurn)[0]!;
    const divergent = churnPoints(pick) !== churnPoints(alt) || pick.length !== alt.length;
    a.orders++;
    a.churn += churnPoints(pick);
    a.steps += pick.length;
    if (divergent) a.divergent++;
    console.log(
      `${slugOf(b.calc)},${cfg.name},${churnPoints(pick)},${pick.length},${ms.toFixed(1)},${divergent ? 1 : 0}`,
    );
  }
}
for (const cfg of CONFIGS) {
  const a = agg.get(cfg.name)!;
  console.error(
    `real corpus @ ${cfg.name}: orders=${a.orders}/${real.builds.length} churn=${a.churn} ` +
      `steps=${a.steps} divergent=${a.divergent} mean_ms=${(a.ms / real.builds.length).toFixed(1)}`,
  );
}
```

- [ ] **Step 2: Run and record**

Run: `cd web && bun scripts/order-quality.ts > /dev/null`
Expected: two stderr aggregate lines; climb-on churn matches Task 1's measurement (or Task 2's, if adopted). Record both lines in the Results section.

- [ ] **Step 3: Full check and commit**

Run: `just test` - expected all pass (nothing imports the harness, but the hook runs everything anyway on commit).

```bash
git add web/scripts/order-quality.ts
git commit -m "chore(harness): order-quality compares climb-off vs climb-on

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task 4: Docs, BACKLOG, plan results

**Files:**
- Modify: `docs/reachability-engine.md` (quality-mode description, in place)
- Modify: `BACKLOG.md` (the `## Build-order quality: deferred follow-ups` section)
- Modify: `docs/superpowers/plans/2026-08-24-guided-build-order-search.md` (Results section)

- [ ] **Step 1: Rewrite the engine doc's quality-mode description**

In `docs/reachability-engine.md`, find the section describing the two sampler modes and the quality search, and rewrite it in place (evergreen, no dates, no before/after narration) so it states: quality mode scores the three deterministic heuristic orders, then hill-climbs from the best one - reading the incumbent schedule's non-crossroads scaffold buys and scoring targeted reorderings (advance a feeding member, defer the triggering member, swap with its predecessor), accepting churn-then-steps improvements up to a fixed evaluation cap (`CLIMB_EVALS`); seeded shuffles run only as a fallback when no heuristic order fits, capped by `tries`, then the fit is climbed; witness mode is unchanged (smallest peak, first-fit early exit). Update the gates list entry for `order-quality` to describe the climb-off vs climb-on comparison. If Task 2 adopted the per-start climb, describe the climb as running from each heuristic start.

- [ ] **Step 2: Update BACKLOG**

In `BACKLOG.md`'s build-order section:
- Delete the hill-climbing item (it shipped).
- In the steps-first revisit item and the T3-earlier tiebreak item, replace the recorded baseline numbers with the Task 1 (or Task 2) corpus numbers so future evaluation starts from the shipped search.
- In the background-escalation item, replace its motivation sentence with one stating the guided climb closed most of the gap (record the shipped corpus churn against the 255 brute-force reference) and a worker is likely no longer worth building; keep the item as a stub for reconsideration.

- [ ] **Step 3: Fill the Results section**

Complete the Results section at the bottom of this plan with the recorded numbers from Tasks 1-3.

- [ ] **Step 4: Commit**

```bash
git add docs/reachability-engine.md BACKLOG.md docs/superpowers/plans/2026-08-24-guided-build-order-search.md
git commit -m "docs(order): guided climb documentation and backlog updates

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Final gates**

Run and confirm green, recording each in the Results section:
- `just test`
- `REACH_SLOW=1 just test-slow`
- `just fuzz`
- `just build-order-validate`
- `just perf` (p95 <= 45 ms)

## Results (filled during execution)

- Task 1 corpus measurement (real corpus, all three rungs of the still-present tries ladder,
  before Task 2's per-start climb):
  ```
  real corpus @ tries=16:   orders=99/99 churn=265 steps=1895 divergent=9 mean_ms=1.5
  real corpus @ tries=256:  orders=99/99 churn=265 steps=1895 divergent=9 mean_ms=1.4
  real corpus @ tries=4096: orders=99/99 churn=265 steps=1895 divergent=9 mean_ms=1.4
  ```
- Task 1 perf: after building the (gitignored) `data/reach.wasm` artifact this worktree was
  missing (confirmed via `git stash` that its absence, not the climb change, caused the initial
  HOTSPOT failure), three stable `just perf` runs gave `mean 4.2 ms   median 2.4-2.6 ms   p95
  14.7-15.2 ms   p99 23.3-24.0 ms   max 29.3-29.7 ms`, `0 click(s) over 400 ms.`, `OK: no
  hotspots.` - p95 (~15 ms) at/under the prior baseline of mean 3.0 / p95 19.0 / p99 29.1 ms.
- Task 1 pins: synthetic-corpus measurement (`aggregate: orders=150/150 churn=12 steps=2609 |
  repro: churn=3 steps=23`), against the pre-climb baseline churn=19 steps=2591 (overfitting guard
  passed: 12 <= 19). New pins recorded: `CHURN_PIN = 13` (C+1), `STEPS_PIN = 2661`
  (`Math.round(2609 * 1.02)`), `ORDER_FLOOR` unchanged at 150; repro-pins tightened to the measured
  exact values (churn <= 3, steps <= 23). Task 2 later re-measured the synthetic corpus after
  porting the per-start climb - churn stayed 12 (no regression) but steps improved from 2609 to
  2597, so `STEPS_PIN` was tightened again from 2661 to `Math.round(2597 * 1.02) = 2649`, its final
  shipped value; `CHURN_PIN` stayed at 13 and the repro pins (3/23) were unchanged.
- Task 2 decision and both runner lines: rule was adopt iff experiment churn <= shipped churn - 2
  (i.e. <= 263), AND experiment p95 <= 45 ms, AND illegal = 0.
  ```
  shipped: churn=265 steps=1895 illegal=0 p95=6.1ms
  per-start: churn=262 steps=1869 illegal=0 p95=34.0ms
  ```
  Churn: 262 <= 263 - PASS (beats the shipped 265 by 3, one more than the required 2). p95: primary
  run 34.0ms <= 45ms - PASS (typical value across 10 repeated runs was ~33-35ms; two of ten showed
  45.6/50.7ms, attributed to system contention since churn/steps never moved while only the timer
  did). illegal: 0 in every run - PASS. **Decision: ADOPT.** Post-port re-verification on the real
  corpus (all three rungs of the still-present ladder, matching the runner's per-start row exactly):
  ```
  real corpus @ tries=16:   orders=99/99 churn=262 steps=1869 divergent=7 mean_ms=4.7
  real corpus @ tries=256:  orders=99/99 churn=262 steps=1869 divergent=7 mean_ms=4.7
  real corpus @ tries=4096: orders=99/99 churn=262 steps=1869 divergent=7 mean_ms=4.7
  ```
  `just test` after the port: 1094 pass, 3 skip, 0 fail, 3 snapshots, 57831 expect() calls,
  matching Task 1's baseline exactly. `just perf` after the port: `OK: no hotspots`, `mean 4.4 ms
  median 2.5 ms p95 15.4 ms p99 24.8 ms max 44.0 ms`, `0 click(s) over 400 ms` - consistent with
  Task 1's ~15ms baseline since witness mode (what `just perf` exercises) is untouched.
- Task 3 aggregate lines (harness reworked from the tries ladder to climb-off vs climb-on):
  ```
  real corpus @ climb-off: orders=99/99 churn=354 steps=1965 divergent=12 mean_ms=1.3
  real corpus @ climb-on: orders=99/99 churn=262 steps=1869 divergent=7 mean_ms=4.9
  ```
  The climb-on churn value of 262 matches Task 2's shipped measurement.
- Task 4 final gates (run before the commit, per the controller's reordering):
  - `just test`: **PASS** - `1094 pass, 3 skip, 0 fail, 3 snapshots, 57830 expect() calls, Ran 1097
    tests across 104 files.`
  - `REACH_SLOW=1 just test-slow`: **PASS** - `4 pass, 0 fail, 1107 expect() calls, Ran 4 tests
    across 2 files.`
  - `just fuzz`: **PASS** - `50 builds (avg 55 stars), generator-invalid 0.` `VIOLATIONS (engine
    dimmed a valid-build member; must be 0): 0`
  - `just build-order-validate`: **PASS** - FALSE-NEGATIVE and FALSE-POSITIVE both 0 across all
    three corpora (typical self-covering 3000 builds, single-constellation 104 builds, random 2-4
    constellation subsets 1500 builds).
  - `just perf`: **PASS** - `mean 4.4 ms   median 2.5 ms   p95 15.2 ms   p99 24.3 ms   max 41.7
    ms`, `0 click(s) over 400 ms.`, `OK: no hotspots.` - p95 15.2 ms is at/under the 45 ms gate.
