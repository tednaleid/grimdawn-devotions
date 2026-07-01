// ABOUTME: Loads app.<locale>.json catalogs, detects the locale, and installs the resolver singleton.
// ABOUTME: Degrades to English then raw keys if a catalog is missing; the UI never blocks on i18n.
import { makeLocalization, setLocalization } from "../core/localization";
import { pickLocale } from "../core/locale";
import type { Localization } from "../ports/Localization";

async function getJson(fetchImpl: typeof fetch, url: string): Promise<Record<string, string>> {
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return {};
    return (await res.json()) as Record<string, string>;
  } catch {
    return {};
  }
}

export async function loadLocalization(
  opts: { base?: string; available?: readonly string[]; preferred?: readonly string[]; fetchImpl?: typeof fetch } = {},
): Promise<Localization> {
  const base = opts.base ?? ".";
  const available = opts.available ?? ["en"];
  const preferred = opts.preferred ?? (typeof navigator !== "undefined" ? navigator.languages : ["en"]);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const locale = pickLocale(preferred, available);
  const fallback = await getJson(fetchImpl, `${base}/i18n/app.en.json`);
  const active = locale === "en" ? fallback : await getJson(fetchImpl, `${base}/i18n/app.${locale}.json`);
  const gameFallback = await getJson(fetchImpl, `${base}/data/i18n/game.en.json`);
  const gameActive = locale === "en" ? gameFallback : await getJson(fetchImpl, `${base}/data/i18n/game.${locale}.json`);
  const loc = makeLocalization(active, fallback, locale, gameActive, gameFallback);
  setLocalization(loc);
  return loc;
}
