// ABOUTME: Baseline-to-current transition orders for compare mode: a two-rung ladder (incremental
// ABOUTME: seeded replay with two-pass refund scheduling, else full-respec via the churn-minimized
// ABOUTME: from-scratch orders), every rung's output verified by the transition oracle before return.
import { peakToReach, buildOrderPath, INF } from "./reachability";
import type { ReachCon, Vec, CoverTable, BuildStep } from "./reachability";
import { verifyTransition, type TransStep } from "./orderLegality";

const CAP_MAX: Vec = [20, 8, 20, 10, 20]; // per-color affinity cap; keep in sync (see orderLegality)
const zero = (): Vec => [0, 0, 0, 0, 0];
const add = (g: Vec, x: Vec): Vec => [g[0] + x[0], g[1] + x[1], g[2] + x[2], g[3] + x[3], g[4] + x[4]];
const addCap = (g: Vec, x: Vec): Vec => g.map((n, i) => Math.min(n + x[i]!, CAP_MAX[i]!)) as Vec;
const maxV = (a: Vec, b: Vec): Vec => a.map((n, i) => Math.max(n, b[i]!)) as Vec;
const covers = (g: Vec, d: Vec): boolean => g.every((n, i) => n >= d[i]!);
const deficit = (req: Vec, grant: Vec): Vec => req.map((n, i) => Math.max(0, n - grant[i]!)) as Vec;
const reqSum = (c: ReachCon) => c.req[0] + c.req[1] + c.req[2] + c.req[3] + c.req[4];
const grantRatio = (c: ReachCon) => (c.grant[0] + c.grant[1] + c.grant[2] + c.grant[3] + c.grant[4]) / c.size;
const REPLAY_CAP = 300_000; // cold-path node cap for peakToReach (exact min subset, like buildOrderPath)

export type TransitionRung = "incremental" | "full-respec";

interface Delta {
  sharedFull: ReachCon[]; // same id, complete in both (grant counts throughout)
  baseOnly: ReachCon[]; // in base, absent from cur: must be refunded, usable as pre-paid scaffolds meanwhile
  curOnly: ReachCon[]; // in cur, absent from base: must be added
  resize: { con: ReachCon; from: number; to: number }[]; // same id, different star count
}

function diffBuilds(base: ReachCon[], cur: ReachCon[], conById: Map<string, ReachCon>): Delta {
  const b = new Map(base.map((c) => [c.id, c]));
  const c2 = new Map(cur.map((c) => [c.id, c]));
  const sharedFull: ReachCon[] = [];
  const baseOnly: ReachCon[] = [];
  const curOnly: ReachCon[] = [];
  const resize: Delta["resize"] = [];
  for (const [id, bc] of b) {
    const cc = c2.get(id);
    if (!cc) baseOnly.push(bc);
    else if (bc.size === cc.size) sharedFull.push(bc);
    else resize.push({ con: conById.get(id)!, from: bc.size, to: cc.size });
  }
  for (const [id, cc] of c2) if (!b.has(id)) curOnly.push(cc);
  return { sharedFull, baseOnly, curOnly, resize };
}

/** A member the add order places, from its baseline star count to its current one. */
interface PlaceEntry {
  con: ReachCon; // the FULL constellation (grant/req/size)
  from: number; // baseline star count (0 for a fresh or torn-down member)
  to: number; // current star count (== con.size when it completes)
  grants: boolean; // whether it reaches full size (its grant then joins the standing supply)
}

