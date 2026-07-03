// ABOUTME: Tests for the Text descriptor union and resolveText/sortByResolved.
// ABOUTME: Pure port-based resolution; no singleton involved.
import { expect, test } from "bun:test";
import {
  appT,
  gameT,
  gameStrippedT,
  litT,
  joinT,
  resolveText,
  sortByResolved,
  makeLocalization,
} from "../src/core/localization";

const loc = makeLocalization(
  { "ui.hello": "Hola {name}", "ui.plain": "Plano" },
  { "ui.hello": "Hello {name}", "ui.only.en": "Only English" },
  "es",
  { tagFire: "Fuego", tagFmt: "{%.0f0}% Reducido" },
  { tagFire: "Fire" },
);

test("lit resolves to itself; numbers stringify", () => {
  expect(resolveText(loc, litT("+5%"))).toBe("+5%");
  expect(resolveText(loc, litT(7))).toBe("7");
});
test("app resolves active locale, falls back to English, then raw key", () => {
  expect(resolveText(loc, appT("ui.plain"))).toBe("Plano");
  expect(resolveText(loc, appT("ui.only.en"))).toBe("Only English");
  expect(resolveText(loc, appT("ui.missing"))).toBe("ui.missing");
});
test("app params interpolate, including nested Text params", () => {
  expect(resolveText(loc, appT("ui.hello", { name: "Ted" }))).toBe("Hola Ted");
  expect(resolveText(loc, appT("ui.hello", { name: gameT("tagFire") }))).toBe("Hola Fuego");
});
test("game resolves game text with fallback", () => {
  expect(resolveText(loc, gameT("tagFire"))).toBe("Fuego");
  expect(resolveText(loc, gameT("tagMissing"))).toBe("tagMissing");
});
test("gameStripped strips value tokens", () => {
  expect(resolveText(loc, gameStrippedT("tagFmt"))).toBe("Reducido");
});
test("join concatenates parts, string sugar becomes lit", () => {
  expect(resolveText(loc, joinT(gameT("tagFire"), " ", litT("x")))).toBe("Fuego x");
});
test("sortByResolved orders by resolved label without mutating", () => {
  const items = [{ l: litT("b") }, { l: litT("a") }];
  const sorted = sortByResolved(loc, items, (x) => x.l);
  expect(sorted.map((x) => resolveText(loc, x.l))).toEqual(["a", "b"]);
  expect(resolveText(loc, items[0]!.l)).toBe("b");
});
