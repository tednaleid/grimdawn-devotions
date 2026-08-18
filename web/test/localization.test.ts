// ABOUTME: Tests the pure localization resolver: fallback chain, interpolation.
// ABOUTME: No DOM or fetch; exercises makeLocalization directly.
import { test, expect, describe } from "bun:test";
import { applyGameFormat, gameFormatT, makeLocalization, resolveText } from "../src/core/localization";

test("prefers the active-locale value", () => {
  const loc = makeLocalization({ "ui.a": "Activo" }, { "ui.a": "Active" }, "es");
  expect(loc.translate("ui.a")).toBe("Activo");
});

test("falls back to English when the active locale lacks the key", () => {
  const loc = makeLocalization({}, { "ui.a": "Active" }, "es");
  expect(loc.translate("ui.a")).toBe("Active");
});

test("falls back to the raw key when neither catalog has it", () => {
  const loc = makeLocalization({}, {}, "es");
  expect(loc.translate("ui.missing")).toBe("ui.missing");
});

test("interpolates named params", () => {
  const loc = makeLocalization({}, { "p.used": "{count} used" }, "en");
  expect(loc.translate("p.used", { count: 3 })).toBe("3 used");
});

test("leaves an unmatched placeholder in place", () => {
  const loc = makeLocalization({}, { "p.x": "{a} and {b}" }, "en");
  expect(loc.translate("p.x", { a: "1" })).toBe("1 and {b}");
});

test("gameText prefers the active game map", () => {
  const loc = makeLocalization({}, {}, "es", { "tag.a": "Activo" }, { "tag.a": "Active" });
  expect(loc.gameText("tag.a")).toBe("Activo");
});

test("gameText falls back to the English game map", () => {
  const loc = makeLocalization({}, {}, "es", {}, { "tag.a": "Active" });
  expect(loc.gameText("tag.a")).toBe("Active");
});

test("gameText falls back to the raw tag when neither game map has it", () => {
  const loc = makeLocalization({}, {}, "es");
  expect(loc.gameText("tag.missing")).toBe("tag.missing");
});

test("translate treats an empty active value as absent and falls back to English", () => {
  const loc = makeLocalization({ "ui.x": "" }, { "ui.x": "Hello" }, "es");
  expect(loc.translate("ui.x")).toBe("Hello");
});

test("translate falls back to the raw key when active and English are both empty", () => {
  const loc = makeLocalization({ "ui.x": "" }, { "ui.x": "" }, "es");
  expect(loc.translate("ui.x")).toBe("ui.x");
});

test("translate still prefers a non-empty active value over English (regression guard)", () => {
  const loc = makeLocalization({ "ui.x": "Hola" }, { "ui.x": "Hello" }, "es");
  expect(loc.translate("ui.x")).toBe("Hola");
});

test("gameText treats an empty active value as absent and falls back to English", () => {
  const loc = makeLocalization({}, {}, "es", { tagX: "" }, { tagX: "Ge" });
  expect(loc.gameText("tagX")).toBe("Ge");
});

test("gameText falls back to the raw tag when active and English are both empty", () => {
  const loc = makeLocalization({}, {}, "es", { tagX: "" }, { tagX: "" });
  expect(loc.gameText("tagX")).toBe("tagX");
});

test("gameText still prefers a non-empty active value over English (regression guard)", () => {
  const loc = makeLocalization({}, {}, "es", { tagX: "Activo" }, { tagX: "Active" });
  expect(loc.gameText("tagX")).toBe("Activo");
});

// makeLocalization(active, fallback, locale, gameActive, gameFallback)
const loc = makeLocalization({}, {}, "en", {}, {});

