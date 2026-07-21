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

// Measured after the state-walk fix landed (fewest-moved-points selection over walk, replay, and
// full respec): the swapped direction still resolves only via full respec (walk and replay both
// return null for cur->base), so 130 is the exact moved count - unchanged from the pre-walk bound
// it replaces, not an improvement, but confirmed no worse.
const REVERSED_PIN = 130;

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
