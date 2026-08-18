// ABOUTME: Renders the /items/ page's SVG mastery tree: nodes positioned by the game's own UI
// ABOUTME: coordinates, icons from the skill-icons sprite sheet, clicks delegated to onPick(record).
import { withVersion } from "../../adapters/assetVersion";
import type { Skill } from "../core/model";
import type { SkillIconIndex } from "./dataSource";

// One fixed box serves every mastery: across the whole dataset ui_x spans 246..886 and ui_y spans
// 39..459 (verified against data/skill-items.json - see the task-15 brief), so no mastery ever
// needs its own box.
const BOX_X = 246;
const BOX_Y = 39;
const BOX_W = 640;
const BOX_H = 420;

// Sprite sheet geometry (data/skill-icons.json): 32px cells, 26 columns.
const CELL = 32;

// A handful of skills (currently the four Fangs of Asterkarn shapeshift abilities) carry no
// ui_x/ui_y: they are granted automatically alongside their base skill rather than placed on the
// point-spend tree. Rather than drop them, the real tree's Y range is compressed to free a band
// at the bottom of the SAME fixed box, and they render there as their own row. A mastery with no
// such skills compresses by a scale of 1 (a no-op), so the other nine trees are unaffected.
const OFFTREE_BAND = 60;
const OFFTREE_XS = [326, 486, 646, 806];

const NODE_R = 18; // node border half-size (square) / radius (circle)
const ICON_R = 16; // icon clip half-size (square) / radius (circle): the sprite cell is 32px, unscaled

// Those are node CENTRES, and a node is drawn around its centre: the extreme nodes sit exactly on
// all four edges of the coordinate box (x 246 and 886, y 39 and 459), so the drawn tree is a node
// radius larger than the box on every side. The viewBox is padded by that radius plus the selected
// node's 3px border, so the SVG's own box contains everything it draws instead of the bottom row
// hanging over the panel behind it.
const PAD = NODE_R + 2;
const VIEW_BOX = `${BOX_X - PAD} ${BOX_Y - PAD} ${BOX_W + PAD * 2} ${BOX_H + PAD * 2}`;

const ICON_HREF = withVersion("../data/skill-icons.png");

/** Everything renderTree needs beyond the skill list itself: the sprite sheet index (data is
 *  fetched at boot, not module-level state - see task-15-fix-1.md) and a name resolver so each
 *  node gets a real accessible name/tooltip. Mirrors detailView.ts's DetailContext: the adapter
 *  stays i18n-free, the caller (tableView.ts) supplies a `loc`-backed resolver. */
export interface TreeContext {
  icons: SkillIconIndex;
  nameOf: (skill: Skill) => string;
}

