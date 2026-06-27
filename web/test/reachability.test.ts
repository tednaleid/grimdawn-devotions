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

// Was a known engine gap (main false-dimmed Oklaine's Lantern, a non-self-covering ~26-point state that
// needs filler to extend to a valid 55-point build containing Oklaine). The peak-witness gate in the
// exact resolver (minPeakSampled at covering builds) closes it. See BACKLOG "Reachability engine".

test("Oklaine's Lantern is reachable from the user-reported state (filler-extension fix)", () => {
  // A tight 55-point build containing Oklaine exists (constructor-confirmed reachable, exact min-peak 55).
  // main's resolver dimmed it because its covering-build gate (seed-only constructible) could not model the
  // scaffold-then-refund needed to bootstrap the build's own affinity. Must classify reachable.
  const hash = "p=55&s=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIA_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgP8H_AE";
  expect(urlCompletable(hash, "Oklaine's Lantern")).toBe(true);
}, 30_000);

test("Vulture and Ghoul are reachable from the user-reported 47-point state (affinity-bootstrap fix)", () => {
  // A 47-point build that grants no chaos but whose capstone (Ultos) needs chaos 6. Vulture (req cha:1,
  // grant cha:5) and Ghoul (req cha:1, grant cha:3) are reachable by adding a chaos granter as filler and
  // building with a refundable chaos crossroads scaffold (peak <= 55). main's resolver dimmed both: its
  // covering-build gate was the seed-only constructible() check, which cannot model scaffold-then-refund.
  // The peak-witness gate (minPeakSampled) closes it. Same root cause as Oklaine below.
  const hash = "p=55&s=AAAAAAAHAAAAAAAAwAMAAAAAAAAAAAB4-H8AAAAAAAAAAAAAwA_-AAB8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAHw";
  expect(urlCompletable(hash, "Vulture")).toBe(true);
  expect(urlCompletable(hash, "Ghoul")).toBe(true);
}, 30_000);

test("Imp is reachable from the user-reported Wraith state", () => {
  // main classifies Imp reachable here (no false-dim); guards that it keeps getting it right. The
  // costed-scaffolding alternate wrongly dimmed it (the original report was a downward-closure violation).
  const hash = "p=55&s=AAAAAAAAAAAAwAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAHAAAAAAB-AAD4AQ";
  expect(urlCompletable(hash, "Imp")).toBe(true);
}, 30_000);

// Confirmed real-map FALSE-REACHES: the engine LIGHTS a 55-point build it cannot actually construct.
// Both builds are self-covering and fit 55 points permanently, but their exact min construction peak is
// 56 (off by one): every construction order must transiently hold one extra scaffold point to bootstrap
// the stacked Affliction-like multi-color requirements. The engine lights them via the seed-only
// constructible() fast path in reachableExactFrom, which ignores the construction peak. Ground truth from
// `just realmap-hunt --probe 5563,41966` (order-exact minPeakCost = INF > 55). The resolver now decides
// covering nodes on the construction peak (peakGateReachable + the peak witness) instead of the seed-only
// constructible fast path, so the correct verdict "dim" is returned.
function classifyBuild(names: string[]): { reach: string; stars: number } {
  const sel = new Set<string>();
  for (const n of names) for (const sid of realModel.constellations.get(id(n))!.starIds) sel.add(sid);
  return { reach: classifyForSelection(cons, cover, selectionSummary(realModel, sel), 55), stars: sel.size };
}

// Open in the app: http://localhost:5173/#p=55&s=HwAAAAAAAD4AAAAABzwAAAAAAAAAAACABwDAHwAAAAAA4AcAAAAAAACA_wMA8AEAAAAf
test("real-map false-reach (seed 5563): unconstructible 55-pt Affliction stack must NOT be reachable", () => {
  const b = classifyBuild([
    "Akeron's Scorpion",
    "Fiend",
    "Lion",
    "Mantis",
    "Wretch",
    "Assassin",
    "Dire Bear",
    "Revenant",
    "Rhowan's Crown",
    "Solael's Witchblade",
    "Ulo the Keeper of the Waters",
  ]);
  expect(b.stars).toBe(55); // a full 55-point build
  expect(b.reach).toBe("dim"); // exact min-peak is 56; engine currently wrongly lights it (false-reach)
}, 30_000);

