// ABOUTME: Tests the crossroads-refund reachability engine: the cover lower bound is sound for
// ABOUTME: "dim", the greedy upper bound is sound for "reachable", and classify never lies, all
// ABOUTME: validated against a brute oracle using the same self-sustaining + crossroads-seed rule.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { buildReachCons, buildCoverTable, coverLowerBound, greedyMinCost, classify, classifyComplete, reachableExact, reachabilitySweep, selectionSummary, classifyForSelection, lowerBoundFrom, INF, type ReachCon, type ReachState, type Vec } from "../src/core/reachability";

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

test("reachableExact matches the brute oracle's reachable/dim decision on 400 random models", () => {
  let bad = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const { model, pick, budget } = randCase(seed);
    const table = buildCoverTable(model);
    const claimed = pick.map((id) => model.find((c) => c.id === id)!);
    const pool = model.filter((c) => !pick.includes(c.id) && c.grant.some((x) => x > 0));
    if (reachableExact(model, table, pick, budget) !== (bruteRefund(claimed, pool, budget) <= budget)) bad++;
  }
  expect(bad).toBe(0);
});

test("classifyComplete is always reachable or dim, and matches the brute decision", () => {
  let bad = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const { model, pick, budget } = randCase(seed);
    const table = buildCoverTable(model);
    const claimed = pick.map((id) => model.find((c) => c.id === id)!);
    const pool = model.filter((c) => !pick.includes(c.id) && c.grant.some((x) => x > 0));
    const v = classifyComplete(model, table, pick, budget);
    if ((v === "reachable") !== (bruteRefund(claimed, pool, budget) <= budget)) bad++;
  }
  expect(bad).toBe(0);
});

test("classifyComplete drives the real-data unknowns to zero (Leviathan + Tree of Life)", () => {
  const claims = [id("Leviathan"), id("Tree of Life")];
  const claimedSet = new Set(claims);
  let unknowns = 0;
  for (const c of cons) {
    if (claimedSet.has(c.id)) continue;
    const ids = [...claims, c.id];
    if (classify(cons, cover, ids) !== "unknown") continue;
    unknowns++;
    const v = classifyComplete(cons, cover, ids);
    expect(v === "reachable" || v === "dim").toBe(true);
  }
  expect(unknowns).toBeGreaterThan(0); // there genuinely are unknowns here, and all got resolved
});

test("claiming several capstones makes many candidates dim (the feature actually works)", () => {
  const claims = [id("Leviathan"), id("Tree of Life"), id("Oklaine's Lantern")].filter(Boolean);
  const sweep = reachabilitySweep(cons, cover, claims);
  const dim = [...sweep.values()].filter((v) => v === "dim").length;
  expect(dim).toBeGreaterThan(10);
});

test("selectionSummary splits started vs completed and tracks partial finishes", () => {
  const lev = realModel.constellations.get(id("Leviathan"))!;     // grants nothing, requires eldritch+ascendant
  const tree = realModel.constellations.get(id("Tree of Life"))!; // grants nothing
  // Fully select Leviathan, partially select Tree of Life (first star only).
  const sel = new Set<string>([...lev.starIds, tree.starIds[0]!]);
  const s = selectionSummary(realModel, sel);
  expect(s.own).toBe(lev.starIds.length + 1);
  expect(s.startedIds.has(id("Leviathan"))).toBe(true);
  expect(s.startedIds.has(id("Tree of Life"))).toBe(true);
  // supply has NO Tree grant (partial) and no Leviathan grant (grants nothing): all zero here.
  expect(s.supply).toEqual([0, 0, 0, 0, 0]);
  // target covers Leviathan's eldritch 13 + ascendant 13 AND Tree's primordial 20 + order 7.
  expect(s.target).toEqual([13, 0, 13, 7, 20]);
  // Tree grants nothing, so it is NOT a partial-finish candidate.
  expect(s.partialFinish.length).toBe(0);
});

// ---- classifyForSelection oracle (constructibility-aware, partial-selection aware) ----

