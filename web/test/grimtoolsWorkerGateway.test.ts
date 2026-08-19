// ABOUTME: Tests the worker gateway adapter: request shapes for both routes and the mapping of every
// ABOUTME: HTTP outcome to the port's result unions. No network: fetch is a recording fake.
import { test, expect } from "bun:test";
import { makeWorkerGateway } from "../src/adapters/grimtoolsWorkerGateway";
import { EXPORT_CONTRACT_VERSION, IMPORT_CONTRACT_VERSION } from "../src/core/grimtools";

const BASE = "https://api.example";

function fakeFetch(respond: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return respond(String(url), init);
  }) as typeof fetch;
  return { f, calls };
}
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test("fetchBuild GETs the import route with the slug and the import contract version", async () => {
  const { f, calls } = fakeFetch(() =>
    jsonRes({ slug: "qNYgbjeV", skills: ["sk688"], dataVersion: "1a80", title: "Warder" }),
  );
  const r = await makeWorkerGateway(BASE, f).fetchBuild("qNYgbjeV");
  expect(calls[0]!.url).toBe(`${BASE}/?slug=qNYgbjeV&v=${IMPORT_CONTRACT_VERSION}`);
  expect(r).toEqual({ kind: "ok", skills: ["sk688"], dataVersion: "1a80", title: "Warder" });
});

test("fetchBuild encodes the slug and tolerates a response with no title and no dataVersion", async () => {
  const { f, calls } = fakeFetch(() => jsonRes({ slug: "x", skills: ["sk1"] }));
  const r = await makeWorkerGateway(BASE, f).fetchBuild("a b");
  expect(calls[0]!.url).toContain("slug=a%20b");
  expect(r).toEqual({ kind: "ok", skills: ["sk1"], dataVersion: null, title: null });
});

test("fetchBuild maps 404 to notFound and everything else that is not ok to network", async () => {
  expect(
    await makeWorkerGateway(BASE, fakeFetch(() => jsonRes({ error: "not_found" }, 404)).f).fetchBuild("x"),
  ).toEqual({ kind: "notFound" });
  expect(await makeWorkerGateway(BASE, fakeFetch(() => jsonRes({ error: "upstream" }, 502)).f).fetchBuild("x")).toEqual(
    { kind: "network" },
  );
  expect(
    await makeWorkerGateway(BASE, fakeFetch(() => new Response("<html>", { status: 200 })).f).fetchBuild("x"),
  ).toEqual({ kind: "network" });
  const thrower = (async () => {
    throw new TypeError("offline");
  }) as unknown as typeof fetch;
  expect(await makeWorkerGateway(BASE, thrower).fetchBuild("x")).toEqual({ kind: "network" });
});

test("saveBuild POSTs JSON to the export route with the export contract version", async () => {
  const { f, calls } = fakeFetch(() => jsonRes({ slug: "2ga0aJyZ" }, 201));
  const r = await makeWorkerGateway(BASE, f).saveBuild(["sk739", "sk740"]);
  expect(r).toEqual({ kind: "ok", slug: "2ga0aJyZ" });
  const { url, init } = calls[0]!;
  expect(url).toBe(`${BASE}/export?v=${EXPORT_CONTRACT_VERSION}`);
  expect(init?.method).toBe("POST");
  expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
  expect(JSON.parse(String(init?.body))).toEqual({ skills: ["sk739", "sk740"] });
});

test("saveBuild maps 429 to rateLimited, 502 to upstream, and other failures to network", async () => {
  const gw = (status: number, body: unknown = { error: "x" }) =>
    makeWorkerGateway(BASE, fakeFetch(() => jsonRes(body, status)).f);
  expect(await gw(429).saveBuild(["sk1"])).toEqual({ kind: "rateLimited" });
  expect(await gw(502).saveBuild(["sk1"])).toEqual({ kind: "upstream" });
  expect(await gw(400).saveBuild(["sk1"])).toEqual({ kind: "network" });
  expect(await gw(403).saveBuild(["sk1"])).toEqual({ kind: "network" });
  expect(await gw(200, { slug: "abc" }).saveBuild(["sk1"])).toEqual({ kind: "network" }); // the contract is 201
  const thrower = (async () => {
    throw new TypeError("offline");
  }) as unknown as typeof fetch;
  expect(await makeWorkerGateway(BASE, thrower).saveBuild(["sk1"])).toEqual({ kind: "network" });
});

test("saveBuild re-checks the slug charset before it can become an href", async () => {
  const gw = (body: unknown) => makeWorkerGateway(BASE, fakeFetch(() => jsonRes(body, 201)).f);
  expect(await gw({ slug: "../evil" }).saveBuild(["sk1"])).toEqual({ kind: "network" });
  expect(await gw({ slug: 7 }).saveBuild(["sk1"])).toEqual({ kind: "network" });
  expect(await gw({}).saveBuild(["sk1"])).toEqual({ kind: "network" });
});

test("saveBuild without a base sends no base key at all", async () => {
  const { f, calls } = fakeFetch(() => jsonRes({ slug: "2ga0aJyZ" }, 201));
  await makeWorkerGateway(BASE, f).saveBuild(["sk739"]);
  expect(Object.keys(JSON.parse(String(calls[0]!.init?.body)))).toEqual(["skills"]);
});

test("saveBuild with a base puts it in the body beside the skills", async () => {
  const { f, calls } = fakeFetch(() => jsonRes({ slug: "2d1W1Q8V" }, 201));
  const r = await makeWorkerGateway(BASE, f).saveBuild(["sk739"], { slug: "qNYgbjeV", remove: ["sk699", "sk927"] });
  expect(r).toEqual({ kind: "ok", slug: "2d1W1Q8V" });
  expect(calls[0]!.url).toBe(`${BASE}/export?v=${EXPORT_CONTRACT_VERSION}`);
  expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
    skills: ["sk739"],
    base: { slug: "qNYgbjeV", remove: ["sk699", "sk927"] },
  });
});
