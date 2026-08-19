// ABOUTME: Pure localization resolver: active-locale -> English -> raw-key fallback, named interpolation.
// ABOUTME: Every caller threads an explicit Localization port; there is no global resolver.
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

export type FormatArg = number | [number, number] | string | Text;

// One substitution inside a brace group: %[sign][.precision]<conv><index>.
// Everything else inside the group is literal, which is what makes
// "{%.1f0 Second %s1}" and "{-%.0f0}" fall out of the same rule.
const SUBST = /%([+-]?)(?:\.(\d))?([a-z])(\d)/g;

function fmtNumber(n: number, sign: string, precision: string | undefined, conv: string): string {
  // The game formats at the template's precision, then drops a trailing ".0": a
  // {%.1f} radius of 2 reads "2 Meter", but a duration of 0.5 keeps "0.5 Second".
  const raw = conv === "d" ? String(Math.round(n)) : n.toFixed(precision ? Number(precision) : 0);
  const v = raw.replace(/\.0+$/, "");
  return sign === "+" && n >= 0 ? `+${v}` : v;
}

/** Substitute a game format template. `resolve` renders a Text argument. */
export function applyGameFormat(template: string, args: FormatArg[], resolve: (t: Text) => string): string {
  const out = template.replace(/\{([^}]*)\}/g, (_all, body: string) =>
    body.replace(SUBST, (_m, sign: string, precision: string | undefined, conv: string, idx: string) => {
      const a = args[Number(idx)];
      if (a === undefined) return "";
      if (conv === "s" || conv === "z") return typeof a === "object" && !Array.isArray(a) ? resolve(a) : String(a);
      if (conv === "t") {
        if (Array.isArray(a)) return `${fmtNumber(a[0], "", "0", "f")}-${fmtNumber(a[1], "", "0", "f")}`;
        if (typeof a === "object") return resolve(a);
        return fmtNumber(Number(a), sign, precision, "f");
      }
      // A [min, max] tuple can reach any numeric conversion, not just %t (effectText.ts's RANGE
      // branch hands one to whatever tag the stat happens to carry - see the "NaN Fragments" bug
      // this fixed: projectileFragmentsLaunchNumberMin/Max on Rune of Kalastor's Concussive Rune
      // pet renders through a %d tag). Format both halves at THIS conversion's own sign/precision
      // and join with a hyphen, so a future numeric conversion can't reintroduce the bug by
      // omitting its own array check.
      if (Array.isArray(a))
        return `${fmtNumber(a[0], sign, precision, conv)}-${fmtNumber(a[1], sign, precision, conv)}`;
      return fmtNumber(Number(a), sign, precision, conv);
    }),
  );
  // Dropping an unsupplied argument can leave doubled or edge whitespace behind.
  return out.replace(/\s{2,}/g, " ").trim();
}

// --- Text descriptors: locale-independent display text, resolved through the port ---
// Core formatting returns these instead of resolved strings, so core output can be
// cached across locale switches and never bakes in a language.
export type Text =
  | { k: "app"; key: string; params?: Record<string, string | number | Text> }
  | { k: "game"; tag: string }
  | { k: "gameStripped"; tag: string } // stripValueTokens(gameText(tag)): value-embedded format tags
  | { k: "gameFormat"; tag: string; args: FormatArg[] } // applyGameFormat(gameText(tag), args)
  | { k: "lit"; s: string }
  | { k: "join"; parts: Text[] }
  // A fragment carrying a label for a renderer that wants to decorate it (the /items/ page
  // colours the damage-type names inside a conversion line). resolveText resolves straight
  // through it, so a plain string renderer never sees the mark and no locale is affected.
  | { k: "marked"; mark: string; inner: Text };

export const appT = (key: string, params?: Record<string, string | number | Text>): Text =>
  params ? { k: "app", key, params } : { k: "app", key };
export const gameT = (tag: string): Text => ({ k: "game", tag });
export const gameStrippedT = (tag: string): Text => ({ k: "gameStripped", tag });
export const gameFormatT = (tag: string, args: FormatArg[]): Text => ({ k: "gameFormat", tag, args });
export const litT = (s: string | number): Text => ({ k: "lit", s: String(s) });
export const markedT = (mark: string, inner: Text): Text => ({ k: "marked", mark, inner });
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
    case "gameFormat":
      return applyGameFormat(loc.gameText(t.tag), t.args, (x) => resolveText(loc, x));
    case "lit":
      return t.s;
    case "join":
      return t.parts.map((p) => resolveText(loc, p)).join("");
    case "marked":
      return resolveText(loc, t.inner);
  }
}

/** Sort by resolved label in the locale's collation order (non-mutating). */
export function sortByResolved<T>(loc: Localization, items: T[], labelOf: (x: T) => Text): T[] {
  return [...items].sort((a, b) => resolveText(loc, labelOf(a)).localeCompare(resolveText(loc, labelOf(b))));
}
