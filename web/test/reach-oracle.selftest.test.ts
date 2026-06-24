// ABOUTME: Sanity tests for the BFS reachability oracle used as ground truth.
// ABOUTME: Hand-verified tiny cases plus the crossroads-only invariants.
import { test, expect } from "bun:test";
import { reachableSet, extendableReachable } from "./support/reach-oracle";
import type { ReachCon, Vec } from "../src/core/reachability";

const z = (): Vec => [0, 0, 0, 0, 0];
const cross = (i: number, id: string): ReachCon => {
  const g = z();
  g[i] = 1;
  return { id, size: 1, req: z(), grant: g };
};

test("empty selection is always reachable", () => {
  const cons: ReachCon[] = [cross(0, "x0")];
  const R = reachableSet(cons, 5)!;
  expect(extendableReachable([0], R)).toBe(true);
});

test("a constellation needing more of a color than any source can supply is unreachable", () => {
  // c0 needs ascendant 4 and grants ascendant 1; the only other ascendant is the +1 crossroads.
  const c0: ReachCon = { id: "c0", size: 1, req: [4, 0, 0, 0, 0], grant: [1, 0, 0, 0, 0] };
  const cons = [c0, cross(0, "x0")];
  const R = reachableSet(cons, 8)!;
  expect(extendableReachable([1, 0], R)).toBe(false); // c0 selected -> impossible
});

test("a net-positive scaffold unlocks a high-requirement neighbor", () => {
  // anvil: needs ascendant 1, grants 5. target: needs ascendant 4, grants 0.
  const anvil: ReachCon = { id: "anvil", size: 4, req: [1, 0, 0, 0, 0], grant: [5, 0, 0, 0, 0] };
  const target: ReachCon = { id: "t", size: 2, req: [4, 0, 0, 0, 0], grant: [0, 0, 0, 0, 0] };
  const cons = [anvil, target, cross(0, "x0")];
  const R = reachableSet(cons, 12)!;
  expect(extendableReachable([0, 2, 0], R)).toBe(true); // target complete is reachable via anvil
});
