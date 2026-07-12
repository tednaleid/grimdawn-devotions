// ABOUTME: Tests for partial-constellation reachability: pathToStar and the reachableStars signal
// ABOUTME: (deep-star attainability inside constellations that cannot be fully completed).
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import {
  buildReachCons,
  buildCoverTable,
  classifyForSelection,
  selectionSummary,
  reachabilityForSelection,
  pathToStar,
  buildOrderPath,
  selectionView,
  type Vec,
} from "../src/core/reachability";
import type { DevotionModel } from "../src/core/types";
import { decodeHash, canonicalStarIds } from "../src/core/urlState";
import { availablePowers } from "../src/core/aggregate";

const realModel = buildModel(doc as any);

test("pathToStar walks unselected predecessors within the constellation", () => {
  // korvaak_the_eldritch_sun: chain 0-1-2, then 2 branches to 3, 4, 5. Star 4 is Eye of Korvaak.
  const eye = "korvaak_the_eldritch_sun:4";
  const fromEmpty = pathToStar(realModel, new Set(), eye);
  expect([...fromEmpty].sort()).toEqual([
    "korvaak_the_eldritch_sun:0",
    "korvaak_the_eldritch_sun:1",
    "korvaak_the_eldritch_sun:2",
    "korvaak_the_eldritch_sun:4",
  ]);
  // Already-selected predecessors are excluded: only the unselected remainder is the path.
  const partial = pathToStar(realModel, new Set(["korvaak_the_eldritch_sun:0", "korvaak_the_eldritch_sun:1"]), eye);
  expect([...partial].sort()).toEqual(["korvaak_the_eldritch_sun:2", "korvaak_the_eldritch_sun:4"]);
  // A selected star has an empty path (nothing to add).
  expect(pathToStar(realModel, new Set([eye, "korvaak_the_eldritch_sun:0"]), eye).size).toBe(0);
});

// Build a synthetic DevotionModel from constellation specs. Each star's predecessors default to a
// chain (star k depends on star k-1); `preds` overrides them (local indices) for branching shapes.
function modelFromCons(
  conSpecs: Array<{ id: string; size: number; req: Vec; grant: Vec; preds?: Record<number, number[]> }>,
): DevotionModel {
  const stars = new Map();
  const constellations = new Map();
  const affinities = ["ascendant", "chaos", "eldritch", "order", "primordial"] as const;
  for (const spec of conSpecs) {
    const starIds: string[] = [];
    for (let k = 0; k < spec.size; k++) {
      const starId = `${spec.id}:${k}`;
      starIds.push(starId);
      const predIdx = spec.preds?.[k] ?? (k === 0 ? [] : [k - 1]);
      stars.set(starId, {
        id: starId,
        constellationId: spec.id,
        index: k,
        predecessors: predIdx.map((i) => `${spec.id}:${i}`),
        position: { x: 0, y: 0 },
        bonuses: {},
        celestialPower: null,
        weaponRequirement: null,
      });
    }
    const affinityRequired: Record<string, number> = {};
    const affinityBonus: Record<string, number> = {};
    for (let i = 0; i < 5; i++) {
      if (spec.req[i]) affinityRequired[affinities[i]!] = spec.req[i]!;
      if (spec.grant[i]) affinityBonus[affinities[i]!] = spec.grant[i]!;
    }
    constellations.set(spec.id, {
      id: spec.id,
      nameTag: spec.id,
      tier: null,
      affinityRequired,
      affinityBonus,
      background: null,
      starIds,
    });
  }
  return { stars, constellations } as DevotionModel;
}

// G (1 star, grants eldritch 3, no requirement) and X (4 stars, requires eldritch 1, grants nothing,
// branching: 0-1, then 1 branches to 2 and 3). X full costs 5 with G, so it is never completable at
// budget 4, but proper prefixes are reachable: maxK = 3 at budget 4, maxK = 2 at budget 3.
const branchy = () =>
  modelFromCons([
    { id: "G", size: 1, req: [0, 0, 0, 0, 0], grant: [0, 0, 3, 0, 0] },
    { id: "X", size: 4, req: [0, 0, 1, 0, 0], grant: [0, 0, 0, 0, 0], preds: { 2: [1], 3: [1] } },
  ]);

