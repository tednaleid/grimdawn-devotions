# Header Info Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An (i) button in the header opens a popover with a one-line description of the planner, the game-data version and extract date read from the dataset, and a GitHub link.

**Architecture:** Meta is plumbed from `devotions.json` through `httpDataSource.load()` as a new `LoadedData.meta`; a new pure-DOM adapter `infoPopover.ts` mirrors the language picker (pure content helper + thin mount); `main.ts` mounts it before the language picker and re-renders its text on locale switch. Spec: `docs/superpowers/specs/2026-07-12-info-popover-design.md`.

**Tech Stack:** Vanilla TypeScript + DOM, bun:test, `just` recipes.

## Global Constraints

- Work on a feature branch off `main`: `git checkout -b info-popover` before Task 1; merging back is decided at the end (superpowers:finishing-a-development-branch), not in this plan.
- Every new code file starts with two `// ABOUTME: ` comment lines.
- No user-facing string literals in app code: the five catalog keys below, in `app.en.json` AND all 12 other locale files, guarded by `web/test/appCatalog.test.ts`. The GitHub URL and the version/date values are data, not catalog text.
- The GitHub URL constant: `https://github.com/tednaleid/grimdawn-devotions`
- Use `just` recipes from the repo root: `just test [file]`, `just check`, `just serve`.
- The pre-commit hook runs the full check suite (~90 seconds); do not use `--no-verify`.
- Match surrounding code style (biome-enforced). No emojis or em-dashes in any prose.
- Commit messages end with the line: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## File structure

| File | Change |
| --- | --- |
| `web/src/ports/DataSource.ts` | `DataMeta` interface; `LoadedData.meta` |
| `web/src/core/model.ts` | `DevotionsDoc` gains optional `meta` |
| `web/src/adapters/httpDataSource.ts` | `metaFromDoc` + return `meta` |
| `web/src/adapters/infoPopover.ts` | New adapter: `infoPanelHtml` + `mountInfoPopover` |
| `web/src/app/main.ts` | Mount + `infoText()` + locale-switch re-render |
| `web/src/styles.css` | `.info-popover` / `.info-btn` / `.info-panel` rules |
| `web/src/i18n/app.*.json` (13 files) | Five `ui.info.*` keys |
| `web/test/dataMeta.test.ts` | New: `metaFromDoc` tests |
| `web/test/infoPopover.test.ts` | New: `infoPanelHtml` tests |
| `web/test/appCatalog.test.ts` | Five `REQUIRED` entries |

---

### Task 1: Meta plumbing (`DataMeta` through the DataSource port)

**Files:**
- Modify: `web/src/ports/DataSource.ts` (the `LoadedData` interface, line ~19)
- Modify: `web/src/core/model.ts` (the `DevotionsDoc` interface, line ~36)
- Modify: `web/src/adapters/httpDataSource.ts` (new export + the `return` at line ~60)
- Create: `web/test/dataMeta.test.ts`

**Interfaces:**
- Produces: `DataMeta { gameVersion: string; generatedUtc: string }` exported from `web/src/ports/DataSource.ts`; `LoadedData.meta: DataMeta`; `export function metaFromDoc(doc: DevotionsDoc): DataMeta` from `httpDataSource.ts`. Task 4 reads `data.meta.gameVersion` / `data.meta.generatedUtc` in `main.ts`.

- [ ] **Step 1: Write the failing test**

Create `web/test/dataMeta.test.ts`:

