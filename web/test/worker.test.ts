// ABOUTME: Tests the worker's request handling: slug validation, response shape, and refusals.
// ABOUTME: Upstream fetch is stubbed, so this runs with no network and no Cloudflare account.
import { test, expect } from "bun:test";
import worker, { handleRequest } from "../../worker/src/index";

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