/**
 * The seeded replay for one ladder rung (the spike's subject; the oracle is its correctness authority).
 *
 * `kept` are the shared members standing throughout - their grants seed the permanent supply. `held` are
 * pre-paid scaffolds standing at step zero (baseline-only members). `toPlace` are the members to add
 * (current-only members, grow-resizes); shrink-resizes and spent held scaffolds leave via refunds the
 * backward pass schedules.
 *
 * FORWARD PASS: order `toPlace` by lowest requirement then grant density (seeded shuffles when the first
 * order does not fit, mirroring sampledConstruction). Replay it, and at each step ask peakToReach for the
 * minimal scaffold set that covers the standing deficit, with `base` = the PERMANENT supply only (kept +
 * placed members) so held scaffolds are candidates it can choose or drop. The pool is held-first, so
 * peakToReach's stable sort keeps a pre-paid baseline scaffold ahead of a fresh one of equal shape
 * (prefer-held). This records each step's need-set.
 *
 * BACKWARD PASS: a held scaffold refunds right after the LAST step whose need-set contains it (step zero
 * when never needed) - so a never-needed baseline member's points return up front and a still-useful one
 * is not churned. Every emitted step is validated against the same standing-state rule the oracle uses
 * (grants of complete members cover the max requirement of started ones, at the conservative mid-step),
 * and unsafe refunds are deferred until a later add makes them safe. If the two-pass schedule cannot place
 * a member under the cap (holding scaffolds longer costs budget), the rung retries with the EAGER schedule
 * (drop a scaffold the moment the need-set does, re-adding it if a later step needs it again) before
 * giving up. Returns oracle-shaped TransSteps, or null when no sampled order fits.
 */
