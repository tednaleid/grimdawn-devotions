// ABOUTME: The search-mark style palette: a fixed angle plus color per slot for concurrent searches
// ABOUTME: (benefit tags and the text query alike), and the mini-star swatch that keys chrome to the map.

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
 * Mark colors by slot. Star cores already spend magenta/red/green/yellow/blue on affinity
 * identity, so these sit between those hues. White leads because pure lightness survives every
 * color vision deficiency; cyan and orange are near-complements; pink and lavender, the closest
 * pair, come last. Five colors against eight angles are coprime, so the combined style stays
 * unique for MARK_STYLE_COUNT slots.
 */
export const MARK_COLORS = ["#f0f4ff", "#3ee6d8", "#ff9440", "#ff5e8a", "#a78bff"] as const;

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
