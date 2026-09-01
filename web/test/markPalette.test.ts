// ABOUTME: Tests the mark palette adapter: a fixed angle plus color per slot that stays unique and
// ABOUTME: well separated across the cycle, the arc path helper, and the mini-star legend swatch.
import { test, expect } from "bun:test";
import {
  MARK_ANGLES,
  MARK_COLORS,
  MARK_STYLE_COUNT,
  arcPath,
  markStyle,
  markSwatchSvg,
} from "../src/adapters/markPalette";

const angleGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

test("the first 40 slots wear 40 distinct angle+color styles, then the cycle repeats", () => {
  expect(MARK_STYLE_COUNT).toBe(40); // lcm of 8 angles and 5 colors
  const seen = new Set<string>();
  for (let i = 0; i < MARK_STYLE_COUNT; i++) {
    const s = markStyle(i);
    seen.add(`${s.angle}|${s.color}`);
  }
  expect(seen.size).toBe(MARK_STYLE_COUNT);
  expect(markStyle(MARK_STYLE_COUNT)).toEqual(markStyle(0));
});

test("same-colored slots point at least 90 degrees apart across the whole cycle", () => {
  // Slots k and k+5 share a color, so the angle table must keep them well separated; this
  // table achieves 135 degrees, and any reordering must keep at least a right angle.
  for (let k = 0; k < MARK_STYLE_COUNT; k++) {
    const a = markStyle(k);
    const b = markStyle(k + 5);
    expect(b.color).toBe(a.color);
    expect(angleGap(a.angle, b.angle)).toBeGreaterThanOrEqual(90);
  }
});

test("north comes first and every cardinal direction precedes the diagonals", () => {
  expect(MARK_ANGLES[0]).toBe(0);
  expect(MARK_ANGLES.slice(0, 4).every((a) => a % 90 === 0)).toBe(true);
});

test("five distinct benefit colors, white first (lightness survives every color deficiency)", () => {
  expect(MARK_COLORS.length).toBe(5);
  expect(new Set(MARK_COLORS).size).toBe(MARK_COLORS.length);
  expect(MARK_COLORS[0]!.toLowerCase()).toBe("#f0f4ff");
});

test("arcPath draws clockwise from the first angle to the second, flagging arcs past a half turn", () => {
  expect(arcPath(0, 0, 10, 0, 90)).toBe("M 0 -10 A 10 10 0 0 1 10 0");
  expect(arcPath(0, 0, 10, 0, 270)).toBe("M 0 -10 A 10 10 0 1 1 -10 0");
});

test("the swatch is a neutral mini star with a 90-degree arc centred on the style's angle in its color", () => {
  const svg = markSwatchSvg({ angle: 90, color: "#3ee6d8" });
  expect(svg).toContain('class="mark-swatch" width="16" height="16"');
  expect(svg).toContain('fill="#3a4556"'); // the neutral disc: "a star", not an affinity
  // 90 degrees is east: the arc runs from 45 to 135 around the right side.
  expect(svg).toContain('<path d="M 11.96 4.04 A 5.6 5.6 0 0 1 11.96 11.96" fill="none" stroke="#3ee6d8"');
});

test("the swatch arc for north sits across the top", () => {
  expect(markSwatchSvg({ angle: 0, color: "#f0f4ff" })).toContain('<path d="M 4.04 4.04 A 5.6 5.6 0 0 1 11.96 4.04"');
});
