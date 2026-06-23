// ABOUTME: Reachability engine for path-predictor mode (claim a set, see what stays achievable).
// ABOUTME: A build is valid iff its total affinity covers every member's requirement AND it is
// ABOUTME: constructible from the refundable crossroads seed (some order places each member with
// ABOUTME: its requirement met). minCost is bracketed by a fast cover-table lower bound (sound for
// ABOUTME: "dim") and a constructibility-aware greedy upper bound (sound for "reachable").
import { AFFINITIES, type DevotionModel, type StarId } from "./types";

export type Vec = [number, number, number, number, number]; // order = AFFINITIES
// Hard per-color cap: the max requirement that gates anything; affinity beyond this is worthless.
const CAP_MAX: Vec = [20, 8, 20, 10, 20];
const NOCOST = 65535;
export const INF = 1e9;
export const BUDGET = 55;
// Crossroads supply 1 affinity of each color and are refundable, so any build can be seeded
// with one point per color for free while bootstrapping.
const SEED: Vec = [1, 1, 1, 1, 1];

/** A constellation reduced to what reachability needs: its cost and affinity vectors. */
export interface ReachCon {
  id: string;
  size: number;
  req: Vec;
  grant: Vec;
}
/** A cover table carries its own grid dimensions (sized to the model's max requirements). */
export interface CoverTable {
  cost: Uint16Array;
  caps: Vec;
  strides: Vec;
}

const zero = (): Vec => [0, 0, 0, 0, 0];
const covers = (g: Vec, d: Vec): boolean =>
  g[0] >= d[0] && g[1] >= d[1] && g[2] >= d[2] && g[3] >= d[3] && g[4] >= d[4];
const addCap = (g: Vec, x: Vec): Vec => [
  Math.min(g[0] + x[0], CAP_MAX[0]!),
  Math.min(g[1] + x[1], CAP_MAX[1]!),
  Math.min(g[2] + x[2], CAP_MAX[2]!),
  Math.min(g[3] + x[3], CAP_MAX[3]!),
  Math.min(g[4] + x[4], CAP_MAX[4]!),
];
const maxV = (a: Vec, b: Vec): Vec => [
  Math.max(a[0], b[0]),
  Math.max(a[1], b[1]),
  Math.max(a[2], b[2]),
  Math.max(a[3], b[3]),
  Math.max(a[4], b[4]),
];

function vecOf(m: Partial<Record<(typeof AFFINITIES)[number], number>>): Vec {
  return AFFINITIES.map((a) => m[a] ?? 0) as Vec;
}

/** Reduce a DevotionModel to the compact per-constellation data the search needs. */
export function buildReachCons(model: DevotionModel): ReachCon[] {
  const out: ReachCon[] = [];
  for (const c of model.constellations.values()) {
    out.push({ id: c.id, size: c.starIds.length, req: vecOf(c.affinityRequired), grant: vecOf(c.affinityBonus) });
  }
  return out;
}

/** The cover grid dimensions (caps + strides) for a model, without building the cost table. */
export function coverDims(cons: ReachCon[]): { caps: Vec; strides: Vec } {
  const caps: Vec = zero();
  for (const c of cons) for (let i = 0; i < 5; i++) caps[i] = Math.max(caps[i]!, c.req[i]!);
  for (let i = 0; i < 5; i++) caps[i] = Math.min(caps[i]!, CAP_MAX[i]!);
  const sizes = caps.map((c) => c + 1);
  const strides = sizes.map((_, i) => sizes.slice(i + 1).reduce((a, b) => a * b, 1)) as Vec;
  return { caps, strides };
}