test("reachableStars: proper prefixes of a non-completable constellation light up to maxK", () => {
  const m = branchy();
  const c = buildReachCons(m);
  const t = buildCoverTable(c);
  // Budget 4: X's tips (paths of 3) fit, X complete (4 + G's 1 = 5) does not.
  const v4 = reachabilityForSelection(m, c, t, new Set(), 4);
  expect(v4.completable.has("X")).toBe(false);
  expect(v4.completable.has("G")).toBe(true);
  expect(v4.reachableStars.has("X:0")).toBe(true);
  expect(v4.reachableStars.has("X:1")).toBe(true);
  expect(v4.reachableStars.has("X:2")).toBe(true); // path {0,1,2} = 3 <= maxK 3
  expect(v4.reachableStars.has("X:3")).toBe(true); // path {0,1,3} = 3 <= maxK 3
  // Budget 3: maxK drops to 2; the branch tips (path 3) go dark, the stem stays.
  const v3 = reachabilityForSelection(m, c, t, new Set(), 3);
  expect(v3.reachableStars.has("X:0")).toBe(true);
  expect(v3.reachableStars.has("X:1")).toBe(true);
  expect(v3.reachableStars.has("X:2")).toBe(false);
  expect(v3.reachableStars.has("X:3")).toBe(false);
});

test("reachableStars: a started partial constellation with no spare points admits nothing more", () => {
  const m = branchy();
  const c = buildReachCons(m);
  const t = buildCoverTable(c);
  // {X:0, X:1} + G's 1 star = 3 points, budget 3: adding any X star needs a 4th point.
  const v = reachabilityForSelection(m, c, t, new Set(["X:0", "X:1"]), 3);
  expect(v.completable.has("X")).toBe(false);
  expect(v.reachableStars.has("X:2")).toBe(false);
  expect(v.reachableStars.has("X:3")).toBe(false);
  expect(v.reachableStars.has("G:0")).toBe(true); // G itself still completes within 3
});

test("reachableStars: all unselected stars of a completable constellation are present", () => {
  const m = branchy();
  const c = buildReachCons(m);
  const t = buildCoverTable(c);
  const v = reachabilityForSelection(m, c, t, new Set(), 55);
  for (const con of m.constellations.values())
    for (const sid of con.starIds) expect(v.reachableStars.has(sid)).toBe(true);
});

const starCanon = canonicalStarIds(realModel);
const realCons = buildReachCons(realModel);
const realTable = buildCoverTable(realCons);
const HASH_51 = "#p=55&s=AAAAAAEHAAAAOAAAOAA8PAA8APgHAAB4AHwAAAAAAAAAAAAAAAAAAAB8AAAAAAAAAAAAAAAAAAAAAAAAAADAHw";
const HASH_55 = "#p=55&s=AAAAAAEHAAAAOAAAOAA8PAA8APgHAAB4AHwAAAAAAAAAAAAAAAAAAAB8AAAAAAAAAAAAAAAAAAAAAOACAADAHw";

test("real map: Korvaak and Tortoise stars all light at the 51-point reference state", () => {
  const sel = decodeHash(HASH_51, starCanon)!.selected;
  expect(sel.size).toBe(51);
  const v = reachabilityForSelection(realModel, realCons, realTable, sel, 55);
  // Neither constellation is completable (6 and 5 stars against 4 spare points)...
  expect(v.completable.has("korvaak_the_eldritch_sun")).toBe(false);
  expect(v.completable.has("tortoise")).toBe(false);
  // ...but every star's path costs at most 4, so all of them are reachable.
  for (let i = 0; i < 6; i++) expect(v.reachableStars.has(`korvaak_the_eldritch_sun:${i}`)).toBe(true);
  for (let i = 0; i < 5; i++) expect(v.reachableStars.has(`tortoise:${i}`)).toBe(true);
}, 60_000);

test("real map: after spending the 4 points on Eye of Korvaak, the siblings go dark", () => {
  const sel = decodeHash(HASH_55, starCanon)!.selected;
  expect(sel.size).toBe(55);
  const v = reachabilityForSelection(realModel, realCons, realTable, sel, 55);
  expect(v.reachableStars.has("korvaak_the_eldritch_sun:3")).toBe(false);
  expect(v.reachableStars.has("korvaak_the_eldritch_sun:5")).toBe(false);
  for (let i = 0; i < 5; i++) expect(v.reachableStars.has(`tortoise:${i}`)).toBe(false);
}, 60_000);

