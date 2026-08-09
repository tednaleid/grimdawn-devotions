// ABOUTME: Guards the committed grimtools mapping table against the committed devotion model.
// ABOUTME: A silently wrong table produces plausible-but-incorrect imports, so shape is pinned here.
import { test, expect } from "bun:test";
import table from "../../data/grimtools-stars.json";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";

const stars = (table as { stars: Record<string, string> }).stars;

test("the table covers every star exactly once", () => {
  const ids = Object.values(stars);
  expect(ids.length).toBe(559);
  expect(new Set(ids).size).toBe(559);
});

test("every key is a grimtools skill id", () => {
  for (const k of Object.keys(stars)) expect(k).toMatch(/^sk\d+$/);
});

test("every value resolves to a real star in the model", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = buildModel(doc as any);
  for (const id of Object.values(stars)) expect(model.stars.has(id)).toBe(true);
});

test("the table records the devotion data version it came from", () => {
  expect((table as { dataVersion: string }).dataVersion).toMatch(/^[0-9a-f]{6,}$/);
});