function seededReplay(
  cons: ReachCon[],
  table: CoverTable,
  conById: Map<string, ReachCon>,
  delta: Delta,
  cap: number,
  tries: number,
): TransStep[] | null {
  const kept = delta.sharedFull;
  const grows = delta.resize.filter((r) => r.to > r.from);
  const shrinks = delta.resize.filter((r) => r.to < r.from);

  // Members added over time.
  const toPlace: PlaceEntry[] = [
    ...delta.curOnly.map((c) => ({ con: c, from: 0, to: c.size, grants: true })),
    ...grows.map((r) => ({ con: r.con, from: r.from, to: r.to, grants: r.to === r.con.size })),
  ];

  // Standing counts at each endpoint (drives from/to bookkeeping and the validity mirror).
  const baseCounts = new Map<string, number>();
  const curCounts = new Map<string, number>();
  for (const c of delta.sharedFull) {
    baseCounts.set(c.id, c.size);
    curCounts.set(c.id, c.size);
  }
  for (const c of delta.baseOnly) baseCounts.set(c.id, c.size);
  for (const c of delta.curOnly) curCounts.set(c.id, c.size);
  for (const r of delta.resize) {
    baseCounts.set(r.con.id, r.from);
    curCounts.set(r.con.id, r.to);
  }

  // Scaffold pool for peakToReach: baseline-only members first (prefer-held), then external scaffolds.
  const heldIds = new Set(delta.baseOnly.map((c) => c.id));
  const fresh = cons.filter((c) => !curCounts.has(c.id) && !baseCounts.has(c.id) && !heldIds.has(c.id));
  const pool = [...delta.baseOnly, ...fresh];

  // Refund targets for every transient support (what star count it must end at). Fresh scaffolds added
  // mid-replay register a target of 0 when placed.
  const refundTarget = new Map<string, number>();
  for (const c of delta.baseOnly) refundTarget.set(c.id, 0);
  for (const r of shrinks) refundTarget.set(r.con.id, r.to);

  let keptGrant: Vec = zero();
  for (const c of kept) keptGrant = addCap(keptGrant, c.grant);
  let seedMreq: Vec = zero();
  for (const c of kept) seedMreq = maxV(seedMreq, c.req);
  for (const r of delta.resize) seedMreq = maxV(seedMreq, r.con.req);

  // Forward pass: the per-step scaffold need-sets for one add order (null if a member cannot be supported).
  const forward = (order: PlaceEntry[]): ReachCon[][] | null => {
    let permGrant = keptGrant;
    let mreq = seedMreq;
    const needHistory: ReachCon[][] = [];
    for (const p of order) {
      mreq = maxV(mreq, p.con.req);
      const need: ReachCon[] = [];
      const sz = peakToReach(pool, table, deficit(mreq, permGrant), permGrant, REPLAY_CAP, {
        collect: need,
        preferSmall: true,
      });
      if (sz >= INF) return null;
      needHistory.push(need);
      if (p.grants) permGrant = addCap(permGrant, p.con.grant);
    }
    return needHistory;
  };

  // Emit steps for one add order under a refund policy (two-pass or eager). Every step is validated with
  // the oracle's standing-state rule, so a returned sequence is oracle-clean by construction.
  const emit = (order: PlaceEntry[], needHistory: ReachCon[][], eager: boolean): TransStep[] | null => {
    const standing = new Map(baseCounts);
    let running = [...standing.values()].reduce((a, b) => a + b, 0);
    const steps: TransStep[] = [];

    // Standing-state validity, mirroring verifyTransition.check: grants from COMPLETE members (excluding an
    // optional `pending` whose grant is not yet / no longer counted) must cover the max requirement of every
    // started member (including `pending`'s).
    const valid = (pending: string | null): boolean => {
      let grant = zero();
      let req = zero();
      for (const [id, n] of standing) {
        if (n <= 0) continue;
        const c = conById.get(id)!;
        req = maxV(req, c.req);
        if (n >= c.size && id !== pending) grant = add(grant, c.grant);
      }
      if (pending) {
        const pc = conById.get(pending);
        if (pc) req = maxV(req, pc.req);
      }
      return covers(grant, req);
    };
    const emitAdd = (id: string, to: number): boolean => {
      const from = standing.get(id) ?? 0;
      if (to <= from) return false;
      standing.set(id, to);
      if (!valid(id) || !valid(null) || running + (to - from) > cap) {
        if (from === 0) standing.delete(id);
        else standing.set(id, from);
        return false;
      }
      running += to - from;
      steps.push({ kind: "add", conId: id, from, to, heldAfter: running });
      return true;
    };
    const emitRefund = (id: string, to: number): boolean => {
      const from = standing.get(id) ?? 0;
      if (to >= from) return false;
      standing.set(id, to);
      if (!valid(id) || !valid(null)) {
        standing.set(id, from);
        return false;
      }
      running -= from - to;
      steps.push({ kind: "refund", conId: id, from, to, heldAfter: running });
      if (to === 0) standing.delete(id);
      return true;
    };

    const needIdSets = needHistory.map((ns) => new Set(ns.map((s) => s.id)));
    const lastUse = new Map<string, number>();
    for (let i = 0; i < needHistory.length; i++) for (const s of needHistory[i]!) lastUse.set(s.id, i);

    const pending = new Set<string>();
    const drain = () => {
      for (let progress = true; progress; ) {
        progress = false;
        for (const id of [...pending]) {
          const target = refundTarget.get(id) ?? 0;
          if ((standing.get(id) ?? 0) <= target) {
            pending.delete(id);
            continue;
          }
          if (emitRefund(id, target)) {
            pending.delete(id);
            progress = true;
          }
        }
      }
    };
    // Schedule (then safely drain) refunds for supports whose usefulness ends at step `i` (-1 = pre-add).
    const scheduleAndDrain = (i: number) => {
      const next = i + 1 < needIdSets.length ? needIdSets[i + 1]! : new Set<string>();
      for (const id of refundTarget.keys()) {
        if ((standing.get(id) ?? 0) <= (refundTarget.get(id) ?? 0)) continue;
        const done = eager ? !next.has(id) : i >= (lastUse.get(id) ?? -1);
        if (done) pending.add(id);
      }
      drain();
    };

    scheduleAndDrain(-1); // free never-needed baseline members up front
    for (let i = 0; i < order.length; i++) {
      for (const s of needHistory[i]!) {
        if ((standing.get(s.id) ?? 0) <= 0) {
          if (!emitAdd(s.id, s.size)) return null; // fresh scaffold / re-added held member
          if (!refundTarget.has(s.id)) refundTarget.set(s.id, 0);
        }
      }
      const p = order[i]!;
      if (p.to > (standing.get(p.con.id) ?? 0) && !emitAdd(p.con.id, p.to)) return null;
      scheduleAndDrain(i);
    }
    for (const id of refundTarget.keys()) pending.add(id);
    drain();

    if (standing.size !== curCounts.size) return null;
    for (const [id, n] of curCounts) if (standing.get(id) !== n) return null;
    return steps;
  };

  // Order candidates: the deterministic heuristic, then seeded shuffles (LCG seeded from sizes, like
  // sampledConstruction) - tried until one produces a valid two-pass or eager schedule.
  const heuristic = [...toPlace].sort((a, b) => reqSum(a.con) - reqSum(b.con) || grantRatio(b.con) - grantRatio(a.con));
  const orders: PlaceEntry[][] = [heuristic];
  let seed = (toPlace.reduce((a, p) => a + p.con.size, 0) * 2654435761 + toPlace.length * 40503) >>> 0 || 1;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let a = 0; a < tries; a++) {
    const o = [...heuristic];
    for (let i = o.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = o[i]!;
      o[i] = o[j]!;
      o[j] = tmp;
    }
    orders.push(o);
  }
  for (const order of orders) {
    const needHistory = forward(order);
    if (!needHistory) continue;
    const twoPass = emit(order, needHistory, false);
    if (twoPass) return twoPass;
    const eager = emit(order, needHistory, true);
    if (eager) return eager;
  }
  return null;
}

