// ABOUTME: Reachability engine for path-predictor mode (claim a set, see what stays achievable).
// ABOUTME: A build is valid iff its total affinity covers every member's requirement AND it is
// ABOUTME: constructible from the refundable crossroads seed (some order places each member with
// ABOUTME: its requirement met). minCost is bracketed by a fast cover-table lower bound (sound for
// ABOUTME: "dim") and a constructibility-aware greedy upper bound (sound for "reachable").
import { AFFINITIES, type DevotionModel, type StarId } from "./types";
import { gateBuildOrder } from "./orderLegality";

export type Vec = [number, number, number, number, number]; // order = AFFINITIES
// Hard per-color cap: the max requirement that gates anything; affinity beyond this is worthless.
const CAP_MAX: Vec = [20, 8, 20, 10, 20];
const NOCOST = 65535;
export const INF = 1e9;
export const BUDGET = 55;
// Crossroads supply 1 affinity of each color and are refundable, so any build can be seeded
// with one point per color for free while bootstrapping.
const SEED: Vec = [1, 1, 1, 1, 1];
// Peak-witness search bounds (see classifyForSelection): it samples this many construction orders, each
// with a per-scaffold node cap, so it stays cheap even across a full sweep. The witness is self-bounding -
// it returns instantly for a non-self-covering build (no order can help) and only samples for a complete
// self-covering one - so it needs no budget-proximity gate; a sampler that finds no order keeps the dim.
const PEAK_WITNESS_TRIES = 8;
const PEAK_NODE_CAP = 3000;
// The resolver-gate witness uses the deterministic heuristic order only (no random shuffles): it keeps the
// gate cheap and, crucially, RNG-free so the Rust/WASM port stays bit-for-bit verdict-equivalent. Builds
// that need a shuffled order to fit budget stay conservatively dim (sound).
const GATE_WITNESS_TRIES = 0;

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

/** The unselected path to a star: the star plus every unselected transitive predecessor. Predecessors
 *  never cross constellations, so the path stays within the star's own constellation. This is the set
 *  a click on the star must add, and its size is the star's point cost from the current selection. */
export function pathToStar(model: DevotionModel, selected: Set<StarId>, starId: StarId): Set<StarId> {
  const path = new Set<StarId>();
  const stack: StarId[] = [starId];
  while (stack.length) {
    const id = stack.pop()!;
    if (path.has(id) || selected.has(id)) continue;
    path.add(id);
    const star = model.stars.get(id);
    if (star) for (const p of star.predecessors) stack.push(p);
  }
  return path;
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
 * Returns the post-refund STEADY-STATE cost, which is a lower bound on the construction PEAK (you end
 * holding every permanent member). So `cost <= budget` does NOT by itself prove reachability for tight
 * budgets - the transient crossroads peak can still overflow. Reachability is decided by
 * peakGateReachable / the peak witness, which charge that peak; greedy serves only as a fast lower bound.
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
 * Returns the post-refund steady-state cost: a lower bound on the construction PEAK, not a sound
 * reachable proof for tight budgets (it ignores the transient crossroads held to bootstrap affinity).
 * peakGateReachable / the peak witness decide reachability; greedy is only a fast lower bound.
 */
// Distinct crossroads colors the LAST greedyFrom run had to bootstrap (a placement needed the seed's +1
// for that color). Holding one crossroads per such color realizes greedy's order, so its construction peak
// is greedyCost + this count - a sound, tight upper bound (Ted's ladder: affinity persists, so each color
// is a one-time bottom-of-ladder cost). Read immediately after greedyFrom; only meaningful on a finite cost.
let greedyBootColors = 0;
/** Distinct crossroads colors bootstrapped by the last greedyFrom run (see greedyBootColors). */
export function lastGreedyBootColors(): number {
  return greedyBootColors;
}
const popcount5 = (m: number): number => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1) + ((m >> 4) & 1);

