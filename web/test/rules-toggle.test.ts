// ABOUTME: Tests for toggleStar and canRemove - guarded add/remove with no cascading.
// ABOUTME: Verifies rejection of removals that would invalidate other selections, and self-sustain bootstrap removal.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { toggleStar, canRemove } from "../src/core/rules";
import type { SelectionState } from "../src/core/types";

const model = buildModel(doc as any);
const empty: SelectionState = { selected: new Set(), pointCap: 55 };

test("adds a selectable star", () => {
  const s = toggleStar(model, empty, "crossroads_eldritch:0");
  expect([...s.selected]).toEqual(["crossroads_eldritch:0"]);
});

test("ignores an unselectable star", () => {
  const s = toggleStar(model, empty, "bat:0"); // gated
  expect(s.selected.size).toBe(0);
});

test("blocks removing a star that other selections depend on (no cascade)", () => {
  let s = toggleStar(model, empty, "crossroads_eldritch:0");
  s = toggleStar(model, s, "bat:0");
  s = toggleStar(model, s, "bat:1");
  expect(s.selected.size).toBe(3);
  // removing the affinity source would invalidate bat -> rejected, state unchanged
  expect(toggleStar(model, s, "crossroads_eldritch:0").selected.size).toBe(3);
  // removing a non-leaf (bat:0 has successor bat:1) -> rejected
  expect(toggleStar(model, s, "bat:0").selected.size).toBe(3);
  // removing the leaf bat:1 -> allowed
  expect(toggleStar(model, s, "bat:1").selected.size).toBe(2);
});

test("canRemove reflects the guard", () => {
  let s = toggleStar(model, empty, "crossroads_eldritch:0");
  s = toggleStar(model, s, "bat:0");
  s = toggleStar(model, s, "bat:1");
  expect(canRemove(model, s, "bat:1")).toBe(true);
  expect(canRemove(model, s, "bat:0")).toBe(false);
  expect(canRemove(model, s, "crossroads_eldritch:0")).toBe(false);
});

test("does not mutate the input state", () => {
  const before = new Set(empty.selected);
  toggleStar(model, empty, "crossroads_eldritch:0");
  expect(empty.selected).toEqual(before);
});

test("self-sustaining constellation: the bootstrap IS removable (no cascade)", () => {
  // Crossroads primordial:1 opens Eel; completing Eel grants primordial:5;
  // removing the Crossroads causes no cascade (Eel self-sustains) -> allowed.
  let s: SelectionState = { selected: new Set(), pointCap: 55 };
  s = toggleStar(model, s, "crossroads_primordial:0");
  for (const id of ["eel:0", "eel:1", "eel:2"]) s = toggleStar(model, s, id);
  expect(s.selected.size).toBe(4);
  expect(canRemove(model, s, "crossroads_primordial:0")).toBe(true);
  s = toggleStar(model, s, "crossroads_primordial:0"); // refund the bootstrap
  expect(s.selected.has("eel:0")).toBe(true);
  expect(s.selected.size).toBe(3);
});
