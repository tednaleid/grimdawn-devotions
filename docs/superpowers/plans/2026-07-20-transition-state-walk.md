# Transition State Walk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zero-slack transition pairs resolve incrementally (the owner's pair: at most 32 moved points, down from 130) via a deterministic state walk, selected best-of-candidates so no pair gets worse than today.

**Architecture:** A new pure `stateWalkTransition` in `web/src/core/transitionOrder.ts` walks the standing board from baseline to current, one oracle-legal move at a time, with strict priorities (target adds by need-driven score, free-point refunds zero-grant-first, minimal scaffolds, stuck-only shared teardowns). `transitionOrderPath` becomes a best-of-candidates selection (walk, existing two-pass replay, full respec) by fewest moved points. The merge gate: the owner's pair pinned, aggregate moved-points pins, no pair worse.

**Tech Stack:** TypeScript (bun), bun:test, just recipes. Spec: `docs/superpowers/specs/2026-07-20-transition-state-walk-design.md`. Branch: `compare-transition` (held from merge until this gate passes).

**Spec deviations (deliberate, small):** (1) move 2 generalizes from "refund a non-target" to "refund toward target", which also covers shrink-resizes (a shared member standing above its target count); (2) the spec's teardown condition ("the smallest whose removal unblocks progress") is realized as smallest-legal-first with the step budget as guard: "does it unblock" is answered by trying it, deterministically; (3) move 1 prefers never-torn candidates over re-adds of torn members, found by the Task 2 stuck-teardown test: with all deficits covered, the density score is uninformative and the plain id tie-break re-added the just-torn member; (4) move 2 skips load-bearing members (refunding a member whose exclusion would grow an outstanding deficit only forces a re-buy; found on the owner's pair, where the walk cycled add-scaffold/refund-scaffold and never reached the teardown) and scores candidates by effective standing grant, so a partial counts as zero-grant (the Ghoul observation). With (4) the owner's direction resolves at exactly the hand path (9 steps, 32 moved, walk-won); the swapped direction stays at full respec 130 (the walk returns null there) and REVERSED_PIN records that honest measurement.

## Global Constraints

- **Verified or absent unchanged:** the walk is a candidate, not an authority. Its output passes `verifyTransition` inside the selection and `gateTransition` at the display boundary, like every candidate. `web/src/core/orderLegality.ts` must not change.
- **Selection is never worse than today by construction:** the existing two candidates (`seededReplay` via `incrementalTransition`, `teardownRebuild`) stay in the pool unmodified; the winner is the best VERIFIED schedule by (fewest moved points, then fewest steps, then candidate order: walk, two-pass, full-respec).
- **Merge gate (spec, hard):** the owner's pair at most 32 moved points in the owner's direction (ghoul-side to eel-side) with exact measured pins both directions; aggregate moved-points pins across the four corpora at the post-walk measurement; zero oracle failures; per-pair no-regression versus the pre-walk branch (harness-verified, expected zero by construction); full gate, `just e2e`, `just perf` green.
- **Determinism:** no randomness in the walk; id tie-breaks everywhere; byte-identical output for identical inputs.
- **Boundaries:** `web/src/core/reachability.ts`, the panel, i18n, URL state untouched. `TransStep`, `TransitionRung`, and `selectionView` signatures unchanged (the panel keeps working with zero changes).
- **Constellation-level only:** no star-level moves.
- Terminology: "moved points" for a schedule = sum of `|to - from|` over its steps.
- All new files start with two `ABOUTME:` lines. Docs: no emojis, emdashes, or hyperbole.
- Run tests via `just` from the repo root. Commit with `git commit -F - <<'EOF'` heredoc; never `--no-verify`. Pre-commit gate takes 1-3 min. Measurement artifacts in `.superpowers/sdd/` (gitignored); headline numbers additionally in task reports.
- The owner's pair hashes (already in `web/test/support/transition-pairs.ts` `urlFixturePairs`): base = ghoul-side, cur = eel-side - this IS the owner's direction. The reference hand path (9 steps, 32 moved, oracle-verified): refund ghoul 4 to 0; add eel 0 to 3; add crossroads_chaos 0 to 1; refund kraken 5 to 0; refund yugol_the_insatiable_night 6 to 0; add crossroads_order 0 to 1; add tortoise 0 to 5; refund crossroads_order 1 to 0; add yugol_the_insatiable_night 0 to 6.

---

### Task 1: Harness per-pair measurement and the pre-walk baseline

**Files:**
- Modify: `web/scripts/transition-spike.ts` (a `--csv` mode and a winner column)

