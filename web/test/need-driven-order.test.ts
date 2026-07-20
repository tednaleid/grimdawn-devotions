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