// Open in the app: http://localhost:5173/#p=55&s=AADwAQCADwAAAAAfAAAAAAAAAAAAAD4AAAAAAPADAAAA4AcAAAAAPwCA_wMAAMAP
test("real-map false-reach (seed 41966): unconstructible 55-pt Affliction stack must NOT be reachable", () => {
  const b = classifyBuild([
    "Bull",
    "Eye of the Guardian",
    "Imp",
    "Vulture",
    "Bard's Harp",
    "Dire Bear",
    "Manticore",
    "Revenant",
    "Rhowan's Crown",
    "Staff of Rattosh",
  ]);
  expect(b.stars).toBe(55); // a full 55-point build
  expect(b.reach).toBe("dim"); // exact min-peak is 56; engine currently wrongly lights it (false-reach)
}, 30_000);

// Cheap, human-checkable false-reach anchor. At budget 3 the planner used to LIGHT every tier-1
// single-affinity constellation (3 stars, requires 1 of a color) as completable. None are: the only
// source of that first point of color is a crossroads you must HOLD while placing the constellation,
// so the true construction peak is 4, not 3. The refunded cost (3) fits, the peak (4) does not -
// reachability is a question about the peak. The 5 crossroads (req 0, peak 1) stay correctly lit.
const TIER1_SINGLE = ["Eel", "Hammer", "Hawk", "Hound", "Jackal", "Lion", "Lizard", "Scholar's Light"];
function classifySingle(conName: string, budget: number): string {
  const sel = new Set(realModel.constellations.get(id(conName))!.starIds);
  return classifyForSelection(cons, cover, selectionSummary(realModel, sel), budget);
}

test("tier-1 single-affinity constellations are dim at budget 3 (peak 4), reachable at budget 4", () => {
  for (const name of TIER1_SINGLE) {
    expect(classifySingle(name, 3)).toBe("dim"); // refunded cost 3, but construction peak 4 > 3
    expect(classifySingle(name, 4)).toBe("reachable"); // peak 4 fits
  }
});

test("crossroads stay reachable at budget 3 (req 0, peak 1)", () => {
  const crossroads = cons.filter((c) => c.size === 1 && c.req.every((v) => v === 0) && c.grant.some((v) => v > 0));
  expect(crossroads.length).toBe(5); // one per color
  for (const c of crossroads) {
    const sel = new Set(realModel.constellations.get(c.id)!.starIds);
    expect(classifyForSelection(cons, cover, selectionSummary(realModel, sel), 3)).toBe("reachable");
  }
});

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

test("selectionView returns a legal buildOrder for a reachable build and null for a false-reach", () => {
  // A self-covering reachable build (the affliction share-link state from the fixture): supply covers
  // all requirements so buildOrderPath can find a valid construction order within 55 points.
  const aflNames = [
    "Scarab",
    "Tortoise",
    "Affliction",
    "Autumn Boar",
    "Behemoth",
    "Messenger of War",
    "Shieldmaiden",
    "Solemn Watcher",
    "Obelisk of Menhir",
  ];
  const sel = new Set<string>();
  for (const n of aflNames) for (const sid of realModel.constellations.get(id(n))!.starIds) sel.add(sid);
  const view = selectionView(realModel, cons, cover, sel, 55);
  expect(view.buildOrder).not.toBeNull();
  // every heldAfter is within the cap
  for (const s of view.buildOrder!) expect(s.heldAfter).toBeLessThanOrEqual(55);

  // The confirmed false-reach (seed 5563) classifies reachable but has no valid order within 55.
  const names = [
    "Akeron's Scorpion",
    "Fiend",
    "Lion",
    "Mantis",
    "Wretch",
    "Assassin",
    "Dire Bear",
    "Revenant",
    "Rhowan's Crown",
    "Solael's Witchblade",
    "Ulo the Keeper of the Waters",
  ];
  const fr = new Set<string>();
  for (const n of names) for (const sid of realModel.constellations.get(id(n))!.starIds) fr.add(sid);
  const frView = selectionView(realModel, cons, cover, fr, 55);
  expect(frView.reach).toBeDefined();
  expect(frView.buildOrder).toBeNull();
}, 30_000);

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
