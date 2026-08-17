// ABOUTME: Pure logic for reading a grimtools build: slug/buildInfo parsing, buildIsMissing for
// ABOUTME: a slug with no build, mapStars, and the export direction (invertStarTable, savePayload, spliceDevotions).

/** Grimtools slug charset. Also the worker's input validation, so keep the two identical. */
const SLUG_RE = /^[A-Za-z0-9_-]{1,24}$/;

/**
 * Version of the worker's response contract (`{ slug, skills, gameVersion, dataVersion, title }`).
 * Shared by both the app and the worker so there is exactly one definition and no chance of the
 * two drifting - see `worker/src/index.ts` and `web/src/app/main.ts`.
 *
 * Bump this when the shape changes in a way an old cached response cannot tolerate for a new
 * client (a rename or removal, not an additive field - those degrade gracefully and don't need
 * it). The app puts it in the request URL so the browser cache sees a new URL; the worker folds it
 * into its own edge-cache key so stale entries stop being served instead of expiring over 24h.
 * `web/test/worker.test.ts`'s response-shape guard test fails loudly if a field is added or
 * removed without this being bumped, so forgetting is caught by CI rather than relied on not to
 * happen.
 */
export const IMPORT_CONTRACT_VERSION = 1;

/**
 * Version of the worker's export contract (`POST /export` with `{ skills, base? }` -> `{ slug }`).
 * Export responses are never cached, so this only exists to keep the two routes symmetrical:
 * the app sends it as `?v=` and the response-shape guard in `web/test/worker.test.ts` pins the
 * field set against it. Bump on a rename or removal, not on an additive field.
 */
export const EXPORT_CONTRACT_VERSION = 2;

/** True when `s` is a grimtools slug. The worker uses it on the id grimtools returns and the
 * gateway adapter uses it again before that id becomes an href. */
export function isSlug(s: string): boolean {
  return SLUG_RE.test(s);
}

/** Hosts a calculator URL may name. An allowlist, not a substring check. */
const HOSTS = new Set(["grimtools.com", "www.grimtools.com"]);

/**
 * Accept a full calculator URL or a bare slug, returning the slug.
 *
 * Returns null for anything else, including a URL on another host: the host check is a security
 * control rather than a convenience, since the slug is handed to a fetching service.
 */
export function parseSlug(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (SLUG_RE.test(raw)) return raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!HOSTS.has(url.hostname)) return null;
  const m = url.pathname.match(/^\/calc\/([^/]+)\/?$/);
  const slug = m?.[1];
  return slug && SLUG_RE.test(slug) ? slug : null;
}

/**
 * Find the end of the JSON object starting at `start`, honouring string literals and escapes.
 *
 * The calculator page is a single line, so there is no newline to read to, and item text can
 * contain braces. Returns -1 when the object never closes.
 */
function objectEnd(s: string, start: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (c === "\\") {
      esc = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i + 1;
  }
  return -1;
}

