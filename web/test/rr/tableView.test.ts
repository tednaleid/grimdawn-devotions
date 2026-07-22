// ABOUTME: Markup tests for the RR table body: one row per source, badge, whole-row selection state.
import { test, expect } from "bun:test";
import { parseCatalogue } from "../../src/rr/core/model";
import { aggregate } from "../../src/rr/core/aggregate";
import { bodyMarkup, typesLabel, triggerLabel } from "../../src/rr/adapters/tableView";
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

// Interpolating stub so format keys compose (the echo stub above can't show interpolation).
const locI: Localization = {
  translate: (k, p) =>
    k === "rr.proc.fmt" ? `${p!.chance}% ${p!.when}` : k === "rr.tier.mythicalName" ? `Mythical ${p!.name}` : k,
  gameText: (t) => t,
  locale: "en",
};

test("a proc source's trigger reads as chance + condition, not the coarse category", () => {
  const proc = { ...nc, triggerChancePercent: 10, procCondition: "AttackEnemy" };
  const label = triggerLabel(locI, proc);
  expect(label).toContain("10%");
  expect(label).toContain("AttackEnemy");
});

test("a non-proc source keeps its coarse trigger label", () => {
  const passive = { ...nc, triggerChancePercent: null, procCondition: null, trigger: "passive aura" };
  expect(triggerLabel(locI, passive)).toBe("rr.trigger.passiveaura");
});

test("a Mythical (Tier-3) grant prefixes the item name with Mythical", () => {
  const myth = { ...nc, name: "Bitter Winds", parent: "Scion of Bitter Winds", mythical: true };
  const html = bodyMarkup(locI, [{ key: "", items: [myth] }], DEFAULT_VIEW);
  expect(html).toContain("Mythical Scion of Bitter Winds");
});
