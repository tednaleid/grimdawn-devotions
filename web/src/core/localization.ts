// ABOUTME: Pure localization resolver: active-locale -> English -> raw-key fallback, named interpolation.
// ABOUTME: Also holds a module singleton so view modules can call translate() without threading a port.
import type { Localization } from "../ports/Localization";

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole));
}

export function makeLocalization(
  active: Record<string, string>,
  fallback: Record<string, string>,
  locale: string,
): Localization {
  return {
    locale,
    translate(key, params) {
      const template = active[key] ?? fallback[key] ?? key;
      return interpolate(template, params);
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
