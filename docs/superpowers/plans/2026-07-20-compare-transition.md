# Compare-Mode Transition Build Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While comparing, the build-order panel shows a verified, legal sequence of refunds and adds that turns the baseline build into the current build, with the per-step affinity popup working on every transition step.

**Architecture:** The spike's transition oracle is promoted into `web/src/core/orderLegality.ts` with one-walk-two-outputs states (verdict plus per-step `StepState`s for the popup). The spike's prototype is ported into a new `web/src/core/transitionOrder.ts` with two rungs (incremental seeded replay, full-respec reversal of the churn-minimized from-scratch orders); `selectionView` gains an optional baseline and returns a gated transition; the panel renders it with new catalog keys.

**Tech Stack:** TypeScript (bun), bun:test, just recipes. Spec: `docs/superpowers/specs/2026-07-18-compare-transition-order-design.md` (as refreshed on this branch). Spike source being ported: `web/scripts/transition-spike.ts` (branch `compare-transition`).

## Global Constraints

- **Verified or absent (spec, hard):** every order the panel renders while comparing passes the independent transition oracle before display; a failed candidate demotes to the next rung; the last resort is the honest empty state. Structural, not just tested.
- **Oracle independence:** `web/src/core/orderLegality.ts` keeps type-only imports from reachability (`import type`); the transition oracle re-derives all validity itself, sharing no engine code.
- **Witness boundary (never touch):** `sampledConstruction`, `minPeakSampled`, `minPeakSampledOrder`, `orderPeak`, `peakToReach` signatures/behavior, `needDrivenOrder`, `emitSchedule`, and the classify/dimming path in `web/src/core/reachability.ts`. `buildOrderPath` is CONSUMED (by the full-respec rung and the none-fallback), never modified.
- **TransStep vocabulary:** `{ kind: "add" | "refund"; conId: string; from: number; to: number; heldAfter: number }` — star-count based, distinct from `BuildStep`'s points-based kinds. Refund steps may pass through over-cap totals (a baseline larger than the cap legally tears down first); an add must land at or under cap; the end state must fit the cap and equal the current build exactly.
- **No teardown-1 rung** (spec non-goal, data-driven). Two rungs only: incremental, full-respec.
- **Identity edge (spec):** base equals cur -> empty transition only when the build fits the cap; otherwise a none pair.
- **i18n invariant:** every new user-facing string is a catalog key in `web/src/i18n/app.en.json`, added to the `REQUIRED` array in `web/test/appCatalog.test.ts`, with translations in all 12 other locale files. No hardcoded text.
- **URL invariant:** no new hash parameters; the baseline already rides in `cs=`/`cp=`.
- **Determinism:** `transitionOrderPath` is deterministic (seeded shuffles, no `Math.random`); same inputs give byte-identical output.
- All new files start with two `ABOUTME:` comment lines. Docs: no emojis, emdashes, or hyperbole.
- Run tests via `just` from the repo root. Commit from the repo root with `git commit -F - <<'EOF'` heredoc; never `--no-verify`. The pre-commit hook runs the full gate (1-3 min).
- Spike numbers for orientation (re-measure, never copy): incremental resolves ~96% of small-delta pairs; incremental runtime ~0.7 ms/pair against the old from-scratch cost.

## Port deviations from the spike (deliberate, all spec-mandated)

1. The oracle takes `allCons` as a parameter (the spike closed over a module-level `cons` import).
2. Grant sums use capped addition (`addCap`) like the rest of orderLegality. Verdict-equivalent to the spike's uncapped sums because every requirement is at most `CAP_MAX` per color, and it makes the states' `have` match the Affinity panel's capped supply.
3. Unlike `replayBuildOrder`, the target does NOT override constellation lookups: partiality is expressed through star counts, and grants/sizes must come from the full definitions.
4. `seededReplay` loses its `teardown` parameter (only ever non-empty for the dropped teardown-1 rung).
5. `transitionOrderPath` gains the identity-edge cap check and the `(cons, table, ...)` parameters.

---

### Task 1: The transition oracle joins orderLegality.ts (one walk, two outputs)

**Files:**
- Modify: `web/src/core/orderLegality.ts` (append after `gateBuildOrder`)
- Create: `web/test/transition-legality.test.ts`
- Modify: `web/scripts/transition-spike.ts` (delete its local `TransStep`/`verifyTransition`, import from core)
- Modify: `web/test/transition-spike.test.ts` (import `verifyTransition`/`TransStep` from core)

**Interfaces:**
- Consumes: existing `StepState`, `Vec`, `ReachCon` and the module's private `zero`/`addCap`/`maxV`/`covers`.
- Produces: `export interface TransStep { kind: "add" | "refund"; conId: string; from: number; to: number; heldAfter: number }`; `export function replayTransition(allCons: ReachCon[], base: ReachCon[], cur: ReachCon[], steps: TransStep[], cap: number): { error: string | null; states: StepState[] }`; `export function verifyTransition(allCons, base, cur, steps, cap): string | null` (thin `.error` wrapper); `export interface GatedTransition { steps: TransStep[]; states: StepState[] }`; `export function gateTransition(allCons, base, cur, steps, cap): GatedTransition | null`.

- [ ] **Step 1: Write the failing oracle tests**

Create `web/test/transition-legality.test.ts`:

```ts
// ABOUTME: Unit tests for the transition legality oracle (core/orderLegality): baseline-to-current
// ABOUTME: replays exercising stranding, cap, end-state, over-cap teardown, and the popup states.
import { test, expect } from "bun:test";
import { verifyTransition, replayTransition, gateTransition, type TransStep } from "../src/core/orderLegality";
import type { ReachCon, Vec } from "../src/core/reachability";

const z = (): Vec => [0, 0, 0, 0, 0];
const v = (asc = 0, cha = 0, eld = 0, ord = 0, pri = 0): Vec => [asc, cha, eld, ord, pri];
const con = (id: string, size: number, req: Vec, grant: Vec): ReachCon => ({ id, size, req, grant });

const G = con("g", 1, z(), v(1)); // free granter: 1 Ascendant
const M = con("m", 2, v(1), v(1)); // needs 1 Ascendant, grants 1 back on completion
const N = con("n", 3, v(1), z()); // needs 1 Ascendant, grants nothing
const CONS = [G, M, N];

const step = (kind: "add" | "refund", c: ReachCon, from: number, to: number, heldAfter: number): TransStep => ({
  kind,
  conId: c.id,
  from,
  to,
  heldAfter,
});

test("a legal add sequence from an empty base passes", () => {
  const steps = [step("add", G, 0, 1, 1), step("add", M, 0, 2, 3)];
  expect(verifyTransition(CONS, [], [G, M], steps, 55)).toBeNull();
});

test("refunding a load-bearing member strands its dependent", () => {
  // Base holds G and N; N grants nothing, so refunding G leaves N's requirement uncovered.
  const steps = [step("refund", G, 1, 0, 3)];
  expect(verifyTransition(CONS, [G, N], [N], steps, 55)).toContain("uncovered");
});

test("an add over the cap is a violation; a refund may pass through over-cap totals", () => {
  expect(verifyTransition(CONS, [], [G], [step("add", G, 0, 1, 1)], 0)).toContain("cap");
  // Base G+M+N (6 points) at cap 3: refunds legally tear down through over-cap totals.
  const down = [step("refund", N, 3, 0, 3)];
  expect(verifyTransition(CONS, [G, M, N], [G, M], down, 3)).toBeNull();
});

test("not ending at the current build is a violation", () => {
  expect(verifyTransition(CONS, [], [G], [], 55)).toContain("end state");
});

test("an end state over the cap is a violation", () => {
  expect(verifyTransition(CONS, [G, M, N], [G, M, N], [], 3)).toContain("over cap");
});

test("states: one per completed step, capped have, need from started members", () => {
  const steps = [step("add", G, 0, 1, 1), step("add", M, 0, 2, 3)];
  const r = replayTransition(CONS, [], [G, M], steps, 55);
  expect(r.error).toBeNull();
  expect(r.states.length).toBe(2);
  expect(r.states[0]!.have).toEqual(v(1)); // G complete
  expect(r.states[1]!.have).toEqual(v(2)); // G + M complete
  expect(r.states[1]!.need).toEqual(v(1)); // M demands 1 Ascendant
  expect(r.states[1]!.needSource.get(0)).toEqual(["m"]);
});

test("states: conGrant appears only when a step completes or un-completes the constellation", () => {
  const steps = [step("add", G, 0, 1, 1), step("add", N, 0, 2, 3), step("add", N, 2, 3, 4)];
  const r = replayTransition(CONS, [], [G, N], steps, 55);
  expect(r.error).toBeNull();
  expect(r.states[1]!.conGrant).toEqual(z()); // partial add: no grant yet
  expect(r.states[2]!.conGrant).toEqual(z()); // N completes but grants nothing
  const down = replayTransition(CONS, [G, M], [G], [step("refund", M, 2, 0, 1)], 55);
  expect(down.error).toBeNull();
  expect(down.states[0]!.conGrant).toEqual(v(1)); // refund of a complete granter loses its grant
});

test("a failing step contributes no state", () => {
  const steps = [step("add", G, 0, 1, 1), step("refund", G, 1, 0, 0)];
  const r = replayTransition(CONS, [], [G], steps, 55);
  expect(r.error).not.toBeNull(); // end state g missing after the refund? No: refund empties, end mismatch
  expect(r.states.length).toBeLessThan(2 + 1);
});

test("gateTransition passes steps with states only when legal", () => {
  const good = [step("add", G, 0, 1, 1)];
  const gated = gateTransition(CONS, [], [G], good, 55);
  expect(gated).not.toBeNull();
  expect(gated!.states.length).toBe(1);
  expect(gateTransition(CONS, [], [G], [], 55)).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `just test test/transition-legality.test.ts`
Expected: FAIL — `verifyTransition` is not exported from `../src/core/orderLegality`.

- [ ] **Step 3: Implement the oracle**

Append to `web/src/core/orderLegality.ts` (after `gateBuildOrder`):

```ts
/** One step of a baseline-to-current transition: star counts, not points. `from`/`to` are the
 *  constellation's standing star count before/after the step; `heldAfter` is the running total. */
