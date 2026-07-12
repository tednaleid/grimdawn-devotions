// ABOUTME: Reachability-driven constellation claims: claim whole only when completable,
// ABOUTME: remove the whole constellation freely.
import { test, expect } from "bun:test";
import { buildModel } from "../src/core/model";
import { toggleConstellation } from "../src/core/rules";
import type { ReachView } from "../src/core/reachability";
import type { SelectionState } from "../src/core/types";

const doc = {
  meta: { affinities: ["ascendant", "chaos", "eldritch", "order", "primordial"] },
  constellations: [
    {
      id: "A",
      name: "A",
      tier: 1,
      affinityRequired: {},
      affinityBonus: { ascendant: 2 },
      background: null,
      stars: [
        { index: 0, predecessors: [], position: { x: 0, y: 0 }, bonuses: {} },
        { index: 1, predecessors: [0], position: { x: 1, y: 0 }, bonuses: {} },
      ],
    },
  ],
} as any;
const model = buildModel(doc);
const view = (completable: string[]): ReachView => ({
  completable: new Set(completable),
  clickable: new Set(),
  reachableStars: new Set<string>(),
  have: [0, 0, 0, 0, 0],
  need: [0, 0, 0, 0, 0],
  needSource: new Map(),
});
const st = (ids: string[]): SelectionState => ({ selected: new Set(ids), pointCap: 55 });

test("claims all stars when completable", () => {
  const next = toggleConstellation(model, st([]), view(["A"]), "A");
  expect([...next.selected].sort()).toEqual(["A:0", "A:1"]);
});
test("rejects a claim when not completable", () => {
  expect(toggleConstellation(model, st([]), view([]), "A")).toEqual(st([]));
});
test("removes the whole constellation freely when fully selected", () => {
  const next = toggleConstellation(model, st(["A:0", "A:1"]), view([]), "A");
  expect(next.selected.size).toBe(0);
});
