# i18n Phase 1a: Localization seam + app-owned strings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every app-authored user-facing string through a single localization seam with an English fallback, with zero visible change to the English UI.

**Architecture:** A pure resolver (`core/localization.ts`) turns a key plus params into text via an active-locale then English then raw-key fallback chain. A pure locale picker (`core/locale.ts`) chooses the locale from `navigator.languages`. An adapter (`adapters/localizationAdapter.ts`) fetches the JSON catalogs and installs the resolver as a module singleton that view modules call through `translate()`. Game-data text (constellation and power names, descriptions) is left untouched in this plan and handled in Phase 1b.

**Tech Stack:** TypeScript, Bun (bundler + `bun:test`), vanilla DOM/SVG. No new dependencies.

## Global Constraints

- No hardcoded user-facing strings in app code once migrated; every app string resolves through `translate(key, params?)`.
- Fallback chain is per key: active locale, then English, then the raw key. `translate` never throws and never returns blank.
- English output must be byte-for-byte identical to today (this plan is a refactor, not a behavior change).
- Locale is a viewer preference, never in the URL hash. Selection ids stay language independent.
- Names spelled out, no abbreviations: `translate`, not `t`.
- Interpolation uses named `{placeholder}` tokens only. No ICU plural machinery.
- Match surrounding code style. Every file starts with two `// ABOUTME:` comment lines.
- Available locales in this plan is `["en"]` only. Other locales arrive in Phase 3; the code must not assume the set is exactly `["en"]`.
- Run the web suite with `cd web && bun test` (or `just test`). Run one file with `just test test/<file>`.

---

### Task 1: Localization port + pure resolver

**Files:**
- Create: `web/src/ports/Localization.ts`
- Create: `web/src/core/localization.ts`
- Test: `web/test/localization.test.ts`

**Interfaces:**
- Produces: `interface Localization { translate(key: string, params?: Record<string, string | number>): string; locale: string }` (exported from `ports/Localization.ts`).
- Produces: `makeLocalization(active: Record<string, string>, fallback: Record<string, string>, locale: string): Localization` (from `core/localization.ts`).
- Produces: module singleton accessors `setLocalization(loc: Localization): void` and `translate(key: string, params?: Record<string, string | number>): string` (from `core/localization.ts`). `translate` before `setLocalization` returns the key unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// web/test/localization.test.ts
// ABOUTME: Tests the pure localization resolver: fallback chain, interpolation, singleton accessor.
// ABOUTME: No DOM or fetch; exercises makeLocalization / translate / setLocalization directly.
import { test, expect } from "bun:test";
import { makeLocalization, translate, setLocalization } from "../src/core/localization";

test("prefers the active-locale value", () => {
  const loc = makeLocalization({ "ui.a": "Activo" }, { "ui.a": "Active" }, "es");
  expect(loc.translate("ui.a")).toBe("Activo");
});

test("falls back to English when the active locale lacks the key", () => {
  const loc = makeLocalization({}, { "ui.a": "Active" }, "es");
  expect(loc.translate("ui.a")).toBe("Active");
});

test("falls back to the raw key when neither catalog has it", () => {
  const loc = makeLocalization({}, {}, "es");
  expect(loc.translate("ui.missing")).toBe("ui.missing");
});

test("interpolates named params", () => {
  const loc = makeLocalization({}, { "p.used": "{count} used" }, "en");
  expect(loc.translate("p.used", { count: 3 })).toBe("3 used");
});

test("leaves an unmatched placeholder in place", () => {
  const loc = makeLocalization({}, { "p.x": "{a} and {b}" }, "en");
  expect(loc.translate("p.x", { a: "1" })).toBe("1 and {b}");
});

test("singleton translate returns the key until installed, then resolves", () => {
  expect(translate("ui.a")).toBe("ui.a");
  setLocalization(makeLocalization({}, { "ui.a": "Active" }, "en"));
  expect(translate("ui.a")).toBe("Active");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun test test/localization.test.ts`
Expected: FAIL, cannot resolve `../src/core/localization`.

- [ ] **Step 3: Write the port interface**

```ts
// web/src/ports/Localization.ts
// ABOUTME: Port for resolving app-authored strings to display text in the active locale.
// ABOUTME: Adapters build a Localization; view modules resolve keys through it.
export interface Localization {
  translate(key: string, params?: Record<string, string | number>): string;
  locale: string;
}
```

- [ ] **Step 4: Write the resolver**

```ts
// web/src/core/localization.ts
// ABOUTME: Pure localization resolver: active-locale -> English -> raw-key fallback, named interpolation.
// ABOUTME: Also holds a module singleton so view modules can call translate() without threading a port.
import type { Localization } from "../ports/Localization";

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole));
}

export function makeLocalization(
  active: Record<string, string>,
  fallback: Record<string, string>,
  locale: string,
): Localization {
  return {
    locale,
    translate(key, params) {
      const template = active[key] ?? fallback[key] ?? key;
      return interpolate(template, params);
    },
  };
}

