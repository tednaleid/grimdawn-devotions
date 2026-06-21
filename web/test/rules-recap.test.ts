// ABOUTME: Tests for recapValue - restoring a finite point cap when leaving uncapped mode.
// ABOUTME: A cap can never sit below the current selection, and a selection over the max blocks re-capping.
import { test, expect } from "bun:test";
import { recapValue } from "../src/core/rules";

test("restores the prior cap when the selection fits under it", () => {
  expect(recapValue(40, 55)).toBe(55);
});

test("floors to the current selection when it exceeds the prior cap", () => {
  expect(recapValue(50, 30)).toBe(50);
});

test("allows re-capping exactly at the max", () => {
  expect(recapValue(55, 55)).toBe(55);
});

test("blocks re-capping while over the max (returns null)", () => {
  expect(recapValue(60, 55)).toBeNull();
});

test("defaults the max cap to 55", () => {
  expect(recapValue(56, 55)).toBeNull();
});