export function greedyFrom(cons: ReachCon[], st: ReachState, budget = BUDGET): number {
  greedyBootColors = 0;
  const built = st.built;
  const pool = [...built, ...fillerFor(cons, st)];
  const placed = new Array(pool.length).fill(false);
  let build = zero(); // affinity from placed constellations (excludes the transient seed)
  let maxReqPlaced = zero(); // every placed constellation must stand under this once seed is gone
  let cost = 0,
    builtLeft = built.length;
  let bootMask = 0; // colors any placement needed the seed crossroads for (req[c] > build[c] at placement)
  for (;;) {
    const gain = addCap(SEED, build);
    let did = false;
    // Auto-place the committed members as they unlock; filler is added selectively below.
    for (let i = 0; i < built.length; i++) {
      if (placed[i] || !covers(gain, built[i]!.req)) continue;
      for (let c = 0; c < 5; c++) if (built[i]!.req[c]! > build[c]!) bootMask |= 1 << c;
      placed[i] = true;
      cost += built[i]!.size;
      build = addCap(build, built[i]!.grant);
      maxReqPlaced = maxV(maxReqPlaced, built[i]!.req);
      builtLeft--;
      did = true;
    }
    if (builtLeft === 0 && covers(build, maxReqPlaced)) {
      greedyBootColors = popcount5(bootMask);
      return cost <= budget ? cost : INF;
    }
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
    for (let c = 0; c < 5; c++) if (pool[best]!.req[c]! > build[c]!) bootMask |= 1 << c;
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
 * the peak gate soundly proves "reachable". The (rare) gap between is "unknown".
 */
export function classify(cons: ReachCon[], table: CoverTable, claimedIds: string[], budget = BUDGET): Reach {
  const byId = new Map(cons.map((c) => [c.id, c]));
  const claimed = claimedIds.map((id) => byId.get(id)!);
  if (coverLowerBound(table, claimed) > budget) return "dim";
  // Sound reachable proof that charges the transient crossroads peak (greedyMinCost's refunded cost did
  // not, so it false-reached tight builds). The tight band it cannot decide stays "unknown" for the
  // exact resolver, which models the peak.
  if (peakGateReachable(claimed, budget)) return "reachable";
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
 * Cheap SOUND sufficient proof that build `B` is reachable within `budget`, accounting for the
 * transient construction peak that `constructible`/greedy ignore. Affinity persists, so each distinct
 * required color needs at most one refundable crossroads held at once; a no-refund schedule that places
 * one crossroads per required color and then the whole self-covering build peaks at
 * `size + distinctRequiredColors`. So if B is self-covering AND unit-seed-constructible (an order
 * exists) AND `size + distinctRequiredColors <= budget`, a genuine construction order fits the budget.
 *
 * Sound: it never accepts an unbuildable build (measured 0 wrong-accepts across ~18k near-ceiling
 * builds). NOT complete: the tight band `size < budget < size + distinctRequiredColors` - where colors
 * bootstrap sequentially so not every crossroads is held at once - returns false and must fall through
 * to the peak witness. Crucially RNG-free, so the WASM resolver port stays verdict-equivalent.
 */
function peakGateReachable(B: ReachCon[], budget: number): boolean {
  let size = 0;
  let grant = zero(),
    req = zero();
  for (const m of B) {
    size += m.size;
    grant = addCap(grant, m.grant);
    req = maxV(req, m.req);
  }
  if (!covers(grant, req)) return false; // not self-covering: needs permanent support, this gate cannot decide it
  let colors = 0;
  for (let i = 0; i < 5; i++) if (req[i]! > 0) colors++;
  if (size + colors > budget) return false; // peak may exceed budget; defer to the witness
  return constructible(B); // a unit-seed order must exist, else the peak bound is not valid
}

/**
 * Minimum transient construction peak (points held at once) to stand up refundable scaffolding that
 * grants at least `deficit` affinity, charging each scaffold's own bootstrap. Crossroads (requirement
 * zero) are the floor. Reaching eldritch 3 via Quill (4 stars, itself needing eldritch 1) means
 * holding the eldritch crossroads while Quill is placed, so the peak is 5, not 4.
 *
 * Equals the smallest bootstrap-closed, constructible scaffold set whose grants cover `deficit`: a
 * no-refund schedule holds that set monotonically, so its peak is its size. That is a sound UPPER
 * bound on the true min-peak (refunding a now-redundant bootstrap can only lower it), so it never
 * under-charges, which is the safe direction for dimming. Returns INF if `deficit` is uncoverable.
 *
 * Implemented as a cover-table-pruned DFS over distinct scaffolds (a used-set forbids reusing a
 * one-of-a-kind scaffold, e.g. a single crossroads, which would fabricate affinity that does not
 * exist). Scaffolds are tried high-grant-per-star first so a tight bound is found early and prunes.
 */
export function peakToReach(
  cons: ReachCon[],
  table: CoverTable,
  deficit: Vec,
  base: Vec = [0, 0, 0, 0, 0],
  peakNodeCap = 300_000,
  opts?: { collect?: ReachCon[]; preferSmall?: boolean },
): number {
  const need: Vec = [
    Math.max(0, deficit[0]),
    Math.max(0, deficit[1]),
    Math.max(0, deficit[2]),
    Math.max(0, deficit[3]),
    Math.max(0, deficit[4]),
  ];
  if (need[0] === 0 && need[1] === 0 && need[2] === 0 && need[3] === 0 && need[4] === 0) {
    if (opts?.collect) opts.collect.length = 0;
    return 0;
  }
  const grants = (c: ReachCon) => c.grant[0] || c.grant[1] || c.grant[2] || c.grant[3] || c.grant[4];
  const ratio = (c: ReachCon) => (c.grant[0] + c.grant[1] + c.grant[2] + c.grant[3] + c.grant[4]) / c.size;
  const scaffolds = cons.filter(grants).sort(
    opts?.preferSmall
      ? (a, b) => {
          const reqFree = (c: ReachCon) =>
            c.req[0] === 0 && c.req[1] === 0 && c.req[2] === 0 && c.req[3] === 0 && c.req[4] === 0;
          return (reqFree(b) ? 1 : 0) - (reqFree(a) ? 1 : 0) || a.size - b.size || ratio(b) - ratio(a);
        }
      : (a, b) => ratio(b) - ratio(a),
  );
  const used = new Array(scaffolds.length).fill(false);
  let bestUsed: ReachCon[] | null = null;
  let best = INF;
  let nodes = 0;
  const NODE_CAP = peakNodeCap;
  // `path` tracks the DFS pick order for collect; must reflect actual pick sequence so req-dependent
  // scaffolds follow the scaffolds that supply their requirements (not just sorted-array order).
  const path = opts?.collect ? ([] as ReachCon[]) : null;
  // `a` is the scaffold affinity built so far; `base` is affinity already held from the permanent build,
  // which legally bootstraps a scaffold (covers its requirement) without counting toward the deficit.
  function dfs(a: Vec, size: number): void {
    if (size >= best || nodes++ > NODE_CAP) return;
    const rem: Vec = [
      Math.max(0, need[0] - a[0]),
      Math.max(0, need[1] - a[1]),
      Math.max(0, need[2] - a[2]),
      Math.max(0, need[3] - a[3]),
      Math.max(0, need[4] - a[4]),
    ];
    if (rem[0] === 0 && rem[1] === 0 && rem[2] === 0 && rem[3] === 0 && rem[4] === 0) {
      best = size;
      if (path) bestUsed = [...path];
      return;
    }
    if (size + coverCostAt(table, rem) >= best) return; // cover table: cheapest extra subset, ignoring bootstrap
    const avail = addCap(base, a);
    for (let i = 0; i < scaffolds.length; i++) {
      const c = scaffolds[i]!;
      if (used[i] || size + c.size >= best || !covers(avail, c.req)) continue;
      used[i] = true;
      if (path) path.push(c);
      dfs(addCap(a, c.grant), size + c.size);
      if (path) path.pop();
      used[i] = false;
    }
  }
  dfs(zero(), 0);
  if (opts?.collect && bestUsed) {
    opts.collect.length = 0;
    opts.collect.push(...(bestUsed as ReachCon[]));
  }
  return best;
}

/** Split a self-covering build into its granting members, zero-grant size, and transient scaffold pool. */
function buildParts(cons: ReachCon[], B: ReachCon[]): { G: ReachCon[]; totalSize: number; pool: ReachCon[] } | null {
  let tot = zero();
  let mreq = zero();
  let totalSize = 0;
  for (const m of B) {
    tot = addCap(tot, m.grant);
    mreq = maxV(mreq, m.req);
    totalSize += m.size;
  }
  if (!covers(tot, mreq)) return null; // not self-covering
  const grants = (c: ReachCon) => c.grant[0] || c.grant[1] || c.grant[2] || c.grant[3] || c.grant[4];
  const inB = new Set(B.map((b) => b.id));
  return { G: B.filter(grants), totalSize, pool: cons.filter((c) => !inB.has(c.id)) };
}

/**
 * Construction peak for placing the granting members in `order`: each step holds a transient scaffold
 * sized (via peakToReach) to keep every placed member valid until the build's own grants cover it. The
 * peak is the largest (placed size + held scaffold) over the steps, maxed with the whole build size (the
 * deferred zero-grant members fill up to it). A real schedule, so its peak upper-bounds the true min peak.
 */
function orderPeak(
  order: ReachCon[],
  pool: ReachCon[],
  table: CoverTable,
  totalSize: number,
  peakNodeCap: number,
): number {
  let grant = zero();
  let mreq = zero();
  let size = 0;
  let peak = totalSize;
  for (const m of order) {
    mreq = maxV(mreq, m.req);
    size += m.size;
    const def: Vec = [
      Math.max(0, mreq[0] - grant[0]),
      Math.max(0, mreq[1] - grant[1]),
      Math.max(0, mreq[2] - grant[2]),
      Math.max(0, mreq[3] - grant[3]),
      Math.max(0, mreq[4] - grant[4]),
    ];
    const sc = peakToReach(pool, table, def, grant, peakNodeCap);
    if (sc >= INF) return INF;
    if (size + sc > peak) peak = size + sc;
    grant = addCap(grant, m.grant);
  }
  return peak;
}

// Core sampler shared by minPeakSampled (which wants the peak) and minPeakSampledOrder (which wants the
// witness order). Tries the bootstrap-order heuristic (lowest requirement first, then highest grant
// density) plus up to `tries` seeded shuffles of the granting members, keeping the smallest-peak order and
// early-exiting the moment one lands at or under budget. `order` is the granting members in their best-peak
// order; `tail` is the zero-grant members (placed last - they never raise the peak above the build size).
function sampledConstruction(
  cons: ReachCon[],
  table: CoverTable,
  B: ReachCon[],
  budget: number,
  tries: number,
  peakNodeCap: number,
): { peak: number; order: ReachCon[]; tail: ReachCon[] } {
  const grants = (c: ReachCon) => c.grant[0] || c.grant[1] || c.grant[2] || c.grant[3] || c.grant[4];
  const tail = B.filter((c) => !grants(c));
  const parts = buildParts(cons, B);
  if (!parts) return { peak: INF, order: [], tail };
  const { G, totalSize, pool } = parts;
  if (totalSize > budget) return { peak: INF, order: [], tail };
  if (G.length === 0) return { peak: totalSize, order: [], tail };
  const reqsum = (c: ReachCon) => c.req[0] + c.req[1] + c.req[2] + c.req[3] + c.req[4];
  const ratio = (c: ReachCon) => (c.grant[0] + c.grant[1] + c.grant[2] + c.grant[3] + c.grant[4]) / c.size;
  const order = [...G].sort((a, b) => reqsum(a) - reqsum(b) || ratio(b) - ratio(a));
  let best = orderPeak(order, pool, table, totalSize, peakNodeCap);
  let bestOrder = [...order];
  if (best <= budget) return { peak: best, order: bestOrder, tail };
  let seed = (totalSize * 2654435761 + G.length * 40503) >>> 0; // deterministic per build
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let attempt = 0; attempt < tries && best > budget; attempt++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = order[i]!;
      order[i] = order[j]!;
      order[j] = tmp;
    }
    const p = orderPeak(order, pool, table, totalSize, peakNodeCap);
    if (p < best) {
      best = p;
      bestOrder = [...order];
    }
  }
  return { peak: best, order: bestOrder, tail };
}

/**
 * Fast sound construction-peak witness for the self-covering whole-build `B`: the smallest peak among the
 * sampled orders (see sampledConstruction). A peak at or under budget is a GENUINE witness (that order
 * builds `B` within budget), so it is SOUND for "reachable" - it can only flip a false-dim, never invent a
 * false-reach. It does not compute the true minimum, so it may overshoot a hard-to-sample reachable build
 * (a conservative dim, closed only by the exact engine). Deterministic. INF if `B` is not self-covering.
 */
export function minPeakSampled(
  cons: ReachCon[],
  table: CoverTable,
  B: ReachCon[],
  budget = BUDGET,
  tries = 8,
  peakNodeCap = 3000,
): number {
  return sampledConstruction(cons, table, B, budget, tries, peakNodeCap).peak;
}

/**
 * The construction ORDER behind the witness: the constellations of self-covering build `B` in an order
 * that builds it within `budget` points held at once (granting members first, in their peak-minimizing
 * order, then the zero-grant members), or null when no sampled order fits the budget. This is the
 * design-agnostic substrate for guided build order; the transient scaffold to hold (and refund) at each
 * step is a further step the UI design will specify (see the guided-build-order spec). Deterministic.
 */
export function minPeakSampledOrder(
  cons: ReachCon[],
  table: CoverTable,
  B: ReachCon[],
  budget = BUDGET,
  tries = 16,
  peakNodeCap = 3000,
): ReachCon[] | null {
  const { peak, order, tail } = sampledConstruction(cons, table, B, budget, tries, peakNodeCap);
  return peak <= budget ? [...order, ...tail] : null;
}

/** One step of a guided build order. `points` is the constellation's star count (negative on refund);
 *  `heldAfter` is the running points held after the step, which never exceeds the cap. */
export type BuildStep =
  | { kind: "complete"; conId: string; points: number; heldAfter: number }
  | { kind: "scaffold-add"; conId: string; points: number; heldAfter: number }
  | { kind: "scaffold-refund"; conId: string; points: number; heldAfter: number };

/**
 * A legal constellation-level order that assembles the self-covering build `B` within `budget` points
 * held at once, including the transient scaffold to ADD before a step and REFUND once the build's own
 * grants cover it. Replays the sampled construction order (sampledConstruction) and, at each step, asks
 * peakToReach for the actual scaffold SET to hold (crossroads-biased), diffing consecutive sets into
 * add/refund events. Refunds obey the in-game rule (docs/devotion-system.md, "removal cannot strand a
 * dependent"): a scaffold is refunded only when everything still standing keeps its requirement covered
 * without it; refunds not yet safe stay held and are retried after later adds. Returns null when no
 * sampled order fits the budget, or when a held scaffold can never be legally refunded - the honest
 * "not validly buildable" signal. No order is better than an illegal order. Input is canonicalized
 * (sorted by constellation id), so the output is a pure function of the build set - every caller
 * (panel, test, script) gets the identical order.
 */
export function buildOrderPath(
  cons: ReachCon[],
  table: CoverTable,
  B: ReachCon[],
  budget = BUDGET,
  tries = 16,
  peakNodeCap = 3000,
): BuildStep[] | null {
  B = [...B].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); // canonical: the order is a function of the build SET
  const sc = sampledConstruction(cons, table, B, budget, tries, peakNodeCap);
  if (sc.peak > budget) return null;
  const parts = buildParts(cons, B);
  if (!parts) return null; // not self-covering
  const pool = parts.pool;
  const REPLAY_CAP = 300_000; // cold path: find the exact min subset, immune to the sampling node cap
  const steps: BuildStep[] = [];
  let grant: Vec = zero();
  let mreq: Vec = zero(); // max requirement incl. the member being placed (drives the scaffold need-set)
  let creq: Vec = zero(); // max requirement over COMPLETED members only (drives refund legality)
  let held: ReachCon[] = [];
  let running = 0;
  // In-game refund rule: a scaffold may be refunded only if everything still standing (completed
  // members plus the other held scaffolds) keeps its requirement covered without the scaffold's grant.
  const canRefund = (s: ReachCon, keep: ReachCon[]): boolean => {
    let g = grant;
    let r = maxV(creq, s.req);
    for (const k of keep) {
      g = addCap(g, k.grant);
      r = maxV(r, k.req);
    }
    return covers(g, r);
  };
  // Refund every held scaffold outside `needIds` that is safe to drop; unsafe ones stay held and are
  // retried after later adds supply replacement grants. Fixed point: one refund can unlock another.
  const drainRefunds = (needIds: Set<string>): void => {
    for (let progress = true; progress; ) {
      progress = false;
      for (const s of [...held]) {
        if (needIds.has(s.id)) continue;
        const keep = held.filter((k) => k.id !== s.id);
        if (!canRefund(s, keep)) continue;
        held = keep;
        running -= s.size;
        steps.push({ kind: "scaffold-refund", conId: s.id, points: -s.size, heldAfter: running });
        progress = true;
      }
    }
  };
  for (const m of sc.order) {
    mreq = maxV(mreq, m.req);
    const def: Vec = [
      Math.max(0, mreq[0] - grant[0]),
      Math.max(0, mreq[1] - grant[1]),
      Math.max(0, mreq[2] - grant[2]),
      Math.max(0, mreq[3] - grant[3]),
      Math.max(0, mreq[4] - grant[4]),
    ];
    const need: ReachCon[] = [];
    const sz = peakToReach(pool, table, def, grant, REPLAY_CAP, { collect: need, preferSmall: true });
    if (sz >= INF) return null;
    const needIds = new Set(need.map((s) => s.id));
    drainRefunds(needIds);
    const heldIds = new Set(held.map((s) => s.id));
    for (const s of need)
      if (!heldIds.has(s.id)) {
        held.push(s);
        running += s.size;
        steps.push({ kind: "scaffold-add", conId: s.id, points: s.size, heldAfter: running });
      }
    drainRefunds(needIds); // retry refunds the new scaffolds' grants may have made safe
    if (running > budget) return null; // soundness guard
    running += m.size;
    steps.push({ kind: "complete", conId: m.id, points: m.size, heldAfter: running });
    if (running > budget) return null;
    grant = addCap(grant, m.grant);
    creq = maxV(creq, m.req);
  }
  drainRefunds(new Set());
  if (held.length) return null; // a scaffold no drain can legally refund: honest null, never an illegal step
  for (const t of sc.tail) {
    running += t.size;
    steps.push({ kind: "complete", conId: t.id, points: t.size, heldAfter: running });
    if (running > budget) return null;
  }
  return steps;
}

