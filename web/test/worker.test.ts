// ABOUTME: Tests the worker's request handling: slug validation, response shape, and refusals.
// ABOUTME: Upstream fetch is stubbed, so this runs with no network and no Cloudflare account.
import { test, expect } from "bun:test";
import worker, { handleRequest } from "../../worker/src/index";
import { savePayload, spliceDevotions, extractBuildInfo } from "../src/core/grimtools";
import realTable from "../../data/grimtools-stars.json";

const ORIGIN = "https://planner.example";
const page = `<script>window['buildInfo'] = {"data":{"skills":[{"name":"sk688","level":1}]},"created_for_build":"1.2.1.6"};</script>`;

function env(fetchImpl: typeof fetch) {
  return { ALLOWED_ORIGIN: ORIGIN, fetchImpl } as never;
}
const ok = async (url: string) =>
  url.includes("devotion.json")
    ? new Response('{"version":"1a801e4bd308"}', { status: 200 })
    : new Response(page, { status: 200 });

/** Minimal stand-in for the Workers runtime's `caches.default`, keyed the same way (by request
 * URL), so the default export's caching wrapper can be exercised with no real edge cache. */
class FakeCache {
  private store = new Map<string, Response>();
  async match(req: Request): Promise<Response | undefined> {
    return this.store.get(req.url)?.clone();
  }
  async put(req: Request, res: Response): Promise<void> {
    this.store.set(req.url, res.clone());
  }
}
function installFakeCache(): void {
  (globalThis as unknown as { caches: { default: FakeCache } }).caches = { default: new FakeCache() };
}

test("returns the stars for a valid slug", async () => {
  const res = await handleRequest(new Request("https://w/?slug=qNYgbjeV"), env(ok as never));
  expect(res.status).toBe(200);
  expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  const body = await res.json();
  expect(body).toEqual({
    slug: "qNYgbjeV",
    skills: ["sk688"],
    title: null, // the fixture page above has no <title>
    gameVersion: "1.2.1.6",
    dataVersion: "1a801e4bd308",
  });
});

test("extracts a sanitized build title from a real calculator page", async () => {
  const realPage = await Bun.file("test/fixtures/grimtools-calc.html").text();
  const withTitle = (async (u: string) =>
    String(u).includes("devotion.json")
      ? new Response('{"version":"1a801e4bd308"}', { status: 200 })
      : new Response(realPage, { status: 200 })) as never;
  const res = await handleRequest(new Request("https://w/?slug=qNYgbjeV"), env(withTitle));
  const body = await res.json();
  expect(body.title).toBe("Warder, Level 100 (GD 1.2.1.6)");
});

test("rejects a slug outside the charset without fetching anything", async () => {
  let called = false;
  const spy = (async () => {
    called = true;
    return new Response("");
  }) as never;
  for (const bad of ["../../etc", "a".repeat(25), "has space", ""]) {
    const res = await handleRequest(new Request(`https://w/?slug=${encodeURIComponent(bad)}`), env(spy));
    expect(res.status).toBe(400);
  }
  expect(called).toBe(false);
});

test("offers no way to name a host", async () => {
  // The absence of a url parameter is the security control. Passing one must change nothing.
  // A successful request makes two upstream fetches (the calc page, then devotion.json), so this
  // records every url reached rather than just the last, and checks each one.
  const seen: string[] = [];
  const spy = (async (u: string) => {
    seen.push(String(u));
    return ok(String(u));
  }) as never;
  await handleRequest(new Request("https://w/?slug=qNYgbjeV&url=https://evil.example/x"), env(spy));
  expect(seen.every((u) => u.startsWith("https://www.grimtools.com/"))).toBe(true);
  expect(seen[0]?.startsWith("https://www.grimtools.com/calc/")).toBe(true);
});

test("passes an unknown slug through as a 404", async () => {
  const miss = (async () => new Response("nope", { status: 404 })) as never;
  const res = await handleRequest(new Request("https://w/?slug=zzzzzzzz"), env(miss));
  expect(res.status).toBe(404);
});