```ts
// ABOUTME: Tests metaFromDoc - the dataset provenance mapping (game version + extraction timestamp)
// ABOUTME: with empty-string fallbacks so stale or hand-built datasets degrade instead of throwing.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { metaFromDoc } from "../src/adapters/httpDataSource";

test("metaFromDoc reads game_version and generated_utc from the real dataset", () => {
  const meta = metaFromDoc(doc as any);
  expect(meta.gameVersion).toMatch(/^\d+\.\d+/); // "1.2.1.x" today; re-stamped by the parser on patches
  expect(meta.generatedUtc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

test("metaFromDoc falls back to empty strings when meta is absent or partial", () => {
  expect(metaFromDoc({ constellations: [] } as any)).toEqual({ gameVersion: "", generatedUtc: "" });
  expect(metaFromDoc({ constellations: [], meta: { game_version: "1.3.0" } } as any)).toEqual({
    gameVersion: "1.3.0",
    generatedUtc: "",
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `just test test/dataMeta.test.ts`
Expected: FAIL - `metaFromDoc` is not exported.

- [ ] **Step 3: Implement**

In `web/src/ports/DataSource.ts`, after the `AssetManifest` interface:

```ts
/** Dataset provenance stamped by the parser; empty strings when the dataset carries no meta. */
export interface DataMeta {
  gameVersion: string; // e.g. "1.2.1.x"
  generatedUtc: string; // ISO extraction timestamp, e.g. "2026-07-01T05:46:25Z"
}
```

Add to `LoadedData`:

```ts
  meta: DataMeta;
```

In `web/src/core/model.ts`, add to `DevotionsDoc`:

```ts
export interface DevotionsDoc {
  meta?: { game_version?: string; generated_utc?: string };
  constellations: RawConstellation[];
}
```

In `web/src/adapters/httpDataSource.ts`, import the type (`import type { AssetManifest, DataMeta, DataSource, LoadedData } from "../ports/DataSource";`), add above `httpDataSource`:

```ts
/** The dataset provenance for the info popover; missing fields become empty strings (degrade, never throw). */
export function metaFromDoc(doc: DevotionsDoc): DataMeta {
  return { gameVersion: doc.meta?.game_version ?? "", generatedUtc: doc.meta?.generated_utc ?? "" };
}
```

and change the return at line ~60 to:

```ts
      return { model, manifest, coverTable, reachWasm, meta: metaFromDoc(doc) };
```

Run `grep -rn "LoadedData" web/src web/test` - `httpDataSource.ts` must be the only place constructing one (the port and this adapter are the only expected hits; if a test builds a `LoadedData` literal, add `meta: { gameVersion: "", generatedUtc: "" }` to it).

- [ ] **Step 4: Run the test, then typecheck**

Run: `just test test/dataMeta.test.ts` - Expected: PASS (2 tests).
Run: `just typecheck` - Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/ports/DataSource.ts web/src/core/model.ts web/src/adapters/httpDataSource.ts web/test/dataMeta.test.ts
git commit -m "feat(data): expose dataset provenance (game version, extract timestamp) through the DataSource port

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: The five `ui.info.*` catalog keys

**Files:**
- Modify: `web/src/i18n/app.en.json` and the 12 other `web/src/i18n/app.<locale>.json` files
- Modify: `web/test/appCatalog.test.ts` (the `REQUIRED` list)

**Interfaces:**
- Produces: catalog keys `ui.info.aria`, `ui.info.description`, `ui.info.gameData` (params `{version}`, `{date}`), `ui.info.gameDataNoDate` (param `{version}`), `ui.info.github`. Task 4 resolves them via `localization.translate`.

- [ ] **Step 1: Write the failing guard**

In `web/test/appCatalog.test.ts`, add to the `REQUIRED` array after `"ui.lang.label"`:

```ts
  "ui.info.aria",
  "ui.info.description",
  "ui.info.gameData",
  "ui.info.gameDataNoDate",
  "ui.info.github",
```

Run: `just test test/appCatalog.test.ts` - Expected: FAIL (keys missing from `app.en.json`).

- [ ] **Step 2: Add the keys to all 13 locale files**

In `web/src/i18n/app.en.json`, after `"ui.lang.label"`:

```json
  "ui.info.aria": "About this planner",
  "ui.info.description": "A fan-made build planner for Grim Dawn's devotion system.",
  "ui.info.gameData": "Game data: v{version} (extracted {date})",
  "ui.info.gameDataNoDate": "Game data: v{version}",
  "ui.info.github": "View on GitHub",
