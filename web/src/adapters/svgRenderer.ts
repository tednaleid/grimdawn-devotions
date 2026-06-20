// ABOUTME: SVG renderer adapter for the devotion map - builds markup strings and mounts live DOM.
// ABOUTME: renderSvgMarkup is a pure function; mountSvg wires it to a live HTMLElement with events.
import { type Constellation, type DevotionModel, type SelectionState, type StarId } from "../core/types";
import { selectableStars } from "../core/rules";
import { affinityFrom, completedConstellations, meetsRequirement } from "../core/affinity";
import { fitViewBox, toViewBoxString } from "../core/viewbox";
import { affinityColor, presentAffinities } from "./affinityColors";
import type { AssetManifest } from "../ports/DataSource";

// A constellation's identity colors = the affinities it REQUIRES (1-3), matching the art tint.
// Crossroads (no requirement) fall back to the single affinity they grant.
function gradColors(c: Constellation): string[] {
  const req = presentAffinities(c.affinityRequired).map(affinityColor);
  if (req.length) return req;
  const grant = presentAffinities(c.affinityBonus).map(affinityColor);
  return grant.length ? grant : ["#9aa3b2"];
}

// Diamond polygon points centered at (cx, cy) with the given radius.
function diamondPoints(cx: number, cy: number, r: number): string {
  return `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`;
}

// Left-to-right gradient stops for the affinities a constellation requires (1-3 colors).
function gradientStops(colors: string[]): string {
  if (colors.length === 1) return `<stop offset="0%" stop-color="${colors[0]}"/><stop offset="100%" stop-color="${colors[0]}"/>`;
  return colors
    .map((c, i) => `<stop offset="${Math.round((i / (colors.length - 1)) * 100)}%" stop-color="${c}"/>`)
    .join("");
}

// Star buttons use the 64x64 devotion_star_up.tex bitmap, placed by its top-left
// (bitmapPositionX/Y, which is what `position` holds). The visible star and the
// background art's glow sit at the button center, so dots and links are drawn
// shifted by half the button to line up with the art.
const STAR_CENTER = 32;
// Visible star dot radius.
const STAR_RADIUS = 12;
// Celestial-power stars render as a larger diamond so they stand out.
const POWER_RADIUS = 15;
// Invisible click/hover target radius around each star (larger than the visible dot).
const HIT_RADIUS = 22;
// Padding around a constellation's star bounding box for its hover/click region.
const CON_PAD = 24;

export interface RenderOpts { manifest: AssetManifest | null }