test("reports grimtools' null-build page as 404 not_found, not 502", async () => {
  // The real shape grimtools serves for an unknown-but-plausible slug: HTTP 200 with
  // `buildInfo = null`, never an actual 404. This must resolve the same as a genuine 404 so the
  // app's notFound message fires instead of the generic network-failure one.
  const missing = (async () => new Response(`<script>window['buildInfo'] = null;</script>`, { status: 200 })) as never;
  const res = await handleRequest(new Request("https://w/?slug=zzzzzzzz"), env(missing));
  expect(res.status).toBe(404);
  expect((await res.json()).error).toBe("not_found");
});

test("reports a genuinely malformed page as 502 unparseable, distinct from a missing build", async () => {
  const malformed = (async () =>
    new Response("<html><body>no buildInfo marker at all</body></html>", { status: 200 })) as never;
  const res = await handleRequest(new Request("https://w/?slug=qNYgbjeV"), env(malformed));
  expect(res.status).toBe(502);
  expect((await res.json()).error).toBe("unparseable");
});

test("degrades to a null dataVersion when devotion.json is unavailable", async () => {
  const partial = (async (u: string) =>
    String(u).includes("devotion.json")
      ? new Response("", { status: 500 })
      : new Response(page, { status: 200 })) as never;
  const res = await handleRequest(new Request("https://w/?slug=qNYgbjeV"), env(partial));
  expect((await res.json()).dataVersion).toBeNull();
});

test("rejects non-GET methods", async () => {
  const res = await handleRequest(new Request("https://w/?slug=qNYgbjeV", { method: "POST" }), env(ok as never));
  expect(res.status).toBe(405);
});

test("refuses a redirect from upstream instead of following it", async () => {
  // grimtools itself could redirect us off grimtools.com (compromise, misconfiguration, an open
  // redirect); the fix is asking fetch never to follow, then treating a redirect as any other
  // upstream failure.
  let redirectMode: string | undefined;
  const spy = (async (_url: string, init?: RequestInit) => {
    redirectMode = init?.redirect;
    return new Response(null, { status: 302, headers: { Location: "https://evil.example/" } });
  }) as never;
  const res = await handleRequest(new Request("https://w/?slug=qNYgbjeV"), env(spy));
  expect(redirectMode).toBe("manual");
  expect(res.status).toBe(502);
});

// Every test above exercises handleRequest directly, which never touches the cache. The two
// below exercise the default-exported `fetch` wrapper, where the caching (and the cache-key
// normalization fix) actually lives.

test("the caching wrapper serves a repeat request without a fresh upstream fetch", async () => {
  installFakeCache();
  let calls = 0;
  const spy = (async (u: string) => {
    calls++;
    return ok(String(u));
  }) as never;
  const first = await worker.fetch(new Request("https://w/?slug=qNYgbjeV"), env(spy));
  expect(first.status).toBe(200);
  const callsAfterFirst = calls;
  const second = await worker.fetch(new Request("https://w/?slug=qNYgbjeV"), env(spy));
  expect(second.status).toBe(200);
  expect(calls).toBe(callsAfterFirst); // no new upstream fetch on the repeat request
});

test("the caching wrapper shares one cache entry across query strings differing only by extra noise", async () => {
  installFakeCache();
  let calls = 0;
  const spy = (async (u: string) => {
    calls++;
    return ok(String(u));
  }) as never;
  const first = await worker.fetch(new Request("https://w/?slug=qNYgbjeV"), env(spy));
  const firstBody = await first.json();
  const callsAfterFirst = calls;
  // Same slug, an extra query param: without a normalized cache key this misses and re-fetches.
  const second = await worker.fetch(new Request("https://w/?slug=qNYgbjeV&n=2"), env(spy));
  expect(calls).toBe(callsAfterFirst);
  expect(await second.json()).toEqual(firstBody);
});

