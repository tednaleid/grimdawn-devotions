// ABOUTME: Cloudflare Worker between the planner and grimtools: reads a build's devotion star ids by
// ABOUTME: slug (GET /) and saves a selection as a fresh build or a copy of a base build (POST /export). Never fetches a caller-named host.
/// <reference path="./worker-env.d.ts" />
import {
  extractBuildInfo,
  extractBuildTitle,
  buildIsMissing,
  IMPORT_CONTRACT_VERSION,
  GRIMTOOLS_DEVOTION_POINTS,
  savePayload,
  spliceDevotions,
  isSlug,
} from "../../web/src/core/grimtools";

const CALC = "https://www.grimtools.com/calc/";
const DEVOTION_JSON = "https://www.grimtools.com/static/gdx3/devotion/devotion.json";
const UA = "grimdawn-devotions-import/1.0 (+https://github.com/tednaleid/grimdawn-devotions)";
const MAX_BYTES = 2_000_000; // a calc page is ~40KB; this only bounds a hostile upstream
const TIMEOUT_MS = 10_000;
const SAVE_URL = "https://www.grimtools.com/save_build.php";
const MAX_EXPORT_BODY = 4096; // 55 ids at ~10 bytes each is well under 1 KB; this bounds a hostile body
const MAX_EXPORT_SKILLS = GRIMTOOLS_DEVOTION_POINTS; // the game's devotion budget
const MAX_BASE_REMOVE = 128; // a base's star entries (normally at most 55); loose so an odd hand-built page is not refused misleadingly
const SKILL_ID_RE = /^sk\d+$/;

/** The surface of a Workers rate-limit binding (`[[ratelimits]]` in wrangler.toml); tests pass a fake. */
export interface RateLimiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  ALLOWED_ORIGIN: string;
  /** Export brakes: per client address and for everyone together. Absent means unlimited (tests, or
   * a runtime without the bindings); the two are separate bindings because a binding carries one
   * limit configuration. */
  EXPORT_LIMITER_IP?: RateLimiter;
  EXPORT_LIMITER_GLOBAL?: RateLimiter;
  /** Injected in tests only; production uses global fetch. */
  fetchImpl?: typeof fetch;
}

/** Extracts and validates the `slug` query param. Null when absent or outside the slug charset
 * (`isSlug`), which is also what the caching wrapper uses to decide whether a request is cacheable
 * at all. */
function validSlug(request: Request): string | null {
  const slug = new URL(request.url).searchParams.get("slug") ?? "";
  return isSlug(slug) ? slug : null;
}

function json(body: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin,
      // Only the import route's 200 is a build that will never change, so only that is storable;
      // every export response (201 included) is a write and stays no-store. An explicit max-age on
      // an error status (per RFC 9111) would let a transient 502 get pinned into a caller's cache
      // for a day with no way to retry.
      "Cache-Control": status === 200 ? "public, max-age=86400" : "no-store",
    },
  });
}

/** Read at most `max` bytes of `body` as text, decoding incrementally (`{ stream: true }`) so a
 * multi-byte character split across a chunk boundary decodes correctly. `overflowed` is true once
 * the stream runs past `max`, at which point reading stops and `text` holds only what was read up
 * to (not including) the chunk that tipped it over - never the full body in that case. Shared by
 * `boundedText` and `boundedBody`, whose only difference is what an overflow means for their caller. */
async function readBounded(
  body: ReadableStream<Uint8Array> | null,
  max: number,
): Promise<{ text: string; overflowed: boolean }> {
  const reader = body?.getReader();
  if (!reader) return { text: "", overflowed: false };
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      text += decoder.decode(); // flush any trailing partial multi-byte char
      return { text, overflowed: false };
    }
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return { text, overflowed: true };
    }
    text += decoder.decode(value, { stream: true });
  }
}

/** Read at most MAX_BYTES of a response as text, so an oversized upstream cannot exhaust CPU. On
 * overflow, returns whatever partial text was read rather than the whole body. */
async function boundedText(res: Response): Promise<string> {
  return (await readBounded(res.body, MAX_BYTES)).text;
}

/** Read at most `max` bytes of a request body as text; null when it runs over, so an oversized body
 * is never fully buffered or parsed. */
