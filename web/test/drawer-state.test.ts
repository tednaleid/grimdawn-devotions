// ABOUTME: Tests toggleDrawer, the pure reducer for which overlay sidebar (if any) is open.
// ABOUTME: Covers opening, the "opening one closes the other" rule, and re-tap-to-close.
import { test, expect } from "bun:test";
import { toggleDrawer, type DrawerState } from "../src/core/drawerState";

test("opening a side from none opens that side", () => {
  expect(toggleDrawer("none", "left")).toBe("left");
  expect(toggleDrawer("none", "right")).toBe("right");
});

test("opening one side closes the other", () => {
  expect(toggleDrawer("left", "right")).toBe("right");
  expect(toggleDrawer("right", "left")).toBe("left");
});

test("re-tapping the open side closes it", () => {
  expect(toggleDrawer("left", "left")).toBe("none");
  expect(toggleDrawer("right", "right")).toBe("none");
});

test("the result is always a valid DrawerState", () => {
  const states: DrawerState[] = ["none", "left", "right"];
  for (const s of states)
    for (const side of ["left", "right"] as const) expect(states).toContain(toggleDrawer(s, side));
});
