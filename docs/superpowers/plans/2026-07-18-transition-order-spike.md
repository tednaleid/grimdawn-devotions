# Transition Order Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A headless spike that prototypes baseline-to-current transition build orders, verifies every emitted order with an independent legality oracle, and reports the numbers that decide whether the real compare-mode feature gets built.

**Architecture:** One script (`web/scripts/transition-spike.ts`) importing the engine's exported primitives and the fuzzer's exported model/generator. Three layers: an independent oracle (ground truth, built first), a corpus generator (valid build pairs), and the prototype `transitionOrderPath` (seeded replay + two-pass refund scheduling + escalation ladder over shared teardowns). A CI test file guards the pure pieces, following the `reachability-fuzz.test.ts` precedent.

**Tech Stack:** TypeScript run under Bun; `bun test`; `just` recipes. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-18-transition-order-spike-design.md`

## Global Constraints

- ZERO product-code changes: the only files touched are `web/scripts/transition-spike.ts` (new), `web/test/transition-spike.test.ts` (new), `justfile` (one recipe), and the spec (Findings section, Task 4). `web/src/**` must not change.
- The oracle is ground truth and shares no bookkeeping with the prototype's replay. Every emitted order must pass it; a failure is a prototype bug to fix, never to ship.
- Deterministic: all randomness through the fuzzer's exported `mulberry32(seed)`; a given `--seed` reproduces the exact corpus and results. Timing via `Bun.nanoseconds()` is measurement, not logic.
- Engine imports come from `../src/core/reachability` (all needed functions are already exported); model/generator imports come from `./reachability-fuzz` (exports `model`, `cons`, `table`, `generateValidBuild`, `isValidBuild`, `mulberry32`). Re-declare the one-line vec helpers locally; do not export them from core.
- The pre-commit hook runs the full gate (~90s). Never `--no-verify`. Give commit commands 180000ms timeouts.
- Match house script style: dense single-file, ABOUTME header, exported pure pieces for the CI guard.

## Shared vocabulary (used by every task)

A build is a `ReachCon[]` (whole constellations; a partial constellation appears as `{id, size: selectedCount, req, grant: zero}` exactly as `selectionSummary(...).built` produces). A transition is:

```ts
export interface TransStep {
  kind: "add" | "refund";
  conId: string;
  from: number; // star count before this step (0 for a fresh add)
  to: number;   // star count after (0 for a full refund)
  heldAfter: number; // total stars standing after the step
}
```

`points(step) = Math.abs(step.to - step.from)`. Moved points of an order = sum of `points`. Theoretical minimum for a pair = sum over constellation ids of `|countCur - countBase|`.

---

### Task 1: Script skeleton and the legality oracle

**Files:**
- Create: `web/scripts/transition-spike.ts`
- Create: `web/test/transition-spike.test.ts`

**Interfaces:**
- Consumes: `model`, `cons` from `./reachability-fuzz`; `ReachCon`, `Vec` types from `../src/core/reachability`.
- Produces: `TransStep` (above), `verifyTransition(base: ReachCon[], cur: ReachCon[], steps: TransStep[], cap: number): string | null` (null = legal; string = first violation, human-readable). Tasks 2-4 rely on these exact names.

- [ ] **Step 1: Write the failing oracle tests**

Create `web/test/transition-spike.test.ts`:

```ts
// ABOUTME: CI guard for the transition-order spike's pure pieces: the legality oracle first
// ABOUTME: (ground truth for every emitted order), later the corpus generator and prototype.
import { test, expect } from "bun:test";
import { cons, generateValidBuild, mulberry32 } from "../scripts/reachability-fuzz";
import { verifyTransition, type TransStep } from "../scripts/transition-spike";
import type { ReachCon } from "../src/core/reachability";
// Later tasks EXTEND these two import lines (model, isValidBuild, mutatePair, ...) rather than adding
// duplicate import statements for the same modules.

const byId = new Map(cons.map((c) => [c.id, c]));
const con = (id: string): ReachCon => {
  const c = byId.get(id);
  if (!c) throw new Error(`no constellation ${id}`);
  return c;
};
// Two free footholds (req 0) and one dependent: crossroads grant affinity, eel requires primordial.
const xrP = con("crossroads_primordial"); // grants primordial, req zero, size 1
const eel = con("eel"); // requires primordial

const step = (kind: "add" | "refund", c: ReachCon, from: number, to: number, heldAfter: number): TransStep => ({
  kind, conId: c.id, from, to, heldAfter,
});

test("a legal add sequence from empty passes", () => {
  const curBuild = [xrP, eel];
  const steps: TransStep[] = [
    step("add", xrP, 0, xrP.size, xrP.size),
    step("add", eel, 0, eel.size, xrP.size + eel.size),
  ];
  expect(verifyTransition([], curBuild, steps, 55)).toBeNull();
});

test("stranding a dependent is a violation", () => {
  // Ground-truth search: find a valid build with a load-bearing member (its removal leaves some
  // standing requirement uncovered by the remaining grants). Refunding that member first must fail.
  // NOTE: a member's own grant can cover its own requirement (Eel alone is a valid standing state),
  // so "in the build" does not imply "load-bearing" - hence the explicit covers() check.
  const vAdd = (g: number[], x: number[]) => g.map((v, i) => v + x[i]!);
  const vCovers = (g: number[], d: number[]) => d.every((v, i) => g[i]! >= v);
  const uncovered = (B: ReachCon[]): boolean => {
    let grant = [0, 0, 0, 0, 0];
    let req = [0, 0, 0, 0, 0];
    for (const c of B) {
      grant = vAdd(grant, c.grant);
      req = req.map((v, i) => Math.max(v, c.req[i]!));
    }
    return !vCovers(grant, req);
  };
  const rng = mulberry32(11);
  for (let i = 0; i < 50; i++) {
    const B = generateValidBuild(rng);
    const idx = B.findIndex((_, j) => uncovered(B.filter((_, k) => k !== j)));
    if (idx < 0) continue;
    const m = B[idx]!;
    const rest = B.filter((_, k) => k !== idx);
    const held = rest.reduce((a, c) => a + c.size, 0);
    const steps: TransStep[] = [step("refund", m, m.size, 0, held)];
    expect(verifyTransition(B, rest, steps, 55)).toContain("uncovered");
    return;
  }
  throw new Error("no load-bearing member found in 50 generated builds");
});

test("exceeding the cap is a violation", () => {
  const steps: TransStep[] = [step("add", xrP, 0, xrP.size, xrP.size)];
  expect(verifyTransition([], [xrP], steps, 0)).toContain("cap");
});

test("an order that does not end at the current build is a violation", () => {
  expect(verifyTransition([], [xrP], [], 55)).toContain("end state");
});
```

Note for the implementer: verify the two constellation ids with `grep -o '"id": *"[^"]*"' data/devotions.json | sort -u | grep -i -e cross -e eel` before relying on them; if `eel`'s real id differs (for example `eel_constellation`), use the real id. The test must use a genuinely req-free granting constellation and a genuinely dependent one.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && bun test transition-spike`
Expected: FAIL — `transition-spike.ts` does not exist yet (import error).

- [ ] **Step 3: Implement the oracle**

Create `web/scripts/transition-spike.ts`:

```ts
// ABOUTME: Spike harness for baseline-to-current transition build orders (compare mode). Prototypes a
// ABOUTME: seeded replay with two-pass refund scheduling and a shared-teardown escalation ladder, checks
// ABOUTME: every order against an independent legality oracle, and reports go/no-go numbers.
// ABOUTME: Run via `just spike-transition [--pairs N] [--seed S]`. Zero product-code changes; the pure
// ABOUTME: pieces are exported so web/test/transition-spike.test.ts can guard them in CI.
// ABOUTME: Spec: docs/superpowers/specs/2026-07-18-transition-order-spike-design.md
import {
  peakToReach,
  buildOrderPath,
  type ReachCon,
  type Vec,
  type BuildStep,
} from "../src/core/reachability";
import { model, cons, table, generateValidBuild, isValidBuild, mulberry32 } from "./reachability-fuzz";

const zero = (): Vec => [0, 0, 0, 0, 0];
const covers = (g: Vec, d: Vec): boolean =>
  g[0] >= d[0] && g[1] >= d[1] && g[2] >= d[2] && g[3] >= d[3] && g[4] >= d[4];
const add = (g: Vec, x: Vec): Vec => [g[0] + x[0], g[1] + x[1], g[2] + x[2], g[3] + x[3], g[4] + x[4]];
const maxV = (a: Vec, b: Vec): Vec => [
  Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3]), Math.max(a[4], b[4]),
];

export interface TransStep {
  kind: "add" | "refund";
  conId: string;
  from: number;
  to: number;
  heldAfter: number;
}

/**
 * Independent legality oracle. Replays `steps` from `base`, recomputing validity from scratch at each
 * step: standing grants come only from COMPLETE constellations, standing requirements from every
 * STARTED constellation, and coverage must hold at the conservative mid-step point (a step's
 * requirement appears at its first star, its grant only at completion; a refund loses the grant at its
 * first refunded star while the requirement stands until zero). Cap rule: an ADD step must land at or
 * under `cap`, and the final state must fit `cap`; refund steps may pass through over-cap totals, which
 * is how a baseline larger than the live cap legally tears down (the spec's refund-before-add case).
 * The final state must equal `cur` exactly.
 * Returns null when legal, else a human-readable description of the first violation.
 */