/**
 * The crossroads-refund cover table. `cost[D]` = the minimum stars of a SUBSET of distinct
 * constellations whose summed (capped) affinity reaches at least `D`. Orderability-free: because
 * bootstraps are refundable, the cheapest way to reach an affinity vector is just the cheapest
 * subset that sums to it. Built once with an in-place 0/1 knapsack DP (descending so no
 * constellation is reused), then a 5D suffix-min so a lookup answers ">= D".
 *
 * The grid is capped per color at the model's maximum requirement (affinity beyond what anything
 * requires is useless), so a small model yields a tiny grid and the real model the full one.
 *
 * This is a LOWER BOUND on the true minCost (it ignores that filler must also be self-sustaining),
 * so it is sound for dimming: if `coverLowerBound > 55`, the claim is genuinely unreachable.
 */
export function buildCoverTable(cons: ReachCon[]): CoverTable {
  const { caps, strides } = coverDims(cons);
  const sizes = caps.map((c) => c + 1);
  const maxKey = sizes.reduce((a, b) => a * b, 1);
  const cost = new Uint16Array(maxKey).fill(NOCOST);
  cost[0] = 0;
  for (const c of cons) {
    if (!(c.grant[0] || c.grant[1] || c.grant[2] || c.grant[3] || c.grant[4])) continue;
    const [g0, g1, g2, g3, g4] = c.grant;
    for (let a = caps[0]!; a >= 0; a--)
      for (let ch = caps[1]!; ch >= 0; ch--)
        for (let e = caps[2]!; e >= 0; e--)
          for (let o = caps[3]!; o >= 0; o--)
            for (let p = caps[4]!; p >= 0; p--) {
              const k = a * strides[0]! + ch * strides[1]! + e * strides[2]! + o * strides[3]! + p;
              const pc = cost[k]!;
              if (pc === NOCOST) continue;
              const nc = pc + c.size;
              if (nc > BUDGET) continue;
              const nk =
                Math.min(a + g0, caps[0]!) * strides[0]! +
                Math.min(ch + g1, caps[1]!) * strides[1]! +
                Math.min(e + g2, caps[2]!) * strides[2]! +
                Math.min(o + g3, caps[3]!) * strides[3]! +
                Math.min(p + g4, caps[4]!);
              if (nc < cost[nk]!) cost[nk] = nc;
            }
  }
  for (let i = 0; i < 5; i++) {
    const st = strides[i]!;
    for (let k = maxKey - 1; k >= 0; k--)
      if (Math.floor(k / st) % sizes[i]! < caps[i]!) {
        const up = cost[k + st]!;
        if (up < cost[k]!) cost[k] = up;
      }
  }
  return { cost, caps, strides };
}

function claimSummary(claimed: ReachCon[]) {
  let req = zero(),
    grant = zero(),
    own = 0;
  for (const c of claimed) {
    req = maxV(req, c.req);
    grant = addCap(grant, c.grant);
    own += c.size;
  }
  return { req, grant, own };
}

/** A normalized start point for the minCost bracket, derived from a raw star selection. */
export interface ReachState {
  own: number; // total selected stars (all count against budget); equals sum of `built` sizes
  supply: Vec; // affinity from COMPLETED constellations only
  target: Vec; // elementwise-max requirement over STARTED constellations
  startedIds: Set<string>;
  partialFinish: { id: string; remaining: number; grant: Vec; req: Vec }[];
  // The started constellations as already-committed members, for the constructibility check:
  // a completed one carries its full size and grant; a partial carries its SELECTED star count
  // and a zero grant (it imposes its requirement but supplies nothing until finished).
  built: ReachCon[];
}

