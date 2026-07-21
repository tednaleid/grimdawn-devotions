// ABOUTME: Tests for the transition-order engine (core/transitionOrder): the best-of-candidates
// ABOUTME: selection (walk, two-pass replay, full respec) is oracle-clean on every corpus, moves
// ABOUTME: pinned few points, is deterministic, and honors the identity and over-cap edges.
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

// Aggregate moved-points pins (the best-of-candidates selection net): total moved points across
// each sweep's produced pairs, 2% slack (ceil(measured * 1.02)). Baseline is the pre-walk two-rung
// ladder (incremental replay, else full respec) on the identical seeded pairs; measured is the
// current selection. Update these deliberately when the algorithm improves; a silent regression
// must fail here.
// small-delta: baseline=908, Task 4 (walk added) measured=712, Task 5 (reversed-walk candidate
// added) measured=520. resize: baseline=25 measured=25, unchanged through Task 5 (already at floor
// - the walk cannot beat the ladder where the ladder already achieved the theoretical minimum).
// swap: baseline=275 measured=157, unchanged through Task 5.
const SMALL_DELTA_MOVED_PIN = 531;
const RESIZE_MOVED_PIN = 26;
const SWAP_MOVED_PIN = 161;

test("30 small-delta pairs are oracle-clean; the majority resolve incrementally", () => {
  const rng = mulberry32(1234);
  let produced = 0;
  let incremental = 0;
  let totalMoved = 0;
  for (let i = 0; i < 60 && produced < 30; i++) {
    const pair = mutatePair(rng);
    if (!pair) continue;
    const res = transitionOrderPath(cons, table, pair.base, pair.cur, 55);
    if (!res) continue;
    produced++;
    clean(pair.base, pair.cur, res, 55);
    if (res.rung === "incremental") incremental++;
    totalMoved += res.steps.reduce((a, s) => a + Math.abs(s.to - s.from), 0);
  }
  expect(produced).toBeGreaterThan(20);
  expect(incremental).toBeGreaterThan(produced / 2); // guards the central claim, not just legality
  expect(totalMoved).toBeLessThanOrEqual(SMALL_DELTA_MOVED_PIN);
});

test("resize pairs (star-level partials) are oracle-clean", () => {
  const rng = mulberry32(77);
  let produced = 0;
  let totalMoved = 0;
  for (let i = 0; i < 60 && produced < 10; i++) {
    const pair = resizePair(rng);
    if (!pair) continue;
    const res = transitionOrderPath(cons, table, pair.base, pair.cur, 55);
    if (!res) continue;
    produced++;
    clean(pair.base, pair.cur, res, 55);
    totalMoved += res.steps.reduce((a, s) => a + Math.abs(s.to - s.from), 0);
  }
  expect(produced).toBeGreaterThan(5);
  expect(totalMoved).toBeLessThanOrEqual(RESIZE_MOVED_PIN);
});

test("load-bearing swap pairs are oracle-clean", () => {
  const rng = mulberry32(88);
  let produced = 0;
  let totalMoved = 0;
  for (let i = 0; i < 120 && produced < 5; i++) {
    const pair = swapPair(rng);
    if (!pair) continue;
    const res = transitionOrderPath(cons, table, pair.base, pair.cur, 55);
    if (!res) continue;
    produced++;
    clean(pair.base, pair.cur, res, 55);
    totalMoved += res.steps.reduce((a, s) => a + Math.abs(s.to - s.from), 0);
  }
  expect(produced).toBeGreaterThan(0);
  expect(totalMoved).toBeLessThanOrEqual(SWAP_MOVED_PIN);
});

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

test("the owner's pair swapped resolves incrementally via the reversed walk", () => {
  const [pair] = urlFixturePairs();
  const res = transitionOrderPath(cons, table, pair!.cur, pair!.base, 55);
  clean(pair!.cur, pair!.base, res, 55);
  expect(res!.rung).toBe("incremental");
  const moved = res!.steps.reduce((a, s) => a + Math.abs(s.to - s.from), 0);
  expect(moved).toBeLessThanOrEqual(32); // the forward walk's schedule reversed: same 32 moved
});

test("selection never returns more moved points than the full respec candidate", () => {
  const rng = mulberry32(31337);
  let compared = 0;
  for (let i = 0; i < 20; i++) {
    const pair = mutatePair(rng);
    if (!pair) continue;
    const res = transitionOrderPath(cons, table, pair.base, pair.cur, 55);
    const td = teardownRebuild(cons, table, pair.base, pair.cur, 55);
    if (!res || !td || verifyTransition(cons, pair.base, pair.cur, td, 55) !== null) continue;
    const moved = (s: typeof res.steps) => s.reduce((a, x) => a + Math.abs(x.to - x.from), 0);
    expect(moved(res.steps)).toBeLessThanOrEqual(moved(td));
    compared++;
  }
  expect(compared).toBeGreaterThan(0);
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