export function verifyTransition(base: ReachCon[], cur: ReachCon[], steps: TransStep[], cap: number): string | null {
  const sizeOf = new Map(cons.map((c) => [c.id, c.size]));
  const conOf = new Map(cons.map((c) => [c.id, c]));
  const counts = new Map<string, number>(base.map((b) => [b.id, b.size]));
  const total = () => [...counts.values()].reduce((a, b) => a + b, 0);
  // Validity of a standing state, with an optional conservative override: `pending` is a con whose
  // requirement must be counted as standing but whose grant must NOT be counted (the mid-step point).
  const check = (label: string, pending: string | null): string | null => {
    let grant = zero();
    let req = zero();
    for (const [id, n] of counts) {
      if (n <= 0) continue;
      const c = conOf.get(id)!;
      req = maxV(req, c.req);
      if (n >= c.size && id !== pending) grant = add(grant, c.grant);
    }
    if (pending) req = maxV(req, conOf.get(pending)!.req);
    return covers(grant, req) ? null : `${label}: requirement uncovered`;
  };
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    const size = sizeOf.get(s.conId);
    if (size === undefined) return `step ${i}: unknown constellation ${s.conId}`;
    const cur0 = counts.get(s.conId) ?? 0;
    if (cur0 !== s.from) return `step ${i} (${s.conId}): from=${s.from} but standing count is ${cur0}`;
    if (s.to < 0 || s.to > size) return `step ${i} (${s.conId}): to=${s.to} out of range`;
    if (s.kind === "add" && s.to <= s.from) return `step ${i} (${s.conId}): add must increase count`;
    if (s.kind === "refund" && s.to >= s.from) return `step ${i} (${s.conId}): refund must decrease count`;
    // Conservative mid-step: requirement standing, grant absent (add completing / refund starting).
    counts.set(s.conId, s.to);
    const mid = check(`step ${i} (${s.conId}) mid`, s.conId);
    if (mid) return mid;
    const end = check(`step ${i} (${s.conId}) end`, null);
    if (end) return end;
    const t = total();
    if (s.kind === "add" && t > cap) return `step ${i} (${s.conId}): cap exceeded (${t} > ${cap})`;
    if (t !== s.heldAfter) return `step ${i} (${s.conId}): heldAfter=${s.heldAfter} but total is ${t}`;
    if (s.to === 0) counts.delete(s.conId);
  }
  if (total() > cap) return `end state over cap (${total()} > ${cap})`;
  const want = new Map(cur.map((c) => [c.id, c.size]));
  if (want.size !== counts.size) return `end state mismatch: ${counts.size} standing, ${want.size} wanted`;
  for (const [id, n] of want) if (counts.get(id) !== n) return `end state mismatch at ${id}`;
  return null;
}
```

The mid-step `pending` exclusion is conservative for a completing add (grant not yet earned at the worst point) and for a starting refund (grant already lost while the points and requirement still stand). It never under-checks; it can only reject orders a finer-grained model would allow, which is the safe direction for this spike.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && bun test transition-spike`
Expected: PASS (4 tests). If "stranding" fails because the chosen dependent constellation's requirement is coverable by other means in the 2-con state, pick a dependent whose requirement genuinely exceeds the remaining grants (print `cons.filter(c => c.req.some(x => x > 0)).slice(0, 5)` to choose).