```

In each other locale file, insert the five keys at that file's alphabetical position for `ui.info.*` (the non-en catalogs are alphabetically ordered; `ui.info.*` sorts between `ui.drawer.*` and `ui.lang.*`). Values:

| Locale | aria | description | gameData | gameDataNoDate | github |
| --- | --- | --- | --- | --- | --- |
| cs | `O tomto plánovači` | `Fanouškovský plánovač buildů pro systém devotion ve hře Grim Dawn.` | `Herní data: v{version} (extrahováno {date})` | `Herní data: v{version}` | `Zobrazit na GitHubu` |
| de | `Über diesen Planer` | `Ein von Fans erstellter Build-Planer für das Devotion-System von Grim Dawn.` | `Spieldaten: v{version} (extrahiert {date})` | `Spieldaten: v{version}` | `Auf GitHub ansehen` |
| es | `Acerca de este planificador` | `Un planificador de builds hecho por fans para el sistema de devoción de Grim Dawn.` | `Datos del juego: v{version} (extraídos {date})` | `Datos del juego: v{version}` | `Ver en GitHub` |
| fr | `À propos de ce planificateur` | `Un planificateur de builds créé par des fans pour le système de dévotion de Grim Dawn.` | `Données du jeu : v{version} (extraites {date})` | `Données du jeu : v{version}` | `Voir sur GitHub` |
| it | `Informazioni su questo pianificatore` | `Un pianificatore di build creato dai fan per il sistema di devozione di Grim Dawn.` | `Dati di gioco: v{version} (estratti {date})` | `Dati di gioco: v{version}` | `Vedi su GitHub` |
| ja | `このプランナーについて` | `Grim Dawnの星座（devotion）システムのファンメイド・ビルドプランナー。` | `ゲームデータ: v{version}（{date}抽出）` | `ゲームデータ: v{version}` | `GitHubで見る` |
| ko | `이 플래너 정보` | `Grim Dawn의 성좌(devotion) 시스템을 위한 팬 제작 빌드 플래너입니다.` | `게임 데이터: v{version} ({date} 추출)` | `게임 데이터: v{version}` | `GitHub에서 보기` |
| pl | `O tym planerze` | `Fanowski planer buildów dla systemu dewocji w Grim Dawn.` | `Dane gry: v{version} (wyodrębniono {date})` | `Dane gry: v{version}` | `Zobacz na GitHubie` |
| pt | `Sobre este planejador` | `Um planejador de builds feito por fãs para o sistema de devoção de Grim Dawn.` | `Dados do jogo: v{version} (extraídos {date})` | `Dados do jogo: v{version}` | `Ver no GitHub` |
| ru | `Об этом планировщике` | `Фанатский планировщик билдов для системы созвездий Grim Dawn.` | `Данные игры: v{version} (извлечены {date})` | `Данные игры: v{version}` | `Открыть на GitHub` |
| vi | `Về công cụ này` | `Công cụ lập kế hoạch build do người hâm mộ tạo cho hệ thống devotion của Grim Dawn.` | `Dữ liệu game: v{version} (trích xuất {date})` | `Dữ liệu game: v{version}` | `Xem trên GitHub` |
| zh | `关于此规划器` | `由粉丝制作的《恐怖黎明》星座系统配装规划器。` | `游戏数据：v{version}（提取于 {date}）` | `游戏数据：v{version}` | `在 GitHub 上查看` |

- [ ] **Step 3: Run the guard to verify it passes**

Run: `just test test/appCatalog.test.ts`
Expected: PASS, including the stray-key and placeholder-set tests for every locale.

- [ ] **Step 4: Commit**

```bash
git add web/src/i18n web/test/appCatalog.test.ts
git commit -m "feat(i18n): ui.info.* catalog keys for the header info popover (13 locales)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: The `infoPopover` adapter

**Files:**
- Create: `web/src/adapters/infoPopover.ts`
- Create: `web/test/infoPopover.test.ts`
- Modify: `web/src/styles.css` (after the `.lang-menu button.current::after` rule, line ~167)

