// ABOUTME: Tests the pure ledger resolution: stack sum, then single-highest mult, then flat; sign-aware.
import { test, expect } from "bun:test";
import { resolveLedger } from "../../src/rr/core/ledger";
import type { LogicalSource } from "../../src/rr/core/aggregate";

const src = (o: {
  id: string;
  t: LogicalSource["rrType"];
  res: LogicalSource["resistances"];
  v: number;
  pr?: Record<string, number>;
}): LogicalSource =>
  ({ id: o.id, rrType: o.t, resistances: o.res, valueAtMax: o.v, perResistance: o.pr ?? {} }) as LogicalSource;

test("stack sums, then single-highest mult, then flat; sign-aware", () => {
  const sel = [
    src({ id: "a", t: "stacking", res: ["Elemental"], v: -25 }), // Fire/Cold/Lightning -25 each
    src({ id: "b", t: "reduced-percent", res: ["Fire"], v: 20 }),
    src({ id: "c", t: "reduced-flat", res: ["All"], v: 15 }),
  ];
  const fire = resolveLedger(sel, 100).find((l) => l.resistance === "Fire")!;
  // base = 100 - 25 = 75; *(1 - 0.20) = 60; - 15 = 45
  expect(fire.final).toBe(45);
  const cold = resolveLedger(sel, 100).find((l) => l.resistance === "Cold")!;
  // no mult on Cold: (100-25) - 15 = 60
  expect(cold.final).toBe(60);
});

test("mult cannot cross zero on its own", () => {
  const sel = [src({ id: "a", t: "reduced-percent", res: ["All"], v: 50 })];
  expect(resolveLedger(sel, 10).find((l) => l.resistance === "Fire")!.final).toBe(5); // 10*0.5
});

test("single highest wins among multiple mult sources", () => {
  const sel = [
    src({ id: "a", t: "reduced-percent", res: ["Fire"], v: 20 }),
    src({ id: "b", t: "reduced-percent", res: ["Fire"], v: 32 }),
  ];
  const fire = resolveLedger(sel, 100).find((l) => l.resistance === "Fire")!;
  expect(fire.maxMult).toBe(32);
  expect(fire.bestMult?.id).toBe("b");
  expect(fire.final).toBe(68);
});
