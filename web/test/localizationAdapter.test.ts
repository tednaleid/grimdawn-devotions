// ABOUTME: Tests the localization adapter: locale detection, catalog fetch, and degrade-on-failure.
// ABOUTME: Injects a fake fetch and preferred list; never touches the network or the DOM.
import { test, expect } from "bun:test";
import { loadLocalization, SUPPORTED_LOCALES } from "../src/adapters/localizationAdapter";
import { translate } from "../src/core/localization";
import { pickLocale } from "../src/core/locale";

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
  expect(translate("ui.a")).toBe("Active"); // singleton installed
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
