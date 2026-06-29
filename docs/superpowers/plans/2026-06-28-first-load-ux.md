# First-Load UX, Cache-Busting, and Minify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the planner show a loading indicator on first load, minify the bundle, and cache-bust JS/CSS via content-hashed filenames so code-only deploys are never served stale.

**Architecture:** A new `web/scripts/bundle.ts` owns the JS/CSS build: it runs `Bun.build` with minify + a content-hashed entry name, hashes `styles.css` itself, and rewrites the two asset references in `dist/index.html` to the hashed names. The `justfile` `build` recipe calls it in place of the inline `bun build` + `cp` lines. The loading indicator is plain markup inside `#map-container` that the existing `mountSvg` `innerHTML` assignment removes on first render — no `main.ts` change.

**Tech Stack:** Bun (build + test + `Bun.build` API), TypeScript, `just` task runner, plain CSS, the existing Bun-based e2e smoke test (`web/e2e/smoke.ts`).

## Global Constraints

- All code files start with two `// ABOUTME: ` (or `/* ABOUTME: */` for CSS) comment lines.
- Use `just` recipes, not raw `bun build` calls, for building.
- `buildId` stays `sha256(devotions.json)` (16 hex) — it is the data-coherence token embedded in the cover blob, not a code cache-buster. Do not fold code into it.
- Match surrounding code style; make the smallest reasonable change.
- Never commit with `--no-verify` (the pre-commit hook runs format + `bun test` + lint + tsc).
- Color palette (from `src/styles.css`): background `#0d1117`, text `#e6edf3`, gold accent `#f0c14b`, muted line `#6f82ad`.

---

### Task 1: Minified, content-hashed bundle via `bundle.ts`

**Files:**
- Create: `web/scripts/bundle.ts`
- Modify: `justfile` (the `build:` recipe, around lines 338-341 and the final echo at line 361)

**Interfaces:**
- Consumes: `computeBuildId(devotionsJsonText: string): string` from `web/src/adapters/coverTableBlob.ts`.
- Produces: build artifacts `dist/main-<hash>.js`, `dist/main-<hash>.js.map`, `dist/styles-<hash>.css`, and a `dist/index.html` whose `<script>`/`<link>` reference those hashed names. No new code interfaces for later tasks.

- [ ] **Step 1: Write the build script**

Create `web/scripts/bundle.ts`. Paths are relative to `web/` because the recipe runs `cd web` first (same as the prior inline `bun -e`).

```ts
// ABOUTME: Builds the planner's JS/CSS into web/dist with content-hashed, minified filenames.
// ABOUTME: Bundles main.ts (Bun.build), hashes styles.css, and rewrites the asset refs in index.html.
import { createHash } from "node:crypto";
import { computeBuildId } from "../src/adapters/coverTableBlob";

// buildId tags the data ?v= and is checked against the cover blob; it is data-only by design.
const buildId = computeBuildId(await Bun.file("../data/devotions.json").text());

const result = await Bun.build({
  entrypoints: ["src/app/main.ts"],
  outdir: "dist",
  target: "browser",
  minify: true,
  sourcemap: "linked", // emits main-<hash>.js.map; only fetched when devtools is open
  naming: "[name]-[hash].[ext]", // dist/main-<hash>.js
  define: { __BUILD_ID__: JSON.stringify(buildId) },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("bundle: Bun.build failed");
}
const entry = result.outputs.find((o) => o.kind === "entry-point");
if (!entry) throw new Error("bundle: no entry-point output");
const jsName = entry.path.split(/[\\/]/).pop()!; // main-<hash>.js

// styles.css is not built by Bun (plain CSS copied through), so hash it here for the same cache-busting.
const cssBytes = await Bun.file("src/styles.css").bytes();
const cssName = `styles-${createHash("sha256").update(cssBytes).digest("hex").slice(0, 8)}.css`;
await Bun.write(`dist/${cssName}`, cssBytes);

// Rewrite the two asset references in the HTML shell to the hashed names.
let html = await Bun.file("index.html").text();
html = html.replace('src="./main.js"', `src="./${jsName}"`).replace('href="./styles.css"', `href="./${cssName}"`);
if (html.includes('"./main.js"') || html.includes('"./styles.css"')) {
  throw new Error("bundle: index.html still has un-hashed asset refs after rewrite (did the markup change?)");
}
await Bun.write("dist/index.html", html);

console.log(`bundled dist: ${jsName}, ${cssName} (buildId ${buildId})`);
```