- [ ] **Step 5: Commit**

```bash
git add web/scripts/transition-spike.ts web/test/transition-spike.test.ts
git commit -F - <<'EOF'
feat(spike): transition legality oracle and script skeleton
EOF
```

---

### Task 2: Corpus generation (build pairs)

**Files:**
- Modify: `web/scripts/transition-spike.ts` (append)
- Modify: `web/test/transition-spike.test.ts` (append)

**Interfaces:**
- Consumes: `generateValidBuild`, `isValidBuild`, `mulberry32`, `cons` from the fuzz script.
- Produces: `mutatePair(rng: () => number, budget?: number): { base: ReachCon[]; cur: ReachCon[] } | null` (small-delta pair, null when a valid mutation was not found in bounded retries) and `randomPair(rng: () => number): { base: ReachCon[]; cur: ReachCon[] }`. Task 4 relies on these names.

- [ ] **Step 1: Write the failing tests**

Append to `web/test/transition-spike.test.ts`:

```ts
import { mutatePair, randomPair } from "../scripts/transition-spike";
import { isValidBuild } from "../scripts/reachability-fuzz"; // mulberry32 is already imported in Task 1's header

test("mutatePair produces two distinct valid builds sharing most members", () => {
  const rng = mulberry32(42);
  let found = 0;
  for (let i = 0; i < 20 && found < 5; i++) {
    const pair = mutatePair(rng);
    if (!pair) continue;
    found++;
    expect(isValidBuild(pair.base)).toBeTrue();
    expect(isValidBuild(pair.cur)).toBeTrue();
    const baseIds = new Set(pair.base.map((c) => c.id));
    const curIds = new Set(pair.cur.map((c) => c.id));
    expect([...baseIds].some((id) => !curIds.has(id)) || [...curIds].some((id) => !baseIds.has(id))).toBeTrue();
    const shared = [...baseIds].filter((id) => curIds.has(id)).length;
    expect(shared).toBeGreaterThan(0); // small delta, not a full respec
  }
  expect(found).toBeGreaterThan(0);
});

test("mutatePair is deterministic per seed", () => {
  const a = mutatePair(mulberry32(7));
  const b = mutatePair(mulberry32(7));
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && bun test transition-spike`
Expected: FAIL — `mutatePair` is not exported.

