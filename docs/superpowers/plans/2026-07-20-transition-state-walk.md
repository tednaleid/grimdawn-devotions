# Transition State Walk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zero-slack transition pairs resolve incrementally (the owner's pair: at most 32 moved points, down from 130) via a deterministic state walk, selected best-of-candidates so no pair gets worse than today.

**Architecture:** A new pure `stateWalkTransition` in `web/src/core/transitionOrder.ts` walks the standing board from baseline to current, one oracle-legal move at a time, with strict priorities (target adds by need-driven score, free-point refunds zero-grant-first, minimal scaffolds, stuck-only shared teardowns). `transitionOrderPath` becomes a best-of-candidates selection (walk, existing two-pass replay, full respec) by fewest moved points. The merge gate: the owner's pair pinned, aggregate moved-points pins, no pair worse.

**Tech Stack:** TypeScript (bun), bun:test, just recipes. Spec: `docs/superpowers/specs/2026-07-20-transition-state-walk-design.md`. Branch: `compare-transition` (held from merge until this gate passes).

**Spec deviations (deliberate, small):** (1) move 2 generalizes from "refund a non-target" to "refund toward target", which also covers shrink-resizes (a shared member standing above its target count); (2) the spec's teardown condition ("the smallest whose removal unblocks progress") is realized as smallest-legal-first with the step budget as guard — "does it unblock" is answered by trying it, deterministically.

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
- The owner's pair hashes (already in `web/test/support/transition-pairs.ts` `urlFixturePairs`): base = ghoul-side, cur = eel-side — this IS the owner's direction. The reference hand path (9 steps, 32 moved, oracle-verified): refund ghoul 4 to 0; add eel 0 to 3; add crossroads_chaos 0 to 1; refund kraken 5 to 0; refund yugol_the_insatiable_night 6 to 0; add crossroads_order 0 to 1; add tortoise 0 to 5; refund crossroads_order 1 to 0; add yugol_the_insatiable_night 0 to 6.

---

### Task 1: Harness per-pair measurement and the pre-walk baseline

**Files:**
- Modify: `web/scripts/transition-spike.ts` (a `--csv` mode and a winner column)

