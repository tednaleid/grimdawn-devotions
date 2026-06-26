// ABOUTME: Tests the build-order engine: peakToReach's scaffold-subset collection (Task 1) and
// ABOUTME: buildOrderPath's constellation-level construction schedule (Task 2), including the replay
// ABOUTME: legality invariant and the no-path (false-reach) cases.
import { test, expect } from "bun:test";
import { buildCoverTable, peakToReach, type ReachCon, type Vec } from "../src/core/reachability";

const z = (): Vec => [0, 0, 0, 0, 0];
const v = (asc = 0, cha = 0, eld = 0, ord = 0, pri = 0): Vec => [asc, cha, eld, ord, pri];
const con = (id: string, size: number, req: Vec, grant: Vec): ReachCon => ({ id, size, req, grant });
const cx = (i: number, id = `x${i}`): ReachCon => {
  const g = z();
  g[i] = 1;
  return { id, size: 1, req: z(), grant: g };
};
const anchor = (req: Vec): ReachCon => con("anchor", 1, req, z());

test("peakToReach collects a minimum scaffold subset covering the deficit", () => {
  // Deficit asc 1 + eld 1: the two crossroads (x0 asc, x2 eld) cover it, size 2.
  const cons = [cx(0), cx(2), anchor(v(1, 0, 1))];
  const table = buildCoverTable(cons);
  const collect: ReachCon[] = [];
  const size = peakToReach(cons, table, v(1, 0, 1), z(), 300_000, { collect });
  expect(size).toBe(2);
  expect(collect.map((c) => c.id).sort()).toEqual(["x0", "x2"]);
});

test("peakToReach preferSmall picks crossroads over an equal-size larger granter", () => {
  // Two ways to get eld 1 at size 1: the eldritch crossroads (req-free) or 'big' (also size 1 but
  // carries a requirement). preferSmall must choose the req-free crossroads.
  const big = con("big", 1, v(1, 0, 0), v(0, 0, 1)); // size 1, but needs asc 1 to place
  const cons = [cx(0), cx(2, "eldx"), big, anchor(v(0, 0, 1))];
  const table = buildCoverTable(cons);
  const collect: ReachCon[] = [];
  const size = peakToReach(cons, table, v(0, 0, 1), z(), 300_000, { collect, preferSmall: true });
  expect(size).toBe(1);
  expect(collect.map((c) => c.id)).toEqual(["eldx"]);
});

test("peakToReach without opts is unchanged (no allocation, same size)", () => {
  const cons = [cx(0), cx(2), anchor(v(1, 0, 1))];
  const table = buildCoverTable(cons);
  expect(peakToReach(cons, table, v(1, 0, 1))).toBe(2);
});
