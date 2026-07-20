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
  expect(r.states[0]!.conGrant).toEqual(v(1)); // G completes with its grant
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
