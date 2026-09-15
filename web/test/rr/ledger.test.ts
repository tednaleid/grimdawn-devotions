// ABOUTME: Tests the pure ledger resolution: stack sum, then single-highest mult (sign-aware), then flat.
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

test("mult deepens a resistance that stacking has already driven negative (forum-tested example)", () => {
  // https://forums.crateentertainment.com/t/actual-resist-reduction-formula/47174: R0 = 0, Y = -30, Z = 51, X = 43
  // -> (0 - 30) * (1 + 0.51) - 43 = -88.3
  const sel = [
    src({ id: "stack", t: "stacking", res: ["Cold"], v: -30 }),
    src({ id: "mult", t: "reduced-percent", res: ["Cold"], v: 51 }),
    src({ id: "flat", t: "reduced-flat", res: ["Cold"], v: 43 }),
  ];
  const cold = resolveLedger(sel, 0).find((l) => l.resistance === "Cold")!;
  expect(cold.final).toBeCloseTo(-88.3, 6);
});

test("reproduces the in-game damage table from the origin thread within display rounding", () => {
  // https://forums.crateentertainment.com/t/actual-resist-reduction-formula/47174 (DenisMashutikov, 2018).
  // Olexra's Flash Freeze at 178 cold damage (rounded display) against targets at each starting cold
  // resistance, under every combination of -30% stacking, 51% multiplicative, and 43 flat. Each cell
  // is the damage the author measured in game; predicted damage is 178 * (100 - final) / 100.
  const starts = [0, 50, 75, 100, -50];
  const measured: { stack: number; mult: number; flat: number; damage: number[] }[] = [
    { stack: 0, mult: 0, flat: 0, damage: [178, 89, 44, 0, 266] },
    { stack: 30, mult: 0, flat: 0, damage: [231, 142, 98, 53, 320] },
    { stack: 0, mult: 0, flat: 43, damage: [254, 168, 121, 76, 343] },
    { stack: 0, mult: 51, flat: 0, damage: [178, 134, 112, 91, 312] },
    { stack: 30, mult: 0, flat: 43, damage: [307, 218, 174, 130, 396] },
    { stack: 30, mult: 51, flat: 0, damage: [258, 160, 138, 117, 392] },
    { stack: 0, mult: 51, flat: 43, damage: [254, 210, 189, 167, 388] },
    { stack: 30, mult: 51, flat: 43, damage: [334, 237, 215, 193, 469] },
  ];
  for (const row of measured) {
    const sel = [
      src({ id: "stack", t: "stacking", res: ["Cold"], v: -row.stack }),
      src({ id: "mult", t: "reduced-percent", res: ["Cold"], v: row.mult }),
      src({ id: "flat", t: "reduced-flat", res: ["Cold"], v: row.flat }),
    ];
    row.damage.forEach((measuredDamage, i) => {
      const final = resolveLedger(sel, starts[i]!).find((l) => l.resistance === "Cold")!.final;
      const predicted = (178 * (100 - final)) / 100;
      // Base damage and every cell are rounded in-game displays; the largest gap in the table is 2.5.
      expect(Math.abs(predicted - measuredDamage)).toBeLessThanOrEqual(3);
    });
  }
});

test("resolves the Japanese wiki worked example on both sides of zero", () => {
  // https://wikiwiki.jp/gdcrate/Combat%20Mechanics (デバフの種類と計算式). Enemy at 60% Fire and Chaos. Fire: A 32, B 30 + 23 = 53, C 18 -> (60 - 53) * 0.82 - 32 = -26.26
  // Chaos: A 25, B 35 + 35 = 70, C 18 -> (60 - 70) * 1.18 - 25 = -36.8
  const sel = [
    src({ id: "agonizing-flames", t: "reduced-flat", res: ["All"], v: 25 }),
    src({ id: "elemental-storm", t: "reduced-flat", res: ["Elemental"], v: 32 }),
    src({
      id: "hellfire-mine",
      t: "stacking",
      res: ["Elemental", "Chaos"],
      v: -30,
      pr: { Elemental: -30, Chaos: -35 },
    }),
    src({ id: "eldritch-fire", t: "stacking", res: ["Fire", "Chaos"], v: -23, pr: { Fire: -23, Chaos: -35 } }),
    src({ id: "terror", t: "reduced-percent", res: ["All"], v: 18 }),
  ];
  const lines = resolveLedger(sel, 60);
  expect(lines.find((l) => l.resistance === "Fire")!.final).toBeCloseTo(-26.26, 6);
  expect(lines.find((l) => l.resistance === "Chaos")!.final).toBeCloseTo(-36.8, 6);
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
