// ABOUTME: The search-ring style palette: hue plus stroke pattern for concurrent benefit searches
// ABOUTME: and the reserved text-query style, so ring identity survives color vision deficiency.
/**
 * Ring colors for benefit-tag searches, assigned by palette slot (see
 * core/searchRings.reconcileRingSlots) and cycling past the end. Star cores already spend
 * magenta/red/green/yellow/blue on affinity identity, so these sit between those hues; white
 * earns its place as pure lightness, which survives every color vision deficiency.
 */
export const BENEFIT_RING_PALETTE = ["#3ee6d8", "#ff9440", "#a78bff", "#ff5e8a", "#f0f4ff"] as const;

/**
 * The stroke-dasharray cycle, the redundant identity channel beside color (about 8% of men have
 * red-green color vision deficiency, and hue alone also fails at heavy zoom-out). Values are map
 * user units against ring radius 23 and stroke width 8: solid, dashed, dotted (hairline dashes +
 * round linecaps render as dots), and dash-dot. Deliberately a different length than the color
 * palette: the two cycles drift against each other, so the combined style repeats only every
 * RING_STYLE_COUNT slots (slot 5 is cyan-dashed, not cyan-solid again).
 */
const BENEFIT_RING_DASHES = ["", "16 11", "0.1 13", "22 9 0.1 9"] as const;

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Unique (color, dash) combos before ring styles truly repeat: the two cycle lengths' lcm. */
export const RING_STYLE_COUNT =
  (BENEFIT_RING_PALETTE.length * BENEFIT_RING_DASHES.length) /
  gcd(BENEFIT_RING_PALETTE.length, BENEFIT_RING_DASHES.length);

/** The text query's ring style, reserved so the query never trades styles with benefit tags. */
export const QUERY_RING_COLOR = "#d4e157";
export const QUERY_RING_DASH = "30 14";

/** One search's ring identity: the stroke color and dash pattern its arcs and swatches share. */
export interface RingStyle {
  color: string;
  dash: string;
}

export function benefitRingColor(slot: number): string {
  return BENEFIT_RING_PALETTE[slot % BENEFIT_RING_PALETTE.length]!;
}

export function benefitRingDash(slot: number): string {
  return BENEFIT_RING_DASHES[slot % BENEFIT_RING_DASHES.length]!;
}

/** A dash pattern shrunk for legend swatches, which draw the ring at a fraction of map size. */
export function scaleDash(dash: string, factor: number): string {
  if (!dash) return "";
  return dash
    .split(" ")
    .map((v) => String(Math.round(Number(v) * factor * 100) / 100))
    .join(" ");
}

// Radius ratio between a legend swatch's ring (r 6) and the map ring (r 23).
const SWATCH_DASH_SCALE = 6 / 23;

/** A small inline-SVG ring in the search's style: the legend key on rows, chips, and the search box. */
export function ringSwatchSvg(style: RingStyle): string {
  const dash = style.dash ? ` stroke-dasharray="${scaleDash(style.dash, SWATCH_DASH_SCALE)}"` : "";
  return (
    `<svg class="ring-swatch" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">` +
    `<circle cx="8" cy="8" r="6" fill="none" stroke="${style.color}" stroke-width="2.5" stroke-linecap="round"${dash}/></svg>`
  );
}
