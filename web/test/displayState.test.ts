// ABOUTME: Headless tests for the pure display-state resolver.
// ABOUTME: Synthetic constellations/stars + ReachView keep each case deterministic.
import { test, expect } from "bun:test";
import { constellationDisplay, type DisplaySettings } from "../src/core/displayState";
import type { Affinity, Constellation } from "../src/core/types";
import type { ReachView } from "../src/core/reachability";

function con(id: string, starIds: string[], bonus: Partial<Record<Affinity, number>> = {}): Constellation {
  return {
    id,
    name: id,
    starIds,
    affinityBonus: bonus,
    affinityRequired: {},
    background: null,
  } as unknown as Constellation;
}
function reach(over: Partial<ReachView> = {}): ReachView {
  return {
    completable: new Set(),
    clickable: new Set(),
    have: [0, 0, 0, 0, 0],
    need: [0, 0, 0, 0, 0],
    needSource: new Map(),
    ...over,
  } as ReachView;
}
function settings(over: Partial<DisplaySettings> = {}): DisplaySettings {
  return { selected: new Set(), ...over };
}

test("constellation brightness: active when every star selected", () => {
  const c = con("c", ["c:0", "c:1"]);
  const d = constellationDisplay(c, settings({ selected: new Set(["c:0", "c:1"]), reach: reach() }));
  expect(d.brightness).toBe("active");
  expect(d.selfGlow).toBe(true);
});

test("constellation brightness: attainable when completable, unattainable otherwise", () => {
  const c = con("c", ["c:0"]);
  expect(constellationDisplay(c, settings({ reach: reach({ completable: new Set(["c"]) }) })).brightness).toBe(
    "attainable",
  );
  expect(constellationDisplay(c, settings({ reach: reach() })).brightness).toBe("unattainable");
});

test("constellation brightness: no reach view is permissively attainable", () => {
  expect(constellationDisplay(con("c", ["c:0"]), settings()).brightness).toBe("attainable");
});

test("constellation color: identity with no filter, match with matched affinities, mute otherwise", () => {
  const c = con("c", ["c:0"], { chaos: 2 });
  expect(constellationDisplay(c, settings()).color).toEqual({ kind: "identity" });
  const match = constellationDisplay(
    c,
    settings({ affinityFilter: { grants: new Set<Affinity>(["chaos"]), requires: new Set() } }),
  );
  expect(match.color).toEqual({ kind: "match", affinities: ["chaos"] });
  const mute = constellationDisplay(
    c,
    settings({ affinityFilter: { grants: new Set<Affinity>(["order"]), requires: new Set() } }),
  );
  expect(mute.color).toEqual({ kind: "mute" });
});

test("constellation: active and off-filter is active AND muted (no exemption)", () => {
  const c = con("c", ["c:0"], { chaos: 2 });
  const d = constellationDisplay(
    c,
    settings({
      selected: new Set(["c:0"]),
      reach: reach({ completable: new Set(["c"]) }),
      affinityFilter: { grants: new Set<Affinity>(["order"]), requires: new Set() },
    }),
  );
  expect(d.brightness).toBe("active");
  expect(d.color).toEqual({ kind: "mute" });
});