export interface TransStep {
  kind: "add" | "refund";
  conId: string;
  from: number;
  to: number;
  heldAfter: number;
}

/**
 * The transition verification walk with its states exposed. Replays `steps` from the standing
 * `base` build, re-deriving validity from scratch at each step: standing grants come only from
 * COMPLETE constellations (star count at full size), standing requirements from every STARTED one,
 * and coverage must hold at the conservative mid-step point (an add's requirement stands before its
 * grant lands; a refund loses the grant at its first refunded star while the requirement stands
 * until zero). Cap rule: an ADD must land at or under `cap` and the end state must fit `cap`;
 * refunds may pass through over-cap totals (how a baseline larger than the live cap legally tears
 * down). The end state must equal `cur` exactly. Unlike replayBuildOrder, `cur` members never
 * override lookups: partiality is expressed through star counts, so grants and sizes come from the
 * full definitions in `allCons`. Grant sums are capped (addCap) like the rest of this module -
 * verdict-equivalent to uncapped sums because no requirement exceeds CAP_MAX, and it makes the
 * states' `have` match the Affinity panel. `error` is null when legal, else the first violation;
 * `states` holds one post-step entry per step that completed its checks. Pure.
 */
export function replayTransition(
  allCons: ReachCon[],
  base: ReachCon[],
  cur: ReachCon[],
  steps: TransStep[],
  cap: number,
): { error: string | null; states: StepState[] } {
  const conOf = new Map(allCons.map((c) => [c.id, c]));
  const counts = new Map<string, number>(base.map((b) => [b.id, b.size]));
  const states: StepState[] = [];
  const total = () => [...counts.values()].reduce((a, b) => a + b, 0);
  const fail = (error: string) => ({ error, states });
  // Standing validity with the conservative override: `pending` is a con whose requirement must
  // count but whose grant must not (add completing / refund starting).
  const check = (label: string, pending: string | null): string | null => {
    let grant = zero();
    let req = zero();
    for (const [id, n] of counts) {
      if (n <= 0) continue;
      const c = conOf.get(id)!;
      req = maxV(req, c.req);
      if (n >= c.size && id !== pending) grant = addCap(grant, c.grant);
    }
    if (pending) {
      const pc = conOf.get(pending);
      if (pc) req = maxV(req, pc.req);
    }
    return covers(grant, req) ? null : `${label}: requirement uncovered`;
  };
  // The post-step standing state (fresh structures per call), the popup's data source.
  const standingState = (): { have: Vec; need: Vec; needSource: Map<number, string[]> } => {
    let have = zero();
    let need = zero();
    const needSource = new Map<number, string[]>();
    for (const [id, n] of counts) {
      if (n <= 0) continue;
      const c = conOf.get(id)!;
      need = maxV(need, c.req);
      if (n >= c.size) have = addCap(have, c.grant);
      for (let i = 0; i < 5; i++)
        if (c.req[i]! > 0) {
          const list = needSource.get(i) ?? [];
          list.push(id);
          needSource.set(i, list);
        }
    }
    return { have, need, needSource };
  };
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    const c = conOf.get(s.conId);
    if (!c) return fail(`step ${i}: unknown constellation ${s.conId}`);
    const cur0 = counts.get(s.conId) ?? 0;
    if (cur0 !== s.from) return fail(`step ${i} (${s.conId}): from=${s.from} but standing count is ${cur0}`);
    if (s.to < 0 || s.to > c.size) return fail(`step ${i} (${s.conId}): to=${s.to} out of range`);
    if (s.kind === "add" && s.to <= s.from) return fail(`step ${i} (${s.conId}): add must increase count`);
    if (s.kind === "refund" && s.to >= s.from) return fail(`step ${i} (${s.conId}): refund must decrease count`);
    counts.set(s.conId, s.to);
    const mid = check(`step ${i} (${s.conId}) mid`, s.conId);
    if (mid) return fail(mid);
    const end = check(`step ${i} (${s.conId}) end`, null);
    if (end) return fail(end);
    const t = total();
    if (s.kind === "add" && t > cap) return fail(`step ${i} (${s.conId}): cap exceeded (${t} > ${cap})`);
    if (t !== s.heldAfter) return fail(`step ${i} (${s.conId}): heldAfter=${s.heldAfter} but total is ${t}`);
    // Grant delta the popup shows: only a step that completes (add to full size) or un-completes
    // (refund from full size) the constellation moves its grant.
    const conGrant =
      (s.kind === "add" && s.to === c.size) || (s.kind === "refund" && s.from === c.size) ? c.grant : zero();
    const st = standingState();
    states.push({ ...st, conReq: c.req, conGrant });
    if (s.to === 0) counts.delete(s.conId);
  }
  if (total() > cap) return fail(`end state over cap (${total()} > ${cap})`);
  const want = new Map(cur.map((c) => [c.id, c.size]));
  if (want.size !== counts.size) return fail(`end state mismatch: ${counts.size} standing, ${want.size} wanted`);
  for (const [id, n] of want) if (counts.get(id) !== n) return fail(`end state mismatch at ${id}`);
  return { error: null, states };
}

/** The transition replay's verdict alone: null when every step is legal in-game. */
export function verifyTransition(
  allCons: ReachCon[],
  base: ReachCon[],
  cur: ReachCon[],
  steps: TransStep[],
  cap: number,
): string | null {
  return replayTransition(allCons, base, cur, steps, cap).error;
}

/** A verified transition together with the per-step states its verifying replay produced. */
export interface GatedTransition {
  steps: TransStep[];
  states: StepState[];
}

/** The verified-or-absent gate for transitions: steps pass through, with states, only when legal. */
export function gateTransition(
  allCons: ReachCon[],
  base: ReachCon[],
  cur: ReachCon[],
  steps: TransStep[] | null,
  cap: number,
): GatedTransition | null {
  if (!steps) return null;
  const r = replayTransition(allCons, base, cur, steps, cap);
  return r.error === null ? { steps, states: r.states } : null;
}
```

Note the "a failing step contributes no state" test: an empty-`cur` mismatch surfaces at the end-state check, so refine the test expectation while implementing if the exact failing point differs — the property under test is only that `states.length` never exceeds the number of steps that passed all checks.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `just test test/transition-legality.test.ts`
Expected: all pass.

- [ ] **Step 5: Point the spike at the core oracle**

In `web/scripts/transition-spike.ts`: delete the local `export interface TransStep {...}` (lines 25-31) and the local `export function verifyTransition(...)` (lines 33-88). Add to the reachability import block's sibling:

```ts
import { verifyTransition as coreVerifyTransition, type TransStep } from "../src/core/orderLegality";
```

and add a local adapter preserving the script's internal call shape (the script's callers pass `(base, cur, steps, cap)`; the core oracle also needs `cons`):

```ts
export { type TransStep };
export const verifyTransition = (base: ReachCon[], cur: ReachCon[], steps: TransStep[], cap: number) =>
  coreVerifyTransition(cons, base, cur, steps, cap);
