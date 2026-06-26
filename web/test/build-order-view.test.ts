// ABOUTME: Tests buildOrderHtml - the right-sidebar build-order panel markup: numbered complete rows with
// ABOUTME: constellation art, distinct scaffold add/refund rows with the running held total, and the
// ABOUTME: null/empty state with the on-demand "Find valid order" button.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { buildOrderHtml } from "../src/adapters/buildOrderView";
import type { BuildStep } from "../src/core/reachability";

const model = buildModel(doc as any);
const firstCon = [...model.constellations.values()][0]!;

test("buildOrderHtml renders complete and scaffold rows with held totals and con ids", () => {
  const steps: BuildStep[] = [
    { kind: "scaffold-add", conId: firstCon.id, points: 1, heldAfter: 1 },
    { kind: "complete", conId: firstCon.id, points: 5, heldAfter: 6 },
    { kind: "scaffold-refund", conId: firstCon.id, points: -1, heldAfter: 5 },
  ];
  const html = buildOrderHtml(model, null, steps);
  expect(html).toContain(`data-con-id="${firstCon.id}"`);
  expect(html).toContain(firstCon.name);
  expect(html).toContain("bo-add");
  expect(html).toContain("bo-refund");
  expect(html).toContain("6"); // a held total
});

test("buildOrderHtml null (unsearched) renders the empty state with a find-order button", () => {
  const html = buildOrderHtml(model, null, null);
  expect(html).toContain("data-find-order");
  expect(html).not.toContain("Incomplete build");
});

test("buildOrderHtml incomplete: names the affinity deficit and offers no search button", () => {
  // deficit [asc, cha, eld, ord, pri] = needs 20 Ascendant + 7 Order (the Oleron-alone shape)
  const html = buildOrderHtml(model, null, null, { kind: "incomplete", deficit: [20, 0, 0, 7, 0] });
  expect(html).toContain("Incomplete build");
  expect(html).toContain("20 more Ascendant");
  expect(html).toContain("7 more Order");
  expect(html).toContain("and"); // joins multiple deficits
  expect(html).not.toContain("data-find-order"); // searching cannot help an incomplete selection
});

test("buildOrderHtml searched with a minCap reports the points floor", () => {
  const html = buildOrderHtml(model, null, null, { kind: "searched", minCap: 13 });
  expect(html).toContain("No path to this build in fewer than 13 points");
  expect(html).not.toContain("data-find-order");
});

test("buildOrderHtml searched with null minCap reports no legal path", () => {
  const html = buildOrderHtml(model, null, null, { kind: "searched", minCap: null });
  expect(html).toContain("No legal path to this build exists");
});
