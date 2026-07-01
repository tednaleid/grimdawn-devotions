// ABOUTME: Tests the pure localization resolver: fallback chain, interpolation, singleton accessor.
// ABOUTME: No DOM or fetch; exercises makeLocalization / translate / setLocalization directly.
import { test, expect } from "bun:test";
import { makeLocalization, translate, gameText, setLocalization } from "../src/core/localization";

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

test("singleton gameText returns the tag until installed, then resolves", () => {
  expect(gameText("tagX")).toBe("tagX");
  setLocalization(makeLocalization({}, {}, "en", {}, { tagX: "Resolved" }));
  expect(gameText("tagX")).toBe("Resolved");
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