- [ ] **Step 3: Implement corpus generation**

Append to `web/scripts/transition-spike.ts`:

```ts
const BUDGET = 55;
const SEED_AFF: Vec = [1, 1, 1, 1, 1]; // the refundable crossroads seed, as in the fuzzer

/** Grow `B` with legal picks (the fuzzer's forward rule) until no candidate fits `budget`. */
function grow(B: ReachCon[], rng: () => number, budget: number): ReachCon[] {
  const inB = new Set(B.map((c) => c.id));
  let grants = zero();
  let stars = 0;
  for (const c of B) {
    grants = add(grants, c.grant);
    stars += c.size;
  }
  for (let guard = 0; guard < 300; guard++) {
    const reach = add(SEED_AFF, grants);
    const cand = cons.filter(
      (c) => !inB.has(c.id) && stars + c.size <= budget && covers(reach, c.req) && covers(add(grants, c.grant), c.req),
    );
    if (!cand.length) break;
    const c = cand[Math.floor(rng() * cand.length)]!;
    B = [...B, c];
    inB.add(c.id);
    grants = add(grants, c.grant);
    stars += c.size;
  }
  return B;
}

/**
 * A small-delta pair: a generated valid build, and a copy with 1-3 members removed and different
 * members grown in their place, both valid. Null when no valid mutation lands in bounded retries.
 */
export function mutatePair(rng: () => number, budget = BUDGET): { base: ReachCon[]; cur: ReachCon[] } | null {
  const base = generateValidBuild(rng);
  if (base.length < 4 || !isValidBuild(base)) return null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const k = 1 + Math.floor(rng() * 3);
    const keep = [...base];
    for (let i = 0; i < k && keep.length > 2; i++) keep.splice(Math.floor(rng() * keep.length), 1);
    if (!isValidBuild(keep)) continue; // removing these strands a dependent; try another removal
    const cur = grow(keep, rng, budget);
    const baseIds = new Set(base.map((c) => c.id));
    const changed = cur.length !== base.length || cur.some((c) => !baseIds.has(c.id));
    if (changed && isValidBuild(cur)) return { base, cur };
  }
  return null;
}

/** Two independently generated valid builds (the stress corpus). */
export function randomPair(rng: () => number): { base: ReachCon[]; cur: ReachCon[] } {
  return { base: generateValidBuild(rng), cur: generateValidBuild(rng) };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd web && bun test transition-spike`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/scripts/transition-spike.ts web/test/transition-spike.test.ts
git commit -F - <<'EOF'
feat(spike): valid build-pair corpus generation
EOF
```

---

### Task 3: The prototype — seeded replay, two-pass refunds, escalation ladder

**Files:**
- Modify: `web/scripts/transition-spike.ts` (append)
- Modify: `web/test/transition-spike.test.ts` (append)

**Interfaces:**
- Consumes: `verifyTransition`, `TransStep`, `mutatePair` from Tasks 1-2; `peakToReach`, `buildOrderPath` from the engine.
- Produces: `transitionOrderPath(base: ReachCon[], cur: ReachCon[], cap: number, tries?: number): { steps: TransStep[]; rung: "incremental" | "teardown-1" | "full-respec" } | null`, and `teardownRebuild(base: ReachCon[], cur: ReachCon[], cap: number): TransStep[] | null`. Task 4 relies on these names and the rung labels.

**The oracle is ground truth for this task.** The code below is the intended shape; if the oracle rejects an order it produces, the bug is in this replay, and the fix loop is: reproduce with the failing pair (print base/cur ids and the seed), shrink, fix, re-run. Zero oracle failures is the exit criterion, not "the code below compiled".

- [ ] **Step 1: Write the failing tests**

Append to `web/test/transition-spike.test.ts`:

```ts
import { transitionOrderPath, teardownRebuild, verifyTransition as verify } from "../scripts/transition-spike";