// The security property this whole cache-invalidation mechanism depends on: the client's own
// version param (`v=`, sent so the *browser* cache sees a new URL - see main.ts) must never widen
// the worker's own keyspace. If it did, `v=1`, `v=2`, ... `v=999999` would each become a distinct
// edge-cache entry and a distinct upstream fetch, handing any caller unbounded amplification
// against grimtools - the exact thing the slug-only key was normalized to prevent.
test("the caching wrapper shares one cache entry across requests differing only in the client's version param", async () => {
  installFakeCache();
  let calls = 0;
  const spy = (async (u: string) => {
    calls++;
    return ok(String(u));
  }) as never;
  const first = await worker.fetch(new Request("https://w/?slug=qNYgbjeV&v=1"), env(spy));
  const firstBody = await first.json();
  const callsAfterFirst = calls;
  const second = await worker.fetch(new Request("https://w/?slug=qNYgbjeV&v=999999"), env(spy));
  expect(calls).toBe(callsAfterFirst); // no new upstream fetch: same cache entry, not a new one
  expect(await second.json()).toEqual(firstBody);
});

// The cache key is the slug alone, so the wrapper must consult it only for the route that key
// describes: a warm entry for the import route must never be handed to another path, which has its
// own answer (404 here) and would otherwise serve the import body once the cache is warm.
test("a warm import cache entry is not served for another path", async () => {
  installFakeCache();
  const spy = (async (u: string) => ok(String(u))) as never;
  const warm = await worker.fetch(new Request("https://w/?slug=qNYgbjeV"), env(spy));
  expect(warm.status).toBe(200);
  const other = await worker.fetch(new Request("https://w/foo?slug=qNYgbjeV"), env(spy));
  expect(other.status).toBe(404);
  expect(await other.json()).toEqual({ error: "not_found" });
});

test("the client's version param does not leak into the response body", async () => {
  const res = await handleRequest(new Request("https://w/?slug=qNYgbjeV&v=999999"), env(ok as never));
  expect(JSON.stringify(await res.json())).not.toContain("999999");
});

// Pins the exact response shape so a rename or removal is caught by CI instead of relied on not to
// happen. If this test fails because a field was intentionally added or removed, and an old cached
// response cannot tolerate the change, bump IMPORT_CONTRACT_VERSION in
// web/src/core/grimtools.ts, then update this test's expected field list.
test("the success response has exactly the contracted field names", async () => {
  const res = await handleRequest(new Request("https://w/?slug=qNYgbjeV"), env(ok as never));
  const body = await res.json();
  expect(Object.keys(body).sort()).toEqual(["dataVersion", "gameVersion", "skills", "slug", "title"]);
});

// --- POST /export -------------------------------------------------------------------------------

const EXPORT_URL = "https://w/export";
const SAVE_URL = "https://www.grimtools.com/save_build.php";
type Limiter = { limit(opts: { key: string }): Promise<{ success: boolean }> };

/** A limiter that allows the first `allow` calls for each key and refuses the rest, recording keys. */
function fakeLimiter(allow: number): Limiter & { keys: string[] } {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  return {
    keys,
    async limit({ key }) {
      keys.push(key);
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return { success: n <= allow };
    },
  };
}

function exportEnv(fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) {
  return { ALLOWED_ORIGIN: ORIGIN, fetchImpl, ...extra } as never;
}

function exportRequest(body: unknown, init: { origin?: string | null; ip?: string; raw?: string } = {}) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (init.origin !== null) headers.set("Origin", init.origin ?? ORIGIN);
  if (init.ip) headers.set("CF-Connecting-IP", init.ip);
  return new Request(EXPORT_URL, { method: "POST", headers, body: init.raw ?? JSON.stringify(body) });
}

const saved = (async () => new Response('{"id":"2ga0aJyZ"}', { status: 200 })) as never;

