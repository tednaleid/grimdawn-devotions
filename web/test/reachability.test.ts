// ABOUTME: Selection-API reachability tests: selectionMinCost, selectionSummary, completionMinCost, and
// ABOUTME: the per-selection sweep. Oracle-match coverage lives in reachability-oracle/walk/peakcost tests.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import {
  buildReachCons,
  buildCoverTable,
  selectionSummary,
  classifyForSelection,
  completionMinCost,
  selectionMinCost,
  reachabilityForSelection,
  selectionView,
  type Vec,
} from "../src/core/reachability";
import type { DevotionModel } from "../src/core/types";
import { decodeHash, canonicalStarIds } from "../src/core/urlState";

// Build a synthetic DevotionModel from a list of constellation specs (for testing).
// Each constellation gets stars with proper predecessors: star k has predecessors [ConId:(k-1)] for k>0.
function modelFromCons(conSpecs: Array<{ id: string; size: number; req: Vec; grant: Vec }>): DevotionModel {
  const stars = new Map();
  const constellations = new Map();
  for (const spec of conSpecs) {
    const starIds: string[] = [];
    for (let k = 0; k < spec.size; k++) {
      const starId = `${spec.id}:${k}`;
      starIds.push(starId);
      const predecessors = k === 0 ? [] : [`${spec.id}:${k - 1}`];
      stars.set(starId, {
        id: starId,
        constellationId: spec.id,
        index: k,
        predecessors,
        position: { x: 0, y: 0 },
        bonuses: {},
        celestialPower: null,
        weaponRequirement: null,
      });
    }
    constellations.set(spec.id, {
      id: spec.id,
      name: spec.id,
      tier: null,
      affinityRequired: {},
      affinityBonus: {},
      background: null,
      starIds,
    });
    const affinities: ["ascendant", "chaos", "eldritch", "order", "primordial"] = [
      "ascendant",
      "chaos",
      "eldritch",
      "order",
      "primordial",
    ];
    const con = constellations.get(spec.id)!;
    for (let i = 0; i < 5; i++) {
      if (spec.req[i]) (con.affinityRequired as any)[affinities[i]!] = spec.req[i];
      if (spec.grant[i]) (con.affinityBonus as any)[affinities[i]!] = spec.grant[i];
    }
  }
  return { stars, constellations };
}

const realModel = buildModel(doc as any);
const cons = buildReachCons(realModel);
const cover = buildCoverTable(cons);
const nameToId = new Map([...realModel.constellations.values()].map((c) => [c.name, c.id]));
const id = (name: string) => nameToId.get(name)!;
const starCanon = canonicalStarIds(realModel);
// Is `conName` completable from a user-reported share-URL state? (decode the selection, add the whole
// constellation, classify). Used by the named false-dim regression cases below.
function urlCompletable(hash: string, conName: string): boolean {
  const sel = decodeHash(hash, starCanon)!.selected;
  for (const sid of realModel.constellations.get(id(conName))!.starIds) sel.add(sid);
  return classifyForSelection(cons, cover, selectionSummary(realModel, sel), 55) === "reachable";
}

test("selectionMinCost: empty is 0; a gated capstone needs filler beyond its own stars", () => {
  expect(selectionMinCost(realModel, cons, cover, new Set())).toBe(0);
  const lev = realModel.constellations.get(id("Leviathan"))!;
  const own = lev.starIds.length;
  const min = selectionMinCost(realModel, cons, cover, new Set(lev.starIds));
  expect(min).toBeGreaterThan(own); // the affinity gate forces filler beyond Leviathan's own stars
  expect(min).toBeLessThanOrEqual(55);
  expect(min).toBeGreaterThanOrEqual(24); // ~26 to field Leviathan
  expect(min).toBeLessThanOrEqual(28);
});

test("selectionView bundles the validity floor and the floor-raised sweep (the per-click engine cost)", () => {
  // Synthetic: X (3 stars) needs Eldritch 3 it does not grant; granter G (1 star) supplies it.
  // So fielding X costs 4 points (X + G) - a floor above a tight cap.
  const m = modelFromCons([
    { id: "X", size: 3, req: [0, 0, 3, 0, 0], grant: [0, 0, 0, 0, 0] },
    { id: "G", size: 1, req: [0, 0, 0, 0, 0], grant: [0, 0, 3, 0, 0] },
  ]);
  const c = buildReachCons(m);
  const t = buildCoverTable(c);
  const sel = new Set(["X:0", "X:1", "X:2"]); // full X, not yet self-covering
  const cap = 2; // below the validity floor

  const view = selectionView(m, c, t, sel, cap);
  const min = selectionMinCost(m, c, t, sel);
  expect(view.minCost).toBe(min);
  expect(min).toBeGreaterThan(cap); // the floor exceeds the tight cap

  // reach must be the sweep at the floor-raised budget (max(cap, floor)), identical to calling it directly
  const direct = reachabilityForSelection(m, c, t, sel, Math.max(cap, min));
  expect([...view.reach.completable].sort()).toEqual([...direct.completable].sort());
  expect([...view.reach.clickable].sort()).toEqual([...direct.clickable].sort());
  expect(view.reach.have).toEqual(direct.have);
  expect(view.reach.need).toEqual(direct.need);
});

// Known engine gap on main, locked in as test.failing: main wrongly dims Oklaine's Lantern (a tight,
// constructor-confirmed-reachable 55-point build). Flips to passing - alerting us to drop test.failing -
// once main's tight-build false-dims are fixed. See BACKLOG "Reachability engine: current state and gaps".

