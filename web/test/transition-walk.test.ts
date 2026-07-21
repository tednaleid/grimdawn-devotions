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
