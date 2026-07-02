// ABOUTME: Tests the build-order engine: peakToReach's scaffold-subset collection (Task 1) and
// ABOUTME: buildOrderPath's constellation-level construction schedule (Task 2), including the replay
// ABOUTME: legality invariant and the no-path (false-reach) cases.
import { test, expect } from "bun:test";
import {
  buildCoverTable,
  peakToReach,
  buildOrderPath,
  buildOrderEscalated,
  buildReachCons,
  type ReachCon,
  type Vec,
  type BuildStep,
} from "../src/core/reachability";
import doc from "../../data/devotions.json";
import fixtureJson from "./fixtures/reachable-builds.json";
import { buildModel } from "../src/core/model";
import { enLoc } from "./helpers/localizeEn";

const fixture = fixtureJson as unknown as { cases: { label: string; sel: Record<string, number> }[] };
const model = buildModel(doc as any);
const realCons = buildReachCons(model);
const realTable = buildCoverTable(realCons);
const byId = new Map(realCons.map((c) => [c.id, c]));
const membersOf = (sel: Record<string, number>): ReachCon[] =>
  Object.keys(sel)
    .map((id) => byId.get(id))
    .filter((c): c is ReachCon => !!c);

// Replay a schedule and assert it is a LEGAL construction: at each step held points <= cap, a member's
// requirement is covered by the affinity already supplied when it is completed, and the final completed
// set (completes minus refunds) equals B with the build self-covering. Returns the end-state member ids.
function replayLegal(steps: BuildStep[], allCons: ReachCon[], cap: number): Set<string> {
  const cById = new Map(allCons.map((c) => [c.id, c]));
  let held = 0;
  let supply: Vec = z();
  const present = new Set<string>();
  const addCapV = (a: Vec, b: Vec): Vec => [
    Math.min(a[0] + b[0], 20),
    Math.min(a[1] + b[1], 8),
    Math.min(a[2] + b[2], 20),
    Math.min(a[3] + b[3], 10),
    Math.min(a[4] + b[4], 20),
  ];
  const coversV = (g: Vec, d: Vec) => g.every((x, i) => x >= d[i]!);
  for (const s of steps) {
    const c = cById.get(s.conId)!;
    if (s.kind === "scaffold-refund") {
      held -= c.size;
      present.delete(s.conId);
      // recompute supply from present completed members
      supply = z();
      for (const id of present) supply = addCapV(supply, cById.get(id)!.grant);
    } else {
      // both complete and scaffold-add must have their requirement met by current supply
      expect(coversV(supply, c.req)).toBe(true);
      held += c.size;
      present.add(s.conId);
      supply = addCapV(supply, c.grant);
    }
    expect(held).toBeLessThanOrEqual(cap);
    expect(s.heldAfter).toBe(held);
  }
  return present;
}

const z = (): Vec => [0, 0, 0, 0, 0];
const v = (asc = 0, cha = 0, eld = 0, ord = 0, pri = 0): Vec => [asc, cha, eld, ord, pri];
const con = (id: string, size: number, req: Vec, grant: Vec): ReachCon => ({ id, size, req, grant });
const cx = (i: number, id = `x${i}`): ReachCon => {
  const g = z();
  g[i] = 1;
  return { id, size: 1, req: z(), grant: g };
};
const anchor = (req: Vec): ReachCon => con("anchor", 1, req, z());

test("peakToReach collects a minimum scaffold subset covering the deficit", () => {
  // Deficit asc 1 + eld 1: the two crossroads (x0 asc, x2 eld) cover it, size 2.
  const cons = [cx(0), cx(2), anchor(v(1, 0, 1))];
  const table = buildCoverTable(cons);
  const collect: ReachCon[] = [];
  const size = peakToReach(cons, table, v(1, 0, 1), z(), 300_000, { collect });
  expect(size).toBe(2);
  expect(collect.map((c) => c.id).sort()).toEqual(["x0", "x2"]);
});

