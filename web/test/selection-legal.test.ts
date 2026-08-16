// ABOUTME: A selection is "legal" when it classifies reachable within the game's 55 points; export
// ABOUTME: gates on it. Pinned on the Lion/Dryad forum link: deficit, completed, and over-budget cases.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { canonicalStarIds, decodeHash } from "../src/core/urlState";
import { buildCoverTable, buildReachCons, reachabilityForSelection, selectionView } from "../src/core/reachability";

const model = buildModel(doc as any);
const cons = buildReachCons(model);
const table = buildCoverTable(cons);
const canon = canonicalStarIds(model);

// 50 points at cap 55 with Scales of Ulcama short 2 Order (see dim-reasons.test.ts for the full story).
const HASH = "#p=55&s=AAAAgAQAAMADwAMAAAAAAMADAAAAAAAAAIA_AAAAwA8A4AcAAAAAAPADAAA_AD4";
const build50 = decodeHash(HASH, canon)!.selected;
const withCon = (sel: Set<string>, conId: string): Set<string> => {
  const out = new Set(sel);
  for (const sid of model.constellations.get(conId)!.starIds) out.add(sid);
  return out;
};

test("a selection with an affinity deficit is not a legal build, even though it is reachable with scaffolding held", () => {
  // Scales of Ulcama needs Order 8; the completed constellations supply 6. The engine can hold this
  // selection within 54 points with a scaffold standing, so it classifies reachable, but the game
  // would not let you end on it: refunding the scaffold would strand Scales.
  expect(selectionView(model, cons, table, build50, 55).legal).toBe(false);
  expect(reachabilityForSelection(model, cons, table, build50, 55).legal).toBe(false);
  expect(reachabilityForSelection(model, cons, table, build50, 55).completable.has("lion")).toBe(true); // reachability itself is unchanged
});

test("completing Lion supplies the missing Order and makes the selection legal", () => {
  expect(selectionView(model, cons, table, withCon(build50, "lion"), 55).legal).toBe(true);
});

test("Dryad's five stars make a valid 55-star selection that needs 56 points to construct, so it is not legal", () => {
  expect(selectionView(model, cons, table, withCon(build50, "dryad"), 55).legal).toBe(false);
});

test("legal is about the game's 55, not the slider: a lower cap does not make a legal build illegal", () => {
  // selectionView raises the sweep budget to the validity floor, so cap 30 still reports legal.
  expect(selectionView(model, cons, table, withCon(build50, "lion"), 30).legal).toBe(true);
});

test("the empty selection is trivially legal (export gates on emptiness separately)", () => {
  expect(selectionView(model, cons, table, new Set(), 55).legal).toBe(true);
});