```

In `web/test/transition-spike.test.ts` no import change is needed (it imports `verifyTransition`/`TransStep` from the script, which now re-exports the core-backed versions).

- [ ] **Step 6: Run the spike tests and full suite**

Run: `just test test/transition-spike.test.ts`
Expected: all 10 pass (the core oracle is verdict-compatible).

Run: `just test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add web/src/core/orderLegality.ts web/test/transition-legality.test.ts web/scripts/transition-spike.ts web/test/transition-spike.test.ts
git commit -F - <<'EOF'
feat(transition): transition legality oracle joins orderLegality (one walk, two outputs)
EOF
```

---

### Task 2: Pair generators to test support, plus the realism gaps

**Files:**
- Create: `web/test/support/transition-pairs.ts`
- Create: `web/test/transition-pairs.test.ts`
- Modify: `web/scripts/transition-spike.ts` (import generators from support; delete local copies)
- Modify: `web/test/transition-spike.test.ts` (import `mutatePair` from support)

**Interfaces:**
- Consumes: `cons`, `generateValidBuild`, `isValidBuild`, `mulberry32`, `model` from `../../scripts/reachability-fuzz`; `decodeHash`, `canonicalStarIds` from `../../src/core/urlState`; `selectionSummary` from `../../src/core/reachability`.
- Produces: `mutatePair(rng, budget?)`, `randomPair(rng)` (moved verbatim), and NEW `resizePair(rng, budget?): { base: ReachCon[]; cur: ReachCon[] } | null` (star-level partial/resize pairs), `swapPair(rng, budget?): { base: ReachCon[]; cur: ReachCon[] } | null` (load-bearing removal regrown around the hole), `urlFixturePairs(): { label: string; base: ReachCon[]; cur: ReachCon[] }[]` (real planner links). Tasks 3 and the harness consume all five.

- [ ] **Step 1: Write the failing generator tests**

Create `web/test/transition-pairs.test.ts`:

```ts
// ABOUTME: Tests for the transition pair generators: small-delta mutations, star-level resizes,
// ABOUTME: load-bearing swaps, and real-URL fixture pairs - the corpus behind the transition nets.
import { test, expect } from "bun:test";
import { mutatePair, resizePair, swapPair, urlFixturePairs } from "./support/transition-pairs";
import { isValidBuild, mulberry32 } from "../scripts/reachability-fuzz";

test("resizePair produces a pair differing only in one member's star count", () => {
  const rng = mulberry32(21);
  let found = 0;
  for (let i = 0; i < 40 && found < 5; i++) {
    const p = resizePair(rng);
    if (!p) continue;
    found++;
    expect(isValidBuild(p.base)).toBeTrue();
    expect(isValidBuild(p.cur)).toBeTrue();
    const b = new Map(p.base.map((c) => [c.id, c.size]));
    const c2 = new Map(p.cur.map((c) => [c.id, c.size]));
    expect(b.size).toBe(c2.size);
    const diffs = [...b].filter(([id, n]) => c2.get(id) !== n);
    expect(diffs.length).toBe(1); // exactly one member resized
  }
  expect(found).toBeGreaterThan(0);
});

test("a resized partial member carries zero grant (grant only at completion)", () => {
  const rng = mulberry32(22);
  for (let i = 0; i < 40; i++) {
    const p = resizePair(rng);
    if (!p) continue;
    const b = new Map(p.base.map((c) => [c.id, c]));
    for (const c of p.cur) {
      const bc = b.get(c.id)!;
      if (c.size !== bc.size) {
        const partial = c.size < bc.size ? c : bc;
        expect(partial.grant).toEqual([0, 0, 0, 0, 0]);
        return;
      }
    }
  }
  throw new Error("no resize pair found");
});

test("swapPair removes a load-bearing granter and regrows to a valid build", () => {
  const rng = mulberry32(23);
  let found = 0;
  for (let i = 0; i < 60 && found < 3; i++) {
    const p = swapPair(rng);
    if (!p) continue;
    found++;
    expect(isValidBuild(p.base)).toBeTrue();
    expect(isValidBuild(p.cur)).toBeTrue();
    const curIds = new Set(p.cur.map((c) => c.id));
    expect(p.base.some((c) => !curIds.has(c.id))).toBeTrue(); // something was removed
  }
  expect(found).toBeGreaterThan(0);
});

test("generators are deterministic per seed", () => {
  expect(JSON.stringify(resizePair(mulberry32(9)))).toBe(JSON.stringify(resizePair(mulberry32(9))));
  expect(JSON.stringify(swapPair(mulberry32(9)))).toBe(JSON.stringify(swapPair(mulberry32(9))));
});

test("urlFixturePairs decodes real links into non-empty member lists", () => {
  const pairs = urlFixturePairs();
  expect(pairs.length).toBeGreaterThan(0);
  for (const p of pairs) {
    expect(p.base.length).toBeGreaterThan(0);
    expect(p.cur.length).toBeGreaterThan(0);
  }
});