/** Reduce a raw star selection to the data the bracket needs (honest partials). */
export function selectionSummary(model: DevotionModel, selected: Set<string>): ReachState {
  const selByCon = new Map<string, number>();
  let own = 0;
  for (const sid of selected) {
    const star = model.stars.get(sid);
    if (!star) continue;
    own++;
    selByCon.set(star.constellationId, (selByCon.get(star.constellationId) ?? 0) + 1);
  }
  let supply = zero(),
    target = zero();
  const startedIds = new Set<string>();
  const partialFinish: ReachState["partialFinish"] = [];
  const built: ReachCon[] = [];
  for (const [conId, count] of selByCon) {
    const c = model.constellations.get(conId);
    if (!c) continue;
    startedIds.add(conId);
    const req = vecOf(c.affinityRequired);
    target = maxV(target, req);
    const grant = vecOf(c.affinityBonus);
    if (count >= c.starIds.length) {
      supply = addCap(supply, grant);
      built.push({ id: conId, size: c.starIds.length, req, grant });
    } else {
      built.push({ id: conId, size: count, req, grant: zero() });
      if (grant[0] || grant[1] || grant[2] || grant[3] || grant[4])
        partialFinish.push({ id: conId, remaining: c.starIds.length - count, grant, req });
    }
  }
  return { own, supply, target, startedIds, partialFinish, built };
}

/** Treat a fully-claimed set as a selection state: every claim is a completed member. */
export function stateFromClaimed(claimed: ReachCon[]): ReachState {
  const { req, grant, own } = claimSummary(claimed);
  return {
    own,
    supply: grant,
    target: req,
    startedIds: new Set(claimed.map((c) => c.id)),
    partialFinish: [],
    built: claimed.map((c) => ({ id: c.id, size: c.size, req: c.req, grant: c.grant })),
  };
}

/**
 * Lower bound on minCost for a selection state: own stars plus the cheapest filler to cover the
 * remaining affinity deficit. Partial finishes are credited as cheap completions - we minimise
 * over every subset of finishes (paying their stars, adding their grant to supply) so the cover
 * table only has to close whatever deficit the chosen finishes leave. This is a pure lower bound
 * (the cover table itself is one) and ignores constructibility, so it is sound for "dim".
 */
export function lowerBoundFrom(table: CoverTable, st: ReachState): number {
  const fins = st.partialFinish;
  let best = INF;
  for (let mask = 0; mask < 1 << fins.length; mask++) {
    let supply = st.supply,
      extra = 0;
    for (let i = 0; i < fins.length; i++)
      if (mask & (1 << i)) {
        supply = addCap(supply, fins[i]!.grant);
        extra += fins[i]!.remaining;
      }
    const deficit: Vec = [
      Math.max(0, st.target[0] - supply[0]),
      Math.max(0, st.target[1] - supply[1]),
      Math.max(0, st.target[2] - supply[2]),
      Math.max(0, st.target[3] - supply[3]),
      Math.max(0, st.target[4] - supply[4]),
    ];
    const cov = coverCostAt(table, deficit);
    if (cov >= INF) continue; // uncoverable for this subset; the INF must not be added to own
    const bound = st.own + extra + cov;
    if (bound < best) best = bound;
  }
  return best;
}

/** Lower bound on minCost(claimed): own stars + cheapest filler to cover the claimed deficit. */
export function coverLowerBound(table: CoverTable, claimed: ReachCon[]): number {
  return lowerBoundFrom(table, stateFromClaimed(claimed));
}

/** The filler a selection state may draw on: unstarted granting constellations plus its finishes. */
function fillerFor(cons: ReachCon[], st: ReachState): ReachCon[] {
  const filler = cons.filter(
    (c) => !st.startedIds.has(c.id) && (c.grant[0] || c.grant[1] || c.grant[2] || c.grant[3] || c.grant[4]),
  );
  for (const p of st.partialFinish)
    filler.push({ id: `${p.id}#finish`, size: p.remaining, req: p.req, grant: p.grant });
  return filler;
}

/**
 * Refund-aware greedy: construct a valid build placing every claimed constellation, seeded by
 * the free crossroads, repeatedly adding the unlocked constellation that best closes the affinity
 * deficit per star. Once the claimed are placed and the build's own affinity covers every placed
 * member's requirement, the crossroads are refunded and the cost excludes them.
 *
 * SOUND for "reachable": a returned cost <= budget means a genuine valid build exists. It is an
 * upper bound on minCost (it does not always find the cheapest build).
 */