describe("applyGameFormat", () => {
  const r = (t: any) => resolveText(loc, t);
  test("fixed point keeps a real decimal", () => {
    expect(applyGameFormat("{%.1f0} Second Duration", [0.5], r)).toBe("0.5 Second Duration");
  });
  test("fixed point strips a trailing .0, as the game does", () => {
    // Pinned to three grimtools cards rendered from {%.1f} templates: Mark of the
    // Shadow Queen "2 Meter Target Area" (2.0), Badge of the Crimson Company
    // "1 Second" (1.0), Mark of Lethal Intents "0.5 Second Duration" (0.5).
    expect(applyGameFormat("{%.1f0} Seconds", [2], r)).toBe("2 Seconds");
  });
  test("forced sign only on non-negative", () => {
    expect(applyGameFormat("{%+.0f0}% Attack Speed", [5], r)).toBe("+5% Attack Speed");
    expect(applyGameFormat("{%+.0f0}% Attack Speed", [-5], r)).toBe("-5% Attack Speed");
  });
  test("integer conversion rounds", () => {
    expect(applyGameFormat("{%d0}% Chance to be Used", [24.6], r)).toBe("25% Chance to be Used");
  });
  test("literal text and two args inside one group", () => {
    expect(applyGameFormat("{%.1f0 Second %s1}", [3, "Skill Recharge"], r)).toBe("3 Second Skill Recharge");
  });
  test("a literal minus inside the group is printed", () => {
    expect(applyGameFormat("{-%.0f0}% Shield Recovery Time", [20], r)).toBe("-20% Shield Recovery Time");
  });
  test("a literal percent inside the group is printed", () => {
    expect(applyGameFormat("{%.0f0%} Weapon Damage", [180], r)).toBe("180% Weapon Damage");
  });
  test("t renders a number pair as a range", () => {
    expect(applyGameFormat("{%t0} Fire Damage", [[120, 180]], r)).toBe("120-180 Fire Damage");
  });
  test("t renders a lone number plainly", () => {
    expect(applyGameFormat("{%t0} Fire Damage", [200], r)).toBe("200 Fire Damage");
  });
  test("a range through a %d template renders as a hyphenated pair, not NaN", () => {
    // Regression: projectileFragmentsLaunchNumberMin/Max on Rune of Kalastor's Concussive
    // Rune pet reaches DamageTaunt-style %d templates via effectText.ts's RANGE branch, which
    // hands a [min, max] tuple to whatever conversion the tag uses, not just %t.
    expect(applyGameFormat("{%d0} Fragments", [[2, 3]], r)).toBe("2-3 Fragments");
  });
  test("an unsupplied argument leaves no token behind", () => {
    expect(applyGameFormat("{%t0} to reduce cooldown by {%.1f1} {%z2}", [], r)).toBe("to reduce cooldown by");
  });
});

describe("gameFormatT through resolveText", () => {
  test("round-trips: tag looks up the template, args substitute into it", () => {
    const tagLoc = makeLocalization({}, {}, "en", {}, { tag: "{%.1f0} Seconds" });
    expect(resolveText(tagLoc, gameFormatT("tag", [2]))).toBe("2 Seconds");
  });

  test("t recurses into a nested Text argument (real case: tagSkillCooldownRefreshName)", () => {
    const condLoc = makeLocalization({}, {}, "en", {}, { "cond.chance": "{%d0}% Chance" });
    const inner = gameFormatT("cond.chance", [25]);
    const out = applyGameFormat(
      "{%t0} to reduce cooldown of {%s1} by {%.1f2} {%z3}",
      [inner, "Skill Recharge", 1, "Seconds"],
      (t) => resolveText(condLoc, t),
    );
    expect(out).toBe("25% Chance to reduce cooldown of Skill Recharge by 1 Seconds");
  });

  test("s recurses into a nested Text argument", () => {
    const condLoc = makeLocalization({}, {}, "en", {}, { "cond.tag": "Bleeding" });
    const inner = gameFormatT("cond.tag", []);
    expect(applyGameFormat("{%s0} inflicted", [inner], (t) => resolveText(condLoc, t))).toBe("Bleeding inflicted");
  });
});
