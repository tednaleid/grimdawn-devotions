// ABOUTME: SVG renderer adapter for the devotion map - builds markup strings and mounts live DOM.
// ABOUTME: renderSvgMarkup is a pure function; mountSvg wires it to a live HTMLElement with events.
import type { Affinity, Constellation, DevotionModel, SelectionState, StarId } from "../core/types";
import type { ReachView } from "../core/reachability";
import { affinityColor, presentAffinities } from "./affinityColors";
import { constellationDisplay, starDisplay, edgeDisplay } from "../core/displayState";
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

// Brightness -> opacity, per element type. The only place these tunable values live (the spec's
// "resolved opacity number"); brightness itself is resolved purely in core, so nothing collides here.
const ART_OPACITY = { active: 1, attainable: 0.25, unattainable: 0.12 } as const;
const STAR_OPACITY = { active: 1, attainable: 1, unattainable: 0.3 } as const;
const EDGE_OPACITY = { active: 1, attainable: 1, unattainable: 0.3 } as const;
// The affinity match halo glows full strength on a reachable constellation and dimmer on an unreachable
// one, so the brightness channel still reads under a filter (reachable matches are not just colored).
const HALO_UNREACHABLE_OPACITY = 0.25;

export interface RenderOpts {
  manifest: AssetManifest | null;
  highlight?: Set<StarId>;
  reach?: ReachView;
  diff?: { added: Set<StarId>; removed: Set<StarId> } | null;
  // When present, an affinity filter is active. A constellation matches when it provides any of these
  // filter affinities (matchedAffinities); matching constellations glow (see the aff-glow layer) and
  // the rest get a mild aff-dim fade.
  affinityFilter?: { grants: Set<Affinity>; requires: Set<Affinity> };
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
  const diff = opts.diff ?? null;
  const settings = {
    selected: state.selected,
    reach,
    affinityFilter: opts.affinityFilter,
    benefitMatch: opts.highlight,
    diff,
  };
  const defs: string[] = [];
  const parts: string[] = [];

  const affFilter = opts.affinityFilter;

  // Constellation hover/click is resolved in JS against each constellation's art
  // bounds (see buildConRegions / constellationAt), so the whole image is hoverable
  // even though art bounding boxes overlap. Star hit-circles take precedence.

  // Benefit-match glow as an SVG-native filter. CSS `filter: drop-shadow()` on SVG shapes is
  // unreliable on WebKit (iOS Safari/Firefox render nothing), so the halo is built from core SVG
  // filter primitives the SVG engine rasterizes everywhere. Two flooded-blur layers (tight light +
  // wide blue) under the star approximate the prior drop-shadow stack; sized in user units (~star r 12).
  defs.push(
    `<filter id="match-glow" x="-400%" y="-400%" width="900%" height="900%" color-interpolation-filters="sRGB">` +
      `<feGaussianBlur in="SourceAlpha" stdDeviation="9" result="b1"/><feFlood flood-color="#e3f2ff" result="c1"/><feComposite in="c1" in2="b1" operator="in" result="g1"/>` +
      `<feGaussianBlur in="SourceAlpha" stdDeviation="22" result="b2"/><feFlood flood-color="#6cb6ff" result="c2"/><feComposite in="c2" in2="b2" operator="in" result="g2"/>` +
      `<feMerge><feMergeNode in="g2"/><feMergeNode in="g2"/><feMergeNode in="g2"/><feMergeNode in="g1"/><feMergeNode in="g1"/><feMergeNode in="g1"/><feMergeNode in="SourceGraphic"/></feMerge>` +
      `</filter>`,
  );

  // Colored glows for active art, taken links, and selectable stars. Same WebKit reason as match-glow:
  // CSS drop-shadow on SVG renders nothing on iOS. These blur the element's OWN paint (SourceGraphic),
  // so a single filter glows in each element's own color with no per-color variants. self-glow-art also
  // lifts brightness to replace the prior brightness(1.15).
  defs.push(
    `<filter id="self-glow" x="-100%" y="-100%" width="300%" height="300%" color-interpolation-filters="sRGB">` +
      `<feGaussianBlur in="SourceGraphic" stdDeviation="6" result="b"/>` +
      `<feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>` +
      `</filter>`,
    `<filter id="self-glow-art" x="-40%" y="-40%" width="180%" height="180%" color-interpolation-filters="sRGB">` +
      `<feGaussianBlur in="SourceGraphic" stdDeviation="10" result="b"/>` +
      `<feComponentTransfer in="SourceGraphic" result="bright"><feFuncR type="linear" slope="1.15"/><feFuncG type="linear" slope="1.15"/><feFuncB type="linear" slope="1.15"/></feComponentTransfer>` +
      `<feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="bright"/></feMerge>` +
      `</filter>`,
  );