// The build implied by a partial-selection state plus a chosen filler subset: the started
// constellations (completed with their grant, partials with grant zeroed) plus the chosen
// filler (unstarted granting constellations and partial-finish completions, each with its
// full grant). A finish entry pairs with its partial in `built`: own sums to the full size,
// grant sums to the full grant. Validity is the same covers + constructible rule isValidBuild
// uses, so this oracle is NOT order-free.
function bruteSelectionMinCost(st: ReachState, cons: ReachCon[], budget: number): number {
  const finishes: ReachCon[] = st.partialFinish.map((p) => ({ id: `${p.id}#finish`, size: p.remaining, req: p.req, grant: p.grant }));
  const startedIds = st.startedIds;
  const fillers = cons.filter((c) => !startedIds.has(c.id) && c.grant.some((x) => x > 0)).concat(finishes);
  const baseOwn = st.built.reduce((s, c) => s + c.size, 0);
  let best = INF;
  for (let mask = 0; mask < 1 << fillers.length; mask++) {
    const B = st.built.slice(); let own = baseOwn;
    for (let i = 0; i < fillers.length; i++) if (mask & (1 << i)) { B.push(fillers[i]!); own += fillers[i]!.size; }
    if (own >= best || own > budget) continue;
    if (isValidBuild(B)) best = Math.min(best, own);
  }
  return best;
}

// A random partial-selection state: take a random model, start a few constellations, mark each
// completed or partial, and assemble the ReachState the engine consumes (built carries partials
// with grant zeroed; partialFinish lists the granting partials as cheap completions).
function randSelectionCase(seed: number): { st: ReachState; cons: ReachCon[]; budget: number } {
  const rng = mulberry32(seed);
  const cons = randModel(rng, 6 + Math.floor(rng() * 4));
  const realCons = cons.filter((c) => !c.id.startsWith("x"));
  const built: ReachCon[] = [];
  const partialFinish: ReachState["partialFinish"] = [];
  const startedIds = new Set<string>();
  const nStart = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < nStart; i++) {
    const c = realCons[Math.floor(rng() * realCons.length)]!;
    if (startedIds.has(c.id)) continue;
    startedIds.add(c.id);
    const complete = c.size === 1 || rng() < 0.5;
    if (complete) {
      built.push({ id: c.id, size: c.size, req: c.req, grant: c.grant });
    } else {
      const sel = 1 + Math.floor(rng() * (c.size - 1)); // 1..size-1 stars
      built.push({ id: c.id, size: sel, req: c.req, grant: zero() });
      if (c.grant.some((x) => x > 0)) partialFinish.push({ id: c.id, remaining: c.size - sel, grant: c.grant, req: c.req });
    }
  }
  const supply = built.reduce((t, c) => addCap(t, c.grant), zero());
  const target = built.reduce((r, c) => maxV(r, c.req), zero());
  const own = built.reduce((s, c) => s + c.size, 0);
  return { st: { own, supply, target, startedIds, partialFinish, built }, cons, budget: 8 + Math.floor(rng() * 10) };
}

test("classifyForSelection never lies vs the brute oracle (400 partial selections)", () => {
  let falseDim = 0, falseReach = 0, unknown = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const { st, cons, budget } = randSelectionCase(seed);
    const table = buildCoverTable(cons);
    const brute = bruteSelectionMinCost(st, cons, budget);
    const verdict = classifyForSelection(cons, table, st, budget);
    if (brute <= budget && verdict === "dim") falseDim++;
    if (brute > budget && verdict === "reachable") falseReach++;
    if (verdict === "unknown") unknown++;
  }
  expect(falseDim).toBe(0);
  expect(falseReach).toBe(0);
  expect(unknown).toBeLessThan(40);
});

test("lowerBoundFrom credits cheap partial finishes (sound vs the brute oracle)", () => {
  let bad = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const { st, cons, budget } = randSelectionCase(seed);
    const table = buildCoverTable(cons);
    if (lowerBoundFrom(table, st) > bruteSelectionMinCost(st, cons, budget)) bad++;
  }
  expect(bad).toBe(0);
});