- [ ] **Step 2: Wire the `build` recipe to call it**

In `justfile`, in the `build:` recipe, replace these four lines:

```bash
    BUILD_ID=$(bun -e 'import {computeBuildId} from "./src/adapters/coverTableBlob"; console.log(computeBuildId(await Bun.file("../data/devotions.json").text()))')
    bun build src/app/main.ts --outdir dist --target browser --define __BUILD_ID__="\"$BUILD_ID\""
    cp index.html dist/index.html
    cp src/styles.css dist/styles.css
```

with this single line (keep the surrounding `cd web`, the dist clean, and the data/wasm/asset copies that follow unchanged):

```bash
    bun scripts/bundle.ts
```

Then change the final summary line of the recipe from:

```bash
    echo "Built web/dist (buildId $BUILD_ID)"
```

to (since `$BUILD_ID` is no longer a shell variable — `bundle.ts` prints it):

```bash
    echo "Built web/dist"
```

- [ ] **Step 3: Run the build and verify the artifacts**

Run: `just build`
Expected: completes; prints a `bundled dist: main-<hash>.js, styles-<hash>.css (buildId ...)` line and `Built web/dist`.

Then verify the outputs:

Run: `ls web/dist/main-*.js web/dist/main-*.js.map web/dist/styles-*.css`
Expected: all three exist (exactly one of each).

Run: `grep -c '"./main.js"\|"./styles.css"' web/dist/index.html || echo 0`
Expected: `0` (no bare references remain).

Run: `grep -oE 'src="\./main-[a-f0-9]+\.js"|href="\./styles-[a-f0-9]+\.css"' web/dist/index.html`
Expected: two lines — the hashed `main-…js` script ref and the hashed `styles-…css` link ref.

- [ ] **Step 4: Verify the hash is deterministic**

Run: `just build && ls web/dist/main-*.js` (note the name), then `just build && ls web/dist/main-*.js` again.
Expected: identical `main-<hash>.js` filename both times (content hash is stable for unchanged inputs; it changes only when the built bytes change, which is the cache-bust property we want).

- [ ] **Step 5: Verify the minified build still boots end-to-end**

Run: `just e2e`
Expected: PASS. This builds `dist` and drives headless Chrome against it; it asserts the page boots and that `globalThis.__reachResolver` is set, which confirms minification did not break the `__BUILD_ID__` define, the WASM resolver swap, or runtime globals.

- [ ] **Step 6: Commit**

```bash
git add web/scripts/bundle.ts justfile
git commit -m "build: minify and content-hash JS/CSS filenames

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: First-load loading indicator

**Files:**
- Modify: `web/index.html` (the `#map-container` element)
- Modify: `web/src/styles.css` (append loading-indicator rules)

**Interfaces:**
- Consumes: the build pipeline from Task 1 (it copies/templates `index.html` and hashes `styles.css`, carrying this markup and CSS through to `dist`).
- Produces: no code interface; a visual loading state removed by the existing `mountSvg` first render.

- [ ] **Step 1: Add the loading markup inside the map container**

In `web/index.html`, replace:

```html
    <div id="map-container"></div>
```

with:

```html
    <div id="map-container">
      <div id="boot-loading"><div class="boot-spinner" aria-hidden="true"></div><p>Loading the devotion map…</p></div>
    </div>
```

- [ ] **Step 2: Add the loading-indicator styles**

Append to the end of `web/src/styles.css`:

```css
/* First-load indicator: absolutely positioned inside #map-container (which is position:relative).
   The map's first render replaces #map-container's innerHTML, removing it. It fades in after a short
   delay so a fast load never flashes it. */
#boot-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  color: #e6edf3;
  opacity: 0;
  animation: boot-fade-in 0.3s ease 0.2s forwards;
}
.boot-spinner {
  width: 2.5rem;
  height: 2.5rem;
  border: 3px solid #6f82ad;
  border-top-color: #f0c14b;
  border-radius: 50%;
  animation: boot-spin 0.8s linear infinite;
}
@keyframes boot-spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes boot-fade-in {
  to {
    opacity: 1;
  }
}
```

