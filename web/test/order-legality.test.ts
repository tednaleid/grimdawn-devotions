// ABOUTME: Unit tests for the build-order legality oracle (core/orderLegality): hand-built schedules
// ABOUTME: exercising every rule - stranding refunds, cap, heldAfter, end state, partial members.
import { test, expect } from "bun:test";
import { verifyBuildOrder, gateBuildOrder, replayBuildOrder } from "../src/core/orderLegality";
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

test("step states report the true affinity total, uncapped", () => {
  // Chaos requirements max out at 8 map-wide; three completed 4-chaos granters hold a true total of
  // 12. A have capped at 8 would hide the surplus from the popup (the affinity panel's bug shape).
  const granters = [con("a", 1, z(), v(0, 4)), con("b", 1, z(), v(0, 4)), con("c", 1, z(), v(0, 4))];
  const steps = [complete(granters[0]!, 1), complete(granters[1]!, 2), complete(granters[2]!, 3)];
  const r = replayBuildOrder(granters, granters, steps, 55);
  expect(r.error).toBeNull();
  expect(r.states[2]!.have).toEqual(v(0, 12));
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

test("replayBuildOrder exposes post-step states for a legal schedule", () => {
  const steps = [scaffold(G, 1), complete(M, 3), refund(G, 2)];
  const { error, states } = replayBuildOrder(CONS, [M], steps, 55);
  expect(error).toBeNull();
  expect(states.length).toBe(3);
  // after adding G: have = G's grant, nothing standing requires anything
  expect(states[0]!.have).toEqual(v(1));
  expect(states[0]!.need).toEqual(z());
  expect(states[0]!.conGrant).toEqual(v(1));
  // after completing M: have = G + M, need = M's requirement, demanded by m
  expect(states[1]!.have).toEqual(v(2));
  expect(states[1]!.need).toEqual(v(1));
  expect(states[1]!.needSource.get(0)).toEqual(["m"]);
  expect(states[1]!.conReq).toEqual(v(1));
  // after refunding G: have drops by exactly the refunded grant; m still demands and is still met
  expect(states[2]!.have).toEqual(v(1));
  expect(states[2]!.need).toEqual(v(1));
  expect(states[2]!.needSource.get(0)).toEqual(["m"]);
  expect(states[2]!.conGrant).toEqual(v(1));
});

test("on an illegal schedule, states hold only the steps that completed their checks", () => {
  const steps = [scaffold(G, 1), complete(N, 4), refund(G, 3)];
  const { error, states } = replayBuildOrder(CONS, [N], steps, 55);
  expect(error).toMatch(/mid-refund.*uncovered/);
  expect(states.length).toBe(2); // the failing refund contributes no state
});

test("verifyBuildOrder is the replay's verdict (wrapper equivalence)", () => {
  const legal = [scaffold(G, 1), complete(M, 3), refund(G, 2)];
  const illegal = [scaffold(G, 1), complete(N, 4), refund(G, 3)];
  expect(verifyBuildOrder(CONS, [M], legal, 55)).toBe(replayBuildOrder(CONS, [M], legal, 55).error);
  expect(verifyBuildOrder(CONS, [N], illegal, 55)).toBe(replayBuildOrder(CONS, [N], illegal, 55).error);
});

test("a synthetic partial member's state carries its zero grant", () => {
  const fullP = con("p", 5, v(1), v(0, 0, 3));
  const partialP = con("p", 2, v(1), z());
  const steps = [scaffold(G, 1), { kind: "complete", conId: "p", points: 2, heldAfter: 3 } as BuildStep];
  const { error, states } = replayBuildOrder([G, fullP], [G, partialP], steps, 55);
  expect(error).toBeNull();
  expect(states[1]!.conGrant).toEqual(z()); // judged at the partial's zero grant, not the full con's
  expect(states[1]!.have).toEqual(v(1)); // only G supplies
});

test("gateBuildOrder passes a legal order through with its states, nulls an illegal or absent one", () => {
  const legal = [scaffold(G, 1), complete(M, 3), refund(G, 2)];
  const illegal = [scaffold(G, 1), complete(N, 4), refund(G, 3)];
  const gated = gateBuildOrder(CONS, [M], legal, 55);
  expect(gated).not.toBeNull();
  expect(gated!.steps).toBe(legal);
  expect(gated!.states.length).toBe(legal.length);
  expect(gateBuildOrder(CONS, [N], illegal, 55)).toBeNull();
  expect(gateBuildOrder(CONS, [M], null, 55)).toBeNull();
});
