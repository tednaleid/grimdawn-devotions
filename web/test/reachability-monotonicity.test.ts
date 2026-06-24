// ABOUTME: Metamorphic DOWNWARD-CLOSURE invariant: under ADDITIVE star picks at a fixed budget, no
// ABOUTME: constellation may gain viability - a witness build for the larger selection also contains the
// ABOUTME: smaller, so reachability only shrinks as stars are added. Any gain is a FALSE-DIM. Self-contained
// ABOUTME: and seeded (no oracle). main UPHOLDS this (passes). Heavy metamorphic walk (tens of seconds), so
// ABOUTME: gated to the slow tier: runs under `just test-slow` (REACH_SLOW=1), skipped in the default suite.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import {
  buildReachCons,
  buildCoverTable,
  classifyForSelection,
  selectionSummary,
  type ReachCon,
} from "../src/core/reachability";

const model = buildModel(doc as any);
const cons = buildReachCons(model);
const table = buildCoverTable(cons);

const reqSum = (c: ReachCon) => c.req[0] + c.req[1] + c.req[2] + c.req[3] + c.req[4];
const selfCovers = (c: ReachCon) => c.grant.every((g, j) => g >= c.req[j]!);
// Watch the false-dim-prone set: the highest-requirement non-self-covering constellations.
const watch = cons
  .filter((c) => reqSum(c) > 0 && !selfCovers(c))
  .sort((a, b) => reqSum(b) - reqSum(a))
  .slice(0, 25)
  .map((c) => c.id);

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const reachable = (sel: Set<string>) =>
  classifyForSelection(cons, table, selectionSummary(model, sel), 55) === "reachable";
const completable = (sel: Set<string>, id: string): boolean => {
  const w = new Set(sel);
  for (const s of model.constellations.get(id)!.starIds) w.add(s);
  return classifyForSelection(cons, table, selectionSummary(model, w), 55) === "reachable";
};
const frontier = (sel: Set<string>): string[] => {
  const out: string[] = [];
  for (const s of model.stars.values()) if (!sel.has(s.id) && s.predecessors.every((p) => sel.has(p))) out.push(s.id);
  return out;
};

// First downward-closure violation along a seeded additive walk: an additive pick that makes a watched
// constellation NEWLY viable (it was dim before, viable after). Returns a description, or null if none.
function firstViolation(seed: number, maxPts = 30): string | null {
  const rng = mulberry32(seed);
  const sel = new Set<string>();
  let prev = new Map(watch.map((id) => [id, completable(sel, id)]));
  for (let step = 0; step < 200 && sel.size < maxPts; step++) {
    const fr = frontier(sel);
    if (!fr.length) break;
    let added = false;
    for (let t = 0; t < 10 && !added; t++) {
      const star = fr[Math.floor(rng() * fr.length)]!;
      const trial = new Set(sel);
      trial.add(star);
      if (reachable(trial)) {
        sel.add(star);
        added = true;
      }
    }
    if (!added) break;
    const cur = new Map(watch.map((id) => [id, completable(sel, id)]));
    for (const id of watch)
      if (!prev.get(id) && cur.get(id))
        return `${model.constellations.get(id)!.name} viable after an additive pick (seed ${seed}, step ${step})`;
    prev = cur;
  }
  return null;
}

const SLOW = process.env.REACH_SLOW === "1";
test.skipIf(!SLOW)(
  "downward-closure: an additive pick never makes a new constellation viable",
  () => {
    // A couple of seeded additive walks: each pick keeps the selection reachable, then we check no watched
    // constellation became NEWLY viable (which would prove it was a false-dim a step earlier). main finds
    // none. Short-circuits on the first violation if one ever appears.
    const v = firstViolation(1) ?? firstViolation(2);
    expect(v).toBeNull();
  },
  60_000,
);