export function renderSvgMarkup(model: DevotionModel, state: SelectionState, opts: RenderOpts): string {
  const selectable = selectableStars(model, state);
  const defs: string[] = [];
  const parts: string[] = [];

  // Layer 0: per-constellation hover/click region = the bounding box of its stars
  // (star bboxes do not overlap; art bboxes do). Drawn first so star hit-circles win.
  for (const c of model.constellations.values()) {
    const stars = c.starIds.map((id) => model.stars.get(id)).filter((s): s is NonNullable<typeof s> => !!s);
    if (stars.length === 0) continue;
    const xs = stars.map((s) => s.position.x + STAR_CENTER);
    const ys = stars.map((s) => s.position.y + STAR_CENTER);
    const minX = Math.min(...xs) - CON_PAD;
    const minY = Math.min(...ys) - CON_PAD;
    const w = Math.max(...xs) - Math.min(...xs) + 2 * CON_PAD;
    const h = Math.max(...ys) - Math.min(...ys) + 2 * CON_PAD;
    parts.push(`<rect class="con-hit" data-con-id="${c.id}" x="${minX}" y="${minY}" width="${w}" height="${h}"/>`);
  }

  // Gradient defs for every constellation (used by both the star fills and the art tint).
  for (const c of model.constellations.values()) {
    defs.push(`<linearGradient id="grad-${c.id}" x1="0" y1="0" x2="1" y2="0">${gradientStops(gradColors(c))}</linearGradient>`);
  }

  // Layer 1: optional art, dimmed and tinted by the affinities it requires to unlock.
  // Art of constellations you cannot yet start (requirement unmet) is faded further.
  if (opts.manifest) {
    const totals = affinityFrom(model, completedConstellations(model, state.selected));
    for (const c of model.constellations.values()) {
      const name = c.background?.image?.split("/").pop() ?? "";
      const art = opts.manifest.images[name];
      if (!(art && c.background && c.background.x != null && c.background.y != null)) continue;
      const { x, y } = c.background;
      const reachable = meetsRequirement(totals, c.affinityRequired) || c.starIds.some((id) => state.selected.has(id));
      const dim = reachable ? "" : " unmet";
      const img = `href="${art.url}" x="${x}" y="${y}" width="${art.w}" height="${art.h}"`;
      parts.push(`<image ${img} class="art${dim}"/>`);
      if (presentAffinities(c.affinityRequired).length > 0) {
        const mid = `mask-${c.id}`;
        defs.push(`<mask id="${mid}"><image ${img}/></mask>`);
        parts.push(`<rect class="art-tint${dim}" x="${x}" y="${y}" width="${art.w}" height="${art.h}" fill="url(#grad-${c.id})" mask="url(#${mid})"/>`);
      }
    }
  }

  // Layer 2: links
  for (const star of model.stars.values()) {
    for (const p of star.predecessors) {
      const a = model.stars.get(p);
      if (!a) continue;
      parts.push(`<line class="link" x1="${a.position.x + STAR_CENTER}" y1="${a.position.y + STAR_CENTER}" x2="${star.position.x + STAR_CENTER}" y2="${star.position.y + STAR_CENTER}"/>`);
    }
  }

  // Layer 3: stars. Each is an invisible large hit target (carries data-star-id)
  // plus a small visible dot (pointer-events:none) so the click/hover area is generous.
  for (const star of model.stars.values()) {
    const con = model.constellations.get(star.constellationId)!;
    const solid = gradColors(con)[0] ?? "#9aa3b2"; // solid color for the glow shadow
    let st = "locked";
    if (state.selected.has(star.id)) st = "selected";
    else if (selectable.has(star.id)) st = "selectable";
    const cx = star.position.x + STAR_CENTER;
    const cy = star.position.y + STAR_CENTER;
    const style = `--affinity:${solid};--grad:url(#grad-${con.id})`;
    // Celestial-power stars are diamonds; the rest are circles. Both share the .star styling.
    const visible = star.celestialPower
      ? `<polygon class="star power ${st}" points="${diamondPoints(cx, cy, POWER_RADIUS)}" style="${style}"/>`
      : `<circle class="star ${st}" cx="${cx}" cy="${cy}" r="${STAR_RADIUS}" style="${style}"/>`;
    parts.push(`<circle data-star-id="${star.id}" class="hit ${st}" cx="${cx}" cy="${cy}" r="${HIT_RADIUS}"/>${visible}`);
  }

  const pts = [...model.stars.values()].map((s) => ({ x: s.position.x + STAR_CENTER, y: s.position.y + STAR_CENTER }));
  const vb = toViewBoxString(fitViewBox(pts, 60));
  return `<svg id="map" viewBox="${vb}" preserveAspectRatio="xMidYMid meet"><defs>${defs.join("")}</defs>${parts.join("")}</svg>`;
}

export interface SvgHandle { update(state: SelectionState): void; svg: SVGSVGElement }
export type HoverTarget = { kind: "star" | "constellation"; id: string } | null;
export interface SvgDeps {
  manifest: AssetManifest | null;
  onStarClick(id: StarId): void;
  onConstellationClick(id: string): void;
  onHover(target: HoverTarget, clientX: number, clientY: number): void;
}

export function mountSvg(container: HTMLElement, model: DevotionModel, deps: SvgDeps): SvgHandle {
  function render(state: SelectionState) {
    container.innerHTML = renderSvgMarkup(model, state, { manifest: deps.manifest });
  }
  render({ selected: new Set(), pointCap: 55 });
  const svg = container.querySelector("svg") as SVGSVGElement;

  container.addEventListener("click", (e) => {
    const el = e.target as Element;
    const sid = el?.getAttribute?.("data-star-id");
    if (sid) { deps.onStarClick(sid); return; }
    const cid = el?.getAttribute?.("data-con-id");
    if (cid) deps.onConstellationClick(cid);
  });
  container.addEventListener("mousemove", (e) => {
    const el = e.target as Element;
    const sid = el?.getAttribute?.("data-star-id");
    const cid = el?.getAttribute?.("data-con-id");
    const target: HoverTarget = sid ? { kind: "star", id: sid } : cid ? { kind: "constellation", id: cid } : null;
    deps.onHover(target, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
  });

  return {
    svg,
    update(state) {
      const live = container.querySelector("svg") as SVGSVGElement | null;
      const vb = live?.getAttribute("viewBox");
      render(state);
      const next = container.querySelector("svg") as SVGSVGElement | null;
      if (vb && next) next.setAttribute("viewBox", vb); // preserve pan/zoom across re-render
    },
  };
}
