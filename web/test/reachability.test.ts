// ABOUTME: Tests the crossroads-refund reachability engine: the cover lower bound is sound for
// ABOUTME: "dim", the greedy upper bound is sound for "reachable", and classify never lies, all
// ABOUTME: validated against a brute oracle using the same self-sustaining + crossroads-seed rule.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { buildReachCons, buildCoverTable, coverLowerBound, greedyMinCost, classify, reachabilitySweep, INF, type ReachCon, type Vec } from "../src/core/reachability";

const CAP: Vec = [20, 8, 20, 10, 20];
const SEED: Vec = [1, 1, 1, 1, 1];
const zero = (): Vec => [0, 0, 0, 0, 0];
const covers = (g: Vec, d: Vec) => g.every((x, i) => x >= d[i]!);
const addCap = (g: Vec, x: Vec): Vec => g.map((v, i) => Math.min(v + x[i]!, CAP[i]!)) as Vec;
const maxV = (a: Vec, b: Vec): Vec => a.map((v, i) => Math.max(v, b[i]!)) as Vec;

// A build is valid iff its total affinity covers every member's requirement (so the crossroads
// seed is refundable) AND it is constructible starting from the crossroads seed.
function isValidBuild(B: ReachCon[]): boolean {
  const total = B.reduce((t, c) => addCap(t, c.grant), zero());
  const maxreq = B.reduce((r, c) => maxV(r, c.req), zero());
  if (!covers(total, maxreq)) return false;
  let gain = SEED.slice() as Vec; const done = B.map(() => false); let placed = 0, changed = true;
  while (changed) { changed = false; for (let i = 0; i < B.length; i++) { if (done[i]) continue; if (covers(gain, B[i]!.req)) { done[i] = true; placed++; gain = addCap(gain, B[i]!.grant); changed = true; } } }
  return placed === B.length;
}
// Exhaustive min-cost valid build over filler subsets (small models only).
function bruteRefund(claimed: ReachCon[], pool: ReachCon[], budget: number): number {
  let best = INF; const baseOwn = claimed.reduce((s, c) => s + c.size, 0);
  for (let mask = 0; mask < 1 << pool.length; mask++) {
    const B = claimed.slice(); let own = baseOwn;
    for (let i = 0; i < pool.length; i++) if (mask & (1 << i)) { B.push(pool[i]!); own += pool[i]!.size; }
    if (own >= best || own > budget) continue;
    if (isValidBuild(B)) best = Math.min(best, own);
  }
  return best;
}

function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function randModel(rng: () => number, n: number): ReachCon[] {
  const cons: ReachCon[] = [];
  for (let i = 0; i < 5; i++) { const g = zero(); g[i] = 1; cons.push({ id: `x${i}`, size: 1, req: zero(), grant: g }); } // crossroads
  for (let i = 0; i < n; i++) { const req = zero(), grant = zero(); req[Math.floor(rng() * 5)] = Math.floor(rng() * 4); grant[Math.floor(rng() * 5)] = 1 + Math.floor(rng() * 4); cons.push({ id: `c${i}`, size: 1 + Math.floor(rng() * 4), req, grant }); }
  return cons;
}
function randCase(seed: number) {
  const rng = mulberry32(seed);
  const model = randModel(rng, 6 + Math.floor(rng() * 4));
  const ids = model.map((c) => c.id);
  const pick: string[] = [];
  for (let i = 0, nb = 1 + Math.floor(rng() * 2); i < nb; i++) { const id = ids[Math.floor(rng() * ids.length)]!; if (!pick.includes(id)) pick.push(id); }
  return { model, pick, budget: 8 + Math.floor(rng() * 10) };
}

test("cover lower bound never exceeds the true min-cost (sound lower bound)", () => {
  let bad = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const { model, pick, budget } = randCase(seed);
    const cover = buildCoverTable(model);
    const claimed = pick.map((id) => model.find((c) => c.id === id)!);
    const pool = model.filter((c) => !pick.includes(c.id) && c.grant.some((x) => x > 0));
    if (coverLowerBound(cover, claimed) > bruteRefund(claimed, pool, budget)) bad++;
  }
  expect(bad).toBe(0);
});

test("greedy never undercuts the true min-cost (sound upper bound)", () => {
  let bad = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const { model, pick, budget } = randCase(seed);
    const claimed = pick.map((id) => model.find((c) => c.id === id)!);
    const pool = model.filter((c) => !pick.includes(c.id) && c.grant.some((x) => x > 0));
    if (greedyMinCost(model, pick, budget) < bruteRefund(claimed, pool, budget)) bad++;
  }
  expect(bad).toBe(0);
});

test("classify never lies: no reachable-marked-dim and no dim-marked-reachable", () => {
  let falseDim = 0, falseReach = 0, unknown = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const { model, pick, budget } = randCase(seed);
    const cover = buildCoverTable(model);
    const claimed = pick.map((id) => model.find((c) => c.id === id)!);
    const pool = model.filter((c) => !pick.includes(c.id) && c.grant.some((x) => x > 0));
    const brute = bruteRefund(claimed, pool, budget);
    const verdict = classify(model, cover, pick, budget);
    if (brute <= budget && verdict === "dim") falseDim++;
    if (brute > budget && verdict === "reachable") falseReach++;
    if (verdict === "unknown") unknown++;
  }
  expect(falseDim).toBe(0);
  expect(falseReach).toBe(0);
  expect(unknown).toBeLessThan(40); // the bracket gap should be rare
});

// ---- real data ----
const realModel = buildModel(doc as any);
const cons = buildReachCons(realModel);
const cover = buildCoverTable(cons);
const nameToId = new Map([...realModel.constellations.values()].map((c) => [c.name, c.id]));
const id = (name: string) => nameToId.get(name)!;

test("from an empty selection, every constellation is reachable", () => {
  const sweep = reachabilitySweep(cons, cover, []);
  const notReachable = [...sweep.values()].filter((v) => v !== "reachable").length;
  expect(notReachable).toBe(0);
});

test("Leviathan and Tree of Life are each reachable; their cover cost is ~26-27", () => {
  expect(classify(cons, cover, [id("Leviathan")])).toBe("reachable");
  expect(classify(cons, cover, [id("Tree of Life")])).toBe("reachable");
  expect(coverLowerBound(cover, [id("Leviathan")].map((i) => cons.find((c) => c.id === i)!))).toBeLessThanOrEqual(30);
});

test("claiming several capstones makes many candidates dim (the feature actually works)", () => {
  const claims = [id("Leviathan"), id("Tree of Life"), id("Oklaine's Lantern")].filter(Boolean);
  const sweep = reachabilitySweep(cons, cover, claims);
  const dim = [...sweep.values()].filter((v) => v === "dim").length;
  expect(dim).toBeGreaterThan(10);
});