test("export: a valid body is posted to grimtools as its Share button would post it, and the slug comes back", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const spy = (async (url: string, init: RequestInit) => {
    seen = { url: String(url), init };
    return new Response('{"id":"2ga0aJyZ"}', { status: 200 });
  }) as never;
  const res = await handleRequest(exportRequest({ skills: ["sk739"] }), exportEnv(spy));
  expect(res.status).toBe(201);
  expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(await res.json()).toEqual({ slug: "2ga0aJyZ" });

  const { url, init } = seen!;
  expect(url).toBe(SAVE_URL);
  expect(init.method).toBe("POST");
  expect(init.redirect).toBe("manual");
  expect(init.signal).toBeInstanceOf(AbortSignal);
  const h = new Headers(init.headers);
  expect(h.get("Content-Type")).toBe("application/x-www-form-urlencoded; charset=UTF-8");
  expect(h.get("X-Requested-With")).toBe("XMLHttpRequest");
  expect(h.get("Referer")).toBe("https://www.grimtools.com/calc/");
  expect(h.get("User-Agent")).toContain("grimdawn-devotions");
  const form = new URLSearchParams(String(init.body));
  expect(form.get("mod")).toBe("");
  expect(JSON.parse(form.get("data")!)).toEqual(savePayload(["sk739"]));
});

test("export: the success response has exactly the contracted field names", async () => {
  const res = await handleRequest(exportRequest({ skills: ["sk739"] }), exportEnv(saved));
  expect(Object.keys(await res.json()).sort()).toEqual(["slug"]);
});

test("export: refuses a request from any other origin, or none, before doing anything", async () => {
  let called = false;
  const spy = (async () => {
    called = true;
    return new Response("");
  }) as never;
  expect(
    (await handleRequest(exportRequest({ skills: ["sk1"] }, { origin: "https://evil.example" }), exportEnv(spy)))
      .status,
  ).toBe(403);
  expect((await handleRequest(exportRequest({ skills: ["sk1"] }, { origin: null }), exportEnv(spy))).status).toBe(403);
  expect(called).toBe(false);
});

test("export: rejects every malformed body with 400 and never reaches grimtools", async () => {
  let called = false;
  const spy = (async () => {
    called = true;
    return new Response("");
  }) as never;
  const bad: unknown[] = [
    {},
    { skills: [] },
    { skills: "sk1" },
    { skills: [1] },
    { skills: ["sk1", "sk1"] },
    { skills: ["../x"] },
    { skills: ["sk1 "] },
    { skills: Array.from({ length: 56 }, (_, i) => `sk${i}`) },
    null,
    [],
  ];
  for (const b of bad) {
    const res = await handleRequest(exportRequest(b), exportEnv(spy));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
  }
  expect((await handleRequest(exportRequest(null, { raw: "not json" }), exportEnv(spy))).status).toBe(400);
  expect(called).toBe(false);
});

test("export: a body over 4 KB is refused as bad_request without being parsed", async () => {
  let called = false;
  const spy = (async () => {
    called = true;
    return new Response("");
  }) as never;
  const raw = JSON.stringify({ skills: ["sk1"], pad: "x".repeat(5000) });
  const res = await handleRequest(exportRequest(null, { raw }), exportEnv(spy));
  expect(res.status).toBe(400);
  expect(called).toBe(false);
});

/** A `{"skills":["sk1"],"pad":"..."}` body padded to exactly `totalBytes` (ASCII throughout, so
 * string length is byte length). */
function paddedExportBody(totalBytes: number): string {
  const base = JSON.stringify({ skills: ["sk1"], pad: "" });
  return JSON.stringify({ skills: ["sk1"], pad: "x".repeat(totalBytes - base.length) });
}

test("export: a body of exactly 4096 bytes is accepted; one byte more is refused", async () => {
  const exact = paddedExportBody(4096);
  expect(exact.length).toBe(4096);
  const okRes = await handleRequest(exportRequest(null, { raw: exact }), exportEnv(saved));
  expect(okRes.status).toBe(201);

  const over = paddedExportBody(4097);
  expect(over.length).toBe(4097);
  const badRes = await handleRequest(exportRequest(null, { raw: over }), exportEnv(saved));
  expect(badRes.status).toBe(400);
});