async function boundedBody(req: Request, max: number): Promise<string | null> {
  const { text, overflowed } = await readBounded(req.body, max);
  return overflowed ? null : text;
}

/** `min`..`max` distinct `sk<digits>` strings, or null. */
function skillIdList(v: unknown, min: number, max: number): string[] | null {
  if (!Array.isArray(v) || v.length < min || v.length > max) return null;
  if (!v.every((s) => typeof s === "string" && SKILL_ID_RE.test(s))) return null;
  if (new Set(v).size !== v.length) return null;
  return v as string[];
}

/** The parsed export body. `base` names the build to copy and which of its skill ids are the
 * devotion stars to replace; absent means a fresh devotions-only build. */
interface ExportBody {
  skills: string[];
  base?: { slug: string; remove: string[] };
}

/** The export body: 1..MAX_EXPORT_SKILLS distinct `sk<digits>` strings under `skills`, plus an
 * optional `base` of `{ slug, remove }` where `remove` is 0..MAX_BASE_REMOVE distinct ids; other
 * top-level keys are ignored. The worker cannot tell a devotion star from a mastery skill (same as
 * import); this bound plus the rate limit is the protection. */
function parseExportBody(text: string): ExportBody | null {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return null;
  const { skills: rawSkills, base } = doc as { skills?: unknown; base?: unknown };
  const skills = skillIdList(rawSkills, 1, MAX_EXPORT_SKILLS);
  if (!skills) return null;
  if (base === undefined) return { skills };
  if (typeof base !== "object" || base === null || Array.isArray(base)) return null;
  const { slug, remove } = base as { slug?: unknown; remove?: unknown };
  if (typeof slug !== "string" || !isSlug(slug)) return null;
  const removeIds = skillIdList(remove, 0, MAX_BASE_REMOVE);
  if (!removeIds) return null;
  return { skills, base: { slug, remove: removeIds } };
}

async function allowed(limiter: RateLimiter | undefined, key: string): Promise<boolean> {
  if (!limiter) return true;
  return (await limiter.limit({ key })).success;
}

/**
 * Save a devotion selection as a new anonymous grimtools build and return its slug: either a fresh
 * character holding only the stars, or a copy of a base build with its stars replaced. One POST to
 * a constant URL, in the exact shape the calculator's own Share button sends (see savePayload and
 * spliceDevotions); the only caller-controlled bytes are the validated skill ids and, with a base,
 * the slug of the page read back from grimtools.
 */
async function handleExport(request: Request, env: Env): Promise<Response> {
  const origin = env.ALLOWED_ORIGIN;
  const doFetch = env.fetchImpl ?? fetch;
  // Browsers set Origin and cannot forge it; for anything else this is friction, not security, and
  // it keeps the CORS response identical to the import route's.
  if (request.headers.get("Origin") !== origin) return json({ error: "forbidden" }, 403, origin);
  const text = await boundedBody(request, MAX_EXPORT_BODY);
  const body = text === null ? null : parseExportBody(text);
  if (!body) return json({ error: "bad_request" }, 400, origin);
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (!(await allowed(env.EXPORT_LIMITER_IP, `ip:${ip}`)) || !(await allowed(env.EXPORT_LIMITER_GLOBAL, "global")))
    return json({ error: "rate_limited" }, 429, origin);

  // With a base, the saved character is grimtools' own data read back from grimtools with only the
  // devotions replaced; without one it is the bare level-100 character. Either way the caller's
  // bytes in it are validated ids.
  let data: unknown;
  if (body.base) {
    const page = await readCalcPage(body.base.slug, doFetch, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "manual",
    });
    // The planner confirmed the base moments before, so a missing base here is a race, not a user
    // state worth its own code: it reports as the upstream failure it is.
    if (page.kind === "notFound" || page.kind === "missing" || page.kind === "upstream")
      return json({ error: "upstream" }, 502, origin);
    if (page.kind === "unparseable") return json({ error: "unparseable" }, 502, origin);
    data = spliceDevotions(page.info.data, body.base.remove, body.skills);
    if (data === null) return json({ error: "unparseable" }, 502, origin);
  } else {
    data = savePayload(body.skills);
  }

  const form = new URLSearchParams({ data: JSON.stringify(data), mod: "" });
  let res: Response;
  try {
    res = await doFetch(SAVE_URL, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Referer: CALC,
      },
      body: form.toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "manual", // a redirect (status 3xx, not ok) is an upstream failure, never followed
    });
  } catch {
    return json({ error: "upstream" }, 502, origin);
  }
  if (!res.ok) return json({ error: "upstream", status: res.status }, 502, origin);
  // Re-validate rather than trust: the only upstream byte sequence that ever leaves here is an id
  // in our own slug charset.
  let id: unknown;
  try {
    id = (JSON.parse(await boundedText(res)) as { id?: unknown } | null)?.id;
  } catch {
    return json({ error: "unparseable" }, 502, origin);
  }
  if (typeof id !== "string" || !isSlug(id)) return json({ error: "unparseable" }, 502, origin);
  return json({ slug: id }, 201, origin);
}

