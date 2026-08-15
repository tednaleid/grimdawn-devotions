// ABOUTME: The peak witness must be backed by a legal schedule: whenever it lights a build within a budget,
// ABOUTME: buildOrderPath finds a construction order at that budget that the independent oracle verifies.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import fixtureJson from "./fixtures/reachable-builds.json";
import { buildModel } from "../src/core/model";
import {
  buildCoverTable,
  buildOrderPath,
  buildReachCons,
  minPeakSampled,
  selectionMinCost,
  selectionSummary,
  type ReachCon,
} from "../src/core/reachability";
import { verifyBuildOrder } from "../src/core/orderLegality";
import { stateFromCounts, mulberry32 } from "./support/reach-oracle";
import { genSelfCovering } from "./support/walk-fuzzer";

const model = buildModel(doc as any);
const cons = buildReachCons(model);
const table = buildCoverTable(cons);
const idx = new Map(cons.map((c, i) => [c.id, i]));
const fixture = fixtureJson as unknown as { cases: { label: string; sel: Record<string, number> }[] };

// The witness and the panel run the same schedule generator, so a lit build has a verified order at the
// same tries and scaffold-search cap: reachable means "here is a legal schedule", not "a model says so".
const TRIES = 32;
const CAP = 3000;
function litImpliesVerifiedOrder(B: ReachCon[], budget: number, label: string): void {
  if (minPeakSampled(cons, table, B, budget, TRIES, CAP) > budget) return;
  const steps = buildOrderPath(cons, table, B, budget, TRIES, CAP);
  expect(steps, `${label} at ${budget}: lit by the witness but no order`).not.toBeNull();
  expect(verifyBuildOrder(cons, B, steps!, budget), `${label} at ${budget}`).toBeNull();
}

test("every witness-lit fixture build has an oracle-verified order at 55 and at its own size", () => {
  for (const c of fixture.cases) {
    const counts = cons.map(() => 0);
    for (const [id, k] of Object.entries(c.sel)) counts[idx.get(id)!] = k;
    const st = stateFromCounts(counts, cons);
    if (st.partialFinish.length) continue;
    litImpliesVerifiedOrder(st.built, 55, c.label);
    litImpliesVerifiedOrder(st.built, st.own, c.label);
  }
}, 120_000);

test("every witness-lit generated build has an oracle-verified order at its own size and one above", () => {
  let checked = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const b = genSelfCovering(cons, 55, mulberry32(seed * 7 + 1), 46);
    if (!b) continue;
    const st = stateFromCounts(b, cons);
    litImpliesVerifiedOrder(st.built, st.own, `gen${seed}`);
    litImpliesVerifiedOrder(st.built, st.own + 1, `gen${seed}`);
    checked++;
  }
  expect(checked).toBeGreaterThan(100);
}, 120_000);

// A 53-point build whose cheapest schedule needs a scaffold swap (add the new one before the old one may
// be refunded) that a per-step model without transitions undercounts by one: it lit at 53 with no legal
// order below 54. The validity floor must be a budget the panel can actually build at.
test("the validity floor is a budget with a verified order (scaffold-swap build)", () => {
  const sel = {
    crane: 5,
    crossroads_chaos: 1,
    crossroads_eldritch: 1,
    ghoul: 5,
    tortoise: 5,
    alladrah_s_phoenix: 5,
    bysmiel_s_bonds: 5,
    huntress: 7,
    magi: 7,
    manticore: 6,
    widow: 6,
  };
  const selected = new Set<string>();
  for (const id of Object.keys(sel)) for (const sid of model.constellations.get(id)!.starIds) selected.add(sid);
  expect(selected.size).toBe(53);
  const B = selectionSummary(model, selected).built;
  const floor = selectionMinCost(model, cons, table, selected);
  const steps = buildOrderPath(cons, table, B, floor, TRIES, CAP);
  expect(steps, `no verified order at the validity floor ${floor}`).not.toBeNull();
  expect(verifyBuildOrder(cons, B, steps!, floor)).toBeNull();
  litImpliesVerifiedOrder(B, 53, "scaffold-swap build");
});
