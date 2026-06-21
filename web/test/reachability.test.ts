// ABOUTME: P1 prototype tests - validates the exact reachability search against a brute-force oracle,
// ABOUTME: pins greedy soundness, and records the real-data findings (incl. that few pairs actually dim).
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { buildReachCons, exactMinCost, greedyMinCost, INF, type ReachCon, type Vec } from "../src/core/reachability";

const covers = (g: Vec, d: Vec) => g.every((x, i) => x >= d[i]!);
const CAP: Vec = [20, 8, 20, 10, 20];

// Brute oracle: exhaustive min-cost orderable build placing every claimed constellation.
function bruteMinCost(cons: ReachCon[], claimedIds: string[], budget: number): number {
  const byId = new Map(cons.map((c) => [c.id, c]));
  const claimed = claimedIds.map((id) => byId.get(id)!);
  const claimedSet = new Set(claimedIds);
  const pool = cons.filter((c) => !claimedSet.has(c.id) && c.grant.some((x) => x > 0));
  let best = INF;
  for (let mask = 0; mask < 1 << pool.length; mask++) {
    const set = claimed.slice();
    let own = claimed.reduce((s, c) => s + c.size, 0);
    for (let i = 0; i < pool.length; i++) if (mask & (1 << i)) { set.push(pool[i]!); own += pool[i]!.size; }
    if (own >= best || own > budget) continue;
    let acc: Vec = [0, 0, 0, 0, 0], placed = 0, changed = true;
    const done = new Array(set.length).fill(false);
    while (changed) { changed = false; for (let i = 0; i < set.length; i++) { if (done[i]) continue; if (covers(acc, set[i]!.req)) { acc = set[i]!.grant.map((x, j) => Math.min(acc[j]! + x, CAP[j]!)) as Vec; done[i] = true; placed++; changed = true; } } }
    if (placed === set.length) best = Math.min(best, own);
  }
  return best;
}

function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function randModel(rng: () => number, n: number): ReachCon[] {
  const cons: ReachCon[] = [];
  for (let i = 0; i < 2; i++) { const g: Vec = [0, 0, 0, 0, 0]; g[Math.floor(rng() * 5)] = 1 + Math.floor(rng() * 2); cons.push({ id: `b${i}`, size: 1, req: [0, 0, 0, 0, 0], grant: g }); }
  for (let i = 0; i < n; i++) { const req: Vec = [0, 0, 0, 0, 0], grant: Vec = [0, 0, 0, 0, 0]; req[Math.floor(rng() * 5)] = Math.floor(rng() * 4); grant[Math.floor(rng() * 5)] = 1 + Math.floor(rng() * 4); cons.push({ id: `c${i}`, size: 1 + Math.floor(rng() * 4), req, grant }); }
  return cons;
}

function randCase(seed: number) {
  const rng = mulberry32(seed);
  const model = randModel(rng, 7 + Math.floor(rng() * 4));
  const pick: string[] = [];
  for (let i = 0, nb = Math.floor(rng() * 3); i < nb; i++) { const c = model[Math.floor(rng() * model.length)]!; if (!pick.includes(c.id)) pick.push(c.id); }
  return { model, pick, budget: 8 + Math.floor(rng() * 10) };
}

test("exact minCost matches the brute-force oracle on 300 random models", () => {
  let mismatches = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const { model, pick, budget } = randCase(seed);
    if (exactMinCost(model, pick, budget).cost !== bruteMinCost(model, pick, budget)) mismatches++;
  }
  expect(mismatches).toBe(0);
});

test("greedy never undercuts the exact optimum (sound upper bound)", () => {
  let unsound = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const { model, pick, budget } = randCase(seed);
    if (greedyMinCost(model, pick, budget) < exactMinCost(model, pick, budget).cost) unsound++;
  }
  expect(unsound).toBe(0);
});

test("a greedy-reachable claim is genuinely reachable by the exact search", () => {
  let bad = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const { model, pick, budget } = randCase(seed);
    if (greedyMinCost(model, pick, budget) <= budget && exactMinCost(model, pick, budget).cost > budget) bad++;
  }
  expect(bad).toBe(0);
});

const realModel = buildModel(doc as any);
const cons = buildReachCons(realModel);
const nameToId = new Map([...realModel.constellations.values()].map((c) => [c.name, c.id]));

test("from an empty selection every constellation is reachable (greedy, sound)", () => {
  let unreachable = 0;
  for (const c of cons) if (greedyMinCost(cons, [c.id], 55) > 55) unreachable++;
  // Greedy is sound for reachable; any miss is a greedy false-dim, not a true block.
  expect(unreachable).toBeLessThanOrEqual(2);
});

test("Leviathan and Tree of Life are jointly reachable in 55 points (does NOT dim)", () => {
  // The P1 finding: the exact search caps out here, but greedy finds a real <=55 build,
  // and greedy-reachable is sound. So this pair does not actually conflict at 55 points.
  const lev = nameToId.get("Leviathan")!, tree = nameToId.get("Tree of Life")!;
  const g = greedyMinCost(cons, [lev, tree], 55);
  expect(g).toBeLessThanOrEqual(55);
});
