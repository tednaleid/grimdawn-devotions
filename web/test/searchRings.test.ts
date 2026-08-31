// ABOUTME: Tests the pure search-ring ordering: which selected benefit tags ring stars, in what
// ABOUTME: order, and how per-search star sets fold into one per-star ring list for the renderer.
import { test, expect } from "bun:test";
import { benefitRingOrder, reconcileRingSlots, ringMap } from "../src/core/searchRings";
import { affinityTagId, petTagId } from "../src/core/benefitTag";

const canonical = ["statA", "statB", petTagId("statC"), affinityTagId("grant", "chaos"), "statD"];

test("orders selected tags by canonical position, not insertion order", () => {
  const selected = new Set(["statD", "statA"]);
  expect(benefitRingOrder(selected, canonical)).toEqual(["statA", "statD"]);
});

test("keeps pet tags but excludes affinity tags (they filter constellations, not stars)", () => {
  const selected = new Set([affinityTagId("grant", "chaos"), petTagId("statC"), "statB"]);
  expect(benefitRingOrder(selected, canonical)).toEqual(["statB", petTagId("statC")]);
});

test("ignores selected tags missing from the canonical list (stale link tolerance)", () => {
  const selected = new Set(["statA", "gone"]);
  expect(benefitRingOrder(selected, canonical)).toEqual(["statA"]);
});

test("ringMap folds per-search star sets into per-star ordered ring lists", () => {
  // The ring value is opaque to the fold (the adapter passes color+dash style records).
  const rings = ringMap([
    { ring: { color: "c0", dash: "" }, stars: new Set(["s1", "s2"]) },
    { ring: { color: "c1", dash: "4 2" }, stars: new Set(["s2"]) },
  ]);
  expect(rings.get("s1")).toEqual([{ color: "c0", dash: "" }]);
  expect(rings.get("s2")).toEqual([
    { color: "c0", dash: "" },
    { color: "c1", dash: "4 2" },
  ]);
  expect(rings.has("s3")).toBe(false);
});

// --- reconcileRingSlots: in-session color stability as tags toggle ---

test("removing a tag never moves the survivors' slots", () => {
  const current = new Map([
    ["statA", 0],
    ["statB", 1],
    ["statD", 2],
  ]);
  const next = reconcileRingSlots(current, ["statB", "statD"], 4);
  expect(next.get("statB")).toBe(1);
  expect(next.get("statD")).toBe(2);
  expect(next.has("statA")).toBe(false);
});

test("a new tag takes the least-used slot, so a freed color is reused before any doubling", () => {
  const current = new Map([
    ["statB", 1],
    ["statD", 2],
  ]);
  const next = reconcileRingSlots(current, ["statB", "statD", "statE"], 4);
  expect(next.get("statE")).toBe(0); // slots 0 and 3 are free; lowest wins
  expect(next.get("statB")).toBe(1);
  expect(next.get("statD")).toBe(2);
});

test("with every slot in use, a new tag doubles up on the least-used lowest slot", () => {
  const current = new Map([
    ["a", 0],
    ["b", 1],
    ["c", 2],
    ["d", 3],
  ]);
  const next = reconcileRingSlots(current, ["a", "b", "c", "d", "e"], 4);
  expect(next.get("e")).toBe(0);
  expect(next.get("a")).toBe(0); // the incumbent is untouched
});

test("seeding from empty assigns slots in the given (canonical) order", () => {
  const next = reconcileRingSlots(new Map(), ["statA", "statB", "statD"], 4);
  expect(next.get("statA")).toBe(0);
  expect(next.get("statB")).toBe(1);
  expect(next.get("statD")).toBe(2);
});

test("reconcile returns entries in active (canonical) order, so arc order never depends on toggle history", () => {
  // statD is the incumbent, statA arrives later but sorts first canonically.
  const next = reconcileRingSlots(new Map([["statD", 0]]), ["statA", "statD"], 4);
  expect([...next.keys()]).toEqual(["statA", "statD"]);
  expect(next.get("statD")).toBe(0); // the incumbent still keeps its slot
  expect(next.get("statA")).toBe(1);
});
