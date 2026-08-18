// ABOUTME: Tests buildTreeMarkup (treeView.ts's pure, DOM-free half) against the real committed
// ABOUTME: catalogue + icon index: viewBox, node counts/shapes, icons, off-tree row, selection.
import { test, expect } from "bun:test";
import { parseCatalogue } from "../../src/items/core/model";
import { buildTreeMarkup, setIconIndex } from "../../src/items/adapters/treeView";
import type { SkillIconIndex } from "../../src/items/adapters/dataSource";
import doc from "../../../data/skill-items.json";
import iconDoc from "../../../data/skill-icons.json";

const catalogue = parseCatalogue(doc);
// The imported JSON's icons map infers as Record<string, number[]>, not the [number, number]
// tuple the sprite index actually carries (see scripts/build_skill_icons.py) - cast once here.
const icons = iconDoc as unknown as SkillIconIndex;
const masteryRecords = catalogue.masteries.map((m) => m.record);

// A node's own <g> opening tag, in the exact attribute order treeView.ts emits it, so a count of
// matches is a count of rendered nodes (one <g> per skill, real or off-tree).
const G_OPEN = /<g class="([^"]*)" data-group="([^"]*)" data-record="([^"]*)"/g;

function nodeGroups(markup: string): { cls: string; group: string; record: string }[] {
  return [...markup.matchAll(G_OPEN)].map((m) => ({ cls: m[1]!, group: m[2]!, record: m[3]! }));
}

test("every mastery renders with the one fixed viewBox", () => {
  for (const mastery of masteryRecords) {
    const markup = buildTreeMarkup(catalogue.skills, mastery, null);
    expect(markup).toContain('viewBox="246 39 640 420"');
  }
});

test("every mastery renders at least 30 nodes", () => {
  for (const mastery of masteryRecords) {
    const markup = buildTreeMarkup(catalogue.skills, mastery, null);
    expect(nodeGroups(markup).length).toBeGreaterThanOrEqual(30);
  }
});

test("base skills render as squares, everything else as circles", () => {
  const mastery = masteryRecords[0]!;
  const skillsByRecord = new Map(catalogue.skills.map((s) => [s.record, s]));
  const markup = buildTreeMarkup(catalogue.skills, mastery, null);
  for (const { cls, record } of nodeGroups(markup)) {
    const skill = skillsByRecord.get(record)!;
    const wantSquare = skill.nodeKind === "base";
    expect(cls.includes("square")).toBe(wantSquare);
    expect(cls.includes("circle")).toBe(!wantSquare);
  }
});

test("with no icon index wired, nodes render with no <image> (graceful, not a throw)", () => {
  const mastery = masteryRecords[0]!;
  const markup = buildTreeMarkup(catalogue.skills, mastery, null);
  expect(markup).not.toContain("<image");
});

test("every node gets an icon once the sprite index is wired: no missing icon", () => {
  setIconIndex(icons);
  for (const mastery of masteryRecords) {
    const markup = buildTreeMarkup(catalogue.skills, mastery, null);
    const nodeCount = nodeGroups(markup).length;
    const imageCount = (markup.match(/<image /g) ?? []).length;
    expect(imageCount).toBe(nodeCount);
  }
});

// The four Fangs of Asterkarn shapeshift abilities carry null ui_x/ui_y (playerclass10 /
// Berserker); buildTreeMarkup must render them in the off-tree row rather than drop them.
const BERSERKER = "records/skills/playerclass10/_classtraining_class10.dbr";

test("the four off-tree Berserker abilities render, not dropped", () => {
  const markup = buildTreeMarkup(catalogue.skills, BERSERKER, null);
  const offTree = nodeGroups(markup).filter((n) => n.cls.includes("off-tree"));
  expect(offTree.length).toBe(4);
  const expected = new Set([
    "records/skills/playerclass10/wereraven1_skill01_icicles.dbr",
    "records/skills/playerclass10/wereraven1_skill02_icering.dbr",
    "records/skills/playerclass10/werewolf1_skill01_claws.dbr",
    "records/skills/playerclass10/werewolf1_skill02_charge.dbr",
  ]);
  expect(new Set(offTree.map((n) => n.record))).toEqual(expected);
});

test("no two nodes in the same mastery land on the same position", () => {
  // node-shape carries the actual rendered center: a rect's x/y is its top-left (offset from
  // center by the shared radius), a circle's cx/cy is already the center - normalize both.
  const RECT = /class="node-shape" x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/g;
  const CIRCLE = /class="node-shape" cx="([-\d.]+)" cy="([-\d.]+)"/g;
  for (const mastery of masteryRecords) {
    const markup = buildTreeMarkup(catalogue.skills, mastery, null);
    const points = new Set<string>();
    for (const m of markup.matchAll(RECT)) {
      const x = Number(m[1]) + Number(m[3]) / 2;
      const y = Number(m[2]) + Number(m[4]) / 2;
      points.add(`${x},${y}`);
    }
    for (const m of markup.matchAll(CIRCLE)) points.add(`${m[1]},${m[2]}`);
    const total = (markup.match(/class="node-shape"/g) ?? []).length;
    expect(points.size).toBe(total);
  }
});

test("selecting a base skill highlights its whole group, including a modifier sibling", () => {
  const modifier = catalogue.skills.find((s) => s.nodeKind === "modifier" && s.group !== s.record)!;
  const mastery = modifier.mastery;
  const markup = buildTreeMarkup(catalogue.skills, mastery, modifier.group);
  const groups = nodeGroups(markup);
  const base = groups.find((n) => n.record === modifier.group)!;
  const mod = groups.find((n) => n.record === modifier.record)!;
  expect(base.cls.includes("selected")).toBe(true);
  expect(mod.cls.includes("selected")).toBe(true);
  // An unrelated skill (a different group entirely) in the same mastery must not also light up.
  const other = groups.find((n) => n.group !== modifier.group);
  expect(other?.cls.includes("selected")).toBe(false);
});

test("a selected id absent from the catalogue (a stale link) selects nothing, never throws", () => {
  const mastery = masteryRecords[0]!;
  const markup = buildTreeMarkup(catalogue.skills, mastery, "no-such-skill-record");
  expect(nodeGroups(markup).some((n) => n.cls.includes("selected"))).toBe(false);
});
