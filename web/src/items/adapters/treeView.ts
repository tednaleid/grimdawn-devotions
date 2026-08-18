// ABOUTME: Renders the /items/ page's SVG mastery tree: nodes positioned by the game's own UI
// ABOUTME: coordinates, icons from the skill-icons sprite sheet, clicks delegated to onPick(group).
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
const VIEW_BOX = `${BOX_X} ${BOX_Y} ${BOX_W} ${BOX_H}`;

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

// A skill selection scopes to its node group (see core/filter.ts's scopeSkillSet): a group's
// identity is its base skill's own record, and an id not found among `skills` (a stale link)
// falls back to itself, mirroring scopeSkillSet's own fallback so the tree and the table filter
// never disagree about what a given `selected` value means.
function selectedGroup(skills: Skill[], selected: string | null): string | null {
  if (!selected) return null;
  const target = skills.find((s) => s.record === selected);
  return target ? target.group : selected;
}

function nodeMarkup(
  p: Placed,
  i: number,
  selGroup: string | null,
  ctx: TreeContext,
  sheet: { w: number; h: number },
): string {
  const { skill, x, y, offTree } = p;
  const shape = skill.nodeKind === "base" ? "square" : "circle";
  const clipId = `tree-clip-${i}`;
  const selected = selGroup !== null && skill.group === selGroup;
  const cls = ["tree-node", shape, offTree ? "off-tree" : "", selected ? "selected" : ""].filter(Boolean).join(" ");
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
    `<g class="${cls}" data-group="${esc(skill.group)}" data-record="${esc(skill.record)}" aria-label="${name}" tabindex="0" role="button">` +
    `<title>${name}</title>` +
    `<clipPath id="${clipId}">${clip}</clipPath>` +
    border +
    icon +
    `</g>`
  );
}

/** Pure markup for one mastery's tree: nodes positioned by the game's own ui_x/ui_y (or the
 *  off-tree row for the handful that carry none), icons from the skill-icons sprite sheet, each
 *  carrying a `data-group` for the caller to wire clicks against, an accessible name resolved via
 *  `ctx.nameOf`. `selected` highlights every node sharing the selected skill's group, not just
 *  the exact matching node, since that is what stays in scope together (see core/filter.ts's
 *  scopeSkillSet). Exported separately from renderTree so it is testable without a DOM (this repo
 *  has no jsdom/happy-dom - see test/importPanel.test.ts). */
export function buildTreeMarkup(skills: Skill[], mastery: string, selected: string | null, ctx: TreeContext): string {
  const masterySkills = skills.filter((s) => s.mastery === mastery);
  const placed = placeNodes(masterySkills);
  const selGroup = selectedGroup(skills, selected);
  const sheet = sheetSize(ctx.icons);
  const nodes = placed.map((p, i) => nodeMarkup(p, i, selGroup, ctx, sheet)).join("");
  return `<svg class="tree-svg" viewBox="${VIEW_BOX}" preserveAspectRatio="xMidYMid meet">${nodes}</svg>`;
}

/** Render one mastery's tree as a live, wired SVGElement: buildTreeMarkup's string turned into
 *  DOM, with clicks delegated to onPick(group) - a node's group is itself for a base skill and
 *  its base's record for a modifier/transmuter/pet_modifier, matching core/filter.ts's scoping. */
export function renderTree(
  skills: Skill[],
  mastery: string,
  selected: string | null,
  onPick: (group: string) => void,
  ctx: TreeContext,
): SVGElement {
  const wrap = document.createElement("div");
  wrap.innerHTML = buildTreeMarkup(skills, mastery, selected, ctx);
  const svg = wrap.firstElementChild as SVGElement;

  const pick = (target: Element) => {
    const group = target.closest("[data-group]")?.getAttribute("data-group");
    if (group) onPick(group);
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
