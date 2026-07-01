// ABOUTME: Tests the pure localization resolver: fallback chain, interpolation, singleton accessor.
// ABOUTME: No DOM or fetch; exercises makeLocalization / translate / setLocalization directly.
import { test, expect } from "bun:test";
import { makeLocalization, translate, setLocalization } from "../src/core/localization";

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

test("singleton translate returns the key until installed, then resolves", () => {
  expect(translate("ui.a")).toBe("ui.a");
  setLocalization(makeLocalization({}, { "ui.a": "Active" }, "en"));
  expect(translate("ui.a")).toBe("Active");
});
