// ABOUTME: SVG renderer adapter for the devotion map - builds markup strings and mounts live DOM.
// ABOUTME: renderSvgMarkup is a pure function; mountSvg wires it to a live HTMLElement with events.
import type { Constellation, DevotionModel, SelectionState, StarId } from "../core/types";
import type { ReachView } from "../core/reachability";
import { affinityColor, presentAffinities } from "./affinityColors";
import { fitViewBox, toViewBoxString } from "../core/viewbox";
import type { AssetManifest } from "../ports/DataSource";

// A constellation's identity colors = the affinities it GRANTS when fully filled (1-3).
// Reachability is shown by brightness (faded if you cannot start it), so the color is
// free to convey what the constellation contributes to your affinity pool instead. Rare
// constellations that grant no affinity fall back to what they require, then grey.
function gradColors(c: Constellation): string[] {
  const grant = presentAffinities(c.affinityBonus).map(affinityColor);
  if (grant.length) return grant;
  const req = presentAffinities(c.affinityRequired).map(affinityColor);
  return req.length ? req : ["#9aa3b2"];
}

// Diamond polygon points centered at (cx, cy) with the given radius.
function diamondPoints(cx: number, cy: number, r: number): string {
  return `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`;
}

// Left-to-right gradient stops for a constellation's identity colors (1-3 colors).
function gradientStops(colors: string[]): string {
  if (colors.length === 1)
    return `<stop offset="0%" stop-color="${colors[0]}"/><stop offset="100%" stop-color="${colors[0]}"/>`;
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
// Celestial-power stars render as a larger diamond so they stand out (~25% bigger
// than the ordinary dots) without overwhelming them.
const POWER_RADIUS = 19;
// Invisible click/hover target radius around each star (larger than the visible dot;
// also covers the power diamond, whose vertices sit within this radius).
const HIT_RADIUS = 22;
// Padding around a constellation's star bounding box for its hover/click region.
const CON_PAD = 24;

export interface RenderOpts {
  manifest: AssetManifest | null;
  highlight?: Set<StarId>;
  reach?: ReachView;
}

// A constellation's hover/click footprint in SVG world coords: its art bounds
// (x0,y0)-(x1,y1) and the centroid of its stars, used to break ties where art
// bounding boxes overlap.
export interface ConRegion {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
}

// Build a hover region per constellation: the art bounds when art is present, else
// the star bounding box plus padding. Star centroids are the tie-break centers.
export function buildConRegions(model: DevotionModel, manifest: AssetManifest | null): ConRegion[] {
  const regions: ConRegion[] = [];
  for (const c of model.constellations.values()) {
    const stars = c.starIds.map((id) => model.stars.get(id)).filter((s): s is NonNullable<typeof s> => !!s);
    if (stars.length === 0) continue;
    const xs = stars.map((s) => s.position.x + STAR_CENTER);
    const ys = stars.map((s) => s.position.y + STAR_CENTER);
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
    const name = c.background?.image?.split("/").pop() ?? "";
    const art = manifest?.images[name];
    if (art && c.background && c.background.x != null && c.background.y != null) {
      regions.push({
        id: c.id,
        x0: c.background.x,
        y0: c.background.y,
        x1: c.background.x + art.w,
        y1: c.background.y + art.h,
        cx,
        cy,
      });
    } else {
      regions.push({
        id: c.id,
        x0: Math.min(...xs) - CON_PAD,
        y0: Math.min(...ys) - CON_PAD,
        x1: Math.max(...xs) + CON_PAD,
        y1: Math.max(...ys) + CON_PAD,
        cx,
        cy,
      });
    }
  }
  return regions;
}

// The constellation owning a world point: among the regions whose bounds contain
// it, the one whose centroid is nearest. null if the point is outside every region.
export function constellationAt(regions: ConRegion[], wx: number, wy: number): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const r of regions) {
    if (wx < r.x0 || wx > r.x1 || wy < r.y0 || wy > r.y1) continue;
    const dx = wx - r.cx;
    const dy = wy - r.cy;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = r.id;
    }
  }
  return best;
}

