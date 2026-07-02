// ABOUTME: Tests the localization adapter: locale detection, catalog fetch, and degrade-on-failure.
// ABOUTME: Injects a fake fetch and preferred list; never touches the network or the DOM.
import { test, expect } from "bun:test";
import { loadLocalization, SUPPORTED_LOCALES, storedLocale, storeLocale } from "../src/adapters/localizationAdapter";
import { pickLocale } from "../src/core/locale";

function fakeStorage(init: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  } as unknown as Storage;
}

function fakeFetch(map: Record<string, unknown>): typeof fetch {
  return (async (url: string) => {
    const key = Object.keys(map).find((k) => String(url).includes(k));
    if (key === undefined) return { ok: false, json: async () => ({}) } as Response;
    return { ok: true, json: async () => map[key] } as Response;
  }) as unknown as typeof fetch;
}

test("loads English and resolves a key", async () => {
  const loc = await loadLocalization({
    available: ["en"],
    preferred: ["en"],
    fetchImpl: fakeFetch({
      "app.en.json": { "ui.a": "Active" },
      "game.en.json": { "tag.a": "Twin Fangs" },
    }),
  });
  expect(loc.locale).toBe("en");
  expect(loc.translate("ui.a")).toBe("Active");
  expect(loc.gameText("tag.a")).toBe("Twin Fangs");
});

test("degrades to English fallback when the active-locale file is missing", async () => {
  const loc = await loadLocalization({
    available: ["en", "de"],
    preferred: ["de"],
    fetchImpl: fakeFetch({ "app.en.json": { "ui.a": "Active" } }), // no app.de.json
  });
  expect(loc.locale).toBe("de");
  expect(loc.translate("ui.a")).toBe("Active");
});

test("detects a shipped non-English locale from the default supported set", async () => {
  const loc = await loadLocalization({
    preferred: ["de-DE", "en"],
    fetchImpl: fakeFetch({
      "app.en.json": { "ui.a": "Active" },
      "app.de.json": { "ui.a": "Aktiv" },
      "game.en.json": { "tag.a": "Twin Fangs" },
      "game.de.json": { "tag.a": "Zwillingsreisszaehne" },
    }),
  });
  expect(loc.locale).toBe("de");
  expect(loc.translate("ui.a")).toBe("Aktiv");
  expect(loc.gameText("tag.a")).toBe("Zwillingsreisszaehne");
});

test("pickLocale resolves a shipped locale against the default supported set", () => {
  expect(pickLocale(["de-DE", "en"], SUPPORTED_LOCALES)).toBe("de");
});

test("storeLocale + storedLocale round-trips a supported override", () => {
  const s = fakeStorage();
  storeLocale("de", s);
  expect(storedLocale(SUPPORTED_LOCALES, s)).toBe("de");
});

test("storedLocale ignores an unsupported or unset override", () => {
  expect(storedLocale(SUPPORTED_LOCALES, fakeStorage({ locale: "xx" }))).toBeNull();
  expect(storedLocale(SUPPORTED_LOCALES, fakeStorage())).toBeNull();
});

test("storage helpers no-op when storage is absent", () => {
  expect(storedLocale(SUPPORTED_LOCALES, null)).toBeNull();
  expect(() => storeLocale("de", null)).not.toThrow();
});
