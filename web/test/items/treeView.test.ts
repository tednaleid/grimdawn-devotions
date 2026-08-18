// ABOUTME: Tests buildTreeMarkup (treeView.ts's pure, DOM-free half) against the real committed
// ABOUTME: catalogue + icon index: viewBox, node counts/shapes, icons, off-tree row, selection.
import { test, expect } from "bun:test";
import { parseCatalogue } from "../../src/items/core/model";
import type { Skill } from "../../src/items/core/model";
import { buildTreeMarkup, type TreeContext } from "../../src/items/adapters/treeView";
import type { SkillIconIndex } from "../../src/items/adapters/dataSource";
import doc from "../../../data/skill-items.json";
import iconDoc from "../../../data/skill-icons.json";

const catalogue = parseCatalogue(doc);
// The imported JSON's icons map infers as Record<string, number[]>, not the [number, number]
// tuple the sprite index actually carries (see scripts/build_skill_icons.py) - cast once here.
const icons = iconDoc as unknown as SkillIconIndex;
const masteryRecords = catalogue.masteries.map((m) => m.record);

// A plain, no-loc name resolver: real enough to exercise the aria-label/title plumbing without
// pulling in Localization. Every test builds its own ctx (no shared module state - see
// task-15-fix-1.md), so tests never depend on execution order.
const nameOf = (skill: Skill): string => skill.nameTag ?? skill.record;
const ctx: TreeContext = { icons, nameOf };
const noIconsCtx: TreeContext = { icons: { cell: 32, columns: 1, icons: {} }, nameOf };
// "nothing selected", the state most of these tests render in.
const NONE: ReadonlySet<string> = new Set<string>();

// A node's own <g> opening tag, in the exact attribute order treeView.ts emits it, so a count of
// matches is a count of rendered nodes (one <g> per skill, real or off-tree).
const G_OPEN = /<g class="([^"]*)" data-group="([^"]*)" data-record="([^"]*)"/g;

function nodeGroups(markup: string): { cls: string; group: string; record: string }[] {
  return [...markup.matchAll(G_OPEN)].map((m) => ({ cls: m[1]!, group: m[2]!, record: m[3]! }));
}

test("every mastery renders with the one fixed viewBox", () => {
  for (const mastery of masteryRecords) {
    const markup = buildTreeMarkup(catalogue.skills, mastery, NONE, ctx);
    expect(markup).toContain('viewBox="226 19 680 460"');
  }
});

// The pin above says every mastery gets the SAME box; this says it is the RIGHT box. The game's
// coordinates are node centres and its extreme nodes sit exactly on all four edges of the range,
// so a viewBox of the bare coordinate range cuts every edge node in half - the bottom row hung
// over the panel behind the SVG until the box was padded by a node radius.
test("every node is drawn entirely inside the viewBox", () => {
  const SHAPE = /<(rect|circle) class="node-shape" ([^/]+)\/>/g;
  const attr = (s: string, name: string): number => Number(new RegExp(`(?:^| )${name}="([^"]+)"`).exec(s)![1]);
  for (const mastery of masteryRecords) {
    const markup = buildTreeMarkup(catalogue.skills, mastery, NONE, ctx);
    const [vx, vy, vw, vh] = /viewBox="([^"]+)"/.exec(markup)![1]!.split(" ").map(Number) as number[];
    const shapes = [...markup.matchAll(SHAPE)];
    expect(shapes.length).toBe(nodeGroups(markup).length);
    for (const [, kind, a] of shapes) {
      const box =
        kind === "rect"
          ? {
              l: attr(a!, "x"),
              t: attr(a!, "y"),
              r: attr(a!, "x") + attr(a!, "width"),
              b: attr(a!, "y") + attr(a!, "height"),
            }
          : {
              l: attr(a!, "cx") - attr(a!, "r"),
              t: attr(a!, "cy") - attr(a!, "r"),
              r: attr(a!, "cx") + attr(a!, "r"),
              b: attr(a!, "cy") + attr(a!, "r"),
            };
      // Half the selected node's 3px border, which is drawn outside the shape's own geometry.
      const stroke = 1.5;
      expect(box.l - stroke).toBeGreaterThanOrEqual(vx!);
      expect(box.t - stroke).toBeGreaterThanOrEqual(vy!);
      expect(box.r + stroke).toBeLessThanOrEqual(vx! + vw!);
      expect(box.b + stroke).toBeLessThanOrEqual(vy! + vh!);
    }
  }
});

test("every mastery renders at least 30 nodes", () => {
  for (const mastery of masteryRecords) {
    const markup = buildTreeMarkup(catalogue.skills, mastery, NONE, ctx);
    expect(nodeGroups(markup).length).toBeGreaterThanOrEqual(30);
  }
});