test("export: accepts 55 distinct skills", async () => {
  const res = await handleRequest(
    exportRequest({ skills: Array.from({ length: 55 }, (_, i) => `sk${i + 1}`) }),
    exportEnv(saved),
  );
  expect(res.status).toBe(201);
});

test("export: the per-IP limiter is keyed on CF-Connecting-IP and refuses with 429 once spent", async () => {
  const ip = fakeLimiter(1);
  const env = exportEnv(saved, { EXPORT_LIMITER_IP: ip });
  expect((await handleRequest(exportRequest({ skills: ["sk1"] }, { ip: "203.0.113.9" }), env)).status).toBe(201);
  const second = await handleRequest(exportRequest({ skills: ["sk1"] }, { ip: "203.0.113.9" }), env);
  expect(second.status).toBe(429);
  expect(await second.json()).toEqual({ error: "rate_limited" });
  expect(ip.keys).toEqual(["ip:203.0.113.9", "ip:203.0.113.9"]);
  // A different address has its own budget.
  expect((await handleRequest(exportRequest({ skills: ["sk1"] }, { ip: "203.0.113.10" }), env)).status).toBe(201);
});

test("export: the global limiter caps everyone together, and a refusal never reaches grimtools", async () => {
  let calls = 0;
  const spy = (async () => {
    calls++;
    return new Response('{"id":"2ga0aJyZ"}', { status: 200 });
  }) as never;
  const global = fakeLimiter(1);
  const env = exportEnv(spy, { EXPORT_LIMITER_GLOBAL: global });
  expect((await handleRequest(exportRequest({ skills: ["sk1"] }, { ip: "203.0.113.1" }), env)).status).toBe(201);
  expect((await handleRequest(exportRequest({ skills: ["sk1"] }, { ip: "203.0.113.2" }), env)).status).toBe(429);
  expect(global.keys).toEqual(["global", "global"]);
  expect(calls).toBe(1);
});

test("export: with no limiter bindings (tests, local runtimes without them) nothing is limited", async () => {
  for (let i = 0; i < 3; i++) {
    expect((await handleRequest(exportRequest({ skills: ["sk1"] }), exportEnv(saved))).status).toBe(201);
  }
});

test("export: the 400, 403, and 429 responses all carry Cache-Control: no-store", async () => {
  const spy = (async () => new Response("")) as never;

  const badOrigin = await handleRequest(
    exportRequest({ skills: ["sk1"] }, { origin: "https://evil.example" }),
    exportEnv(spy),
  );
  expect(badOrigin.status).toBe(403);
  expect(badOrigin.headers.get("Cache-Control")).toBe("no-store");

  const badBody = await handleRequest(exportRequest({}), exportEnv(spy));
  expect(badBody.status).toBe(400);
  expect(badBody.headers.get("Cache-Control")).toBe("no-store");

  const spent = fakeLimiter(0);
  const limited = await handleRequest(
    exportRequest({ skills: ["sk1"] }),
    exportEnv(saved, { EXPORT_LIMITER_IP: spent }),
  );
  expect(limited.status).toBe(429);
  expect(limited.headers.get("Cache-Control")).toBe("no-store");
});

test("export: an upstream failure, a redirect, or a thrown fetch is 502 upstream", async () => {
  const cases: (typeof fetch)[] = [
    (async () => new Response("nope", { status: 500 })) as never,
    (async () => new Response("", { status: 302, headers: { Location: "https://evil.example/" } })) as never,
    (async () => {
      throw new Error("boom");
    }) as never,
  ];
  for (const f of cases) {
    const res = await handleRequest(exportRequest({ skills: ["sk1"] }), exportEnv(f));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("upstream");
  }
});

test("export: a 2xx from grimtools without a valid slug id is 502 unparseable, and nothing upstream is relayed", async () => {
  const cases = ['{"error":"nope"}', "not json", '{"id":"../../etc"}', '{"id":""}', '{"id":42}', '{"id":"<b>x</b>"}'];
  for (const body of cases) {
    const f = (async () => new Response(body, { status: 200 })) as never;
    const res = await handleRequest(exportRequest({ skills: ["sk1"] }), exportEnv(f));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "unparseable" });
  }
});

