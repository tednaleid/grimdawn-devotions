// ABOUTME: Tests commitButton, the pure Add/Remove label+enabled mapping for the touch popover.
// ABOUTME: Asserts it mirrors toggleStar/toggleConstellation legality (reachableStars/completable/selected).
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
function reachWith(reachable: string[], completable: string[]): ReachView {
  return {
    completable: new Set(completable),
    clickable: new Set(),
    reachableStars: new Set(reachable),
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

test("unselected reachable star -> Add, enabled", () => {
  const r = reachWith([starA], []);
  expect(commitButton(model, new Set(), r, { kind: "star", id: starA })).toEqual({
    label: appT("ui.commit.add"),
    enabled: true,
  });
});

test("unselected non-reachable star -> Add, disabled", () => {
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

test("partially selected constellation -> Remove, enabled (all-in / all-out)", () => {
  const r = reachWith([], [con.id]); // completable, but any-selected means the button clears
  expect(commitButton(model, new Set([starA]), r, { kind: "constellation", id: con.id })).toEqual({
    label: appT("ui.commit.remove"),
    enabled: true,
  });
});

test("unselected, completable constellation -> Add, enabled", () => {
  const r = reachWith([], [con.id]);
  expect(commitButton(model, new Set(), r, { kind: "constellation", id: con.id })).toEqual({
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
