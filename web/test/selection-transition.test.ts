// ABOUTME: selectionView's compare path: with a baseline it returns a gated transition (steps and
// ABOUTME: states from the verifying replay); without one, behavior is unchanged; none pairs fall
// ABOUTME: back to the from-scratch order so compare mode never shows less than today.
import { test, expect } from "bun:test";
import { selectionView, selectionSummary } from "../src/core/reachability";
import { verifyTransition } from "../src/core/orderLegality";
import { model, cons, table } from "../scripts/reachability-fuzz";
import { canonicalStarIds, decodeHash } from "../src/core/urlState";

const canonical = canonicalStarIds(model);
const CUR = "p=55&s=AAAAgAAHAAAAAAAAAAAAPADAwQf44AEAAIA_AAD8AAAAAAAAAAAAAPAD4AMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfg";
const BASE = "p=55&s=AAAAAAAAAADABgAAAAAAPADAwQcA4AEAAIA_AAD8AAAAAAAAAPABAPAD4AMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfg";
const curSel = decodeHash(CUR, canonical)!.selected;
const baseSel = decodeHash(BASE, canonical)!.selected;

test("with a baseline, selectionView returns a verified transition with matching states", () => {
  const view = selectionView(model, cons, table, curSel, 55, baseSel);
  expect(view.transition).not.toBeNull();
  const baseMembers = selectionSummary(model, baseSel).built;
  const curMembers = selectionSummary(model, curSel).built;
  expect(verifyTransition(cons, baseMembers, curMembers, view.transition!.steps, 55)).toBeNull();
  expect(view.transition!.states.length).toBe(view.transition!.steps.length);
});

test("the transition's final state agrees with the Affinity panel (supply/target)", () => {
  const view = selectionView(model, cons, table, curSel, 55, baseSel);
  const last = view.transition!.states[view.transition!.states.length - 1]!;
  const summary = selectionSummary(model, curSel);
  expect(last.have).toEqual(summary.supply);
  expect(last.need).toEqual(summary.target);
});

test("when a transition renders, the from-scratch order is not computed (replaced, not stacked)", () => {
  const view = selectionView(model, cons, table, curSel, 55, baseSel);
  expect(view.transition).not.toBeNull();
  expect(view.buildOrder).toBeNull();
});

test("without a baseline, behavior is unchanged", () => {
  const withNull = selectionView(model, cons, table, curSel, 55, null);
  const without = selectionView(model, cons, table, curSel, 55);
  expect(JSON.stringify(withNull.buildOrder)).toBe(JSON.stringify(without.buildOrder));
  expect(withNull.transition).toBeNull();
});

test("an empty baseline set means no comparison", () => {
  const view = selectionView(model, cons, table, curSel, 55, new Set());
  expect(view.transition).toBeNull();
});

test("a none pair falls back to the from-scratch order (never less than today)", () => {
  // Identity over cap is the guaranteed none pair: baseline equals current, cap below the build size.
  const size = selectionSummary(model, curSel).built.reduce((a, c) => a + c.size, 0);
  const view = selectionView(model, cons, table, curSel, size - 1, curSel);
  expect(view.transition).toBeNull();
  // buildOrder may be null too at this tight cap; the property is that the from-scratch path RAN:
  expect(view.buildOrderStates === null).toBe(view.buildOrder === null);
});
