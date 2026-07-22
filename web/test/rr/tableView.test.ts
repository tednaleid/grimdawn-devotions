// ABOUTME: Markup tests for the RR table body: one row per source, badge, whole-row selection state.
import { test, expect } from "bun:test";
import { parseCatalogue } from "../../src/rr/core/model";
import { aggregate } from "../../src/rr/core/aggregate";
import { bodyMarkup, typesLabel } from "../../src/rr/adapters/tableView";
import { DEFAULT_VIEW } from "../../src/rr/core/urlState";
import type { Localization } from "../../src/rr/../ports/Localization";
import doc from "../../../data/resistance-reduction.json";

// Stub localization: translate echoes the key, gameText echoes the tag. Assertions target structure.
const loc: Localization = { translate: (k) => k, gameText: (t) => t, locale: "en" };
const logical = aggregate(parseCatalogue(doc).sources);
const nc = logical.find((s) => s.recordPath.endsWith("veilofshadows2.dbr"))!;

test("one row per source with data-id, resolved name, and RR badge", () => {
  const group = { key: "", items: [nc] };
  const html = bodyMarkup(loc, [group], DEFAULT_VIEW);
  expect(html).toContain(`data-id="${nc.id}"`);
  expect(html).toContain(`role="button"`);
  expect(html).toContain(nc.name); // gameText stub echoes the tag
  expect(html).toContain(`badge b-stacking`);
});

test("a selected row carries selrow and aria-pressed=true", () => {
  const view = { ...DEFAULT_VIEW, sel: new Set([nc.id]) };
  const html = bodyMarkup(loc, [{ key: "", items: [nc] }], view);
  expect(html).toContain("selrow");
  expect(html).toContain(`aria-pressed="true"`);
  const unsel = bodyMarkup(loc, [{ key: "", items: [nc] }], DEFAULT_VIEW);
  expect(unsel).not.toContain("selrow");
  expect(unsel).toContain(`aria-pressed="false"`);
});

test("grouped view emits a group-head row per section", () => {
  const view = { ...DEFAULT_VIEW, group: "mastery" as const };
  const html = bodyMarkup(loc, [{ key: nc.parent, items: [nc] }], view);
  expect(html).toContain("rr-group-head");
  expect(html).toContain(nc.parent);
});

test("Elemental types label expands with extras", () => {
  const elem = { ...nc, resistances: ["Elemental", "Chaos"] };
  expect(typesLabel(loc, elem)).toBe("rr.types.elemental + Chaos");
});