**Interfaces:**
- Consumes: nothing from earlier tasks (receives already-resolved strings).
- Produces (used by Task 4):
  - `export interface InfoPopoverText { label: string; description: string; gameData: string | null; github: string }`
  - `export function infoPanelHtml(text: InfoPopoverText, githubUrl: string): string`
  - `export interface InfoPopoverHandle { setText(text: InfoPopoverText): void }`
  - `export function mountInfoPopover(header: HTMLElement, githubUrl: string): InfoPopoverHandle`

- [ ] **Step 1: Write the failing test**

Create `web/test/infoPopover.test.ts`:

```ts
// ABOUTME: Tests the info popover's pure content helper: the three lines, the optional game-data line,
// ABOUTME: link attributes, and HTML escaping. The DOM mount is thin glue verified in the browser.
import { test, expect } from "bun:test";
import { infoPanelHtml, type InfoPopoverText } from "../src/adapters/infoPopover";

const text: InfoPopoverText = {
  label: "About this planner",
  description: "A fan-made build planner for Grim Dawn's devotion system.",
  gameData: "Game data: v1.2.1.x (extracted 2026-07-01)",
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
});

test("omits the game-data line entirely when it is null", () => {
  const html = infoPanelHtml({ ...text, gameData: null }, URL);
  expect(html).not.toContain("info-version");
  expect(html).toContain("View on GitHub"); // the other lines still render
});

test("escapes text content", () => {
  const html = infoPanelHtml({ ...text, description: 'a <b> & "c"' }, URL);
  expect(html).toContain("a &lt;b&gt; &amp; &quot;c&quot;");
  expect(html).not.toContain("<b>");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `just test test/infoPopover.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement the adapter**

Create `web/src/adapters/infoPopover.ts`:

```ts
// ABOUTME: Header info popover: an (i) button that opens the planner's provenance - what it is, the
// ABOUTME: game-data version, and the GitHub repo link. Pure content helper plus a thin DOM mount.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface InfoPopoverText {
  label: string; // the button's accessible label
  description: string;
  gameData: string | null; // resolved provenance line, or null to omit (dataset carries no version)
  github: string; // the link's visible text
}

/** The panel's content: description, optional game-data line, and the GitHub link. */
export function infoPanelHtml(text: InfoPopoverText, githubUrl: string): string {
  const gameData = text.gameData ? `<p class="info-version">${esc(text.gameData)}</p>` : "";
  return (
    `<p>${esc(text.description)}</p>${gameData}` +
    `<p><a href="${esc(githubUrl)}" target="_blank" rel="noopener">${esc(text.github)}</a></p>`
  );
}

// A simple inline circled i, matching the language picker's globe (sized/colored by CSS currentColor).
const INFO_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor"' +
  ' stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/>' +
  '<circle cx="12" cy="7.5" r="0.6" fill="currentColor" stroke="none"/></svg>';

export interface InfoPopoverHandle {
  /** Re-render the panel and button label after a locale switch. */
  setText(text: InfoPopoverText): void;
}

/** Build the popover into `header`. Mount BEFORE the language picker so the (i) sits left of the globe. */
export function mountInfoPopover(header: HTMLElement, githubUrl: string): InfoPopoverHandle {
  const wrap = document.createElement("div");
  wrap.className = "info-popover";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "info-btn";
  btn.setAttribute("aria-haspopup", "true");
  btn.setAttribute("aria-expanded", "false");
  btn.innerHTML = INFO_SVG;

  const panel = document.createElement("div");
  panel.className = "info-panel";
  panel.setAttribute("role", "dialog");
  panel.hidden = true;

  wrap.append(btn, panel);
  header.appendChild(wrap);

  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
  };

  const setText = (text: InfoPopoverText) => {
    btn.setAttribute("aria-label", text.label);
    btn.title = text.label;
    panel.innerHTML = infoPanelHtml(text, githubUrl);
  };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(panel.hidden);
  });
  panel.addEventListener("click", (e) => {
    e.stopPropagation(); // clicks inside (selecting text) must not reach the document dismisser
    if ((e.target as HTMLElement).closest("a")) setOpen(false); // following the link closes it
  });
  // Dismiss on outside click or Escape (same contract as the language picker).
  document.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });

  return { setText };
}
```

