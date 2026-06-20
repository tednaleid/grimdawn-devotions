// ABOUTME: Tests for removalBlockers - the selected stars that must be removed before a rejected deselection.
// ABOUTME: Covers both predecessor dependency and affinity dependency, plus the allowed (no blockers) case.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { removalBlockers } from "../src/core/rules";

const model = buildModel(doc as any);
const cap = 55;

test("predecessor dependency: removing a star is blocked by its selected successor", () => {
  // crossroads grants eldritch so bat:0 is valid; bat:1 needs bat:0 as a predecessor.
  const state = { selected: new Set(["crossroads_eldritch:0", "bat:0", "bat:1"]), pointCap: cap };
  const blockers = removalBlockers(model, state, new Set(["bat:0"]));
  expect([...blockers].sort()).toEqual(["bat:1"]);
});

test("affinity dependency: removing the affinity source is blocked by what it sustains", () => {
  // crossroads_eldritch grants the eldritch that bat:0 (and thus bat:1) depend on.
  const state = { selected: new Set(["crossroads_eldritch:0", "bat:0", "bat:1"]), pointCap: cap };
  const blockers = removalBlockers(model, state, new Set(["crossroads_eldritch:0"]));
  expect([...blockers].sort()).toEqual(["bat:0", "bat:1"]);
});

test("no blockers when the removal is allowed (a leaf star)", () => {
  const state = { selected: new Set(["crossroads_eldritch:0", "bat:0", "bat:1"]), pointCap: cap };
  const blockers = removalBlockers(model, state, new Set(["bat:1"]));
  expect(blockers.size).toBe(0);
});

test("constellation removal: blockers are the dependents outside the removed set", () => {
  // Removing all of crossroads_eldritch drops the eldritch that the bat stars need.
  const state = { selected: new Set(["crossroads_eldritch:0", "bat:0", "bat:1"]), pointCap: cap };
  const blockers = removalBlockers(model, state, new Set(["crossroads_eldritch:0"]));
  // The removed star itself is never a blocker of its own removal.
  expect(blockers.has("crossroads_eldritch:0")).toBe(false);
  expect([...blockers].sort()).toEqual(["bat:0", "bat:1"]);
});
