// ABOUTME: Markup tests for the ledger view: rendered final per resistance, breakdown, empty state.
import { test, expect } from "bun:test";
import { resolveLedger } from "../../src/rr/core/ledger";
import { linesMarkup } from "../../src/rr/adapters/ledgerView";
import type { LogicalSource } from "../../src/rr/core/aggregate";
import type { Localization } from "../../src/rr/../ports/Localization";

const loc: Localization = { translate: (k) => k, gameText: (t) => t, locale: "en" };
const src = (o: {
  id: string;
  t: LogicalSource["rrType"];
  res: LogicalSource["resistances"];
  v: number;
  name?: string;
}): LogicalSource =>
  ({
    id: o.id,
    name: o.name ?? o.id,
    rrType: o.t,
    resistances: o.res,
    valueAtMax: o.v,
    perResistance: {},
  }) as LogicalSource;

test("renders the worked-example finals per resistance", () => {
  const sel = [
    src({ id: "a", t: "stacking", res: ["Elemental"], v: -25 }),
    src({ id: "b", t: "reduced-percent", res: ["Fire"], v: 20 }),
    src({ id: "c", t: "reduced-flat", res: ["All"], v: 15 }),
  ];
  const html = linesMarkup(loc, resolveLedger(sel, 100), 100);
  expect(html).toContain(">Fire<");
  expect(html).toContain("45%"); // Fire: (100-25)*0.8 - 15
  expect(html).toContain("60%"); // Cold: (100-25) - 15
});

test("shows the losing mult source struck through", () => {
  const sel = [
    src({ id: "hi", t: "reduced-percent", res: ["Fire"], v: 32, name: "Winner" }),
    src({ id: "lo", t: "reduced-percent", res: ["Fire"], v: 20, name: "Loser" }),
  ];
  const html = linesMarkup(loc, resolveLedger(sel, 100), 100);
  expect(html).toContain("<s>Loser</s>");
  expect(html).toContain("Winner");
});

test("empty selection shows the empty state", () => {
  expect(linesMarkup(loc, resolveLedger([], 100), 100)).toContain("rr.ledger.empty");
});
