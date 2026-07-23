// ABOUTME: Tests the app menu's pure panel composer: cross-app nav, language list, and About section.
// ABOUTME: The DOM mount is thin glue verified in the browser (e2e); these cover the composed content.
import { test, expect } from "bun:test";
import { appMenuPanelHtml, type AppMenuContent } from "../src/adapters/appMenu";

const content: AppMenuContent = {
  nav: { href: "../", label: "Devotion Planner" },
  languageHeading: "Language",
  current: "de",
  available: ["en", "de", "fr"],
  names: { en: "English", de: "Deutsch", fr: "Français" },
  info: {
    label: "Menu",
    description: "A fan-made RR reference.",
    gameData: "Game data: v1.2.1.x (extracted 2026-07-23)",
    build: { label: "build 19149150", url: "https://steamdb.info/patchnotes/19149150/" },
    github: "View on GitHub",
  },
  githubUrl: "https://github.com/tednaleid/grimdawn-devotions",
};

test("composes the cross-app nav link", () => {
  const html = appMenuPanelHtml(content);
  expect(html).toContain('class="app-menu-nav"');
  expect(html).toContain('href="../"');
  expect(html).toContain("Devotion Planner");
});

test("renders the language heading and one row per locale, current one checked", () => {
  const html = appMenuPanelHtml(content);
  expect(html).toContain("Language");
  expect(html).toContain('data-locale="en"');
  expect(html).toContain('data-locale="de"');
  expect(html).toContain('data-locale="fr"');
  expect(html.match(/aria-checked="true"/g)?.length).toBe(1);
  expect(html).toMatch(/data-locale="de"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-locale="de"/);
});

test("includes the About description, provenance, and GitHub link", () => {
  const html = appMenuPanelHtml(content);
  expect(html).toContain("A fan-made RR reference.");
  expect(html).toContain("Game data: v1.2.1.x (extracted 2026-07-23)");
  expect(html).toContain('href="https://github.com/tednaleid/grimdawn-devotions"');
  expect(html).toContain("View on GitHub");
});

test("escapes the nav label and href", () => {
  const html = appMenuPanelHtml({ ...content, nav: { href: '"><x', label: 'a <b> & "c"' } });
  expect(html).toContain("a &lt;b&gt; &amp; &quot;c&quot;");
  expect(html).not.toContain("<b>");
});
