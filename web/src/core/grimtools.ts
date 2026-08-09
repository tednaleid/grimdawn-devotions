// ABOUTME: Pure logic for reading a grimtools build: slug parsing and inline buildInfo extraction.
// ABOUTME: Shared by the planner and the Cloudflare worker so there is one tested implementation.

/** Grimtools slug charset. Also the worker's input validation, so keep the two identical. */
const SLUG_RE = /^[A-Za-z0-9_-]{1,24}$/;

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
  const marker = html.search(/buildInfo['"]\]\s*=\s*/);
  if (marker < 0) return null;
  const start = html.indexOf("{", marker);
  if (start < 0) return null;
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