/** The incremental rung alone (exported so the offline harness can count per-rung rejections). */
export function incrementalTransition(
  cons: ReachCon[],
  table: CoverTable,
  base: ReachCon[],
  cur: ReachCon[],
  cap: number,
  tries = 16,
): TransStep[] | null {
  const conById = new Map(cons.map((c) => [c.id, c]));
  return seededReplay(cons, table, conById, diffBuilds(base, cur, conById), cap, tries);
}

/** Full respec: reverse of the baseline's own from-scratch order, then the current build's. Both
 *  are buildOrderPath's churn-minimized orders, inherited for free. */
export function teardownRebuild(
  cons: ReachCon[],
  table: CoverTable,
  base: ReachCon[],
  cur: ReachCon[],
  cap: number,
): TransStep[] | null {
  const down: BuildStep[] | null = buildOrderPath(cons, table, base, cap, 64);
  const up: BuildStep[] | null = buildOrderPath(cons, table, cur, cap, 64);
  if (!down || !up) return null;
  const steps: TransStep[] = [];
  let held = base.reduce((a, c) => a + c.size, 0);
  for (const s of [...down].reverse()) {
    const size = Math.abs(s.points);
    const wasAdd = s.kind === "complete" || s.kind === "scaffold-add";
    held += wasAdd ? -size : size;
    steps.push(
      wasAdd
        ? { kind: "refund", conId: s.conId, from: size, to: 0, heldAfter: held }
        : { kind: "add", conId: s.conId, from: 0, to: size, heldAfter: held },
    );
  }
  for (const s of up) {
    const size = Math.abs(s.points);
    const isAdd = s.kind === "complete" || s.kind === "scaffold-add";
    held += isAdd ? size : -size;
    steps.push(
      isAdd
        ? { kind: "add", conId: s.conId, from: 0, to: size, heldAfter: held }
        : { kind: "refund", conId: s.conId, from: size, to: 0, heldAfter: held },
    );
  }
  return steps;
}

/**
 * The state walk: a deterministic greedy over actual game states, from the baseline's standing
 * board toward the current build, one oracle-legal move at a time. Priorities each iteration:
 * (1) complete a target member, never-torn candidates before re-adds of torn ones, then the densest
 * contributor to the outstanding deficits per moved star, ties by id; (2) free points - refund any
 * standing constellation above its target count whose grant no outstanding deficit leans on,
 * zero-effective-grant members first, then the grant least useful to the remaining deficits, ties
 * by id; (3) add one scaffold from peakToReach's minimal
 * crossroads-biased set when it fits; (4) only when stuck, tear down a standing at-target member
 * (smallest legal first, ties by id, each torn at most once) - it rejoins the pool and move 1
 * re-adds it later. Bounded: total moved points may not exceed four times the theoretical minimum;
 * exceeding it, or having no legal move, returns null. The walk is a candidate, not an authority:
 * callers verify its output like any other.
 */
