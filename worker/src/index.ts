// ABOUTME: Cloudflare Worker that returns a grimtools build's devotion star ids for one slug.
// ABOUTME: Takes a slug and never a URL, so there is no code path that fetches a caller-named host.
/// <reference path="./worker-env.d.ts" />
import { extractBuildInfo } from "../../web/src/core/grimtools";

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

function json(body: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin,
      "Cache-Control": "public, max-age=86400",
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

/**
 * Read a response body incrementally, stopping the moment a complete `buildInfo` object is found,
 * so a hostile or oversized upstream cannot force a full-body brace-matching scan on the whole
 * MAX_BYTES cap. MAX_BYTES is the backstop for the case where `buildInfo` never appears. Uses
 * `{ stream: true }` so a multi-byte character split across a chunk boundary decodes correctly
 * rather than as a replacement character.
 */
async function readBuildInfo(res: Response): Promise<ReturnType<typeof extractBuildInfo>> {
  const reader = res.body?.getReader();
  if (!reader) return null;
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
      return info;
    }
  }
  return null;
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

  const slug = new URL(request.url).searchParams.get("slug") ?? "";
  // The only caller-controlled value, and it can never name a host: CALC is a constant.
  if (!SLUG_RE.test(slug)) return json({ error: "bad_slug" }, 400, origin);

  const signal = AbortSignal.timeout(TIMEOUT_MS);
  // "manual" so a redirect response is never silently followed: the slug design guarantees WE
  // never name a host, but nothing stops grimtools itself redirecting us off grimtools.com (a
  // compromise, a misconfiguration, an open redirect). A refused redirect falls into the same
  // non-ok branch below as any other upstream failure.
  const fetchOpts = { headers: { "User-Agent": UA }, signal, redirect: "manual" as const };

  let info: ReturnType<typeof extractBuildInfo>;
  try {
    const page = await doFetch(`${CALC}${slug}`, fetchOpts);
    if (page.status === 404) return json({ error: "not_found" }, 404, origin);
    if (!page.ok) return json({ error: "upstream", status: page.status }, 502, origin);
    info = await readBuildInfo(page);
  } catch {
    // Covers a network failure and the shared timeout firing mid-fetch or mid-read, so every
    // failure path still returns our structured JSON (with CORS headers) rather than an
    // uncaught exception reaching the caller with no Access-Control-Allow-Origin at all.
    return json({ error: "upstream" }, 502, origin);
  }
  if (!info) return json({ error: "unparseable" }, 502, origin);

  // Re-validate rather than trusting upstream: the response must be incapable of carrying
  // anything but ids of our own shape.
  const stars = info.skillIds.filter((s) => /^sk\d+$/.test(s));

  // Best effort. A missing data version degrades to "cannot check", never to a blocked import.
  let dataVersion: string | null = null;
  try {
    const dv = await doFetch(DEVOTION_JSON, fetchOpts);
    if (dv.ok) dataVersion = (await boundedText(dv)).match(/"version"\s*:\s*"([0-9a-f]+)"/)?.[1] ?? null;
  } catch {
    dataVersion = null;
  }

  return json({ slug, stars, gameVersion: info.gameVersion, dataVersion }, 200, origin);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cache = caches.default;
    const hit = await cache.match(request);
    if (hit) return hit;
    const res = await handleRequest(request, env);
    // Builds are immutable, so a slug's content never changes: cache aggressively, which caps
    // both our cost and any amplification against grimtools.
    if (res.status === 200) await cache.put(request, res.clone());
    return res;
  },
};
