// ABOUTME: Tests the shared exact construction-peak oracle (minPeakCost): a finite peak when an order exists
// ABOUTME: within budget, INF when the min peak provably exceeds the budget, and INF when the selection cannot
// ABOUTME: cover its own affinity (no self-only order).
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { buildReachCons, buildCoverTable, INF, type ReachCon } from "../src/core/reachability";
import { minPeakCost } from "./support/costed-oracle";
import { gameText } from "../src/core/localization";
import { installEnglish } from "./helpers/localizeEn";

installEnglish();

const model = buildModel(doc as any);
const cons = buildReachCons(model);
const table = buildCoverTable(cons);
const byId = new Map(cons.map((c) => [c.id, c]));
const nameToId = new Map([...model.constellations.values()].map((c) => [gameText(c.nameTag), c.id]));
const membersOf = (names: string[]): ReachCon[] => names.map((n) => byId.get(nameToId.get(n)!)!);

// Fox + Scholar's Light + Oklaine's Lantern (12 stars, all eldritch): self-covering at the end, but Oklaine
// needs eldritch-10 to place and Fox(5)+Scholar(4)=9, so a transient +1 eldritch scaffold is required - the
// construction peak is 13, one above the 12-point selection. The boundary case the build-order tool surfaces.
const transientStack = ["Fox", "Scholar's Light", "Oklaine's Lantern"];

test("minPeakCost: finite peak when an order fits the budget (peak 13 at budget 13)", () => {
  const peak = minPeakCost(cons, table, membersOf(transientStack), 13);
  expect(peak).toBe(13);
});

test("minPeakCost: INF when the min construction peak provably exceeds the budget (13 > 12)", () => {
  expect(minPeakCost(cons, table, membersOf(transientStack), 12)).toBe(INF);
});

test("minPeakCost: INF for a not-self-covering selection (no self-only order)", () => {
  // Oleron grants no affinity but requires Ascendant + Order; alone it cannot self-cover.
  expect(minPeakCost(cons, table, membersOf(["Oleron"]), 55)).toBe(INF);
});