test("every produced transition on 30 small-delta pairs is oracle-clean", () => {
  const rng = mulberry32(1234);
  let produced = 0;
  for (let i = 0; i < 60 && produced < 30; i++) {
    const pair = mutatePair(rng);
    if (!pair) continue;
    const res = transitionOrderPath(pair.base, pair.cur, 55);
    if (!res) continue;
    produced++;
    expect(verify(pair.base, pair.cur, res.steps, 55)).toBeNull();
  }
  expect(produced).toBeGreaterThan(20); // the ladder should resolve the large majority
});

test("teardownRebuild is oracle-clean whenever it exists", () => {
  const rng = mulberry32(99);
  const pair = mutatePair(rng);
  if (!pair) return; // corpus miss at this seed is not this test's subject
  const steps = teardownRebuild(pair.base, pair.cur, 55);
  if (steps) expect(verify(pair.base, pair.cur, steps, 55)).toBeNull();
});

test("identical builds transition in zero steps", () => {
  const rng = mulberry32(5);
  const b = generateValidBuild(rng);
  const res = transitionOrderPath(b, b, 55);
  expect(res).not.toBeNull();
  expect(res!.steps.length).toBe(0);
});
```

Also add the real-world fixture from the compare URLs (the Eel case). Decode both selections and assert the free refund:

```ts
import { canonicalStarIds, decodeHash } from "../src/core/urlState";
import { selectionSummary } from "../src/core/reachability";
import { model } from "../scripts/reachability-fuzz";

test("the Eel pair: baseline-only Eel refunds at step zero (free refund)", () => {
  const canonical = canonicalStarIds(model);
  const CUR = "p=55&s=AAAAgAAHAAAAAAAAAAAAPADAwQf44AEAAIA_AAD8AAAAAAAAAAAAAPAD4AMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfg";
  const BASE = "p=55&s=AAAAAAAAAADABgAAAAAAPADAwQcA4AEAAIA_AAD8AAAAAAAAAPABAPAD4AMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfg";
  const cur = selectionSummary(model, decodeHash(CUR, canonical)!.selected).built;
  const base = selectionSummary(model, decodeHash(BASE, canonical)!.selected).built;
  const res = transitionOrderPath(base, cur, 55);
  expect(res).not.toBeNull();
  expect(verify(base, cur, res!.steps, 55)).toBeNull();
  const eelId = [...model.constellations.keys()].find((id) => id.includes("eel"))!;
  const eelStep = res!.steps.findIndex((s) => s.conId === eelId && s.kind === "refund");
  const firstAdd = res!.steps.findIndex((s) => s.kind === "add");
  expect(eelStep).toBeGreaterThanOrEqual(0);
  if (firstAdd >= 0) expect(eelStep).toBeLessThan(firstAdd); // free refund happens up front
});
```

Note: those are the `s=` payloads of Ted's two example URLs (the second URL's `s=` and `cs=`). If Eel turns out to be needed mid-transition on this pair, the last assertion is wrong about the WORLD, not the code — verify by hand (Eel grants primordial; the pair's standing primordial need) and adjust the fixture's expectation with a comment, not the prototype.

- [ ] **Step 2: Run to verify failure**

Run: `cd web && bun test transition-spike`
Expected: FAIL — `transitionOrderPath` is not exported.

- [ ] **Step 3: Implement the prototype**

Append to `web/scripts/transition-spike.ts`. The shape:

```ts
interface Delta {
  sharedFull: ReachCon[]; // same id, complete in both (grant counts throughout)
  baseOnly: ReachCon[]; // in base, absent from cur: must be refunded, usable as pre-paid scaffolds meanwhile
  curOnly: ReachCon[]; // in cur, absent from base: must be added
  resize: { con: ReachCon; from: number; to: number }[]; // same id, different star count
}

