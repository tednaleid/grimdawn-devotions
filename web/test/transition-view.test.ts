// ABOUTME: Renders the compare-mode transition panel: direction heading, add/refund rows with star
// ABOUTME: deltas and step indices for the popup, full-respec notice, and the identity empty state.
import { test, expect } from "bun:test";
import { transitionHtml, buildStepPopupHtml } from "../src/adapters/buildOrderView";
import { selectionView } from "../src/core/reachability";
import { model, cons, table } from "../scripts/reachability-fuzz";
import { canonicalStarIds, decodeHash } from "../src/core/urlState";
import { enLoc } from "./helpers/localizeEn";

const canonical = canonicalStarIds(model);
const CUR = "p=55&s=AAAAgAAHAAAAAAAAAAAAPADAwQf44AEAAIA_AAD8AAAAAAAAAAAAAPAD4AMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfg";
const BASE = "p=55&s=AAAAAAAAAADABgAAAAAAPADAwQcA4AEAAIA_AAD8AAAAAAAAAPABAPAD4AMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfg";
const view = selectionView(
  model,
  cons,
  table,
  decodeHash(CUR, canonical)!.selected,
  55,
  decodeHash(BASE, canonical)!.selected,
);
const t = view.transition!;

test("the transition panel carries the direction heading and per-step indices", () => {
  const html = transitionHtml(enLoc, model, null, t.steps, t.rung);
  expect(html).toContain("Baseline to current build");
  expect(html).toContain('data-step-i="0"');
  expect(html).toContain(`data-step-i="${t.steps.length - 1}"`);
});

test("refund rows carry bo-refund and negative deltas; add rows bo-add or bo-complete", () => {
  const html = transitionHtml(enLoc, model, null, t.steps, t.rung);
  expect(html).toContain("bo-refund");
  expect(html).toMatch(/class="bo-pts">-\d/);
  expect(html).toMatch(/bo-(add|complete)/);
});

test("the full-respec rung shows its plain notice", () => {
  const html = transitionHtml(enLoc, model, null, t.steps, "full-respec");
  expect(html).toContain("full rebuild");
  const inc = transitionHtml(enLoc, model, null, t.steps, "incremental");
  expect(inc).not.toContain("full rebuild");
});

test("zero steps renders the builds-match empty state", () => {
  const html = transitionHtml(enLoc, model, null, [], "incremental");
  expect(html).toContain("match");
});

test("the popup renders a transition refund with a negative grant delta", () => {
  const fi = t.steps.findIndex((s, i) => s.kind === "refund" && t.states[i]!.conGrant.some((n) => n > 0));
  expect(fi).toBeGreaterThanOrEqual(0);
  const g = t.states[fi]!.conGrant.find((n) => n > 0)!;
  expect(buildStepPopupHtml(enLoc, model, t.steps[fi]!, t.states[fi]!)).toContain(
    `<span class="bo-pop-delta">(-${g})</span>`,
  );
});
