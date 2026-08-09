// ABOUTME: Tests slug parsing and buildInfo extraction against a committed real calculator page.
// ABOUTME: No network: the fixture is what pins the extraction contract.
import { test, expect } from "bun:test";
import { parseSlug, extractBuildInfo } from "../src/core/grimtools";

test("parseSlug accepts a bare slug", () => {
  expect(parseSlug("qNYgbjeV")).toBe("qNYgbjeV");
});

test("parseSlug accepts full calculator URLs in their common shapes", () => {
  expect(parseSlug("https://www.grimtools.com/calc/qNYgbjeV")).toBe("qNYgbjeV");
  expect(parseSlug("https://www.grimtools.com/calc/qNYgbjeV/")).toBe("qNYgbjeV");
  expect(parseSlug("http://grimtools.com/calc/qNYgbjeV?foo=1")).toBe("qNYgbjeV");
  expect(parseSlug("  https://www.grimtools.com/calc/qNYgbjeV  ")).toBe("qNYgbjeV");
});

test("parseSlug rejects a URL on any other host", () => {
  // The host allowlist is a security control, not a convenience: without it the app would
  // happily hand an attacker-chosen slug-looking path to the worker.
  expect(parseSlug("https://evil.example.com/calc/qNYgbjeV")).toBeNull();
  expect(parseSlug("https://grimtools.com.evil.example/calc/qNYgbjeV")).toBeNull();
});

test("parseSlug rejects junk and out-of-charset input", () => {
  expect(parseSlug("")).toBeNull();
  expect(parseSlug("   ")).toBeNull();
  expect(parseSlug("not a slug")).toBeNull();
  expect(parseSlug("a".repeat(25))).toBeNull();
  expect(parseSlug("abc/def")).toBeNull();
  expect(parseSlug("../../etc/passwd")).toBeNull();
});

test("extractBuildInfo pulls skill ids and game version from a real page", async () => {
  const html = await Bun.file("test/fixtures/grimtools-calc.html").text();
  const info = extractBuildInfo(html);
  expect(info).not.toBeNull();
  // 28 mastery skills plus 55 devotion stars on this build.
  expect(info!.skillIds.length).toBe(83);
  expect(info!.skillIds).toContain("sk688");
  expect(info!.gameVersion).toBe("1.2.1.6");
});

test("extractBuildInfo returns null rather than throwing on pages without the global", () => {
  expect(extractBuildInfo("<html><body>nothing here</body></html>")).toBeNull();
  expect(extractBuildInfo("")).toBeNull();
});

test("extractBuildInfo does not run past the end of the object", () => {
  // Braces inside strings must not confuse the matcher, and trailing markup must be ignored.
  const html = `<script>window['buildInfo'] = {"data":{"skills":[{"name":"sk1","level":1}],"note":"a } brace"},"created_for_build":"9.9.9.9"};</script><div>{{{</div>`;
  const info = extractBuildInfo(html);
  expect(info!.skillIds).toEqual(["sk1"]);
  expect(info!.gameVersion).toBe("9.9.9.9");
});
