// ABOUTME: Tests slug parsing and buildInfo extraction against a committed real calculator page.
// ABOUTME: No network: the fixture is what pins the extraction contract.
import { test, expect } from "bun:test";
import {
  parseSlug,
  extractBuildInfo,
  extractBuildTitle,
  buildIsMissing,
  mapStars,
  isSlug,
  invertStarTable,
  toGrimtoolsSkills,
  savePayload,
  EXPORT_CONTRACT_VERSION,
} from "../src/core/grimtools";
import realTable from "../../data/grimtools-stars.json";

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

test("extractBuildInfo does not brace-match later markup when buildInfo is explicitly null", () => {
  // grimtools serves `window['buildInfo'] = null;` (HTTP 200) for a syntactically-plausible but
  // nonexistent slug. Before the fix this scanned forward for the next `{` anywhere in the
  // document; a later inline <script> that happens to brace-balance and JSON.parse (here: shaped
  // just enough to carry a data.skills array) must NOT be returned as if it were the build.
  const html =
    `<script>window['buildInfo'] = null;</script>` +
    `<style>.x { color: red; }</style>` +
    `<script>var trap = {"data":{"skills":[{"name":"sk999"}]}};</script>`;
  expect(extractBuildInfo(html)).toBeNull();
});

test("buildIsMissing detects grimtools' null-build marker", () => {
  expect(buildIsMissing("<script>window['buildInfo'] = null;</script>")).toBe(true);
});

test("buildIsMissing is false for a real build or an absent marker", () => {
  expect(buildIsMissing("<html><body>nothing here</body></html>")).toBe(false);
  const html = `<script>window['buildInfo'] = {"data":{"skills":[]},"created_for_build":"1.2.1.6"};</script>`;
  expect(buildIsMissing(html)).toBe(false);
});

test("extractBuildInfo does not run past the end of the object", () => {
  // Braces inside strings must not confuse the matcher, and trailing markup must be ignored.
  const html = `<script>window['buildInfo'] = {"data":{"skills":[{"name":"sk1","level":1}],"note":"a } brace"},"created_for_build":"9.9.9.9"};</script><div>{{{</div>`;
  const info = extractBuildInfo(html);
  expect(info!.skillIds).toEqual(["sk1"]);
  expect(info!.gameVersion).toBe("9.9.9.9");
});

test("mapStars keeps devotion stars and drops mastery skills", () => {
  // Mastery skills are absent from the table by construction, which is exactly what separates
  // them from devotion stars in buildInfo's single flat skills array.
  const table = { sk688: "raven:0", sk689: "raven:1" };
  expect(mapStars(["sk688", "sk1145", "sk689"], table)).toEqual(["raven:0", "raven:1"]);
});

test("mapStars preserves the order stars appear in", () => {
  const table = { sk688: "raven:0", sk689: "raven:1" };
  expect(mapStars(["sk689", "sk688"], table)).toEqual(["raven:1", "raven:0"]);
});

test("mapStars deduplicates repeated ids", () => {
  expect(mapStars(["sk688", "sk688"], { sk688: "raven:0" })).toEqual(["raven:0"]);
});

test("mapStars tolerates an empty build and an empty table", () => {
  expect(mapStars([], { sk688: "raven:0" })).toEqual([]);
  expect(mapStars(["sk688"], {})).toEqual([]);
});

test("a real build maps to exactly 55 stars against the committed table", async () => {
  const html = await Bun.file("test/fixtures/grimtools-calc.html").text();
  const info = extractBuildInfo(html)!;
  const stars = mapStars(info.skillIds, (realTable as { stars: Record<string, string> }).stars);
  expect(stars.length).toBe(55);
  // Every mapped id must be a real star id shape; the table guard proves they exist in the model.
  for (const s of stars) expect(s).toMatch(/^[a-z0-9_]+:\d+$/);
});

test("extractBuildTitle strips the site suffix from a real page's <title>", async () => {
  const html = await Bun.file("test/fixtures/grimtools-calc.html").text();
  expect(extractBuildTitle(html)).toBe("Warder, Level 100 (GD 1.2.1.6)");
});

test("extractBuildTitle returns null when there is no <title>", () => {
  expect(extractBuildTitle("<html><body>nothing here</body></html>")).toBeNull();
  expect(extractBuildTitle("")).toBeNull();
});

test("extractBuildTitle returns null when the title is empty after stripping the suffix", () => {
  expect(extractBuildTitle("<title> - Grim Dawn Build Calculator</title>")).toBeNull();
  expect(extractBuildTitle("<title>   </title>")).toBeNull();
});