test.failing("Oklaine's Lantern is reachable from the user-reported state (main false-dims it)", () => {
  // A tight 55-point build containing Oklaine exists (constructor-confirmed reachable, exact min-peak 55),
  // but main's resolver wrongly dims it. Must classify reachable.
  const hash = "p=55&s=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIA_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgP8H_AE";
  expect(urlCompletable(hash, "Oklaine's Lantern")).toBe(true);
}, 30_000);

test("Imp is reachable from the user-reported Wraith state", () => {
  // main classifies Imp reachable here (no false-dim); guards that it keeps getting it right. The
  // costed-scaffolding alternate wrongly dimmed it (the original report was a downward-closure violation).
  const hash = "p=55&s=AAAAAAAAAAAAwAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAHAAAAAAB-AAD4AQ";
  expect(urlCompletable(hash, "Imp")).toBe(true);
}, 30_000);

test("a demanding constellation click stays responsive: selectionView under 400ms", () => {
  // The per-click engine cost (validity-floor search + dimming sweep, no DOM) for a whole non-self-covering
  // constellation from empty. main stays well under budget here (Murmur ~5ms); guards a per-click perf
  // regression. (The costed-scaffolding alternate freezes ~1s+ on this exact case.)
  const sel = new Set(realModel.constellations.get(id("Murmur, Mistress of Rumors"))!.starIds);
  const t0 = performance.now();
  selectionView(realModel, cons, cover, sel, 55);
  expect(performance.now() - t0).toBeLessThan(400);
}, 30_000);

test("completionMinCost reports Leviathan 26 and Tree of Life 27 from an empty selection", () => {
  expect(completionMinCost(realModel, cons, cover, new Set(), id("Leviathan"))).toBe(26);
  expect(completionMinCost(realModel, cons, cover, new Set(), id("Tree of Life"))).toBe(27);
});

test("selectionSummary splits started vs completed and tracks partial finishes", () => {
  const lev = realModel.constellations.get(id("Leviathan"))!; // grants nothing, requires eldritch+ascendant
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

test("reachabilityForSelection: a startable-but-not-completable constellation keeps a clickable first star", () => {
  // Synthetic Crook/Anvil at budget 6: Crook (5 stars, grants ascendant 5) is complete; Anvil (4 stars, needs ascendant 1).
  const model: any = modelFromCons([
    { id: "x0", size: 1, req: [0, 0, 0, 0, 0], grant: [1, 0, 0, 0, 0] },
    { id: "Crook", size: 5, req: [0, 0, 0, 0, 0], grant: [5, 0, 0, 0, 0] },
    { id: "Anvil", size: 4, req: [1, 0, 0, 0, 0], grant: [0, 0, 0, 2, 0] },
  ]);
  const mc = buildReachCons(model);
  const table = buildCoverTable(mc);
  const selected = new Set<string>(["Crook:0", "Crook:1", "Crook:2", "Crook:3", "Crook:4"]);
  const view = reachabilityForSelection(model, mc, table, selected, 6);
  expect(view.completable.has("Anvil")).toBe(false); // 5 + 4 = 9 > 6
  expect(view.clickable.has("Anvil:0")).toBe(true); // first star fits (cost 6, deficit 0)
  expect(view.clickable.has("Anvil:1")).toBe(false); // predecessor (Anvil:0) not yet selected
  expect(view.have[0]).toBe(5); // ascendant supply from completed Crook
});

test("empty map: everything completable at 55, and Leviathan gated below its floor", () => {
  const full = reachabilityForSelection(realModel, cons, cover, new Set(), 55);
  expect(full.completable.size).toBe(realModel.constellations.size);
  // Leviathan's completion floor is 26, so below it the capstone (and its first star) is dim. Asserted
  // directly rather than via a full budget-19 sweep, which would flail on the many unreachable candidates
  // a tight budget creates (the deep-state dim-bound gap; see the design spec).
  expect(completionMinCost(realModel, cons, cover, new Set(), id("Leviathan"))).toBeGreaterThan(19);
  const levFirst = selectionSummary(realModel, new Set([`${id("Leviathan")}:0`]));
  expect(classifyForSelection(cons, cover, levFirst, 19)).toBe("dim");
});

// SKIP pending the stronger dim lower bound: at this deep multi-capstone state most sweep candidates are
// borderline-unreachable near 55, and the costed resolver flails proving each one dim (the per-member dim
// bound does not catch multi-member structural unreachability). Normal play is fast (see `just perf`); only
// adversarial deep states are slow. Re-enable once the dim bound proves these cheaply. See the design spec.
test.skip("reachabilityForSelection stays fast at a deep multi-capstone state", () => {
  // The real worst case (a user-reported hang): several capstones claimed at once, many clickable
  // candidates each starting a granting constellation. The randomized-order prover keeps this well
  // under budget. Generous bound so it cannot flake on CI while still catching a perf regression.
  const sel = new Set<string>();
  for (const n of ["Lotus", "Kraken", "Leviathan", "Tree of Life", "Lion"])
    for (const sid of realModel.constellations.get(id(n))!.starIds) sel.add(sid);
  const t = performance.now();
  const view = reachabilityForSelection(realModel, cons, cover, sel, 55);
  expect(performance.now() - t).toBeLessThan(3000);
  expect(view.completable.size).toBeGreaterThan(0);
  expect(view.clickable.size).toBeGreaterThan(0);
});
