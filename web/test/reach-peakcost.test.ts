// ABOUTME: Unit tests pinning the peak-aware construction-cost helpers (peakToReach, minPeakSampled) on
// ABOUTME: small hand-computed models where "peak points held" differs from "subset size" (the scaffold crux).
import { test, expect } from "bun:test";
import { buildCoverTable, peakToReach, minPeakSampled, INF, type ReachCon, type Vec } from "../src/core/reachability";
import { reachableSet, randModel, mulberry32 } from "./support/reach-oracle";

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
  // but the peak already hit 5. This is the case the SEED model gets wrong.
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
