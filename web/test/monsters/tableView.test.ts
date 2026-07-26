// ABOUTME: Markup tests for the monster table: columns, sort affordances, provenance markers.
// ABOUTME: Pins that the aura marker flips meaning with the toggle, which is easy to get wrong.
import { test, expect } from "bun:test";
import { tableMarkup } from "../../src/monsters/adapters/tableView";
import { DEFAULT_VIEW, type ViewState } from "../../src/monsters/core/urlState";
import { DAMAGE_TYPES } from "../../src/monsters/core/facets";
import type { Localization } from "../../src/ports/Localization";
import type { Monster, Resistances } from "../../src/monsters/core/model";

const ZERO = Object.fromEntries(DAMAGE_TYPES.map((t) => [t, 0])) as Resistances;
const loc: Localization = { translate: (k) => k, gameText: (t) => t, locale: "en" };

function mon(over: Partial<Monster> = {}): Monster {
  return {
    id: "enemies.a",
    nameTag: "tagA",
    classification: "Hero",
    role: "hero",
    raceTag: null,
    minLevel: 1,
    maxLevel: 100,
    isSummon: false,
    variantCount: 1,
    variantsDisagree: false,
    resistances: { ...ZERO },
    passive: {},
    aura: {},
    ...over,
  };
}

const nameOf = (m: Monster) => `Name:${m.id}`;
function view(over: Partial<ViewState> = {}): ViewState {
  return { ...DEFAULT_VIEW, ...over };
}
/** The cell markup for one damage type on the single-row fixtures below. */
function cellFor(html: string, type: string): string {
  return html.split(`data-cell="${type}"`)[1]!.split("</td>")[0]!;
}

test("renders three facet columns plus one per damage type", () => {
  const html = tableMarkup(loc, [mon()], view(), ZERO, nameOf);
  expect([...html.matchAll(/<th /g)]).toHaveLength(3 + 10);
});

test("renders one row per monster with the resolved name", () => {
  const html = tableMarkup(loc, [mon({ id: "enemies.a" }), mon({ id: "enemies.b" })], view(), ZERO, nameOf);
  expect([...html.matchAll(/<tr data-id=/g)]).toHaveLength(2);
  expect(html).toContain("Name:enemies.a");
});

test("cells show the effective value including the offset", () => {
  const html = tableMarkup(
    loc,
    [mon({ resistances: { ...ZERO, fire: 30 } })],
    view(),
    { ...ZERO, fire: 8 } as Resistances,
    nameOf,
  );
  expect(cellFor(html, "fire")).toContain(">38");
});

test("a negative cell is marked so it reads as taking extra damage", () => {
  const html = tableMarkup(loc, [mon({ resistances: { ...ZERO, fire: -20 } })], view(), ZERO, nameOf);
  expect(html).toContain('class="cell neg" data-cell="fire"');
});

test("the negative marker starts below zero, not at it", () => {
  // Pins the boundary the way the 100 case does. Zero is neutral, not a weakness, so a
  // `<= 0` slip would mislabel every unresisted type on every monster in the table.
  const atZero = tableMarkup(loc, [mon({ resistances: { ...ZERO, fire: 0 } })], view(), ZERO, nameOf);
  expect(atZero).toContain('class="cell" data-cell="fire"');
  expect(atZero).not.toContain('class="cell neg" data-cell="fire"');
  const justBelow = tableMarkup(loc, [mon({ resistances: { ...ZERO, fire: -1 } })], view(), ZERO, nameOf);
  expect(justBelow).toContain('class="cell neg" data-cell="fire"');
});

test("a value at or above 100 is marked as a wall", () => {
  const html = tableMarkup(loc, [mon({ resistances: { ...ZERO, fire: 100 } })], view(), ZERO, nameOf);
  expect(html).toContain('class="cell over" data-cell="fire"');
});

test("a nonzero cell is heat-shaded by its type's full color, scaled by value/100", () => {
  // 40, not some multiple of 10 that a /10-vs-/100 divisor mutant could still satisfy at a
  // round number, pins the exact divisor shade() uses. 34% also pins the 0.85 ceiling: an
  // implementation that ramped all the way to opaque would render 40% here.
  const html = tableMarkup(loc, [mon({ resistances: { ...ZERO, fire: 40 } })], view(), ZERO, nameOf);
  expect(cellFor(html, "fire")).toContain('style="background:color-mix(in srgb, var(--t-fire) 34%, transparent)"');
  // The -dim partner is the histogram/legend hue; using it here is the bug this pins.
  expect(cellFor(html, "fire")).not.toContain("--t-fire-dim");
});

test("a zero-value cell carries no background shading", () => {
  const html = tableMarkup(loc, [mon({ resistances: { ...ZERO, fire: 0 } })], view(), ZERO, nameOf);
  expect(cellFor(html, "fire")).not.toContain("background");
});