**Interfaces:**
- Consumes: the existing harness (`measure`, `report`, corpora loops) and `PairResult` (which already carries `corpus`, `rung`, `moved`).
- Produces: `just spike-transition --csv` printing one line per pair to stdout: `corpus,index,rung,moved` (header line first), aggregates still on the normal report path (use stderr for the report when `--csv` is set, or suppress the report — implementer's choice, disclosed); baseline file `.superpowers/sdd/transition-baseline.csv` (read by Task 4).

- [ ] **Step 1: Add the CSV mode**

In `web/scripts/transition-spike.ts`, add a `--csv` flag beside the existing flag parsing. When set, after all `results` are collected, print `corpus,index,rung,moved` then one line per result in collection order (index = position within its corpus). Route the human report to stderr in CSV mode so stdout stays clean. Pair generation is already seeded and deterministic, so line N always describes the same pair across runs — that is what makes before/after diffing valid.

- [ ] **Step 2: Capture the baseline (BEFORE any algorithm change)**

```bash
just spike-transition --pairs 100 --csv > .superpowers/sdd/transition-baseline.csv 2> .superpowers/sdd/transition-baseline-report.txt
tail -5 .superpowers/sdd/transition-baseline-report.txt
awk -F, 'NR>1 { m[$1]+=$4; n[$1]++ } END { for (c in m) printf "%s: pairs=%d moved=%d\n", c, n[c], m[c] }' .superpowers/sdd/transition-baseline.csv
```

Expected: the report shows zero oracle failures; the awk summary prints per-corpus totals. Copy the per-corpus totals into your task report — these are the launch-gate "before" numbers.

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
- Produces: `export function stateWalkTransition(cons: ReachCon[], table: CoverTable, base: ReachCon[], cur: ReachCon[], cap: number): TransStep[] | null` — Task 3 wires it into the selection.

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `just test test/transition-walk.test.ts`
Expected: FAIL — `stateWalkTransition` is not exported.

- [ ] **Step 3: Implement the walk**

In `web/src/core/transitionOrder.ts`, after `teardownRebuild`, add:

```ts
/**
 * The state walk: a deterministic greedy over actual game states, from the baseline's standing
 * board toward the current build, one oracle-legal move at a time. Priorities each iteration:
 * (1) complete a target member, need-driven (densest contributor to the outstanding deficits per
 * moved star, ties by id); (2) free points - refund any standing constellation above its target
 * count, zero-grant members first, then the grant least useful to the remaining deficits, ties by
 * id; (3) add one scaffold from peakToReach's minimal crossroads-biased set when it fits; (4) only
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
  const standingGrant = (): Vec => {
    let g = zero();
    for (const [id, n] of counts) {
      const c = conById.get(id)!;
      if (n >= c.size) g = addCap(g, c.grant);
    }
    return g;
  };
  // What the not-yet-at-target members still demand beyond the standing complete grants.
  const deficitVec = (): Vec => {
    const g = standingGrant();
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
    // 1. Complete a target member: densest deficit contribution per moved star, ties by id.
    {
      let pick: string | null = null;
      let pickPts = 0;
      let pickDelta = 1;
      for (const [id, size] of want) {
        const at = counts.get(id) ?? 0;
        if (at >= size || !probe("add", id, size)) continue;
        const c = conById.get(id)!;
        let pts = 0;
        if (size === c.size) for (let i = 0; i < 5; i++) if (d[i]! > 0) pts += c.grant[i]!;
        const delta = size - at;
        if (
          pick === null ||
          pts * pickDelta > pickPts * delta ||
          (pts * pickDelta === pickPts * delta && id < pick)
        ) {
          pick = id;
          pickPts = pts;
          pickDelta = delta;
        }
      }
      if (pick !== null) {
        emit("add", pick, want.get(pick)!);
        continue;
      }
    }
    // 2. Free points: refund anything standing above its target, zero-grant first, then the grant
    // least useful to the remaining deficits, ties by id. Covers leftovers, spent scaffolds, and
    // shrink-resizes alike (refund toward target, not just to zero).
    {
      const cands: { id: string; free: number; useful: number }[] = [];
      for (const [id, n] of counts) {
        const target = want.get(id) ?? 0;
        if (n <= target || !probe("refund", id, target)) continue;
        const c = conById.get(id)!;
        let useful = 0;
        for (let i = 0; i < 5; i++) if (d[i]! > 0) useful += c.grant[i]!;
        cands.push({ id, free: grantSum(c) === 0 ? 0 : 1, useful });
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
Expected: 5 pass. Triage note: the stuck-teardown test's scenario was hand-traced during design (tear `shared`, add `target`, refund `leftover`, re-add `shared`); if it fails, instrument which move list came up empty at the stuck state rather than adjusting priorities blindly, and report BLOCKED if the cause is unclear.

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

In `web/test/transition-order.test.ts`, REPLACE the test "the Eel pair (real URL): oracle-clean; Ghoul refunds before any add" with (the old full-respec pin was explicitly provisional — its own comment says a replay improvement should consciously revisit it; this is that revisit):

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
  expect(moved).toBeLessThanOrEqual(REVERSED_PIN); // measured after the walk lands; expect far below 130
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
Expected: the replaced test FAILS (today's rung is full-respec at 130 moved) — this is the RED that proves the pin bites. The selection test may pass already (the ladder never beats full respec by construction today); that is fine.

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
Expected: all pass. Watch specifically: `selection-transition.test.ts`'s panel-agreement and replaced-not-stacked tests must hold with the walk winning (they are order-agnostic); `transition-view.test.ts` uses the pair's transition — if the popup refund-delta or bo-refund assertions fail because the new 9-ish-step order lacks the step shape they search for, verify the order actually contains a refund of a complete granting member (the yugol teardown provides one) and report BLOCKED rather than editing those tests if it does not.

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

Expected: zero oracle failures in the report; `worse=0` (structural — any WORSE line is a bug in the selection, report BLOCKED); per-corpus totals strictly below baseline. Also summarize the winner distribution per corpus (`awk -F, 'NR>1 { w[$1","$5]++ } END { for (k in w) print k, w[k] }' .superpowers/sdd/transition-after.csv`). Copy all lines into your task report.

- [ ] **Step 2: Add the aggregate pins**

In `web/test/transition-order.test.ts`, extend the existing 30-pair small-delta sweep test (and add parallel accumulation to the resize and swap sweeps) to total moved points across produced pairs and assert against pinned constants set from this task's measurement with 2 percent slack (`ceil(measured * 1.02)`), following the comment style of the churn pins in `web/test/build-order-oracle.test.ts` (record measured value, baseline value, and the update-deliberately note). Prove each pin bites once by setting it to -1, watching the test fail, and restoring.

Run: `just test test/transition-order.test.ts`
Expected: all pass with the derived pins.

- [ ] **Step 3: Docs**

In `docs/reachability-engine.md`, the compare-mode transition paragraph: replace the two-rung ladder sentence with the selection reality — the state walk (one oracle-legal move at a time: target adds, free-point refunds, minimal scaffolds, stuck-only shared teardowns), the two-pass replay, and the full respec all compute, and the best verified schedule by fewest moved points renders; the full-rebuild notice appears only when the full respec wins. Rewrite in place, no dated notes, no emojis/emdashes/hyperbole.

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

If ANY row is FAIL: still commit, then report DONE_WITH_CONCERNS naming the row — the controller stops the merge.

- [ ] **Step 5: Commit**

```bash
git add web/test/transition-order.test.ts docs/reachability-engine.md
git commit -F - <<'EOF'
feat(transition): aggregate moved-points pins; selection docs; launch-gate verdict
EOF
```