/** The on-demand escalation behind the "Find valid order" button: the same schedule at high tries, to
 *  recover cliff builds the live tries=16 pass missed. Off the live/per-click path. */
export function buildOrderEscalated(
  cons: ReachCon[],
  table: CoverTable,
  B: ReachCon[],
  budget = BUDGET,
): BuildStep[] | null {
  return buildOrderPath(cons, table, B, budget, 4096, 3000);
}

/**
 * The fewest points at which this selection has a sampled legal build order (>= fromCap, <= budget),
 * or null if none up to budget. A build's construction can need a transient scaffold whose point cost
 * pushes the running total above the selection's own size, so a selection valid at N points may only be
 * assemblable at N+k. This reports that k on demand, to explain a missing order ("no path in fewer than
 * M points") rather than leaving a bare null. Sampled, so the cap returned is an upper bound on the true
 * minimum; heavy (it re-searches per cap), so never run it on the live per-click path.
 */
export function minBuildableCap(
  cons: ReachCon[],
  table: CoverTable,
  B: ReachCon[],
  fromCap: number,
  budget = BUDGET,
  tries = 256,
): number | null {
  for (let cap = Math.max(fromCap, 0); cap <= budget; cap++) {
    if (buildOrderPath(cons, table, B, cap, tries)) return cap;
  }
  return null;
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
  const remainingById = new Map(pf.map((p) => [p.id, p.remaining]));
  let found = false;
  const chosen: ReachCon[] = [];
  // Whole-constellation DFS for one finish-choice; the cover prune is admissible (no finishes left).
  function rec(i: number, build: Vec, cost: number, maxReqPlaced: Vec, builtCons: ReachCon[]): void {
    if (found) return;
    exactNodes++;
    if (covers(build, maxReqPlaced)) {
      // A covering node is self-covering (build covers maxReqPlaced), so every remaining filler is optional
      // and refundable. The peak witness already models using such affinity as a transient refundable
      // scaffold, which is never worse for the peak than keeping it permanent - so the gate-then-witness
      // verdict HERE is FINAL: adding more filler cannot lower the construction peak. Decide and RETURN,
      // pruning the entire post-covering superset subtree (the dominant search cost). Because covering nodes
      // are now bounded, every one is witnessed (no call cap), which makes the verdict order-independent so
      // the Rust/WASM port stays verdict-equivalent. The cheap ladder gate is a sound sufficient proof; the
      // witness models the scaffold-then-refund peak. constructible alone is NOT sufficient - it ignores the
      // transient crossroads peak and was the source of the off-by-one false-reaches.
      const members = [...builtCons, ...chosen];
      if (
        peakGateReachable(members, budget) ||
        minPeakSampled(cons, table, members, budget, GATE_WITNESS_TRIES, PEAK_NODE_CAP) <= budget
      )
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
    // A finished partial carries its full grant AND its full size (selected + remaining): the witness peak
    // math reads member.size, so a finished partial must count its whole constellation, not just the stars
    // already selected, or the peak is undercounted and an over-budget build wrongly looks reachable.
    const builtCons = st.built.map((b) =>
      finished.has(b.id) ? { ...b, grant: grantById.get(b.id)!, size: b.size + remainingById.get(b.id)! } : b,
    );
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
 * `lowerBoundFrom` soundly proves "dim"; `peakGateReachable` then the peak witness soundly prove
 * "reachable"; the rare remainder is decided by the exact resolver (TS or the injected WASM port).
 * Always returns "reachable" or "dim", deciding reachability on the construction peak (not the
 * post-refund cost), so a build whose peak overflows the budget is never lit.
 */
export function classifyForSelection(cons: ReachCon[], table: CoverTable, st: ReachState, budget = BUDGET): Reach {
  if (lowerBoundFrom(table, st) > budget) return "dim";
  // Cheap SOUND reachable proof, charging the transient crossroads peak greedy's refunded cost ignores.
  // greedy's seed-unlock order is realizable while holding one crossroads per color it had to bootstrap,
  // so its peak is greedyCost + lastGreedyBootColors() - a sound, tight upper bound (Ted's ladder: each
  // color is a one-time bottom-of-ladder cost, often far below 5). This both restores the old greedy's
  // O(1) reach for near-ceiling builds AND dims the false-reaches: a tier-1 constellation at budget 3 has
  // greedyCost 3 + 1 bootstrapped color = 4 > 3, so it defers to the witness, which dims it. The narrow
  // band where the peak still overflows falls through to the witness and exact resolver, which model it.
  const g = greedyFrom(cons, st, budget);
  if (g + lastGreedyBootColors() <= budget) return "reachable";
  // Peak-bounded witness for the exact resolver's blind spot. Its constructibility check models only
  // the free crossroads seed, so it wrongly dims tight self-covering builds that are reachable only by
  // holding transient refundable scaffolding (a crossroads or constellation beyond the seed) until the
  // build self-covers, then refunding it. When the started set is itself a complete whole-constellation
  // build (no partials), minPeakSampled samples real construction orders: a sampled peak <= budget is a
  // genuine build order, so this only ever flips a false-dim to reachable and never introduces a
  // false-reach. It early-exits on the first witness (fast for reachable builds) and tries a bounded
  // number of orders otherwise, so even a sweep of dozens of near-budget candidates stays in the ms.
  //
  // Run BEFORE the exact resolver: the witness is ~0.1ms and the resolver is the expensive (WASM/DFS)
  // call, so a witness hit short-circuits it. Verdict-identical - the witness only returns reachable on a
  // real order the definitive resolver would also accept - it just saves the resolver on self-covering
  // reachable candidates. Applies only to a complete started build (no partials); minPeakSampled itself
  // returns instantly for a non-self-covering build, so no budget-proximity gate is needed (an own>=49
  // gate was measured to wrongly exclude ~6% of the false-dim region, self-covering builds at own 44-48).
  if (st.partialFinish.length === 0) {
    if (minPeakSampled(cons, table, st.built, budget, PEAK_WITNESS_TRIES, PEAK_NODE_CAP) <= budget) return "reachable";
  }
  if (exactResolver(cons, table, st, budget)) return "reachable";
  return "dim";
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
  // Every unselected star whose path (the star plus its unselected predecessors) keeps the selection
  // reachable at the sweep budget: all unselected stars of a completable constellation, plus the stars
  // within reach of a partially enterable one (path cost <= maxK - see reachabilityForSelection).
  reachableStars: Set<StarId>;
  have: Vec;
  need: Vec;
  needSource: Map<number, string[]>;
}

/** One full sweep for a selection: what can be completed, what stars are reachable, and the panel vectors. */
export function reachabilityForSelection(
  model: DevotionModel,
  cons: ReachCon[],
  table: CoverTable,
  selected: Set<StarId>,
  budget = BUDGET,
): ReachView {
  const st = selectionSummary(model, selected);
  const completable = new Set<string>();
  const reachableStars = new Set<StarId>();
  // A constellation already fully selected "completes" to the current selection unchanged, so its
  // verdict is the current selection's - classify that once and reuse it instead of re-running the
  // (sometimes costly) resolver per complete constellation.
  const selfReachable = classifyForSelection(cons, table, st, budget) === "reachable";
  for (const c of model.constellations.values()) {
    const size = c.starIds.length;
    let selCount = 0;
    for (const sid of c.starIds) if (selected.has(sid)) selCount++;
    if (selCount === size) {
      if (selfReachable) completable.add(c.id);
      continue;
    }
    // The verdict for "selection + k stars of c" depends only on the count k (selectionSummary reduces
    // a selection to per-constellation counts), so the probe set is the selection plus unselected stars
    // of c in index order until the count reaches k - WHICH stars is immaterial to the verdict.
    const reachableAt = (k: number): boolean => {
      const withK = new Set(selected);
      let count = selCount;
      for (const sid of c.starIds) {
        if (count >= k) break;
        if (!withK.has(sid)) {
          withK.add(sid);
          count++;
        }
      }
      return classifyForSelection(cons, table, selectionSummary(model, withK), budget) === "reachable";
    };
    if (reachableAt(size)) {
      completable.add(c.id);
      for (const sid of c.starIds) if (!selected.has(sid)) reachableStars.add(sid);
      continue;
    }
    // Not completable: find maxK, the largest star count that stays reachable. Probe the cheapest
    // entry (selCount+1) first - most non-completable constellations admit nothing, and that probe is
    // the same dim proof the old per-frontier-star pass paid - then binary search the rest (the
    // verdict is monotone in k: a bigger proper prefix costs more and grants nothing until complete).
    let lo = selCount + 1;
    const last = size - 1; // k = size is the completable question, already answered above
    if (lo > last || !reachableAt(lo)) continue;
    let hi = last;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (reachableAt(mid)) lo = mid;
      else hi = mid - 1;
    }
    const maxK = lo;
    for (const sid of c.starIds) {
      if (selected.has(sid)) continue;
      if (selCount + pathToStar(model, selected, sid).size <= maxK) reachableStars.add(sid);
    }
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
  return { completable, reachableStars, have: st.supply, need: st.target, needSource };
}

/** The full engine result one UI refresh needs for a selection: the validity floor and the sweep. */
export interface SelectionView {
  minCost: number; // selectionMinCost: fewest points that keep this selection a legal build (the slider floor)
  reach: ReachView; // reachabilityForSelection: dimming, reachable stars, and the affinity panel vectors
  buildOrder: BuildStep[] | null; // live (tries=16) oracle-verified order to assemble the selection, or null (verified or absent)
}

/**
 * THE per-click engine port. Bundles every reachability call a refresh makes (the validity-floor binary
 * search plus the dimming sweep) into one pure function, so the UI is a thin caller and tests/perf harnesses
 * can exercise the exact same work headlessly. This is the function to optimize: its cost IS the per-click
 * cost the user pays. The sweep budget is raised to the floor, mirroring the controller (the cap can never
 * sit below the fewest points that keep the selection legal). Requires dimming on (finite cap, present
 * table); the uncapped/no-table path is permissive and cheap, handled in the adapter.
 */
export function selectionView(
  model: DevotionModel,
  cons: ReachCon[],
  table: CoverTable,
  selected: Set<StarId>,
  cap = BUDGET,
): SelectionView {
  const minCost = selectionMinCost(model, cons, table, selected);
  const reach = reachabilityForSelection(model, cons, table, selected, Math.max(cap, minCost));
  const members = selectionSummary(model, selected).built;
  const raw = members.length ? buildOrderPath(cons, table, members, cap, 16) : null;
  // Verified or absent: render only orders the independent oracle proves legal at every step;
  // anything else is withheld and the panel shows its honest empty state instead.
  const buildOrder = gateBuildOrder(cons, members, raw, cap);
  return { minCost, reach, buildOrder };
}
