// ABOUTME: Tests the ?v= cache-bust tagger that keeps runtime-fetched JSON from serving stale after a deploy.
import { test, expect } from "bun:test";
import { withVersion, assetVersion } from "../src/adapters/assetVersion";

test("appends the asset version as a ?v= query on a bare URL", () => {
  expect(withVersion("data/x.json")).toBe(`data/x.json?v=${assetVersion}`);
});

test("joins with & when the URL already carries a query", () => {
  expect(withVersion("data/x.json?foo=1")).toBe(`data/x.json?foo=1&v=${assetVersion}`);
});

test("assetVersion is 'dev' when unbundled (no __ASSET_V__ define)", () => {
  // Bun tests do not run through bundle.ts, so the define is absent and the guard yields "dev".
  expect(assetVersion).toBe("dev");
});
