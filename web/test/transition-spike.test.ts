// ABOUTME: CI guard for the transition-order spike's pure pieces: the legality oracle first
// ABOUTME: (ground truth for every emitted order), later the corpus generator and prototype.
import { test, expect } from "bun:test";
import { cons, generateValidBuild, mulberry32, isValidBuild, model } from "../scripts/reachability-fuzz";
import {
  verifyTransition,
  type TransStep,
  mutatePair,
  transitionOrderPath,
  teardownRebuild,
} from "../scripts/transition-spike";
import { selectionSummary, type ReachCon } from "../src/core/reachability";
import { canonicalStarIds, decodeHash } from "../src/core/urlState";
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

test("every produced transition on 30 small-delta pairs is oracle-clean; the majority resolve incrementally", () => {
  const rng = mulberry32(1234);
  let produced = 0;
  let incremental = 0;
  for (let i = 0; i < 60 && produced < 30; i++) {
    const pair = mutatePair(rng);
    if (!pair) continue;
    const res = transitionOrderPath(pair.base, pair.cur, 55);
    if (!res) continue;
    produced++;
    expect(verifyTransition(pair.base, pair.cur, res.steps, 55)).toBeNull();
    if (res.rung === "incremental") incremental++;
  }
  expect(produced).toBeGreaterThan(20); // the ladder should resolve the large majority
  // Guards the spike's central claim, not just legality: a regression that silently pushed every pair
  // to full-respec would still be oracle-clean and pass the assertion above. Conservative >50% bar so
  // it is not seed-brittle while still catching that regression shape.
  expect(incremental).toBeGreaterThan(produced / 2);
});

test("teardownRebuild is oracle-clean whenever it exists", () => {
  const rng = mulberry32(99);
  const pair = mutatePair(rng);
  if (!pair) return; // corpus miss at this seed is not this test's subject
  const steps = teardownRebuild(pair.base, pair.cur, 55);
  if (steps) expect(verifyTransition(pair.base, pair.cur, steps, 55)).toBeNull();
});

test("identical builds transition in zero steps", () => {
  const rng = mulberry32(5);
  const b = generateValidBuild(rng);
  const res = transitionOrderPath(b, b, 55);
  expect(res).not.toBeNull();
  expect(res!.steps.length).toBe(0);
});

test("the Eel pair: a real compare-URL transition is oracle-clean; a never-needed baseline-only member refunds up front", () => {
  const canonical = canonicalStarIds(model);
  const CUR = "p=55&s=AAAAgAAHAAAAAAAAAAAAPADAwQf44AEAAIA_AAD8AAAAAAAAAAAAAPAD4AMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfg";
  const BASE = "p=55&s=AAAAAAAAAADABgAAAAAAPADAwQcA4AEAAIA_AAD8AAAAAAAAAPABAPAD4AMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfg";
  const cur = selectionSummary(model, decodeHash(CUR, canonical)!.selected).built;
  const base = selectionSummary(model, decodeHash(BASE, canonical)!.selected).built;
  const res = transitionOrderPath(base, cur, 55);
  expect(res).not.toBeNull();
  expect(verifyTransition(base, cur, res!.steps, 55)).toBeNull();
  // This pair resolves at full-respec (teardownRebuild), not the incremental/teardown-1 rungs' two-pass
  // scheduler - a future replay improvement that makes this pair resolve incrementally should consciously
  // revisit the assertions below rather than let them silently drift.
  expect(res!.rung).toBe("full-respec");
  // Assertion adjusted per the brief's step-zero note, verified by decoding both URLs. In THIS pair's
  // direction (base -> cur) Eel is CURRENT-only: base holds no Eel, and cur ADDS Eel (3 stars, grants
  // +5 primordial) as a primordial source. So Eel is added, not a baseline-only free refund - the
  // step-zero refund of Eel does not apply here (Eel is "needed mid-transition", the case the note
  // anticipated). The free refund the panel still surfaces up front is a never-needed baseline-only
  // member: Ghoul appears only in base as a 4/5 partial that grants no affinity, so it can never be
  // load-bearing and must refund before any add. At full-respec, this up-front Ghoul refund comes from
  // teardownRebuild's reversal of the baseline's own from-scratch order (Ghoul, a zero-grant member, is
  // placed in the construction tail - last in the forward order, so first when reversed for teardown) -
  // not from the two-pass scheduler's never-needed-scaffold logic, which only runs on the
  // incremental/teardown-1 rungs.
  const eelId = [...model.constellations.keys()].find((id) => id.includes("eel"))!;
  const eelAdd = res!.steps.findIndex((s) => s.conId === eelId && s.kind === "add");
  expect(eelAdd).toBeGreaterThanOrEqual(0);
  const ghoulId = [...model.constellations.keys()].find((id) => id.includes("ghoul"))!;
  const ghoulRefund = res!.steps.findIndex((s) => s.conId === ghoulId && s.kind === "refund");
  const firstAdd = res!.steps.findIndex((s) => s.kind === "add");
  expect(ghoulRefund).toBeGreaterThanOrEqual(0);
  if (firstAdd >= 0) expect(ghoulRefund).toBeLessThan(firstAdd); // never-needed baseline member refunds up front
});