test("base skills render as squares, everything else as circles", () => {
  const mastery = masteryRecords[0]!;
  const skillsByRecord = new Map(catalogue.skills.map((s) => [s.record, s]));
  const markup = buildTreeMarkup(catalogue.skills, mastery, NONE, ctx);
  for (const { cls, record } of nodeGroups(markup)) {
    const skill = skillsByRecord.get(record)!;
    const wantSquare = skill.nodeKind === "base";
    expect(cls.includes("square")).toBe(wantSquare);
    expect(cls.includes("circle")).toBe(!wantSquare);
  }
});

test("with no icon in the index, that node renders with no <image> (graceful, not a throw)", () => {
  const mastery = masteryRecords[0]!;
  const markup = buildTreeMarkup(catalogue.skills, mastery, NONE, noIconsCtx);
  expect(markup).not.toContain("<image");
});

test("every node gets an icon from the real sprite index: no missing icon", () => {
  for (const mastery of masteryRecords) {
    const markup = buildTreeMarkup(catalogue.skills, mastery, NONE, ctx);
    const nodeCount = nodeGroups(markup).length;
    const imageCount = (markup.match(/<image /g) ?? []).length;
    expect(imageCount).toBe(nodeCount);
  }
});

// No <title>: the browser renders one as a native tooltip, which raced the hover card and put a
// small bare-name box under the cursor while the card showed. aria-label still names the node.
test("accessible name is resolved via ctx.nameOf, including a null-nameTag fallback", () => {
  const skills: Skill[] = [
    {
      record: "r1",
      mastery: "m",
      group: "r1",
      nodeKind: "base",
      uiX: 246,
      uiY: 39,
      nameTag: "tagFoo",
      descriptionTag: null,
      icon: "i1",
      maxLevel: 1,
      ultimateLevel: 1,
      ranks: [],
      pets: [],
    },
    {
      record: "r2",
      mastery: "m",
      group: "r2",
      nodeKind: "base",
      uiX: 326,
      uiY: 39,
      nameTag: null,
      descriptionTag: null,
      icon: "i2",
      maxLevel: 1,
      ultimateLevel: 1,
      ranks: [],
      pets: [],
    },
  ];
  const namedCtx: TreeContext = {
    icons: { cell: 32, columns: 1, icons: {} },
    nameOf: (skill) => (skill.nameTag ? `Named:${skill.nameTag}` : skill.record),
  };
  const markup = buildTreeMarkup(skills, "m", NONE, namedCtx);
  expect(markup).toContain('aria-label="Named:tagFoo"');
  expect(markup).toContain('aria-label="r2"');
});

// The four Fangs of Asterkarn shapeshift abilities carry null ui_x/ui_y (playerclass10 /
// Berserker); buildTreeMarkup must render them in the off-tree row rather than drop them.
const BERSERKER = "records/skills/playerclass10/_classtraining_class10.dbr";