  // Affinity match glow: a diffuse colored halo. The source is a gradient-filled, art-masked rect (the
  // constellation's MATCHED affinity colors), blurred, saturated, and stacked into a soft halo. The
  // intensity comes from saturation plus alpha density (the repeated merge), not an RGB brightness lift:
  // multiplying the channels clips the strong colors toward white (purple suffers most). SVG-native (CSS
  // drop-shadow on SVG fails on WebKit). stdDeviation is in user units, so the halo scales with zoom;
  // start diffuse and tune. The filter region is expanded so the blur is not clipped.
  // Only emitted when an affinity filter is active (no filter -> no glow layer -> no def needed).
  if (affFilter) {
    defs.push(
      `<filter id="aff-glow" x="-100%" y="-100%" width="300%" height="300%" color-interpolation-filters="sRGB">` +
        `<feGaussianBlur in="SourceGraphic" stdDeviation="55" result="b"/>` +
        `<feColorMatrix in="b" type="saturate" values="1.8" result="sat"/>` +
        `<feMerge><feMergeNode in="sat"/><feMergeNode in="sat"/><feMergeNode in="sat"/><feMergeNode in="sat"/></feMerge>` +
        `</filter>`,
    );
    // mute: drain color toward grey (the affinity-filter de-emphasis). SVG-native feColorMatrix
    // because CSS filter: saturate() renders nothing on WebKit, like our other glows. `mute-wide` is the
    // same desaturation with an expanded region, used to wrap a benefit-match glow layer (whose halo
    // spreads well past the marker) so the whole glow desaturates without the halo being clipped.
    defs.push(
      `<filter id="mute" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0.18"/></filter>`,
      `<filter id="mute-wide" x="-400%" y="-400%" width="900%" height="900%" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0.18"/></filter>`,
    );
  }

  // Gradient defs for every constellation (used by both the star fills and the art tint).
  for (const c of model.constellations.values()) {
    defs.push(
      `<linearGradient id="grad-${c.id}" x1="0" y1="0" x2="1" y2="0">${gradientStops(gradColors(c))}</linearGradient>`,
    );
  }

  // Art-silhouette masks, built once per constellation and shared by the glow halo (Layer 0) and the
  // art tint (Layer 1). A constellation needs one only if it has art AND it either matches the filter
  // or carries an affinity-requirement tint.
  const maskBuilt = new Set<string>();
  const ensureMask = (cid: string, url: string, x: number, y: number, w: number, h: number) => {
    if (maskBuilt.has(cid)) return;
    maskBuilt.add(cid);
    defs.push(`<mask id="mask-${cid}"><image href="${url}" x="${x}" y="${y}" width="${w}" height="${h}"/></mask>`);
  };

