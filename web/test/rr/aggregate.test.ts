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

test("aggregates to a plausible source count (grows as expansions add items)", () => {
  // ~374 after Fangs of Asterkarn (1.3.0.0); a wide band catches gross breakage (aggregation
  // collapsing to nothing or exploding) while tolerating a content patch adding item sources.
  expect(logical.length).toBeGreaterThan(340);
  expect(logical.length).toBeLessThan(450);
});

test("perResistance carries each token's base value", () => {
  const nc = logical.find((s) => s.recordPath.endsWith("veilofshadows2.dbr"))!;
  expect(nc.perResistance.Cold).toBe(-25);
});
