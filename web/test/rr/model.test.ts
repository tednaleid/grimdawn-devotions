// ABOUTME: Tests the RR catalogue loader maps the committed snake_case JSON to camelCase RrSource.
import { test, expect } from "bun:test";
import { parseCatalogue } from "../../src/rr/core/model";
import doc from "../../../data/resistance-reduction.json";

test("parses the committed catalogue", () => {
  const { sources } = parseCatalogue(doc);
  expect(sources.length).toBeGreaterThan(400);
  const viper = sources.find((s) => s.recordPath.endsWith("skills/devotion/tier1_13d.dbr"));
  expect(viper?.rrType).toBe("reduced-percent");
  expect(viper?.valueAtMax).toBe(20);
});

test("throws only on a non-object doc", () => {
  expect(() => parseCatalogue(null)).toThrow();
  expect(parseCatalogue({}).sources).toEqual([]);
});
