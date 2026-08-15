// ABOUTME: Unit tests pinning the peak-aware construction-cost helpers (peakToReach, minPeakSampled) on
// ABOUTME: small hand-computed models where "peak points held" differs from "subset size" (the scaffold crux).
import { test, expect } from "bun:test";
import {
  buildCoverTable,
  classifyForSelection,
  peakToReach,
  minPeakSampled,
  INF,
  type ReachCon,
  type Vec,
} from "../src/core/reachability";
import { reachableSet, extendableReachable, randModel, mulberry32, stateFromCounts } from "./support/reach-oracle";

const z = (): Vec => [0, 0, 0, 0, 0];
const v = (asc = 0, cha = 0, eld = 0, ord = 0, pri = 0): Vec => [asc, cha, eld, ord, pri];
const con = (id: string, size: number, req: Vec, grant: Vec): ReachCon => ({ id, size, req, grant });
// A crossroads of color i: one star, no requirement, +1 of that color.
const cx = (i: number, id = `x${i}`): ReachCon => {
  const g = z();
  g[i] = 1;
  return { id, size: 1, req: z(), grant: g };
};
// A zero-grant anchor whose only job is to size the cover grid to the deficit under test
// (the cover table caps each color at the model's max requirement, so the deficit must be representable).
const anchor = (req: Vec): ReachCon => con("anchor", 1, req, z());

function withTable(cons: ReachCon[]) {
  return { cons, table: buildCoverTable(cons) };
}

test("peakToReach: a deficit reachable by crossroads alone equals the crossroads held (no bootstrap)", () => {
  const { cons, table } = withTable([cx(0), cx(2), anchor(v(1, 0, 1))]);
  // asc 1 + eld 1: place both crossroads (req 0), hold 2 points. No transient bump.
  expect(peakToReach(cons, table, v(1, 0, 1))).toBe(2);
});

test("peakToReach: eldritch 3 via Quill peaks at 5, not Quill's 4 stars", () => {
  // Quill needs eld 1 to start and grants asc 3 + eld 3. Reaching eld 3 means holding the eldritch
  // crossroads (1) while placing Quill (4) = peak 5; Quill then self-sustains so the crossroads refunds,
  // but the peak already hit 5. A flat one-point-per-color seed model would miss the held crossroads.
  const quill = con("quill", 4, v(0, 0, 1), v(3, 0, 3));
  const { cons, table } = withTable([cx(2), quill, anchor(v(3, 0, 3))]);
  expect(peakToReach(cons, table, v(0, 0, 3))).toBe(5);
});

test("peakToReach: ascendant 4 via Empty Throne peaks at 5 (net-positive plus its bootstrap crossroads)", () => {
  const emptyThrone = con("empty_throne", 4, v(1), v(5));
  const { cons, table } = withTable([cx(0), emptyThrone, anchor(v(4))]);
  expect(peakToReach(cons, table, v(4))).toBe(5);
});

test("peakToReach: one scaffold covering two colors is not double-bootstrapped", () => {
  // Quill grants asc 3 AND eld 3 at once; reaching both still peaks at 5 (one eldritch crossroads + Quill),
  // not 5-per-color. Guards against summing per-color bootstraps.
  const quill = con("quill", 4, v(0, 0, 1), v(3, 0, 3));
  const { cons, table } = withTable([cx(2), quill, anchor(v(3, 0, 3))]);
  expect(peakToReach(cons, table, v(3, 0, 3))).toBe(5);
});

test("peakToReach: an uncoverable deficit is INF", () => {
  // Only a single chaos crossroads (+1) exists; chaos 8 is unreachable.
  const { cons, table } = withTable([cx(1), anchor(v(0, 8))]);
  expect(peakToReach(cons, table, v(0, 8))).toBeGreaterThanOrEqual(INF);
});

test("peakToReach: a zero deficit costs nothing", () => {
  const { cons, table } = withTable([cx(0), anchor(v(1))]);
  expect(peakToReach(cons, table, z())).toBe(0);
});

test("minPeakSampled: a member that only meets its requirement with its own grant is not placed last", () => {
  // Build: the ascendant crossroads (+1), a tier-1 granter (needs asc 1, +5), a "self-dependent" member
  // that needs asc 8 but the others supply only 6 (so it needs a 2-asc scaffold whenever it is placed),
  // and a zero-grant-in-asc member needing asc 6. The bootstrap heuristic (lowest requirement first)
  // places the asc-8 member LAST, at the build's full 15 points plus the 3-star scaffold = peak 18.
  // Placing it third (11 + 3 = 14) and the asc-6 member last (covered by 1 + 5 + 3 = 9) peaks at the
  // build size, 15. The deterministic candidates alone (tries = 0) must find that order.
  const tier1 = con("tier1", 4, v(1), v(5));
  const selfDep = con("self_dep", 6, v(8), v(3));
  const late = con("late", 4, v(6), v(0, 1));
  const scaffold = con("scaffold", 3, z(), v(2));
  const { cons, table } = withTable([cx(0), tier1, selfDep, late, scaffold]);
  const B = [cx(0), tier1, selfDep, late];
  expect(minPeakSampled(cons, table, B, 15, 0)).toBe(15);
});

