// ABOUTME: Exhaustive BFS reachability oracle over the real add/remove/refund game rules.
// ABOUTME: Ground truth for the reachability engine tests; shares no code with the engine.
import type { ReachCon, ReachState, Vec } from "../../src/core/reachability";

export type Counts = number[];
const zero = (): Vec => [0, 0, 0, 0, 0];
const covers = (g: number[], d: number[]) => g.every((v, i) => v >= d[i]!);
const addV = (a: number[], b: number[]) => a.map((v, i) => v + b[i]!) as Vec;
const maxV = (a: number[], b: number[]) => a.map((v, i) => Math.max(v, b[i]!)) as Vec;

// Bridge a per-constellation star-count vector to the engine's ReachState, mirroring selectionSummary:
// completed members carry their grant, partials carry their selected size with zero grant, and granting
// partials are listed as partialFinish. Shared by the oracle-match and walk-fuzzer tests.
export function stateFromCounts(S: Counts, cons: ReachCon[]): ReachState {
  let supply = zero();
  let target = zero();
  let own = 0;
  const startedIds = new Set<string>();
  const partialFinish: ReachState["partialFinish"] = [];
  const built: ReachCon[] = [];
  for (let i = 0; i < cons.length; i++) {
    if (S[i]! === 0) continue;
    const c = cons[i]!;
    own += S[i]!;
    startedIds.add(c.id);
    target = maxV(target, c.req);
    if (S[i]! === c.size) {
      supply = addV(supply, c.grant);
      built.push({ id: c.id, size: c.size, req: c.req, grant: c.grant });
    } else {
      built.push({ id: c.id, size: S[i]!, req: c.req, grant: zero() });
      if (c.grant.some((x) => x > 0))
        partialFinish.push({ id: c.id, remaining: c.size - S[i]!, grant: c.grant, req: c.req });
    }
  }
  return { own, supply, target, startedIds, partialFinish, built };
}

export function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const affinityOf = (cnt: Counts, cons: ReachCon[]): Vec => {
  let a = zero();
  for (let i = 0; i < cons.length; i++) if (cnt[i] === cons[i]!.size) a = addV(a, cons[i]!.grant);
  return a;
};
const validState = (cnt: Counts, cons: ReachCon[]): boolean => {
  const aff = affinityOf(cnt, cons);
  for (let i = 0; i < cons.length; i++) if (cnt[i]! > 0 && !covers(aff, cons[i]!.req)) return false;
  return true;
};
const key = (cnt: Counts) => cnt.join(",");

// The connected component of the empty state in the valid-state graph (single-star add/remove,
// every state valid and at or under budget). Returns null if it exceeds `cap` (skip oversized).
export function reachableSet(cons: ReachCon[], budget: number, cap = 600_000): Set<string> | null {
  const start = cons.map(() => 0);
  const seen = new Set<string>([key(start)]);
  const queue: Counts[] = [start];
  while (queue.length) {
    const cur = queue.pop()!;
    const total = cur.reduce((a, b) => a + b, 0);
    for (let i = 0; i < cons.length; i++) {
      if (cur[i]! < cons[i]!.size && total < budget) {
        const next = cur.slice();
        next[i]!++;
        // Starting a constellation (0 -> 1) requires its requirement already met by current affinity;
        // growing a started one only adds affinity, so it stays valid.
        const okStart = cur[i]! > 0 || covers(affinityOf(cur, cons), cons[i]!.req);
        if (okStart && validState(next, cons) && !seen.has(key(next))) {
          seen.add(key(next));
          if (seen.size > cap) return null;
          queue.push(next);
        }
      }
      if (cur[i]! > 0) {
        const next = cur.slice();
        next[i]!--;
        if (validState(next, cons) && !seen.has(key(next))) {
          seen.add(key(next));
          if (seen.size > cap) return null;
          queue.push(next);
        }
      }
    }
  }
  return seen;
}

// A partial selection S is extendable-reachable iff some reachable state contains all of S
// (at least S's star count in every constellation), i.e. S is a prefix of a reachable valid build.
export function extendableReachable(S: Counts, R: Set<string>): boolean {
  for (const k of R) {
    const st = k.split(",").map(Number);
    if (st.every((v, i) => v >= S[i]!)) return true;
  }
  return false;
}

// A small random model WITH the five crossroads appended (so the engine's seed assumption is matched).
export function randModel(rng: () => number): { cons: ReachCon[]; budget: number } {
  const k = 5 + Math.floor(rng() * 2);
  const cons: ReachCon[] = [];
  for (let i = 0; i < k; i++) {
    const size = 1 + Math.floor(rng() * 4);
    const req = zero();
    const grant = zero();
    const nReq = Math.floor(rng() * 3);
    const nGr = 1 + Math.floor(rng() * 2);
    for (let r = 0; r < nReq; r++) req[Math.floor(rng() * 3)] = 1 + Math.floor(rng() * 4);
    for (let g = 0; g < nGr; g++) grant[Math.floor(rng() * 3)] = 1 + Math.floor(rng() * 3);
    cons.push({ id: `c${i}`, size, req, grant });
  }
  for (let i = 0; i < 5; i++) {
    const g = zero();
    g[i] = 1;
    cons.push({ id: `x${i}`, size: 1, req: zero(), grant: g });
  }
  return { cons, budget: 8 + Math.floor(rng() * 5) };
}
