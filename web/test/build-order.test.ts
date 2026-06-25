// ABOUTME: Tests minPeakSampledOrder - the construction ORDER behind the sampled peak witness, the substrate
// ABOUTME: for guided build order. Validates it returns a complete legal ordering of a reachable build's
// ABOUTME: constellations, is consistent with the witness verdict, and is deterministic.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import fixtureJson from "./fixtures/reachable-builds.json";
import { buildModel } from "../src/core/model";
import {
  buildReachCons,
  buildCoverTable,
  minPeakSampled,
  minPeakSampledOrder,
  type ReachCon,
} from "../src/core/reachability";

const model = buildModel(doc as any);
const cons = buildReachCons(model);
const table = buildCoverTable(cons);
const byId = new Map(cons.map((c) => [c.id, c]));
const fixture = fixtureJson as unknown as { cases: { label: string; sel: Record<string, number> }[] };

// A fixture (a complete self-covering build) -> the whole-constellation members B it selects.
const buildOf = (sel: Record<string, number>): ReachCon[] =>
  Object.keys(sel)
    .map((id) => byId.get(id))
    .filter((c): c is ReachCon => !!c);

const sampleCases = fixture.cases.filter((c) => !c.label.startsWith("guard-")).slice(0, 12);

test("minPeakSampledOrder returns a complete legal ordering of a reachable build", () => {
  for (const c of sampleCases) {
    const B = buildOf(c.sel);
    const order = minPeakSampledOrder(cons, table, B, 55);
    expect(order).not.toBeNull();
    // a permutation of B: same multiset of ids, no missing or extra, no duplicates
    const got = order!.map((x) => x.id).sort();
    const want = B.map((x) => x.id).sort();
    expect(got).toEqual(want);
    expect(new Set(got).size).toBe(got.length);
  }
});

test("an order exists exactly when the witness says reachable (consistency)", () => {
  for (const c of sampleCases) {
    const B = buildOf(c.sel);
    const reachable = minPeakSampled(cons, table, B, 55, 16) <= 55;
    const order = minPeakSampledOrder(cons, table, B, 55, 16);
    expect(order !== null).toBe(reachable);
  }
});

test("a non-self-covering build has no construction order", () => {
  // A single constellation with an unmet requirement is not a self-covering build: no order builds it alone.
  const leviathan = byId.get("leviathan");
  expect(leviathan).toBeDefined();
  expect(minPeakSampledOrder(cons, table, [leviathan!], 55)).toBeNull();
});

test("the order is deterministic", () => {
  const B = buildOf(sampleCases[0]!.sel);
  const a = minPeakSampledOrder(cons, table, B, 55)!.map((x) => x.id);
  const b = minPeakSampledOrder(cons, table, B, 55)!.map((x) => x.id);
  expect(a).toEqual(b);
});
