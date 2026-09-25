# Page-Load Counter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Count anonymous page loads of the four pages so Ted can see how often the site is used, without cookies and without a third-party script that ad blockers stop.

**Architecture:** Each page sends one `navigator.sendBeacon` to a new `POST /hit` route on the existing Cloudflare worker when the document loads. The worker checks the origin and a per-IP rate limit, then writes one data point (page, country, referrer domain) to a Workers Analytics Engine dataset. A local `just stats` recipe reads the dataset through Cloudflare's SQL API with a read-only token.

**Tech Stack:** TypeScript (Bun build and `bun test`), Cloudflare Workers (wrangler, Analytics Engine, rate-limit bindings), Python 3.14 via a `uv` shebang (stdlib only) for the stats reader.

**Spec:** The "Decisions" section below. It records the grilling session of 2026-09-25; there is no separate spec file.

## Decisions

1. Mechanism: a beacon to our own worker, recorded in Workers Analytics Engine. Not the Cloudflare Web Analytics snippet (EasyPrivacy blocks `static.cloudflareinsights.com`), not a hosting move off GitHub Pages.
2. Metric: page loads only. No unique-visitor identifier of any kind (no cookie, no IP hash, no localStorage id).
3. Recorded per hit: page name, Cloudflare's country code, referrer domain. Never the URL hash (it holds the build), never a full referrer URL, never the IP.
4. Disclosure: one sentence in `README.md`. No in-app notice.
5. Reading: a `just stats` recipe (uv Python script) using a separate read-only token; `just setup-stats-auth` stores that token. No public stats route.
6. Retention: Analytics Engine's 3-month window. A long-term rollup goes in `BACKLOG.md`, not built now.
7. Counted traffic: production origin only (worker rejects any other `Origin`); one hit per document load (hash changes never send); navigation between our own pages records referrer `internal`.
8. Abuse: per-IP rate limit of 10 hits per 60 s; over-limit hits are dropped with a 204.
9. Privacy signals: no beacon when `navigator.globalPrivacyControl === true` or `navigator.doNotTrack === "1"`.

## Global Constraints

- Every new code file starts with two `// ABOUTME: ` lines (`# ABOUTME: ` in Python and TOML/bash).
- No user-facing string is added, so no `app.<locale>.json` keys; `web/test/i18nBoundary.test.ts` must still pass.
- No URL-hash state is added or read by this feature.
- The beacon is fire-and-forget: no retries, no await, no user-visible error, and any exception is swallowed.
- Page names are exactly `planner`, `rr`, `monsters`, `items`.
- Referrer labels: `direct` (no referrer), `internal` (same host), `other` (unparseable or invalid), otherwise the lowercased hostname with a leading `www.` removed. Valid labels match `/^[a-z0-9.-]{1,253}$/`.
- Analytics Engine dataset name: `grimdawn_devotions_hits`. Binding name: `HITS`. Data point shape: `blobs: [page, country, ref]`, `indexes: [page]`.
- Rate-limit binding: `HIT_LIMITER_IP`, `namespace_id = "1003"`, `simple = { limit = 10, period = 60 }`.
- Stats token: env var `GD_STATS_TOKEN`, else macOS keychain item service `grimdawn-devotions-stats`, account `cloudflare`. Required permission: Account > Account Analytics > Read.
- Use `just` recipes for build, test, lint, and check. `just check` must pass before each commit. Run `just fmt` before `just check` so Biome and ruff formatting match. Never `--no-verify`.
- Docs: no emojis, no emdashes, no hyperbole.

---

## File Structure

- Create `web/src/core/pageHit.ts`: pure rules shared by browser and worker (page names, referrer label, privacy-signal check, hit-body parsing).
- Create `web/src/adapters/workerApi.ts`: the one place that resolves the worker base URL from the build-time `__IMPORT_API__` define.
- Create `web/src/adapters/pageHitBeacon.ts`: sends the beacon, using `pageHit.ts` rules and injectable browser globals.
- Modify `web/scripts/bundle.ts`: pass `__IMPORT_API__` to all four page bundles, not only the planner.
- Modify `web/src/app/main.ts`, `web/src/rr/app/main.ts`, `web/src/monsters/app/main.ts`, `web/src/items/app/main.ts`: one `sendPageHit(...)` call each; the planner also switches to `workerApi`.
- Modify `worker/src/index.ts`: `POST /hit` route, `Env` bindings.
- Modify `worker/wrangler.toml`: Analytics Engine dataset and rate-limit bindings.
- Create `scripts/stats.py`, `scripts/setup_stats_auth.sh`; modify `justfile`.
- Tests: create `web/test/pageHit.test.ts`, `web/test/pageHitBeacon.test.ts`; extend `web/test/worker.test.ts` (it already has `fakeLimiter`).
- Docs: `README.md`, `ONBOARDING.md`, `worker/README.md`, `BACKLOG.md`.

---

### Task 1: Shared page-hit rules

**Files:**
- Create: `web/src/core/pageHit.ts`
- Test: `web/test/pageHit.test.ts`