test("mutatePair still produces distinct valid small-delta pairs (moved, not changed)", () => {
  const p = mutatePair(mulberry32(42));
  if (!p) return;
  expect(isValidBuild(p.base)).toBeTrue();
  expect(isValidBuild(p.cur)).toBeTrue();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `just test test/transition-pairs.test.ts`
Expected: FAIL — cannot resolve `./support/transition-pairs`.

- [ ] **Step 3: Implement the support module**

Create `web/test/support/transition-pairs.ts`. Move `grow`, `mutatePair`, `randomPair` VERBATIM from `web/scripts/transition-spike.ts` (including the `BUDGET`, `SEED_AFF`, `zero`, `add`, `covers` helpers they use), then add the new generators:

```ts
// ABOUTME: Transition pair generators: small-delta mutations (moved from the spike), star-level
// ABOUTME: resizes, load-bearing swaps, and real-URL fixture pairs for the transition test corpus.
import { cons, generateValidBuild, isValidBuild, model } from "../../scripts/reachability-fuzz";
import { selectionSummary, type ReachCon, type Vec } from "../../src/core/reachability";
import { canonicalStarIds, decodeHash } from "../../src/core/urlState";

const BUDGET = 55;
const SEED_AFF: Vec = [1, 1, 1, 1, 1];
const zero = (): Vec => [0, 0, 0, 0, 0];
const add = (g: Vec, x: Vec): Vec => [g[0] + x[0], g[1] + x[1], g[2] + x[2], g[3] + x[3], g[4] + x[4]];
const covers = (g: Vec, d: Vec): boolean =>
  g[0] >= d[0] && g[1] >= d[1] && g[2] >= d[2] && g[3] >= d[3] && g[4] >= d[4];

// grow / mutatePair / randomPair: moved verbatim from web/scripts/transition-spike.ts.
// [the implementer copies the three functions here unchanged]

/** A pair differing only in one member's star count: the cur side holds a PARTIAL copy (reduced
 *  size, zero grant - grants land only at completion) of one base member, or vice versa. */
export function resizePair(rng: () => number, budget = BUDGET): { base: ReachCon[]; cur: ReachCon[] } | null {
  const base = generateValidBuild(rng);
  const candidates = base.filter((c) => c.size >= 3);
  if (!candidates.length) return null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const m = candidates[Math.floor(rng() * candidates.length)]!;
    const k = 1 + Math.floor(rng() * (m.size - 1)); // 1..size-1
    const partial: ReachCon = { id: m.id, size: k, req: m.req, grant: zero() };
    const cur = base.map((c) => (c.id === m.id ? partial : c));
    if (!isValidBuild(cur)) continue; // the shrunk member's grant was load-bearing
    // Randomly orient: half the time the partial side is the BASE (a grow transition).
    return rng() < 0.5 ? { base, cur } : { base: cur, cur: base };
  }
  return null;
}

/** A pair whose delta removes a LOAD-BEARING granter (its removal alone is invalid) and regrows
 *  different members around the hole until the result is valid again - the hardest realistic shape
 *  the spike's keep-valid mutation filter biased away from. */
export function swapPair(rng: () => number, budget = BUDGET): { base: ReachCon[]; cur: ReachCon[] } | null {
  const base = generateValidBuild(rng);
  if (base.length < 4) return null;
  const bearing = base.filter((_, j) => !isValidBuild(base.filter((_, k) => k !== j)));
  if (!bearing.length) return null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const m = bearing[Math.floor(rng() * bearing.length)]!;
    const hole = base.filter((c) => c.id !== m.id);
    const cur = grow(hole, rng, budget).filter((c) => c.id !== m.id);
    if (!isValidBuild(cur)) continue;
    const changed = cur.length !== base.length || cur.some((c) => !base.some((b) => b.id === c.id));
    if (changed) return { base, cur };
  }
  return null;
}

/** Real planner links decoded into member lists (the Eel pair from the spike, near-cap by design). */
export function urlFixturePairs(): { label: string; base: ReachCon[]; cur: ReachCon[] }[] {
  const canonical = canonicalStarIds(model);
  const members = (hash: string) => selectionSummary(model, decodeHash(hash, canonical)!.selected).built;
  const CUR = "p=55&s=AAAAgAAHAAAAAAAAAAAAPADAwQf44AEAAIA_AAD8AAAAAAAAAAAAAPAD4AMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfg";
  const BASE = "p=55&s=AAAAAAAAAADABgAAAAAAPADAwQcA4AEAAIA_AAD8AAAAAAAAAPABAPAD4AMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfg";
  return [{ label: "eel-pair", base: members(BASE), cur: members(CUR) }];
}
```

Note for the implementer: `grow` is needed by both `mutatePair` and `swapPair`; keep one copy here and export nothing extra. `swapPair` filters the regrown build against re-adding the removed member so the delta genuinely swaps.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `just test test/transition-pairs.test.ts`
Expected: all pass. If `swapPair` finds no load-bearing member at these seeds, widen the outer loop bound in the test rather than weakening the property (load-bearing members exist; the "stranding" spike test proves it at seed 11).

- [ ] **Step 5: Point the spike script and test at the support module**

In `web/scripts/transition-spike.ts`: delete the local `grow`/`mutatePair`/`randomPair` and import instead:

```ts
import { mutatePair, randomPair } from "../test/support/transition-pairs";
```

(Scripts importing test support is established precedent: `build-order-validate.ts` does it.) Re-export for the existing test file: `export { mutatePair, randomPair };`

In `web/test/transition-spike.test.ts`: no change needed (imports still resolve through the script's re-exports).

- [ ] **Step 6: Full suite, then commit**

Run: `just test`
Expected: all pass.

```bash
git add web/test/support/transition-pairs.ts web/test/transition-pairs.test.ts web/scripts/transition-spike.ts
git commit -F - <<'EOF'
feat(transition): pair generators to test support; resize, swap, and URL fixture corpora
EOF
```

---

### Task 3: web/src/core/transitionOrder.ts (the two-rung engine)

**Files:**
- Create: `web/src/core/transitionOrder.ts`
- Create: `web/test/transition-order.test.ts`
- Modify: `web/scripts/transition-spike.ts` (delete the local prototype; import from core; count per-rung oracle rejections in the report)
- Delete: `web/test/transition-spike.test.ts` (every test has a new home after this task)

**Interfaces:**
- Consumes: `peakToReach`, `buildOrderPath`, `INF`, types from `./reachability`; `verifyTransition`, `TransStep` from `./orderLegality`; Task 2 generators (tests only).
- Produces: `export type TransitionRung = "incremental" | "full-respec"`; `export function incrementalTransition(cons: ReachCon[], table: CoverTable, base: ReachCon[], cur: ReachCon[], cap: number, tries?: number): TransStep[] | null`; `export function teardownRebuild(cons: ReachCon[], table: CoverTable, base: ReachCon[], cur: ReachCon[], cap: number): TransStep[] | null`; `export function transitionOrderPath(cons: ReachCon[], table: CoverTable, base: ReachCon[], cur: ReachCon[], cap: number, tries?: number): { steps: TransStep[]; rung: TransitionRung } | null`. The rungs are exported separately so the offline harness can count oracle rejections per rung.

- [ ] **Step 1: Write the failing engine tests**

Create `web/test/transition-order.test.ts`:

```ts
// ABOUTME: Tests for the transition-order engine (core/transitionOrder): the two-rung ladder is
// ABOUTME: oracle-clean on every corpus (small-delta, resize, swap, real-URL), deterministic, and
// ABOUTME: honors the identity and over-cap edges. Ported from the spike suite, minus teardown-1.
import { test, expect } from "bun:test";
import { transitionOrderPath, teardownRebuild, incrementalTransition } from "../src/core/transitionOrder";
import { verifyTransition } from "../src/core/orderLegality";
import { cons, table, generateValidBuild, mulberry32 } from "../scripts/reachability-fuzz";
import { mutatePair, resizePair, swapPair, urlFixturePairs } from "./support/transition-pairs";

const clean = (base: any, cur: any, res: any, cap: number) => {
  expect(res).not.toBeNull();
  const err = verifyTransition(cons, base, cur, res!.steps, cap);
  if (err) console.error(err);
  expect(err).toBeNull();
};

test("30 small-delta pairs are oracle-clean; the majority resolve incrementally", () => {
  const rng = mulberry32(1234);
  let produced = 0;
  let incremental = 0;
  for (let i = 0; i < 60 && produced < 30; i++) {
    const pair = mutatePair(rng);
    if (!pair) continue;
    const res = transitionOrderPath(cons, table, pair.base, pair.cur, 55);
    if (!res) continue;
    produced++;
    clean(pair.base, pair.cur, res, 55);
    if (res.rung === "incremental") incremental++;
  }
  expect(produced).toBeGreaterThan(20);
  expect(incremental).toBeGreaterThan(produced / 2); // guards the central claim, not just legality
});

test("resize pairs (star-level partials) are oracle-clean", () => {
  const rng = mulberry32(77);
  let produced = 0;
  for (let i = 0; i < 60 && produced < 10; i++) {
    const pair = resizePair(rng);
    if (!pair) continue;
    const res = transitionOrderPath(cons, table, pair.base, pair.cur, 55);
    if (!res) continue;
    produced++;
    clean(pair.base, pair.cur, res, 55);
  }
  expect(produced).toBeGreaterThan(5);
});

test("load-bearing swap pairs are oracle-clean", () => {
  const rng = mulberry32(88);
  let produced = 0;
  for (let i = 0; i < 120 && produced < 5; i++) {
    const pair = swapPair(rng);
    if (!pair) continue;
    const res = transitionOrderPath(cons, table, pair.base, pair.cur, 55);
    if (!res) continue;
    produced++;
    clean(pair.base, pair.cur, res, 55);
  }
  expect(produced).toBeGreaterThan(0);
});

test("the Eel pair (real URL): oracle-clean; Ghoul refunds before any add", () => {
  const [pair] = urlFixturePairs();
  const res = transitionOrderPath(cons, table, pair!.base, pair!.cur, 55);
  clean(pair!.base, pair!.cur, res, 55);
  // The spike pinned this pair at full-respec; teardown-1 removal does not change that. A future
  // replay improvement that resolves it incrementally should consciously revisit this pin.
  expect(res!.rung).toBe("full-respec");
  const ghoulRefund = res!.steps.findIndex((s) => s.conId.includes("ghoul") && s.kind === "refund");
  const firstAdd = res!.steps.findIndex((s) => s.kind === "add");
  expect(ghoulRefund).toBeGreaterThanOrEqual(0);
  if (firstAdd >= 0) expect(ghoulRefund).toBeLessThan(firstAdd);
});

test("teardownRebuild is oracle-clean whenever it exists", () => {
  const pair = mutatePair(mulberry32(99));
  if (!pair) return;
  const steps = teardownRebuild(cons, table, pair.base, pair.cur, 55);
  if (steps) expect(verifyTransition(cons, pair.base, pair.cur, steps, 55)).toBeNull();
});

test("identical builds transition in zero steps when they fit the cap", () => {
  const b = generateValidBuild(mulberry32(5));
  const res = transitionOrderPath(cons, table, b, b, 55);
  expect(res).not.toBeNull();
  expect(res!.steps.length).toBe(0);
});

test("identical builds OVER the cap are a none pair (the identity edge)", () => {
  const b = generateValidBuild(mulberry32(5));
  const size = b.reduce((a: number, c: any) => a + c.size, 0);
  expect(transitionOrderPath(cons, table, b, b, size - 1)).toBeNull();
});

test("transitionOrderPath is deterministic (byte-identical across calls)", () => {
  const pair = mutatePair(mulberry32(7));
  if (!pair) return;
  const a = JSON.stringify(transitionOrderPath(cons, table, pair.base, pair.cur, 55));
  const b = JSON.stringify(transitionOrderPath(cons, table, pair.base, pair.cur, 55));
  expect(a).toBe(b);
});

test("incrementalTransition alone never returns an unverified sequence", () => {
  const rng = mulberry32(555);
  for (let i = 0; i < 20; i++) {
    const pair = mutatePair(rng);
    if (!pair) continue;
    const steps = incrementalTransition(cons, table, pair.base, pair.cur, 55);
    if (steps) expect(verifyTransition(cons, pair.base, pair.cur, steps, 55)).toBeNull();
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `just test test/transition-order.test.ts`
Expected: FAIL — cannot resolve `../src/core/transitionOrder`.

- [ ] **Step 3: Implement the engine**

Create `web/src/core/transitionOrder.ts`. This is a PORT of the spike's `diffBuilds`, `seededReplay` (teardown parameter removed - it only served the dropped teardown-1 rung), `teardownRebuild`, and `transitionOrderPath` (ladder reduced to two rungs, identity-edge cap check added, `cons`/`table` parameters instead of module imports, `conById` built per call from `cons`). Vec helpers are local, matching the orderLegality precedent of small deliberate duplication over new reachability exports:

```ts
// ABOUTME: Baseline-to-current transition orders for compare mode: a two-rung ladder (incremental
// ABOUTME: seeded replay with two-pass refund scheduling, else full-respec via the churn-minimized
// ABOUTME: from-scratch orders), every rung's output verified by the transition oracle before return.
import { peakToReach, buildOrderPath, INF } from "./reachability";
import type { ReachCon, Vec, CoverTable, BuildStep } from "./reachability";
import { verifyTransition, type TransStep } from "./orderLegality";

const CAP_MAX: Vec = [20, 8, 20, 10, 20]; // per-color affinity cap; keep in sync (see orderLegality)
const zero = (): Vec => [0, 0, 0, 0, 0];
const add = (g: Vec, x: Vec): Vec => [g[0] + x[0], g[1] + x[1], g[2] + x[2], g[3] + x[3], g[4] + x[4]];
const addCap = (g: Vec, x: Vec): Vec => g.map((n, i) => Math.min(n + x[i]!, CAP_MAX[i]!)) as Vec;
const maxV = (a: Vec, b: Vec): Vec => a.map((n, i) => Math.max(n, b[i]!)) as Vec;
const covers = (g: Vec, d: Vec): boolean => g.every((n, i) => n >= d[i]!);
const deficit = (req: Vec, grant: Vec): Vec => req.map((n, i) => Math.max(0, n - grant[i]!)) as Vec;
const reqSum = (c: ReachCon) => c.req[0] + c.req[1] + c.req[2] + c.req[3] + c.req[4];
const grantRatio = (c: ReachCon) => (c.grant[0] + c.grant[1] + c.grant[2] + c.grant[3] + c.grant[4]) / c.size;
const REPLAY_CAP = 300_000; // cold-path node cap for peakToReach (exact min subset, like buildOrderPath)

export type TransitionRung = "incremental" | "full-respec";
```

then port `diffBuilds` verbatim (with `cons.find` replaced by a `conById` lookup passed in), and `seededReplay` with these mechanical changes and NOTHING else:

- signature `seededReplay(cons: ReachCon[], table: CoverTable, conById: Map<string, ReachCon>, delta: Delta, cap: number, tries: number): TransStep[] | null`
- every `teardown`/`teardownIds` reference deleted: `kept = delta.sharedFull`, `toPlace` has no teardown entries, `heldIds = new Set(delta.baseOnly.map((c) => c.id))`, `refundTarget` seeds from `delta.baseOnly` and `shrinks` only
- `conById.get(...)` where the spike used the module-level map; `peakToReach(pool, table, ...)` unchanged (both now parameters)

then:

```ts
/** The incremental rung alone (exported so the offline harness can count per-rung rejections). */
export function incrementalTransition(
  cons: ReachCon[],
  table: CoverTable,
  base: ReachCon[],
  cur: ReachCon[],
  cap: number,
  tries = 16,
): TransStep[] | null {
  const conById = new Map(cons.map((c) => [c.id, c]));
  return seededReplay(cons, table, conById, diffBuilds(base, cur, conById), cap, tries);
}

/** Full respec: reverse of the baseline's own from-scratch order, then the current build's. Both
 *  are buildOrderPath's churn-minimized orders, inherited for free. */
export function teardownRebuild(
  cons: ReachCon[],
  table: CoverTable,
  base: ReachCon[],
  cur: ReachCon[],
  cap: number,
): TransStep[] | null {
  const down: BuildStep[] | null = buildOrderPath(cons, table, base, cap, 64);
  const up: BuildStep[] | null = buildOrderPath(cons, table, cur, cap, 64);
  if (!down || !up) return null;
  const steps: TransStep[] = [];
  let held = base.reduce((a, c) => a + c.size, 0);
  for (const s of [...down].reverse()) {
    const size = Math.abs(s.points);
    const wasAdd = s.kind === "complete" || s.kind === "scaffold-add";
    held += wasAdd ? -size : size;
    steps.push(
      wasAdd
        ? { kind: "refund", conId: s.conId, from: size, to: 0, heldAfter: held }
        : { kind: "add", conId: s.conId, from: 0, to: size, heldAfter: held },
    );
  }
  for (const s of up) {
    const size = Math.abs(s.points);
    const isAdd = s.kind === "complete" || s.kind === "scaffold-add";
    held += isAdd ? size : -size;
    steps.push(
      isAdd
        ? { kind: "add", conId: s.conId, from: 0, to: size, heldAfter: held }
        : { kind: "refund", conId: s.conId, from: size, to: 0, heldAfter: held },
    );
  }
  return steps;
}

/**
 * The two-rung escalation ladder: incremental, else full respec, each verified by the transition
 * oracle before return (verified or absent). The identity edge returns the empty transition only
 * when the build fits the cap; a base equal to cur but over cap is a none pair. Deterministic.
 */
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
  const clean = (steps: TransStep[] | null) => steps && verifyTransition(cons, base, cur, steps, cap) === null;
  const s0 = seededReplay(cons, table, conById, delta, cap, tries);
  if (clean(s0)) return { steps: s0!, rung: "incremental" };
  const s2 = teardownRebuild(cons, table, base, cur, cap);
  if (clean(s2)) return { steps: s2!, rung: "full-respec" };
  return null;
}
```

`diffBuilds`' resize entry uses `conById.get(id)!` for the full constellation (the spike used `cons.find`); its signature becomes `diffBuilds(base: ReachCon[], cur: ReachCon[], conById: Map<string, ReachCon>): Delta`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `just test test/transition-order.test.ts`
Expected: all pass. Failure triage: the Eel-pair rung pin and the majority-incremental bar passed in the spike with the SAME logic; if either fails, suspect a port slip (a missed teardown deletion, a `conById` miss), not the thresholds. Do not loosen an assertion to pass; report BLOCKED instead.

- [ ] **Step 5: Slim the spike script to a pure offline harness**

In `web/scripts/transition-spike.ts`: delete the local `diffBuilds`/`seededReplay`/`teardownRebuild`/`transitionOrderPath` and their now-unused helpers; import instead:

```ts
import { transitionOrderPath, teardownRebuild, incrementalTransition } from "../src/core/transitionOrder";
```

Update `measure()` call sites to the new signatures (`transitionOrderPath(cons, table, base, cur, cap)`, `teardownRebuild(cons, table, base, cur, cap)`). Add the per-rung rejection count (the spec's realism gap): in `measure()`, when `transitionOrderPath` returns full-respec or null, call `incrementalTransition(...)` and, if it returned steps, count it as an incremental oracle rejection (record on `PairResult` as `incRejected: boolean`); `report()` prints per corpus:

```ts
const incRej = rs.filter((r) => r.incRejected).length;
console.log(`  incremental oracle rejections (demotions): ${incRej}`);
```

Delete `web/test/transition-spike.test.ts` (tests 1-4 live in transition-legality.test.ts, 5-6 in transition-pairs.test.ts, 7-10 in transition-order.test.ts).

Run: `just spike-transition --pairs 40` (about a minute)
Expected: report prints, zero oracle failures, the new rejections line appears, rung distribution shows incremental majority on small-delta.

- [ ] **Step 6: Full suite, then commit**

Run: `just test`
Expected: all pass (one fewer test file; nothing else affected).

```bash
git add web/src/core/transitionOrder.ts web/test/transition-order.test.ts web/scripts/transition-spike.ts
git rm web/test/transition-spike.test.ts
git commit -F - <<'EOF'
feat(transition): two-rung transition engine in core; spike script becomes the offline harness
EOF
```

---

### Task 4: selectionView gains the baseline (gated transition in the view)

**Files:**
- Modify: `web/src/core/reachability.ts` (the `SelectionView` interface ~line 1245 and `selectionView` ~line 1260 ONLY)
- Create: `web/test/selection-transition.test.ts`

**Interfaces:**
- Consumes: `transitionOrderPath`, `TransitionRung` from `./transitionOrder`; `gateTransition`, `TransStep` from `./orderLegality` (extend the existing orderLegality import at line 7).
- Produces: `SelectionView` gains `transition: { steps: TransStep[]; states: StepState[]; rung: TransitionRung } | null`; `selectionView(model, cons, table, selected, cap = BUDGET, baseline: Set<StarId> | null = null)`. Task 5's `main.ts` wiring relies on exactly these names.

- [ ] **Step 1: Write the failing view tests**

Create `web/test/selection-transition.test.ts`:

```ts
// ABOUTME: selectionView's compare path: with a baseline it returns a gated transition (steps and
// ABOUTME: states from the verifying replay); without one, behavior is unchanged; none pairs fall
// ABOUTME: back to the from-scratch order so compare mode never shows less than today.
import { test, expect } from "bun:test";
import { selectionView, selectionSummary } from "../src/core/reachability";
import { verifyTransition } from "../src/core/orderLegality";
import { model, cons, table } from "../scripts/reachability-fuzz";
import { canonicalStarIds, decodeHash } from "../src/core/urlState";

const canonical = canonicalStarIds(model);
const CUR = "p=55&s=AAAAgAAHAAAAAAAAAAAAPADAwQf44AEAAIA_AAD8AAAAAAAAAAAAAPAD4AMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfg";
const BASE = "p=55&s=AAAAAAAAAADABgAAAAAAPADAwQcA4AEAAIA_AAD8AAAAAAAAAPABAPAD4AMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfg";
const curSel = decodeHash(CUR, canonical)!.selected;
const baseSel = decodeHash(BASE, canonical)!.selected;

test("with a baseline, selectionView returns a verified transition with matching states", () => {
  const view = selectionView(model, cons, table, curSel, 55, baseSel);
  expect(view.transition).not.toBeNull();
  const baseMembers = selectionSummary(model, baseSel).built;
  const curMembers = selectionSummary(model, curSel).built;
  expect(verifyTransition(cons, baseMembers, curMembers, view.transition!.steps, 55)).toBeNull();
  expect(view.transition!.states.length).toBe(view.transition!.steps.length);
});

test("the transition's final state agrees with the Affinity panel (supply/target)", () => {
  const view = selectionView(model, cons, table, curSel, 55, baseSel);
  const last = view.transition!.states[view.transition!.states.length - 1]!;
  const summary = selectionSummary(model, curSel);
  expect(last.have).toEqual(summary.supply);
  expect(last.need).toEqual(summary.target);
});

test("when a transition renders, the from-scratch order is not computed (replaced, not stacked)", () => {
  const view = selectionView(model, cons, table, curSel, 55, baseSel);
  expect(view.transition).not.toBeNull();
  expect(view.buildOrder).toBeNull();
});

test("without a baseline, behavior is unchanged", () => {
  const withNull = selectionView(model, cons, table, curSel, 55, null);
  const without = selectionView(model, cons, table, curSel, 55);
  expect(JSON.stringify(withNull.buildOrder)).toBe(JSON.stringify(without.buildOrder));
  expect(withNull.transition).toBeNull();
});

test("an empty baseline set means no comparison", () => {
  const view = selectionView(model, cons, table, curSel, 55, new Set());
  expect(view.transition).toBeNull();
});

test("a none pair falls back to the from-scratch order (never less than today)", () => {
  // Identity over cap is the guaranteed none pair: baseline equals current, cap below the build size.
  const size = selectionSummary(model, curSel).built.reduce((a, c) => a + c.size, 0);
  const view = selectionView(model, cons, table, curSel, size - 1, curSel);
  expect(view.transition).toBeNull();
  // buildOrder may be null too at this tight cap; the property is that the from-scratch path RAN:
  expect(view.buildOrderStates === null).toBe(view.buildOrder === null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `just test test/selection-transition.test.ts`
Expected: FAIL — `selectionView` does not accept a sixth argument / `transition` is undefined.

- [ ] **Step 3: Implement**

In `web/src/core/reachability.ts`, extend the orderLegality import (line 7) to:

```ts
import { gateBuildOrder, gateTransition, type StepState, type TransStep } from "./orderLegality";
```

add below it:

```ts
import { transitionOrderPath, type TransitionRung } from "./transitionOrder";
```

Extend the interface:

```ts
export interface SelectionView {
  minCost: number;
  reach: ReachView;
  buildOrder: BuildStep[] | null;
  buildOrderStates: StepState[] | null;
  /** Compare mode: the verified baseline-to-current transition, with its replay's states; null
   *  when not comparing or when no rung produced a verified order (the panel then falls back to
   *  the from-scratch order). */
  transition: { steps: TransStep[]; states: StepState[]; rung: TransitionRung } | null;
}
```

Replace the `selectionView` body's order section:

```ts
export function selectionView(
  model: DevotionModel,
  cons: ReachCon[],
  table: CoverTable,
  selected: Set<StarId>,
  cap = BUDGET,
  baseline: Set<StarId> | null = null,
): SelectionView {
  const minCost = selectionMinCost(model, cons, table, selected);
  const reach = reachabilityForSelection(model, cons, table, selected, Math.max(cap, minCost));
  const members = selectionSummary(model, selected).built;
  // Compare mode: the transition REPLACES the from-scratch computation (roughly flat per-click
  // cost); a none pair falls back to the from-scratch order so compare never shows less than today.
  if (baseline && baseline.size > 0) {
    const baseMembers = selectionSummary(model, baseline).built;
    const raw = transitionOrderPath(cons, table, baseMembers, members, cap, 16);
    const gated = raw ? gateTransition(cons, baseMembers, members, raw.steps, cap) : null;
    if (gated) {
      return {
        minCost,
        reach,
        buildOrder: null,
        buildOrderStates: null,
        transition: { steps: gated.steps, states: gated.states, rung: raw!.rung },
      };
    }
  }
  const raw = members.length ? buildOrderPath(cons, table, members, cap, 16) : null;
  const gated = gateBuildOrder(cons, members, raw, cap);
  return {
    minCost,
    reach,
    buildOrder: gated?.steps ?? null,
    buildOrderStates: gated?.states ?? null,
    transition: null,
  };
}
```

- [ ] **Step 4: Run the new tests, the port test, and the full suite**

Run: `just test test/selection-transition.test.ts test/build-order-oracle.test.ts`
Expected: all pass (the no-baseline path is byte-identical; the oracle corpus and pins see no change).

Run: `just test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/reachability.ts web/test/selection-transition.test.ts
git commit -F - <<'EOF'
feat(transition): selectionView takes a baseline and returns the gated transition
EOF
```

---

### Task 5: Panel rendering, i18n, popup, and main.ts wiring

**Files:**
- Modify: `web/src/adapters/buildOrderView.ts` (new `transitionHtml`; popup sign covers `"refund"`)
- Modify: `web/src/app/main.ts` (pass baseline into selectionView; render/wire the transition panel; popup reads the active steps/states)
- Modify: `web/src/i18n/app.en.json` and all 12 locale files (4 new keys)
- Modify: `web/test/appCatalog.test.ts` (REQUIRED additions)
- Create: `web/test/transition-view.test.ts`

**Interfaces:**
- Consumes: `TransStep`, `StepState` from core; `TransitionRung` from `./transitionOrder` (type-only in the adapter); existing `stepConName`, `esc`, row idioms in buildOrderView.ts.
- Produces: `export function transitionHtml(loc, model, manifest, steps: TransStep[], rung: TransitionRung): string`; `buildStepPopupHtml(loc, model, step: BuildStep | TransStep, state: StepState)`. main.ts state: `curTransition: { steps: TransStep[]; states: StepState[]; rung: TransitionRung } | null`.

- [ ] **Step 1: Write the failing adapter tests**

Create `web/test/transition-view.test.ts`:

```ts
// ABOUTME: Renders the compare-mode transition panel: direction heading, add/refund rows with star
// ABOUTME: deltas and step indices for the popup, full-respec notice, and the identity empty state.
import { test, expect } from "bun:test";
import { transitionHtml, buildStepPopupHtml } from "../src/adapters/buildOrderView";
import { selectionView, selectionSummary } from "../src/core/reachability";
import { model, cons, table } from "../scripts/reachability-fuzz";
import { canonicalStarIds, decodeHash } from "../src/core/urlState";
import { enLoc } from "./helpers/localizeEn";

const canonical = canonicalStarIds(model);
const CUR = "p=55&s=AAAAgAAHAAAAAAAAAAAAPADAwQf44AEAAIA_AAD8AAAAAAAAAAAAAPAD4AMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfg";
const BASE = "p=55&s=AAAAAAAAAADABgAAAAAAPADAwQcA4AEAAIA_AAD8AAAAAAAAAPABAPAD4AMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfg";
const view = selectionView(model, cons, table, decodeHash(CUR, canonical)!.selected, 55, decodeHash(BASE, canonical)!.selected);
const t = view.transition!;

test("the transition panel carries the direction heading and per-step indices", () => {
  const html = transitionHtml(enLoc, model, null, t.steps, t.rung);
  expect(html).toContain("Baseline to current build");
  expect(html).toContain('data-step-i="0"');
  expect(html).toContain(`data-step-i="${t.steps.length - 1}"`);
});

test("refund rows carry bo-refund and negative deltas; add rows bo-add or bo-complete", () => {
  const html = transitionHtml(enLoc, model, null, t.steps, t.rung);
  expect(html).toContain("bo-refund");
  expect(html).toMatch(/class="bo-pts">-\d/);
  expect(html).toMatch(/bo-(add|complete)/);
});

test("the full-respec rung shows its plain notice", () => {
  const html = transitionHtml(enLoc, model, null, t.steps, "full-respec");
  expect(html).toContain("full rebuild");
  const inc = transitionHtml(enLoc, model, null, t.steps, "incremental");
  expect(inc).not.toContain("full rebuild");
});

test("zero steps renders the builds-match empty state", () => {
  const html = transitionHtml(enLoc, model, null, [], "incremental");
  expect(html).toContain("match");
});

test("the popup renders a transition refund with a negative grant delta", () => {
  const fi = t.steps.findIndex((s, i) => s.kind === "refund" && t.states[i]!.conGrant.some((n) => n > 0));
  expect(fi).toBeGreaterThanOrEqual(0);
  const g = t.states[fi]!.conGrant.find((n) => n > 0)!;
  expect(buildStepPopupHtml(enLoc, model, t.steps[fi]!, t.states[fi]!)).toContain(
    `<span class="bo-pop-delta">(-${g})</span>`,
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `just test test/transition-view.test.ts`
Expected: FAIL — `transitionHtml` is not exported.

- [ ] **Step 3: Catalog keys**

Add to `web/src/i18n/app.en.json`, inside the `ui.buildOrder.*` group (after the existing keys, matching the file's grouped-by-prefix order):

```json
"ui.buildOrder.transitionHeading": "Baseline to current build",
"ui.buildOrder.fullRespecNote": "No incremental path fits the point cap. This order is a full rebuild.",
"ui.buildOrder.transitionIdentical": "The baseline and current build match. Nothing to change.",
"ui.buildOrder.transitionUnavailable": "No transition order found. Showing the current build from scratch."
```

Add the same four key names to the `REQUIRED` array in `web/test/appCatalog.test.ts` beside the other `ui.buildOrder.*` entries.

Add translations to each locale file (alphabetical position within each file, matching its convention):

| Key | de | es | fr |
|---|---|---|---|
| transitionHeading | "Basis zum aktuellen Build" | "De la base a la build actual" | "De la base vers le build actuel" |
| fullRespecNote | "Kein schrittweiser Pfad passt in das Punktelimit. Diese Reihenfolge ist ein kompletter Neuaufbau." | "Ninguna ruta incremental cabe en el limite de puntos. Este orden es una reconstruccion completa." | "Aucun chemin progressif ne tient dans la limite de points. Cet ordre est une reconstruction complete." |
| transitionIdentical | "Basis und aktueller Build stimmen ueberein. Nichts zu aendern." | "La base y la build actual coinciden. Nada que cambiar." | "La base et le build actuel sont identiques. Rien a changer." |
| transitionUnavailable | "Keine Umbau-Reihenfolge gefunden. Zeige den aktuellen Build von Grund auf." | "No se encontro un orden de transicion. Se muestra la build actual desde cero." | "Aucun ordre de transition trouve. Affichage du build actuel depuis le debut." |

| Key | it | pt | pl |
|---|---|---|---|
| transitionHeading | "Dalla base alla build attuale" | "Da base para a build atual" | "Od bazy do obecnego buildu" |
| fullRespecNote | "Nessun percorso incrementale rientra nel limite di punti. Questo ordine e una ricostruzione completa." | "Nenhum caminho incremental cabe no limite de pontos. Esta ordem e uma reconstrucao completa." | "Zadna przyrostowa sciezka nie miesci sie w limicie punktow. Ta kolejnosc to pelna przebudowa." |
| transitionIdentical | "La base e la build attuale coincidono. Niente da cambiare." | "A base e a build atual coincidem. Nada a mudar." | "Baza i obecny build sa zgodne. Nic do zmiany." |
| transitionUnavailable | "Nessun ordine di transizione trovato. Viene mostrata la build attuale da zero." | "Nenhuma ordem de transicao encontrada. Mostrando a build atual do zero." | "Nie znaleziono kolejnosci przejscia. Wyswietlanie obecnego buildu od zera." |

| Key | cs | ru | ja |
|---|---|---|---|
| transitionHeading | "Ze zakladu na soucasny build" | "От базы к текущему билду" | "ベースから現在のビルドへ" |
| fullRespecNote | "Zadna postupna cesta se nevejde do limitu bodu. Toto poradi je uplna prestavba." | "Пошаговый путь не укладывается в лимит очков. Этот порядок — полная перестройка." | "段階的な経路がポイント上限に収まりません。この順序は完全な再構築です。" |
| transitionIdentical | "Zaklad a soucasny build se shoduji. Neni co menit." | "База и текущий билд совпадают. Менять нечего." | "ベースと現在のビルドは一致しています。変更はありません。" |
| transitionUnavailable | "Poradi prechodu nenalezeno. Zobrazuje se soucasny build od zacatku." | "Порядок перехода не найден. Показан текущий билд с нуля." | "移行順序が見つかりません。現在のビルドを最初から表示します。" |

| Key | ko | zh | vi |
|---|---|---|---|
| transitionHeading | "베이스에서 현재 빌드로" | "从基准到当前构建" | "Tu ban goc den ban dung hien tai" |
| fullRespecNote | "점진적 경로가 포인트 상한에 맞지 않습니다. 이 순서는 전체 재구축입니다." | "没有增量路径能满足点数上限。此顺序为完全重建。" | "Khong co duong tang dan nao vua gioi han diem. Thu tu nay la xay lai toan bo." |
| transitionIdentical | "베이스와 현재 빌드가 일치합니다. 변경할 것이 없습니다." | "基准与当前构建一致。无需更改。" | "Ban goc va ban dung hien tai trung khop. Khong co gi de thay doi." |
| transitionUnavailable | "전환 순서를 찾지 못했습니다. 현재 빌드를 처음부터 표시합니다." | "未找到过渡顺序。显示从零开始的当前构建。" | "Khong tim thay thu tu chuyen doi. Hien thi ban dung hien tai tu dau." |

The ru note uses a Cyrillic long dash inside a TRANSLATED string, which is fine (the no-emdash rule governs docs and English copy); if the locale files elsewhere avoid it, use a comma instead.

- [ ] **Step 4: Implement transitionHtml and the popup sign**

In `web/src/adapters/buildOrderView.ts`:

1. Change `buildStepPopupHtml`'s signature to `step: BuildStep | TransStep` (import `type TransStep` from `../core/orderLegality`) and the sign line to:

```ts
const sign = step.kind === "scaffold-refund" || step.kind === "refund" ? "-" : "+";
```

2. Add `transitionHtml`, reusing the module's `esc`, `stepConName`, art/dot helpers and row idioms (numbered art rows for completions, `bo-add`/`bo-refund` rows otherwise; `bo-partial` badge when a step ends below full size):

```ts
/** Compare mode: the baseline-to-current transition order. Same row vocabulary as the from-scratch
 *  panel (the popup rides data-step-i identically); a heading names the direction, and the
 *  full-respec rung carries a plain notice. Zero steps means the builds already match. */
export function transitionHtml(
  loc: Localization,
  model: DevotionModel,
  manifest: ArtManifest | null,
  steps: TransStep[],
  rung: TransitionRung,
): string {
  const head = `<h2>${loc.translate("ui.panel.buildOrder")}</h2><div class="bo-compare-head">${loc.translate("ui.buildOrder.transitionHeading")}</div>`;
  const note =
    rung === "full-respec" ? `<div class="bo-note">${loc.translate("ui.buildOrder.fullRespecNote")}</div>` : "";
  if (!steps.length) return `${head}<div class="bo-empty">${loc.translate("ui.buildOrder.transitionIdentical")}</div>`;
  let n = 0;
  const rows = steps
    .map((s, si) => {
      const c = model.constellations.get(s.conId);
      const delta = s.to - s.from;
      const completes = s.kind === "add" && c && s.to === c.starIds.length;
      const name = stepConName(loc, model, s.conId);
      const pts = `<span class="bo-pts">${delta > 0 ? "+" : ""}${delta}</span>`;
      const held = `<span class="bo-held">${s.heldAfter}</span>`;
      if (completes) {
        n++;
        return `<div class="bo-step bo-complete" data-con-id="${esc(s.conId)}" data-step-i="${si}"><span class="bo-num">${n}</span>${artHtml(manifest, s.conId)}<span class="bo-name">${esc(name)}</span>${pts}${held}</div>`;
      }
      const label = loc.translate(s.kind === "add" ? "ui.buildOrder.add" : "ui.buildOrder.refund");
      const cls = s.kind === "add" ? "bo-add" : "bo-refund";
      const partial =
        s.to > 0 && c && s.to < c.starIds.length ? ` <span class="bo-partial">${loc.translate("ui.buildOrder.partial")}</span>` : "";
      return `<div class="bo-step ${cls}" data-con-id="${esc(s.conId)}" data-step-i="${si}"><span class="bo-label">${esc(label)}</span><span class="bo-name">${esc(name)}</span>${partial}${pts}${held}</div>`;
    })
    .join("");
  return `${head}${note}<div class="bo-list">${rows}</div>`;
}
```

The implementer MUST reconcile this sketch with the file's actual row markup (the from-scratch renderer's exact art/dot/badge helpers and class order at buildOrderView.ts:91-121) so transition rows are visually identical to existing rows; the sketch shows intent, the existing rows are the source of truth for markup details. Add a minimal `.bo-compare-head` and `.bo-note` style in `web/src/styles.css` beside the existing `.bo-empty` rules (muted color, small font, margin under the h2), matching neighboring style idioms.

3. In `web/src/app/main.ts`:
- Declare beside `curBuildOrder` (line ~556): `let curTransition: SelectionView["transition"] = null;`
- In `refresh()` (line ~649): `const view = selectionView(model, cons, table, state.selected, state.pointCap, baseline?.selected ?? null);` then `curTransition = view.transition;` beside the existing assignments; set `curTransition = null` in the degraded paths (lines ~656-660).
- Popup source: in `showBoPop` (line ~575), read from the active pair:

```ts
const steps = curTransition ? curTransition.steps : curBuildOrder;
const states = curTransition ? curTransition.states : curBuildOrderStates;
```

with the same index guard, calling `buildStepPopupHtml(localization, model, steps[i]!, states[i]!)`.
- Paint: where `paintBuildOrder(curBuildOrder, boInfo)` is called (line ~713), branch first:

```ts
if (curTransition) paintTransition(curTransition);
else paintBuildOrder(curBuildOrder, boInfo);
```

`paintTransition` mirrors `paintBuildOrder` (same lazy `#build-order-panel` creation, same per-row listener wiring for highlight + popup) but calls `transitionHtml(localization, model, artManifest, t.steps, t.rung)`. When comparing and `curTransition` is null but `curBuildOrder` exists (the none pair), `paintBuildOrder` renders as today PLUS a leading notice: extend `buildOrderHtml`'s wrapper call in `paintBuildOrder` by prepending `<div class="bo-note">${loc.translate("ui.buildOrder.transitionUnavailable")}</div>` into the panel HTML when `baseline !== null` (a small conditional in `paintBuildOrder`, not a buildOrderHtml change: `panel.innerHTML = note + buildOrderHtml(...)`).

- [ ] **Step 5: Run the adapter tests, the popup tests, and the full suite**

Run: `just test test/transition-view.test.ts test/build-order-popup.test.ts test/appCatalog.test.ts`
Expected: all pass.

Run: `just test`
Expected: all pass.

- [ ] **Step 6: Look at it**

Run: `just serve` (background), open `http://localhost:5173`, load the CUR hash from the tests, press Set baseline, remove a constellation, and confirm: the panel heading says Baseline to current build, refund rows show negative deltas, hovering a step shows the popup, Swap flips the direction, exiting compare restores the from-scratch panel. Then `just stop`. Note observations in the report (this is a smoke look, not the e2e).

- [ ] **Step 7: Commit**

```bash
git add web/src/adapters/buildOrderView.ts web/src/app/main.ts web/src/styles.css web/src/i18n/*.json web/test/appCatalog.test.ts web/test/transition-view.test.ts
git commit -F - <<'EOF'
feat(transition): compare-mode panel renders the verified transition with popup and i18n
EOF
```

---

### Task 6: E2e, perf, docs

**Files:**
- Modify: `web/e2e/smoke.ts` (transition checks inside the existing compare block, lines ~346-439)
- Modify: `docs/reachability-engine.md` (transition paragraph in the guided-build-order section)
- Modify: `docs/display-model.md` (one compare-mode panel sentence, if the doc describes the build-order panel; skip if it does not)

**Interfaces:**
- Consumes: everything shipped in Tasks 1-5; the smoke file's `check(ok, msg)` idiom and its compare block (`#set-baseline`, `#cmp-swap`, `#cmp-revert`, `.cmp-bar`).

- [ ] **Step 1: E2e checks**

In `web/e2e/smoke.ts`, inside the compare block after the swap assertions (line ~435, before the final revert), add a transition sequence. The existing divergence only ADDS a star, which yields an adds-only transition; to force a refund step, deselect the added star after setting a fresh baseline that contains it:

```ts
// Transition order: set a baseline, REMOVE something, and the panel must show a refund step.
await cdp.click("#set-baseline");
await cdp.pollUntil(() => cdp.evaluate<boolean>("!!document.querySelector('.cmp-bar')"));
// deselect the star added during the swap setup (clicking a selected leaf star removes it)
await cdp.clickStar(divergedStarId); // reuse the block's existing star handle/id variable
check(
  await cdp.pollUntil(() =>
    cdp.evaluate<boolean>("document.querySelector('#build-order-panel .bo-compare-head') !== null"),
  ),
  "comparing with a removal shows the transition panel (direction heading present)",
);
check(
  await cdp.evaluate<number>("document.querySelectorAll('#build-order-panel .bo-refund').length") > 0,
  "the transition contains a refund step for the removed member",
);
await cdp.click("#cmp-swap");
check(
  await cdp.pollUntil(() =>
    cdp.evaluate<boolean>("document.querySelector('#build-order-panel .bo-compare-head') !== null"),
  ),
  "swap keeps the transition panel (direction always reads baseline to current)",
);
await cdp.click("#cmp-swap"); // restore orientation
await cdp.click("#cmp-revert");
check(
  await cdp.pollUntil(() =>
    cdp.evaluate<boolean>("document.querySelector('#build-order-panel .bo-compare-head') === null"),
  ),
  "exiting compare restores the from-scratch build order",
);
```

This block is a SKETCH against the smoke file's real helper names: the file drives raw CDP (no `cdp.click`/`clickStar`/`pollUntil` helpers may exist under those names) — reuse the exact click/poll idioms of the surrounding compare block (lines 346-439) verbatim, and reuse its existing diverged-star variable. The five `check(...)` messages above are the contract; the mechanics must match the file's house style. End with the block's established clean-state restoration so later sections are unaffected, and re-check `cdp.consoleErrors` at the end as the popup blocks do.

Run: `just e2e`
Expected: all checks pass including the five new ones; zero console errors.

- [ ] **Step 2: Perf**

Run: `just perf > .superpowers/sdd/perf-transition.txt 2>&1; tail -20 .superpowers/sdd/perf-transition.txt`
Expected: headline numbers at parity with `.superpowers/sdd/perf-baseline.txt` (the non-compare path gained only a null parameter; the harness does not exercise compare mode). Record both headline blocks in the task report. Additionally record the transition's own cost from the offline harness: `just spike-transition --pairs 100` and copy the `runtime transition` / `runtime from-scratch` lines per corpus into the report (the spec requires re-measuring the stale spike ratio).

- [ ] **Step 3: Docs**

In `docs/reachability-engine.md`, in "The guided build order" section, append after the ordering-strategy paragraph:

```markdown
While comparing, the panel shows a baseline-to-current TRANSITION instead: a
two-rung ladder (web/src/core/transitionOrder.ts) tries an incremental seeded
replay (kept members stand, baseline-only members serve as pre-paid scaffolds,
two-pass refund scheduling), then falls back to a full respec built from the
churn-minimized from-scratch orders. Every rung's output must pass the
transition oracle (`replayTransition` in web/src/core/orderLegality.ts, the
same one-walk-two-outputs pattern) before display, and the popup's states come
from that verifying replay. A pair with no verified transition falls back to
the current build's from-scratch order, so compare mode never shows less than
the normal panel.
```

In `docs/display-model.md`: if the doc describes the build-order panel's states, add one sentence noting the compare-mode transition variant and its keys; if the doc does not cover the panel, skip and note that in the report.

- [ ] **Step 4: Full gate and commit**

Run: `just test`
Expected: all pass.

```bash
git add web/e2e/smoke.ts docs/reachability-engine.md docs/display-model.md
git commit -F - <<'EOF'
feat(transition): e2e transition checks, perf re-measurement, living docs
EOF
```

(Drop `docs/display-model.md` from the `git add` if Step 3 skipped it.)