function diffBuilds(base: ReachCon[], cur: ReachCon[]): Delta {
  const b = new Map(base.map((c) => [c.id, c]));
  const c2 = new Map(cur.map((c) => [c.id, c]));
  const full = (m: ReachCon) => m.size === cons.find((x) => x.id === m.id)!.size;
  const sharedFull: ReachCon[] = [];
  const baseOnly: ReachCon[] = [];
  const curOnly: ReachCon[] = [];
  const resize: Delta["resize"] = [];
  for (const [id, bc] of b) {
    const cc = c2.get(id);
    if (!cc) baseOnly.push(bc);
    else if (bc.size === cc.size) sharedFull.push(bc);
    else resize.push({ con: cons.find((x) => x.id === id)!, from: bc.size, to: cc.size });
  }
  for (const [id, cc] of c2) if (!b.has(id)) curOnly.push(cc);
  return { sharedFull, baseOnly, curOnly, resize };
}

/**
 * The seeded replay for one ladder rung. `kept` are shared members standing throughout (their grants
 * seed the supply); `held` are pre-paid scaffolds standing at step zero (baseline-only members plus any
 * shared members this rung tears down); `toPlace` are the members to add (current-only, plus torn-down
 * shared members re-added, plus grow-resizes; shrink-resizes are scheduled as refunds by the backward
 * pass). Forward pass: order `toPlace` (lowest requirement first, then grant density, plus seeded
 * shuffles when over cap — mirroring sampledConstruction), computing each step's need-set with
 * peakToReach where the pool is held-first (prefer-held bias) then all other non-members. Backward
 * pass: each held member refunds immediately after the last step whose need-set contains it (step zero
 * when never needed); each shrink-resize refunds after the last step needing its grant. If the schedule
 * exceeds cap at some step, retry with the eager schedule (refund held members the moment the need-set
 * drops them) before giving up — eager trades churn for budget headroom.
 * Returns oracle-shaped TransSteps or null when no sampled order fits.
 */
function seededReplay(delta: Delta, teardown: ReachCon[], cap: number, tries: number): TransStep[] | null {
  // ... (the implementer writes this; it is the spike's subject. Structure it as:
  //   1. compute seed grant/mreq from kept members and standing resize requirements
  //   2. forward pass over candidate orders of toPlace (deterministic heuristic + up to `tries` shuffles
  //      via the same LCG shape sampledConstruction uses, seeded from sizes for determinism)
  //   3. per step: deficit = mreq-so-far minus grant-so-far; need = peakToReach(pool, table, deficit,
  //      grantFromKept, 300000, { collect, preferSmall: true }) with pool ordered held-first
  //   4. backward pass converts need-set history into refund positions; emit TransSteps
  //   5. verify budget at every emitted step; fall back to eager schedule; else return null)
}