test("export: only POST is accepted on /export, and unknown paths are 404", async () => {
  expect(
    (await handleRequest(new Request(EXPORT_URL, { method: "GET", headers: { Origin: ORIGIN } }), exportEnv(saved)))
      .status,
  ).toBe(405);
  expect(
    (await handleRequest(new Request("https://w/other", { headers: { Origin: ORIGIN } }), exportEnv(saved))).status,
  ).toBe(404);
});

test("preflight advertises POST and the Content-Type header for the export route", async () => {
  const res = await handleRequest(new Request(EXPORT_URL, { method: "OPTIONS" }), exportEnv(saved));
  expect(res.status).toBe(204);
  expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS");
  expect(res.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
  expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
});

test("export: the default export's caching wrapper passes POST straight through, uncached", async () => {
  installFakeCache();
  let calls = 0;
  const spy = (async () => {
    calls++;
    return new Response('{"id":"2ga0aJyZ"}', { status: 200 });
  }) as never;
  const env = exportEnv(spy);
  await worker.fetch(exportRequest({ skills: ["sk1"] }), env);
  await worker.fetch(exportRequest({ skills: ["sk1"] }), env);
  expect(calls).toBe(2);
});

// --- POST /export with a base build ------------------------------------------------------------

const CALC_URL = "https://www.grimtools.com/calc/";
const STARS = (realTable as { stars: Record<string, string> }).stars;

/** Answers the base page for any calc URL and a saved id for the save URL, recording both. */
function baseFetch(basePage: string, saveStatus = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith(CALC_URL)) return new Response(basePage, { status: 200 });
    if (String(url) === SAVE_URL) return new Response('{"id":"2ga0aJyZ"}', { status: saveStatus });
    return new Response("", { status: 404 });
  }) as never;
  return { f, calls };
}

test("export with a base: the base page is fetched, its stars replaced, and the spliced data posted", async () => {
  const html = await Bun.file("test/fixtures/grimtools-calc.html").text();
  const data = extractBuildInfo(html)!.data as { skills: { name: string }[]; equipment: unknown };
  const remove = data.skills.map((s) => s.name).filter((id) => id in STARS);
  expect(remove.length).toBe(55);
  const { f, calls } = baseFetch(html);
  const res = await handleRequest(
    exportRequest({ skills: ["sk739"], base: { slug: "qNYgbjeV", remove } }),
    exportEnv(f),
  );
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ slug: "2ga0aJyZ" });

  const pageCall = calls.find((c) => c.url.startsWith(CALC_URL))!;
  expect(pageCall.url).toBe(`${CALC_URL}qNYgbjeV`);
  expect(pageCall.init?.redirect).toBe("manual");
  expect(new Headers(pageCall.init?.headers).get("User-Agent")).toContain("grimdawn-devotions");

  const save = calls.find((c) => c.url === SAVE_URL)!;
  const form = new URLSearchParams(String(save.init?.body));
  expect(form.get("mod")).toBe("");
  const posted = JSON.parse(form.get("data")!);
  expect(posted).toEqual(spliceDevotions(data, remove, ["sk739"]));
  expect(posted.equipment).toEqual(data.equipment);
  expect(posted.skills.length).toBe(29);
  expect(posted.skills.at(-1)).toEqual({ name: "sk739", level: 1 });
  expect(posted.bio.devotionPoints).toBe(54);
});

test("export with a base: an empty remove list is accepted and only appends", async () => {
  const html = await Bun.file("test/fixtures/grimtools-calc.html").text();
  const { f, calls } = baseFetch(html);
  const res = await handleRequest(
    exportRequest({ skills: ["sk739"], base: { slug: "qNYgbjeV", remove: [] } }),
    exportEnv(f),
  );
  expect(res.status).toBe(201);
  const form = new URLSearchParams(String(calls.find((c) => c.url === SAVE_URL)!.init?.body));
  const posted = JSON.parse(form.get("data")!);
  expect(posted.skills.length).toBe(84);
  expect(posted.bio.devotionPoints).toBe(0); // 0 + 0 - 1, floored
});