let current: Localization | null = null;
export function setLocalization(loc: Localization): void {
  current = loc;
}
export function translate(key: string, params?: Record<string, string | number>): string {
  return current ? current.translate(key, params) : key;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && bun test test/localization.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/ports/Localization.ts web/src/core/localization.ts web/test/localization.test.ts
git commit -m "feat(i18n): localization port + pure resolver with fallback chain"
```

---

### Task 2: Locale picker

**Files:**
- Create: `web/src/core/locale.ts`
- Test: `web/test/locale.test.ts`

**Interfaces:**
- Produces: `pickLocale(preferred: readonly string[], available: readonly string[]): string`. Matches each preferred tag (case-insensitive, region stripped so `es-ES` matches `es`) against `available` in order; returns the first match, else `"en"`.

- [ ] **Step 1: Write the failing test**

```ts
// web/test/locale.test.ts
// ABOUTME: Tests locale selection from an ordered preference list against the shipped set.
// ABOUTME: Region stripping, order, and the English default.
import { test, expect } from "bun:test";
import { pickLocale } from "../src/core/locale";

test("picks the first preferred that is available", () => {
  expect(pickLocale(["de-DE", "en-US"], ["en", "de", "es"])).toBe("de");
});

test("strips region and matches the base language", () => {
  expect(pickLocale(["es-419"], ["en", "es"])).toBe("es");
});

test("skips unavailable preferences in order", () => {
  expect(pickLocale(["ja", "ru", "fr"], ["en", "fr"])).toBe("fr");
});

test("defaults to en when nothing matches", () => {
  expect(pickLocale(["zh"], ["en", "de"])).toBe("en");
});

test("defaults to en for an empty preference list", () => {
  expect(pickLocale([], ["en", "de"])).toBe("en");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun test test/locale.test.ts`
Expected: FAIL, cannot resolve `../src/core/locale`.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/core/locale.ts
// ABOUTME: Chooses the active locale from an ordered preference list against the shipped locales.
// ABOUTME: Pure; the adapter feeds it navigator.languages and the available set.
export function pickLocale(preferred: readonly string[], available: readonly string[]): string {
  const set = new Set(available.map((a) => a.toLowerCase()));
  for (const pref of preferred) {
    const base = pref.toLowerCase().split("-")[0];
    if (set.has(base)) return base;
  }
  return "en";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun test test/locale.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/locale.ts web/test/locale.test.ts
git commit -m "feat(i18n): pure locale picker over navigator.languages"
```

---

### Task 3: English catalog + localization adapter

**Files:**
- Create: `web/src/i18n/app.en.json`
- Create: `web/src/adapters/localizationAdapter.ts`
- Test: `web/test/localizationAdapter.test.ts`

**Interfaces:**
- Consumes: `makeLocalization`, `setLocalization` (Task 1), `pickLocale` (Task 2).
- Produces: `loadLocalization(opts: { base?: string; available?: readonly string[]; preferred?: readonly string[]; fetchImpl?: typeof fetch }): Promise<Localization>`. Detects locale via `pickLocale(preferred ?? navigator.languages, available ?? ["en"])`, fetches `${base}/i18n/app.en.json` and (if locale is not `en`) `${base}/i18n/app.<locale>.json`, builds a `Localization`, calls `setLocalization`, and returns it. A failed or missing fetch degrades to an empty catalog (so `translate` falls through to English then key). `base` defaults to `"."`; `fetchImpl` defaults to global `fetch` and exists for tests.

**Note on the catalog:** `app.en.json` starts as an empty object `{}` here and is filled by Tasks 4 through 9. Keeping it present now lets the adapter and its test exist independently.

- [ ] **Step 1: Create the empty English catalog**

```json
{}
```

Save as `web/src/i18n/app.en.json`.

- [ ] **Step 2: Write the failing test**

```ts
// web/test/localizationAdapter.test.ts
// ABOUTME: Tests the localization adapter: locale detection, catalog fetch, and degrade-on-failure.
// ABOUTME: Injects a fake fetch and preferred list; never touches the network or the DOM.
import { test, expect } from "bun:test";
import { loadLocalization } from "../src/adapters/localizationAdapter";
import { translate } from "../src/core/localization";

function fakeFetch(map: Record<string, unknown>): typeof fetch {
  return (async (url: string) => {
    const key = Object.keys(map).find((k) => String(url).includes(k));
    if (key === undefined) return { ok: false, json: async () => ({}) } as Response;
    return { ok: true, json: async () => map[key] } as Response;
  }) as unknown as typeof fetch;
}

test("loads English and resolves a key", async () => {
  const loc = await loadLocalization({
    available: ["en"],
    preferred: ["en"],
    fetchImpl: fakeFetch({ "app.en.json": { "ui.a": "Active" } }),
  });
  expect(loc.locale).toBe("en");
  expect(loc.translate("ui.a")).toBe("Active");
  expect(translate("ui.a")).toBe("Active"); // singleton installed
});

test("degrades to English fallback when the active-locale file is missing", async () => {
  const loc = await loadLocalization({
    available: ["en", "de"],
    preferred: ["de"],
    fetchImpl: fakeFetch({ "app.en.json": { "ui.a": "Active" } }), // no app.de.json
  });
  expect(loc.locale).toBe("de");
  expect(loc.translate("ui.a")).toBe("Active");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && bun test test/localizationAdapter.test.ts`
Expected: FAIL, cannot resolve `../src/adapters/localizationAdapter`.

- [ ] **Step 4: Write the adapter**

```ts
// web/src/adapters/localizationAdapter.ts
// ABOUTME: Loads app.<locale>.json catalogs, detects the locale, and installs the resolver singleton.
// ABOUTME: Degrades to English then raw keys if a catalog is missing; the UI never blocks on i18n.
import { makeLocalization, setLocalization } from "../core/localization";
import { pickLocale } from "../core/locale";
import type { Localization } from "../ports/Localization";

async function getJson(fetchImpl: typeof fetch, url: string): Promise<Record<string, string>> {
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return {};
    return (await res.json()) as Record<string, string>;
  } catch {
    return {};
  }
}

export async function loadLocalization(opts: {
  base?: string;
  available?: readonly string[];
  preferred?: readonly string[];
  fetchImpl?: typeof fetch;
} = {}): Promise<Localization> {
  const base = opts.base ?? ".";
  const available = opts.available ?? ["en"];
  const preferred = opts.preferred ?? (typeof navigator !== "undefined" ? navigator.languages : ["en"]);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const locale = pickLocale(preferred, available);
  const fallback = await getJson(fetchImpl, `${base}/i18n/app.en.json`);
  const active = locale === "en" ? fallback : await getJson(fetchImpl, `${base}/i18n/app.${locale}.json`);
  const loc = makeLocalization(active, fallback, locale);
  setLocalization(loc);
  return loc;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && bun test test/localizationAdapter.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Ship the catalogs as static files the adapter can fetch**

The adapter fetches `${base}/i18n/app.<locale>.json` at runtime, so the catalogs must be copied into `web/dist` alongside the bundle (the same way the `build` recipe copies `data/` and `assets/`). The catalogs are NOT bundled into JS (only the needed locale should load, not all 13).

In `justfile`, in the `build` recipe, next to the existing `cp -r ".../assets" dist/assets` line, add:

```bash
    cp -r "{{justfile_directory()}}/web/src/i18n" dist/i18n
```

Cache note: `data/*` fetches use `?v=<buildId>` for cache-busting. A stale catalog only shows slightly old English text (never breaks, thanks to the fallback), so matching `?v=` on the i18n fetch is a nice-to-have, not required for 1a; leave it out unless a stale-text issue appears.

Run: `just build`
Expected: build succeeds and `web/dist/i18n/app.en.json` exists.

- [ ] **Step 7: Commit**

```bash
git add web/src/i18n/app.en.json web/src/adapters/localizationAdapter.ts web/test/localizationAdapter.test.ts justfile
git commit -m "feat(i18n): catalog-loading adapter with locale detection and degrade path"
```

---

### Task 4: Migrate the HTML shell + header labels

**Files:**
- Modify: `web/index.html` (lines 8, 25, 31-34, 39, 43-44)
- Modify: `web/src/app/main.ts` (boot wiring near line 51; header label writes near lines 350-351, 495-521)
- Modify: `web/src/i18n/app.en.json`
- Test: `web/test/appCatalog.test.ts`

**Interfaces:**
- Consumes: `loadLocalization` (Task 3), `translate` (Task 1).
- Produces: nothing new; establishes that `main.ts` awaits `loadLocalization` immediately after data load and before the first render, and that static header text is rewritten from the catalog on boot.

**Approach:** `index.html` keeps its current English text as the pre-boot default (so a fetch failure still shows English). `main.ts` overwrites the header/labels from the catalog right after `loadLocalization`, so the same strings flow through i18n. Elements already have ids (`#total-word`, `#reset-points`, `#cap-toggle`, `.plabel`, drawer buttons).

- [ ] **Step 1: Add the chrome keys to the catalog**

Set `web/src/i18n/app.en.json` to:

```json
{
  "ui.title": "Grim Dawn Devotion Planner",
  "ui.boot.failed": "Couldn't load the planner.",
  "ui.boot.reload": "Reload",
  "ui.boot.loading": "Loading the devotion map…",
  "ui.points.label": "Points",
  "ui.points.budgetAria": "Point budget",
  "ui.points.capRemoveTitle": "Click to remove the point limit",
  "ui.points.capRestoreTitle": "Click to restore the 55-point limit",
  "ui.points.total": "total",
  "ui.points.reset": "Reset",
  "ui.points.used": "{count} used",
  "ui.points.min": "{count} min",
  "ui.drawer.benefitsAria": "Show benefits",
  "ui.drawer.benefits": "Benefits",
  "ui.drawer.affinityAria": "Show affinity",
  "ui.drawer.affinity": "Affinity"
}
```

- [ ] **Step 2: Write the failing guard test**

```ts
// web/test/appCatalog.test.ts
// ABOUTME: Guards that keys referenced by the app exist in app.en.json, so a missing key fails CI not runtime.
// ABOUTME: Grows as more views migrate; each migration adds its keys here.
import { test, expect } from "bun:test";
import en from "../src/i18n/app.en.json";

const REQUIRED = [
  "ui.title", "ui.boot.failed", "ui.boot.reload", "ui.boot.loading",
  "ui.points.label", "ui.points.budgetAria", "ui.points.capRemoveTitle",
  "ui.points.capRestoreTitle", "ui.points.total", "ui.points.reset",
  "ui.points.used", "ui.points.min",
  "ui.drawer.benefitsAria", "ui.drawer.benefits", "ui.drawer.affinityAria", "ui.drawer.affinity",
];

test("every required chrome key exists in app.en.json", () => {
  const cat = en as Record<string, string>;
  for (const key of REQUIRED) expect(cat[key]).toBeDefined();
});
```

- [ ] **Step 3: Run test to verify it fails, then passes after Step 1**

Run: `cd web && bun test test/appCatalog.test.ts`
Expected: PASS once Step 1 is saved (the test asserts the catalog Step 1 wrote). If it fails, a key is missing or misspelled; fix the JSON.

- [ ] **Step 4: Load localization in boot before the first render**

In `web/src/app/main.ts`, add the import near the other adapter imports (line 3 area):

```ts
import { loadLocalization } from "../adapters/localizationAdapter";
import { translate } from "../core/localization";
```

Immediately after `const data = await httpDataSource(".").load();` (line 51), add:

```ts
  await loadLocalization({ base: ".", available: ["en"] });
```

- [ ] **Step 5: Rewrite the static header/labels from the catalog**

Still in `main.ts`, after the element lookups (after line 113), add:

```ts
  document.title = translate("ui.title");
  (document.querySelector(".plabel") as HTMLElement).textContent = translate("ui.points.label");
  totalWord.textContent = ` ${translate("ui.points.total")}`;
  resetPointsBtn.textContent = translate("ui.points.reset");
  leftBtn.setAttribute("aria-label", translate("ui.drawer.benefitsAria"));
  rightBtn.setAttribute("aria-label", translate("ui.drawer.affinityAria"));
```

Replace the hardcoded `${used} used` and `${curMin} min` (lines 350-351) with:

```ts
  translate("ui.points.used", { count: used });
  translate("ui.points.min", { count: curMin });
```

Replace the cap-toggle titles (lines 520-521) with `translate("ui.points.capRemoveTitle")` / `translate("ui.points.capRestoreTitle")`, and the section headers at lines 495/497/502 with `translate("ui.panel.availableToGet")` / `translate("ui.panel.petBonus")` / `translate("ui.panel.celestialPowers")` (these three keys are added in Task 5, which owns the sidebar; add them to `app.en.json` and `REQUIRED` now so this compiles: `"ui.panel.availableToGet": "Available to get"`, `"ui.panel.petBonus": "Bonus to All Pets"`, `"ui.panel.celestialPowers": "Celestial Powers"`).

- [ ] **Step 6: Run the full suite and typecheck**

Run: `cd web && bun test && bunx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add web/index.html web/src/app/main.ts web/src/i18n/app.en.json web/test/appCatalog.test.ts
git commit -m "feat(i18n): route HTML shell and header labels through the catalog"
```

---

### Task 5: Migrate `sidebarView.ts`

**Files:**
- Modify: `web/src/adapters/sidebarView.ts` (lines 162-222)
- Modify: `web/src/i18n/app.en.json`
- Modify: `web/test/appCatalog.test.ts`

**Interfaces:**
- Consumes: `translate` (Task 1).
- Produces: unchanged export signatures (`renderBenefits`, `renderAffinities`, `powersListHtml`); internals resolve through `translate`.

- [ ] **Step 1: Add the sidebar keys to `app.en.json`**

Add:

```json
  "ui.panel.benefits": "Benefits",
  "ui.panel.affinity": "Affinity",
  "ui.compare.banner": "Comparing to baseline",
  "ui.compare.revert": "Revert",
  "ui.compare.updateBaseline": "Update Baseline",
  "ui.compare.setBaseline": "Set baseline",
  "ui.compare.base": "Base",
  "ui.compare.now": "Now",
  "ui.compare.delta": "Δ",
  "ui.benefits.empty": "Select stars to gain benefits.",
  "ui.affinity.have": "have",
  "ui.affinity.need": "need",
  "ui.affinity.neededBy": "needed by {names}"
```

(The `ui.panel.availableToGet`, `ui.panel.petBonus`, `ui.panel.celestialPowers` keys were added in Task 4.)

- [ ] **Step 2: Add these keys to the guard test**

Append the 13 keys above to `REQUIRED` in `web/test/appCatalog.test.ts`.

- [ ] **Step 3: Replace the literals**

In `web/src/adapters/sidebarView.ts`, import at the top (below the ABOUTME lines):

```ts
import { translate } from "../core/localization";
```

Replace each literal with a `translate(...)` call. Concretely: the `.cmp-bar` banner text becomes `translate("ui.compare.banner")` (line 162); the buttons at 165-166 become `translate("ui.compare.revert")` and `translate("ui.compare.updateBaseline")`; the column headers at 167 become `translate("ui.compare.base")`, `translate("ui.compare.now")`, `translate("ui.compare.delta")`; the panel `<h2>` at 169/175 becomes `translate("ui.panel.benefits")`; the pet/powers headers at 171/177 and 172/178 become `translate("ui.panel.petBonus")` and `translate("ui.panel.celestialPowers")`; the empty-state at 170/176 becomes `translate("ui.benefits.empty")`; the `#set-baseline` label at 175 becomes `translate("ui.compare.setBaseline")`; the affinity `<h2>` and headers at 222 become `translate("ui.panel.affinity")`, `translate("ui.affinity.have")`, `translate("ui.affinity.need")`; the `needed by ${names}` title at 212 becomes `translate("ui.affinity.neededBy", { names })`.

Leave the lowercase affinity row label `${a}` at line 220 as is for now; affinity display names are handled in Task 8 with the shared `aff.*` keys.

- [ ] **Step 4: Run and verify identical English output**

Run: `cd web && bun test && bunx tsc --noEmit`
Expected: PASS. Existing sidebar tests (if any assert text) still pass because the English resolves to the same strings.

- [ ] **Step 5: Commit**

```bash
git add web/src/adapters/sidebarView.ts web/src/i18n/app.en.json web/test/appCatalog.test.ts
git commit -m "feat(i18n): route sidebar (benefits + affinity) text through the catalog"
```

---

### Task 6: Migrate `tooltipView.ts`

**Files:**
- Modify: `web/src/adapters/tooltipView.ts` (lines 24, 37, 68, 76, 78, 104-105, 169, 174-175, 188)
- Modify: `web/src/i18n/app.en.json`
- Modify: `web/test/appCatalog.test.ts`

**Interfaces:**
- Consumes: `translate` (Task 1).
- Produces: unchanged `tooltipView(el)` signature.

- [ ] **Step 1: Add tooltip keys to `app.en.json`**

```json
  "ui.tooltip.petBonus": "Bonus to All Pets",
  "ui.tooltip.currentLevel": "Current Level: {level}",
  "ui.tooltip.procQualifier": "({chance}% Chance on {trigger})",
  "ui.tooltip.requires": "Requires: ",
  "ui.tooltip.grants": "Grants: ",
  "ui.tooltip.pts": "{count} pts",
  "ui.tooltip.needsPoints": "Needs {needs} of your {cap} points",
  "ui.tooltip.cannotComplete": "Cannot be completed within {cap} points",
  "ui.tooltip.partialGate": "Some bonuses require {req}"
```

Note: `ui.tooltip.petBonus` duplicates the sidebar `ui.panel.petBonus` value but is a distinct call site; keep it separate so translators can diverge if a language needs it.

- [ ] **Step 2: Add these 9 keys to the guard test `REQUIRED` list.**

- [ ] **Step 3: Replace the literals**

Import `translate` at the top. Then: line 68 pet sub-header becomes `translate("ui.tooltip.petBonus")`; line 78 becomes `translate("ui.tooltip.currentLevel", { level: power.level })`; line 76 proc qualifier becomes `translate("ui.tooltip.procQualifier", { chance, trigger })` (the `trigger` value still comes from data in this plan; Phase 1b localizes it); lines 104-105 become `translate("ui.tooltip.requires")` / `translate("ui.tooltip.grants")`; line 169 becomes `translate("ui.tooltip.pts", { count: con.starIds.length })`; lines 174-175 become `translate("ui.tooltip.needsPoints", { needs: dim.needs, cap: dim.cap })` / `translate("ui.tooltip.cannotComplete", { cap: dim.cap })`; line 188 becomes `translate("ui.tooltip.partialGate", { req })` where `req` is the existing interpolated requirement expression. Lines 24/37 affinity orb labels keep `${a}` for now (Task 8 handles `aff.*`).

- [ ] **Step 4: Run and verify**

Run: `cd web && bun test && bunx tsc --noEmit`
Expected: PASS. `web/test/tooltip-weapon-req.test.ts` still passes (English unchanged).

- [ ] **Step 5: Commit**

```bash
git add web/src/adapters/tooltipView.ts web/src/i18n/app.en.json web/test/appCatalog.test.ts
git commit -m "feat(i18n): route tooltip text through the catalog"
```

---

### Task 7: Migrate `buildOrderView.ts`

**Files:**
- Modify: `web/src/adapters/buildOrderView.ts` (lines 11, 15-21, 36-38, 52-90)
- Modify: `web/src/i18n/app.en.json`
- Modify: `web/test/appCatalog.test.ts`

**Interfaces:**
- Consumes: `translate` (Task 1).
- Produces: unchanged `buildOrderHtml` export.

- [ ] **Step 1: Add build-order keys to `app.en.json`**

```json
  "ui.panel.buildOrder": "Build order",
  "ui.buildOrder.crossroads": "Crossroads",
  "ui.buildOrder.dir.n": "N",
  "ui.buildOrder.dir.nw": "NW",
  "ui.buildOrder.dir.ne": "NE",
  "ui.buildOrder.dir.sw": "SW",
  "ui.buildOrder.dir.se": "SE",
  "ui.buildOrder.add": "Add",
  "ui.buildOrder.refund": "Refund",
  "ui.buildOrder.deficitMore": "{count} more {affinity}",
  "ui.buildOrder.deficitJoin": " and ",
  "ui.buildOrder.incompleteAffinity": "Incomplete build: needs {deficit} affinity.",
  "ui.buildOrder.addSupporting": "Add supporting constellations that grant it.",
  "ui.buildOrder.noPathCap": "No path to this build in fewer than {minCap} points.",
  "ui.buildOrder.scaffoldingNote": "Assembling it needs transient scaffolding that pushes the running total past your cap.",
  "ui.buildOrder.noLegalPath": "No legal path to this build exists.",
  "ui.buildOrder.selectPrompt": "Select a self-covering build to see its order."
}
```

- [ ] **Step 2: Add these 17 keys to the guard test `REQUIRED` list.**

- [ ] **Step 3: Replace the literals**

Import `translate`. The capitalized affinity display array at line 11 is replaced by resolving `aff.<name>` keys (added in Task 8); for this task, reference `translate("aff." + name.toLowerCase())` at the deficit call site and add the `aff.*` keys now if Task 8 has not run yet (they are: `"aff.ascendant": "Ascendant"`, `"aff.chaos": "Chaos"`, `"aff.eldritch": "Eldritch"`, `"aff.order": "Order"`, `"aff.primordial": "Primordial"`). The cardinal labels at 15-21 become `translate("ui.buildOrder.dir.n")` etc. The deficit fragment at 36 becomes `translate("ui.buildOrder.deficitMore", { count: d, affinity: translate("aff." + AFFINITY[i].toLowerCase()) })`; the join at 38 becomes `translate("ui.buildOrder.deficitJoin")`. The empty-state messages at 52/53/57/58/59/62 become the matching `ui.buildOrder.*` keys with params (`incompleteAffinity` takes `{ deficit }`, `noPathCap` takes `{ minCap }`). The panel `<h2>` at 64/90 becomes `translate("ui.panel.buildOrder")`. The fallback name at 71 becomes `translate("ui.buildOrder.crossroads")`. The step labels at 83 become `translate("ui.buildOrder.add")` / `translate("ui.buildOrder.refund")`.

- [ ] **Step 4: Run and verify**

Run: `cd web && bun test && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/adapters/buildOrderView.ts web/src/i18n/app.en.json web/test/appCatalog.test.ts
git commit -m "feat(i18n): route build-order panel text through the catalog"
```

---

### Task 8: Migrate `commitAction.ts`, `benefitRows.ts`, and shared affinity names

**Files:**
- Modify: `web/src/core/commitAction.ts` (lines 19-26)
- Modify: `web/src/core/benefitRows.ts` (lines 30, 51-53, 116-121, 128)
- Modify: `web/src/adapters/sidebarView.ts` (line 220) and `web/src/adapters/tooltipView.ts` (lines 24, 37) to resolve affinity names via `aff.*`
- Modify: `web/src/i18n/app.en.json`
- Modify: `web/test/appCatalog.test.ts`

**Interfaces:**
- Consumes: `translate` (Task 1).
- Produces: unchanged exports (`commitButton`, benefit-row builders).

- [ ] **Step 1: Add remaining keys to `app.en.json`**

Ensure the five `aff.*` keys from Task 7 are present, then add:

```json
  "ui.commit.add": "Add",
  "ui.commit.remove": "Remove",
  "ui.benefit.max": "max",
  "ui.benefit.duration": "duration",
  "ui.benefit.maxPrefix": "max {subject}",
  "ui.benefit.seconds": "{value}s"
```

The `—` em-dash placeholder (`benefitRows.ts` line 30 `DASH`) is a symbol, not language; leave it as the literal constant, not a catalog key.

- [ ] **Step 2: Add the new keys to the guard test `REQUIRED` list.**

- [ ] **Step 3: Replace the literals**

`commitAction.ts`: import `translate`; lines 19-20 and 25-26 `"Remove"`/`"Add"` become `translate("ui.commit.remove")` / `translate("ui.commit.add")`.

`benefitRows.ts`: import `translate`; the `${value}s` at 51/53 becomes `translate("ui.benefit.seconds", { value })`; the `"max"` / `"duration"` sub-labels at 116-121 become `translate("ui.benefit.max")` / `translate("ui.benefit.duration")`; the `max ${s}` prefix at 128 becomes `translate("ui.benefit.maxPrefix", { subject: s })`.

Affinity names: in `sidebarView.ts` line 220 render `translate("aff." + a)` instead of the bare `${a}`, and in `tooltipView.ts` lines 24/37 wrap the affinity name the same way. `a` is already the lowercase key (`ascendant`, `chaos`, ...), matching the `aff.<name>` keys.

- [ ] **Step 4: Run and verify**

Run: `cd web && bun test && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/commitAction.ts web/src/core/benefitRows.ts web/src/adapters/sidebarView.ts web/src/adapters/tooltipView.ts web/src/i18n/app.en.json web/test/appCatalog.test.ts
git commit -m "feat(i18n): route commit buttons, benefit rows, and affinity names through the catalog"
```

---

### Task 9: Migrate `statFormat.ts` labels into the catalog

**Files:**
- Modify: `web/src/core/statFormat.ts` (the `INSTANT_DAMAGE`, `DOT_DAMAGE`, `RESIST`, `ATTR`, `OVERRIDES`, `GROUP_ORDER`, `RACE_LABEL`, power-stat and pet formatting label strings)
- Modify: `web/src/i18n/app.en.json`
- Modify: `web/test/appCatalog.test.ts`
- Reference: existing `web/test/statFormat.test.ts` (must still pass unchanged)

**Interfaces:**
- Consumes: `translate` (Task 1).
- Produces: unchanged exports (`condensedRows`, `formatPowerStats`, etc.); English output identical.

**Approach:** This is the largest single surface (~150 strings). Keep the dictionaries' shapes and keys; change only the display values to be resolved through `translate` with a `stat.` namespace. The English values move verbatim into `app.en.json`. Because `statFormat.test.ts` asserts exact English strings, a passing suite proves the migration preserved output.

- [ ] **Step 1: Add the `stat.*` keys to `app.en.json`**

For each entry currently mapping an id-segment to an English label, add a catalog key. Use a stable key derived from the map plus the segment. Damage: `stat.damage.<Segment>` (for example `"stat.damage.Poison": "Acid"`, `"stat.damage.Life": "Vitality"`). DoT: `stat.dot.<Segment>` (`"stat.dot.Cold": "Frostburn"`, `"stat.dot.Fire": "Burn"`, `"stat.dot.Physical": "Internal Trauma"`, `"stat.dot.Lightning": "Electrocute"`, `"stat.dot.Life": "Vitality Decay"`). Resist: `stat.resist.<Segment>` (`"stat.resist.Poison": "Poison & Acid"`). Attributes: `stat.attr.<Segment>` (`"stat.attr.Strength": "Physique"`, `"stat.attr.Dexterity": "Cunning"`, `"stat.attr.Intelligence": "Spirit"`, `"stat.attr.Life": "Health"`, `"stat.attr.Mana": "Energy"`, and the ability/regen labels). Overrides: `stat.override.<statId>` (for example `"stat.override.defensiveAbsorptionModifier": "Armor Absorption"`). Groups: `stat.group.<key>` (`"stat.group.offense": "Offense"`, ... the nine `GROUP_ORDER` headers). Races: `stat.race.<Race>` (`"stat.race.Beast": "Beasts"`). Power-stat and pet labels: `stat.power.<key>` and `stat.pet.<key>` for each literal in `formatPowerStats` / `formatPet` (for example `"stat.power.projectiles": "Projectile(s)"`, `"stat.pet.summons": "Summons {num}{name}{dur}"`). Enumerate one key per distinct English literal in the file. Keep the `humanize()` word-substitution behavior as an English-only last resort (it operates on unmapped ids and stays as code, not catalog).

- [ ] **Step 2: Add a coverage assertion to the guard test**

In `web/test/appCatalog.test.ts`, add:

```ts
import en from "../src/i18n/app.en.json";
test("stat keys referenced by statFormat exist", () => {
  const cat = en as Record<string, string>;
  for (const key of ["stat.dot.Cold", "stat.attr.Strength", "stat.group.offense", "stat.override.defensiveAbsorptionModifier"])
    expect(cat[key]).toBeDefined();
});
```

- [ ] **Step 3: Resolve the dictionaries through `translate`**

Import `translate` in `statFormat.ts`. Change each dictionary from `Record<string, string>` of English values to resolve at use through `translate`. Two mechanical options; pick the one that keeps each map's call sites smallest:
- Replace the map value with the catalog key and wrap reads in `translate(...)`; or
- Keep the map keyed by segment and compute `translate("stat.damage." + segment)` at the read site, deleting the English from the map.

Apply consistently. For `OVERRIDES` (which carries `{ label, percent, sign }`), keep `percent`/`sign` and replace `label` with a key read `translate("stat.override." + id)`. For `GROUP_ORDER` headers, resolve each header via `translate("stat.group." + key)` at render.

- [ ] **Step 4: Run the existing statFormat suite (the real regression gate)**

Run: `cd web && bun test test/statFormat.test.ts`
Expected: PASS with no changes to the test file. This proves English output is byte-identical.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `cd web && bun test && bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/core/statFormat.ts web/src/i18n/app.en.json web/test/appCatalog.test.ts
git commit -m "feat(i18n): route statFormat labels through the catalog (English identical)"
```

---

### Task 10: Full-app verification and docs

**Files:**
- Modify: `CLAUDE.md`
- Create: `docs/i18n.md`
- Modify: `BACKLOG.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the i18n invariant and reference doc.

- [ ] **Step 1: Run the whole gate**

Run: `just check`
Expected: format clean, lint clean, `bunx tsc --noEmit` clean, `bun test` all pass.

- [ ] **Step 2: Manual smoke (English unchanged)**

Run: `just serve`, open http://localhost:5173. Confirm the header ("Points", "Reset", drawer labels), the Benefits and Affinity panels, a constellation tooltip, and a build-order render all read exactly as before. This is the "no visible change" acceptance check.

- [ ] **Step 3: Add the i18n invariant to `CLAUDE.md`**

Add a section:

```markdown
## Internationalization (invariant we maintain)

This is a fully internationalized app. No user-facing string is hardcoded in app
code: every app-authored string resolves through `translate(key, params?)` against
`web/src/i18n/app.<locale>.json`, with a per-key fallback of active locale, then
English, then the raw key. Game-data text resolves from extracted per-language tag
tables (authoritative, see docs/i18n.md). Locale is a viewer preference detected
from the browser and is never in the URL hash; selection ids stay language
independent. When you add a user-facing string, add a catalog key (never a literal)
and add it to the `web/test/appCatalog.test.ts` guard.
```

- [ ] **Step 4: Write `docs/i18n.md`**

Create an evergreen reference describing: the `Localization` port and `translate`/`gameText`; the three catalog artifacts (`app.<locale>.json` authored, `game.<locale>.json` extracted in Phase 1b, `stat-tags.json` in Phase 2); the fallback chain; locale detection via `navigator.languages`; and how to add a language. Keep it current, not a changelog.

- [ ] **Step 5: Log the deferred items to `BACKLOG.md`**

Add: a visible language picker (non-breaking, locale not in hash); ICU plural handling if a target language needs it; Phase 1b (parser tag-preservation + `gameText`), Phase 2 (stat spike + `stat-tags.json`), Phase 3 (extract all 13 game tables + author `app.<locale>.json`).

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/i18n.md BACKLOG.md
git commit -m "docs(i18n): invariant in CLAUDE.md, i18n reference, backlog follow-ons"
```

---

## Self-Review

**Spec coverage (Phase 1a scope):**
- Single Localization port, `translate` naming, per-key fallback chain: Tasks 1, 3. Covered.
- `core/` stays language independent; adapters resolve text: resolver + picker are pure in `core/`; fetch is in the adapter. Covered.
- App-owned strings externalized (chrome + statFormat): Tasks 4-9 cover every file from the inventory (`index.html`, `main.ts`, `sidebarView`, `tooltipView`, `buildOrderView`, `commitAction`, `benefitRows`, `statFormat`). Covered.
- Locale auto-detected from `navigator.languages`, not in the hash: Tasks 2, 3. Covered.
- No visible change for English: Task 9 Step 4 (statFormat suite unchanged) and Task 10 Step 2 (manual smoke). Covered.
- CLAUDE.md invariant + docs/i18n.md: Task 10. Covered.
- Deferred: game-data tags + `gameText` (Phase 1b), stat-tag map (Phase 2), all languages (Phase 3), picker + plurals (backlog). Explicitly out of scope; logged in Task 10 Step 5.

**Placeholder scan:** No "TBD"/"TODO". Task 9 enumerates the key-derivation scheme concretely rather than pasting all ~150 lines; the pattern and representative keys are given, and the existing `statFormat.test.ts` is the exact-output gate.

**Type consistency:** `Localization` (translate + locale) is defined in Task 1 and consumed in Task 3; `makeLocalization`/`setLocalization`/`translate` signatures match across Tasks 1, 3, 4. `pickLocale(preferred, available)` signature matches between Task 2 and its use in Task 3. `loadLocalization(opts)` matches between Task 3 and Task 4. `gameText` is intentionally absent here and added in Phase 1b.

**Note:** `gameText` from the approved port design is deferred to Phase 1b (it has no consumer until game data carries tags). Adding a method to the interface later is non-breaking.
