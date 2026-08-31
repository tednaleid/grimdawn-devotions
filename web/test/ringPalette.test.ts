// ABOUTME: Tests the ring palette adapter: distinct cycling colors for benefit searches and a
// ABOUTME: reserved query color that never collides with them.
import { test, expect } from "bun:test";
import {
  BENEFIT_RING_PALETTE,
  RING_STYLE_COUNT,
  QUERY_RING_COLOR,
  QUERY_RING_DASH,
  benefitRingColor,
  benefitRingDash,
  scaleDash,
} from "../src/adapters/ringPalette";

test("benefit ring colors are distinct and cycle past the palette", () => {
  expect(new Set(BENEFIT_RING_PALETTE).size).toBe(BENEFIT_RING_PALETTE.length);
  expect(benefitRingColor(0)).toBe(BENEFIT_RING_PALETTE[0]!);
  expect(benefitRingColor(BENEFIT_RING_PALETTE.length)).toBe(BENEFIT_RING_PALETTE[0]!);
});

test("the query ring color is reserved (not in the benefit palette)", () => {
  expect(BENEFIT_RING_PALETTE).not.toContain(QUERY_RING_COLOR);
});

test("color and dash cycle at different lengths, so slot styles stay unique well past the palette", () => {
  expect(benefitRingDash(0)).toBe(""); // slot 0 is solid
  // The unique-combo count is the two cycle lengths' lcm, and must exceed the color count alone
  // (that is the whole point of decoupling: slot 5 is cyan-dashed, not cyan-solid again).
  expect(RING_STYLE_COUNT).toBeGreaterThan(BENEFIT_RING_PALETTE.length);
  const combos = new Set<string>();
  for (let i = 0; i < RING_STYLE_COUNT; i++) combos.add(`${benefitRingColor(i)}|${benefitRingDash(i)}`);
  expect(combos.size).toBe(RING_STYLE_COUNT);
  // ...and the wrap-around style differs from the first slot's.
  expect(benefitRingColor(BENEFIT_RING_PALETTE.length) === benefitRingColor(0)).toBe(true);
  expect(benefitRingDash(BENEFIT_RING_PALETTE.length) === benefitRingDash(0)).toBe(false);
});

test("white is in the palette so five concurrent benefit searches get five distinct hues", () => {
  expect(BENEFIT_RING_PALETTE.length).toBe(5);
  expect(BENEFIT_RING_PALETTE.some((c) => c.toLowerCase() === "#f0f4ff")).toBe(true);
});

test("the query ring dash is its own pattern, not one of the benefit patterns", () => {
  expect(BENEFIT_RING_PALETTE.map((_, i) => benefitRingDash(i))).not.toContain(QUERY_RING_DASH);
  expect(QUERY_RING_DASH.length).toBeGreaterThan(0);
});

test("scaleDash shrinks every number in a dash pattern for legend swatches", () => {
  expect(scaleDash("16 11", 0.5)).toBe("8 5.5");
  expect(scaleDash("", 0.5)).toBe(""); // solid stays solid
});