/** Locates `window['buildInfo'] = `; shared by extractBuildInfo and buildIsMissing below. */
const BUILD_INFO_MARKER = /buildInfo['"]\]\s*=\s*/;

/** Index of the first character of buildInfo's value (right after ` = `), or -1 if absent. */
function buildInfoValueStart(html: string): number {
  const m = BUILD_INFO_MARKER.exec(html);
  return m ? m.index + m[0].length : -1;
}

/**
 * Pull the skill ids, game version and the whole `data` object out of a calculator page.
 *
 * The whole character is server-rendered inline as `window['buildInfo'] = {...}`; there is no
 * API call and no need to run the page. Devotion stars are `sk<id>` entries mixed into
 * `data.skills` alongside mastery skills; separating them needs the mapping table (see mapStars).
 *
 * Returns null rather than throwing on any unexpected shape, so callers report a clean failure.
 */
export function extractBuildInfo(html: string): { skillIds: string[]; gameVersion: string; data: unknown } | null {
  const start = buildInfoValueStart(html);
  // The value must begin with the object itself, right where the assignment ends. Anything else
  // (grimtools writes a bare `null` for a slug that is not a build - see buildIsMissing) means
  // there is nothing to extract here; scanning forward for some LATER `{` in the page would risk
  // brace-matching an unrelated inline <script> or <style> block that happens to parse as JSON.
  if (start < 0 || html[start] !== "{") return null;
  const end = objectEnd(html, start);
  if (end < 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(html.slice(start, end));
  } catch {
    return null;
  }
  const doc = parsed as { data?: { skills?: { name?: unknown }[] }; created_for_build?: unknown };
  const skills = doc.data?.skills;
  if (!Array.isArray(skills)) return null;
  const skillIds = skills.map((s) => s?.name).filter((n): n is string => typeof n === "string");
  return {
    skillIds,
    gameVersion: typeof doc.created_for_build === "string" ? doc.created_for_build : "",
    data: doc.data,
  };
}

/**
 * True when the page explicitly marks the slug as not a build: grimtools serves
 * `window['buildInfo'] = null;` with HTTP 200 for any syntactically-plausible but nonexistent
 * slug, never a real 404. Distinguishes "no such build" (this) from a page that is malformed in
 * some other way (extractBuildInfo returns null for that case too, but it is a different failure
 * and the worker reports the two differently).
 */
export function buildIsMissing(html: string): boolean {
  const start = buildInfoValueStart(html);
  return start >= 0 && /^null\b/.test(html.slice(start, start + 8));
}

const TITLE_SUFFIX = " - Grim Dawn Build Calculator";
const MAX_TITLE_LEN = 100;

/**
 * Pull the human-readable build title out of a calculator page's server-rendered `<title>`
 * element, for display only (it is never used to build a link or as an id, and `buildInfo`
 * itself carries no class/build name - see the design doc). This is the first upstream text we
 * ever put in our UI, so it is sanitized rather than trusted: any `<`/`>` is removed outright,
 * runs of whitespace collapse to one space, the result is trimmed and capped at
 * `MAX_TITLE_LEN`. Entities are deliberately left encoded - decoding them is what would
 * reintroduce markup after the `<`/`>` strip above.
 *
 * Returns null when there is no `<title>`, when sanitizing leaves nothing, or when the page
 * marks the slug as not a build (`buildIsMissing`): a missing-build page still serves a generic
 * `<title>`, and that text is not a build name.
 */
export function extractBuildTitle(html: string): string | null {
  if (buildIsMissing(html)) return null;
  const m = /<title>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return null;
  let title = m[1] ?? "";
  if (title.endsWith(TITLE_SUFFIX)) title = title.slice(0, -TITLE_SUFFIX.length);
  title = title.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_LEN);
  return title.length > 0 ? title : null;
}

/** The committed `sk<id>` to star-id table (`data/grimtools-stars.json`, `stars` field). */
export type StarTable = Record<string, string>;

/**
 * Turn a build's flat skill-id list into our star ids.
 *
 * `buildInfo.data.skills` mixes mastery skills and devotion stars in one array with no marker
 * distinguishing them, so membership in the table IS the split: the table holds only devotion
 * stars. That is also why nothing is reported as "unmapped" here. An absent id cannot be told
 * apart from a mastery skill, and the case that would matter (a star added since the table was
 * generated) is caught by the caller's data-version check instead.
 *
 * Input order is preserved and duplicates collapse.
 */
export function mapStars(skillIds: string[], table: StarTable): string[] {
  const stars: string[] = [];
  const seen = new Set<string>();
  for (const id of skillIds) {
    const star = table[id];
    if (star === undefined) continue;
    if (seen.has(star)) continue;
    seen.add(star);
    stars.push(star);
  }
  return stars;
}

/**
 * The export direction of the committed table: our star id to grimtools' `sk<id>`.
 *
 * Throws if two skill ids map to one star. The table's generation gates and
 * `web/test/grimtoolsTable.test.ts` already forbid that, so the throw is a last guard against a
 * hand-edited table producing a plausible-but-wrong export rather than a visible failure.
 */
export function invertStarTable(table: StarTable): Record<string, string> {
  const inverse: Record<string, string> = {};
  for (const [sk, star] of Object.entries(table)) {
    const prior = inverse[star];
    if (prior !== undefined) throw new Error(`grimtools table maps ${prior} and ${sk} to the same star ${star}`);
    inverse[star] = sk;
  }
  return inverse;
}

/**
 * Turn a selection into the grimtools skill ids that represent it, sorted by star id so one
 * selection always produces one request body. Returns null (never a partial list) if any star is
 * absent from `inverse`: the table covers every star, so a miss is a bug worth surfacing, not a
 * star worth dropping.
 */
export function toGrimtoolsSkills(selected: Iterable<string>, inverse: Record<string, string>): string[] | null {
  const skills: string[] = [];
  for (const star of [...selected].sort()) {
    const sk = inverse[star];
    if (sk === undefined) return null;
    skills.push(sk);
  }
  return skills;
}

/** grimtools' devotion budget; `bio.devotionPoints` counts down from it. */
export const GRIMTOOLS_DEVOTION_POINTS = 55;

/** The body `save_build.php` accepts, in the shape the calculator's own Share button posts. */
export interface SavePayload {
  bio: {
    level: number;
    attributePoints: number;
    skillPoints: number;
    devotionPoints: number;
    physique: number;
    cunning: number;
    spirit: number;
  };
  equipment: Record<string, never>;
  potions: Record<string, never>;
  skills: { name: string; level: number }[];
  itemSkills: never[];
  transformSkills: never[];
  quickbar: {
    mouse1: { left: null; right: null };
    mouse2: { left: null; right: null };
    quickbar1: never[];
    quickbar2: never[];
  };
  devotionsProgression: never[];
  skillsProgression: never[];
}