/** The three ways reading a calc page can resolve: a real build, an explicit `null` (no such
 * slug - grimtools returns HTTP 200 for these, never a 404), or a page that is malformed in some
 * other way. Kept distinct so the caller can tell "no such build" from "could not understand the
 * response", which are different failures worth reporting differently to the user. */
type BuildInfoResult =
  | { kind: "found"; info: NonNullable<ReturnType<typeof extractBuildInfo>>; title: string | null }
  | { kind: "missing" }
  | { kind: "unparseable" };

/**
 * Read a response body incrementally, stopping the moment a complete `buildInfo` object is found
 * or the page marks itself as not a build, so a hostile or oversized upstream cannot force a
 * full-body brace-matching scan on the whole MAX_BYTES cap. MAX_BYTES is the backstop for the case
 * where `buildInfo` never resolves either way. Uses `{ stream: true }` so a multi-byte character
 * split across a chunk boundary decodes correctly rather than as a replacement character.
 */
async function readBuildInfo(res: Response): Promise<BuildInfoResult> {
  const reader = res.body?.getReader();
  if (!reader) return { kind: "unparseable" };
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      break;
    }
    text += decoder.decode(value, { stream: true });
    const info = extractBuildInfo(text);
    if (info) {
      await reader.cancel();
      // <title> sits in <head>, ahead of the <body> script that carries buildInfo, so it is
      // already present in `text` by the time buildInfo resolves - no extra read needed.
      return { kind: "found", info, title: extractBuildTitle(text) };
    }
    if (buildIsMissing(text)) {
      await reader.cancel();
      return { kind: "missing" };
    }
  }
  return { kind: "unparseable" };
}

/** How reading `CALC + slug` ends, for both routes: the page's own verdict (`readBuildInfo`), a
 * real HTTP 404 (grimtools serves one only for a request shape it does not recognize at all; an
 * unknown-but-plausible slug is a 200 with `buildInfo = null`, which is `missing`), or an upstream
 * failure: a non-ok status, a refused redirect, a network error or the timeout. */
type CalcPageResult = BuildInfoResult | { kind: "notFound" } | { kind: "upstream"; status?: number };

/** Fetch a calc page by slug and read its buildInfo. `fetchOpts` carries the caller's user agent,
 * timeout signal and `redirect: "manual"`; the URL is built from the constant CALC and the slug,
 * so this never names a caller-supplied host. Never throws. */
