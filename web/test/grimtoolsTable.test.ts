// ABOUTME: Guards the committed grimtools mapping table against the committed devotion model.
// ABOUTME: A silently wrong table produces plausible-but-incorrect imports, so shape is pinned here.
import { test, expect } from "bun:test";
import table from "../../data/grimtools-stars.json";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { invertStarTable } from "../src/core/grimtools";

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

test("stars are numbered in grimtools sk order within each constellation", () => {
  // The game numbers a constellation's star skills sequentially, so sorting a constellation's own
  // sk ids ascending must reproduce our own star indices 0..n-1 exactly. Gated at generation time
  // too (scripts/gt_star_table.ts); this re-checks the committed artifact with no Chrome/network.
  const byCon = new Map<string, { sk: number; idx: number }[]>();
  for (const [sk, id] of Object.entries(stars)) {
    const [conId, idx] = id.split(":") as [string, string];
    const entries = byCon.get(conId) ?? [];
    entries.push({ sk: Number(sk.slice(2)), idx: Number(idx) });
    byCon.set(conId, entries);
  }
  for (const [conId, entries] of byCon) {
    const idxBySkAscending = [...entries].sort((a, b) => a.sk - b.sk).map((e) => e.idx);
    expect(idxBySkAscending, `${conId} out of order: ${idxBySkAscending.join(",")}`).toEqual(entries.map((_, i) => i));
  }
});

test("the committed table inverts cleanly, so every star has exactly one grimtools id to export", () => {
  // The ordering test above forbids two stars sharing an sk id; this is the same guard from the
  // export side, on the exact artifact the planner ships.
  const inverse = invertStarTable(stars);
  expect(Object.keys(inverse).length).toBe(559);
});
