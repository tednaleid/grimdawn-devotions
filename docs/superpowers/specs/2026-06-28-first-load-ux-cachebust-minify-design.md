# First-load UX, content-hashed cache-busting, and minification

Date: 2026-06-28
Status: Approved (design)

## Problem

On a slow connection the planner can feel broken. `boot()` awaits the entire
data load before rendering anything (`web/src/app/main.ts`), and `index.html`
is a static skeleton with no progress feedback, so a visitor sees an inert
half-page (static "Points 55", empty map, dead clicks) until the download
finishes, then it snaps to life. On slow 3G (~50 KB/s) the ~385 KB gzipped
blocking payload is several seconds of zero feedback.

Two adjacent hygiene gaps surfaced while investigating:

- The bundle ships **unminified** (`bun build … --target browser`, no
  `--minify`). gzip already does most of the wire work, so the win is modest on
  bytes but real on parse/eval time for ~1 MB of JS on weak phones.
- **`main.js` and `styles.css` have no cache-busting** (`index.html` references
  `./main.js` / `./styles.css` with no hash or query), and `buildId` is derived
  from data only, so a code-only deploy changes no version token at all. GitHub
  Pages caps staleness at `max-age=600`, so this is a correctness/mismatch risk
  rather than a permanent-stale bug, but it is cheap to close.

### Explicitly not a problem (verified)

Pre-compressing `cover-table.bin` was considered and **dropped**. A live check of
the deployed site shows GitHub Pages already serves it `Content-Encoding: gzip`
at ~107 KB (not the 1.83 MB raw). `reach.wasm`, `devotions.json`, `main.js`, and
`styles.css` are likewise gzipped on the wire. A self-managed `DecompressionStream`
path would save ~35 KB for real added complexity, so it is not worth it.

## Scope

In scope: (1) a first-load loading state, (2) minification, (3) content-hashed
filenames for `main.js`/`styles.css` so code-only deploys bust caches.

Out of scope (logged to `BACKLOG.md`, not built here): parallelizing the serial
fetches in `httpDataSource.load()`. It would shave a round-trip on slow links but
is a separate optimization with risk in a careful degrade path.

## Design

### 1. Loading state

`index.html` gets a loading element inside the existing map container:

```html
<div id="map-container">
  <div id="boot-loading"><div class="boot-spinner"></div><p>Loading the devotion map…</p></div>
</div>
```

`styles.css` gains `#boot-loading` (centered column) and `.boot-spinner` (a CSS
keyframe rotation). The indicator fades in after a ~200 ms delay so fast
connections never flash it.

No change to `web/src/app/main.ts`. `mountSvg` assigns
`container.innerHTML = renderSvgMarkup(...)` (`web/src/adapters/svgRenderer.ts:381`),
which removes `#boot-loading` on the first render. The error path
(`boot().catch`, `main.ts:634`) replaces `document.body.innerHTML` and also
clears it.

### 2. Minification

The bundle step builds with `minify: true` and `sourcemap: 'linked'`. The linked
sourcemap keeps production stack traces debuggable; the `.map` is only fetched
when devtools is open.

### 3. Content-hashed filenames

The build emits `main-<hash>.js` (plus `main-<hash>.js.map`) and
`styles-<hash>.css`, and injects those names into `dist/index.html`.

This is implemented by a new `web/scripts/bundle.ts` (following the existing
`web/scripts/*.ts` convention; clearer than `sed` in the recipe). It:

1. computes `BUILD_ID` via `computeBuildId(devotions.json text)` (moved out of
   the inline `bun -e` in the recipe);
2. runs `Bun.build` with `naming: '[dir]/[name]-[hash].[ext]'`, `minify: true`,
   `sourcemap: 'linked'`, and `define: { __BUILD_ID__: JSON.stringify(BUILD_ID) }`,
   then reads the emitted entry-point filename back from `result.outputs`;
3. reads `src/styles.css`, computes a content hash (sha256, first 16 hex),
   writes `dist/styles-<hash>.css`;
4. reads `index.html`, replaces `./main.js` with `./<emitted js name>` and
   `./styles.css` with `./styles-<hash>.css`, writes `dist/index.html`;
5. prints the build summary (buildId + emitted asset names).

The `build` recipe in `justfile` keeps everything else (in-place dist clean,
`dist/data` copies, the `reach.wasm` rebuild/copy logic, the `assets` copy). The
two build-and-copy lines (the `bun -e` BUILD_ID computation, the `bun build`
call, and the `cp index.html` / `cp src/styles.css` lines) collapse into a single
`bun scripts/bundle.ts` invocation.

### `buildId` stays as-is (decision)

`buildId` remains `sha256(devotions.json)`, derived from data only. It is a
data-coherence token, not a code cache-buster: it is embedded in the cover blob
and checked at decode (`web/src/adapters/httpDataSource.ts:25`) so a mismatched
`.bin` disables dimming instead of corrupting, and it tags the data `?v=` so the
JSON/bin/wasm stay a coherent set. Folding code into it would churn the token on
code-only releases and blur its meaning. So there are two tokens with two jobs:
`buildId` answers "which dataset," and the new per-asset content hash answers
"which exact JS/CSS bytes."

## Affected files

- `web/index.html` — add `#boot-loading` markup; references become hashed at build time.
- `web/src/styles.css` — add `#boot-loading` / `.boot-spinner` styles.
- `web/scripts/bundle.ts` — new; build + hash + template.
- `justfile` — `build` recipe calls `bundle.ts` in place of the inline build/copy lines.
- `BACKLOG.md` — note the deferred parallel-fetch optimization.

## Testing / verification

- `just build` produces `dist/main-<hash>.js`, `dist/main-<hash>.js.map`,
  `dist/styles-<hash>.css`, and a `dist/index.html` that references the hashed
  names (no bare `./main.js` / `./styles.css` left).
- Changing only application code (not `devotions.json`) yields a different JS
  hash and an updated `index.html` reference; changing nothing yields identical
  hashes (deterministic).
- `just e2e` passes against the hashed build (the smoke server serves by path and
  entry-points via `index.html`, `web/e2e/smoke.ts:25-29`), confirming the page
  boots and the `__reachResolver` global is intact after minification.
- Manual: throttle to slow 3G in devtools and confirm the loading indicator
  appears and is replaced by the map; confirm it does not flash on a fast load.
