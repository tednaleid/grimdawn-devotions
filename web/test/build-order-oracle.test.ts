// ABOUTME: The build-order regression net: every order the panel-path search emits for seeded valid
// ABOUTME: builds (and the live-site reproduction URL) must pass the independent legality oracle.
import { test, expect } from "bun:test";
import { buildOrderPath, selectionSummary, selectionView, BUDGET } from "../src/core/reachability";
import { verifyBuildOrder } from "../src/core/orderLegality";
import { model, cons, table, generateValidBuild, mulberry32 } from "../scripts/reachability-fuzz";
import { canonicalStarIds, decodeHash } from "../src/core/urlState";

const SEEDS = 150; // pinned: a deterministic corpus, identical on every run

test("seeded panel-path orders all pass the legality oracle", () => {
  let orders = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const B = generateValidBuild(mulberry32(seed));
    const selected = new Set<string>();
    for (const m of B) for (const sid of model.constellations.get(m.id)!.starIds) selected.add(sid);
    const members = selectionSummary(model, selected).built; // the panel's exact member path
    const steps = buildOrderPath(cons, table, members, BUDGET, 16);
    if (!steps) continue; // an honest null is legal; the oracle judges only emitted orders
    const err = verifyBuildOrder(cons, members, steps, BUDGET);
    if (err) console.error(`seed ${seed}: ${err}`);
    expect(err).toBeNull();
    orders++;
  }
  expect(orders).toBeGreaterThan(SEEDS / 2); // the net must actually be judging orders
});

// The live-site illegal-refund reproduction found by the project owner: the panel's step 5 said
// "Refund Falcon" while completed Berserker (5 Ascendant / 5 Eldritch) still leaned on Falcon's grant.
const REPRO_HASH = "p=55&s=_38AQAIAAAAAAOAfAAAAAADAAYAHAMAHAAAAAPADPwAAAAAAPw";

test("the reproduction URL gets a legal order end to end", () => {
  const decoded = decodeHash(REPRO_HASH, canonicalStarIds(model));
  expect(decoded).not.toBeNull();
  const members = selectionSummary(model, decoded!.selected).built;
  const steps = buildOrderPath(cons, table, members, 55, 16);
  expect(steps).not.toBeNull();
  const err = verifyBuildOrder(cons, members, steps!, 55);
  if (err) console.error(err);
  expect(err).toBeNull();
});

test("selectionView's rendered order is gated: verified or absent", () => {
  const decoded = decodeHash(REPRO_HASH, canonicalStarIds(model));
  const view = selectionView(model, cons, table, decoded!.selected, 55);
  expect(view.buildOrder).not.toBeNull();
  const members = selectionSummary(model, decoded!.selected).built;
  expect(verifyBuildOrder(cons, members, view.buildOrder!, 55)).toBeNull();
});
