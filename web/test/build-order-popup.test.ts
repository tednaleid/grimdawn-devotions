// ABOUTME: Tests the build-order step popup: post-step have/need table in the Affinity panel's visual
// ABOUTME: language, with the step's own grant/requirement folded in as parenthetical deltas.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { buildReachCons, buildCoverTable, selectionView } from "../src/core/reachability";
import { buildOrderHtml, buildStepPopupHtml } from "../src/adapters/buildOrderView";
import { canonicalStarIds, decodeHash } from "../src/core/urlState";
import { enLoc } from "./helpers/localizeEn";

const model = buildModel(doc as any);
const cons = buildReachCons(model);
const table = buildCoverTable(cons);
const REPRO_HASH = "p=55&s=_38AQAIAAAAAAOAfAAAAAADAAYAHAMAHAAAAAPADPwAAAAAAPw";
const decoded = decodeHash(REPRO_HASH, canonicalStarIds(model))!;
const view = selectionView(model, cons, table, decoded.selected, 55);
const steps = view.buildOrder!;
const states = view.buildOrderStates!;

test("popup renders five affinity rows with have values and no filter-toggle attributes", () => {
  const html = buildStepPopupHtml(enLoc, model, steps[0]!, states[0]!);
  expect(html.match(/class="affinity affinity-/g)?.length).toBe(5);
  expect(html).toContain('class="aff-have"');
  expect(html).not.toContain("data-gtoggle");
  expect(html).not.toContain("data-gkey");
  expect(html).not.toContain("data-ids");
});

test("a verified order's popup never shows a missing need cell", () => {
  for (let i = 0; i < steps.length; i++) {
    expect(buildStepPopupHtml(enLoc, model, steps[i]!, states[i]!)).not.toContain("missing");
  }
});

test("the step's grant and requirement fold into the table as parentheticals", () => {
  const gi = states.findIndex((st) => st.conGrant.some((n) => n > 0));
  const ri = states.findIndex((st) => st.conReq.some((n) => n > 0));
  expect(gi).toBeGreaterThanOrEqual(0);
  expect(ri).toBeGreaterThanOrEqual(0);
  const gGrant = states[gi]!.conGrant.find((n) => n > 0)!;
  expect(buildStepPopupHtml(enLoc, model, steps[gi]!, states[gi]!)).toContain(
    `<span class="bo-pop-delta">(+${gGrant})</span>`,
  );
  const rReq = states[ri]!.conReq.find((n) => n > 0)!;
  expect(buildStepPopupHtml(enLoc, model, steps[ri]!, states[ri]!)).toContain(
    `<span class="bo-pop-delta">(${rReq})</span>`,
  );
});

test("a refund step's grant delta is negative", () => {
  const fi = steps.findIndex((s, i) => s.kind === "scaffold-refund" && states[i]!.conGrant.some((n) => n > 0));
  expect(fi).toBeGreaterThanOrEqual(0);
  const g = states[fi]!.conGrant.find((n) => n > 0)!;
  expect(buildStepPopupHtml(enLoc, model, steps[fi]!, states[fi]!)).toContain(
    `<span class="bo-pop-delta">(-${g})</span>`,
  );
});

test("a met need renders with the met class and the neededBy title", () => {
  // the last step: the whole build stands, so every demanded color is met
  const html = buildStepPopupHtml(enLoc, model, steps[steps.length - 1]!, states[states.length - 1]!);
  expect(html).toContain('class="aff-need met"');
  expect(html).toContain("needed by");
});

test("build-order rows carry their step index for popup lookup", () => {
  const html = buildOrderHtml(enLoc, model, null, steps, null);
  expect(html).toContain('data-step-i="0"');
  expect(html).toContain(`data-step-i="${steps.length - 1}"`);
});