/**
 * The build grimtools' Share button would post for a fresh level-100 character holding exactly
 * these devotion stars: no masteries, gear, or quickbar, and empty progressions (grimtools stores
 * `devotionsProgression` but nothing in its UI records or renders it). The `bio` numbers are the
 * calculator's own defaults for a fresh level-100 character; grimtools stamps the game version
 * server-side, so it is not sent.
 */
export function savePayload(skills: string[]): SavePayload {
  return {
    bio: {
      level: 100,
      attributePoints: 109,
      skillPoints: 250,
      devotionPoints: GRIMTOOLS_DEVOTION_POINTS - skills.length,
      physique: 50,
      cunning: 50,
      spirit: 50,
    },
    equipment: {},
    potions: {},
    skills: skills.map((name) => ({ name, level: 1 })),
    itemSkills: [],
    transformSkills: [],
    quickbar: {
      mouse1: { left: null, right: null },
      mouse2: { left: null, right: null },
      quickbar1: [],
      quickbar2: [],
    },
    devotionsProgression: [],
    skillsProgression: [],
  };
}

/** A `data.skills` entry as far as the splice needs to read it; every other field rides along. */
type SkillEntry = { name: string; level: number; autoCastSkill?: unknown } & Record<string, unknown>;

function isSkillEntry(v: unknown): v is SkillEntry {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { name?: unknown }).name === "string" &&
    typeof (v as { level?: unknown }).level === "number"
  );
}

/** The `autoCastSkill` of a bound entry (`itemSkills[]`, `transformSkills[]`), or undefined. */
function autoCastOf(v: unknown): unknown {
  return typeof v === "object" && v !== null ? (v as { autoCastSkill?: unknown }).autoCastSkill : undefined;
}

/**
 * A copy of a build's `data` with its devotions replaced: the `skills` entries named in `remove`
 * are dropped, each of `stars` not already present is appended at level 1, `bio.devotionPoints`
 * moves by the count actually removed and added (floored at 0), and every celestial-power binding
 * whose star is removed and not requested again goes with it: the `autoCastSkill` field comes off
 * the mastery skill's `skills[]` entry, and the `itemSkills[]`/`transformSkills[]` entries are
 * dropped outright, since grimtools serializes those two arrays from bindings alone. Bindings to
 * stars that stay are untouched, and every other field of `data` and of every entry is passed
 * through as grimtools wrote it.
 *
 * The worker cannot tell a star from a mastery skill; `remove` is the caller's statement of which
 * of the base's ids are stars. Returns null unless `data` has a `skills` array of `{ name, level }`
 * entries and a numeric `bio.devotionPoints` (`itemSkills`/`transformSkills` may be absent), so a
 * page we do not understand is a clean failure rather than a corrupted save.
 */
export function spliceDevotions(
  data: unknown,
  remove: readonly string[],
  stars: readonly string[],
): Record<string, unknown> | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const doc = data as Record<string, unknown>;
  const skills = doc.skills;
  if (!Array.isArray(skills) || !skills.every(isSkillEntry)) return null;
  const bio = doc.bio;
  if (typeof bio !== "object" || bio === null || Array.isArray(bio)) return null;
  const devotionPoints = (bio as { devotionPoints?: unknown }).devotionPoints;
  if (typeof devotionPoints !== "number") return null;
  const bound: Record<string, unknown> = {};
  for (const key of ["itemSkills", "transformSkills"]) {
    if (doc[key] === undefined) continue;
    if (!Array.isArray(doc[key])) return null;
    bound[key] = doc[key];
  }

  const removeSet = new Set(remove);
  const wanted = new Set(stars);
  const stale = (id: unknown) => typeof id === "string" && removeSet.has(id) && !wanted.has(id);

  const kept = skills.filter((s) => !removeSet.has(s.name));
  const present = new Set(kept.map((s) => s.name));
  const added = stars.filter((s) => !present.has(s));
  const out: Record<string, unknown> = {
    ...doc,
    bio: { ...bio, devotionPoints: Math.max(0, devotionPoints + (skills.length - kept.length) - added.length) },
    skills: [
      ...kept.map((s) => {
        if (!stale(s.autoCastSkill)) return s;
        const { autoCastSkill: _dropped, ...rest } = s;
        return rest;
      }),
      ...added.map((name) => ({ name, level: 1 })),
    ],
  };
  for (const [key, list] of Object.entries(bound)) out[key] = (list as unknown[]).filter((e) => !stale(autoCastOf(e)));
  return out;
}