test("extractBuildTitle returns null for a missing build, even if the page still has a <title>", () => {
  const html = `<title>Grim Dawn Build Calculator</title><script>window['buildInfo'] = null;</script>`;
  expect(extractBuildTitle(html)).toBeNull();
});

test("extractBuildTitle strips angle brackets rather than passing them through", () => {
  // A build name is untrusted, upstream-relayed text (see the design doc): this belt-and-braces
  // strip is the extraction-side half of neutering markup, ahead of the panel's own HTML-escape.
  const html = "<title><script>alert(1)</script> - Grim Dawn Build Calculator</title>";
  expect(extractBuildTitle(html)).toBe("scriptalert(1)/script");
});

test("extractBuildTitle collapses whitespace and trims", () => {
  const html = "<title>  My   Build   - Grim Dawn Build Calculator</title>";
  expect(extractBuildTitle(html)).toBe("My Build");
});

test("extractBuildTitle caps an over-long title at 100 characters", () => {
  const long = "x".repeat(150);
  const html = `<title>${long} - Grim Dawn Build Calculator</title>`;
  const result = extractBuildTitle(html);
  expect(result).not.toBeNull();
  expect(result!.length).toBe(100);
  expect(result).toBe("x".repeat(100));
});

test("isSlug accepts the slug charset and nothing else", () => {
  expect(isSlug("2ga0aJyZ")).toBe(true);
  expect(isSlug("a-b_c")).toBe(true);
  expect(isSlug("")).toBe(false);
  expect(isSlug("a".repeat(25))).toBe(false);
  expect(isSlug("../x")).toBe(false);
  expect(isSlug("has space")).toBe(false);
});

test("invertStarTable turns the committed table into a star-to-sk bijection", () => {
  const stars = (realTable as { stars: Record<string, string> }).stars;
  const inverse = invertStarTable(stars);
  expect(Object.keys(inverse).length).toBe(Object.keys(stars).length);
  for (const [sk, star] of Object.entries(stars)) expect(inverse[star]).toBe(sk);
});

test("invertStarTable refuses a table where two skill ids share one star", () => {
  expect(() => invertStarTable({ sk1: "bat:0", sk2: "bat:0" })).toThrow(/bat:0/);
});

test("the crossroads star the investigation saved round-trips: crossroads_primordial:0 is sk739", () => {
  const stars = (realTable as { stars: Record<string, string> }).stars;
  expect(invertStarTable(stars)["crossroads_primordial:0"]).toBe("sk739");
});

test("toGrimtoolsSkills maps a selection in star-id order, whatever order it was given in", () => {
  const inverse = { "b:1": "sk20", "a:0": "sk10" };
  expect(toGrimtoolsSkills(new Set(["b:1", "a:0"]), inverse)).toEqual(["sk10", "sk20"]);
  expect(toGrimtoolsSkills(["a:0", "b:1"], inverse)).toEqual(["sk10", "sk20"]);
});

test("toGrimtoolsSkills returns null, never a partial list, when a star is unmapped", () => {
  expect(toGrimtoolsSkills(["a:0", "zzz:9"], { "a:0": "sk10" })).toBeNull();
});

test("toGrimtoolsSkills of nothing is an empty list", () => {
  expect(toGrimtoolsSkills([], {})).toEqual([]);
});

test("savePayload is the body grimtools' own Share button posts, minus the fields we never set", () => {
  // Captured from the live calculator on 2026-08-16 (spec, "What the investigation established"):
  // a level-100 character with one crossroads star. Quickbars and mouse slots are left empty; the
  // stripped shape saved and rendered identically to the calculator's own.
  expect(savePayload(["sk739"])).toEqual({
    bio: {
      level: 100,
      attributePoints: 109,
      skillPoints: 250,
      devotionPoints: 54,
      physique: 50,
      cunning: 50,
      spirit: 50,
    },
    equipment: {},
    potions: {},
    skills: [{ name: "sk739", level: 1 }],
    itemSkills: [],
    transformSkills: [],
    quickbar: {
      mouse1: { left: null, right: null },
      mouse2: { left: null, right: null },
      quickbar1: [],
      quickbar2: [],
    },
    devotionsProgression: [],
    skillsProgression: [],
  });
});

test("savePayload counts devotionPoints down from grimtools' 55", () => {
  const full = Array.from({ length: 55 }, (_, i) => `sk${i}`);
  expect(savePayload(full).bio.devotionPoints).toBe(0);
  expect(savePayload(full).skills.length).toBe(55);
});

test("the export contract version is a positive integer", () => {
  expect(Number.isInteger(EXPORT_CONTRACT_VERSION) && EXPORT_CONTRACT_VERSION >= 1).toBe(true);
});
