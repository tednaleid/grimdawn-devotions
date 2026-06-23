// ABOUTME: Tests for viewbox.ts -- fitViewBox, panViewBox, zoomViewBox, toViewBoxString.
// ABOUTME: Self-contained pure math; no project data dependencies.
import { test, expect } from "bun:test";
import { fitViewBox, panViewBox, zoomViewBox, toViewBoxString } from "../src/core/viewbox";

test("fitViewBox bounds points with padding", () => {
  const vb = fitViewBox(
    [
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ],
    10,
  );
  expect(vb).toEqual({ x: -10, y: -10, w: 120, h: 70 });
});

test("pan shifts the window opposite to world delta", () => {
  expect(panViewBox({ x: 0, y: 0, w: 100, h: 100 }, 5, -5)).toEqual({ x: -5, y: 5, w: 100, h: 100 });
});

test("zoom keeps the focus world point stationary", () => {
  const vb = zoomViewBox({ x: 0, y: 0, w: 100, h: 100 }, 50, 50, 0.5, 10, 1000);
  // focus at center stays center: new w=50, x=25
  expect(vb).toEqual({ x: 25, y: 25, w: 50, h: 50 });
});

test("zoom clamps to min width", () => {
  const vb = zoomViewBox({ x: 0, y: 0, w: 20, h: 20 }, 10, 10, 0.1, 10, 1000);
  expect(vb.w).toBe(10);
});

test("toViewBoxString formats", () => {
  expect(toViewBoxString({ x: 1, y: 2, w: 3, h: 4 })).toBe("1 2 3 4");
});
