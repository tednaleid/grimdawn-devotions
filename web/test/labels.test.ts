// ABOUTME: Tests for labels.ts -- makeLabeler with known-label lookup and camelCase humanizer.
// ABOUTME: Self-contained; no project data dependencies.
import { test, expect } from "bun:test";
import { makeLabeler } from "../src/core/labels";

test("uses provided label when present", () => {
  const label = makeLabeler({ offensiveFireModifier: "% Fire Damage" });
  expect(label("offensiveFireModifier")).toBe("% Fire Damage");
});

test("humanizes unknown stat ids", () => {
  const label = makeLabeler({});
  expect(label("offensiveSlowBleedingModifier")).toBe("Offensive Slow Bleeding Modifier");
});
