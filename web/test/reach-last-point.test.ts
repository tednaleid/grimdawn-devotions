// ABOUTME: A real user's 54-point build at cap 55 where the engine wrongly hid the last point: every
// ABOUTME: unselected crossroads is a legal 55th point, and the same build must stay lit on the resolver path.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { canonicalStarIds, decodeHash } from "../src/core/urlState";
import {
  buildCoverTable,
  buildOrderPath,
  buildReachCons,
  classifyForSelection,
  reachabilityForSelection,
  reachableExactFrom,
  selectionMinCost,
  selectionSummary,
} from "../src/core/reachability";
import { verifyBuildOrder } from "../src/core/orderLegality";

const model = buildModel(doc as any);
const cons = buildReachCons(model);
const table = buildCoverTable(cons);
const canon = canonicalStarIds(model);

// Twelve complete constellations, 54 points, self-covering, no partials. Four members (Blades of Nadaan,
// Murmur, Scales of Ulcama, Solemn Watcher) can only meet their own requirement with their own grant, so
// each needs a transient scaffold when it is placed; an order that places one of them last overshoots
// the cap, which is why the sampler's bootstrap-heuristic order alone dims every 55th point.
const HASH = "#p=55&s=AAAAgAQAAMADwAMAwAMAAMADAAAAAAAAAIA_AAAAwA8A4AcAAAAAAPADAAA_AD4";
const build54 = decodeHash(HASH, canon)!.selected;
const withCon = (sel: Set<string>, conId: string): Set<string> => {
  const out = new Set(sel);
  for (const sid of model.constellations.get(conId)!.starIds) out.add(sid);
  return out;
};
const withoutCon = (sel: Set<string>, conId: string): Set<string> => {
  const out = new Set(sel);
  for (const sid of model.constellations.get(conId)!.starIds) out.delete(sid);
  return out;
};
const UNSELECTED_CROSSROADS = ["crossroads_primordial", "crossroads_order", "crossroads_eldritch"];

test("the 54-point build decodes as expected", () => {
  expect(build54.size).toBe(54);
  const st = selectionSummary(model, build54);
  expect(st.partialFinish).toHaveLength(0);
  expect(st.built).toHaveLength(12);
});

test("every unselected crossroads is a reachable 55th point at cap 55", () => {
  const view = reachabilityForSelection(model, cons, table, build54, 55);
  for (const conId of UNSELECTED_CROSSROADS) {
    expect(view.completable.has(conId)).toBe(true);
    for (const sid of model.constellations.get(conId)!.starIds) expect(view.reachableStars.has(sid)).toBe(true);
  }
});

test("each 55-point extension has an oracle-verified live build order at cap 55", () => {
  for (const conId of UNSELECTED_CROSSROADS) {
    const members = selectionSummary(model, withCon(build54, conId)).built;
    const order = buildOrderPath(cons, table, members, 55, 16);
    expect(order).not.toBeNull();
    expect(verifyBuildOrder(cons, members, order!, 55)).toBeNull();
  }
});

test("the 54-point build's validity floor is 54, not 55", () => {
  expect(selectionMinCost(model, cons, table, build54)).toBe(54);
});

// Dropping both crossroads (chaos and ascendant) and Murmur leaves a selection that is not self-covering,
// so completing Murmur again is decided on the resolver path: its DFS adds the two crossroads as filler
// and reaches the original 54-point build as a covering node. The verdict must match the direct one.
test("the same build stays reachable when the resolver has to add the crossroads as filler", () => {
  const stripped = withoutCon(
    withoutCon(withoutCon(build54, "crossroads_chaos"), "crossroads_ascendant"),
    "murmur_mistress_of_rumors",
  );
  expect(stripped.size).toBe(46);
  const st = selectionSummary(model, withCon(stripped, "murmur_mistress_of_rumors"));
  expect(reachableExactFrom(cons, table, st, 55)).toBe(true);
  expect(classifyForSelection(cons, table, st, 55)).toBe("reachable");
});
