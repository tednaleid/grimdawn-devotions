// ABOUTME: Loads app.<locale>.json catalogs, detects the locale, and builds the resolver instance.
// ABOUTME: Degrades to English then raw keys if a catalog is missing; the UI never blocks on i18n.
import { makeLocalization } from "../core/localization";
import { pickLocale } from "../core/locale";
import type { Localization } from "../ports/Localization";

// The 13 locales shipped (game + app catalogs both exist for each).
export const SUPPORTED_LOCALES: readonly string[] = [
  "en",
  "de",
  "fr",
  "es",
  "ru",
  "zh",
  "pl",
  "it",
  "cs",
  "ja",
  "ko",
  "pt",
  "vi",
];

// Endonyms: each locale's name in its own language, so a viewer recognizes their own. These are the
// same in every UI language (like the locale codes), so they are a code constant, not a translate() key.
export const LOCALE_NAMES: Record<string, string> = {
  en: "English",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
  ru: "Русский",
  zh: "中文",
  pl: "Polski",
  it: "Italiano",
  cs: "Čeština",
  ja: "日本語",
  ko: "한국어",
  pt: "Português",
  vi: "Tiếng Việt",
};

const LOCALE_STORAGE_KEY = "locale";

function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  return typeof localStorage !== "undefined" ? localStorage : null;
}

// The viewer's explicit locale override, or null to keep browser auto-detection. Only a supported
// locale is honored; anything else (stale/hand-edited value, storage disabled) falls back to detection.
export function storedLocale(available: readonly string[], storage?: Storage | null): string | null {
  const s = resolveStorage(storage);
  if (!s) return null;
  try {
    const v = s.getItem(LOCALE_STORAGE_KEY);
    return v && available.includes(v) ? v : null;
  } catch {
    return null;
  }
}

export function storeLocale(locale: string, storage?: Storage | null): void {
  const s = resolveStorage(storage);
  if (!s) return;
  try {
    s.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {}
}

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
  const available = opts.available ?? SUPPORTED_LOCALES;
  const preferred = opts.preferred ?? (typeof navigator !== "undefined" ? navigator.languages : ["en"]);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const locale = pickLocale(preferred, available);
  const fallback = await getJson(fetchImpl, `${base}/i18n/app.en.json`);
  const active = locale === "en" ? fallback : await getJson(fetchImpl, `${base}/i18n/app.${locale}.json`);
  const gameFallback = await getJson(fetchImpl, `${base}/data/i18n/game.en.json`);
  const gameActive = locale === "en" ? gameFallback : await getJson(fetchImpl, `${base}/data/i18n/game.${locale}.json`);
  return makeLocalization(active, fallback, locale, gameActive, gameFallback);
}
