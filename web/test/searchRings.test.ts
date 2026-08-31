// ABOUTME: Tests the pure search-ring ordering: which selected benefit tags ring stars, in what
// ABOUTME: order, and how per-search star sets fold into one per-star ring list for the renderer.
import { test, expect } from "bun:test";
import { benefitRingOrder, magnitudeWeights, reconcileRingSlots, ringMap } from "../src/core/searchRings";
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

test("ringMap folds per-search weighted stars into per-star ordered ring entries", () => {
  // The ring value is opaque to the fold (the adapter passes color+dash style records); each
  // star carries its per-search magnitude weight through to its entry.
  const rings = ringMap([
    {
      ring: { color: "c0", dash: "" },
      stars: new Map([
        ["s1", 0],
        ["s2", 1],
      ]),
    },
    { ring: { color: "c1", dash: "4 2" }, stars: new Map([["s2", 0.5]]) },
  ]);
  expect(rings.get("s1")).toEqual([{ ring: { color: "c0", dash: "" }, weight: 0 }]);
  expect(rings.get("s2")).toEqual([
    { ring: { color: "c0", dash: "" }, weight: 1 },
    { ring: { color: "c1", dash: "4 2" }, weight: 0.5 },
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

// --- magnitudeWeights: relative magnitude of each star's grant within one search ---

test("magnitudeWeights ramps linearly from the smallest grant (0) to the largest (1)", () => {
  const w = magnitudeWeights(
    new Map([
      ["s1", 10],
      ["s2", 40],
      ["s3", 25],
    ]),
  );
  expect(w.get("s1")).toBe(0);
  expect(w.get("s2")).toBe(1);
  expect(w.get("s3")).toBe(0.5);
});

test("equal grants (or a single match) all weigh 0, so the ring renders at base size", () => {
  const equal = magnitudeWeights(
    new Map([
      ["s1", 7],
      ["s2", 7],
    ]),
  );
  expect(equal.get("s1")).toBe(0);
  expect(equal.get("s2")).toBe(0);
  expect(magnitudeWeights(new Map([["s1", 99]])).get("s1")).toBe(0);
});

test("magnitude is absolute value, so a larger reduction outweighs a smaller one", () => {
  const w = magnitudeWeights(
    new Map([
      ["s1", -10],
      ["s2", -40],
    ]),
  );
  expect(w.get("s1")).toBe(0);
  expect(w.get("s2")).toBe(1);
});