export function stateWalkTransition(
  cons: ReachCon[],
  table: CoverTable,
  base: ReachCon[],
  cur: ReachCon[],
  cap: number,
): TransStep[] | null {
  const conById = new Map(cons.map((c) => [c.id, c]));
  const want = new Map(cur.map((c) => [c.id, c.size]));
  const counts = new Map<string, number>(base.map((c) => [c.id, c.size]));
  const steps: TransStep[] = [];
  const tornOnce = new Set<string>();
  let running = [...counts.values()].reduce((a, b) => a + b, 0);
  let theoreticalMin = 0;
  for (const [id, n] of counts) theoreticalMin += Math.abs(n - (want.get(id) ?? 0));
  for (const [id, n] of want) if (!counts.has(id)) theoreticalMin += n;
  const budget = Math.max(theoreticalMin, 1) * 4;
  let movedTotal = 0;

  // The oracle's standing rule (capped, verdict-equivalent): complete grants cover every started
  // requirement, with `pending` counted as requirement but not grant (the mid-step point).
  const valid = (pending: string | null): boolean => {
    let grant = zero();
    let req = zero();
    for (const [id, n] of counts) {
      if (n <= 0) continue;
      const c = conById.get(id)!;
      req = maxV(req, c.req);
      if (n >= c.size && id !== pending) grant = addCap(grant, c.grant);
    }
    if (pending) {
      const pc = conById.get(pending);
      if (pc) req = maxV(req, pc.req);
    }
    return covers(grant, req);
  };
  const restore = (id: string, from: number): void => {
    if (from === 0) counts.delete(id);
    else counts.set(id, from);
  };
  // Would this move be legal? Mutates and restores; emit() re-applies for real.
  const probe = (kind: "add" | "refund", id: string, to: number): boolean => {
    const from = counts.get(id) ?? 0;
    if (kind === "add" ? to <= from : to >= from) return false;
    if (kind === "add" && running + (to - from) > cap) return false;
    counts.set(id, to);
    const ok = valid(id) && valid(null);
    restore(id, from);
    return ok;
  };
  const emit = (kind: "add" | "refund", id: string, to: number): void => {
    const from = counts.get(id) ?? 0;
    counts.set(id, to);
    running += to - from;
    movedTotal += Math.abs(to - from);
    steps.push({ kind, conId: id, from, to, heldAfter: running });
    if (to === 0) counts.delete(id);
  };
  const standingGrant = (excl: string | null = null): Vec => {
    let g = zero();
    for (const [id, n] of counts) {
      if (id === excl) continue;
      const c = conById.get(id)!;
      if (n >= c.size) g = addCap(g, c.grant);
    }
    return g;
  };
  // What the not-yet-at-target members still demand beyond the standing complete grants
  // (optionally pretending one standing member is gone, to ask whether it is load-bearing).
  const deficitVec = (excl: string | null = null): Vec => {
    const g = standingGrant(excl);
    const d = zero();
    for (const [id, size] of want) {
      if ((counts.get(id) ?? 0) === size) continue;
      const c = conById.get(id)!;
      for (let i = 0; i < 5; i++) d[i] = Math.max(d[i]!, Math.max(0, c.req[i]! - g[i]!));
    }
    return d;
  };
  const done = (): boolean => {
    if (counts.size !== want.size) return false;
    for (const [id, n] of want) if (counts.get(id) !== n) return false;
    return true;
  };
  const grantSum = (c: ReachCon) => c.grant[0] + c.grant[1] + c.grant[2] + c.grant[3] + c.grant[4];

  while (!done()) {
    if (movedTotal > budget) return null;
    const d = deficitVec();
    // 1. Complete a target member: never-torn candidates before re-adds of torn ones (re-adding
    // a just-torn member would recreate the state the teardown escaped), then densest deficit
    // contribution per moved star, ties by id.
    {
      let pick: string | null = null;
      let pickPts = 0;
      let pickDelta = 1;
      let pickTorn = 1;
      for (const [id, size] of want) {
        const at = counts.get(id) ?? 0;
        if (at >= size || !probe("add", id, size)) continue;
        const c = conById.get(id)!;
        let pts = 0;
        if (size === c.size) for (let i = 0; i < 5; i++) if (d[i]! > 0) pts += c.grant[i]!;
        const delta = size - at;
        const torn = tornOnce.has(id) ? 1 : 0;
        if (
          pick === null ||
          torn < pickTorn ||
          (torn === pickTorn &&
            (pts * pickDelta > pickPts * delta || (pts * pickDelta === pickPts * delta && id < pick)))
        ) {
          pick = id;
          pickPts = pts;
          pickDelta = delta;
          pickTorn = torn;
        }
      }
      if (pick !== null) {
        emit("add", pick, want.get(pick)!);
        continue;
      }
    }
    // 2. Free points: refund anything standing above its target whose grant no outstanding
    // deficit leans on (a load-bearing scaffold would only be re-bought; it waits until its
    // beneficiary completes and self-sustains). Zero-effective-grant members first (a partial
    // grants nothing, the Ghoul observation), then the grant least useful to the remaining
    // deficits, ties by id. Covers leftovers, spent scaffolds, and shrink-resizes alike
    // (refund toward target, not just to zero).
    {
      const cands: { id: string; free: number; useful: number }[] = [];
      for (const [id, n] of counts) {
        const target = want.get(id) ?? 0;
        if (n <= target || !probe("refund", id, target)) continue;
        const c = conById.get(id)!;
        const granting = n >= c.size; // only a complete member's grant is standing
        if (granting) {
          const dx = deficitVec(id);
          if (dx.some((x, i) => x > d[i]!)) continue; // load-bearing: not free
        }
        let useful = 0;
        if (granting) for (let i = 0; i < 5; i++) if (d[i]! > 0) useful += c.grant[i]!;
        cands.push({ id, free: granting && grantSum(c) > 0 ? 1 : 0, useful });
      }
      if (cands.length) {
        cands.sort((a, b) => a.free - b.free || a.useful - b.useful || (a.id < b.id ? -1 : 1));
        const r = cands[0]!;
        emit("refund", r.id, want.get(r.id) ?? 0);
        continue;
      }
    }
    // 3. Scaffold: one constellation from peakToReach's minimal set for the binding deficit.
    {
      const need: ReachCon[] = [];
      const pool = cons.filter((c) => !want.has(c.id) && (counts.get(c.id) ?? 0) === 0);
      const sz = peakToReach(pool, table, d, standingGrant(), REPLAY_CAP, {
        collect: need,
        preferSmall: true,
      });
      if (sz < INF && sz > 0) {
        let added = false;
        for (const s of need)
          if (probe("add", s.id, s.size)) {
            emit("add", s.id, s.size);
            added = true;
            break;
          }
        if (added) continue;
      }
    }
    // 4. Teardown, only when stuck: smallest legal at-target member, ties by id, each torn once.
    {
      const tearCands = [...counts.keys()]
        .filter((id) => {
          const t = want.get(id) ?? 0;
          return t > 0 && (counts.get(id) ?? 0) === t && !tornOnce.has(id);
        })
        .map((id) => conById.get(id)!)
        .sort((a, b) => a.size - b.size || (a.id < b.id ? -1 : 1));
      let torn = false;
      for (const c of tearCands)
        if (probe("refund", c.id, 0)) {
          emit("refund", c.id, 0);
          tornOnce.add(c.id);
          torn = true;
          break;
        }
      if (torn) continue;
    }
    return null; // no legal move of any kind: genuinely stuck
  }
  return steps;
}

/**
 * The two-rung escalation ladder: incremental, else full respec, each verified by the transition
 * oracle before return (verified or absent). The identity edge returns the empty transition only
 * when the build fits the cap; a base equal to cur but over cap is a none pair. Deterministic.
 */
export function transitionOrderPath(
  cons: ReachCon[],
  table: CoverTable,
  base: ReachCon[],
  cur: ReachCon[],
  cap: number,
  tries = 16,
): { steps: TransStep[]; rung: TransitionRung } | null {
  const conById = new Map(cons.map((c) => [c.id, c]));
  const delta = diffBuilds(base, cur, conById);
  if (!delta.baseOnly.length && !delta.curOnly.length && !delta.resize.length) {
    const size = cur.reduce((a, c) => a + c.size, 0);
    return size <= cap ? { steps: [], rung: "incremental" } : null;
  }
  const clean = (steps: TransStep[] | null) => steps && verifyTransition(cons, base, cur, steps, cap) === null;
  const s0 = seededReplay(cons, table, conById, delta, cap, tries);
  if (clean(s0)) return { steps: s0!, rung: "incremental" };
  const s2 = teardownRebuild(cons, table, base, cur, cap);
  if (clean(s2)) return { steps: s2!, rung: "full-respec" };
  return null;
}