In `web/src/styles.css`, after the `.lang-menu button.current::after` rule (line ~167):

```css
/* Info popover: an (i) button left of the language globe with the planner's provenance. */
.info-popover {
  position: relative;
  flex: none;
}
.info-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.3rem 0.45rem;
  line-height: 0;
  color: #9aa4b2;
}
.info-btn:hover {
  color: #e6edf3;
}
.info-panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 30;
  padding: 0.6rem 0.75rem;
  width: 16rem;
  background: #1b2129;
  border: 1px solid #30363d;
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
  font-size: 0.85rem;
  color: #e6edf3;
}
.info-panel[hidden] {
  display: none;
}
.info-panel p {
  margin: 0 0 0.4rem;
}
.info-panel p:last-child {
  margin-bottom: 0;
}
.info-panel a {
  color: #6cb6ff;
}
.info-version {
  color: #9aa4b2;
}
```

- [ ] **Step 4: Run the tests**

Run: `just test test/infoPopover.test.ts` - Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/adapters/infoPopover.ts web/test/infoPopover.test.ts web/src/styles.css
git commit -m "feat(header): info popover adapter - description, game-data line, GitHub link

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Wire into main.ts and verify in the browser

**Files:**
- Modify: `web/src/app/main.ts` (import block; a module-level constant; the block just above `mountLanguagePicker` at line ~147; the picker's `onSelect` at line ~152)

**Interfaces:**
- Consumes: `mountInfoPopover` / `InfoPopoverText` (Task 3), `data.meta` (Task 1), the `ui.info.*` keys (Task 2).

- [ ] **Step 1: Wire it up**

In `web/src/app/main.ts`:

Add to the imports:

```ts
import { mountInfoPopover, type InfoPopoverText } from "../adapters/infoPopover";
```

Add a module-level constant above `boot()` (a repository URL is configuration, not translatable text):

```ts
const GITHUB_URL = "https://github.com/tednaleid/grimdawn-devotions";
```

Immediately BEFORE the `mountLanguagePicker` call (line ~147), add:

```ts
  // Header info popover: the planner's provenance (description, game-data version, repo link).
  // Mounted before the language picker so the (i) sits immediately left of the globe.
  function infoText(): InfoPopoverText {
    const date = data.meta.generatedUtc.slice(0, 10); // date portion of the ISO stamp, timezone-free
    const gameData = data.meta.gameVersion
      ? date
        ? localization.translate("ui.info.gameData", { version: data.meta.gameVersion, date })
        : localization.translate("ui.info.gameDataNoDate", { version: data.meta.gameVersion })
      : null;
    return {
      label: localization.translate("ui.info.aria"),
      description: localization.translate("ui.info.description"),
      gameData,
      github: localization.translate("ui.info.github"),
    };
  }
  const info = mountInfoPopover(headerEl, GITHUB_URL);
  info.setText(infoText());
```

In the language picker's `onSelect` callback, after `applyChrome();`, add:

```ts
      info.setText(infoText());
```

- [ ] **Step 2: Run the full suite**

Run: `just test` - Expected: PASS.
Run: `just typecheck` - Expected: clean.

- [ ] **Step 3: Verify in the browser**

Run: `just serve`, open `http://localhost:5173` and verify:
- An (i) button sits immediately left of the language globe, subtle grey, brightening on hover.
- Clicking it opens the panel with three lines: the description, "Game data: v1.2.1.x (extracted 2026-07-01)" (grey), and a "View on GitHub" link whose href is `https://github.com/tednaleid/grimdawn-devotions` with `target="_blank"`.
- Escape closes it; clicking elsewhere closes it; clicking inside does not; `aria-expanded` tracks open state.
- Switch the language to Deutsch via the globe: the panel content re-renders in German ("Spieldaten: v1.2.1.x (extrahiert 2026-07-01)"); the (i) button's tooltip/label updates.
- The map and existing header controls are unaffected.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/main.ts
git commit -m "feat(header): mount the info popover with dataset provenance and GitHub link

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

```bash
just check
```

Then the Task 4 Step 3 browser walkthrough one more time on the built output.