test("the four off-tree Berserker abilities render, not dropped", () => {
  const markup = buildTreeMarkup(catalogue.skills, BERSERKER, NONE, ctx);
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
    const markup = buildTreeMarkup(catalogue.skills, mastery, NONE, ctx);
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

test("selecting a base skill highlights only that node, not its modifiers", () => {
  // Selection is per node. A group says which upgrades belong to which skill, and picking the
  // base used to drag its whole group in - which also meant picking one of a pair the game files
  // together but treats as independent (Reckless Power / Star Pact) silently selected the other.
  const modifier = catalogue.skills.find((s) => s.nodeKind === "modifier" && s.group !== s.record)!;
  const markup = buildTreeMarkup(catalogue.skills, modifier.mastery, new Set([modifier.group]), ctx);
  const groups = nodeGroups(markup);
  expect(groups.find((n) => n.record === modifier.group)!.cls.includes("selected")).toBe(true);
  expect(groups.find((n) => n.record === modifier.record)!.cls.includes("selected")).toBe(false);
  expect(groups.filter((n) => n.cls.includes("selected")).length).toBe(1);
});

test("selecting a modifier highlights it without dragging in its base", () => {
  const modifier = catalogue.skills.find((s) => s.nodeKind === "modifier" && s.group !== s.record)!;
  const markup = buildTreeMarkup(catalogue.skills, modifier.mastery, new Set([modifier.record]), ctx);
  const groups = nodeGroups(markup);
  expect(groups.find((n) => n.record === modifier.record)!.cls.includes("selected")).toBe(true);
  expect(groups.find((n) => n.record === modifier.group)!.cls.includes("selected")).toBe(false);
});

test("a selected id absent from the catalogue (a stale link) selects nothing, never throws", () => {
  const mastery = masteryRecords[0]!;
  const markup = buildTreeMarkup(catalogue.skills, mastery, new Set(["no-such-skill-record"]), ctx);
  expect(nodeGroups(markup).some((n) => n.cls.includes("selected"))).toBe(false);
});

// The connector lines. These exist because the tree used to render as unconnected icons on a
// black field, giving no hint which upgrades belong to which skill - the relationship is in the
// data (group + nodeKind) and the game draws it, so the tree does too.
const LINE = /<line class="tree-link" x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"\/>/g;

function links(markup: string): { x1: number; y1: number; x2: number; y2: number }[] {
  return [...markup.matchAll(LINE)].map((m) => ({
    x1: Number(m[1]),
    y1: Number(m[2]),
    x2: Number(m[3]),
    y2: Number(m[4]),
  }));
}

test("every on-tree group draws exactly one link per non-base member", () => {
  for (const mastery of masteryRecords) {
    const markup = buildTreeMarkup(catalogue.skills, mastery, NONE, ctx);
    const onTree = catalogue.skills.filter((s) => s.mastery === mastery && s.uiX !== null && s.uiY !== null);
    const byGroup = new Map<string, number>();
    for (const s of onTree) byGroup.set(s.group, (byGroup.get(s.group) ?? 0) + 1);
    let want = 0;
    for (const [group, n] of byGroup) {
      // Only a group whose base is itself on-tree gets links; the chain is anchored on the base.
      if (onTree.some((s) => s.group === group && s.nodeKind === "base")) want += n - 1;
    }
    expect(links(markup).length).toBe(want);
  }
});

test("every link ends on a real node centre, so no line points at empty space", () => {
  for (const mastery of masteryRecords) {
    const markup = buildTreeMarkup(catalogue.skills, mastery, NONE, ctx);
    const centres = new Set<string>();
    for (const m of markup.matchAll(/<circle class="node-shape" cx="([\d.]+)" cy="([\d.]+)"/g)) {
      centres.add(`${m[1]},${m[2]}`);
    }
    // A base renders as a <rect>, whose x/y is the top-left corner: recover its centre.
    for (const m of markup.matchAll(/<rect class="node-shape" x="([\d.]+)" y="([\d.]+)" width="(\d+)"/g)) {
      const half = Number(m[3]) / 2;
      centres.add(`${Number(m[1]) + half},${Number(m[2]) + half}`);
    }
    for (const l of links(markup)) {
      expect(centres.has(`${l.x1},${l.y1}`)).toBe(true);
      expect(centres.has(`${l.x2},${l.y2}`)).toBe(true);
    }
  }
});

test("modifiers chain left to right off the base rather than all radiating from it", () => {
  // Cadence is the clearest case in the data: base at (246,319) with modifiers at 486 and 806 on
  // the same row, and a transmuter off at (326,281). A star layout would link 246->806 directly;
  // the game draws a chain, so the far modifier hangs off the near one.
  const soldier = catalogue.skills.find((s) => s.record.endsWith("cadence1.dbr"))!;
  const markup = buildTreeMarkup(catalogue.skills, soldier.mastery, NONE, ctx);
  const row = links(markup).filter((l) => l.y1 === 319 && l.y2 === 319);
  const spans = row.map((l) => `${l.x1}->${l.x2}`).sort();
  expect(spans).toContain("246->486");
  expect(spans).toContain("486->806");
  expect(spans).not.toContain("246->806");
  // The transmuter joins the base directly, on its own diagonal.
  expect(links(markup)).toContainEqual({ x1: 246, y1: 319, x2: 326, y2: 281 });
});

test("off-tree nodes are left unlinked: they carry no game coordinates to draw a line to", () => {
  const offTree = catalogue.skills.find((s) => s.uiX === null || s.uiY === null)!;
  const markup = buildTreeMarkup(catalogue.skills, offTree.mastery, NONE, ctx);
  // The off-tree row sits at a y the real tree is compressed away from; no link may reach it.
  const offTreeY = 39 + 420 - 60 / 2;
  for (const l of links(markup)) {
    expect(l.y1).not.toBe(offTreeY);
    expect(l.y2).not.toBe(offTreeY);
  }
});

test("selecting two groups highlights both, and leaves the rest alone", () => {
  const mastery = masteryRecords[0]!;
  const groups = [...new Set(catalogue.skills.filter((s) => s.mastery === mastery).map((s) => s.group))];
  const [a, b] = [groups[0]!, groups[1]!];
  const markup = buildTreeMarkup(catalogue.skills, mastery, new Set([a, b]), ctx);
  const selected = nodeGroups(markup).filter((n) => n.cls.includes("selected"));
  expect(new Set(selected.map((n) => n.group))).toEqual(new Set([a, b]));
  expect(selected.length).toBeGreaterThanOrEqual(2);
});