  // Layer 0: affinity match glow, drawn beneath the art so the colored halo bleeds out around matching
  // constellations. The gradient is built from ONLY the matched affinity colors (solid when one matches).
  if (opts.manifest && affFilter) {
    for (const c of model.constellations.values()) {
      const cd0 = constellationDisplay(c, settings);
      if (cd0.color.kind !== "match") continue;
      const name = c.background?.image?.split("/").pop() ?? "";
      const art = opts.manifest.images[name];
      if (!(art && c.background && c.background.x != null && c.background.y != null)) continue;
      const { x, y } = c.background;
      const cols = cd0.color.affinities.map(affinityColor);
      defs.push(
        `<linearGradient id="aff-grad-${c.id}" x1="0" y1="0" x2="1" y2="0">${gradientStops(cols)}</linearGradient>`,
      );
      ensureMask(c.id, art.url, x, y, art.w, art.h);
      // The halo feels the brightness channel like every other layer: a matching constellation you cannot
      // reach glows in its color but dimmer than a reachable one, so reachability still reads under a filter.
      const haloOp = cd0.brightness === "unattainable" ? HALO_UNREACHABLE_OPACITY : 1;
      const glow = `<rect class="aff-glow" opacity="${haloOp}" x="${x}" y="${y}" width="${art.w}" height="${art.h}" fill="url(#aff-grad-${c.id})" mask="url(#mask-${c.id})" filter="url(#aff-glow)"/>`;
      // A selected constellation also carries its own #self-glow-art bloom (Layer 1), which raises the
      // local brightness and would swallow a single faint halo - so a selected match showed no color.
      // Stack the halo for active ones so the matched color still reads as a ring around them, while they
      // stay the brightest thing via the self-glow. Unselected matches keep the single, softer pass.
      parts.push(glow);
      if (cd0.selfGlow) parts.push(glow);
    }
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
      const cd = constellationDisplay(c, settings);
      const op = ART_OPACITY[cd.brightness];
      const muted = cd.color.kind === "mute" ? " mute" : "";
      const active = cd.selfGlow ? " active" : "";
      // An active constellation glows in its own art colors via the #self-glow-art SVG filter (see the
      // .art.active CSS rule); the filter derives the color from the image, so no per-color style is needed.
      const img = `href="${art.url}" x="${x}" y="${y}" width="${art.w}" height="${art.h}"`;
      // data-con-id lets a blocked constellation deselect flash this icon (see main.ts).
      parts.push(`<image ${img} class="art${active}${muted}" opacity="${op}" data-con-id="${c.id}"/>`);
      if (presentAffinities(c.affinityRequired).length > 0) {
        ensureMask(c.id, art.url, x, y, art.w, art.h);
        parts.push(
          `<rect class="art-tint${active}${muted}" opacity="${op}" x="${x}" y="${y}" width="${art.w}" height="${art.h}" fill="url(#grad-${c.id})" mask="url(#mask-${c.id})"/>`,
        );
      }
    }
  }

  // Layer 2: links. A segment whose both endpoints are selected is "taken" (drawn gold, like
  // grimtools); brightness and color come from the edge display record.
  for (const star of model.stars.values()) {
    const con = model.constellations.get(star.constellationId)!;
    for (const p of star.predecessors) {
      const a = model.stars.get(p);
      if (!a) continue;
      const ed = edgeDisplay(con, p, star.id, settings);
      const muted = ed.color.kind === "mute" ? " mute" : "";
      const op = EDGE_OPACITY[ed.brightness];
      const coords = `x1="${a.position.x + STAR_CENTER}" y1="${a.position.y + STAR_CENTER}" x2="${star.position.x + STAR_CENTER}" y2="${star.position.y + STAR_CENTER}"`;
      // A taken segment gets a soft gold bloom from a wide, faint underlay line rather than an SVG filter:
      // an objectBoundingBox filter region collapses to nothing on a perfectly horizontal or vertical line
      // (its bounding box has zero height or width), which made axis-aligned taken links render invisibly.
      if (ed.taken) parts.push(`<line class="link-glow" opacity="${op}" ${coords}/>`);
      parts.push(`<line class="link${ed.taken ? " taken" : ""}${muted}" opacity="${op}" ${coords}/>`);
    }
  }

  // Layer 3: stars. Each is an invisible large hit target (carries data-star-id)
  // plus a small visible dot (pointer-events:none) so the click/hover area is generous.
  for (const star of model.stars.values()) {
    const con = model.constellations.get(star.constellationId)!;
    const sd = starDisplay(star, con, settings);
    const solid = gradColors(con)[0] ?? "#9aa3b2";
    const cx = star.position.x + STAR_CENTER;
    const cy = star.position.y + STAR_CENTER;
    const style = `--affinity:${solid};--grad:url(#grad-${con.id})`;
    // Immediacy: a non-selected star is "selectable" (colored) when clickable, else "locked" (grey).
    const st = sd.selected ? "selected" : sd.clickable ? "selectable" : "locked";
    const muted = sd.color.kind === "mute" ? " mute" : "";
    const cmp = sd.diff === "add" ? " cmp-add" : sd.diff === "remove" ? " cmp-rm" : "";
    const op = STAR_OPACITY[sd.brightness];
    const cls = `star ${st}${muted}${cmp}`;
    const dot = star.celestialPower
      ? `<polygon class="${cls}" opacity="${op}" points="${diamondPoints(cx, cy, POWER_RADIUS)}" style="${style}"/>`
      : `<circle class="${cls}" opacity="${op}" cx="${cx}" cy="${cy}" r="${STAR_RADIUS}" style="${style}"/>`;
    // Benefit-match emphasis is a SEPARATE full-opacity layer (enlarged + halo) so it reads even on an
    // unattainable (dim) star, whose dot keeps its attainability opacity. When the star's constellation is
    // off the affinity filter, the glow is wrapped in #mute-wide so the whole glow desaturates too - the
    // match then reads as "benefit match, off-filter" without the dot's opacity bleeding into the glow.
    let marker = "";
    if (sd.benefitMatch) {
      const shape = star.celestialPower
        ? `<polygon class="benefit-glow" points="${diamondPoints(cx, cy, POWER_RADIUS)}" style="${style}"/>`
        : `<circle class="benefit-glow" cx="${cx}" cy="${cy}" r="${STAR_RADIUS}" style="${style}"/>`;
      marker = muted ? `<g filter="url(#mute-wide)">${shape}</g>` : shape;
    }
    parts.push(
      `<circle data-star-id="${star.id}" class="hit ${st}" cx="${cx}" cy="${cy}" r="${HIT_RADIUS}"/>${dot}${marker}`,
    );
  }

  const pts = [...model.stars.values()].map((s) => ({ x: s.position.x + STAR_CENTER, y: s.position.y + STAR_CENTER }));
  const vb = toViewBoxString(fitViewBox(pts, 60));
  return `<svg id="map" viewBox="${vb}" preserveAspectRatio="xMidYMid meet"><defs>${defs.join("")}</defs>${parts.join("")}</svg>`;
}

