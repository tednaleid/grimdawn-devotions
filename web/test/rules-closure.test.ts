// ABOUTME: Tests for validClosure - fixpoint pruning that drops stars with unmet predecessors or affinity requirements.
// ABOUTME: Verifies that completed constellations can self-sustain (bootstrap removal is safe).
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { validClosure } from "../src/core/rules";

const model = buildModel(doc as any);

test("drops a star whose predecessor is absent", () => {
  const closed = validClosure(model, new Set(["crossroads_eldritch:0", "bat:0", "bat:2"]));
  expect(closed.has("bat:2")).toBe(false); // bat:2 needs bat:1
  expect(closed.has("bat:0")).toBe(true);
});

test("drops an entry star whose affinity requirement is unmet", () => {
  // bat needs eldritch:1, but nothing grants it here
  const closed = validClosure(model, new Set(["bat:0"]));
  expect(closed.has("bat:0")).toBe(false);
});

test("keeps a gated chain when affinity is satisfied", () => {
  const closed = validClosure(model, new Set(["crossroads_eldritch:0", "bat:0", "bat:1"]));
  expect(closed.has("bat:0")).toBe(true);
  expect(closed.has("bat:1")).toBe(true);
});

test("prunes an inconsistent set (the property the removal guard relies on)", () => {
  // bat is incomplete (2 of 5) so it grants nothing; with no eldritch, bat:0's
  // requirement is unmet -> bat:0 and its dependent bat:1 are pruned.
  const closed = validClosure(model, new Set(["bat:0", "bat:1"]));
  expect(closed.size).toBe(0);
});

test("a completed constellation sustains its own requirement (bootstrap removable)", () => {
  // Eel is 3 stars, requires primordial:1, grants primordial:5 when complete.
  // With all of Eel selected and NO Crossroads, Eel's own affinity keeps it valid.
  const closed = validClosure(model, new Set(["eel:0", "eel:1", "eel:2"]));
  expect(closed.size).toBe(3);
});
