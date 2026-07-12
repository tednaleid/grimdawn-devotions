// ABOUTME: Tests commitButton, the pure Add/Remove label+enabled mapping for the touch popover.
// ABOUTME: Asserts it mirrors toggleStar/toggleConstellation legality (clickable/completable/selected).
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { commitButton } from "../src/core/commitAction";
import { appT } from "../src/core/localization";
import type { ReachView } from "../src/core/reachability";

const model = buildModel(doc as any);
const con = [...model.constellations.values()].find((c) => c.starIds.length >= 2)!;
const starA = con.starIds[0]!;
const starB = con.starIds[1]!;

// A ReachView is just the dimming/availability summary; build minimal ones for each case.
function reachWith(clickable: string[], completable: string[]): ReachView {
  return {
    completable: new Set(completable),
    clickable: new Set(clickable),
    reachableStars: new Set<string>(),
    have: [0, 0, 0, 0, 0],
    need: [0, 0, 0, 0, 0],
    needSource: new Map(),
  };
}

test("selected star -> Remove, enabled", () => {
  const r = reachWith([], []);
  expect(commitButton(model, new Set([starA]), r, { kind: "star", id: starA })).toEqual({
    label: appT("ui.commit.remove"),
    enabled: true,
  });
});

test("unselected clickable star -> Add, enabled", () => {
  const r = reachWith([starA], []);
  expect(commitButton(model, new Set(), r, { kind: "star", id: starA })).toEqual({
    label: appT("ui.commit.add"),
    enabled: true,
  });
});

test("unselected non-clickable star -> Add, disabled", () => {
  const r = reachWith([], []);
  expect(commitButton(model, new Set(), r, { kind: "star", id: starA })).toEqual({
    label: appT("ui.commit.add"),
    enabled: false,
  });
});

test("fully selected constellation -> Remove, enabled", () => {
  const r = reachWith([], []);
  const sel = new Set(con.starIds);
  expect(commitButton(model, sel, r, { kind: "constellation", id: con.id })).toEqual({
    label: appT("ui.commit.remove"),
    enabled: true,
  });
});

test("partially selected, completable constellation -> Add, enabled", () => {
  const r = reachWith([], [con.id]);
  expect(commitButton(model, new Set([starA]), r, { kind: "constellation", id: con.id })).toEqual({
    label: appT("ui.commit.add"),
    enabled: true,
  });
});

test("unselected, non-completable constellation -> Add, disabled", () => {
  const r = reachWith([], []);
  expect(commitButton(model, new Set(), r, { kind: "constellation", id: con.id })).toEqual({
    label: appT("ui.commit.add"),
    enabled: false,
  });
  void starB;
});
