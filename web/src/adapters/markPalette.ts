// ABOUTME: The search-mark style palette: a fixed angle plus color per slot for concurrent searches
// ABOUTME: (benefit tags and the text query alike), and the mini-star swatch that keys chrome to the map.
import { affinityColor } from "./affinityColors";

/**
 * Mark angles by slot, in degrees clockwise from straight up. North then south lead: one or two
 * concurrent searches is the common case (a damage type's flat and percent lines, say) and
 * opposite halves read far better than two halves split at a bisector. East and west follow
 * (people name the cardinals most precisely), then the diagonals in the one order that keeps
 * same-colored slots (k and k+5) at least 135 degrees apart through seven concurrent searches;
 * the eighth is the first to share a color with a 45-degree neighbour. The palette test pins
 * that, so reorder only with the test in hand.
 */
export const MARK_ANGLES = [0, 180, 90, 270, 315, 225, 45, 135] as const;

/**
 * Mark colors by slot: the five affinity orb colors, so the map wears one palette. Direction is
 * the primary identity, so the colors only need to tell neighbours apart: gold leads as the
 * lightest, blue is its opposite, and red and green sit east and west so the pair that red-green
 * color vision deficiency merges is always parted by direction. Five colors against eight angles
 * are coprime, so the combined style stays unique for MARK_STYLE_COUNT slots. A search's color
 * can coincide with its star's affinity, and the query's halo with an affinity-filter halo; the
 * arcs' outline and track, and the star arcs a query always adds, keep those apart.
 */
export const MARK_COLORS = [
  affinityColor("order"),
  affinityColor("primordial"),
  affinityColor("chaos"),
  affinityColor("eldritch"),
  affinityColor("ascendant"),
] as const;

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Unique (angle, color) styles before slots truly repeat: the two cycle lengths' lcm. */
export const MARK_STYLE_COUNT = (MARK_ANGLES.length * MARK_COLORS.length) / gcd(MARK_ANGLES.length, MARK_COLORS.length);

/** One search's mark identity: the direction its arc is centred on (degrees clockwise from up) and its color. */
export interface MarkStyle {
  angle: number;
  color: string;
}

export function markStyle(slot: number): MarkStyle {
  return { angle: MARK_ANGLES[slot % MARK_ANGLES.length]!, color: MARK_COLORS[slot % MARK_COLORS.length]! };
}

/** The point `r` units from (cx, cy) along an angle in degrees clockwise from straight up. */
export function polarPoint(cx: number, cy: number, r: number, angle: number): { x: number; y: number } {
  const rad = (angle * Math.PI) / 180;
  return { x: Math.round((cx + r * Math.sin(rad)) * 100) / 100, y: Math.round((cy - r * Math.cos(rad)) * 100) / 100 };
}

/** SVG path data for the clockwise arc from a0 to a1 (degrees clockwise from up) at radius r around (cx, cy). */
export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = polarPoint(cx, cy, r, a0);
  const q = polarPoint(cx, cy, r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${p.x} ${p.y} A ${r} ${r} 0 ${large} 1 ${q.x} ${q.y}`;
}

/**
 * SVG path data for a filled ring sector from a0 to a1 (degrees clockwise from up) between radii
 * ri and ro around (cx, cy), its four corners rounded to radius rc: the outer edge runs clockwise,
 * the inner edge back, and each corner is an arc tangent to its edge and its radial end line. The
 * corner radius is capped at half the ring's width and at what a narrow sector can hold.
 */
export function roundedSectorPath(
  cx: number,
  cy: number,
  ri: number,
  ro: number,
  a0: number,
  a1: number,
  rc: number,
): string {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const deg = (r: number) => (r * 180) / Math.PI;
  // Corners fit when the inner edge still has room between them: 2 * asin(r / (ri + r)) <= span.
  const half = Math.sin(rad((a1 - a0) / 2));
  const rFit = half >= 1 ? Infinity : (ri * half) / (1 - half);
  const r = Math.round(Math.max(0, Math.min(rc, (ro - ri) / 2, rFit)) * 100) / 100;
  // Angular offset of each corner's centre from its end line, and the radius of the point where
  // the corner touches that line.
  const dOut = deg(Math.asin(r / (ro - r)));
  const dIn = deg(Math.asin(r / (ri + r)));
  const tOut = (ro - r) * Math.cos(rad(dOut));
  const tIn = (ri + r) * Math.cos(rad(dIn));
  const pt = (radius: number, angle: number) => {
    const p = polarPoint(cx, cy, radius, angle);
    return `${p.x} ${p.y}`;
  };
  const corner = (radius: number, angle: number) => `A ${r} ${r} 0 0 1 ${pt(radius, angle)}`;
  const outerLarge = a1 - a0 - 2 * dOut > 180 ? 1 : 0;
  const innerLarge = a1 - a0 - 2 * dIn > 180 ? 1 : 0;
  return [
    `M ${pt(ro, a0 + dOut)}`,
    `A ${ro} ${ro} 0 ${outerLarge} 1 ${pt(ro, a1 - dOut)}`,
    corner(tOut, a1),
    `L ${pt(tIn, a1)}`,
    corner(ri, a1 - dIn),
    `A ${ri} ${ri} 0 ${innerLarge} 0 ${pt(ri, a0 + dIn)}`,
    corner(tIn, a0),
    `L ${pt(tOut, a0)}`,
    corner(ro, a0 + dOut),
    "Z",
  ].join(" ");
}

// The swatch's mini star: a neutral disc (a placeholder for "a star", not an affinity), a faint
// track, and a 90-degree arc centred on the mark's angle, in a 16-unit view box drawn at 16px.
// The map draws half circles; the swatch's quarter leaves room on both sides so the direction
// reads without a neighbour to cut it.
const SWATCH_CENTER = 8;
const SWATCH_RING_R = 5.6;
const SWATCH_ARC_HALF_SPAN = 45;

/** A small inline-SVG mini star wearing one arc in the search's style: the legend key on rows and the search box. */
export function markSwatchSvg(style: MarkStyle): string {
  const d = arcPath(
    SWATCH_CENTER,
    SWATCH_CENTER,
    SWATCH_RING_R,
    style.angle - SWATCH_ARC_HALF_SPAN,
    style.angle + SWATCH_ARC_HALF_SPAN,
  );
  return (
    `<svg class="mark-swatch" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">` +
    `<circle cx="8" cy="8" r="${SWATCH_RING_R}" fill="none" stroke="#fff" stroke-opacity="0.18"/>` +
    `<circle cx="8" cy="8" r="3" fill="#3a4556"/>` +
    `<path d="${d}" fill="none" stroke="${style.color}" stroke-width="2.8"/></svg>`
  );
}
