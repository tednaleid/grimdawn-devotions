// ABOUTME: Tests aggregation of atomic RR rows into per-(record, rr_type) logical sources.
import { test, expect } from "bun:test";
import { parseCatalogue } from "../../src/rr/core/model";
import { aggregate } from "../../src/rr/core/aggregate";
import doc from "../../../data/resistance-reduction.json";

const logical = aggregate(parseCatalogue(doc).sources);

test("collapses per-resistance rows into one logical source", () => {
  const nc = logical.filter((s) => s.recordPath.endsWith("veilofshadows2.dbr"));
  expect(nc.length).toBe(1);
  expect(new Set(nc[0]!.resistances)).toEqual(new Set(["Cold", "Pierce", "Poison & Acid", "Vitality"]));
});

test("ids are unique and stable", () => {
  const ids = logical.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("aggregates to ~274 logical sources", () => {
  expect(logical.length).toBeGreaterThan(250);
  expect(logical.length).toBeLessThan(320);
});

test("perResistance carries each token's base value", () => {
  const nc = logical.find((s) => s.recordPath.endsWith("veilofshadows2.dbr"))!;
  expect(nc.perResistance.Cold).toBe(-25);
});