export function renderSvgMarkup(model: DevotionModel, state: SelectionState, opts: RenderOpts): string {
  const reach = opts.reach;
  const defs: string[] = [];
  const parts: string[] = [];

  // Constellation art class based on reachability:
  //   "" (no class suffix) - completable, or you already have a star in it
  //   " unmet"             - can start (a clickable star exists) but cannot complete
  //   " unreachable"       - cannot even start (no clickable star)
  // When reach is absent, nothing dims (permissive default).
  const conArtClass = (c: Constellation): string => {
    if (!reach) return "";
    if (c.starIds.some((id) => state.selected.has(id))) return "";
    if (reach.completable.has(c.id)) return "";
    if (c.starIds.some((id) => reach.clickable.has(id))) return " unmet";
    return " unreachable";
  };

  // A fully-selected (active) constellation gets a brighter, glowing art so active ones stand out
  // when zoomed out. Only complete constellations qualify (a partial pick does not).
  const isActive = (c: Constellation): boolean =>
    c.starIds.length > 0 && c.starIds.every((id) => state.selected.has(id));

  // Constellation hover/click is resolved in JS against each constellation's art
  // bounds (see buildConRegions / constellationAt), so the whole image is hoverable
  // even though art bounding boxes overlap. Star hit-circles take precedence.

  // Gradient defs for every constellation (used by both the star fills and the art tint).
  for (const c of model.constellations.values()) {
    defs.push(
      `<linearGradient id="grad-${c.id}" x1="0" y1="0" x2="1" y2="0">${gradientStops(gradColors(c))}</linearGradient>`,
    );
  }

  // Layer 1: optional art, tinted by the constellation's identity (granted) colors.
  // The tint rect is only drawn for constellations that have an affinity requirement
  // (it carries a mask built from the art); crossroads have no requirement and no tint.
  if (opts.manifest) {
    for (const c of model.constellations.values()) {
      const name = c.background?.image?.split("/").pop() ?? "";
      const art = opts.manifest.images[name];
      if (!(art && c.background && c.background.x != null && c.background.y != null)) continue;
      const { x, y } = c.background;
      const dim = conArtClass(c);
      const act = isActive(c);
      const active = act ? " active" : "";
      // The active glow uses the constellation's own granted colors (1, or 2 for a gradient), so each
      // active nebula glows in its identity colors rather than flat white; --glow2 is transparent for
      // single-color constellations so they get one glow, not a doubled one.
      const cols = gradColors(c);
      const glow = act ? ` style="--glow1:${cols[0] ?? "#fff"};--glow2:${cols[1] ?? "transparent"}"` : "";
      const img = `href="${art.url}" x="${x}" y="${y}" width="${art.w}" height="${art.h}"`;
      // data-con-id lets a blocked constellation deselect flash this icon (see main.ts).
      parts.push(`<image ${img} class="art${dim}${active}"${glow} data-con-id="${c.id}"/>`);
      if (presentAffinities(c.affinityRequired).length > 0) {
        const mid = `mask-${c.id}`;
        defs.push(`<mask id="${mid}"><image ${img}/></mask>`);
        parts.push(
          `<rect class="art-tint${dim}${active}" x="${x}" y="${y}" width="${art.w}" height="${art.h}" fill="url(#grad-${c.id})" mask="url(#${mid})"/>`,
        );
      }
    }
  }

  // Layer 2: links
  for (const star of model.stars.values()) {
    for (const p of star.predecessors) {
      const a = model.stars.get(p);
      if (!a) continue;
      parts.push(
        `<line class="link" x1="${a.position.x + STAR_CENTER}" y1="${a.position.y + STAR_CENTER}" x2="${star.position.x + STAR_CENTER}" y2="${star.position.y + STAR_CENTER}"/>`,
      );
    }
  }

  // Layer 3: stars. Each is an invisible large hit target (carries data-star-id)
  // plus a small visible dot (pointer-events:none) so the click/hover area is generous.
  // When a benefit filter is active, matching stars are emphasized and the rest dimmed.
  const filtering = (opts.highlight?.size ?? 0) > 0;
  for (const star of model.stars.values()) {
    const con = model.constellations.get(star.constellationId)!;
    const solid = gradColors(con)[0] ?? "#9aa3b2"; // solid color for the glow shadow
    let st = "locked";
    if (state.selected.has(star.id)) st = "selected";
    else if (!reach || reach.clickable.has(star.id)) st = "selectable";
    const cx = star.position.x + STAR_CENTER;
    const cy = star.position.y + STAR_CENTER;
    const style = `--affinity:${solid};--grad:url(#grad-${con.id})`;
    // A star granting a selected benefit is emphasized; the rest are dimmed while filtering.
    const m = opts.highlight?.has(star.id) ? " match" : filtering ? " dim" : "";
    // Celestial-power stars are diamonds; the rest are circles. Both share the .star styling.
    const visible = star.celestialPower
      ? `<polygon class="star power ${st}${m}" points="${diamondPoints(cx, cy, POWER_RADIUS)}" style="${style}"/>`
      : `<circle class="star ${st}${m}" cx="${cx}" cy="${cy}" r="${STAR_RADIUS}" style="${style}"/>`;
    parts.push(
      `<circle data-star-id="${star.id}" class="hit ${st}" cx="${cx}" cy="${cy}" r="${HIT_RADIUS}"/>${visible}`,
    );
  }

  const pts = [...model.stars.values()].map((s) => ({ x: s.position.x + STAR_CENTER, y: s.position.y + STAR_CENTER }));
  const vb = toViewBoxString(fitViewBox(pts, 60));
  return `<svg id="map" viewBox="${vb}" preserveAspectRatio="xMidYMid meet"><defs>${defs.join("")}</defs>${parts.join("")}</svg>`;
}