export function greedyMinCost(cons: ReachCon[], claimedIds: string[], budget = BUDGET): number {
  const byId = new Map(cons.map((c) => [c.id, c]));
  const claimed = claimedIds.map((id) => byId.get(id)!);
  return greedyFrom(cons, stateFromClaimed(claimed), budget);
}

/**
 * Refund-aware greedy for a selection state. Auto-places every already-committed member
 * (`st.built`, partials included as zero-grant) in seed-unlock order, then adds filler (unstarted
 * granting constellations and partial finishes) by best deficit-reduction-per-star, until every
 * committed member is placed AND the build's own affinity covers every placed requirement.
 * SOUND for "reachable": a returned cost <= budget means a genuine, constructible valid build
 * exists; it is an upper bound on minCost (constructibility-aware by construction).
 */
export function greedyFrom(cons: ReachCon[], st: ReachState, budget = BUDGET): number {
  const built = st.built;
  const pool = [...built, ...fillerFor(cons, st)];
  const placed = new Array(pool.length).fill(false);
  let build = zero(); // affinity from placed constellations (excludes the transient seed)
  let maxReqPlaced = zero(); // every placed constellation must stand under this once seed is gone
  let cost = 0,
    builtLeft = built.length;
  for (;;) {
    const gain = addCap(SEED, build);
    let did = false;
    // Auto-place the committed members as they unlock; filler is added selectively below.
    for (let i = 0; i < built.length; i++) {
      if (placed[i] || !covers(gain, built[i]!.req)) continue;
      placed[i] = true;
      cost += built[i]!.size;
      build = addCap(build, built[i]!.grant);
      maxReqPlaced = maxV(maxReqPlaced, built[i]!.req);
      builtLeft--;
      did = true;
    }
    if (builtLeft === 0 && covers(build, maxReqPlaced)) return cost <= budget ? cost : INF;
    if (did) continue;
    const g2 = addCap(SEED, build);
    const target = covers(build, maxReqPlaced) ? st.target : maxReqPlaced; // close self-sustain first, then started reqs
    const deficit: Vec = [
      Math.max(0, target[0]! - build[0]),
      Math.max(0, target[1]! - build[1]),
      Math.max(0, target[2]! - build[2]),
      Math.max(0, target[3]! - build[3]),
      Math.max(0, target[4]! - build[4]),
    ];
    let best = -1,
      bestScore = 0;
    for (let i = built.length; i < pool.length; i++) {
      if (placed[i] || !covers(g2, pool[i]!.req)) continue;
      let red = 0;
      for (let j = 0; j < 5; j++) red += Math.min(pool[i]!.grant[j]!, deficit[j]!);
      const score = red / pool[i]!.size;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0 || bestScore === 0) return INF;
    placed[best] = true;
    cost += pool[best]!.size;
    build = addCap(build, pool[best]!.grant);
    maxReqPlaced = maxV(maxReqPlaced, pool[best]!.req);
    if (cost > budget) return INF;
  }
}

export type Reach = "reachable" | "dim" | "unknown";

/**
 * Classify a candidate claim by bracketing minCost. The cover lower bound soundly proves "dim";
 * the greedy upper bound soundly proves "reachable". The (rare) gap between is "unknown".
 */
export function classify(cons: ReachCon[], table: CoverTable, claimedIds: string[], budget = BUDGET): Reach {
  const byId = new Map(cons.map((c) => [c.id, c]));
  const claimed = claimedIds.map((id) => byId.get(id)!);
  if (coverLowerBound(table, claimed) > budget) return "dim";
  if (greedyMinCost(cons, claimedIds, budget) <= budget) return "reachable";
  return "unknown";
}

