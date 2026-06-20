// ABOUTME: Round-trip + tolerance tests for the URL state codec (point cap + selected stars bitset).
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { canonicalStarIds, encodeHash, decodeHash } from "../src/core/urlState";

const model = buildModel(doc as any);
const canonical = canonicalStarIds(model);

test("canonical ordering covers every star exactly once", () => {
  expect(canonical.length).toBe(model.stars.size);
  expect(new Set(canonical).size).toBe(canonical.length);
});

test("round-trips a selection and point cap", () => {
  const selected = new Set([canonical[0]!, canonical[5]!, canonical[200]!, canonical[canonical.length - 1]!]);
  const decoded = decodeHash("#" + encodeHash(selected, 42, canonical), canonical)!;
  expect(decoded.pointCap).toBe(42);
  expect([...decoded.selected].sort()).toEqual([...selected].sort());
});

test("empty selection encodes to an empty bitset and round-trips", () => {
  const hash = encodeHash(new Set(), 55, canonical);
  expect(hash).toBe("p=55&s=");
  const decoded = decodeHash("#" + hash, canonical)!;
  expect(decoded.selected.size).toBe(0);
  expect(decoded.pointCap).toBe(55);
});

test("returns null when there is nothing to decode", () => {
  expect(decodeHash("", canonical)).toBeNull();
  expect(decodeHash("#", canonical)).toBeNull();
  expect(decodeHash("#garbage", canonical)).toBeNull();
});

test("tolerates a malformed bitset and clamps the cap", () => {
  const decoded = decodeHash("#p=9999&s=@@@not-base64@@@", canonical)!;
  expect(decoded.selected.size).toBe(0);
  expect(decoded.pointCap).toBe(55); // clamped to the max
});

test("clamps a too-small cap", () => {
  expect(decodeHash("#p=0&s=", canonical)!.pointCap).toBe(1);
});
