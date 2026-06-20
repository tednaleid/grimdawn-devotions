// ABOUTME: Tests for selectableStars - stars that can be added given current selection and point cap.
// ABOUTME: Covers affinity gating, predecessor ordering, and point cap exhaustion.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { selectableStars } from "../src/core/rules";

const model = buildModel(doc as any);

test("from empty, only Crossroads entry stars are selectable; gated entries are not", () => {
  const sel = selectableStars(model, { selected: new Set(), pointCap: 55 });
  expect(sel.has("crossroads_eldritch:0")).toBe(true);
  expect(sel.has("bat:0")).toBe(false); // needs eldritch:1
});

test("a satisfied affinity requirement unlocks the constellation's entry star", () => {
  const sel = selectableStars(model, { selected: new Set(["crossroads_eldritch:0"]), pointCap: 55 });
  expect(sel.has("bat:0")).toBe(true);
  expect(sel.has("bat:1")).toBe(false); // needs bat:0 first
});

test("predecessor order gates non-entry stars", () => {
  const sel = selectableStars(model, {
    selected: new Set(["crossroads_eldritch:0", "bat:0"]), pointCap: 55,
  });
  expect(sel.has("bat:1")).toBe(true);
  expect(sel.has("bat:2")).toBe(false);
});

test("no points remaining means nothing is selectable", () => {
  const sel = selectableStars(model, { selected: new Set(["crossroads_eldritch:0"]), pointCap: 1 });
  expect(sel.size).toBe(0);
});
