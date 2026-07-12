// ABOUTME: Headless tests for the pure display-state resolver.
// ABOUTME: Synthetic constellations/stars + ReachView keep each case deterministic.
import { test, expect } from "bun:test";
import { constellationDisplay, starDisplay, edgeDisplay, type DisplaySettings } from "../src/core/displayState";
import type { Affinity, Constellation, Star as StarT } from "../src/core/types";
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
    reachableStars: new Set<string>(),
    have: [0, 0, 0, 0, 0],
    need: [0, 0, 0, 0, 0],
    needSource: new Map(),
    ...over,
  } as ReachView;
}
function settings(over: Partial<DisplaySettings> = {}): DisplaySettings {
  return { selected: new Set(), ...over };
}
function star(id: string, conId: string, preds: string[] = []): StarT {
  return {
    id,
    constellationId: conId,
    predecessors: preds,
    celestialPower: null,
    position: { x: 0, y: 0 },
  } as unknown as StarT;
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

test("star brightness: active selected; attainable when clickable OR constellation completable; else unattainable", () => {
  const c = con("c", ["c:0", "c:1"]);
  const s0 = star("c:0", "c");
  expect(starDisplay(s0, c, settings({ selected: new Set(["c:0"]), reach: reach() })).brightness).toBe("active");
  expect(starDisplay(s0, c, settings({ reach: reach({ clickable: new Set(["c:0"]) }) })).brightness).toBe("attainable");
  expect(starDisplay(star("c:1", "c"), c, settings({ reach: reach({ completable: new Set(["c"]) }) })).brightness).toBe(
    "attainable",
  );
  expect(starDisplay(s0, c, settings({ reach: reach() })).brightness).toBe("unattainable");
});

test("star immediacy: clickable true only when clickable (or no reach)", () => {
  const c = con("c", ["c:0"]);
  expect(starDisplay(star("c:0", "c"), c, settings({ reach: reach({ clickable: new Set(["c:0"]) }) })).clickable).toBe(
    true,
  );
  expect(starDisplay(star("c:0", "c"), c, settings({ reach: reach() })).clickable).toBe(false);
  expect(starDisplay(star("c:0", "c"), c, settings()).clickable).toBe(true);
});

test("star color: muted when its constellation fails the affinity filter, identity when it passes", () => {
  const c = con("c", ["c:0"], { chaos: 2 });
  const onChaos = settings({ affinityFilter: { grants: new Set<Affinity>(["chaos"]), requires: new Set() } });
  const onOrder = settings({ affinityFilter: { grants: new Set<Affinity>(["order"]), requires: new Set() } });
  expect(starDisplay(star("c:0", "c"), c, onChaos).color).toEqual({ kind: "identity" });
  expect(starDisplay(star("c:0", "c"), c, onOrder).color).toEqual({ kind: "mute" });
});

test("star benefit-match is emphasis, independent of color: muted AND benefitMatch at once", () => {
  const c = con("c", ["c:0"], { chaos: 2 });
  const d = starDisplay(
    star("c:0", "c"),
    c,
    settings({
      benefitMatch: new Set(["c:0"]),
      affinityFilter: { grants: new Set<Affinity>(["order"]), requires: new Set() },
    }),
  );
  expect(d.benefitMatch).toBe(true);
  expect(d.color).toEqual({ kind: "mute" });
});

test("star diff add/remove flows through", () => {
  const c = con("c", ["c:0"]);
  const d = starDisplay(star("c:0", "c"), c, settings({ diff: { added: new Set(["c:0"]), removed: new Set() } }));
  expect(d.diff).toBe("add");
});

test("edge brightness: active when taken; else follows the constellation", () => {
  const c = con("c", ["c:0", "c:1"]);
  expect(edgeDisplay(c, "c:0", "c:1", settings({ selected: new Set(["c:0", "c:1"]), reach: reach() })).taken).toBe(
    true,
  );
  expect(edgeDisplay(c, "c:0", "c:1", settings({ selected: new Set(["c:0", "c:1"]), reach: reach() })).brightness).toBe(
    "active",
  );
  expect(edgeDisplay(c, "c:0", "c:1", settings({ reach: reach({ completable: new Set(["c"]) }) })).brightness).toBe(
    "attainable",
  );
  expect(edgeDisplay(c, "c:0", "c:1", settings({ reach: reach() })).brightness).toBe("unattainable");
});

test("edge color: muted when its constellation fails the affinity filter", () => {
  const c = con("c", ["c:0", "c:1"], { chaos: 2 });
  const onOrder = settings({ affinityFilter: { grants: new Set<Affinity>(["order"]), requires: new Set() } });
  expect(edgeDisplay(c, "c:0", "c:1", onOrder).color).toEqual({ kind: "mute" });
});
