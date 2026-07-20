// ABOUTME: Unit tests for the build-order quality metrics: churn counts non-crossroads scaffold-add
// ABOUTME: points only (crossroads bootstrapping is free by definition; completes are the build itself).
import { test, expect } from "bun:test";
import { churnPoints } from "../src/core/reachability";
import type { BuildStep } from "../src/core/reachability";

test("churn counts non-crossroads scaffold-add points only", () => {
  const steps: BuildStep[] = [
    { kind: "scaffold-add", conId: "crossroads_chaos", points: 1, heldAfter: 1 },
    { kind: "scaffold-add", conId: "falcon", points: 5, heldAfter: 6 },
    { kind: "complete", conId: "berserker", points: 6, heldAfter: 12 },
    { kind: "scaffold-refund", conId: "falcon", points: -5, heldAfter: 7 },
    { kind: "scaffold-refund", conId: "crossroads_chaos", points: -1, heldAfter: 6 },
  ];
  expect(churnPoints(steps)).toBe(5);
});

test("a crossroads-only bootstrap has zero churn", () => {
  const steps: BuildStep[] = [
    { kind: "scaffold-add", conId: "crossroads_order", points: 1, heldAfter: 1 },
    { kind: "complete", conId: "empty_throne", points: 4, heldAfter: 5 },
    { kind: "scaffold-refund", conId: "crossroads_order", points: -1, heldAfter: 4 },
  ];
  expect(churnPoints(steps)).toBe(0);
});