**Interfaces:**
- Consumes: the existing harness (`measure`, `report`, corpora loops) and `PairResult` (which already carries `corpus`, `rung`, `moved`).
- Produces: `just spike-transition --csv` printing one line per pair to stdout: `corpus,index,rung,moved` (header line first), aggregates still on the normal report path (use stderr for the report when `--csv` is set, or suppress the report - implementer's choice, disclosed); baseline file `.superpowers/sdd/transition-baseline.csv` (read by Task 4).

- [ ] **Step 1: Add the CSV mode**

In `web/scripts/transition-spike.ts`, add a `--csv` flag beside the existing flag parsing. When set, after all `results` are collected, print `corpus,index,rung,moved` then one line per result in collection order (index = position within its corpus). Route the human report to stderr in CSV mode so stdout stays clean. Pair generation is already seeded and deterministic, so line N always describes the same pair across runs - that is what makes before/after diffing valid.

- [ ] **Step 2: Capture the baseline (BEFORE any algorithm change)**

```bash
just spike-transition --pairs 100 --csv > .superpowers/sdd/transition-baseline.csv 2> .superpowers/sdd/transition-baseline-report.txt
tail -5 .superpowers/sdd/transition-baseline-report.txt
awk -F, 'NR>1 { m[$1]+=$4; n[$1]++ } END { for (c in m) printf "%s: pairs=%d moved=%d\n", c, n[c], m[c] }' .superpowers/sdd/transition-baseline.csv
```

Expected: the report shows zero oracle failures; the awk summary prints per-corpus totals. Copy the per-corpus totals into your task report - these are the launch-gate "before" numbers.

- [ ] **Step 3: Full suite, then commit**

Run: `just test`
Expected: all pass (the harness is not under test; nothing else changed).

```bash
git add web/scripts/transition-spike.ts
git commit -F - <<'EOF'
feat(transition): harness per-pair CSV mode; pre-walk baseline captured
EOF
```

---

### Task 2: stateWalkTransition (pure, unit-tested, unwired)

**Files:**
- Modify: `web/src/core/transitionOrder.ts` (new exported function, placed after `teardownRebuild`)
- Create: `web/test/transition-walk.test.ts`

**Interfaces:**
- Consumes: the module's existing local helpers (`zero`, `addCap`, `maxV`, `covers`, `REPLAY_CAP`), `peakToReach`/`INF` (already imported), types `ReachCon`, `Vec`, `CoverTable`, `TransStep`.
- Produces: `export function stateWalkTransition(cons: ReachCon[], table: CoverTable, base: ReachCon[], cur: ReachCon[], cap: number): TransStep[] | null` - Task 3 wires it into the selection.

- [ ] **Step 1: Write the failing unit tests**

Create `web/test/transition-walk.test.ts`:

```ts
// ABOUTME: Unit tests for stateWalkTransition: free-refund priority, the stuck-only shared
// ABOUTME: teardown, termination bounds, determinism, and oracle-legality of every result.
import { test, expect } from "bun:test";
import { stateWalkTransition } from "../src/core/transitionOrder";
import { verifyTransition } from "../src/core/orderLegality";
import { buildCoverTable, type ReachCon, type Vec } from "../src/core/reachability";
import { cons as realCons, table as realTable, mulberry32 } from "../scripts/reachability-fuzz";
import { mutatePair } from "./support/transition-pairs";

const z = (): Vec => [0, 0, 0, 0, 0];
const v = (asc = 0, cha = 0, eld = 0, ord = 0, pri = 0): Vec => [asc, cha, eld, ord, pri];
const con = (id: string, size: number, req: Vec, grant: Vec): ReachCon => ({ id, size, req, grant });

test("free points first: a zero-grant leftover refunds before a granting one", () => {
  // Base holds two leftovers; cur is just the kept granter. Both leftovers are legally
  // refundable at once; the zero-grant one must go first.
  const keep = con("keep", 2, z(), v(3));
  const freeL = con("freeloader", 3, v(1), z());
  const granterL = con("granter", 3, v(1), v(2));
  const all = [keep, freeL, granterL];
  const walk = stateWalkTransition(all, buildCoverTable(all), [keep, freeL, granterL], [keep], 55)!;
  expect(walk).not.toBeNull();
  const refundIds = walk.filter((s) => s.kind === "refund").map((s) => s.conId);
  expect(refundIds[0]).toBe("freeloader");
  expect(verifyTransition(all, [keep, freeL, granterL], [keep], walk, 55)).toBeNull();
});

test("stuck-only teardown: the zero-slack blocked-refund pair resolves", () => {
  // leftover L props shared S; cur swaps L for target T (same grant shape); cap has zero slack.
  // The only way through: tear S down, add T, refund L, re-add S. No move without the teardown.
  const L = con("leftover", 3, z(), v(3));
  const S = con("shared", 4, v(3), z());
  const T = con("target", 3, z(), v(3));
  const all = [L, S, T];
  const tbl = buildCoverTable(all);
  const walk = stateWalkTransition(all, tbl, [L, S], [S, T], 7)!;
  expect(walk).not.toBeNull();
  expect(verifyTransition(all, [L, S], [S, T], walk, 7)).toBeNull();
  // the teardown happened: S refunds and re-adds
  expect(walk.some((s) => s.conId === "shared" && s.kind === "refund")).toBeTrue();
  expect(walk.some((s) => s.conId === "shared" && s.kind === "add")).toBeTrue();
  const moved = walk.reduce((a, s) => a + Math.abs(s.to - s.from), 0);
  expect(moved).toBeLessThanOrEqual(4 * 6); // within the budget bound (theoretical min 6)
});

test("an impossible pair returns null instead of spinning", () => {
  // cur demands a constellation whose requirement nothing in the universe can cover.
  const lone = con("lone", 3, v(9), z());
  const helper = con("helper", 2, z(), v(1));
  const all = [lone, helper];
  expect(stateWalkTransition(all, buildCoverTable(all), [helper], [helper, lone], 55)).toBeNull();
});

test("deterministic: byte-identical output across calls", () => {
  const pair = mutatePair(mulberry32(7));
  if (!pair) return;
  const a = JSON.stringify(stateWalkTransition(realCons, realTable, pair.base, pair.cur, 55));
  const b = JSON.stringify(stateWalkTransition(realCons, realTable, pair.base, pair.cur, 55));
  expect(a).toBe(b);
});

test("every walk result on 20 small-delta pairs is oracle-clean", () => {
  const rng = mulberry32(4242);
  let produced = 0;
  for (let i = 0; i < 40 && produced < 20; i++) {
    const pair = mutatePair(rng);
    if (!pair) continue;
    const walk = stateWalkTransition(realCons, realTable, pair.base, pair.cur, 55);
    if (!walk) continue;
    produced++;
    expect(verifyTransition(realCons, pair.base, pair.cur, walk, 55)).toBeNull();
  }
  expect(produced).toBeGreaterThan(10);
});

test("a load-bearing scaffold is not refunded while its beneficiary is pending", () => {
  // X's grant is the only cover for pending T's requirement; cap blocks adding T while B stands.
  // Without the exclusion, the walk toggles X (refund as "free", re-add as scaffold) and never
  // reaches the teardown of B; with it, X waits until T completes and self-sustains.
  const B = con("blob", 4, z(), z());
  const X = con("prop", 1, z(), v(0, 1));
  const T = con("target", 3, v(0, 1), v(0, 3));
  const all = [B, X, T];
  const walk = stateWalkTransition(all, buildCoverTable(all), [B, X], [B, T], 7);
  expect(walk).not.toBeNull();
  expect(verifyTransition(all, [B, X], [B, T], walk!, 7)).toBeNull();
  const xRefund = walk!.findIndex((s) => s.conId === "prop" && s.kind === "refund");
  const tAdd = walk!.findIndex((s) => s.conId === "target" && s.kind === "add");
  expect(tAdd).toBeGreaterThanOrEqual(0);
  expect(xRefund).toBeGreaterThan(tAdd);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `just test test/transition-walk.test.ts`
Expected: FAIL - `stateWalkTransition` is not exported.

- [ ] **Step 3: Implement the walk**

In `web/src/core/transitionOrder.ts`, after `teardownRebuild`, add:

```ts
/**
 * The state walk: a deterministic greedy over actual game states, from the baseline's standing
 * board toward the current build, one oracle-legal move at a time. Priorities each iteration:
 * (1) complete a target member, never-torn candidates before re-adds of torn ones, then the densest
 * contributor to the outstanding deficits per moved star, ties by id; (2) free points - refund any
 * standing constellation above its target count whose grant no outstanding deficit leans on,
 * zero-effective-grant members first, then the grant least useful to the remaining deficits, ties
 * by id; (3) add one scaffold from peakToReach's minimal
 * crossroads-biased set when it fits; (4) only
 * when stuck, tear down a standing at-target member (smallest legal first, ties by id, each torn
 * at most once) - it rejoins the pool and move 1 re-adds it later. Bounded: total moved points may
 * not exceed four times the theoretical minimum; exceeding it, or having no legal move, returns
 * null. The walk is a candidate, not an authority: callers verify its output like any other.
 */
export function stateWalkTransition(
  cons: ReachCon[],
  table: CoverTable,
  base: ReachCon[],
  cur: ReachCon[],
  cap: number,
): TransStep[] | null {
  const conById = new Map(cons.map((c) => [c.id, c]));
  const want = new Map(cur.map((c) => [c.id, c.size]));
  const counts = new Map<string, number>(base.map((c) => [c.id, c.size]));
  const steps: TransStep[] = [];
  const tornOnce = new Set<string>();
  let running = [...counts.values()].reduce((a, b) => a + b, 0);
  let theoreticalMin = 0;
  for (const [id, n] of counts) theoreticalMin += Math.abs(n - (want.get(id) ?? 0));
  for (const [id, n] of want) if (!counts.has(id)) theoreticalMin += n;
  const budget = Math.max(theoreticalMin, 1) * 4;
  let movedTotal = 0;

  // The oracle's standing rule (capped, verdict-equivalent): complete grants cover every started
  // requirement, with `pending` counted as requirement but not grant (the mid-step point).
  const valid = (pending: string | null): boolean => {
    let grant = zero();
    let req = zero();
    for (const [id, n] of counts) {
      if (n <= 0) continue;
      const c = conById.get(id)!;
      req = maxV(req, c.req);
      if (n >= c.size && id !== pending) grant = addCap(grant, c.grant);
    }
    if (pending) {
      const pc = conById.get(pending);
      if (pc) req = maxV(req, pc.req);
    }
    return covers(grant, req);
  };
  const restore = (id: string, from: number): void => {
    if (from === 0) counts.delete(id);
    else counts.set(id, from);
  };
  // Would this move be legal? Mutates and restores; emit() re-applies for real.
  const probe = (kind: "add" | "refund", id: string, to: number): boolean => {
    const from = counts.get(id) ?? 0;
    if (kind === "add" ? to <= from : to >= from) return false;
    if (kind === "add" && running + (to - from) > cap) return false;
    counts.set(id, to);
    const ok = valid(id) && valid(null);
    restore(id, from);
    return ok;
  };
  const emit = (kind: "add" | "refund", id: string, to: number): void => {
    const from = counts.get(id) ?? 0;
    counts.set(id, to);
    running += to - from;
    movedTotal += Math.abs(to - from);
    steps.push({ kind, conId: id, from, to, heldAfter: running });
    if (to === 0) counts.delete(id);
  };
  const standingGrant = (excl: string | null = null): Vec => {
    let g = zero();
    for (const [id, n] of counts) {
      if (id === excl) continue;
      const c = conById.get(id)!;
      if (n >= c.size) g = addCap(g, c.grant);
    }
    return g;
  };
  // What the not-yet-at-target members still demand beyond the standing complete grants
  // (optionally pretending one standing member is gone, to ask whether it is load-bearing).
  const deficitVec = (excl: string | null = null): Vec => {
    const g = standingGrant(excl);
    const d = zero();
    for (const [id, size] of want) {
      if ((counts.get(id) ?? 0) === size) continue;
      const c = conById.get(id)!;
      for (let i = 0; i < 5; i++) d[i] = Math.max(d[i]!, Math.max(0, c.req[i]! - g[i]!));
    }
    return d;
  };
  const done = (): boolean => {
    if (counts.size !== want.size) return false;
    for (const [id, n] of want) if (counts.get(id) !== n) return false;
    return true;
  };
  const grantSum = (c: ReachCon) => c.grant[0] + c.grant[1] + c.grant[2] + c.grant[3] + c.grant[4];

  while (!done()) {
    if (movedTotal > budget) return null;
    const d = deficitVec();
    // 1. Complete a target member: never-torn candidates before re-adds of torn ones (re-adding
    // a just-torn member would recreate the state the teardown escaped), then densest deficit
    // contribution per moved star, ties by id.
    {
      let pick: string | null = null;
      let pickPts = 0;
      let pickDelta = 1;
      let pickTorn = 1;
      for (const [id, size] of want) {
        const at = counts.get(id) ?? 0;
        if (at >= size || !probe("add", id, size)) continue;
        const c = conById.get(id)!;
        let pts = 0;
        if (size === c.size) for (let i = 0; i < 5; i++) if (d[i]! > 0) pts += c.grant[i]!;
        const delta = size - at;
        const torn = tornOnce.has(id) ? 1 : 0;
        if (
          pick === null ||
          torn < pickTorn ||
          (torn === pickTorn &&
            (pts * pickDelta > pickPts * delta || (pts * pickDelta === pickPts * delta && id < pick)))
        ) {
          pick = id;
          pickPts = pts;
          pickDelta = delta;
          pickTorn = torn;
        }
      }
      if (pick !== null) {
        emit("add", pick, want.get(pick)!);
        continue;
      }
    }
    // 2. Free points: refund anything standing above its target whose grant no outstanding
    // deficit leans on (a load-bearing scaffold would only be re-bought; it waits until its
    // beneficiary completes and self-sustains). Zero-effective-grant members first (a partial
    // grants nothing, the Ghoul observation), then the grant least useful to the remaining
    // deficits, ties by id. Covers leftovers, spent scaffolds, and shrink-resizes alike
    // (refund toward target, not just to zero).
    {
      const cands: { id: string; free: number; useful: number }[] = [];
      for (const [id, n] of counts) {
        const target = want.get(id) ?? 0;
        if (n <= target || !probe("refund", id, target)) continue;
        const c = conById.get(id)!;
        const granting = n >= c.size; // only a complete member's grant is standing
        if (granting) {
          const dx = deficitVec(id);
          if (dx.some((x, i) => x > d[i]!)) continue; // load-bearing: not free
        }
        let useful = 0;
        if (granting) for (let i = 0; i < 5; i++) if (d[i]! > 0) useful += c.grant[i]!;
        cands.push({ id, free: granting && grantSum(c) > 0 ? 1 : 0, useful });
      }
      if (cands.length) {
        cands.sort((a, b) => a.free - b.free || a.useful - b.useful || (a.id < b.id ? -1 : 1));
        const r = cands[0]!;
        emit("refund", r.id, want.get(r.id) ?? 0);
        continue;
      }
    }
    // 3. Scaffold: one constellation from peakToReach's minimal set for the binding deficit.
    {
      const need: ReachCon[] = [];
      const pool = cons.filter((c) => !want.has(c.id) && (counts.get(c.id) ?? 0) === 0);
      const sz = peakToReach(pool, table, d, standingGrant(), REPLAY_CAP, {
        collect: need,
        preferSmall: true,
      });
      if (sz < INF && sz > 0) {
        let added = false;
        for (const s of need)
          if (probe("add", s.id, s.size)) {
            emit("add", s.id, s.size);
            added = true;
            break;
          }
        if (added) continue;
      }
    }
    // 4. Teardown, only when stuck: smallest legal at-target member, ties by id, each torn once.
    {
      const tearCands = [...counts.keys()]
        .filter((id) => {
          const t = want.get(id) ?? 0;
          return t > 0 && (counts.get(id) ?? 0) === t && !tornOnce.has(id);
        })
        .map((id) => conById.get(id)!)
        .sort((a, b) => a.size - b.size || (a.id < b.id ? -1 : 1));
      let torn = false;
      for (const c of tearCands)
        if (probe("refund", c.id, 0)) {
          emit("refund", c.id, 0);
          tornOnce.add(c.id);
          torn = true;
          break;
        }
      if (torn) continue;
    }
    return null; // no legal move of any kind: genuinely stuck
  }
  return steps;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `just test test/transition-walk.test.ts`
Expected: 6 pass (five original tests plus the load-bearing-scaffold test from deviation 4). Triage note: the stuck-teardown test's scenario was hand-traced during design (tear `shared`, add `target`, refund `leftover`, re-add `shared`); if it fails, instrument which move list came up empty at the stuck state rather than adjusting priorities blindly, and report BLOCKED if the cause is unclear.

- [ ] **Step 5: Full suite, then commit**

Run: `just test`
Expected: all pass (nothing calls the walk yet).

```bash
git add web/src/core/transitionOrder.ts web/test/transition-walk.test.ts
git commit -F - <<'EOF'
feat(transition): stateWalkTransition, the deterministic state walk (pure, unit-tested)
EOF
```

---

### Task 3: Best-of-candidates selection and the owner's-pair fixture

**Files:**
- Modify: `web/src/core/transitionOrder.ts` (`transitionOrderPath` body only)
- Modify: `web/test/transition-order.test.ts` (the Eel-pair pin consciously updated; new fixture tests)

**Interfaces:**
- Consumes: `stateWalkTransition` (Task 2), existing `incrementalTransition`/`teardownRebuild`/`verifyTransition`.
- Produces: `transitionOrderPath` unchanged in signature, now selecting the best verified candidate by (moved points, steps, candidate order). Task 4 measures through it.

- [ ] **Step 1: Write the failing fixture tests**

In `web/test/transition-order.test.ts`, REPLACE the test "the Eel pair (real URL): oracle-clean; Ghoul refunds before any add" with (the old full-respec pin was explicitly provisional - its own comment says a replay improvement should consciously revisit it; this is that revisit):

```ts
test("the owner's pair resolves incrementally at or below the hand path's 32 moved points", () => {
  const [pair] = urlFixturePairs();
  const res = transitionOrderPath(cons, table, pair!.base, pair!.cur, 55);
  clean(pair!.base, pair!.cur, res, 55);
  expect(res!.rung).toBe("incremental");
  const moved = res!.steps.reduce((a, s) => a + Math.abs(s.to - s.from), 0);
  expect(moved).toBeLessThanOrEqual(32); // the owner's hand path bound (9 steps, 32 moved)
  // the zero-grant Ghoul partial is free points: it still refunds before any add
  const ghoulRefund = res!.steps.findIndex((s) => s.conId.includes("ghoul") && s.kind === "refund");
  const firstAdd = res!.steps.findIndex((s) => s.kind === "add");
  expect(ghoulRefund).toBeGreaterThanOrEqual(0);
  if (firstAdd >= 0) expect(ghoulRefund).toBeLessThan(firstAdd);
});

test("the owner's pair swapped is oracle-clean and no worse than full respec", () => {
  const [pair] = urlFixturePairs();
  const res = transitionOrderPath(cons, table, pair!.cur, pair!.base, 55);
  clean(pair!.cur, pair!.base, res, 55);
  const moved = res!.steps.reduce((a, s) => a + Math.abs(s.to - s.from), 0);
  expect(moved).toBeLessThanOrEqual(REVERSED_PIN); // the measured value (130, unchanged; see deviation 4)
});

test("selection never returns more moved points than the full respec candidate", () => {
  const rng = mulberry32(31337);
  for (let i = 0; i < 20; i++) {
    const pair = mutatePair(rng);
    if (!pair) continue;
    const res = transitionOrderPath(cons, table, pair.base, pair.cur, 55);
    const td = teardownRebuild(cons, table, pair.base, pair.cur, 55);
    if (!res || !td || verifyTransition(cons, pair.base, pair.cur, td, 55) !== null) continue;
    const moved = (s: typeof res.steps) => s.reduce((a, x) => a + Math.abs(x.to - x.from), 0);
    expect(moved(res.steps)).toBeLessThanOrEqual(moved(td));
  }
});
```

`REVERSED_PIN` is a named constant set from the Step 4 measurement (exact, the function is deterministic), with a comment recording the measured value and the 130 it replaced.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `just test test/transition-order.test.ts`
Expected: the replaced test FAILS (today's rung is full-respec at 130 moved) - this is the RED that proves the pin bites. The selection test may pass already (the ladder never beats full respec by construction today); that is fine.

- [ ] **Step 3: Implement the selection**

Replace `transitionOrderPath`'s body (signature, doc-comment updated to match, identity edge kept verbatim):

```ts
export function transitionOrderPath(
  cons: ReachCon[],
  table: CoverTable,
  base: ReachCon[],
  cur: ReachCon[],
  cap: number,
  tries = 16,
): { steps: TransStep[]; rung: TransitionRung } | null {
  const conById = new Map(cons.map((c) => [c.id, c]));
  const delta = diffBuilds(base, cur, conById);
  if (!delta.baseOnly.length && !delta.curOnly.length && !delta.resize.length) {
    const size = cur.reduce((a, c) => a + c.size, 0);
    return size <= cap ? { steps: [], rung: "incremental" } : null;
  }
  // Best of all verified candidates by (moved points, steps, candidate order). Today's two
  // candidates stay in the pool, so no pair can do worse than before the walk existed.
  const clean = (steps: TransStep[] | null) => steps && verifyTransition(cons, base, cur, steps, cap) === null;
  const moved = (steps: TransStep[]) => steps.reduce((a, s) => a + Math.abs(s.to - s.from), 0);
  const candidates: { steps: TransStep[]; rung: TransitionRung }[] = [];
  const walk = stateWalkTransition(cons, table, base, cur, cap);
  if (clean(walk)) candidates.push({ steps: walk!, rung: "incremental" });
  const s0 = seededReplay(cons, table, conById, delta, cap, tries);
  if (clean(s0)) candidates.push({ steps: s0!, rung: "incremental" });
  const s2 = teardownRebuild(cons, table, base, cur, cap);
  if (clean(s2)) candidates.push({ steps: s2!, rung: "full-respec" });
  if (!candidates.length) return null;
  let best = candidates[0]!;
  for (const c of candidates.slice(1))
    if (moved(c.steps) < moved(best.steps) || (moved(c.steps) === moved(best.steps) && c.steps.length < best.steps.length))
      best = c;
  return best;
}
```

- [ ] **Step 4: Measure and set REVERSED_PIN, run the suites**

Run a one-off to get the swapped direction's moved points (a bun -e or scratch script through `transitionOrderPath`), set `REVERSED_PIN` to that exact value with the recording comment.

Run: `just test test/transition-order.test.ts test/transition-walk.test.ts test/selection-transition.test.ts test/transition-view.test.ts`
Expected: all pass. Watch specifically: `selection-transition.test.ts`'s panel-agreement and replaced-not-stacked tests must hold with the walk winning (they are order-agnostic); `transition-view.test.ts` uses the pair's transition - if the popup refund-delta or bo-refund assertions fail because the new 9-ish-step order lacks the step shape they search for, verify the order actually contains a refund of a complete granting member (the yugol teardown provides one) and report BLOCKED rather than editing those tests if it does not.

Run: `just test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/transitionOrder.ts web/test/transition-order.test.ts
git commit -F - <<'EOF'
feat(transition): best-of-candidates selection; the owner's pair pinned at 32 moved points
EOF
```

---

### Task 4: Aggregate pins, no-pair-worse verification, docs, launch-gate verdict

**Files:**
- Modify: `web/test/transition-order.test.ts` (aggregate moved-points pins on the corpus sweeps)
- Modify: `web/scripts/transition-spike.ts` (a `winner` CSV column: walk / two-pass / full-respec / none)
- Modify: `docs/reachability-engine.md` (the transition paragraph: ladder wording becomes selection wording)

**Interfaces:**
- Consumes: `.superpowers/sdd/transition-baseline.csv` (Task 1), the shipped selection (Task 3), `churnPoints`-style pin idioms from `web/test/build-order-oracle.test.ts` as the reference pattern.

- [ ] **Step 0: The winner column**

In `web/scripts/transition-spike.ts`, `measure()` additionally computes which candidate the selection returned: call `stateWalkTransition` and `incrementalTransition` directly and tag `winner` = "walk" if the result's steps JSON-equal the walk's, else "two-pass" if they equal the two-pass replay's, else "full-respec" (or "none"). Append `winner` as the CSV's fifth column (the baseline CSV from Task 1 has four columns; the comparison awk below indexes accordingly). The spec requires the walk's actual coverage to be visible, not assumed.

- [ ] **Step 1: Measure the after numbers and the per-pair comparison**

```bash
just spike-transition --pairs 100 --csv > .superpowers/sdd/transition-after.csv 2> .superpowers/sdd/transition-after-report.txt
tail -5 .superpowers/sdd/transition-after-report.txt
awk -F, 'NR>1 { m[$1]+=$4; n[$1]++ } END { for (c in m) printf "%s: pairs=%d moved=%d\n", c, n[c], m[c] }' .superpowers/sdd/transition-after.csv
paste -d, .superpowers/sdd/transition-baseline.csv .superpowers/sdd/transition-after.csv | awk -F, '
  NR > 1 { if ($8+0 > $4+0) { worse++; print "WORSE:", $1, $2, $4, "->", $8 } else if ($8+0 < $4+0) better++; else same++ }
  END { printf "better=%d same=%d worse=%d\n", better, same, worse }'
```

Expected: zero oracle failures in the report; `worse=0` (structural - any WORSE line is a bug in the selection, report BLOCKED); per-corpus totals strictly below baseline. Also summarize the winner distribution per corpus (`awk -F, 'NR>1 { w[$1","$5]++ } END { for (k in w) print k, w[k] }' .superpowers/sdd/transition-after.csv`). Copy all lines into your task report.

- [ ] **Step 2: Add the aggregate pins**

In `web/test/transition-order.test.ts`, extend the existing 30-pair small-delta sweep test (and add parallel accumulation to the resize and swap sweeps) to total moved points across produced pairs and assert against pinned constants set from this task's measurement with 2 percent slack (`ceil(measured * 1.02)`), following the comment style of the churn pins in `web/test/build-order-oracle.test.ts` (record measured value, baseline value, and the update-deliberately note). Prove each pin bites once by setting it to -1, watching the test fail, and restoring.

Run: `just test test/transition-order.test.ts`
Expected: all pass with the derived pins.

- [ ] **Step 3: Docs**

In `docs/reachability-engine.md`, the compare-mode transition paragraph: replace the two-rung ladder sentence with the selection reality - the state walk (one oracle-legal move at a time: target adds, free-point refunds, minimal scaffolds, stuck-only shared teardowns), the two-pass replay, and the full respec all compute, and the best verified schedule by fewest moved points renders; the full-rebuild notice appears only when the full respec wins. Rewrite in place, no dated notes, no emojis/emdashes/hyperbole.

- [ ] **Step 4: The heavy checks and the launch-gate verdict**

```bash
just test
just e2e
just perf > .superpowers/sdd/perf-walk.txt 2>&1
```

Compare `perf-walk.txt` headline numbers to `.superpowers/sdd/perf-baseline.txt` (non-compare path is untouched; parity expected). Assemble the launch-gate verdict table in your task report, one PASS/FAIL row per criterion with numbers:

1. Owner's pair at most 32 moved (owner's direction) and at its measured pin (swapped)
2. Aggregate moved points strictly below baseline per corpus
3. Zero oracle failures across corpora
4. Per-pair worse=0
5. Full suite, e2e, perf green

If ANY row is FAIL: still commit, then report DONE_WITH_CONCERNS naming the row - the controller stops the merge.

- [ ] **Step 5: Commit**

```bash
git add web/test/transition-order.test.ts docs/reachability-engine.md
git commit -F - <<'EOF'
feat(transition): aggregate moved-points pins; selection docs; launch-gate verdict
EOF
```

---

### Task 5: The reversed-walk candidate (both directions resolve when either does)

Added after the branch demo: the owner's URL displays the eel-to-ghoul direction (the URL's
`cs` hash is the baseline), which is exactly the direction where the walk returns null and the
panel falls back to the 130-moved full respec. A legal schedule traversed backward visits the
same board states in reverse, so the walk's ghoul-to-eel schedule reversed is a legal
eel-to-ghoul schedule (verified against the oracle in a scratch check: 9 steps, 32 moved,
ORACLE-LEGAL). This task adds that reversal as a fourth selection candidate.

**Files:**
- Modify: `web/src/core/transitionOrder.ts` (a private `reverseSteps` helper + one candidate in `transitionOrderPath`, JSDoc updated)
- Modify: `web/test/transition-order.test.ts` (the swapped-direction test tightens to incremental at or below 32; `REVERSED_PIN` retired; aggregate pins re-derived if the measurement drops)
- Modify: `web/scripts/transition-spike.ts` (winner column gains the `walk-reversed` value)
- Modify: `docs/reachability-engine.md` (candidate list sentence), `BACKLOG.md` (swapped-direction entry updated to the residual: pairs where the walk nulls in both directions)

**Interfaces:**
- Consumes: `stateWalkTransition` (exported), the Task 3 selection body, `TransStep`.
- Produces: `transitionOrderPath` signature unchanged; the selection pool gains the reversed opposite-direction walk, verified like every candidate.

- [ ] **Step 1: Tighten the swapped-direction test (RED first)**

In `web/test/transition-order.test.ts`, delete the `REVERSED_PIN` constant and its comment block, and REPLACE the test "the owner's pair swapped is oracle-clean and no worse than full respec" with:

```ts
test("the owner's pair swapped resolves incrementally via the reversed walk", () => {
  const [pair] = urlFixturePairs();
  const res = transitionOrderPath(cons, table, pair!.cur, pair!.base, 55);
  clean(pair!.cur, pair!.base, res, 55);
  expect(res!.rung).toBe("incremental");
  const moved = res!.steps.reduce((a, s) => a + Math.abs(s.to - s.from), 0);
  expect(moved).toBeLessThanOrEqual(32); // the forward walk's schedule reversed: same 32 moved
});
```

Run: `just test test/transition-order.test.ts`
Expected: this test FAILS (today the swapped direction is full-respec at 130 moved) - the RED that proves the pin bites.

- [ ] **Step 2: Implement the reversal candidate**

In `web/src/core/transitionOrder.ts`, after `stateWalkTransition`, add:

```ts
/**
 * Reverse a transition schedule: the same board states traversed backward, adds becoming
 * refunds and refunds becoming adds. Turns a walk of the opposite direction (cur to base)
 * into a base-to-cur candidate. startTotal is the reversed schedule's starting board total
 * (the base build's star count). The result is verified like any candidate, never trusted.
 */
function reverseSteps(steps: TransStep[], startTotal: number): TransStep[] {
  const rev: TransStep[] = [];
  let running = startTotal;
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i]!;
    running += s.from - s.to;
    rev.push({
      kind: s.kind === "add" ? "refund" : "add",
      conId: s.conId,
      from: s.to,
      to: s.from,
      heldAfter: running,
    });
  }
  return rev;
}
```

In `transitionOrderPath`, insert the reversed candidate between the walk and the two-pass replay (candidate order becomes: walk, reversed walk, two-pass, full respec):

```ts
  const walk = stateWalkTransition(cons, table, base, cur, cap);
  if (clean(walk)) candidates.push({ steps: walk!, rung: "incremental" });
  const back = stateWalkTransition(cons, table, cur, base, cap);
  if (back) {
    const rev = reverseSteps(back, base.reduce((a, c) => a + c.size, 0));
    if (clean(rev)) candidates.push({ steps: rev, rung: "incremental" });
  }
```

Update `transitionOrderPath`'s doc comment to name the four candidates. No other changes to the selection.

Run: `just test test/transition-order.test.ts test/transition-walk.test.ts test/selection-transition.test.ts test/transition-view.test.ts`
Expected: all pass, including the tightened swapped test (GREEN).

- [ ] **Step 3: Winner column and re-measurement**

In `web/scripts/transition-spike.ts`, extend the winner computation: if the selection returned null, `none`; else if `res.rung === "full-respec"`, `full-respec`; else if the steps JSON-equal the direct walk's, `walk`; else if they JSON-equal the two-pass replay's, `two-pass`; else `walk-reversed` (the only remaining incremental candidate). Then re-measure:

```bash
just spike-transition --pairs 100 --csv > .superpowers/sdd/transition-after2.csv 2> .superpowers/sdd/transition-after2-report.txt
tail -5 .superpowers/sdd/transition-after2-report.txt
awk -F, 'NR>1 { m[$1]+=$4; n[$1]++ } END { for (c in m) printf "%s: pairs=%d moved=%d\n", c, n[c], m[c] }' .superpowers/sdd/transition-after2.csv
paste -d, .superpowers/sdd/transition-after.csv .superpowers/sdd/transition-after2.csv | awk -F, '
  NR > 1 { if ($9+0 > $4+0) { worse++; print "WORSE:", $1, $2, $4, "->", $9 } else if ($9+0 < $4+0) better++; else same++ }
  END { printf "better=%d same=%d worse=%d\n", better, same, worse }'
awk -F, 'NR>1 { w[$1","$5]++ } END { for (k in w) print k, w[k] }' .superpowers/sdd/transition-after2.csv
```

(Both CSVs have five columns here, so the after2 moved field is $9 in the paste.) Expected: zero oracle failures; worse=0 versus the pre-reversal branch state (structural - the pool only grew); per-corpus totals at or below the Task 4 values. Copy all lines into the report.

- [ ] **Step 4: Re-derive pins if totals dropped; docs; backlog**

If the small-delta, resize, or swap sweep totals changed, update `SMALL_DELTA_MOVED_PIN` / `RESIZE_MOVED_PIN` / `SWAP_MOVED_PIN` with the same `ceil(measured * 1.02)` formula and comments recording old and new measured values; prove any changed pin bites once (set to -1, watch fail, restore). In `docs/reachability-engine.md`, the candidate sentence now names the walk in both directions (the opposite-direction walk's schedule reversed and verified). In `BACKLOG.md`, rewrite the "Transition walk: swapped-direction incompleteness" entry: the reversed-walk candidate ships in this task; the residual is pairs where the walk returns null in BOTH directions; wider move-4 teardown eligibility and approach C remain the recorded levers.

- [ ] **Step 5: Full gate and commit**

```bash
just test
just e2e
just perf > .superpowers/sdd/perf-walk2.txt 2>&1
```

Compare perf headline numbers to `.superpowers/sdd/perf-walk.txt` (one extra deterministic walk per compare-mode call; parity expected). Then:

```bash
git add web/src/core/transitionOrder.ts web/test/transition-order.test.ts web/scripts/transition-spike.ts docs/reachability-engine.md BACKLOG.md
git commit -F - <<'EOF'
feat(transition): reversed-walk candidate; both directions resolve when either does
EOF
```

---

### Task 6: The peephole simplifier (verify-gated churn removal)

Found in owner testing: on a pair whose winner is the reversed walk, the display contained
add-then-refund of Yugol (a zero-grant tier 3 absent from the target build) - the mirrored
image of the forward walk's tear/re-add churn. A scratch check proved removing the cancelling
pair verifies: 14 steps/64 moved became 12 steps/52 moved, oracle-legal. This task adds a
general peephole: every candidate is simplified by deleting exactly-cancelling step pairs
whenever the oracle still verifies the shortened schedule, then the selection runs on the
simplified candidates. Verify-gated, so it can only remove moved points, never add them.

**Files:**
- Modify: `web/src/core/transitionOrder.ts` (exported `simplifySteps`, `respecRung` helper, candidate pool refactored through a `consider` helper)
- Modify: `web/test/support/transition-pairs.ts` (second fixture pair from the owner's churn URL)
- Modify: `web/test/transition-order.test.ts` (churn-pair fixture test; pins re-derived if sweep totals drop)
- Modify: `web/scripts/transition-spike.ts` (winner detection compares against simplified candidates)

**Interfaces:**
- Consumes: the Task 5 selection (`transitionOrderPath` with four candidates), `verifyTransition`, `reverseSteps`.
- Produces: `export function simplifySteps(cons: ReachCon[], base: ReachCon[], cur: ReachCon[], steps: TransStep[], cap: number): TransStep[]` (used by the harness); `transitionOrderPath` signature unchanged.

- [ ] **Step 1: Add the churn fixture pair and its failing test (RED first)**

In `web/test/support/transition-pairs.ts`, `urlFixturePairs` returns a second entry. The churn
URL's current build (its `s` hash) with the eel-side as base (its `cs` hash, already the
existing CUR constant):

```ts
export function urlFixturePairs(): { label: string; base: ReachCon[]; cur: ReachCon[] }[] {
  const CUR = "p=55&s=AAAAgAAHAAAAAAAAAAAAPADAwQf44AEAAIA_AAD8AAAAAAAAAAAAAPAD4AMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfg";
  const BASE = "p=55&s=AAAAAAAAAADABgAAAAAAPADAwQcA4AEAAIA_AAD8AAAAAAAAAPABAPAD4AMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfg";
  const CHURN_CUR = "p=55&s=AAAAAAB_AADAPgAAAAAAPADAwQcA4AEA-AMAAAAAAAAAAAAAAAAAAPAD4AMAAAAAAAAAAAAAAAAAAAD4Aw";
  return [
    { label: "eel-pair", base: members(BASE), cur: members(CUR) },
    { label: "yugol-churn-pair", base: members(CUR), cur: members(CHURN_CUR) },
  ];
}
```

In `web/test/transition-order.test.ts`, add:

```ts
test("the churn pair: a zero-grant tier 3 absent from the target is never re-added", () => {
  const pair = urlFixturePairs().find((p) => p.label === "yugol-churn-pair")!;
  const res = transitionOrderPath(cons, table, pair.base, pair.cur, 55);
  clean(pair.base, pair.cur, res, 55);
  expect(res!.rung).toBe("incremental");
  // yugol is in the baseline only; its refund is real, but the add/refund churn is not
  expect(res!.steps.some((s) => s.conId.includes("yugol") && s.kind === "add")).toBeFalse();
  const moved = res!.steps.reduce((a, s) => a + Math.abs(s.to - s.from), 0);
  expect(moved).toBeLessThanOrEqual(52); // measured with the peephole; was 64 with the churn
});
```

Run: `just test test/transition-order.test.ts`
Expected: the new test FAILS (today the winner re-adds yugol and moves 64) - the RED.

- [ ] **Step 2: Implement simplifySteps and rewire the candidate pool**

In `web/src/core/transitionOrder.ts`, after `reverseSteps`, add:

```ts
/**
 * Peephole simplifier: repeatedly remove pairs of steps that exactly cancel (a constellation
 * leaving and returning to the same star count, with no other move of its own in between)
 * whenever the oracle still verifies the shortened schedule. Every removal is verify-gated,
 * so the result is oracle-clean by construction and never moves more points than the input.
 * Deterministic: the leftmost removable pair is taken each round, to a fixpoint.
 */
export function simplifySteps(
  cons: ReachCon[],
  base: ReachCon[],
  cur: ReachCon[],
  steps: TransStep[],
  cap: number,
): TransStep[] {
  const baseTotal = base.reduce((a, c) => a + c.size, 0);
  let out = steps;
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < out.length; i++) {
      const a = out[i]!;
      for (let j = i + 1; j < out.length; j++) {
        const b = out[j]!;
        if (b.conId !== a.conId) continue;
        if (a.from === b.to && a.to === b.from) {
          const kept = out.filter((_, k) => k !== i && k !== j);
          let running = baseTotal;
          const rebuilt = kept.map((s) => {
            running += s.to - s.from;
            return { ...s, heldAfter: running };
          });
          if (verifyTransition(cons, base, cur, rebuilt, cap) === null) {
            out = rebuilt;
            changed = true;
            break outer;
          }
        }
        break; // an intervening move of the same constellation blocks the pair with i
      }
    }
  }
  return out;
}

/**
 * A simplified full respec that no longer tears every baseline member down is not honestly a
 * "full rebuild" (the panel's notice keys off the rung); re-derive the tag from the schedule.
 */
function respecRung(steps: TransStep[], base: ReachCon[]): TransitionRung {
  const zeroed = new Set(steps.filter((s) => s.kind === "refund" && s.to === 0).map((s) => s.conId));
  return base.every((c) => zeroed.has(c.id)) ? "full-respec" : "incremental";
}
```

In `transitionOrderPath`, replace the four candidate pushes with a shared `consider` helper
(everything else - the identity edge, `clean`, `moved`, the best-of loop - stays verbatim):

```ts
  const candidates: { steps: TransStep[]; rung: TransitionRung }[] = [];
  const consider = (steps: TransStep[] | null, rung: TransitionRung): void => {
    if (!clean(steps)) return;
    const simplified = simplifySteps(cons, base, cur, steps!, cap);
    candidates.push({
      steps: simplified,
      rung: rung === "full-respec" ? respecRung(simplified, base) : rung,
    });
  };
  consider(stateWalkTransition(cons, table, base, cur, cap), "incremental");
  const back = stateWalkTransition(cons, table, cur, base, cap);
  consider(back && reverseSteps(back, base.reduce((a, c) => a + c.size, 0)), "incremental");
  consider(seededReplay(cons, table, conById, delta, cap, tries), "incremental");
  consider(teardownRebuild(cons, table, base, cur, cap), "full-respec");
```

Update the function's JSDoc: candidates are simplified before selection; the respec's rung is
re-derived after simplification. Note for the reviewer: `simplifySteps` preserves
verification (the input is verified and every reduction re-verifies), so `consider` needs no
second verify after simplification.

Run: `just test test/transition-order.test.ts test/transition-walk.test.ts test/selection-transition.test.ts test/transition-view.test.ts`
Expected: all pass including the churn-pair test (GREEN). The eel-pair pins are unaffected:
its yugol tear/re-add pair does NOT verify when removed (the teardown is genuinely needed for
cap room - removal was hand-checked to violate the cap), so the 9-step/32-moved schedules
survive the peephole unchanged.

- [ ] **Step 3: Winner detection catches up; re-measure**

In `web/scripts/transition-spike.ts`, the winner comparison now compares `res.steps` against
the SIMPLIFIED raw candidates: import `simplifySteps`, and where `walkSteps`/`incSteps` are
computed, wrap each non-null value with `simplifySteps(cons, base, cur, X, cap)` before the
JSON comparisons. The rung-aware structure (none / full-respec / walk / two-pass /
walk-reversed) stays.

```bash
just spike-transition --pairs 100 --csv > .superpowers/sdd/transition-after3.csv 2> .superpowers/sdd/transition-after3-report.txt
tail -5 .superpowers/sdd/transition-after3-report.txt
awk -F, 'NR>1 { m[$1]+=$4; n[$1]++ } END { for (c in m) printf "%s: pairs=%d moved=%d\n", c, n[c], m[c] }' .superpowers/sdd/transition-after3.csv
paste -d, .superpowers/sdd/transition-after2.csv .superpowers/sdd/transition-after3.csv | awk -F, '
  NR > 1 { if ($9+0 > $4+0) { worse++; print "WORSE:", $1, $2, $4, "->", $9 } else if ($9+0 < $4+0) better++; else same++ }
  END { printf "better=%d same=%d worse=%d\n", better, same, worse }'
awk -F, 'NR>1 { w[$1","$5]++ } END { for (k in w) print k, w[k] }' .superpowers/sdd/transition-after3.csv
```

Expected: zero oracle failures; worse=0 versus the pre-peephole branch (structural - each
candidate's moved points can only shrink or hold, so the per-pair minimum can only shrink or
hold); totals at or below the after2 values. Copy all lines into the report.

- [ ] **Step 4: Pins re-derived if totals dropped; full gate; commit**

Update any of `SMALL_DELTA_MOVED_PIN`/`RESIZE_MOVED_PIN`/`SWAP_MOVED_PIN` whose measured
sweep totals changed (`ceil(measured * 1.02)`, comment history extended, changed pins proven
to bite via the -1 negative control). Then:

```bash
just test
just e2e
just perf > .superpowers/sdd/perf-walk3.txt 2>&1
```

Compare perf to `.superpowers/sdd/perf-walk2.txt` (simplification adds a few verify calls per
compare-mode invocation; parity expected). Commit:

```bash
git add web/src/core/transitionOrder.ts web/test/support/transition-pairs.ts web/test/transition-order.test.ts web/scripts/transition-spike.ts
git commit -F - <<'EOF'
feat(transition): verify-gated peephole simplifier; churn pair pinned clean
EOF
```

---

### Task 7: Zero-grant ordering (add granting members first, tear zero-granters first)

Owner-requested heuristic: tier 3 constellations and partial tier 1/2 placements grant no
affinity, so a build should add them last (their points stay liquid for scaffolding) and a
teardown should remove them first (nothing can lean on them). Move 2 already refunds
zero-effective-grant members first (the Ghoul fix); this task brings moves 1 and 4 in line.
Unlike the peephole this changes the walk's output, so the corpus no-pair-worse comparison is
the empirical gate: any regression is a stop-and-decide, not a shrug.

**Files:**
- Modify: `web/src/core/transitionOrder.ts` (`stateWalkTransition` moves 1 and 4 only, JSDoc updated)
- Modify: `web/test/transition-walk.test.ts` (two new unit tests, hand-traced below)
- Modify: `web/test/transition-order.test.ts` (pins re-derived if sweep totals change)

**Interfaces:**
- Consumes/produces: unchanged signatures throughout; walk internals only.

- [ ] **Step 1: Write the two failing unit tests (RED first)**

Append to `web/test/transition-walk.test.ts`:

```ts
test("zero-grant targets are added last, granting targets first", () => {
  // Both targets are addable from the start (no reqs, roomy cap); the zero-granter's id sorts
  // first alphabetically, so only the granting-first preference can put the granter ahead.
  const helper = con("helper", 2, z(), z());
  const granter = con("bbb-granter", 2, z(), v(2));
  const inert = con("aaa-inert", 2, z(), z());
  const all = [helper, granter, inert];
  const walk = stateWalkTransition(all, buildCoverTable(all), [helper], [helper, granter, inert], 55)!;
  expect(walk).not.toBeNull();
  const adds = walk.filter((s) => s.kind === "add").map((s) => s.conId);
  expect(adds[0]).toBe("bbb-granter");
  expect(adds[adds.length - 1]).toBe("aaa-inert");
});

test("the teardown tears a zero-grant member before a load-bearing granter", () => {
  // L props S's requirement; T needs S's chaos grant and two slots of cap room. Tearing the
  // granter S first (the old smallest-then-id order, "shared" < "zed") dead-ends into extra
  // churn; tearing the inert Z first frees the room directly.
  const L = con("leftover", 3, z(), v(3));
  const S = con("shared", 2, v(3), v(0, 3));
  const Z = con("zed", 2, z(), z());
  const T = con("target", 2, v(0, 3), v(3));
  const all = [L, S, Z, T];
  const walk = stateWalkTransition(all, buildCoverTable(all), [L, S, Z], [S, Z, T], 7)!;
  expect(walk).not.toBeNull();
  expect(verifyTransition(all, [L, S, Z], [S, Z, T], walk, 7)).toBeNull();
  expect(walk.some((s) => s.conId === "shared" && s.kind === "refund")).toBeFalse();
  const moved = walk.reduce((a, s) => a + Math.abs(s.to - s.from), 0);
  expect(moved).toBeLessThanOrEqual(9); // tear zed, add target, refund leftover, re-add zed
});
```

Run: `just test test/transition-walk.test.ts`
Expected: both FAIL on the current code (the inert add comes first by id; the teardown picks
"shared" by id at equal size, hand-traced to 13 moved with a torn granter).

- [ ] **Step 2: Implement the two ordering changes**

In `stateWalkTransition` move 1, the selection gains a granting tier between the torn tier and
the density score (a full-size add of a granting constellation outranks any zero-effective-
grant add; partial adds grant nothing and sort with the inert):

```ts
      let pick: string | null = null;
      let pickPts = 0;
      let pickDelta = 1;
      let pickTorn = 1;
      let pickGrants = 0;
      for (const [id, size] of want) {
        const at = counts.get(id) ?? 0;
        if (at >= size || !probe("add", id, size)) continue;
        const c = conById.get(id)!;
        let pts = 0;
        if (size === c.size) for (let i = 0; i < 5; i++) if (d[i]! > 0) pts += c.grant[i]!;
        const delta = size - at;
        const torn = tornOnce.has(id) ? 1 : 0;
        const grants = size === c.size && grantSum(c) > 0 ? 1 : 0;
        if (
          pick === null ||
          torn < pickTorn ||
          (torn === pickTorn &&
            (grants > pickGrants ||
              (grants === pickGrants &&
                (pts * pickDelta > pickPts * delta ||
                  (pts * pickDelta === pickPts * delta && id < pick)))))
        ) {
          pick = id;
          pickPts = pts;
          pickDelta = delta;
          pickTorn = torn;
          pickGrants = grants;
        }
      }
```

In move 4, the teardown sort tears zero-effective-grant members first (a member standing at a
partial target grants nothing and counts as zero-grant), then smallest, ties by id:

```ts
      const tearCands = [...counts.keys()]
        .filter((id) => {
          const t = want.get(id) ?? 0;
          return t > 0 && (counts.get(id) ?? 0) === t && !tornOnce.has(id);
        })
        .map((id) => conById.get(id)!)
        .sort((a, b) => {
          const ga = (want.get(a.id) === a.size && grantSum(a) > 0 ? 1 : 0);
          const gb = (want.get(b.id) === b.size && grantSum(b) > 0 ? 1 : 0);
          return ga - gb || a.size - b.size || (a.id < b.id ? -1 : 1);
        });
```

Update the walk's JSDoc: move 1 adds granting members before zero-effective-grant ones; move 4
tears zero-effective-grant members first, then smallest.

Run: `just test test/transition-walk.test.ts test/transition-order.test.ts test/selection-transition.test.ts test/transition-view.test.ts`
Expected: all pass, including the eel-pair 32-moved pins and the churn-pair test (GREEN).

- [ ] **Step 3: Re-measure with the gate teeth**

```bash
just spike-transition --pairs 100 --csv > .superpowers/sdd/transition-after4.csv 2> .superpowers/sdd/transition-after4-report.txt
tail -5 .superpowers/sdd/transition-after4-report.txt
awk -F, 'NR>1 { m[$1]+=$4; n[$1]++ } END { for (c in m) printf "%s: pairs=%d moved=%d\n", c, n[c], m[c] }' .superpowers/sdd/transition-after4.csv
paste -d, .superpowers/sdd/transition-after3.csv .superpowers/sdd/transition-after4.csv | awk -F, '
  NR > 1 { if ($9+0 > $4+0) { worse++; print "WORSE:", $1, $2, $4, "->", $9 } else if ($9+0 < $4+0) better++; else same++ }
  END { printf "better=%d same=%d worse=%d\n", better, same, worse }'
awk -F, 'NR>1 { w[$1","$5]++ } END { for (k in w) print k, w[k] }' .superpowers/sdd/transition-after4.csv
```

Expected: zero oracle failures. worse is NOT structural here - the walk's output changed. If
worse=0, proceed. If ANY pair is worse, STOP: copy the WORSE lines into the report and report
DONE_WITH_CONCERNS naming them; the controller and owner decide (the peephole from Task 6 and
the unchanged candidates bound the damage, but a regression is an owner decision, not an
implementer shrug).

- [ ] **Step 4: Pins, full gate, commit**

Re-derive changed pins (same formula, history comment, negative control). Then `just test`,
`just e2e`, `just perf > .superpowers/sdd/perf-walk4.txt 2>&1` (compare to perf-walk3.txt).
Commit:

```bash
git add web/src/core/transitionOrder.ts web/test/transition-walk.test.ts web/test/transition-order.test.ts
git commit -F - <<'EOF'
feat(transition): granting targets add first, zero-granters tear first
EOF
```
