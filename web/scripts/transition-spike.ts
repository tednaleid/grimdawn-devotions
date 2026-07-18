// ABOUTME: Spike harness for baseline-to-current transition build orders (compare mode). Prototypes a
// ABOUTME: seeded replay with two-pass refund scheduling and a shared-teardown escalation ladder, checks
// ABOUTME: every order against an independent legality oracle, and reports go/no-go numbers.
// ABOUTME: Run via `just spike-transition [--pairs N] [--seed S]`. Zero product-code changes; the pure
// ABOUTME: pieces are exported so web/test/transition-spike.test.ts can guard them in CI.
// ABOUTME: Spec: docs/superpowers/specs/2026-07-18-transition-order-spike-design.md
import {
  peakToReach,
  buildOrderPath,
  type ReachCon,
  type Vec,
  type BuildStep,
} from "../src/core/reachability";
import { model, cons, table, generateValidBuild, isValidBuild, mulberry32 } from "./reachability-fuzz";

const zero = (): Vec => [0, 0, 0, 0, 0];
const covers = (g: Vec, d: Vec): boolean =>
  g[0] >= d[0] && g[1] >= d[1] && g[2] >= d[2] && g[3] >= d[3] && g[4] >= d[4];
const add = (g: Vec, x: Vec): Vec => [g[0] + x[0], g[1] + x[1], g[2] + x[2], g[3] + x[3], g[4] + x[4]];
const maxV = (a: Vec, b: Vec): Vec => [
  Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3]), Math.max(a[4], b[4]),
];

export interface TransStep {
  kind: "add" | "refund";
  conId: string;
  from: number;
  to: number;
  heldAfter: number;
}

/**
 * Independent legality oracle. Replays `steps` from `base`, recomputing validity from scratch at each
 * step: standing grants come only from COMPLETE constellations, standing requirements from every
 * STARTED constellation, and coverage must hold at the conservative mid-step point (a step's
 * requirement appears at its first star, its grant only at completion; a refund loses the grant at its
 * first refunded star while the requirement stands until zero). Cap rule: an ADD step must land at or
 * under `cap`, and the final state must fit `cap`; refund steps may pass through over-cap totals, which
 * is how a baseline larger than the live cap legally tears down (the spec's refund-before-add case).
 * The final state must equal `cur` exactly.
 * Returns null when legal, else a human-readable description of the first violation.
 */
export function verifyTransition(base: ReachCon[], cur: ReachCon[], steps: TransStep[], cap: number): string | null {
  const sizeOf = new Map(cons.map((c) => [c.id, c.size]));
  const conOf = new Map(cons.map((c) => [c.id, c]));
  const counts = new Map<string, number>(base.map((b) => [b.id, b.size]));
  const total = () => [...counts.values()].reduce((a, b) => a + b, 0);
  // Validity of a standing state, with an optional conservative override: `pending` is a con whose
  // requirement must be counted as standing but whose grant must NOT be counted (the mid-step point).
  const check = (label: string, pending: string | null): string | null => {
    let grant = zero();
    let req = zero();
    for (const [id, n] of counts) {
      if (n <= 0) continue;
      const c = conOf.get(id)!;
      req = maxV(req, c.req);
      if (n >= c.size && id !== pending) grant = add(grant, c.grant);
    }
    if (pending) req = maxV(req, conOf.get(pending)!.req);
    return covers(grant, req) ? null : `${label}: requirement uncovered`;
  };
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    const size = sizeOf.get(s.conId);
    if (size === undefined) return `step ${i}: unknown constellation ${s.conId}`;
    const cur0 = counts.get(s.conId) ?? 0;
    if (cur0 !== s.from) return `step ${i} (${s.conId}): from=${s.from} but standing count is ${cur0}`;
    if (s.to < 0 || s.to > size) return `step ${i} (${s.conId}): to=${s.to} out of range`;
    if (s.kind === "add" && s.to <= s.from) return `step ${i} (${s.conId}): add must increase count`;
    if (s.kind === "refund" && s.to >= s.from) return `step ${i} (${s.conId}): refund must decrease count`;
    // Conservative mid-step: requirement standing, grant absent (add completing / refund starting).
    counts.set(s.conId, s.to);
    const mid = check(`step ${i} (${s.conId}) mid`, s.conId);
    if (mid) return mid;
    const end = check(`step ${i} (${s.conId}) end`, null);
    if (end) return end;
    const t = total();
    if (s.kind === "add" && t > cap) return `step ${i} (${s.conId}): cap exceeded (${t} > ${cap})`;
    if (t !== s.heldAfter) return `step ${i} (${s.conId}): heldAfter=${s.heldAfter} but total is ${t}`;
    if (s.to === 0) counts.delete(s.conId);
  }
  if (total() > cap) return `end state over cap (${total()} > ${cap})`;
  const want = new Map(cur.map((c) => [c.id, c.size]));
  if (want.size !== counts.size) return `end state mismatch: ${counts.size} standing, ${want.size} wanted`;
  for (const [id, n] of want) if (counts.get(id) !== n) return `end state mismatch at ${id}`;
  return null;
}
