// ABOUTME: Offline generators for reachable-build test fixtures: grow user-like self-covering builds,
// ABOUTME: and prove a target build reachable by constructing it (scaffold, place, refund) within budget.
import type { ReachCon, Vec } from "../../src/core/reachability";
import type { Counts } from "./reach-oracle";

export type ReachableCase = { label: string; sel: Record<string, number> };

const zero = (): Vec => [0, 0, 0, 0, 0];
const covers = (g: number[], d: number[]) => g.every((v, i) => v >= d[i]!);

function affinity(cnt: Counts, cons: ReachCon[]): Vec {
  const a = zero();
  for (let i = 0; i < cons.length; i++)
    if (cnt[i] === cons[i]!.size) for (let j = 0; j < 5; j++) a[j]! += cons[i]!.grant[j]!;
  return a;
}
// Removing one star from constellation i: a partial constellation keeps its (zero) affinity and stays
// valid; a complete one drops its grant, so recheck every started constellation against the reduced
// affinity. Returns whether the removal keeps the state valid.
function removable(cnt: Counts, aff: Vec, cons: ReachCon[], i: number): boolean {
  if (cnt[i]! === 0) return false;
  if (cnt[i]! < cons[i]!.size) return true;
  const newAff = aff.map((v, j) => v - cons[i]!.grant[j]!);
  for (let j = 0; j < cons.length; j++) if (cnt[j]! > 0 && !covers(newAff, cons[j]!.req)) return false;
  return true;
}

// Grow a user-like self-covering build: seed with a few random constellations, then repeatedly add a
// granter for the largest affinity deficit until every member's requirement is covered, padding toward
// budget. Returns the build (counts) if self-covering and near budget, else null. This mimics how a
// player assembles a target set (pick desirable constellations, satisfy their affinity), which is the
// space where false-dims are common.
export function genSelfCovering(cons: ReachCon[], budget: number, rng: () => number, minSize = 44): Counts | null {
  const c: Counts = cons.map(() => 0);
  const total = () => c.reduce((a, b) => a + b, 0);
  const addCon = (i: number) => {
    if (c[i]! === 0 && total() + cons[i]!.size <= budget) c[i] = cons[i]!.size;
  };
  const maxReqOf = () => {
    const m = [0, 0, 0, 0, 0];
    for (let i = 0; i < cons.length; i++)
      if (c[i]! > 0) for (let j = 0; j < 5; j++) m[j] = Math.max(m[j]!, cons[i]!.req[j]!);
    return m;
  };
  for (let n = 0; n < 1 + Math.floor(rng() * 3); n++) addCon(Math.floor(rng() * cons.length));
  for (let it = 0; it < 60; it++) {
    const a = affinity(c, cons);
    const maxReq = maxReqOf();
    const def = maxReq.map((v, j) => Math.max(0, v - a[j]!));
    if (def.every((d) => d === 0)) {
      if (total() >= minSize) return c.slice();
      const pad = cons.map((_, i) => i).filter((i) => c[i]! === 0 && total() + cons[i]!.size <= budget);
      if (!pad.length) return total() >= minSize ? c.slice() : null;
      addCon(pad[Math.floor(rng() * pad.length)]!);
      continue;
    }
    let col = 0;
    for (let j = 1; j < 5; j++) if (def[j]! > def[col]!) col = j;
    const g = cons
      .map((_, i) => i)
      .filter((i) => c[i]! === 0 && cons[i]!.grant[col]! > 0 && total() + cons[i]!.size <= budget);
    if (!g.length) break;
    addCon(g[Math.floor(rng() * g.length)]!);
  }
  const a = affinity(c, cons);
  const maxReq = maxReqOf();
  return maxReq.every((v, j) => a[j]! >= v) && total() >= minSize ? c.slice() : null;
}

// Greedily add the not-in-target constellation that best closes the affinity deficit blocking the
// remaining target members (per star), if it is startable now and fits the budget. Crossroads and
// net-positive scaffolds are the usual picks. Returns whether one was added.
function addScaffold(cons: ReachCon[], cur: Counts, target: Counts, budget: number): boolean {
  const a = affinity(cur, cons);
  const deficit = [0, 0, 0, 0, 0];
  for (let i = 0; i < cons.length; i++) {
    if (cur[i]! < target[i]! && cur[i]! === 0 && !covers(a, cons[i]!.req))
      for (let j = 0; j < 5; j++) deficit[j] = Math.max(deficit[j]!, cons[i]!.req[j]! - a[j]!);
  }
  if (deficit.every((d) => d <= 0)) return false;
  const total = cur.reduce((x, y) => x + y, 0);
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < cons.length; i++) {
    if (target[i]! > 0 || cur[i]! > 0 || !covers(a, cons[i]!.req) || total + cons[i]!.size > budget) continue;
    let red = 0;
    for (let j = 0; j < 5; j++) red += Math.min(cons[i]!.grant[j]!, deficit[j]!);
    if (red <= 0) continue;
    const sc = red / cons[i]!.size;
    if (sc > bestScore) {
      bestScore = sc;
      best = i;
    }
  }
  if (best < 0) return false;
  cur[best] = cons[best]!.size;
  return true;
}

// Try to construct `target` (a per-constellation star-count vector, typically a self-covering whole
// build) via a legal add/remove/refund walk within budget: place target members as they unlock, add
// scaffolds to break affinity deficits, refund redundant scaffolds to stay under budget, and at the end
// shed every scaffold so the state equals `target`. A true result is a real construction witness, so
// `target` is reachable (ground truth). Sound for "reachable"; a false result is inconclusive (the
// greedy may have picked a bad order), so use it only to CONFIRM reachability.
export function constructReachable(cons: ReachCon[], target: Counts, budget = 55): boolean {
  const cur: Counts = cons.map(() => 0);
  const total = () => cur.reduce((a, b) => a + b, 0);
  const refundRedundant = (): boolean => {
    let any = false;
    for (let pass = 0; pass < cons.length; pass++) {
      const a = affinity(cur, cons);
      let did = false;
      for (let i = 0; i < cons.length; i++) {
        if (cur[i]! > target[i]! && cur[i]! === cons[i]!.size && removable(cur, a, cons, i)) {
          cur[i] = target[i]!;
          did = true;
          any = true;
        }
      }
      if (!did) break;
    }
    return any;
  };
  for (let iter = 0; iter < 800; iter++) {
    const a = affinity(cur, cons);
    let progress = false;
    for (let i = 0; i < cons.length; i++) {
      if (cur[i]! >= target[i]!) continue;
      if (cur[i]! === 0 && !covers(a, cons[i]!.req)) continue; // blocked: needs more affinity
      while (cur[i]! < target[i]! && total() < budget) {
        cur[i]!++;
        progress = true;
      }
    }
    if (cur.every((v, i) => v >= target[i]!)) {
      refundRedundant();
      return cur.every((v, i) => v === target[i]!);
    }
    if (progress) continue;
    if (refundRedundant()) continue;
    if (!addScaffold(cons, cur, target, budget)) return false;
  }
  return false;
}