- [ ] **Step 3: Build and verify the markup and CSS carry through to dist**

Run: `just build`
Expected: completes.

Run: `grep -c 'id="boot-loading"' web/dist/index.html`
Expected: `1` (the markup passed through the HTML rewrite untouched).

Run: `grep -l 'boot-spinner' web/dist/styles-*.css`
Expected: prints the hashed CSS file path (the spinner rule shipped).

- [ ] **Step 4: Manually confirm the indicator appears then is replaced**

Run: `just serve` (serves `dist` on http://localhost:5173)
In the browser devtools Network tab, set throttling to "Slow 3G", reload, and confirm:
- the spinner + "Loading the devotion map…" appears in the map area, then
- it is replaced by the rendered SVG map once data finishes loading.
Set throttling back to "No throttling", reload, and confirm the indicator does not visibly flash (the 0.2s fade-in delay covers a fast load).
Stop the server with `just stop-serve` (or Ctrl-C).

- [ ] **Step 5: Commit**

```bash
git add web/index.html web/src/styles.css
git commit -m "feat: show a loading indicator during first-load data fetch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Log the deferred parallel-fetch optimization

**Files:**
- Modify: `BACKLOG.md` (project root; exists — append a new section, do not recreate it)

**Interfaces:** none.

- [ ] **Step 1: Append the deferred item to `BACKLOG.md`**

Append a new section to the end of the existing `BACKLOG.md`, matching the
file's `## Title` + prose + `Pointers:` style:

```markdown

## Parallelize first-load data fetches

`httpDataSource.load()` (`web/src/adapters/httpDataSource.ts`) fetches
`devotions.json`, `manifest.json`, `cover-table.bin`, and `reach.wasm`
serially. Only `devotions.json` must come first: it builds the model the cover
blob decode and the WASM resolver need. The other three could fire in parallel
after it to shave round-trips on slow links. Deferred from the first-load UX
work because it is small and touches a careful degrade path.

Pointers: the `load()` method in `web/src/adapters/httpDataSource.ts` chains
`await`s; `manifest.json` is independent of the model, and the `cover-table.bin`
/ `reach.wasm` fetches can overlap the `buildModel(doc)` call (only their decode
needs the model). Re-verify the existing fallbacks after: a missing/mismatched
cover blob must still disable dimming, and a missing `reach.wasm` must still fall
back to the TS resolver.
```

- [ ] **Step 2: Commit**

```bash
git add BACKLOG.md
git commit -m "docs: backlog note for parallelizing first-load fetches

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Recover from a stale-deploy entry-script 404

**Files:**
- Modify: `web/index.html` (add an inline `bootFailed()` helper + `onerror` on the module tag + `role="status"` on `#boot-loading`)
- Modify: `web/src/app/main.ts` (clear the reload guard at the top of `boot()`)
- Modify: `web/scripts/bundle.ts` (add a positive-presence rewrite guard)

**Interfaces:**
- Consumes: the content-hashed `index.html`/`bundle.ts` from Task 1 and the `#boot-loading` element from Task 2.
- Produces: no code interface. A global `bootFailed()` (inline in `index.html`) and a `sessionStorage` key `"bootReloaded"` shared between `index.html` and `boot()`.

**Background:** Content-hashed filenames mean a cached `index.html` that outlives the deploy which replaced its hash will reference a now-deleted `main-<oldhash>.js`. On GitHub Pages (forced `max-age=600`, no old-build retention) that JS 404s, `boot()` never runs, and the Task 2 spinner spins forever. This is the framework-standard "reload on chunk-load error" safety net (e.g. Vite's `vite:preloadError` → `location.reload()`), adapted. An empirical Chrome probe confirmed `location.reload()` revalidates the `max-age=600` document and recovers; the `sessionStorage` guard prevents an infinite loop on a genuine failure (offline / broken deploy).

- [ ] **Step 1: Add the inline failure handler and wire the module tag**

In `web/index.html`, add this inline script inside `<head>` (after the stylesheet `<link>`):

```html
  <script>
    // The hashed entry script (below) can 404 when a cached index.html outlives the deploy that replaced
    // its hash (GitHub Pages caps caching at 600s and keeps no old builds). A reload revalidates index.html
    // and picks up the new hash; sessionStorage guards against an infinite reload loop on a real failure.
    function bootFailed() {
      try {
        if (!sessionStorage.getItem("bootReloaded")) {
          sessionStorage.setItem("bootReloaded", "1");
          location.reload();
          return;
        }
      } catch (e) {}
      var el = document.getElementById("boot-loading");
      if (el)
        el.innerHTML =
          '<p>Couldn\'t load the planner.</p><button type="button" onclick="location.reload()">Reload</button>';
    }
  </script>
```

Change the `#boot-loading` opening tag (from Task 2) to add `role="status"`:

```html
      <div id="boot-loading" role="status"><div class="boot-spinner" aria-hidden="true"></div><p>Loading the devotion map…</p></div>
```

Change the module script tag to add the `onerror` hook (the `src` stays `./main.js`; Task 1's `bundle.ts` rewrites it to the hashed name, and the substring match still works with the extra attribute):

```html
  <script type="module" src="./main.js" onerror="bootFailed()"></script>
```

- [ ] **Step 2: Clear the guard on a successful module load**

In `web/src/app/main.ts`, add as the first statements inside `async function boot() {` (before `const data = await httpDataSource(".").load();`):

```ts
  // A prior failed load may have set this guard (see bootFailed() in index.html). The module has now
  // loaded, so clear it — a later same-session deploy mismatch can then auto-recover again.
  try {
    sessionStorage.removeItem("bootReloaded");
  } catch {}
```

- [ ] **Step 3: Add the positive-presence rewrite guard to `bundle.ts`**

In `web/scripts/bundle.ts`, immediately after the existing guard that throws if bare refs remain, add:

```ts
if (!html.includes(jsName) || !html.includes(cssName)) {
  throw new Error("bundle: hashed asset refs not present after rewrite (did index.html markup change?)");
}
```

- [ ] **Step 4: Build and verify the wiring survives the hash rewrite**

Run: `just build`
Expected: completes (the new positive guard passes, proving the hashed refs are present).

Run: `grep -c 'function bootFailed' web/dist/index.html`
Expected: `1` (the inline handler shipped).

Run: `grep -oE 'src="\./main-[^"]+" onerror="bootFailed\(\)"' web/dist/index.html`
Expected: one line — the hashed `src` and the `onerror` hook are both present on the module tag after the rewrite.

Run: `grep -c 'id="boot-loading" role="status"' web/dist/index.html`
Expected: `1`.

- [ ] **Step 5: Confirm the normal boot path is unaffected**

Run: `just e2e`
Expected: PASS. The inline script and `onerror` must not interfere with a normal successful load (no `bootFailed()` call when the JS loads fine).

- [ ] **Step 6: Commit**

```bash
git add web/index.html web/src/app/main.ts web/scripts/bundle.ts
git commit -m "feat: recover from a stale-deploy entry-script 404

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**Controller-side behavioral verification (not the implementer's job):** after this task, the controller runs an adapted headless-Chrome probe against the real `dist` with the hashed JS forced to 404, confirming: first load triggers one guarded `location.reload()`, and the second failure replaces the spinner with the Reload button (no infinite loop).

---

## Self-Review

**Spec coverage:**
- Loading state (spec §1) → Task 2. ✓
- Minification (spec §2) → Task 1, Steps 1-2 (`minify: true`, `sourcemap: 'linked'`). ✓
- Content-hashed filenames (spec §3) → Task 1 (`bundle.ts` + recipe wiring). ✓
- `buildId` stays as-is → Global Constraints + Task 1 comment; `computeBuildId` reused unchanged. ✓
- Out-of-scope parallel fetch logged to BACKLOG → Task 3. ✓
- Affected files (spec): `web/index.html` (T2), `web/src/styles.css` (T2), `web/scripts/bundle.ts` (T1), `justfile` (T1), `BACKLOG.md` (T3). All covered. ✓

**Placeholder scan:** No TBD/TODO; all code blocks are complete; commands have expected output. ✓

**Type consistency:** `computeBuildId(string): string` matches `coverTableBlob.ts`. `jsName`/`cssName` are strings used consistently in the rewrite. `result.outputs` / `o.kind === "entry-point"` / `entry.path` are the Bun.build API. ✓