/** For a current claimed set S, classify every other constellation as a candidate next claim. */
export function reachabilitySweep(
  cons: ReachCon[],
  table: CoverTable,
  claimedIds: string[],
  budget = BUDGET,
): Map<string, Reach> {
  const out = new Map<string, Reach>();
  const claimedSet = new Set(claimedIds);
  for (const c of cons) {
    if (claimedSet.has(c.id)) continue;
    out.set(c.id, classify(cons, table, [...claimedIds, c.id], budget));
  }
  return out;
}

function coverCostAt(table: CoverTable, deficit: Vec): number {
  let k = 0;
  for (let i = 0; i < 5; i++) k += Math.min(Math.max(0, deficit[i]!), table.caps[i]!) * table.strides[i]!;
  const v = table.cost[k]!;
  return v === NOCOST ? INF : v;
}

/** Can every member of B be completed in some order, seeded by the free crossroads? */
function constructible(B: ReachCon[]): boolean {
  let gain: Vec = [...SEED];
  const done = B.map(() => false);
  let placed = 0,
    changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < B.length; i++) {
      if (done[i] || !covers(gain, B[i]!.req)) continue;
      done[i] = true;
      placed++;
      gain = addCap(gain, B[i]!.grant);
      changed = true;
    }
  }
  return placed === B.length;
}

/**
 * Exact reachability decision (the "unknown" gap-closer). DFS over filler subsets, pruned by the
 * cover table as an admissible lower bound, early-exiting on the first valid build within budget.
 * For a reachable claim it stops at the first witness; for a dim claim it exhausts (the cover
 * prune keeps that bounded). Definitive: returns the true reachable/dim answer.
 *
 * Run it only on candidates the cheap bracket left "unknown" - it is heavier than the bracket
 * (worst seen ~700k nodes for one borderline candidate), so it is not for an unfiltered sweep.
 */
export function reachableExact(cons: ReachCon[], table: CoverTable, claimedIds: string[], budget = BUDGET): boolean {
  const byId = new Map(cons.map((c) => [c.id, c]));
  const claimed = claimedIds.map((id) => byId.get(id)!);
  return reachableExactFrom(cons, table, stateFromClaimed(claimed), budget);
}

/**
 * Exact reachability decision for a selection state. Definitive (the true reachable/dim answer).
 *
 * Partial finishes break the bare cover prune: the table is built from whole-constellation grants,
 * so it cannot see that finishing a started constellation supplies affinity more cheaply, and the
 * prune over-estimates the remaining cost (falsely dimming). Crediting the finishes keeps it sound
 * but so loose the search explodes. So we DECIDE the finishes up front: enumerate which to complete
 * (very few - one per started granting constellation), and for each choice run a pure
 * whole-constellation DFS whose cover prune is then both admissible AND tight (no cheaper finishes
 * remain to undercut it). Reachable iff some finish-choice yields a covering, constructible build
 * within budget. With no partial finishes this is exactly the single whole-constellation DFS.
 */
let exactNodes = 0;
/** Nodes visited by the last reachableExactFrom call (diagnostic / cap tuning). */
export function lastExactNodes(): number {
  return exactNodes;
}