test("the heat tint saturates at 100 rather than overflowing past it", () => {
  const html = tableMarkup(loc, [mon({ resistances: { ...ZERO, fire: 250 } })], view(), ZERO, nameOf);
  expect(cellFor(html, "fire")).toContain('style="background:color-mix(in srgb, var(--t-fire) 85%, transparent)"');
});

test("no level column is rendered", () => {
  // max_level is 250 on 1,630 of the 1,635 real rows, so the column carried no information.
  // The fields stay on the model; this pins that the table stopped printing them.
  const html = tableMarkup(loc, [mon({ minLevel: 3, maxLevel: 77 })], view(), ZERO, nameOf);
  expect(html).not.toContain("monsters.table.colLevel");
  expect(html).not.toContain("mon-num");
  expect(html).not.toContain(">77<");
});

test("a passive marker appears only on the types a passive contributed to", () => {
  const html = tableMarkup(loc, [mon({ passive: { bleeding: 80 } })], view(), ZERO, nameOf);
  // Scoped to <tbody>: the legend also carries a class="prov passive" key swatch (by design,
  // so it visually matches the row markers), which a whole-document count would double-count.
  const body = html.split("<tbody>")[1]!.split("</tbody>")[0]!;
  expect([...body.matchAll(/class="prov passive"/g)]).toHaveLength(1);
  expect(cellFor(html, "bleeding")).toContain("prov passive");
  expect(cellFor(html, "fire")).not.toContain("prov passive");
});

test("the aura marker says EXCLUDED when the toggle is off", () => {
  const html = tableMarkup(loc, [mon({ aura: { cold: 20 } })], view({ includeAuras: false }), ZERO, nameOf);
  expect(cellFor(html, "cold")).toContain("monsters.table.auraExcludedTitle");
  expect(cellFor(html, "cold")).not.toContain("monsters.table.auraIncludedTitle");
});

test("the aura marker says INCLUDED when the toggle is on", () => {
  const html = tableMarkup(loc, [mon({ aura: { cold: 20 } })], view({ includeAuras: true }), ZERO, nameOf);
  expect(cellFor(html, "cold")).toContain("monsters.table.auraIncludedTitle");
  expect(cellFor(html, "cold")).not.toContain("monsters.table.auraExcludedTitle");
});

test("the aura value is in the cell only when the toggle is on", () => {
  const m = mon({ resistances: { ...ZERO, cold: 10 }, aura: { cold: 20 } });
  expect(cellFor(tableMarkup(loc, [m], view({ includeAuras: false }), ZERO, nameOf), "cold")).toContain(">10");
  expect(cellFor(tableMarkup(loc, [m], view({ includeAuras: true }), ZERO, nameOf), "cold")).toContain(">30");
});

test("the legend text follows the toggle too", () => {
  expect(tableMarkup(loc, [mon()], view({ includeAuras: false }), ZERO, nameOf)).toContain(
    "monsters.legend.auraExcluded",
  );
  expect(tableMarkup(loc, [mon()], view({ includeAuras: true }), ZERO, nameOf)).toContain(
    "monsters.legend.auraIncluded",
  );
});

test("a disagreeing row carries a warning marker", () => {
  const html = tableMarkup(loc, [mon({ variantsDisagree: true })], view(), ZERO, nameOf);
  expect(html).toContain('class="disagree"');
});

test("a summon row is labelled as one", () => {
  const html = tableMarkup(loc, [mon({ isSummon: true })], view(), ZERO, nameOf);
  expect(html).toContain("monsters.table.summonSuffix");
});

test("the sorted column is marked with aria-sort in the right direction", () => {
  const desc = tableMarkup(loc, [mon()], view({ sortKey: "fire", sortDir: -1 }), ZERO, nameOf);
  expect(desc).toContain('data-key="fire" aria-sort="descending"');
  const asc = tableMarkup(loc, [mon()], view({ sortKey: "fire", sortDir: 1 }), ZERO, nameOf);
  expect(asc).toContain('data-key="fire" aria-sort="ascending"');
});

test("only the sorted column carries aria-sort", () => {
  const html = tableMarkup(loc, [mon()], view({ sortKey: "fire", sortDir: 1 }), ZERO, nameOf);
  expect([...html.matchAll(/aria-sort=/g)]).toHaveLength(1);
});

test("a name containing markup characters is escaped", () => {
  const html = tableMarkup(loc, [mon()], view(), ZERO, () => 'Ras<script>"&');
  expect(html).toContain("Ras&lt;script&gt;&quot;&amp;");
  expect(html).not.toContain("<script>");
});

test("an empty row set renders an empty state, not a bare header", () => {
  const html = tableMarkup(loc, [], view(), ZERO, nameOf);
  expect(html).toContain("monsters.table.empty");
  expect(html).not.toContain("<tr data-id=");
});
