// ABOUTME: Reachability-driven star toggles: add only what the ReachView marks clickable,
// ABOUTME: remove freely (cascading to dependents), never block a removal.
import { test, expect } from "bun:test";
import { buildModel } from "../src/core/model";
import { toggleStar, removeWithDependents } from "../src/core/rules";
import type { ReachView } from "../src/core/reachability";
import type { SelectionState } from "../src/core/types";

// A tiny two-constellation model: A (2 stars, a0 -> a1), B (1 star).
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
    {
      id: "B",
      name: "B",
      tier: 1,
      affinityRequired: {},
      affinityBonus: {},
      background: null,
      stars: [{ index: 0, predecessors: [], position: { x: 2, y: 0 }, bonuses: {} }],
    },
  ],
} as any;
const model = buildModel(doc);
const view = (clickable: string[], completable: string[] = []): ReachView => ({
  completable: new Set(completable),
  clickable: new Set(clickable),
  have: [0, 0, 0, 0, 0],
  need: [0, 0, 0, 0, 0],
  needSource: new Map(),
});
const st = (ids: string[]): SelectionState => ({ selected: new Set(ids), pointCap: 55 });

test("adds a clickable star; rejects a non-clickable one", () => {
  const reach = view(["A:0"]);
  expect(toggleStar(model, st([]), reach, "A:0").selected.has("A:0")).toBe(true);
  expect(toggleStar(model, st([]), reach, "A:1")).toEqual(st([])); // not clickable -> unchanged
});

test("removing a star cascades to its dependents and is never blocked", () => {
  const reach = view([]); // clickability is irrelevant for removals
  const next = toggleStar(model, st(["A:0", "A:1"]), reach, "A:0"); // remove the predecessor
  expect(next.selected.has("A:0")).toBe(false);
  expect(next.selected.has("A:1")).toBe(false); // dependent removed too
});

test("removeWithDependents drops only the forward cone", () => {
  const next = removeWithDependents(model, new Set(["A:0", "A:1", "B:0"]), "A:1");
  expect([...next].sort()).toEqual(["A:0", "B:0"]); // A:1 gone, A:0 and B:0 stay
});
