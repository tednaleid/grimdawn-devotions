// ABOUTME: Tests the language picker's pure pieces: option list (endonyms + current flag) and menu HTML.
// ABOUTME: The DOM mount is thin glue verified in the browser; these cover the logic that decides content.
import { test, expect } from "bun:test";
import { languageOptions, languageMenuHtml } from "../src/adapters/languagePicker";
import { LOCALE_NAMES, SUPPORTED_LOCALES } from "../src/adapters/localizationAdapter";

test("languageOptions lists each available locale in order, marking the current one", () => {
  const opts = languageOptions("de", ["en", "de", "fr"], { en: "English", de: "Deutsch", fr: "Français" });
  expect(opts).toEqual([
    { locale: "en", name: "English", current: false },
    { locale: "de", name: "Deutsch", current: true },
    { locale: "fr", name: "Français", current: false },
  ]);
});

test("languageOptions falls back to the locale code when no endonym is known", () => {
  expect(languageOptions("en", ["en", "xx"], { en: "English" })).toEqual([
    { locale: "en", name: "English", current: true },
    { locale: "xx", name: "xx", current: false },
  ]);
});

test("languageMenuHtml renders one item per option with data-locale and the checked state", () => {
  const html = languageMenuHtml([
    { locale: "en", name: "English", current: false },
    { locale: "de", name: "Deutsch", current: true },
  ]);
  expect(html).toContain('data-locale="en"');
  expect(html).toContain('data-locale="de"');
  expect(html).toContain("English");
  expect(html).toContain("Deutsch");
  // Exactly the current option is aria-checked=true.
  expect(html.match(/aria-checked="true"/g)?.length).toBe(1);
  expect(html).toMatch(/data-locale="de"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-locale="de"/);
});

test("every shipped locale has an endonym name", () => {
  for (const l of SUPPORTED_LOCALES) expect(typeof LOCALE_NAMES[l]).toBe("string");
});
