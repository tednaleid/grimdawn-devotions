// ABOUTME: Round-trips the cover-table blob (encode then decode reconstructs the same table)
// ABOUTME: and checks buildId stamping plus body-length validation.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { buildReachCons, buildCoverTable } from "../src/core/reachability";
import { encodeCoverBlob, decodeCoverBlob, computeBuildId } from "../src/adapters/coverTableBlob";

const cons = buildReachCons(buildModel(doc as any));
const table = buildCoverTable(cons);

test("encode then decode reconstructs the identical cover table and buildId", () => {
  const bytes = encodeCoverBlob(table, "abcdef0123456789");
  const { table: back, buildId } = decodeCoverBlob(bytes, cons);
  expect(buildId).toBe("abcdef0123456789");
  expect(back.caps).toEqual(table.caps);
  expect(back.strides).toEqual(table.strides);
  expect(back.cost.length).toBe(table.cost.length);
  expect(back.cost[0]).toBe(table.cost[0]);
  expect(back.cost[12345]).toBe(table.cost[12345]);
});

test("decode rejects a truncated body", () => {
  const bytes = encodeCoverBlob(table, "abcdef0123456789").slice(0, 100);
  expect(() => decodeCoverBlob(bytes, cons)).toThrow();
});

test("computeBuildId is stable and 16 hex chars", () => {
  const a = computeBuildId('{"x":1}');
  expect(a).toMatch(/^[0-9a-f]{16}$/);
  expect(computeBuildId('{"x":1}')).toBe(a);
  expect(computeBuildId('{"x":2}')).not.toBe(a);
});
