// ABOUTME: Real-build corpus gate: every harvested community build must get an oracle-legal
// ABOUTME: order at live settings; a null is a false negative, since real players built these.
import { test, expect } from "bun:test";
import { buildOrderPath, selectionSummary, BUDGET } from "../src/core/reachability";
import { verifyBuildOrder } from "../src/core/orderLegality";
import { model, cons, table } from "../scripts/reachability-fuzz";
import fixtureJson from "./fixtures/real-builds.json";

const fixture = fixtureJson as unknown as {
  builds: { source: string; calc: string; title: string; starIds: string[] }[];
};

// Builds proven missed at live settings. Every entry must have a BACKLOG investigation item
// (docs/reachability-engine.md playbook); an empty set is the expected steady state.
const KNOWN_MISSES = new Set<string>([]);

test("fixture is populated and every star exists in the model", () => {
  expect(fixture.builds.length).toBeGreaterThanOrEqual(50);
  for (const b of fixture.builds) {
    expect(b.starIds.length).toBeGreaterThan(0);
    for (const s of b.starIds) expect(model.stars.has(s)).toBe(true);
  }
});

test("every real build gets an oracle-legal order at live settings", () => {
  let misses = 0;
  for (const b of fixture.builds) {
    const members = selectionSummary(model, new Set(b.starIds)).built;
    const steps = buildOrderPath(cons, table, members, BUDGET, 32);
    if (!steps) {
      misses++;
      if (!KNOWN_MISSES.has(b.calc)) console.error(`unexpected miss: ${b.calc} (${b.title})`);
      expect(KNOWN_MISSES.has(b.calc)).toBe(true);
      continue;
    }
    const err = verifyBuildOrder(cons, members, steps, BUDGET);
    if (err) console.error(`${b.calc}: ${err}`);
    expect(err).toBeNull();
  }
  expect(misses).toBe(KNOWN_MISSES.size); // a recovered known miss must be removed from the set
});
