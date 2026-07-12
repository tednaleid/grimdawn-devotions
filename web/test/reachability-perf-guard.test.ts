// ABOUTME: Per-click perf regression guard for the tight self-covering build class - the states the
// ABOUTME: seeded perf harness under-samples (it walks random additive games, not tight near-budget builds).
// ABOUTME: A regression that makes the peak witness expensive again (e.g. an un-early-exiting search) shows
// ABOUTME: up here as a multi-second selectionView. Coarse wall-clock bound; only meant to catch seconds-scale.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import fixtureJson from "./fixtures/reachable-builds.json";
import { buildModel } from "../src/core/model";
import { buildReachCons, buildCoverTable, selectionView } from "../src/core/reachability";
import { canonicalStarIds, decodeHash } from "../src/core/urlState";

const model = buildModel(doc as any);
const cons = buildReachCons(model);
const table = buildCoverTable(cons);
const fixture = fixtureJson as unknown as { cases: { label: string; sel: Record<string, number> }[] };

// A fixture's per-constellation star COUNT -> a real star selection (the first `count` stars, which are in
// predecessor order, so the selection is legal). These are the tight near-55-point self-covering builds.
const selOf = (sel: Record<string, number>): Set<string> => {
  const out = new Set<string>();
  for (const [conId, count] of Object.entries(sel)) {
    const c = model.constellations.get(conId);
    if (!c) continue;
    for (let i = 0; i < count && i < c.starIds.length; i++) out.add(c.starIds[i]!);
  }
  return out;
};

// The exact real-user regression: a 47-point build where completing Affliction was a 4.5s hang before the
// sampled witness (it was 4564ms with the full peakCost min-search, 85ms after). Guard both the base state
// and the post-click state.
const TED_STATES = [
  "#p=55&s=AAAAAAAAAAA8AAAAAAAAAAAAAAAAAAAAAAAA4A_8AAAAAAAAAAAAwA8AAADAD_4P",
  "#p=55&s=AAAAAAAAAAA8AAAAAAAAAAAAAAAAAAAA-AMA4A_8AAAAAAAAAAAAwA8AAADAD_4P",
  // The two confirmed real-map false-reaches: selectionView now also computes buildOrder (tries=16),
  // which on these unreachable builds runs all 16 passes (no early exit) - the worst build-order cost.
  "#p=55&s=HwAAAAAAAD4AAAAABzwAAAAAAAAAAACABwDAHwAAAAAA4AcAAAAAAACA_wMA8AEAAAAf",
  "#p=55&s=AADwAQCADwAAAAAfAAAAAAAAAAAAAD4AAAAAAPADAAAA4AcAAAAAPwCA_wMAAMAP",
  // Partial-constellation reachability states: 4 spare points with Korvaak and Tortoise enterable but
  // not completable - the maxK binary searches run on exactly these near-budget sweeps.
  "#p=55&s=AAAAAAEHAAAAOAAAOAA8PAA8APgHAAB4AHwAAAAAAAAAAAAAAAAAAAB8AAAAAAAAAAAAAAAAAAAAAAAAAADAHw",
  "#p=55&s=AAAAAAEHAAAAOAAAOAA8PAA8APgHAAB4AHwAAAAAAAAAAAAAAAAAAAB8AAAAAAAAAAAAAAAAAAAAAOACAADAHw",
];

// Generous: the witness states run ~85ms and the resolver tail ~300ms here; the pre-fix regression was
// 4.5s. 1500ms catches a seconds-scale regression with wide margin for slow CI, without flaking on the norm.
const MAX_MS = 1500;

test("selectionView stays fast on tight self-covering builds (peak-witness regression guard)", () => {
  const canon = canonicalStarIds(model);
  const states: { label: string; sel: Set<string> }[] = [
    ...fixture.cases.map((c) => ({ label: c.label, sel: selOf(c.sel) })),
    ...TED_STATES.map((h, i) => ({ label: `ted-${i}`, sel: decodeHash(h, canon)!.selected })),
  ];
  let worst = { label: "", ms: 0 };
  for (const { label, sel } of states) {
    selectionView(model, cons, table, sel, 55); // warm (JIT)
    const t0 = Bun.nanoseconds();
    selectionView(model, cons, table, sel, 55);
    const ms = (Bun.nanoseconds() - t0) / 1e6;
    if (ms > worst.ms) worst = { label, ms };
  }
  if (worst.ms > MAX_MS) console.log(`slowest selectionView: ${worst.ms.toFixed(0)}ms on ${worst.label}`);
  expect(worst.ms).toBeLessThan(MAX_MS);
}, 120_000);
