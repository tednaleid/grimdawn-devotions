// ABOUTME: repairSelection enforces predecessor-closure and drops claims until reachable within cap.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { buildReachCons, buildCoverTable } from "../src/core/reachability";
import { repairSelection } from "../src/core/rules";

const model = buildModel(doc as any);
const cons = buildReachCons(model);
const table = buildCoverTable(cons);
const nameToId = new Map([...model.constellations.values()].map((c) => [c.name, c.id]));
const lev = model.constellations.get(nameToId.get("Leviathan")!)!;

test("keeps a reachable selection unchanged", () => {
  const sel = new Set(lev.starIds); // Leviathan claimed, cap 55 -> reachable (26)
  expect(repairSelection(model, cons, table, sel, 55)).toEqual(sel);
});
test("drops a claim that cannot fit the cap", () => {
  const sel = new Set(lev.starIds); // needs 26
  const repaired = repairSelection(model, cons, table, sel, 10); // cap 10 < 26 -> must drop Leviathan
  expect([...repaired].some((id) => lev.starIds.includes(id))).toBe(false);
});
test("null table accepts the selection as-is (degraded)", () => {
  const sel = new Set(lev.starIds);
  expect(repairSelection(model, cons, null, sel, 10)).toEqual(sel);
});
