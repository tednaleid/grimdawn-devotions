// ABOUTME: Tests locale selection from an ordered preference list against the shipped set.
// ABOUTME: Region stripping, order, and the English default.
import { test, expect } from "bun:test";
import { pickLocale } from "../src/core/locale";

test("picks the first preferred that is available", () => {
  expect(pickLocale(["de-DE", "en-US"], ["en", "de", "es"])).toBe("de");
});

test("strips region and matches the base language", () => {
  expect(pickLocale(["es-419"], ["en", "es"])).toBe("es");
});

test("skips unavailable preferences in order", () => {
  expect(pickLocale(["ja", "ru", "fr"], ["en", "fr"])).toBe("fr");
});

test("defaults to en when nothing matches", () => {
  expect(pickLocale(["zh"], ["en", "de"])).toBe("en");
});

test("defaults to en for an empty preference list", () => {
  expect(pickLocale([], ["en", "de"])).toBe("en");
});
