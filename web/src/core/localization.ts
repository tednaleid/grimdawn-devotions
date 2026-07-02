// ABOUTME: Pure localization resolver: active-locale -> English -> raw-key fallback, named interpolation.
// ABOUTME: Also holds a module singleton so view modules can call translate() without threading a port.
import type { Localization } from "../ports/Localization";

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole));
}

// An empty string is treated as "not authored" so an untranslated catalog entry
// falls back to English instead of rendering blank.
function pick(active: string | undefined, fallback: string | undefined, last: string): string {
  if (active !== undefined && active !== "") return active;
  if (fallback !== undefined && fallback !== "") return fallback;
  return last;
}

export function makeLocalization(
  active: Record<string, string>,
  fallback: Record<string, string>,
  locale: string,
  gameActive: Record<string, string> = {},
  gameFallback: Record<string, string> = {},
): Localization {
  return {
    locale,
    translate(key, params) {
      const template = pick(active[key], fallback[key], key);
      return interpolate(template, params);
    },
    gameText(tag) {
      return pick(gameActive[tag], gameFallback[tag], tag);
    },
  };
}

// Strip Grim Dawn value placeholders ("{%.0f0}%", ranges "{%.0f0}-{%.0f1}%") and the leading/trailing
// "%"/dash/space they leave behind, so a value-embedded stat format tag reduces to its bare noun. A
// no-op on the plain-noun tags in STAT_TAGS. Used only for value-PREFIX stats (value leads the noun in
// every language); value-suffix stats are app-authored instead.
export function stripValueTokens(s: string): string {
  return s
    .replace(/\{%[^}]*\}/g, "")
    .replace(/^[\s%-]+|[\s%-]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// --- Text descriptors: locale-independent display text, resolved through the port ---
// Core formatting returns these instead of resolved strings, so core output can be
// cached across locale switches and never bakes in a language.
export type Text =
  | { k: "app"; key: string; params?: Record<string, string | number | Text> }
  | { k: "game"; tag: string }
  | { k: "gameStripped"; tag: string } // stripValueTokens(gameText(tag)): value-embedded format tags
  | { k: "lit"; s: string }
  | { k: "join"; parts: Text[] };

export const appT = (key: string, params?: Record<string, string | number | Text>): Text =>
  params ? { k: "app", key, params } : { k: "app", key };
export const gameT = (tag: string): Text => ({ k: "game", tag });
export const gameStrippedT = (tag: string): Text => ({ k: "gameStripped", tag });
export const litT = (s: string | number): Text => ({ k: "lit", s: String(s) });
export const joinT = (...parts: (Text | string)[]): Text => ({
  k: "join",
  parts: parts.map((p) => (typeof p === "string" ? litT(p) : p)),
});

export function resolveText(loc: Localization, t: Text): string {
  switch (t.k) {
    case "app": {
      if (!t.params) return loc.translate(t.key);
      const params: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(t.params)) params[k] = typeof v === "object" ? resolveText(loc, v) : v;
      return loc.translate(t.key, params);
    }
    case "game":
      return loc.gameText(t.tag);
    case "gameStripped":
      return stripValueTokens(loc.gameText(t.tag));
    case "lit":
      return t.s;
    case "join":
      return t.parts.map((p) => resolveText(loc, p)).join("");
  }
}

/** Sort by resolved label in the locale's collation order (non-mutating). */
export function sortByResolved<T>(loc: Localization, items: T[], labelOf: (x: T) => Text): T[] {
  return [...items].sort((a, b) => resolveText(loc, labelOf(a)).localeCompare(resolveText(loc, labelOf(b))));
}

// TEMPORARY migration shim: resolve via the module singleton so unconverted adapters keep
// working while core converts underneath them. Deleted with the singleton (see the
// i18n-hexagonal-boundary spec); nothing new may call this.
const RAW_LOC: Localization = makeLocalization({}, {}, "en");
export function resolveTextGlobal(t: Text): string {
  return resolveText(current ?? RAW_LOC, t);
}

let current: Localization | null = null;
export function setLocalization(loc: Localization): void {
  current = loc;
}
export function translate(key: string, params?: Record<string, string | number>): string {
  return current ? current.translate(key, params) : key;
}
export function gameText(tag: string): string {
  return current ? current.gameText(tag) : tag;
}
