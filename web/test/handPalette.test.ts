// ABOUTME: Tests the hand palette adapter: a fixed angle plus color per slot that stays unique and
// ABOUTME: well separated across the cycle, a reserved query style, and the mini-star legend swatch.
import { test, expect } from "bun:test";
import {
  HAND_ANGLES,
  HAND_COLORS,
  HAND_STYLE_COUNT,
  QUERY_HAND_COLOR,
  QUERY_HAND_SLOT,
  QUERY_HAND_STYLE,
  handStyle,
  handSwatchSvg,
} from "../src/adapters/handPalette";

const angleGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

test("the first 40 slots wear 40 distinct angle+color styles, then the cycle repeats", () => {
  expect(HAND_STYLE_COUNT).toBe(40); // lcm of 8 angles and 5 colors
  const seen = new Set<string>();
  for (let i = 0; i < HAND_STYLE_COUNT; i++) {
    const s = handStyle(i);
    seen.add(`${s.angle}|${s.color}`);
  }
  expect(seen.size).toBe(HAND_STYLE_COUNT);
  expect(handStyle(HAND_STYLE_COUNT)).toEqual(handStyle(0));
});

test("same-colored slots point at least 90 degrees apart across the whole cycle", () => {
  // Slots k and k+5 share a color, so the angle table must keep them well separated; this
  // table achieves 135 degrees, and any reordering must keep at least a right angle.
  for (let k = 0; k < HAND_STYLE_COUNT; k++) {
    const a = handStyle(k);
    const b = handStyle(k + 5);
    expect(b.color).toBe(a.color);
    expect(angleGap(a.angle, b.angle)).toBeGreaterThanOrEqual(90);
  }
});

test("cardinal directions come first, and straight up is the last benefit angle (the query's)", () => {
  expect(HAND_ANGLES.slice(0, 3).every((a) => a % 90 === 0)).toBe(true);
  expect(HAND_ANGLES[HAND_ANGLES.length - 1]).toBe(0);
  expect(QUERY_HAND_STYLE.angle).toBe(0);
  expect(QUERY_HAND_STYLE.color).toBe(QUERY_HAND_COLOR);
});

test("the query color is reserved (not a benefit color) and white leads the benefit colors", () => {
  expect(HAND_COLORS).not.toContain(QUERY_HAND_COLOR);
  expect(HAND_COLORS.length).toBe(5);
  expect(new Set(HAND_COLORS).size).toBe(HAND_COLORS.length);
  expect(HAND_COLORS[0]!.toLowerCase()).toBe("#f0f4ff");
});

const lineOf = (svg: string) => {
  const m = svg.match(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"[^>]*\/>/);
  expect(m).not.toBeNull();
  return { x1: Number(m![1]), y1: Number(m![2]), x2: Number(m![3]), y2: Number(m![4]), attrs: m![0] };
};

test("the swatch is a neutral mini star with one hand at the style's angle in its color", () => {
  const svg = handSwatchSvg({ angle: 90, color: "#3ee6d8" });
  expect(svg).toContain('class="hand-swatch" width="16" height="16"');
  expect(svg).toContain('fill="#3a4556"'); // the neutral disc: "a star", not an affinity
  expect(svg).not.toContain("stroke-dasharray");
  const hand = lineOf(svg);
  expect(hand.attrs).toContain('stroke="#3ee6d8"');
  // 90 degrees points right (clockwise from twelve): a horizontal line heading to larger x.
  expect(hand.y1).toBeCloseTo(hand.y2, 1);
  expect(hand.x2).toBeGreaterThan(hand.x1);
});

test("the swatch hand for straight up rises from the disc", () => {
  const hand = lineOf(handSwatchSvg({ angle: 0, color: "#d4e157" }));
  expect(hand.x1).toBeCloseTo(hand.x2, 1);
  expect(hand.y2).toBeLessThan(hand.y1);
});

test("the query's slot sorts below every benefit slot, so it roots any stack it shares", () => {
  expect(QUERY_HAND_SLOT).toBeLessThan(0);
});