/** Reverse of the baseline's own from-scratch order, then the current build's from-scratch order. */
export function teardownRebuild(base: ReachCon[], cur: ReachCon[], cap: number): TransStep[] | null {
  const down = buildOrderPath(cons, table, base, cap, 64);
  const up = buildOrderPath(cons, table, cur, cap, 64);
  if (!down || !up) return null;
  const steps: TransStep[] = [];
  let held = base.reduce((a, c) => a + c.size, 0);
  for (const s of [...down].reverse()) {
    // Reversing a construction: complete/scaffold-add become refunds, scaffold-refund becomes an add.
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

/** The escalation ladder: pure incremental, then singleton shared teardowns, then full respec. */
export function transitionOrderPath(
  base: ReachCon[],
  cur: ReachCon[],
  cap: number,
  tries = 16,
): { steps: TransStep[]; rung: "incremental" | "teardown-1" | "full-respec" } | null {
  const delta = diffBuilds(base, cur);
  if (!delta.baseOnly.length && !delta.curOnly.length && !delta.resize.length) return { steps: [], rung: "incremental" };
  const clean = (steps: TransStep[] | null) => steps && verifyTransition(base, cur, steps, cap) === null;
  const s0 = seededReplay(delta, [], cap, tries);
  if (clean(s0)) return { steps: s0!, rung: "incremental" };
  // Singleton teardown candidates: shared members by how much they relax the binding deficit
  // (highest dominating requirement first, then most points freed).
  const cands = [...delta.sharedFull].sort(
    (a, b) => b.req.reduce((x, y) => x + y, 0) - a.req.reduce((x, y) => x + y, 0) || b.size - a.size,
  ).slice(0, 8);
  for (const t of cands) {
    const s1 = seededReplay(delta, [t], cap, tries);
    if (clean(s1)) return { steps: s1!, rung: "teardown-1" };
  }
  const s2 = teardownRebuild(base, cur, cap);
  if (clean(s2)) return { steps: s2!, rung: "full-respec" };
  return null;
}
```

The `seededReplay` body is deliberately specified as structure-plus-contract rather than verbatim code: it is the algorithm under investigation, and its correctness authority is `verifyTransition`, not this plan. Everything around it (diff, ladder, teardown, oracle, tests) is fixed. Implementation guidance beyond the comment block: mirror `buildOrderPath`'s replay loop (web/src/core/reachability.ts:697-757) — it is 60 lines and the seeded variant changes its initialization and refund scheduling, not its skeleton. Scaffold need-sets must include only constellations NOT in the current build (pool excludes cur members, like `buildParts`'s pool), plus the held baseline members.

- [ ] **Step 4: Run the tests; iterate until oracle-clean**

Run: `cd web && bun test transition-spike`
Expected: PASS, in particular zero `verify(...)` non-null results. Iterate on `seededReplay` until this holds; do not weaken a test to get there. If the Eel fixture's step-zero assertion fails per its note, adjust only that assertion with a comment explaining the standing need.

- [ ] **Step 5: Run the full gate**

Run: `just check`
Expected: clean (the spike files are covered by lint/typecheck/format like all of `web/`).

- [ ] **Step 6: Commit**

```bash
git add web/scripts/transition-spike.ts web/test/transition-spike.test.ts
git commit -F - <<'EOF'
feat(spike): transition prototype - seeded replay, two-pass refunds, escalation ladder
EOF
```

---

### Task 4: Metrics, report, recipe — run the spike and record findings

**Files:**
- Modify: `web/scripts/transition-spike.ts` (append the report `main`)
- Modify: `justfile` (one recipe, next to `fuzz`)
- Modify: `docs/superpowers/specs/2026-07-18-transition-order-spike-design.md` (append Findings)

**Interfaces:**
- Consumes: everything above.
- Produces: the spike's numbers and the Findings section; no code consumers.

- [ ] **Step 1: Add the justfile recipe**

After the `fuzz` recipe in `justfile`:

```make
# Transition-order spike: prototype baseline-to-current build orders over generated pairs and report
# go/no-go numbers (spec: docs/superpowers/specs/2026-07-18-transition-order-spike-design.md).
spike-transition *ARGS:
    cd "{{justfile_directory()}}/web" && bun scripts/transition-spike.ts {{ARGS}}
```

- [ ] **Step 2: Implement the report main**

Append to `web/scripts/transition-spike.ts`:

```ts
interface PairResult {
  corpus: "small-delta" | "random" | "near-cap" | "tight-cap";
  rung: string | "none";
  oracleError: string | null;
  moved: number;
  movedTeardown: number | null;
  theoreticalMin: number;
  churnReaddCons: number; // constellations refunded then later re-added in the same order
  churnCoveredAdds: number; // scaffold adds whose affinity an earlier-refunded baseline member supplied
  usNanos: number;
  usNanosFromScratch: number;
}

function measure(corpus: PairResult["corpus"], base: ReachCon[], cur: ReachCon[], cap: number): PairResult {
  const t0 = Bun.nanoseconds();
  const res = transitionOrderPath(base, cur, cap);
  const t1 = Bun.nanoseconds();
  buildOrderPath(cons, table, cur, cap, 16); // the live from-scratch cost on the same input
  const t2 = Bun.nanoseconds();
  const moved = res ? res.steps.reduce((a, s) => a + Math.abs(s.to - s.from), 0) : 0;
  const td = teardownRebuild(base, cur, cap);
  const movedTeardown = td ? td.reduce((a, s) => a + Math.abs(s.to - s.from), 0) : null;
  const bc = new Map(base.map((c) => [c.id, c.size]));
  const cc = new Map(cur.map((c) => [c.id, c.size]));
  let theoreticalMin = 0;
  for (const [id, n] of bc) theoreticalMin += Math.abs(n - (cc.get(id) ?? 0));
  for (const [id, n] of cc) if (!bc.has(id)) theoreticalMin += n;
  let churnReaddCons = 0;
  let churnCoveredAdds = 0;
  if (res) {
    const refunded = new Map<string, number>(); // conId -> step index of full refund
    const baseIds = new Set(base.map((c) => c.id));
    res.steps.forEach((s, i) => {
      if (s.kind === "refund" && s.to === 0) refunded.set(s.conId, i);
      if (s.kind === "add" && refunded.has(s.conId) && refunded.get(s.conId)! < i) churnReaddCons++;
      if (s.kind === "add" && !cc.has(s.conId)) {
        // a scaffold add; covered if some earlier-refunded baseline member grants at least as much
        const scaffold = cons.find((c) => c.id === s.conId)!;
        for (const [rid, ri] of refunded) {
          if (ri >= i || !baseIds.has(rid) || cc.has(rid)) continue;
          const rcon = cons.find((c) => c.id === rid)!;
          if (covers(rcon.grant, scaffold.grant)) { churnCoveredAdds++; break; }
        }
      }
    });
  }
  return {
    corpus, rung: res?.rung ?? "none",
    oracleError: res ? verifyTransition(base, cur, res.steps, cap) : null,
    moved, movedTeardown, theoreticalMin, churnReaddCons, churnCoveredAdds,
    usNanos: t1 - t0, usNanosFromScratch: t2 - t1,
  };
}
```

Then the CLI main (arg parsing mirrors the fuzzer's style):

```ts
if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const flag = (name: string, dflt: number) => {
    const i = args.indexOf(name);
    return i >= 0 ? Number(args[i + 1]) : dflt;
  };
  const nPairs = flag("--pairs", 200);
  const seed = flag("--seed", 1);
  const rng = mulberry32(seed);
  const results: PairResult[] = [];
  while (results.filter((r) => r.corpus === "small-delta").length < nPairs) {
    const p = mutatePair(rng);
    if (p) results.push(measure("small-delta", p.base, p.cur, BUDGET));
  }
  for (let i = 0; i < Math.floor(nPairs / 4); i++) {
    const p = randomPair(rng);
    results.push(measure("random", p.base, p.cur, BUDGET));
  }
  // Near-cap: small-delta pairs where both sides are 53+ stars (bounded search; the generator fills
  // toward 55 so hits are common, but log a shortfall instead of spinning). Tight-cap: cap equals the
  // SMALLER build's size, so when the baseline is the larger build the transition starts over cap and
  // must refund before it can add.
  const sz = (b: ReachCon[]) => b.reduce((a, c) => a + c.size, 0);
  const wantQuarter = Math.floor(nPairs / 4);
  for (let tries = 0; tries < 5000 && results.filter((r) => r.corpus === "near-cap").length < wantQuarter; tries++) {
    const p = mutatePair(rng);
    if (p && sz(p.base) >= 53 && sz(p.cur) >= 53) results.push(measure("near-cap", p.base, p.cur, BUDGET));
  }
  const nearCapCount = results.filter((r) => r.corpus === "near-cap").length;
  if (nearCapCount < wantQuarter) console.log(`near-cap corpus short: ${nearCapCount}/${wantQuarter}`);
  for (let got = 0; got < wantQuarter; ) {
    const p = mutatePair(rng);
    if (!p) continue;
    got++;
    results.push(measure("tight-cap", p.base, p.cur, Math.min(sz(p.base), sz(p.cur))));
  }
  report(results);
}
```

`report(results)` prints, per corpus: pair count; rung distribution with percentages; oracle failure count (MUST be zero — print in red and exit 1 otherwise); percent of pairs whose produced order strictly beats teardown+rebuild on moved points (only where `movedTeardown` exists); moved-points ratio to theoretical minimum (median, p95); churn counts by both forms (pairs affected, total events); runtime p50/p95 for the transition and for the from-scratch order side by side; then ten sample small-delta orders printed as numbered step lists (`+3 eel (held 42)` style) for eyeballing. Keep it plain `console.log`, no dependencies.

- [ ] **Step 3: Smoke-run the report**

Run: `just spike-transition --pairs 20 --seed 1`
Expected: a report with zero oracle failures, plausible rung distribution, non-empty samples, and total runtime under a minute. Fix anything that looks wrong before scaling up.

- [ ] **Step 4: Full run**

Run: `just spike-transition --pairs 500 --seed 1` (expect minutes, not hours; if it runs long, note the per-pair cost in the findings rather than shrinking silently)
Then a second seed as a stability check: `just spike-transition --pairs 500 --seed 2`

- [ ] **Step 5: Record findings in the spec**

Append a `## Findings (2026-07-18)` section to `docs/superpowers/specs/2026-07-18-transition-order-spike-design.md` with: the exact commands run, the per-corpus tables from both seeds, the churn numbers, three of the sample orders (one clean incremental, one teardown-1, one full-respec, verbatim), runtime comparison against the live from-scratch cost, an explicit verdict against each line of the spec's go/no-go bar, and a one-paragraph recommendation. Do not editorialize beyond the numbers; the go/no-go call is made with Ted from this section.

- [ ] **Step 6: Run the full gate and commit**

Run: `just check`
Expected: clean.

```bash
git add web/scripts/transition-spike.ts justfile docs/superpowers/specs/2026-07-18-transition-order-spike-design.md
git commit -F - <<'EOF'
feat(spike): transition-order report harness and recorded findings
EOF
```

---

## Final verification (after all tasks)

- `just check` clean; `just spike-transition --pairs 20 --seed 3` (a seed no test used) reports zero oracle failures.
- The Findings section answers every line of the spec's go/no-go bar with a number.
- `git diff main -- web/src` is empty (zero product-code changes).