export interface SvgHandle {
  update(
    state: SelectionState,
    highlight?: Set<StarId>,
    reach?: ReachView,
    diff?: { added: Set<StarId>; removed: Set<StarId> } | null,
    affinityFilter?: { grants: Set<Affinity>; requires: Set<Affinity> },
  ): void;
  svg: SVGSVGElement;
  // Draw (or clear, with null) a box around a constellation's stars, on top of every layer. Used for
  // build-order row hover-sync; an outline on the constellation's own art is buried under later-painted
  // layers and traces the oversized texture rect, so a dedicated top overlay is drawn instead.
  highlightCon(id: string | null): void;
}
export type HoverTarget = { kind: "star" | "constellation"; id: string } | null;
export interface SvgDeps {
  manifest: AssetManifest | null;
  onStarClick(id: StarId, clientX: number, clientY: number): void;
  onConstellationClick(id: string, clientX: number, clientY: number): void;
  onHover(target: HoverTarget, clientX: number, clientY: number): void;
}

export function mountSvg(container: HTMLElement, model: DevotionModel, deps: SvgDeps): SvgHandle {
  const regions = buildConRegions(model, deps.manifest);
  function render(
    state: SelectionState,
    highlight?: Set<StarId>,
    reach?: ReachView,
    diff?: { added: Set<StarId>; removed: Set<StarId> } | null,
    affinityFilter?: { grants: Set<Affinity>; requires: Set<Affinity> },
  ) {
    container.innerHTML = renderSvgMarkup(model, state, {
      manifest: deps.manifest,
      highlight,
      reach,
      diff,
      affinityFilter,
    });
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
    const me = e as MouseEvent;
    const sid = (e.target as Element)?.getAttribute?.("data-star-id");
    if (sid) {
      deps.onStarClick(sid, me.clientX, me.clientY);
      return;
    }
    const cid = conAt(me.clientX, me.clientY);
    if (cid) deps.onConstellationClick(cid, me.clientX, me.clientY);
  });
  container.addEventListener("mousemove", (e) => {
    const sid = (e.target as Element)?.getAttribute?.("data-star-id");
    const cid = sid ? null : conAt((e as MouseEvent).clientX, (e as MouseEvent).clientY);
    const target: HoverTarget = sid ? { kind: "star", id: sid } : cid ? { kind: "constellation", id: cid } : null;
    container.classList.toggle("con-hover", !sid && !!cid);
    deps.onHover(target, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
  });
  // Leaving the map clears any hover so the tooltip never lingers over a sidebar (mousemove alone
  // stops firing at the container edge, so it would otherwise stay painted).
  container.addEventListener("mouseleave", (e) => {
    container.classList.remove("con-hover");
    deps.onHover(null, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
  });

  // A box around a constellation's stars, drawn as the last SVG child so no layer paints over it. Sized to
  // the star bounding box (plus padding) rather than the art texture rect, so it hugs the actual stars.
  function highlightCon(id: string | null) {
    const live = container.querySelector("svg") as SVGSVGElement | null;
    if (!live) return;
    live.querySelector(".con-highlight")?.remove();
    if (!id) return;
    const con = model.constellations.get(id);
    const stars = con?.starIds.map((s) => model.stars.get(s)).filter((s): s is NonNullable<typeof s> => !!s) ?? [];
    if (!stars.length) return;
    const xs = stars.map((s) => s.position.x + STAR_CENTER);
    const ys = stars.map((s) => s.position.y + STAR_CENTER);
    const x0 = Math.min(...xs) - CON_PAD;
    const y0 = Math.min(...ys) - CON_PAD;
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("class", "con-highlight");
    rect.setAttribute("x", String(x0));
    rect.setAttribute("y", String(y0));
    rect.setAttribute("width", String(Math.max(...xs) + CON_PAD - x0));
    rect.setAttribute("height", String(Math.max(...ys) + CON_PAD - y0));
    rect.setAttribute("rx", "8");
    live.appendChild(rect);
  }

  return {
    svg,
    update(state, highlight, reach, diff, affinityFilter) {
      const live = container.querySelector("svg") as SVGSVGElement | null;
      const vb = live?.getAttribute("viewBox");
      render(state, highlight, reach, diff, affinityFilter);
      const next = container.querySelector("svg") as SVGSVGElement | null;
      if (vb && next) next.setAttribute("viewBox", vb); // preserve pan/zoom across re-render
    },
    highlightCon,
  };
}