test("export with a base: a base that is 404, a null build, or unreachable is 502 upstream and nothing is saved", async () => {
  const cases: (() => Response | Promise<Response>)[] = [
    () => new Response("nope", { status: 404 }),
    () => new Response(`<script>window['buildInfo'] = null;</script>`, { status: 200 }),
    () => new Response("", { status: 302, headers: { Location: "https://elsewhere.example/" } }),
    () => {
      throw new TypeError("offline");
    },
  ];
  for (const respond of cases) {
    const calls: string[] = [];
    const f = (async (url: string) => {
      calls.push(String(url));
      if (String(url).startsWith(CALC_URL)) return respond();
      return new Response('{"id":"2ga0aJyZ"}', { status: 200 });
    }) as never;
    const res = await handleRequest(
      exportRequest({ skills: ["sk739"], base: { slug: "qNYgbjeV", remove: ["sk688"] } }),
      exportEnv(f),
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "upstream" });
    expect(calls).not.toContain(SAVE_URL);
  }
});

test("export with a base: a base page whose data cannot be spliced is 502 unparseable and nothing is saved", async () => {
  const pages = [
    `<script>window['buildInfo'] = {"data":{"skills":[{"name":"sk688","level":1}]},"created_for_build":"1.2.1.6"};</script>`, // no bio
    `<script>window['buildInfo'] = {"data":{"bio":{"devotionPoints":1},"skills":[{"name":"sk688"}]}};</script>`, // no level
    `<html>nothing here</html>`,
  ];
  for (const page of pages) {
    const { f, calls } = baseFetch(page);
    const res = await handleRequest(
      exportRequest({ skills: ["sk739"], base: { slug: "qNYgbjeV", remove: [] } }),
      exportEnv(f),
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "unparseable" });
    expect(calls.some((c) => c.url === SAVE_URL)).toBe(false);
  }
});

test("export with a base: every malformed base is 400 and nothing is fetched at all", async () => {
  const calls: string[] = [];
  const spy = (async (url: string) => {
    calls.push(String(url));
    return new Response("", { status: 200 });
  }) as never;
  const bad: unknown[] = [
    "qNYgbjeV",
    ["qNYgbjeV"],
    { slug: "not a slug!", remove: [] },
    { slug: "qNYgbjeV" },
    { slug: "qNYgbjeV", remove: "sk1" },
    { slug: "qNYgbjeV", remove: ["nope"] },
    { slug: "qNYgbjeV", remove: ["sk1", "sk1"] },
    { slug: "qNYgbjeV", remove: Array.from({ length: 129 }, (_, i) => `sk${i + 1}`) },
    { remove: [] },
  ];
  for (const base of bad) {
    const res = await handleRequest(exportRequest({ skills: ["sk739"], base }), exportEnv(spy));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
  }
  expect(calls).toEqual([]);
});

test("export with a base: 128 distinct remove ids are accepted", async () => {
  const html = await Bun.file("test/fixtures/grimtools-calc.html").text();
  const { f } = baseFetch(html);
  const remove = Array.from({ length: 128 }, (_, i) => `sk${i + 1}`);
  const res = await handleRequest(
    exportRequest({ skills: ["sk739"], base: { slug: "qNYgbjeV", remove } }),
    exportEnv(f),
  );
  expect(res.status).toBe(201);
});

test("export with a base: a refused rate limit never fetches the base page", async () => {
  const calls: string[] = [];
  const spy = (async (url: string) => {
    calls.push(String(url));
    return new Response("", { status: 200 });
  }) as never;
  const env = exportEnv(spy, { EXPORT_LIMITER_IP: fakeLimiter(0) });
  const res = await handleRequest(
    exportRequest({ skills: ["sk739"], base: { slug: "qNYgbjeV", remove: [] } }, { ip: "203.0.113.9" }),
    env,
  );
  expect(res.status).toBe(429);
  expect(calls).toEqual([]);
});
