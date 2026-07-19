// ABOUTME: Unit tests for the build-order legality oracle (core/orderLegality): hand-built schedules
// ABOUTME: exercising every rule - stranding refunds, cap, heldAfter, end state, partial members.
import { test, expect } from "bun:test";
import { verifyBuildOrder, gateBuildOrder } from "../src/core/orderLegality";
import type { BuildStep, ReachCon, Vec } from "../src/core/reachability";

const z = (): Vec => [0, 0, 0, 0, 0];
const v = (asc = 0, cha = 0, eld = 0, ord = 0, pri = 0): Vec => [asc, cha, eld, ord, pri];
const con = (id: string, size: number, req: Vec, grant: Vec): ReachCon => ({ id, size, req, grant });

const G = con("g", 1, z(), v(1)); // free granter: 1 Ascendant, no requirement
const M = con("m", 2, v(1), v(1)); // needs 1 Ascendant, grants 1 back on completion
const N = con("n", 3, v(1), z()); // needs 1 Ascendant, grants nothing
const CONS = [G, M, N];

const complete = (c: ReachCon, held: number): BuildStep => ({
  kind: "complete",
  conId: c.id,
  points: c.size,
  heldAfter: held,
});
const scaffold = (c: ReachCon, held: number): BuildStep => ({
  kind: "scaffold-add",
  conId: c.id,
  points: c.size,
  heldAfter: held,
});
const refund = (c: ReachCon, held: number): BuildStep => ({
  kind: "scaffold-refund",
  conId: c.id,
  points: -c.size,
  heldAfter: held,
});

test("a legal scaffold/complete/refund schedule passes", () => {
  // G bootstraps M; once M stands (self-sustaining), G refunds legally.
  const steps = [scaffold(G, 1), complete(M, 3), refund(G, 2)];
  expect(verifyBuildOrder(CONS, [M], steps, 55)).toBeNull();
});

test("a refund that strands a standing dependent is illegal", () => {
  // N grants nothing back: refunding G leaves N's requirement uncovered.
  const steps = [scaffold(G, 1), complete(N, 4), refund(G, 3)];
  expect(verifyBuildOrder(CONS, [N], steps, 55)).toMatch(/mid-refund.*uncovered/);
});

test("an add whose requirement is not yet covered is illegal", () => {
  const steps = [complete(N, 3)];
  expect(verifyBuildOrder(CONS, [N], steps, 55)).toMatch(/pre-add.*uncovered/);
});

test("an add that lands over the cap is illegal", () => {
  const steps = [complete(G, 1)];
  expect(verifyBuildOrder(CONS, [G], steps, 0)).toMatch(/cap exceeded/);
});

test("a wrong heldAfter is rejected", () => {
  const steps: BuildStep[] = [{ kind: "complete", conId: "g", points: 1, heldAfter: 5 }];
  expect(verifyBuildOrder(CONS, [G], steps, 55)).toMatch(/heldAfter/);
});

test("an end state that does not equal the target is rejected", () => {
  expect(verifyBuildOrder(CONS, [M], [complete(G, 1)], 55)).toMatch(/end state/);
});

test("refunding a constellation that is not standing is rejected", () => {
  expect(verifyBuildOrder(CONS, [G], [refund(G, -1)], 55)).toMatch(/not standing/);
});

test("an unknown constellation id is rejected", () => {
  const steps: BuildStep[] = [{ kind: "complete", conId: "nope", points: 1, heldAfter: 1 }];
  expect(verifyBuildOrder(CONS, [G], steps, 55)).toMatch(/unknown/);
});

test("target members override allCons lookups (the panel's synthetic partials)", () => {
  // The real "p" is a 5-star granter; the panel models a 2-star partial of it as size 2, zero grant.
  const fullP = con("p", 5, v(1), v(0, 0, 3));
  const partialP = con("p", 2, v(1), z());
  const steps = [scaffold(G, 1), { kind: "complete", conId: "p", points: 2, heldAfter: 3 } as BuildStep];
  // Judged at the partial's size (2 points) and with its zero grant; G must stay to cover p's req.
  expect(verifyBuildOrder([G, fullP], [G, partialP], steps, 55)).toBeNull();
});

test("gateBuildOrder passes a legal order through, nulls an illegal or absent one", () => {
  const legal = [scaffold(G, 1), complete(M, 3), refund(G, 2)];
  const illegal = [scaffold(G, 1), complete(N, 4), refund(G, 3)];
  expect(gateBuildOrder(CONS, [M], legal, 55)).toBe(legal);
  expect(gateBuildOrder(CONS, [N], illegal, 55)).toBeNull();
  expect(gateBuildOrder(CONS, [M], null, 55)).toBeNull();
});