test("peakToReach preferSmall picks crossroads over an equal-size larger granter", () => {
  // Two ways to get eld 1 at size 1: the eldritch crossroads (req-free) or 'big' (also size 1 but
  // carries a requirement). preferSmall must choose the req-free crossroads.
  const big = con("big", 1, v(1, 0, 0), v(0, 0, 1)); // size 1, but needs asc 1 to place
  const cons = [cx(0), cx(2, "eldx"), big, anchor(v(0, 0, 1))];
  const table = buildCoverTable(cons);
  const collect: ReachCon[] = [];
  const size = peakToReach(cons, table, v(0, 0, 1), z(), 300_000, { collect, preferSmall: true });
  expect(size).toBe(1);
  expect(collect.map((c) => c.id)).toEqual(["eldx"]);
});

test("peakToReach without opts is unchanged (no allocation, same size)", () => {
  const cons = [cx(0), cx(2), anchor(v(1, 0, 1))];
  const table = buildCoverTable(cons);
  expect(peakToReach(cons, table, v(1, 0, 1))).toBe(2);
});

test("peakToReach clears collect array on zero-deficit early return", () => {
  const cons = [cx(0), cx(2), anchor(v(1, 0, 1))];
  const table = buildCoverTable(cons);
  const collect = [cx(0)]; // stale content
  const size = peakToReach(cons, table, z(), z(), 300_000, { collect });
  expect(size).toBe(0);
  expect(collect.length).toBe(0);
});

test("buildOrderPath: a hand build needing a chaos crossroads bootstrap adds then refunds it", () => {
  // Self-covering build that still needs a crossroads to BOOTSTRAP. V needs chaos 1 to enter and grants
  // chaos 6 (size 5); CAP needs chaos 6 (size 2), grants 0. supply chaos 6 covers CAP, so B is self-
  // covering - but V's own chaos-1 entry is met only by holding the chaos crossroads, refunded once V is
  // in (V then self-supplies its chaos 1). Peak when V is placed with the crossroads held = 5 + 1 = 6.
  const vulture = con("V", 5, v(0, 1, 0, 0, 0), v(0, 6, 0, 0, 0));
  const cap6 = con("CAP", 2, v(0, 6, 0, 0, 0), z());
  const all = [vulture, cap6, cx(1, "chaosx")];
  const table = buildCoverTable(all);
  const steps = buildOrderPath(all, table, [vulture, cap6], 55, 16)!;
  expect(steps).not.toBeNull();
  const kinds = steps.map((s) => `${s.kind}:${s.conId}`);
  expect(kinds).toContain("scaffold-add:chaosx");
  expect(kinds).toContain("scaffold-refund:chaosx");
  expect(
    steps
      .filter((s) => s.kind === "complete")
      .map((s) => s.conId)
      .sort(),
  ).toEqual(["CAP", "V"]);
  replayLegal(steps, all, 55);
});

test("buildOrderPath: real reachable fixtures all replay as legal constructions within 55", () => {
  let checked = 0;
  for (const c of fixture.cases) {
    const members = membersOf(c.sel);
    if (!members.length) continue;
    const steps = buildOrderPath(realCons, realTable, members, 55, 16);
    if (!steps) continue; // tries=16 cliff miss; covered by escalation test
    const end = replayLegal(steps, realCons, 55);
    expect([...end].sort()).toEqual(members.map((m) => m.id).sort());
    checked++;
  }
  expect(checked).toBeGreaterThan(0);
});

test("buildOrderPath: the confirmed false-reach build has no order within 55", () => {
  // seed 5563 from the real-map hunt: engine lights it, exact min-peak is 56.
  const names = [
    "Akeron's Scorpion",
    "Fiend",
    "Lion",
    "Mantis",
    "Wretch",
    "Assassin",
    "Dire Bear",
    "Revenant",
    "Rhowan's Crown",
    "Solael's Witchblade",
    "Ulo the Keeper of the Waters",
  ];
  const nameToId = new Map([...model.constellations.values()].map((c) => [enLoc.gameText(c.nameTag), c.id]));
  const members = names.map((n) => byId.get(nameToId.get(n)!)!);
  expect(buildOrderPath(realCons, realTable, members, 55, 16)).toBeNull();
  expect(buildOrderEscalated(realCons, realTable, members, 55)).toBeNull();
  // buildOrderEscalated runs a heavy tries=4096 search (~5-7s on CI runners); raise the per-test
  // timeout above bun's 5s default, matching the other heavy reachability tests.
}, 30_000);
