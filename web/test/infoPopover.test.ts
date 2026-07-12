// ABOUTME: Tests the info popover's pure content helper: the three lines, the optional game-data line,
// ABOUTME: link attributes, and HTML escaping. The DOM mount is thin glue verified in the browser.
import { test, expect } from "bun:test";
import { infoPanelHtml, type InfoPopoverText } from "../src/adapters/infoPopover";

const text: InfoPopoverText = {
  label: "About this planner",
  description: "A fan-made build planner for Grim Dawn's devotion system.",
  gameData: "Game data: v1.2.1.x (extracted 2026-07-01)",
  build: { label: "build 19149150", url: "https://steamdb.info/patchnotes/19149150/" },
  github: "View on GitHub",
};
const URL = "https://github.com/tednaleid/grimdawn-devotions";

test("renders the description, game-data line, and GitHub link with safe attributes", () => {
  const html = infoPanelHtml(text, URL);
  expect(html).toContain("A fan-made build planner for Grim Dawn's devotion system.");
  expect(html).toContain("Game data: v1.2.1.x (extracted 2026-07-01)");
  expect(html).toContain(`href="${URL}"`);
  expect(html).toContain('target="_blank"');
  expect(html).toContain('rel="noopener"');
  expect(html).toContain('href="https://steamdb.info/patchnotes/19149150/"');
  expect(html).toContain("build 19149150");
});

test("omits the provenance line entirely when gameData and build are both null", () => {
  const html = infoPanelHtml({ ...text, gameData: null, build: null }, URL);
  expect(html).not.toContain("info-version");
  expect(html).toContain("View on GitHub"); // the other lines still render
});

test("renders build-only provenance line when gameData is null but build is present", () => {
  expect(infoPanelHtml({ ...text, gameData: null }, URL)).toContain("steamdb.info");
});

test("omits the build link when null, keeps the game-data text", () => {
  const html = infoPanelHtml({ ...text, build: null }, URL);
  expect(html).not.toContain("steamdb.info");
  expect(html).toContain("Game data: v1.2.1.x (extracted 2026-07-01)");
});

test("escapes text content", () => {
  const html = infoPanelHtml({ ...text, description: 'a <b> & "c"' }, URL);
  expect(html).toContain("a &lt;b&gt; &amp; &quot;c&quot;");
  expect(html).not.toContain("<b>");
});