**Interfaces:**
- Produces:
  - `export const PAGE_NAMES = ["planner", "rr", "monsters", "items"] as const;`
  - `export type PageName = (typeof PAGE_NAMES)[number];`
  - `export function isPageName(v: unknown): v is PageName`
  - `export const REFERRER_LABEL_RE: RegExp` (`/^[a-z0-9.-]{1,253}$/`)
  - `export function referrerLabel(referrer: string, selfHost: string): string`
  - `export interface PrivacySignals { globalPrivacyControl?: boolean; doNotTrack?: string | null }`
  - `export function privacySignalSet(s: PrivacySignals): boolean`
  - `export interface Hit { page: PageName; ref: string }`
  - `export function parseHitBody(text: string): Hit | null`

- [ ] **Step 1: Write the failing test**

`web/test/pageHit.test.ts`:

```ts
// ABOUTME: Tests the pure page-hit rules shared by the browser beacon and the worker's /hit route.
// ABOUTME: Covers page-name validation, referrer labelling, privacy signals, and hit-body parsing.
import { test, expect } from "bun:test";
import { isPageName, parseHitBody, privacySignalSet, referrerLabel } from "../src/core/pageHit";

const SELF = "tednaleid.github.io";

test("accepts exactly the four page names", () => {
  for (const p of ["planner", "rr", "monsters", "items"]) expect(isPageName(p)).toBe(true);
  for (const p of ["", "Planner", "admin", 1, null, undefined]) expect(isPageName(p)).toBe(false);
});

test("labels an empty referrer as direct", () => {
  expect(referrerLabel("", SELF)).toBe("direct");
});

test("labels our own host as internal", () => {
  expect(referrerLabel("https://tednaleid.github.io/grimdawn-devotions/#s=abc", SELF)).toBe("internal");
});

test("keeps only the hostname, lowercased, without a leading www", () => {
  expect(referrerLabel("https://www.Reddit.com/r/Grimdawn/comments/x?utm=1", SELF)).toBe("reddit.com");
  expect(referrerLabel("https://forums.crateentertainment.com/t/123", SELF)).toBe("forums.crateentertainment.com");
});

test("labels an unparseable referrer as other", () => {
  expect(referrerLabel("not a url", SELF)).toBe("other");
});

test("privacy signals: GPC true or DNT '1' suppresses the hit", () => {
  expect(privacySignalSet({ globalPrivacyControl: true })).toBe(true);
  expect(privacySignalSet({ doNotTrack: "1" })).toBe(true);
  expect(privacySignalSet({ globalPrivacyControl: false, doNotTrack: "0" })).toBe(false);
  expect(privacySignalSet({ doNotTrack: null })).toBe(false);
  expect(privacySignalSet({})).toBe(false);
});

test("parses a valid hit body", () => {
  expect(parseHitBody('{"page":"rr","ref":"reddit.com"}')).toEqual({ page: "rr", ref: "reddit.com" });
});

test("rejects a body without a known page", () => {
  expect(parseHitBody('{"page":"admin","ref":"direct"}')).toBeNull();
  expect(parseHitBody('{"ref":"direct"}')).toBeNull();
  expect(parseHitBody("not json")).toBeNull();
  expect(parseHitBody("null")).toBeNull();
  expect(parseHitBody('"planner"')).toBeNull();
});

test("replaces a missing or malformed ref with other", () => {
  expect(parseHitBody('{"page":"items"}')).toEqual({ page: "items", ref: "other" });
  expect(parseHitBody('{"page":"items","ref":"<script>"}')).toEqual({ page: "items", ref: "other" });
  expect(parseHitBody(`{"page":"items","ref":"${"a".repeat(254)}"}`)).toEqual({ page: "items", ref: "other" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `just test test/pageHit.test.ts`
Expected: FAIL, cannot resolve `../src/core/pageHit`.

- [ ] **Step 3: Write the implementation**

`web/src/core/pageHit.ts`:

```ts
// ABOUTME: Pure rules for the anonymous page-load counter, shared by the browser beacon and the worker.
// ABOUTME: Defines the page names, how a referrer is reduced to a domain label, and how a hit body is validated.

export const PAGE_NAMES = ["planner", "rr", "monsters", "items"] as const;
export type PageName = (typeof PAGE_NAMES)[number];

export function isPageName(v: unknown): v is PageName {
  return typeof v === "string" && (PAGE_NAMES as readonly string[]).includes(v);
}

/** A referrer label as stored: a hostname, or one of `direct`, `internal`, `other`. */
export const REFERRER_LABEL_RE = /^[a-z0-9.-]{1,253}$/;

/** Reduce `document.referrer` to a domain so no path, query, or build hash ever leaves the browser. */
export function referrerLabel(referrer: string, selfHost: string): string {
  if (!referrer) return "direct";
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return "other";
  }
  if (host === selfHost.toLowerCase()) return "internal";
  const label = host.startsWith("www.") ? host.slice(4) : host;
  return REFERRER_LABEL_RE.test(label) ? label : "other";
}

export interface PrivacySignals {
  globalPrivacyControl?: boolean;
  doNotTrack?: string | null;
}

