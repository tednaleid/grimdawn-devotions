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

test("buildOrderHtml null renders the empty state with a find-order button", () => {
  const html = buildOrderHtml(model, null, null);
  expect(html).toContain("data-find-order");
});
