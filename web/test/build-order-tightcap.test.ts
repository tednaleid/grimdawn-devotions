// ABOUTME: Tight-cap adversarial corpus guard: near-cap, refund-heavy builds pinned by
// ABOUTME: scripts/hunt-tight-cap.ts must always get an oracle-legal order; minBuildableCap too.
import { test, expect } from "bun:test";
import { buildOrderPath, minBuildableCap, buildReachCons, buildCoverTable } from "../src/core/reachability";
import { verifyBuildOrder } from "../src/core/orderLegality";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import fixtureJson from "./fixtures/tight-cap-builds.json";

const fixture = fixtureJson as unknown as { cases: { label: string; sel: Record<string, number> }[] };
const model = buildModel(doc as any);
const cons = buildReachCons(model);
const table = buildCoverTable(cons);
const byId = new Map(cons.map((c) => [c.id, c]));
const membersOf = (sel: Record<string, number>) => Object.keys(sel).map((id) => byId.get(id)!);

test("tight-cap corpus: every pinned build gets an oracle-legal order at 55", () => {
  expect(fixture.cases.length).toBeGreaterThan(0);
  for (const c of fixture.cases) {
    const members = membersOf(c.sel);
    const steps = buildOrderPath(cons, table, members, 55, 16);
    expect(steps).not.toBeNull();
    const err = verifyBuildOrder(cons, members, steps!, 55);
    if (err) console.error(`${c.label}: ${err}`);
    expect(err).toBeNull();
  }
});

test("minBuildableCap's reported cap replays legally (escalated-path coverage)", () => {
  const members = membersOf(fixture.cases[0]!.sel);
  const size = members.reduce((n, c) => n + c.size, 0);
  const cap = minBuildableCap(cons, table, members, size);
  expect(cap).not.toBeNull();
  const steps = buildOrderPath(cons, table, members, cap!, 256);
  expect(steps).not.toBeNull();
  const err = verifyBuildOrder(cons, members, steps!, cap!);
  if (err) console.error(err);
  expect(err).toBeNull();
});