/** True when the browser asks not to be tracked (Global Privacy Control or Do Not Track). */
export function privacySignalSet(s: PrivacySignals): boolean {
  return s.globalPrivacyControl === true || s.doNotTrack === "1";
}

export interface Hit {
  page: PageName;
  ref: string;
}

/** Null unless the body names a known page; a bad or missing `ref` degrades to `other`. */
export function parseHitBody(text: string): Hit | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const { page, ref } = v as Record<string, unknown>;
  if (!isPageName(page)) return null;
  return { page, ref: typeof ref === "string" && REFERRER_LABEL_RE.test(ref) ? ref : "other" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `just test test/pageHit.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Gate and commit**

Run: `just check`
Expected: PASS.

```bash
git add web/src/core/pageHit.ts web/test/pageHit.test.ts
git commit -m "feat(stats): pure page-hit rules shared by beacon and worker"
```

---

### Task 2: Worker `POST /hit` route

**Files:**
- Modify: `worker/src/index.ts` (imports at top; `Env` near line 31; new handler after `handleExport`; router in `handleRequest` near line 304; ABOUTME line 2)
- Modify: `worker/wrangler.toml` (append bindings)
- Modify: `worker/README.md` (contract section)
- Test: `web/test/worker.test.ts` (append; reuses its `fakeLimiter`)

**Interfaces:**
- Consumes: `parseHitBody`, `Hit` from `web/src/core/pageHit.ts` (Task 1).
- Produces: `POST /hit` accepting a `text/plain` body `{"page": PageName, "ref": string}`; responses `204` (recorded or rate-limited), `400` (bad body), `403` (wrong `Origin`), `405` (not POST). Exported `interface AnalyticsDataset { writeDataPoint(p: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void }`. `Env` gains `HITS?: AnalyticsDataset` and `HIT_LIMITER_IP?: RateLimiter`.

- [ ] **Step 1: Write the failing tests**

Append to `web/test/worker.test.ts`:

```ts
function fakeDataset() {
  const points: { blobs?: string[]; indexes?: string[] }[] = [];
  return { points, writeDataPoint: (p: { blobs?: string[]; indexes?: string[] }) => void points.push(p) };
}

function hitRequest(body: string, origin = ORIGIN, country?: string): Request {
  const req = new Request("https://w/hit", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "text/plain", "CF-Connecting-IP": "203.0.113.9" },
    body,
  });
  return country === undefined ? req : Object.assign(req, { cf: { country } });
}

function hitEnv(extra: Record<string, unknown> = {}) {
  const HITS = fakeDataset();
  return { HITS, env: { ALLOWED_ORIGIN: ORIGIN, HITS, ...extra } as never };
}

test("/hit records page, country and referrer label", async () => {
  const { HITS, env: e } = hitEnv();
  const res = await handleRequest(hitRequest('{"page":"planner","ref":"reddit.com"}', ORIGIN, "DE"), e);
  expect(res.status).toBe(204);
  expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  expect(HITS.points).toEqual([{ blobs: ["planner", "DE", "reddit.com"], indexes: ["planner"] }]);
});

test("/hit records XX when Cloudflare supplies no country", async () => {
  const { HITS, env: e } = hitEnv();
  await handleRequest(hitRequest('{"page":"rr","ref":"direct"}'), e);
  expect(HITS.points[0].blobs).toEqual(["rr", "XX", "direct"]);
});

test("/hit from another origin is refused and not recorded", async () => {
  const { HITS, env: e } = hitEnv();
  const res = await handleRequest(hitRequest('{"page":"rr","ref":"direct"}', "http://localhost:5173"), e);
  expect(res.status).toBe(403);
  expect(HITS.points).toEqual([]);
});

test("/hit with an unknown page is refused and not recorded", async () => {
  const { HITS, env: e } = hitEnv();
  const res = await handleRequest(hitRequest('{"page":"admin","ref":"direct"}'), e);
  expect(res.status).toBe(400);
  expect(HITS.points).toEqual([]);
});

test("/hit with an oversized body is refused and not recorded", async () => {
  const { HITS, env: e } = hitEnv();
  const res = await handleRequest(hitRequest(`{"page":"rr","ref":"${"a".repeat(1000)}"}`), e);
  expect(res.status).toBe(400);
  expect(HITS.points).toEqual([]);
});

test("/hit over the per-IP limit is dropped silently", async () => {
  const limiter = fakeLimiter(1);
  const { HITS, env: e } = hitEnv({ HIT_LIMITER_IP: limiter });
  const first = await handleRequest(hitRequest('{"page":"items","ref":"direct"}'), e);
  const second = await handleRequest(hitRequest('{"page":"items","ref":"direct"}'), e);
  expect([first.status, second.status]).toEqual([204, 204]);
  expect(HITS.points.length).toBe(1);
  expect(limiter.keys).toEqual(["ip:203.0.113.9", "ip:203.0.113.9"]);
});

test("/hit only accepts POST", async () => {
  const { env: e } = hitEnv();
  const res = await handleRequest(new Request("https://w/hit"), e);
  expect(res.status).toBe(405);
});

