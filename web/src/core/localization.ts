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
