// ABOUTME: Tests for toggleConstellation: pick/unpick a whole constellation at once when valid.
// ABOUTME: Uses the real dataset (crossroads_eldritch grants eldritch; bat requires eldritch 1, has 5 stars).
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { toggleConstellation } from "../src/core/rules";
import type { SelectionState } from "../src/core/types";

const model = buildModel(doc as any);
const batStars = ["bat:0", "bat:1", "bat:2", "bat:3", "bat:4"];

test("selects every star in a constellation when requirements are met", () => {
  let state: SelectionState = { selected: new Set(["crossroads_eldritch:0"]), pointCap: 55 };
  state = toggleConstellation(model, state, "bat");
  for (const id of batStars) expect(state.selected.has(id)).toBe(true);
  expect(state.selected.has("crossroads_eldritch:0")).toBe(true);
});

test("a second toggle removes the whole constellation again", () => {
  let state: SelectionState = { selected: new Set(["crossroads_eldritch:0"]), pointCap: 55 };
  state = toggleConstellation(model, state, "bat");
  state = toggleConstellation(model, state, "bat");
  for (const id of batStars) expect(state.selected.has(id)).toBe(false);
  expect(state.selected.has("crossroads_eldritch:0")).toBe(true);
});

test("rejects a constellation whose affinity requirement is not met", () => {
  const state: SelectionState = { selected: new Set(), pointCap: 55 };
  const next = toggleConstellation(model, state, "bat");
  expect(next).toBe(state); // unchanged (no eldritch affinity yet)
});

test("rejects a constellation that would exceed the point cap", () => {
  const state: SelectionState = { selected: new Set(["crossroads_eldritch:0"]), pointCap: 3 };
  const next = toggleConstellation(model, state, "bat"); // 1 + 5 = 6 > 3
  expect(next.selected.size).toBe(1);
});

test("ignores unknown or empty constellation ids", () => {
  const state: SelectionState = { selected: new Set(), pointCap: 55 };
  expect(toggleConstellation(model, state, "nope")).toBe(state);
});