test("/hit through the default export is never cached", async () => {
  installFakeCache();
  const { HITS, env: e } = hitEnv();
  await worker.fetch(hitRequest('{"page":"monsters","ref":"direct"}'), e);
  await worker.fetch(hitRequest('{"page":"monsters","ref":"direct"}'), e);
  expect(HITS.points.length).toBe(2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `just test test/worker.test.ts`
Expected: the new `/hit` tests FAIL (404 `not_found` instead of 204/403/400/405); existing tests still pass.

- [ ] **Step 3: Implement the route**

In `worker/src/index.ts`:

Change ABOUTME line 2 to:

```ts
// ABOUTME: slug (GET /), saves a selection as a grimtools build (POST /export), and counts anonymous page loads (POST /hit). Never fetches a caller-named host.
```

Add the import below the existing `grimtools` import:

```ts
import { parseHitBody } from "../../web/src/core/pageHit";
```

Add constant next to `MAX_EXPORT_BODY`:

```ts
const MAX_HIT_BODY = 512; // {"page":...,"ref":<=253 chars} fits with room; this bounds a hostile body
```

Add after the `RateLimiter` interface:

```ts
/** The surface of a Workers Analytics Engine binding (`[[analytics_engine_datasets]]` in wrangler.toml); tests pass a fake. */
export interface AnalyticsDataset {
  writeDataPoint(p: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}
```

Add to `Env`, after `EXPORT_LIMITER_GLOBAL`:

```ts
  /** Page-load counter: the dataset each hit is written to, and its per-address brake. Absent means
   * the hit is accepted and discarded (tests, or a runtime without the bindings). */
  HITS?: AnalyticsDataset;
  HIT_LIMITER_IP?: RateLimiter;
```

Add after `handleExport`:

```ts
/**
 * Count one anonymous page load: page name, Cloudflare's country code, and the referrer's domain
 * label (see web/src/core/pageHit.ts). No IP, cookie, or identifier is stored; the IP is only the
 * rate-limit key. The browser sends this with sendBeacon and never reads the response.
 */
async function handleHit(request: Request, env: Env): Promise<Response> {
  const origin = env.ALLOWED_ORIGIN;
  const reply = (status: number) =>
    new Response(null, { status, headers: { "Access-Control-Allow-Origin": origin, "Cache-Control": "no-store" } });
  // Keeps localhost, previews and copies of the site out of the counts.
  if (request.headers.get("Origin") !== origin) return reply(403);
  const text = await boundedBody(request, MAX_HIT_BODY);
  const hit = text === null ? null : parseHitBody(text);
  if (!hit) return reply(400);
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (!(await allowed(env.HIT_LIMITER_IP, `ip:${ip}`))) return reply(204);
  const country = (request as Request & { cf?: { country?: string } }).cf?.country ?? "XX";
  env.HITS?.writeDataPoint({ blobs: [hit.page, country, hit.ref], indexes: [hit.page] });
  return reply(204);
}
```

In `handleRequest`, directly after the existing `/export` block:

```ts
  if (path === "/hit") {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);
    return handleHit(request, env);
  }
```

The default export already routes every non-GET straight to `handleRequest`, so `/hit` never touches the cache; the last test pins that.

- [ ] **Step 4: Add the bindings**

Append to `worker/wrangler.toml`:

```toml

# Page-load counter (POST /hit). Each hit is one data point: blobs = [page, country, referrer label].
# Analytics Engine keeps about three months; `just stats` reads it through the SQL API.
[[analytics_engine_datasets]]
binding = "HITS"
dataset = "grimdawn_devotions_hits"

# Per client address only: the counter has no upstream to protect, this just caps what one script can add.
[[ratelimits]]
name = "HIT_LIMITER_IP"
namespace_id = "1003"
simple = { limit = 10, period = 60 }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `just test test/worker.test.ts`
Expected: PASS, all tests including the 8 new ones.

- [ ] **Step 6: Confirm local wrangler accepts the config**

Run: `just worker-dev` (in the background), then:

```bash
curl -si -X POST http://localhost:8787/hit -H 'Origin: http://localhost:5173' -H 'Content-Type: text/plain' --data '{"page":"planner","ref":"direct"}'
```

Expected: `HTTP/1.1 204` if `worker/.dev.vars` sets `ALLOWED_ORIGIN=http://localhost:5173`, otherwise `403`. Either proves the route and bindings load. Stop the dev server afterwards. If wrangler refuses the `analytics_engine_datasets` block locally, report the exact error to Ted instead of working around it.

- [ ] **Step 7: Document the contract in `worker/README.md`**

In the opening paragraph, after the sentence ending "hands back the resulting slug.", add:

```markdown
It also counts anonymous page loads for the site's own pages (`POST /hit`).
```

After the paragraph that starts "Export contract:" and before `## Slug, never a URL`, add:

```markdown
Page-load contract: `POST /hit` with a `text/plain` body `{"page": "planner"|"rr"|"monsters"|"items",
"ref": <referrer label>}` (at most 512 bytes, `Origin` equal to `ALLOWED_ORIGIN`) writes one data point
to the `grimdawn_devotions_hits` Analytics Engine dataset: `blobs = [page, country, ref]`, where
`country` is Cloudflare's two-letter code (`XX` when unknown). The referrer label is computed in the
browser (`referrerLabel` in `web/src/core/pageHit.ts`) so only a domain, `direct`, `internal`, or
`other` ever arrives; the worker re-validates it. Responses: `204` recorded (or dropped by the
`HIT_LIMITER_IP` per-address limit), `400` bad body, `403` wrong origin. No IP, cookie, or
identifier is stored. The pages send it with `sendBeacon` and never read the response. `just stats`
reads the dataset.
```

- [ ] **Step 8: Gate and commit**

Run: `just check`
Expected: PASS.

```bash
git add worker/src/index.ts worker/wrangler.toml worker/README.md web/test/worker.test.ts
git commit -m "feat(worker): POST /hit records anonymous page loads in Analytics Engine"
```

---

### Task 3: Browser beacon on all four pages

**Files:**
- Create: `web/src/adapters/workerApi.ts`
- Create: `web/src/adapters/pageHitBeacon.ts`
- Test: `web/test/pageHitBeacon.test.ts`
- Modify: `web/scripts/bundle.ts` (planner define block near line 50; rr, monsters, items defines near lines 89, 126, 166)
- Modify: `web/src/app/main.ts:74-82`, plus one line before `boot().catch` near line 1486
- Modify: `web/src/rr/app/main.ts` (before `boot().catch`, near line 154), `web/src/monsters/app/main.ts` (near line 263), `web/src/items/app/main.ts` (near line 197)

**Interfaces:**
- Consumes: `PageName`, `referrerLabel`, `privacySignalSet` from Task 1; `POST /hit` from Task 2.
- Produces:
  - `web/src/adapters/workerApi.ts`: `export const workerApi: string`
  - `web/src/adapters/pageHitBeacon.ts`: `export interface BeaconHost { navigator: { sendBeacon?: (url: string, data: Blob) => boolean; globalPrivacyControl?: boolean; doNotTrack?: string | null }; location: { hostname: string }; document: { referrer: string } }` and `export function sendPageHit(page: PageName, api?: string, host?: BeaconHost): void`

- [ ] **Step 1: Write the failing test**

`web/test/pageHitBeacon.test.ts`:

```ts
// ABOUTME: Tests the page-load beacon: what it sends, where, and when it stays silent.
// ABOUTME: Browser globals are injected, so no DOM or network is needed.
import { test, expect } from "bun:test";
import { sendPageHit, type BeaconHost } from "../src/adapters/pageHitBeacon";

const API = "https://worker.example";

function fakeHost(overrides: Partial<BeaconHost["navigator"]> = {}, referrer = "") {
  const sent: { url: string; data: Blob }[] = [];
  const host: BeaconHost = {
    navigator: {
      sendBeacon: (url, data) => {
        sent.push({ url, data });
        return true;
      },
      ...overrides,
    },
    location: { hostname: "tednaleid.github.io" },
    document: { referrer },
  };
  return { host, sent };
}

test("sends one text/plain beacon to /hit with the page and referrer label", async () => {
  const { host, sent } = fakeHost({}, "https://www.reddit.com/r/Grimdawn/");
  sendPageHit("monsters", API, host);
  expect(sent.length).toBe(1);
  expect(sent[0].url).toBe(`${API}/hit`);
  expect(sent[0].data.type).toBe("text/plain");
  expect(JSON.parse(await sent[0].data.text())).toEqual({ page: "monsters", ref: "reddit.com" });
});

test("never sends the page URL or hash", async () => {
  const { host, sent } = fakeHost({}, "https://tednaleid.github.io/grimdawn-devotions/#s=secretbuild");
  sendPageHit("planner", API, host);
  const body = await sent[0].data.text();
  expect(body).not.toContain("secretbuild");
  expect(JSON.parse(body)).toEqual({ page: "planner", ref: "internal" });
});

test("stays silent under Global Privacy Control", () => {
  const { host, sent } = fakeHost({ globalPrivacyControl: true });
  sendPageHit("rr", API, host);
  expect(sent).toEqual([]);
});

test("stays silent under Do Not Track", () => {
  const { host, sent } = fakeHost({ doNotTrack: "1" });
  sendPageHit("rr", API, host);
  expect(sent).toEqual([]);
});

test("does nothing when sendBeacon is unavailable", () => {
  const { host } = fakeHost({ sendBeacon: undefined });
  expect(() => sendPageHit("items", API, host)).not.toThrow();
});

test("swallows a throwing sendBeacon", () => {
  const { host } = fakeHost({
    sendBeacon: () => {
      throw new TypeError("bad url");
    },
  });
  expect(() => sendPageHit("items", API, host)).not.toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `just test test/pageHitBeacon.test.ts`
Expected: FAIL, cannot resolve `../src/adapters/pageHitBeacon`.

- [ ] **Step 3: Write `workerApi.ts`**

```ts
// ABOUTME: The Cloudflare worker's base URL, substituted at build time by web/scripts/bundle.ts.
// ABOUTME: Unbundled runs (tests) fall back to `just worker-dev`'s local address.
declare const __IMPORT_API__: string;

export const workerApi = typeof __IMPORT_API__ === "string" ? __IMPORT_API__ : "http://localhost:8787";
```

- [ ] **Step 4: Write `pageHitBeacon.ts`**

```ts
// ABOUTME: Sends one anonymous page-load hit to the worker's POST /hit when a page's document loads.
// ABOUTME: Fire-and-forget: silent under GPC/DNT, without sendBeacon, or on any error.
import { type PageName, privacySignalSet, referrerLabel } from "../core/pageHit";
import { workerApi } from "./workerApi";

export interface BeaconHost {
  navigator: {
    sendBeacon?: (url: string, data: Blob) => boolean;
    globalPrivacyControl?: boolean;
    doNotTrack?: string | null;
  };
  location: { hostname: string };
  document: { referrer: string };
}

/** Call once per document load, never on hash changes. A text/plain body keeps the beacon a CORS
 * simple request, so the browser sends no preflight. */
export function sendPageHit(page: PageName, api: string = workerApi, host: BeaconHost = globalThis as unknown as BeaconHost): void {
  try {
    const nav = host.navigator;
    if (!nav.sendBeacon || privacySignalSet(nav)) return;
    const ref = referrerLabel(host.document.referrer, host.location.hostname);
    nav.sendBeacon(`${api}/hit`, new Blob([JSON.stringify({ page, ref })], { type: "text/plain" }));
  } catch {
    // Counting must never affect the page.
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `just test test/pageHitBeacon.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Pass the worker URL to every bundle**

In `web/scripts/bundle.ts`, directly above `const result = await Bun.build({` (the planner build), add:

```ts
// The worker's base URL: the planner's grimtools gateway and every page's page-load beacon use it.
const workerApiDefine = JSON.stringify(process.env.IMPORT_API ?? "http://localhost:8787");
```

Replace the planner's `__IMPORT_API__: JSON.stringify(process.env.IMPORT_API ?? "http://localhost:8787"),` with `__IMPORT_API__: workerApiDefine,`. Replace each of the three `define: { __ASSET_V__: JSON.stringify(assetVersion) },` lines (rr, monsters, items) with:

```ts
  define: { __ASSET_V__: JSON.stringify(assetVersion), __IMPORT_API__: workerApiDefine },
```

- [ ] **Step 7: Planner uses `workerApi` and sends its hit**

In `web/src/app/main.ts`, replace lines 74-77:

```ts
// The import service. Local development points at `just worker-dev`; the deployed value is
// substituted at build time. Both globals come from bundle.ts's define map.
declare const __IMPORT_API__: string;
declare const __BUILD_ID__: string;
const importApi = typeof __IMPORT_API__ === "string" ? __IMPORT_API__ : "http://localhost:8787";
```

with:

```ts
// Substituted at build time from bundle.ts's define map.
declare const __BUILD_ID__: string;
```

Change `makeWorkerGateway(importApi)` to `makeWorkerGateway(workerApi)`. Add imports next to the `grimtoolsWorkerGateway` import:

```ts
import { workerApi } from "../adapters/workerApi";
import { sendPageHit } from "../adapters/pageHitBeacon";
```

Directly above `boot().catch((e) => {` add:

```ts
sendPageHit("planner");
```

Run `grep -n importApi web/src/app/main.ts` afterwards; expected: no matches.

- [ ] **Step 8: The other three pages send their hits**

In each file, add the import beside the existing `appMenu` import (paths as shown) and the call directly above `boot().catch(`:

- `web/src/rr/app/main.ts`: `import { sendPageHit } from "../../adapters/pageHitBeacon";` and `sendPageHit("rr");`
- `web/src/monsters/app/main.ts`: `import { sendPageHit } from "../../adapters/pageHitBeacon";` and `sendPageHit("monsters");`
- `web/src/items/app/main.ts`: `import { sendPageHit } from "../../adapters/pageHitBeacon";` and `sendPageHit("items");`

Confirm each page's existing `appMenu` import path first (`grep -n appMenu web/src/*/app/main.ts`) and use the same `../../adapters/` prefix it uses.

- [ ] **Step 9: Build and smoke-check**

Run: `just build`
Expected: success. Then:

```bash
grep -l 'localhost:8787/hit\|"/hit"\|/hit`' web/dist -r | head
```

Expected: at least one bundle per page (four `*main-*.js` files) references the hit path. Then run `just e2e` and expect it to pass unchanged: the local build points at `localhost:8787`, so the beacon fails silently in the smoke run.

- [ ] **Step 10: Gate and commit**

Run: `just check`
Expected: PASS, including `i18nBoundary.test.ts`.

```bash
git add web/src/adapters/workerApi.ts web/src/adapters/pageHitBeacon.ts web/test/pageHitBeacon.test.ts web/scripts/bundle.ts web/src/app/main.ts web/src/rr/app/main.ts web/src/monsters/app/main.ts web/src/items/app/main.ts
git commit -m "feat(stats): every page sends one anonymous page-load beacon"
```

---

### Task 4: `just stats` and `just setup-stats-auth`

**Files:**
- Create: `scripts/setup_stats_auth.sh`
- Create: `scripts/stats.py`
- Modify: `justfile` (after the `deploy-worker` recipe, near line 636)

**Interfaces:**
- Consumes: the `grimdawn_devotions_hits` dataset (Task 2); `account_id` in `worker/wrangler.toml`.
- Produces: `just setup-stats-auth`, `just stats [--days N]`.

- [ ] **Step 1: Write `scripts/setup_stats_auth.sh`**

```bash
#!/usr/bin/env bash
# ABOUTME: Stores a read-only Cloudflare Account Analytics token in the macOS keychain for `just stats`.
# ABOUTME: The token is typed into the keychain's own prompt, so it never lands in shell history or argv.
set -euo pipefail

SERVICE="grimdawn-devotions-stats"
ACCOUNT="cloudflare"

if ! command -v security >/dev/null 2>&1; then
  echo "No macOS keychain here. Export GD_STATS_TOKEN=<token> in your shell instead; just stats reads it."
  exit 0
fi
command -v jq >/dev/null 2>&1 || { echo "jq is not installed"; exit 1; }

echo "Create a token at https://dash.cloudflare.com/profile/api-tokens with Account > Account Analytics > Read."
echo "Paste it at the keychain prompt below."
security add-generic-password -U -s "$SERVICE" -a "$ACCOUNT" -w

echo "Verifying the token..."
# The header goes through curl's stdin (-H @-) so the token never appears in any process's argv.
STATUS=$(printf 'Authorization: Bearer %s' "$(security find-generic-password -s "$SERVICE" -a "$ACCOUNT" -w)" \
  | curl -sS -H @- "https://api.cloudflare.com/client/v4/user/tokens/verify" | jq -r '.result.status // "invalid"')
if [ "$STATUS" != "active" ]; then
  security delete-generic-password -s "$SERVICE" -a "$ACCOUNT" >/dev/null
  echo "token is not active (status: $STATUS); removed it from the keychain"
  exit 1
fi
echo "Done. Run: just stats"
```

Note: `$(security find-generic-password ... -w)` is expanded by the shell into `printf`'s arguments; `printf` is a builtin, so it forks no process and exposes no argv, the same reasoning `scripts/setup_worker_auth.sh` uses.

Run: `chmod +x scripts/setup_stats_auth.sh`

- [ ] **Step 2: Write `scripts/stats.py`**

```python
#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
# ABOUTME: Prints page-load counts from the worker's Analytics Engine dataset (POST /hit).
# ABOUTME: Reads a read-only token from GD_STATS_TOKEN or the macOS keychain (see just setup-stats-auth).
import argparse
import json
import os
import shutil
import subprocess
import sys
import tomllib
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATASET = "grimdawn_devotions_hits"
PAGES = ["planner", "rr", "monsters", "items"]


def token() -> str:
    if env := os.environ.get("GD_STATS_TOKEN"):
        return env
    if shutil.which("security"):
        found = subprocess.run(
            ["security", "find-generic-password", "-s", "grimdawn-devotions-stats", "-a", "cloudflare", "-w"],
            capture_output=True,
            text=True,
        )
        if found.returncode == 0:
            return found.stdout.strip()
    sys.exit("No stats token: run `just setup-stats-auth` or set GD_STATS_TOKEN.")


def account_id() -> str:
    with open(ROOT / "worker" / "wrangler.toml", "rb") as f:
        return tomllib.load(f)["account_id"]


def query(sql: str, tok: str, account: str) -> list[dict]:
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{account}/analytics_engine/sql",
        data=f"{sql} FORMAT JSON".encode(),
        headers={"Authorization": f"Bearer {tok}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.load(res)["data"]
    except urllib.error.HTTPError as e:
        sys.exit(f"Analytics Engine SQL API returned {e.code}: {e.read().decode(errors='replace')}")


def since(days: int) -> str:
    return f"timestamp > NOW() - INTERVAL '{days}' DAY"


def print_table(title: str, header: list[str], rows: list[list[str]]) -> None:
    print(f"\n{title}")
    widths = [max(len(str(r[i])) for r in [header, *rows]) for i in range(len(header))]
    for r in [header, *rows]:
        print("  ".join(str(c).rjust(w) if i else str(c).ljust(w) for i, (c, w) in enumerate(zip(r, widths))))


def main() -> None:
    parser = argparse.ArgumentParser(description="Print page-load counts from the worker.")
    parser.add_argument("--days", type=int, default=30, help="look-back window in days (Analytics Engine keeps ~90)")
    args = parser.parse_args()
    tok, account = token(), account_id()
    where = since(args.days)

    daily = query(
        f"SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, blob1 AS page, "
        f"SUM(_sample_interval) AS loads FROM {DATASET} WHERE {where} GROUP BY day, page ORDER BY day",
        tok,
        account,
    )
    by_day: dict[str, dict[str, int]] = {}
    for r in daily:
        by_day.setdefault(r["day"][:10], {})[r["page"]] = int(r["loads"])
    rows = [[day, *(str(c.get(p, 0)) for p in PAGES), str(sum(c.values()))] for day, c in sorted(by_day.items())]
    totals = [sum(c.get(p, 0) for c in by_day.values()) for p in PAGES]
    rows.append(["total", *(str(t) for t in totals), str(sum(totals))])
    print_table(f"Page loads per day, last {args.days} days", ["day", *PAGES, "all"], rows)

    for title, column in (("Top countries", "blob2"), ("Top referrers", "blob3")):
        top = query(
            f"SELECT {column} AS label, SUM(_sample_interval) AS loads FROM {DATASET} "
            f"WHERE {where} GROUP BY label ORDER BY loads DESC LIMIT 15",
            tok,
            account,
        )
        print_table(f"{title}, last {args.days} days", ["label", "loads"], [[r["label"], str(int(r["loads"]))] for r in top])


if __name__ == "__main__":
    main()
```

Run: `chmod +x scripts/stats.py`

`SUM(_sample_interval)` rather than `count()` is Cloudflare's documented way to count Analytics Engine rows, because the engine may sample at high volume.

- [ ] **Step 3: Add the recipes**

In `justfile`, after the `deploy-worker` recipe:

```just
# Store a read-only Cloudflare Account Analytics token for `just stats` (macOS keychain)
[group("web")]
setup-stats-auth:
    bash "{{justfile_directory()}}/scripts/setup_stats_auth.sh"

# Print anonymous page-load counts from the worker's Analytics Engine dataset (e.g. just stats --days 7)
[group("web")]
stats *ARGS:
    uv run "{{justfile_directory()}}/scripts/stats.py" {{ARGS}}
```

- [ ] **Step 4: Verify locally without a token**

Run: `env -u GD_STATS_TOKEN just stats` on a machine where the keychain item does not exist yet.
Expected: exits non-zero with `No stats token: run \`just setup-stats-auth\` or set GD_STATS_TOKEN.` If the keychain item exists, skip this step.

Run: `just lint-py`
Expected: PASS (ruff clean on `scripts/stats.py`).

- [ ] **Step 5: Gate and commit**

Run: `just check`
Expected: PASS.

```bash
git add scripts/setup_stats_auth.sh scripts/stats.py justfile
git commit -m "feat(stats): just stats reads page-load counts; setup-stats-auth stores its token"
```

---

### Task 5: Docs

**Files:**
- Modify: `README.md` (after the "The planner runs entirely in your browser..." paragraph)
- Modify: `ONBOARDING.md` (the worker sentence near line 14; the command list near line 48)
- Modify: `BACKLOG.md` (new section)

- [ ] **Step 1: README disclosure**

After the paragraph ending "open source you can read, fork, and run yourself.", add:

```markdown
Each page load sends one anonymous count (which page, the visitor's country, and the
referring site's domain) to the project's own Cloudflare worker. There are no cookies,
no identifiers, and nothing from your build; browsers with Do Not Track or Global
Privacy Control enabled send nothing.
```

- [ ] **Step 2: ONBOARDING**

Replace "plus one small Cloudflare Worker (`worker/`) whose only job is to fetch a grimtools build past its CORS header, and save one, for the devotion planner's import and export." with:

```markdown
plus one small Cloudflare Worker (`worker/`) that fetches a grimtools build past its CORS header,
and saves one, for the devotion planner's import and export, and counts anonymous page loads
(`POST /hit`) from all four pages.
```

After the `just setup-worker-auth` bullet, add:

```markdown
- Page-load counts (last 30 days by default, `--days N`): `just stats`; one-time token setup: `just setup-stats-auth`
```

- [ ] **Step 3: BACKLOG**

Append a section:

```markdown
## Page-load counter: long-term history

Analytics Engine keeps about three months of `POST /hit` data points, so `just stats`
cannot show trends older than that. If longer history matters, roll monthly totals into
durable storage before they age out. Pointers: a Cron Trigger on the worker
(`[triggers] crons` in `worker/wrangler.toml`) cannot query the SQL API without a
token secret, so the simpler path is a `just stats --rollup` mode in `scripts/stats.py`
that appends last month's per-page totals to a committed `data/page-loads.csv`, run by
hand or by a scheduled GitHub Action holding the read-only token as a secret.
```

- [ ] **Step 4: Gate and commit**

Run: `just check`
Expected: PASS.

```bash
git add README.md ONBOARDING.md BACKLOG.md
git commit -m "docs(stats): disclose the page-load counter and how to read it"
```

---

## Rollout (Ted, after merge)

1. Push to `main`. `deploy-worker.yml` deploys the worker with the new bindings; `deploy.yml` builds the pages with `IMPORT_API=https://grimdawn-devotions-import.grimdawn-devotions.workers.dev` (repository variable `IMPORT_API_URL`, already set).
2. If the worker deploy fails on the `analytics_engine_datasets` binding, open Workers & Pages > Analytics Engine in the Cloudflare dashboard once to enable it, then re-run the workflow. The dataset itself is created by the first write.
3. Load the live site in a browser without GPC or DNT. In devtools' Network tab, expect one `hit` request with status 204.
4. Create the token (Account > Account Analytics > Read), run `just setup-stats-auth`, wait a few minutes, then run `just stats --days 1`. Expect at least the one load from step 3. If the SQL API rejects the query syntax, fix `scripts/stats.py` against Cloudflare's Analytics Engine SQL reference and note it.
