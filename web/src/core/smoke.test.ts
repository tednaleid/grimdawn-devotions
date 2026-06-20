// ABOUTME: Smoke test verifying bun test infrastructure is operational.
// ABOUTME: This file is intentionally minimal; it proves the test runner works.
import { test, expect } from "bun:test";

test("bun test runs", () => {
  expect(1 + 1).toBe(2);
});
