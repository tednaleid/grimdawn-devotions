// ABOUTME: CI guard for the transition-order spike's pure pieces: the legality oracle first
// ABOUTME: (ground truth for every emitted order), later the corpus generator and prototype.
import { test, expect } from "bun:test";
import { cons, generateValidBuild, mulberry32, isValidBuild } from "../scripts/reachability-fuzz";
import { verifyTransition, type TransStep, mutatePair } from "../scripts/transition-spike";
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
  kind,
  conId: c.id,
  from,
  to,
  heldAfter,
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