// The packer lays icons out row-major with no gaps (scripts/build_skill_icons.py), so the sheet's
// pixel size is derivable from the icon count and column count alone.
function sheetSize(idx: SkillIconIndex): { w: number; h: number } {
  const rows = Math.ceil(Object.keys(idx.icons).length / idx.columns);
  return { w: idx.columns * idx.cell, h: rows * idx.cell };
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

interface Placed {
  skill: Skill;
  x: number;
  y: number;
  offTree: boolean;
}

// Real (positioned) nodes keep the game's own ui_x/ui_y, Y-compressed only when this mastery has
// off-tree skills to make room for; those render in a fixed row at the bottom of the box.
function placeNodes(skills: Skill[]): Placed[] {
  const real = skills.filter((s) => s.uiX !== null && s.uiY !== null);
  const offTree = skills.filter((s) => s.uiX === null || s.uiY === null);
  const scale = offTree.length > 0 ? (BOX_H - OFFTREE_BAND) / BOX_H : 1;
  const placed: Placed[] = real.map((s) => ({
    skill: s,
    x: s.uiX as number,
    y: BOX_Y + ((s.uiY as number) - BOX_Y) * scale,
    offTree: false,
  }));
  const offTreeY = BOX_Y + BOX_H - OFFTREE_BAND / 2;
  offTree.forEach((s, i) => {
    placed.push({ skill: s, x: OFFTREE_XS[i % OFFTREE_XS.length]!, y: offTreeY, offTree: true });
  });
  return placed;
}

// The connectors the game itself draws between a skill and its upgrades. The layout is the
// game's own (ui_x/ui_y straight off the records), and it puts a base skill's modifiers on the
// base's own row at increasing x - Cadence sits at (246,319) with its two modifiers at 486 and
// 806, same y - while a transmuter branches off the base diagonally, Cadence's at (326,281).
// So the chain is drawn along the row and the transmuter is joined straight back to its base.
// Nothing here needs new data: `group` and `nodeKind` already say which nodes belong together.
function linkMarkup(placed: Placed[]): string {
  const byGroup = new Map<string, Placed[]>();
  for (const p of placed) {
    // An off-tree node carries no game coordinates and is parked in its own row, so a line to it
    // would cross the whole box describing a position the game never gave it.
    if (p.offTree) continue;
    const g = byGroup.get(p.skill.group);
    if (g) g.push(p);
    else byGroup.set(p.skill.group, [p]);
  }
  const segments: string[] = [];
  for (const members of byGroup.values()) {
    const base = members.find((p) => p.skill.nodeKind === "base");
    if (!base) continue;
    // Modifiers chain left to right from the base; a pet_modifier hangs off the base the same
    // way a transmuter does, since it upgrades the summon rather than continuing the row.
    const chain = members.filter((p) => p.skill.nodeKind === "modifier").sort((a, b) => a.x - b.x);
    let prev = base;
    for (const next of chain) {
      segments.push(`<line class="tree-link" x1="${prev.x}" y1="${prev.y}" x2="${next.x}" y2="${next.y}"/>`);
      prev = next;
    }
    for (const p of members) {
      if (p.skill.nodeKind === "modifier" || p === base) continue;
      segments.push(`<line class="tree-link" x1="${base.x}" y1="${base.y}" x2="${p.x}" y2="${p.y}"/>`);
    }
  }
  return segments.join("");
}

function nodeMarkup(
  p: Placed,
  i: number,
  selected: ReadonlySet<string>,
  ctx: TreeContext,
  sheet: { w: number; h: number },
): string {
  const { skill, x, y, offTree } = p;
  const shape = skill.nodeKind === "base" ? "square" : "circle";
  const clipId = `tree-clip-${i}`;
  // Exactly the picked node lights up, not its whole group: a group is a rendering relationship
  // between a skill and its upgrades, not a claim that picking one means picking them all.
  const isSelected = selected.has(skill.record);
  const cls = ["tree-node", shape, offTree ? "off-tree" : "", isSelected ? "selected" : ""].filter(Boolean).join(" ");
  const pressed = isSelected ? "true" : "false";
  const clip =
    shape === "square"
      ? `<rect x="${x - ICON_R}" y="${y - ICON_R}" width="${ICON_R * 2}" height="${ICON_R * 2}"/>`
      : `<circle cx="${x}" cy="${y}" r="${ICON_R}"/>`;
  const border =
    shape === "square"
      ? `<rect class="node-shape" x="${x - NODE_R}" y="${y - NODE_R}" width="${NODE_R * 2}" height="${NODE_R * 2}" rx="4"/>`
      : `<circle class="node-shape" cx="${x}" cy="${y}" r="${NODE_R}"/>`;
  const cell = ctx.icons.icons[skill.icon];
  let icon = "";
  if (cell) {
    const [col, row] = cell;
    const imgX = x - ICON_R - col * CELL;
    const imgY = y - ICON_R - row * CELL;
    icon = `<image class="node-icon" href="${ICON_HREF}" x="${imgX}" y="${imgY}" width="${sheet.w}" height="${sheet.h}" clip-path="url(#${clipId})"/>`;
  }
  // ctx.nameOf is the caller's fallback-to-record resolver (see tableView.ts), so every node gets
  // a real accessible name, not just the ones with a nameTag.
  const name = esc(ctx.nameOf(skill));
  return (
    `<g class="${cls}" data-group="${esc(skill.group)}" data-record="${esc(skill.record)}" aria-label="${name}" aria-pressed="${pressed}" tabindex="0" role="button">` +
    `<clipPath id="${clipId}">${clip}</clipPath>` +
    border +
    icon +
    `</g>`
  );
}

/** Pure markup for one mastery's tree: nodes positioned by the game's own ui_x/ui_y (or the
 *  off-tree row for the handful that carry none), icons from the skill-icons sprite sheet, each
 *  carrying a `data-record` for the caller to wire clicks against, an accessible name resolved via
 *  `ctx.nameOf`. `selected` highlights exactly the nodes it names, matching core/filter.ts's
 *  scopeSkillSet, which scopes the table to exactly the picked skills.
 *  Exported separately from renderTree so it is testable without a DOM (this repo
 *  has no jsdom/happy-dom - see test/importPanel.test.ts). */
export function buildTreeMarkup(
  skills: Skill[],
  mastery: string,
  selected: ReadonlySet<string>,
  ctx: TreeContext,
): string {
  const masterySkills = skills.filter((s) => s.mastery === mastery);
  const placed = placeNodes(masterySkills);
  const sheet = sheetSize(ctx.icons);
  // Links first so every node draws over them: a line ends at a node's centre, not its edge.
  const links = linkMarkup(placed);
  const nodes = placed.map((p, i) => nodeMarkup(p, i, selected, ctx, sheet)).join("");
  return `<svg class="tree-svg" viewBox="${VIEW_BOX}" preserveAspectRatio="xMidYMid meet">${links}${nodes}</svg>`;
}

/** Render one mastery's tree as a live, wired SVGElement: buildTreeMarkup's string turned into
 *  DOM, with clicks delegated to onPick(record) - the node itself, not its group, matching
 *  core/filter.ts scoping the table to exactly the picked skills. onPick toggles rather than
 *  sets: selection is a set, and clicking a selected node clears it. */
export function renderTree(
  skills: Skill[],
  mastery: string,
  selected: ReadonlySet<string>,
  onPick: (record: string) => void,
  ctx: TreeContext,
): SVGElement {
  const wrap = document.createElement("div");
  wrap.innerHTML = buildTreeMarkup(skills, mastery, selected, ctx);
  const svg = wrap.firstElementChild as SVGElement;

  const pick = (target: Element) => {
    const record = target.closest("[data-record]")?.getAttribute("data-record");
    if (record) onPick(record);
  };
  svg.addEventListener("click", (e) => pick(e.target as Element));
  // Space/Enter activates the focused node, matching the item table's own row keyboard handling.
  svg.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    pick(e.target as Element);
  });
  return svg;
}