export interface SvgHandle {
  update(state: SelectionState, highlight?: Set<StarId>, reach?: ReachView): void;
  svg: SVGSVGElement;
}
export type HoverTarget = { kind: "star" | "constellation"; id: string } | null;
export interface SvgDeps {
  manifest: AssetManifest | null;
  onStarClick(id: StarId): void;
  onConstellationClick(id: string): void;
  onHover(target: HoverTarget, clientX: number, clientY: number): void;
}

export function mountSvg(container: HTMLElement, model: DevotionModel, deps: SvgDeps): SvgHandle {
  const regions = buildConRegions(model, deps.manifest);
  function render(state: SelectionState, highlight?: Set<StarId>, reach?: ReachView) {
    container.innerHTML = renderSvgMarkup(model, state, { manifest: deps.manifest, highlight, reach });
  }
  render({ selected: new Set(), pointCap: 55 });
  const svg = container.querySelector("svg") as SVGSVGElement;

  // The constellation under a screen point, found by mapping the point into the
  // live SVG's coordinate space and resolving it against the art regions.
  function conAt(clientX: number, clientY: number): string | null {
    const live = container.querySelector("svg") as SVGSVGElement | null;
    const ctm = live?.getScreenCTM?.();
    if (!live || !ctm) return null;
    const pt = live.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const w = pt.matrixTransform(ctm.inverse());
    return constellationAt(regions, w.x, w.y);
  }

  container.addEventListener("click", (e) => {
    const sid = (e.target as Element)?.getAttribute?.("data-star-id");
    if (sid) {
      deps.onStarClick(sid);
      return;
    }
    const cid = conAt((e as MouseEvent).clientX, (e as MouseEvent).clientY);
    if (cid) deps.onConstellationClick(cid);
  });
  container.addEventListener("mousemove", (e) => {
    const sid = (e.target as Element)?.getAttribute?.("data-star-id");
    const cid = sid ? null : conAt((e as MouseEvent).clientX, (e as MouseEvent).clientY);
    const target: HoverTarget = sid ? { kind: "star", id: sid } : cid ? { kind: "constellation", id: cid } : null;
    container.classList.toggle("con-hover", !sid && !!cid);
    deps.onHover(target, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
  });

  return {
    svg,
    update(state, highlight, reach) {
      const live = container.querySelector("svg") as SVGSVGElement | null;
      const vb = live?.getAttribute("viewBox");
      render(state, highlight, reach);
      const next = container.querySelector("svg") as SVGSVGElement | null;
      if (vb && next) next.setAttribute("viewBox", vb); // preserve pan/zoom across re-render
    },
  };
}