test("minPeakSampled: crossroads members whose colors nobody needs are not placed before the scaffold step", () => {
  // Build: a +2 chaos / +3 asc granter (2 stars), a +2 eld granter (1), a member needing chaos 3 and eld 4
  // (1 star, +2 eld), and two crossroads members of colors no requirement uses. Budget 10, build size 6.
  // The needy member's activation needs eld 2 more than the build supplies before it, so a 5-point
  // scaffold (the eld crossroads plus a 4-star +1 eld tier-1) is held at its step. Placing the two idle
  // crossroads first (zero requirement first) puts that step at size 6: peak 11. Peeling them to the end
  // puts it at size 4: peak 9. The deterministic candidates alone (tries = 0) must find 9.
  const granter = con("granter", 2, z(), v(2, 3));
  const eld2 = con("eld2", 1, z(), v(0, 0, 2));
  const needy = con("needy", 1, v(0, 3, 4), v(0, 0, 2));
  const tier1 = con("tier1", 4, v(1), v(0, 0, 1));
  const idleA = cx(3, "idle_a");
  const idleB = cx(4, "idle_b");
  const { cons, table } = withTable([granter, eld2, needy, tier1, idleA, idleB, cx(0), cx(1), cx(2)]);
  const B = [needy, idleA, idleB, granter, eld2];
  expect(minPeakSampled(cons, table, B, 10, 0)).toBe(9);
});

test("classifyForSelection: the crossroads seed is never counted twice", () => {
  // A one-star member that needs chaos 4 to activate, in a model whose OTHER chaos sources total 3
  // (a two-star +2 granter and the chaos crossroads). Its own +1 counts for sustain, not activation, so
  // it can never be started at any budget. Modeling a free transient +1 seed AND placing the same
  // crossroads as filler would count that crossroads twice and wrongly light it.
  const granter = con("granter", 2, z(), v(0, 2));
  const needy = con("needy", 1, v(0, 4), v(0, 1));
  const cons = [granter, needy, cx(0), cx(1), cx(2), cx(3), cx(4)];
  const table = buildCoverTable(cons);
  const counts = cons.map((c) => (c.id === "needy" ? 1 : 0));
  expect(extendableReachable(counts, reachableSet(cons, 12)!)).toBe(false); // the BFS oracle agrees
  expect(classifyForSelection(cons, table, stateFromCounts(counts, cons), 12)).toBe("dim");
});

// --- minPeakSampled is a SOUND witness vs the BFS oracle ---------------------------------------------
// minPeakSampled(B) samples real construction orders for a self-covering whole-constellation build B and
// returns the smallest peak found. It is SOUND: whenever minPeakSampled(B) <= budget it has an actual order
// that builds B within budget, so B (all members complete, nothing else) is genuinely a reachable state in
// the oracle - the engine never claims an unbuildable build reachable (no false-reach). The sampler can
// MISS a reachable build's only valid orders (overshoot -> conservative false-dim); that residual is the
// exact-min-peak tail, reported here, not gated to zero.
const CAP: Vec = [20, 8, 20, 10, 20];
const cap = (a: Vec, b: Vec): Vec => a.map((x, i) => Math.min(x + b[i]!, CAP[i]!)) as Vec;
const ge = (a: Vec, b: Vec) => a.every((x, i) => x >= b[i]!);

test("minPeakSampled never under-charges (sound witness) on small self-covering builds", () => {
  let falseReach = 0; // minPeakSampled says reachable, oracle says no (UNSOUND - must be 0)
  let falseDim = 0; // sampler overshoots a reachable build (the gap the exact engine closes)
  let checked = 0;
  for (let seed = 1; seed <= 600; seed++) {
    const rng = mulberry32(seed * 2 + 7);
    const { cons, budget } = randModel(rng);
    const R = reachableSet(cons, budget);
    if (!R) continue;
    const table = buildCoverTable(cons);
    for (let t = 0; t < 6; t++) {
      const idx = cons.map((_, i) => i).filter(() => rng() < 0.45);
      if (idx.length === 0) continue;
      const B = idx.map((i) => cons[i]!);
      let tot = z();
      let mreq = z();
      for (const m of B) {
        tot = cap(tot, m.grant);
        mreq = mreq.map((x, j) => Math.max(x, m.req[j]!)) as Vec;
      }
      if (!ge(tot, mreq)) continue; // the witness is defined for self-covering builds only
      checked++;
      const counts = cons.map((_, i) => (idx.includes(i) ? cons[i]!.size : 0));
      const oracleReach = R.has(counts.join(","));
      const engineReach = minPeakSampled(cons, table, B, budget) <= budget;
      if (engineReach && !oracleReach) falseReach++;
      if (!engineReach && oracleReach) falseDim++;
    }
  }
  // Soundness is the invariant the witness must hold; tightness (low false-dim) is a bonus the exact engine finishes.
  console.log(
    `minPeakSampled witness gap: ${falseDim}/${checked} reachable builds the sampler misses (exact-min-peak tail)`,
  );
  expect({ falseReach, checked: checked > 100 }).toEqual({ falseReach: 0, checked: true });
}, 30_000);
