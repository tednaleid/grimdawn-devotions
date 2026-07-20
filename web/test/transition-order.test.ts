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
