// ABOUTME: Tests the worker's request handling: slug validation, response shape, and refusals.
// ABOUTME: Upstream fetch is stubbed, so this runs with no network and no Cloudflare account.
import { test, expect } from "bun:test";
import { handleRequest } from "../../worker/src/index";

const ORIGIN = "https://planner.example";
const page = `<script>window['buildInfo'] = {"data":{"skills":[{"name":"sk688","level":1}]},"created_for_build":"1.2.1.6"};</script>`;

function env(fetchImpl: typeof fetch) {
  return { ALLOWED_ORIGIN: ORIGIN, fetchImpl } as never;
}
const ok = async (url: string) =>
  url.includes("devotion.json")
    ? new Response('{"version":"1a801e4bd308"}', { status: 200 })
    : new Response(page, { status: 200 });

test("returns the stars for a valid slug", async () => {
  const res = await handleRequest(new Request("https://w/?slug=qNYgbjeV"), env(ok as never));
  expect(res.status).toBe(200);
  expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  const body = await res.json();
  expect(body).toEqual({
    slug: "qNYgbjeV",
    stars: ["sk688"],
    gameVersion: "1.2.1.6",
    dataVersion: "1a801e4bd308",
  });
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
