// ABOUTME: SVG renderer adapter for the devotion map - builds markup strings and mounts live DOM.
// ABOUTME: renderSvgMarkup is a pure function; mountSvg wires it to a live HTMLElement with events.
import { AFFINITIES, type Affinity, type DevotionModel, type SelectionState, type StarId } from "../core/types";
import { selectableStars } from "../core/rules";
import { fitViewBox, toViewBoxString } from "../core/viewbox";
import type { AssetManifest } from "../ports/DataSource";

const AFFINITY_COLORS: Record<Affinity, string> = {
  ascendant: "#e8c558", chaos: "#c0392b", eldritch: "#8e44ad", order: "#2980b9", primordial: "#27ae60",
};
export function affinityColor(a: Affinity): string { return AFFINITY_COLORS[a]; }

function dominantAffinity(con: { affinityBonus: Partial<Record<Affinity, number>> }): Affinity {
  let best: Affinity = "primordial"; let bestV = -1;
  for (const a of AFFINITIES) { const v = con.affinityBonus[a] ?? 0; if (v > bestV) { bestV = v; best = a; } }
  return best;
}

export interface RenderOpts { manifest: AssetManifest | null }

export function renderSvgMarkup(model: DevotionModel, state: SelectionState, opts: RenderOpts): string {
  const selectable = selectableStars(model, state);
  const parts: string[] = [];

  // Layer 1: optional art
  if (opts.manifest) {
    for (const c of model.constellations.values()) {
      const name = c.background?.image?.split("/").pop() ?? "";
      const url = opts.manifest.images[name];
      if (url && c.background && c.background.x != null && c.background.y != null) {
        parts.push(`<image href="${url}" x="${c.background.x}" y="${c.background.y}" class="art"/>`);
      }
    }
  }

  // Layer 2: links
  for (const star of model.stars.values()) {
    for (const p of star.predecessors) {
      const a = model.stars.get(p);
      if (!a) continue;
      parts.push(`<line class="link" x1="${a.position.x}" y1="${a.position.y}" x2="${star.position.x}" y2="${star.position.y}"/>`);
    }
  }

  // Layer 3: stars
  for (const star of model.stars.values()) {
    const con = model.constellations.get(star.constellationId)!;
    const color = affinityColor(dominantAffinity(con));
    let cls = "star locked";
    if (state.selected.has(star.id)) cls = "star selected";
    else if (selectable.has(star.id)) cls = "star selectable";
    parts.push(
      `<circle data-star-id="${star.id}" class="${cls}" cx="${star.position.x}" cy="${star.position.y}" r="6" style="--affinity:${color}"/>`,
    );
  }

  const pts = [...model.stars.values()].map((s) => s.position);
  const vb = toViewBoxString(fitViewBox(pts, 60));
  return `<svg id="map" viewBox="${vb}" preserveAspectRatio="xMidYMid meet">${parts.join("")}</svg>`;
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
