// ABOUTME: The affinity panel renders have/need columns: need is red when unmet, green when met.
import { test, expect } from "bun:test";
import { buildModel } from "../src/core/model";
import { renderAffinities } from "../src/adapters/sidebarView";
import type { Vec } from "../src/core/reachability";
import { installEnglish } from "./helpers/localizeEn";

installEnglish();

const doc = {
  meta: { affinities: ["ascendant", "chaos", "eldritch", "order", "primordial"] },
  constellations: [
    {
      id: "Lev",
      name: "Leviathan",
      tier: null,
      affinityRequired: { eldritch: 13, ascendant: 13 },
      affinityBonus: {},
      background: null,
      stars: [{ index: 0, predecessors: [], position: { x: 0, y: 0 }, bonuses: {} }],
    },
  ],
} as any;
const model = buildModel(doc);

function render(have: Vec, need: Vec, src: Map<number, string[]>, selectedBenefits: Set<string> = new Set()) {
  const el = { innerHTML: "" } as any as HTMLElement;
  renderAffinities(el, model, have, need, src, undefined, selectedBenefits);
  return (el as any).innerHTML as string;
}

test("unmet need is flagged missing; met need is flagged met", () => {
  // ascendant index 0, eldritch index 2.
  const html = render(
    [5, 0, 0, 0, 0],
    [13, 0, 13, 0, 0],
    new Map([
      [0, ["Lev"]],
      [2, ["Lev"]],
    ]),
  );
  expect(html).toMatch(/ascendant[\s\S]*?missing[\s\S]*?13/); // have 5 < need 13 -> missing
  const met = render(
    [13, 0, 13, 0, 0],
    [13, 0, 13, 0, 0],
    new Map([
      [0, ["Lev"]],
      [2, ["Lev"]],
    ]),
  );
  expect(met).toMatch(/met/); // have 13 >= need 13 -> met
  expect(html).toContain("Leviathan"); // need source name in a title
});

test("colors with no requirement show only the current total", () => {
  const html = render([0, 0, 0, 0, 0], [0, 0, 0, 0, 0], new Map());
  expect(html).not.toContain("missing");
  expect(html).not.toContain("met");
});

test("affinity row is a group-toggle (data-gkey/gtoggle/ids) with no data-vid", () => {
  const html = render([0, 0, 0, 0, 0], [0, 0, 0, 0, 0], new Map());
  expect(html).toContain('data-gkey="aff:grant:order"');
  expect(html).toContain("data-gtoggle");
  expect(html).toContain('data-ids="aff:grant:order,aff:req:order"');
  expect(html).not.toContain('data-vid="aff:grant:order"');
});

test("an active grant tag marks its affinity row selected (no data-vid on row)", () => {
  const html = render([0, 0, 5, 0, 0], [0, 0, 0, 0, 0], new Map(), new Set(["aff:grant:eldritch"]));
  expect(html).toMatch(/class="affinity affinity-eldritch[^"]*vsel"/);
  expect(html).not.toContain('data-vid="aff:grant:eldritch"');
});
