// ABOUTME: Cloudflare Worker that returns a grimtools build's devotion star ids for one slug.
// ABOUTME: Takes a slug and never a URL, so there is no code path that fetches a caller-named host.
/// <reference path="./worker-env.d.ts" />
import {
  extractBuildInfo,
  extractBuildTitle,
  buildIsMissing,
  IMPORT_CONTRACT_VERSION,
} from "../../web/src/core/grimtools";

const SLUG_RE = /^[A-Za-z0-9_-]{1,24}$/;
const CALC = "https://www.grimtools.com/calc/";
const DEVOTION_JSON = "https://www.grimtools.com/static/gdx3/devotion/devotion.json";
const UA = "grimdawn-devotions-import/1.0 (+https://github.com/tednaleid/grimdawn-devotions)";
const MAX_BYTES = 2_000_000; // a calc page is ~40KB; this only bounds a hostile upstream
const TIMEOUT_MS = 10_000;

export interface Env {
  ALLOWED_ORIGIN: string;
  /** Injected in tests only; production uses global fetch. */
  fetchImpl?: typeof fetch;
}

/** Extracts and validates the `slug` query param. Null when absent or outside SLUG_RE, which is
 * also what the caching wrapper uses to decide whether a request is cacheable at all. */
function validSlug(request: Request): string | null {
  const slug = new URL(request.url).searchParams.get("slug") ?? "";
  return SLUG_RE.test(slug) ? slug : null;
}

function json(body: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin,
      // Only a 200 is a build that will never change, so only a 200 is storable/reusable. An
      // explicit max-age on an error status (per RFC 9111) would let a transient 502 get pinned
      // into a caller's cache for a day with no way to retry.
      "Cache-Control": status === 200 ? "public, max-age=86400" : "no-store",
    },
  });
}

/** Read at most MAX_BYTES of a response as text, so an oversized upstream cannot exhaust CPU. */
async function boundedText(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      text += decoder.decode(); // flush any trailing partial multi-byte char
      break;
    }
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      break;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text;
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

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const origin = env.ALLOWED_ORIGIN;
  const doFetch = env.fetchImpl ?? fetch;
  if (request.method === "OPTIONS")
    return new Response(null, {
      status: 204,
      headers: { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, OPTIONS" },
    });
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

  let result: BuildInfoResult;
  try {
    const page = await doFetch(`${CALC}${slug}`, fetchOpts);
    // grimtools serves a real 404 only for a request shape it does not recognize at all (kept
    // here as a belt-and-suspenders case); an unknown-but-plausible slug is HTTP 200 with
    // `buildInfo = null`, caught below via result.kind === "missing" instead.
    if (page.status === 404) return json({ error: "not_found" }, 404, origin);
    if (!page.ok) return json({ error: "upstream", status: page.status }, 502, origin);
    result = await readBuildInfo(page);
  } catch {
    // Covers a network failure and the shared timeout firing mid-fetch or mid-read, so every
    // failure path still returns our structured JSON (with CORS headers) rather than an
    // uncaught exception reaching the caller with no Access-Control-Allow-Origin at all.
    return json({ error: "upstream" }, 502, origin);
  }
  if (result.kind === "missing") return json({ error: "not_found" }, 404, origin);
  if (result.kind === "unparseable") return json({ error: "unparseable" }, 502, origin);
  const info = result.info;

  // Re-validate rather than trusting upstream: the response must be incapable of carrying
  // anything but ids of our own shape. Named `skills`, not `stars`: this still mixes mastery
  // skills in with devotion stars (see extractBuildInfo) - the worker has no way to tell them
  // apart, so the field name must not claim otherwise.
  const skills = info.skillIds.filter((s) => /^sk\d+$/.test(s));

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
    // Only a validated GET is ever cached: the cache key below is built from the slug alone, so
    // an OPTIONS preflight or a request that fails validation must never consult or populate it
    // (an OPTIONS request sharing a GET's cache key would return a cached JSON body in place of
    // its 204 preflight response).
    if (request.method !== "GET") return handleRequest(request, env);
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
