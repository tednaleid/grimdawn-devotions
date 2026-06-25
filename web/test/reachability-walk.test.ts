// ABOUTME: The committed ground-truth-reachable fixture, split by what the engine does today. 'guard-*'
// ABOUTME: builds main already reaches (a regression guard - they must stay reachable). 'false-dim-*' and the
// ABOUTME: named builds are constructor-confirmed reachable yet main wrongly DIMS them (red now, green once
// ABOUTME: main's tight-build false-dims are fixed). Regenerate against the engine with `just gen-reach-fixtures`.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import fixtureJson from "./fixtures/reachable-builds.json";
import { buildModel } from "../src/core/model";
import { buildReachCons, buildCoverTable, classifyForSelection } from "../src/core/reachability";
import { stateFromCounts } from "./support/reach-oracle";

const fixture = fixtureJson as unknown as { cases: { label: string; sel: Record<string, number> }[] };
const model = buildModel(doc as any);
const cons = buildReachCons(model);
const table = buildCoverTable(cons);
const idx = new Map(cons.map((c, i) => [c.id, i]));

const reaches = (sel: Record<string, number>): boolean => {
  const counts = cons.map(() => 0);
  for (const [id, n] of Object.entries(sel)) counts[idx.get(id)!] = n;
  return classifyForSelection(cons, table, stateFromCounts(counts, cons), 55) === "reachable";
};
const dimCount = (cases: { label: string; sel: Record<string, number> }[]): { dimmed: number; ex: string[] } => {
  let dimmed = 0;
  const ex: string[] = [];
  for (const c of cases)
    if (!reaches(c.sel)) {
      dimmed++;
      if (ex.length < 6) ex.push(c.label);
    }
  return { dimmed, ex };
};

const guards = fixture.cases.filter((c) => c.label.startsWith("guard-"));
const knownFalseDims = fixture.cases.filter((c) => !c.label.startsWith("guard-")); // false-dim-* + named

test("reachable guard builds stay reachable (no false-dim regression)", () => {
  const { dimmed, ex } = dimCount(guards);
  if (dimmed) console.log(`${dimmed}/${guards.length} guards wrongly dimmed; e.g. ${ex.join(", ")}`);
  expect(dimmed).toBe(0);
}, 600_000);

test("known false-dim builds classify reachable (peak witness)", () => {
  // Each is constructor-confirmed reachable (e.g. thunder-warder-real-forum-build). The sampled peak
  // witness (minPeakSampled in classifyForSelection) now reaches them all; this guards that fix.
  const { dimmed, ex } = dimCount(knownFalseDims);
  if (dimmed)
    console.log(`${dimmed}/${knownFalseDims.length} false-dim builds still wrongly dimmed; e.g. ${ex.join(", ")}`);
  expect(dimmed).toBe(0);
}, 600_000);