export function reachableExactFrom(cons: ReachCon[], table: CoverTable, st: ReachState, budget = BUDGET): boolean {
  exactNodes = 0;
  const ratio = (c: ReachCon) => (c.grant[0] + c.grant[1] + c.grant[2] + c.grant[3] + c.grant[4]) / c.size;
  const wholeFiller = cons
    .filter((c) => !st.startedIds.has(c.id) && (c.grant[0] || c.grant[1] || c.grant[2] || c.grant[3] || c.grant[4]))
    .sort((a, b) => ratio(b) - ratio(a));
  const pf = st.partialFinish;
  const grantById = new Map(pf.map((p) => [p.id, p.grant]));
  let found = false;
  const chosen: ReachCon[] = [];
  // Whole-constellation DFS for one finish-choice; the cover prune is admissible (no finishes left).
  function rec(i: number, build: Vec, cost: number, maxReqPlaced: Vec, builtCons: ReachCon[]): void {
    if (found) return;
    exactNodes++;
    if (covers(build, maxReqPlaced) && constructible([...builtCons, ...chosen])) {
      found = true;
      return;
    }
    if (i >= wholeFiller.length) return;
    const target = maxV(maxReqPlaced, st.target);
    const deficit: Vec = [
      Math.max(0, target[0] - build[0]),
      Math.max(0, target[1] - build[1]),
      Math.max(0, target[2] - build[2]),
      Math.max(0, target[3] - build[3]),
      Math.max(0, target[4] - build[4]),
    ];
    if (cost + coverCostAt(table, deficit) > budget) return; // even the cheapest completion overflows
    const c = wholeFiller[i]!;
    if (cost + c.size <= budget) {
      chosen.push(c);
      rec(i + 1, addCap(build, c.grant), cost + c.size, maxV(maxReqPlaced, c.req), builtCons);
      chosen.pop();
    }
    if (!found) rec(i + 1, build, cost, maxReqPlaced, builtCons);
  }
  // Decide every subset of partial finishes to complete (2^k with k tiny - usually 0 or 1).
  for (let mask = 0; mask < 1 << pf.length && !found; mask++) {
    let build0: Vec = [...st.supply],
      cost0 = st.own;
    const finished = new Set<string>();
    for (let j = 0; j < pf.length; j++)
      if (mask & (1 << j)) {
        build0 = addCap(build0, pf[j]!.grant);
        cost0 += pf[j]!.remaining;
        finished.add(pf[j]!.id);
      }
    if (cost0 > budget) continue;
    const builtCons = st.built.map((b) => (finished.has(b.id) ? { ...b, grant: grantById.get(b.id)! } : b));
    chosen.length = 0;
    rec(0, build0, cost0, st.target, builtCons);
  }
  return found;
}

/** Signature of the exact gap-resolver; the WASM port is a drop-in for the TS `reachableExactFrom`. */
export type ExactResolver = (cons: ReachCon[], table: CoverTable, st: ReachState, budget: number) => boolean;
// The bracket gap is resolved by this. Defaults to the TS search; an adapter may swap in the
// (verdict-equivalent, far faster) WASM port via setExactResolver. Pure default keeps the core testable.
let exactResolver: ExactResolver = reachableExactFrom;
/** Override the exact gap-resolver (pass null to restore the TS default). */
export function setExactResolver(fn: ExactResolver | null): void {
  exactResolver = fn ?? reachableExactFrom;
}

/**
 * Classify a partial-selection state by bracketing minCost, then resolving the gap exactly.
 * `lowerBoundFrom` soundly proves "dim"; `greedyFrom` soundly proves "reachable"; the rare
 * remainder is decided by the exact resolver (TS or the injected WASM port). Always returns
 * "reachable" or "dim" and never lies versus the covers + constructible rule.
 */
export function classifyForSelection(cons: ReachCon[], table: CoverTable, st: ReachState, budget = BUDGET): Reach {
  if (lowerBoundFrom(table, st) > budget) return "dim";
  if (greedyFrom(cons, st, budget) <= budget) return "reachable";
  return exactResolver(cons, table, st, budget) ? "reachable" : "dim";
}

/** Like classify, but resolves the "unknown" gap with the exact resolver - always reachable or dim. */
export function classifyComplete(
  cons: ReachCon[],
  table: CoverTable,
  claimedIds: string[],
  budget = BUDGET,
): "reachable" | "dim" {
  const verdict = classify(cons, table, claimedIds, budget);
  if (verdict !== "unknown") return verdict;
  return reachableExact(cons, table, claimedIds, budget) ? "reachable" : "dim";
}

