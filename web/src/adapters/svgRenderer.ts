// ABOUTME: SVG renderer adapter for the devotion map - builds markup strings and mounts live DOM.
// ABOUTME: renderSvgMarkup is a pure function; mountSvg wires it to a live HTMLElement with events.
import { AFFINITIES, type Affinity, type DevotionModel, type SelectionState, type StarId } from "../core/types";
import { selectableStars } from "../core/rules";
import { fitViewBox, toViewBoxString } from "../core/viewbox";
import { affinityColor, presentAffinities } from "./affinityColors";
import type { AssetManifest } from "../ports/DataSource";

function dominantAffinity(con: { affinityBonus: Partial<Record<Affinity, number>> }): Affinity {
  let best: Affinity = "primordial"; let bestV = -1;
  for (const a of AFFINITIES) { const v = con.affinityBonus[a] ?? 0; if (v > bestV) { bestV = v; best = a; } }
  return best;
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
// Invisible click/hover target radius around each star (larger than the visible dot).
const HIT_RADIUS = 22;

export interface RenderOpts { manifest: AssetManifest | null }

export function renderSvgMarkup(model: DevotionModel, state: SelectionState, opts: RenderOpts): string {
  const selectable = selectableStars(model, state);
  const defs: string[] = [];
  const parts: string[] = [];

  // Layer 1: optional art, dimmed and tinted by the affinities it requires to unlock.
  if (opts.manifest) {
    for (const c of model.constellations.values()) {
      const name = c.background?.image?.split("/").pop() ?? "";
      const art = opts.manifest.images[name];
      if (!(art && c.background && c.background.x != null && c.background.y != null)) continue;
      const { x, y } = c.background;
      const img = `href="${art.url}" x="${x}" y="${y}" width="${art.w}" height="${art.h}"`;
      parts.push(`<image ${img} class="art"/>`);
      const reqColors = presentAffinities(c.affinityRequired).map(affinityColor);
      if (reqColors.length > 0) {
        const gid = `grad-${c.id}`;
        const mid = `mask-${c.id}`;
        defs.push(`<linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="0">${gradientStops(reqColors)}</linearGradient>`);
        defs.push(`<mask id="${mid}"><image ${img}/></mask>`);
        parts.push(`<rect class="art-tint" x="${x}" y="${y}" width="${art.w}" height="${art.h}" fill="url(#${gid})" mask="url(#${mid})"/>`);
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
    const color = affinityColor(dominantAffinity(con));
    let st = "locked";
    if (state.selected.has(star.id)) st = "selected";
    else if (selectable.has(star.id)) st = "selectable";
    const cx = star.position.x + STAR_CENTER;
    const cy = star.position.y + STAR_CENTER;
    parts.push(
      `<circle data-star-id="${star.id}" class="hit ${st}" cx="${cx}" cy="${cy}" r="${HIT_RADIUS}"/>` +
        `<circle class="star ${st}" cx="${cx}" cy="${cy}" r="${STAR_RADIUS}" style="--affinity:${color}"/>`,
    );
  }

  const pts = [...model.stars.values()].map((s) => ({ x: s.position.x + STAR_CENTER, y: s.position.y + STAR_CENTER }));
  const vb = toViewBoxString(fitViewBox(pts, 60));
  return `<svg id="map" viewBox="${vb}" preserveAspectRatio="xMidYMid meet"><defs>${defs.join("")}</defs>${parts.join("")}</svg>`;
}

export interface SvgHandle { update(state: SelectionState): void; svg: SVGSVGElement }
export interface SvgDeps {
  manifest: AssetManifest | null;
  onStarClick(id: StarId): void;
  onStarHover(id: StarId | null, clientX: number, clientY: number): void;
}

export function mountSvg(container: HTMLElement, model: DevotionModel, deps: SvgDeps): SvgHandle {
  function render(state: SelectionState) {
    container.innerHTML = renderSvgMarkup(model, state, { manifest: deps.manifest });
  }
  render({ selected: new Set(), pointCap: 55 });
  const svg = container.querySelector("svg") as SVGSVGElement;

  container.addEventListener("click", (e) => {
    const id = (e.target as Element)?.getAttribute?.("data-star-id");
    if (id) deps.onStarClick(id);
  });
  container.addEventListener("mousemove", (e) => {
    const id = (e.target as Element)?.getAttribute?.("data-star-id") ?? null;
    deps.onStarHover(id, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
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
