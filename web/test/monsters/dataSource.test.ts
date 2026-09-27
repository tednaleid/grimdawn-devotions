// ABOUTME: Tests the grimtools link table loader's failure path: a deploy without the file, or a
// ABOUTME: broken fetch, must still resolve so the monster table renders every row unlinked.
import { test, expect, afterEach } from "bun:test";
import { loadGrimtoolsLinks } from "../../src/monsters/adapters/dataSource";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("resolves to {} when fetch rejects", async () => {
  globalThis.fetch = (() => Promise.reject(new Error("network down"))) as unknown as typeof fetch;
  expect(await loadGrimtoolsLinks()).toEqual({});
});

test("resolves to {} when the response is not ok", async () => {
  globalThis.fetch = (() => Promise.resolve(new Response(null, { status: 404 }))) as unknown as typeof fetch;
  expect(await loadGrimtoolsLinks()).toEqual({});
});
