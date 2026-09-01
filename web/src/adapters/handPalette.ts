// ABOUTME: The search-hand style palette: a fixed angle plus color per slot for concurrent benefit
// ABOUTME: searches, the reserved text-query style, and the mini-star swatch that keys chrome to the map.

/**
 * Hand angles by slot, in degrees clockwise from straight up. Cardinals first (people name up,
 * down, left and right most precisely), then diagonals, and straight up last: it is the text
 * query's reserved direction, so only the eighth concurrent benefit tag shares it (stacked, in
 * another color). Slots k and k+5 share a color, so the order also keeps HAND_ANGLES[k % 8] and
 * HAND_ANGLES[(k + 5) % 8] at least 135 degrees apart around the whole cycle; the palette test
 * pins that, so reorder only with the test in hand.
 */
export const HAND_ANGLES = [90, 270, 180, 225, 135, 315, 45, 0] as const;

/**
 * Hand colors by slot. Star cores already spend magenta/red/green/yellow/blue on affinity
 * identity, so these sit between those hues. White leads because pure lightness survives every
 * color vision deficiency; cyan and orange are near-complements; pink and lavender, the closest
 * pair, come last. Five colors against eight angles are coprime, so the combined style stays
 * unique for HAND_STYLE_COUNT slots.
 */
export const HAND_COLORS = ["#f0f4ff", "#3ee6d8", "#ff9440", "#ff5e8a", "#a78bff"] as const;

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Unique (angle, color) styles before slots truly repeat: the two cycle lengths' lcm. */
export const HAND_STYLE_COUNT = (HAND_ANGLES.length * HAND_COLORS.length) / gcd(HAND_ANGLES.length, HAND_COLORS.length);

/** One search's hand identity: the direction it points (degrees clockwise from up) and its color. */
export interface HandStyle {
  angle: number;
  color: string;
}

export function handStyle(slot: number): HandStyle {
  return { angle: HAND_ANGLES[slot % HAND_ANGLES.length]!, color: HAND_COLORS[slot % HAND_COLORS.length]! };
}

/** The text query's hand style, reserved so the query never trades looks with benefit tags. */
export const QUERY_HAND_COLOR = "#d4e157";
export const QUERY_HAND_STYLE: HandStyle = { angle: 0, color: QUERY_HAND_COLOR };
/** The query's slot for stacking: below every benefit slot, so it roots any stack it shares. */
export const QUERY_HAND_SLOT = -1;

/** The point `r` units from (cx, cy) along a hand angle (degrees clockwise from straight up). */
export function polarPoint(cx: number, cy: number, r: number, angle: number): { x: number; y: number } {
  const rad = (angle * Math.PI) / 180;
  return { x: Math.round((cx + r * Math.sin(rad)) * 100) / 100, y: Math.round((cy - r * Math.cos(rad)) * 100) / 100 };
}

// The swatch's mini star: a neutral disc (a placeholder for "a star", not an affinity), a faint
// track, and one hand from just off the disc to just inside the box, in a 16-unit view box drawn
// at 16px so the hand's direction reads at a glance.
const SWATCH_CENTER = 8;
const SWATCH_HAND_ROOT = 2.8;
const SWATCH_HAND_TIP = 6.8;

/** A small inline-SVG mini star wearing one hand in the search's style: the legend key on rows and the search box. */
export function handSwatchSvg(style: HandStyle): string {
  const a = polarPoint(SWATCH_CENTER, SWATCH_CENTER, SWATCH_HAND_ROOT, style.angle);
  const b = polarPoint(SWATCH_CENTER, SWATCH_CENTER, SWATCH_HAND_TIP, style.angle);
  return (
    `<svg class="hand-swatch" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">` +
    `<circle cx="8" cy="8" r="6.4" fill="none" stroke="#fff" stroke-opacity="0.18"/>` +
    `<circle cx="8" cy="8" r="2.4" fill="#3a4556"/>` +
    `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${style.color}" stroke-width="2.6" stroke-linecap="round"/></svg>`
  );
}