test("reachableStars is downward-closed along the predecessor DAG", () => {
  const sel = decodeHash(HASH_51, starCanon)!.selected;
  const v = reachabilityForSelection(realModel, realCons, realTable, sel, 55);
  for (const sid of v.reachableStars) {
    const star = realModel.stars.get(sid)!;
    for (const p of star.predecessors) expect(sel.has(p) || v.reachableStars.has(p)).toBe(true);
  }
}, 60_000);

// Ground-truth agreement on small random models: membership must equal a direct classification of
// "selection + the star's path" - the exact question reachableStars answers. Small models keep the
// exact resolver fast, so this sweeps every star of every model.
test("reachableStars membership agrees with classifyForSelection on random small models", () => {
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let trial = 0; trial < 20; trial++) {
    const specs = [];
    const n = 3 + Math.floor(rnd() * 3); // 3-5 constellations
    for (let i = 0; i < n; i++) {
      const req: Vec = [0, 0, 0, 0, 0];
      const grant: Vec = [0, 0, 0, 0, 0];
      if (rnd() < 0.7) req[Math.floor(rnd() * 5)] = 1 + Math.floor(rnd() * 3);
      if (rnd() < 0.7) grant[Math.floor(rnd() * 5)] = 1 + Math.floor(rnd() * 4);
      specs.push({ id: `c${i}`, size: 1 + Math.floor(rnd() * 4), req, grant });
    }
    const m = modelFromCons(specs);
    const c = buildReachCons(m);
    const t = buildCoverTable(c);
    const budget = 3 + Math.floor(rnd() * 6);
    const v = reachabilityForSelection(m, c, t, new Set(), budget);
    for (const star of m.stars.values()) {
      const withPath = new Set(pathToStar(m, new Set(), star.id));
      const verdict = classifyForSelection(c, t, selectionSummary(m, withPath), budget) === "reachable";
      expect(v.reachableStars.has(star.id)).toBe(verdict);
    }
  }
});

test("real map: Eye of Korvaak and Turtle Shell are available to get at the 51-point state", () => {
  const sel = decodeHash(HASH_51, starCanon)!.selected;
  const v = reachabilityForSelection(realModel, realCons, realTable, sel, 55);
  const powerStars = availablePowers(realModel, v.reachableStars).map((p) => p.starId);
  expect(powerStars).toContain("korvaak_the_eldritch_sun:4");
  expect(powerStars).toContain("tortoise:4");
}, 60_000);

test("build order: a deliberate partial is scheduled last with its partial point count", () => {
  // branchy(): G (1 star, grants eldritch 3) covers X's requirement (eldritch 1), so {X:0, X:1} + G
  // is a valid, self-covering selection with X held partial forever.
  const m = branchy();
  const c = buildReachCons(m);
  const t = buildCoverTable(c);
  const members = selectionSummary(m, new Set(["X:0", "X:1", "G:0"])).built;
  const steps = buildOrderPath(c, t, members, 55)!;
  expect(steps).not.toBeNull();
  const last = steps[steps.length - 1]!;
  expect(last).toEqual({ kind: "complete", conId: "X", points: 2, heldAfter: 3 });
});

test("real map: the Eye of Korvaak build's order carries Korvaak as a 4-point tail step", () => {
  const sel = decodeHash(HASH_55, starCanon)!.selected;
  const view = selectionView(realModel, realCons, realTable, sel, 55);
  expect(view.buildOrder).not.toBeNull();
  const korvaak = view.buildOrder!.findIndex((s) => s.conId === "korvaak_the_eldritch_sun" && s.kind === "complete");
  expect(korvaak).toBeGreaterThanOrEqual(0);
  expect(view.buildOrder![korvaak]!.points).toBe(4); // the partial count, not Korvaak's 6 stars
  // Zero-grant members form the order's tail: everything after the partial is also a complete step.
  for (const s of view.buildOrder!.slice(korvaak)) expect(s.kind).toBe("complete");
}, 60_000);