/** Minimum total stars to COMPLETE conId on top of `selected`, or INF if not within maxBudget. */
export function completionMinCost(
  model: DevotionModel,
  cons: ReachCon[],
  table: CoverTable,
  selected: Set<string>,
  conId: string,
  maxBudget = BUDGET,
): number {
  const con = model.constellations.get(conId);
  if (!con) return INF;
  const withCon = new Set(selected);
  for (const sid of con.starIds) withCon.add(sid);
  const st = selectionSummary(model, withCon);
  let lo = st.own; // cannot cost less than the stars already required
  if (lo > maxBudget) return INF;
  if (exactResolver(cons, table, st, maxBudget) === false) return INF;
  let hi = maxBudget;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (exactResolver(cons, table, st, mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * Minimum total points for `selected` to be a valid, constructible build - the smallest budget at
 * which the selection classifies "reachable". This is the slider floor: below it the current
 * selection cannot be a legal build (e.g. claiming Leviathan alone is 7 stars but needs ~26 points
 * once the affinity it requires is paid for). Returns `own` when nothing gates the selection, 0 when
 * empty, and never exceeds maxBudget (a selection needing more pins to maxBudget). Monotone in
 * budget, so a binary search over classifyForSelection is exact.
 */
export function selectionMinCost(
  model: DevotionModel,
  cons: ReachCon[],
  table: CoverTable,
  selected: Set<string>,
  maxBudget = BUDGET,
): number {
  const st = selectionSummary(model, selected);
  let lo = st.own; // cannot cost less than the stars already selected
  if (lo === 0) return 0;
  if (lo >= maxBudget) return maxBudget;
  if (classifyForSelection(cons, table, st, maxBudget) !== "reachable") return maxBudget;
  let hi = maxBudget;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (classifyForSelection(cons, table, st, mid) === "reachable") hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export interface ReachView {
  completable: Set<string>;
  clickable: Set<StarId>;
  have: Vec;
  need: Vec;
  needSource: Map<number, string[]>;
}

/** One full sweep for a selection: what can be completed, what stars can be clicked, and the panel vectors. */
export function reachabilityForSelection(
  model: DevotionModel,
  cons: ReachCon[],
  table: CoverTable,
  selected: Set<StarId>,
  budget = BUDGET,
): ReachView {
  const st = selectionSummary(model, selected);
  const completable = new Set<string>();
  const clickable = new Set<StarId>();
  // completable: completing the whole constellation stays within budget (already-complete ones are trivially "completable").
  for (const c of model.constellations.values()) {
    const withCon = new Set(selected);
    for (const sid of c.starIds) withCon.add(sid);
    if (classifyForSelection(cons, table, selectionSummary(model, withCon), budget) === "reachable")
      completable.add(c.id);
  }
  // clickable: each not-selected star whose predecessors are all selected, if placing it keeps the selection reachable.
  for (const star of model.stars.values()) {
    if (selected.has(star.id)) continue;
    if (!star.predecessors.every((p) => selected.has(p))) continue;
    // A frontier star of a completable constellation is always clickable: the witness build that
    // completes that constellation also contains this star, so any prefix of it stays reachable.
    // This skips the resolver for most of the clickable pass (the dominant early-game cost).
    if (completable.has(star.constellationId)) {
      clickable.add(star.id);
      continue;
    }
    const withStar = new Set(selected);
    withStar.add(star.id);
    if (classifyForSelection(cons, table, selectionSummary(model, withStar), budget) === "reachable")
      clickable.add(star.id);
  }
  // panel: have = supply, need = target, needSource = started cons defining each color's max.
  const needSource = new Map<number, string[]>();
  for (let i = 0; i < 5; i++) {
    if (st.target[i] === 0) continue;
    const src: string[] = [];
    for (const conId of st.startedIds) {
      const c = model.constellations.get(conId)!;
      if ((vecOf(c.affinityRequired)[i] ?? 0) === st.target[i]) src.push(conId);
    }
    needSource.set(i, src);
  }
  return { completable, clickable, have: st.supply, need: st.target, needSource };
}