async function readCalcPage(slug: string, doFetch: typeof fetch, fetchOpts: RequestInit): Promise<CalcPageResult> {
  try {
    const page = await doFetch(`${CALC}${slug}`, fetchOpts);
    if (page.status === 404) return { kind: "notFound" };
    if (!page.ok) return { kind: "upstream", status: page.status };
    return await readBuildInfo(page);
  } catch {
    // Covers a network failure and the timeout firing mid-fetch or mid-read, so every failure path
    // still returns our structured JSON (with CORS headers) rather than an uncaught exception
    // reaching the caller with no Access-Control-Allow-Origin at all.
    return { kind: "upstream" };
  }
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const origin = env.ALLOWED_ORIGIN;
  const doFetch = env.fetchImpl ?? fetch;
  if (request.method === "OPTIONS")
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type", // a JSON POST is preflighted for this
      },
    });
  const path = new URL(request.url).pathname;
  if (path === "/export") {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);
    return handleExport(request, env);
  }
  if (path !== "/") return json({ error: "not_found" }, 404, origin);
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, origin);

  // The only caller-controlled value, and it can never name a host: CALC is a constant.
  const slug = validSlug(request);
  if (slug === null) return json({ error: "bad_slug" }, 400, origin);

  const signal = AbortSignal.timeout(TIMEOUT_MS);
  // "manual" so a redirect response is never silently followed: the slug design guarantees WE
  // never name a host, but nothing stops grimtools itself redirecting us off grimtools.com (a
  // compromise, a misconfiguration, an open redirect). A refused redirect falls into the same
  // non-ok branch below as any other upstream failure.
  const fetchOpts = { headers: { "User-Agent": UA }, signal, redirect: "manual" as const };

  const result = await readCalcPage(slug, doFetch, fetchOpts);
  if (result.kind === "notFound" || result.kind === "missing") return json({ error: "not_found" }, 404, origin);
  if (result.kind === "upstream")
    return json(
      result.status === undefined ? { error: "upstream" } : { error: "upstream", status: result.status },
      502,
      origin,
    );
  if (result.kind === "unparseable") return json({ error: "unparseable" }, 502, origin);
  const info = result.info;

  // Re-validate rather than trusting upstream: the response must be incapable of carrying
  // anything but ids of our own shape. Named `skills`, not `stars`: this still mixes mastery
  // skills in with devotion stars (see extractBuildInfo) - the worker has no way to tell them
  // apart, so the field name must not claim otherwise.
  const skills = info.skillIds.filter((s) => SKILL_ID_RE.test(s));

  // Best effort. A missing data version degrades to "cannot check", never to a blocked import.
  let dataVersion: string | null = null;
  try {
    const dv = await doFetch(DEVOTION_JSON, fetchOpts);
    if (dv.ok) dataVersion = (await boundedText(dv)).match(/"version"\s*:\s*"([0-9a-f]+)"/)?.[1] ?? null;
  } catch {
    dataVersion = null;
  }

  return json({ slug, skills, title: result.title, gameVersion: info.gameVersion, dataVersion }, 200, origin);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Only a validated GET on the import route is ever cached: the cache key below is built from
    // the slug alone, so any other request must never consult or populate it (an OPTIONS preflight
    // sharing a GET's cache key would return a cached JSON body in place of its 204 preflight
    // response, and `/anything?slug=X` would be answered with the import route's body instead of
    // the 404 it must get).
    const { pathname } = new URL(request.url);
    if (request.method !== "GET" || pathname !== "/") return handleRequest(request, env);
    const slug = validSlug(request);
    if (slug === null) return handleRequest(request, env);

    const cache = caches.default;
    // Normalize the cache key to the slug plus our own IMPORT_CONTRACT_VERSION (see grimtools.ts).
    // Keying on the whole request (as `cache.match(request)` would) makes `?slug=X&n=1`,
    // `?slug=X&n=2` and `/anything?slug=X` distinct entries that each miss and each make a fresh
    // upstream fetch - one client could turn many requests into many upstream hits. Builds are
    // immutable, so a slug's content never changes: caching on the slug (and our own contract
    // version) alone caps both our cost and any amplification against grimtools. The client sends
    // its own version param too (see web/src/app/main.ts), purely so the *browser* cache sees a
    // new URL when the contract changes - it is deliberately NOT read here. Folding a
    // caller-supplied value into this key would hand anyone unbounded control of the keyspace
    // (`v=1`, `v=2`, ... `v=999999` each becoming a distinct entry and a fresh grimtools fetch),
    // exactly the amplification the slug-only key was normalized to prevent. Keying stays derived
    // from our own constant and the validated slug only.
    const cacheKey = new Request(new URL(`/?slug=${slug}&cv=${IMPORT_CONTRACT_VERSION}`, request.url).toString());
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
    const res = await handleRequest(request, env);
    // json() already marks every non-200 no-store; only put a 200 here too, belt-and-suspenders.
    if (res.status === 200) await cache.put(cacheKey, res.clone());
    return res;
  },
};
