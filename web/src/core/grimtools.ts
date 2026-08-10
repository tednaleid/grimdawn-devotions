// ABOUTME: Pure logic for reading a grimtools build: slug/buildInfo parsing, buildIsMissing for
// ABOUTME: a slug with no build, and mapStars. Shared by the planner and the Cloudflare worker.

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
 * Pull the skill ids and game version out of a calculator page.
 *
 * The whole character is server-rendered inline as `window['buildInfo'] = {...}`; there is no
 * API call and no need to run the page. Devotion stars are `sk<id>` entries mixed into
 * `data.skills` alongside mastery skills; separating them needs the mapping table (see mapStars).
 *
 * Returns null rather than throwing on any unexpected shape, so callers report a clean failure.
 */
export function extractBuildInfo(html: string): { skillIds: string[]; gameVersion: string } | null {
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
  return { skillIds, gameVersion: typeof doc.created_for_build === "string" ? doc.created_for_build : "" };
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
