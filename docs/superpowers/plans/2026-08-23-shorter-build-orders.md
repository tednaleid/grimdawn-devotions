# Shorter Build Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harvest roughly 75 real community builds from grimtools.com into a committed test corpus, baseline the build-order search against them, then make the search keep optimizing churn after the first fitting schedule under a deterministic work budget.

**Architecture:** Phase 1 adds a rate-limited headless-Chrome crawler (shared CDP plumbing extracted from `scripts/gt_scrape.ts`), a pure converter that maps grimtools skill ids to our star ids and gates each build, a committed fixture, a regression test, and an extended `order-quality` harness. Phase 2 gives `sampledConstruction` an explicit witness/quality mode split: witness callers keep the early exit (reachability proofs are unchanged), while `buildOrderPath` keeps sampling to the work budget and picks the lowest-churn fitting schedule.

**Tech Stack:** Bun + TypeScript (scripts and web core), chrome-headless-shell over raw CDP (the repo's proven pattern; Playwright transports do not connect under Bun), `just` recipes, `bun test`.

**Spec:** `docs/superpowers/specs/2026-08-23-shorter-build-orders-design.md`

## Global Constraints

- Every new code file starts with a 2-line `// ABOUTME:` comment.
- No emojis, no emdashes, no hyperbole in any doc or comment.
- Use `just` recipes (`just test`, `just check`, `just order-quality`); the pre-commit hook runs the full `just check`, so every commit must be green. NEVER use `--no-verify`.
- `buildOrderPath` stays a pure function of the build set: no wall-clock budgets, no `Date.now()`/`Math.random()` in core; the work budget is a deterministic count.
- Crawler politeness: at least 1500 ms between requests, a hard cap of 400 total requests per run, Chrome's default User-Agent. NEVER set a User-Agent containing `grimdawn-devotions-import` (deliberately blocked by the site owner). The harvest is manual and never runs in CI.
- No user-facing strings change (no UI work), so no i18n catalog work.
- Objective everywhere: churn first (fewest scaffold stars, `churnPoints`), steps second (fewest schedule entries).
- Commit messages follow the repo's conventional style (`feat(...)`, `test(...)`, `docs(...)`) and end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Background an executor needs

- The devotion domain and legality rules: `docs/devotion-system.md`. The engine and its gates: `docs/reachability-engine.md`.
- `web/src/core/reachability.ts` holds the search. Key pieces: `sampledConstruction` (line ~671, the sampler whose `consider()` early-exits at the first budget-fitting schedule), `needDrivenOrder` (greedy generator), `emitSchedule` (the one legality-bearing loop), `buildOrderPath` (line ~972, best-of-two by churn then steps), `buildOrderEscalated` (tries=4096), `churnPoints`, `BuildStep`, `BUDGET = 55`. `ReachCon` is `{ id: string; size: number; req: Vec; grant: Vec }` with `Vec = [number, number, number, number, number]`.
- The independent oracle: `verifyBuildOrder(cons, members, steps, budget): string | null` in `web/src/core/orderLegality.ts` (null means legal).
- grimtools parsing (pure, dependency-free): `extractBuildInfo(html)`, `extractBuildTitle(html)`, `mapStars(skillIds, table)`, `parseSlug` in `web/src/core/grimtools.ts`. A calc page server-renders `window['buildInfo'] = {...}` inline, so fetching the HTML is enough; the page never needs to run.
- The committed sk-id to star-id table: `data/grimtools-stars.json` (`{ dataVersion, gameVersion, generatedUtc, stars: Record<string, string> }`).
- Harness/test idioms to copy: `web/scripts/order-quality.ts` (CSV stdout, aggregates stderr), `web/scripts/reachability-fuzz.ts` (exports `model`, `cons`, `table`, `generateValidBuild`, `mulberry32` for tests), `web/test/build-order-oracle.test.ts` (oracle replay + aggregate pins `CHURN_PIN`/`STEPS_PIN`), `web/test/build-order-tightcap.test.ts` (JSON fixture import).

---

### Task 1: Shared Chrome/CDP module

**Files:**
- Create: `scripts/gt_cdp.ts`
- Reference (copy from, do not modify): `scripts/gt_scrape.ts:27-134`

**Interfaces:**
- Produces: `chromeShellPath(): string`, `launchChrome(dbgPort: number, profileName: string): { kill(): void }`, `pageWsUrl(dbgPort: number): Promise<string>`, `class CDP { static connect(url: string): Promise<CDP>; send(method, params?): Promise<CdpResult>; evaluate<T>(expression: string): Promise<T> }`. Task 3 consumes all of these.

- [ ] **Step 1: Write the module**

Copy the plumbing verbatim from `scripts/gt_scrape.ts` (lines 27-134: `chromeShellPath`, the chrome spawn, `cleanup`, `pageWsUrl`, `CdpResult`, `CDP`), parameterizing the port and profile dir. Do not modify `gt_scrape.ts` or `gt_star_table.ts` (a consolidation follow-up lands in BACKLOG in Task 11).

```ts
// ABOUTME: Shared headless-Chrome + CDP plumbing for the grimtools scraper scripts:
// ABOUTME: locate chrome-headless-shell, launch and kill it, and a minimal CDP client.
import { readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const isWin = process.platform === "win32";

export function chromeShellPath(): string {
  const root = isWin
    ? join(process.env.LOCALAPPDATA ?? "", "ms-playwright")
    : process.platform === "darwin"
      ? join(homedir(), "Library", "Caches", "ms-playwright")
      : join(homedir(), ".cache", "ms-playwright");
  const shellDir = readdirSync(root).find((d) => d.startsWith("chromium_headless_shell-"));
  if (!shellDir) throw new Error("chrome-headless-shell not found; run: just install-e2e");
  const base = join(root, shellDir);
  const platDir = readdirSync(base).find((d) => d.startsWith("chrome-headless-shell-"));
  if (!platDir) throw new Error(`no chrome-headless-shell binary under ${base}`);
  return join(base, platDir, isWin ? "chrome-headless-shell.exe" : "chrome-headless-shell");
}

export function launchChrome(dbgPort: number, profileName: string): { kill(): void } {
  const exe = chromeShellPath();
  const args = [
    `--remote-debugging-port=${dbgPort}`,
    "--remote-allow-origins=*",
    `--user-data-dir=${join(tmpdir(), `${profileName}_${dbgPort}`)}`,
    "--no-sandbox",
    "--no-first-run",
    "--disable-gpu",
    "about:blank",
  ];
  const proc = isWin
    ? Bun.spawn(["cmd.exe", "/c", exe, ...args], { stdout: "ignore", stderr: "ignore" })
    : Bun.spawn([exe, ...args], { stdout: "ignore", stderr: "ignore" });
  return {
    kill(): void {
      if (isWin)
        Bun.spawnSync(["taskkill", "/F", "/IM", "chrome-headless-shell.exe"], { stdout: "ignore", stderr: "ignore" });
      else proc.kill();
    },
  };
}

export async function pageWsUrl(dbgPort: number): Promise<string> {
  for (let i = 0; i < 60; i++) {
    await Bun.sleep(250);
    try {
      const list = (await (await fetch(`http://127.0.0.1:${dbgPort}/json`)).json()) as {
        type: string;
        webSocketDebuggerUrl?: string;
      }[];
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
  }
  throw new Error("chrome debug endpoint never exposed a page target");
}
```

Then append the `CdpResult` type and `CDP` class verbatim from `gt_scrape.ts:83-134`, adding `export` to both.

- [ ] **Step 2: Smoke-verify (not committed)**

Write `<scratchpad>/cdp-probe.ts`:

```ts
import { launchChrome, pageWsUrl, CDP } from "/Users/tednaleid/Library/CloudStorage/Dropbox/code/grimdawn-devotions/scripts/gt_cdp";
const chrome = launchChrome(9419, "gt_probe");
try {
  const cdp = await CDP.connect(await pageWsUrl(9419));
  await cdp.send("Runtime.enable");
  console.log("evaluate:", await cdp.evaluate<number>("1 + 1"));
} finally {
  chrome.kill();
}
```

Run: `bun <scratchpad>/cdp-probe.ts`
Expected: `evaluate: 2`. If chrome-headless-shell is missing, run `just install-e2e` once and retry.

- [ ] **Step 3: Lint and commit**

```bash
just fmt && git add scripts/gt_cdp.ts && git commit -m "feat(scripts): shared headless-Chrome CDP plumbing for grimtools scrapers"
```

---

### Task 2: Scout the grimtools listing structure (no commit)

**Files:** none (deliverable is a findings report for Task 3).

**Interfaces:**
- Produces: verified values for Task 3's `CONFIG` (listing URLs for the three sort views, pagination scheme, detail-link pattern, where the calc link and community title live). Report them verbatim in the task report; the orchestrator threads them into Task 3.

- [ ] **Step 1: Probe with curl first**

```bash
cd <scratchpad>
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
curl -sL -A "$UA" "https://www.grimtools.com/builds/" -o listing.html
wc -c listing.html
grep -oE 'href="[^"]*"' listing.html | sort | uniq -c | sort -rn | head -40
grep -oE '/calc/[A-Za-z0-9_-]{1,24}' listing.html | head -10
```

If `listing.html` is a Cloudflare challenge page (small file, "Just a moment" text), fall back to the CDP module: adapt the Task 1 probe to `Page.navigate` to the listing, poll `document.readyState === "complete"`, then `cdp.evaluate<string>("document.documentElement.outerHTML")` and inspect that instead.

- [ ] **Step 2: Answer the findings checklist**

1. Is the listing server-rendered (do build entries appear in the fetched HTML)?
2. Exact URLs for the three views (most viewed, top rated, recent) and the pagination scheme (query param and its name, or path segments). Look for sort controls in the HTML.
3. Do listing cards link to build detail pages, calc pages, or both? Record the exact href pattern (for example `/builds/12345-some-slug`).
4. On one build detail page (fetch one the same way): where is the calc link (`/calc/<slug>`) and where is the community build title (element or `<title>` pattern)?
5. Roughly how many builds per listing page (so Task 3 can size `maxPagesPerView` to reach about 100 candidates over three views)?

- [ ] **Step 3: Report findings**

Report the checklist answers with the exact URLs and patterns observed. Do not commit anything.

---

### Task 3: Listing crawler `scripts/gt_harvest_builds.ts`

**Files:**
- Create: `scripts/gt_harvest_builds.ts`

**Interfaces:**
- Consumes: `launchChrome`, `pageWsUrl`, `CDP` from `scripts/gt_cdp.ts`; `extractBuildInfo`, `extractBuildTitle` from `web/src/core/grimtools.ts`; Task 2's verified `CONFIG` values.
- Produces: a raw harvest JSON file (CLI: `bun scripts/gt_harvest_builds.ts --out FILE [--target N]`), shape:

```json
{
  "harvestedUtc": "2026-08-23T00:00:00.000Z",
  "grimtoolsDataVersion": "1a801e4bd308",
  "builds": [
    {
      "source": "https://www.grimtools.com/builds/12345-example",
      "title": "Example Warder",
      "slug": "AbCdEfGh",
      "gameVersion": "1.3.0.7",
      "skillIds": ["sk679", "sk680"],
      "devotionPointsLeft": 0
    }
  ]
}
```

`skillIds` is the raw `buildInfo.data.skills[].name` list (mastery skills and devotion stars mixed; Task 4 separates them). `devotionPointsLeft` is `buildInfo.data.bio.devotionPoints` or null.

- [ ] **Step 1: Write the crawler**

The values marked `// scout:` below come from Task 2's report; replace them with the verified ones before running. The crawl navigates to the listing once (real browser context, default UA, cookies), then uses same-origin in-page `fetch` for every subsequent page, so calc pages are parsed from HTML without ever running the calculator.

```ts
// ABOUTME: Harvest real community builds from grimtools.com/builds/ into one raw JSON file:
// ABOUTME: listing crawl plus per-build buildInfo extraction, rate-limited, one headless Chrome.
//
// Usage: bun scripts/gt_harvest_builds.ts --out FILE [--target N]
// Manual and rate-limited (>= 1500 ms between requests, hard cap on total requests).
// Never run from CI. See docs/superpowers/specs/2026-08-23-shorter-build-orders-design.md.
import { writeFileSync } from "node:fs";
import { launchChrome, pageWsUrl, CDP } from "./gt_cdp";
import { extractBuildInfo, extractBuildTitle } from "../web/src/core/grimtools";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const OUT = flag("--out");
const TARGET = Number(flag("--target") ?? 100);
if (!OUT) {
  console.error("usage: bun scripts/gt_harvest_builds.ts --out FILE [--target N]");
  process.exit(2);
}

const ORIGIN = "https://www.grimtools.com";
const CONFIG = {
  // scout: the three views and their pagination scheme, verified in the listing scout.
  listingViews: [
    `${ORIGIN}/builds/?sort=views&page={n}`,
    `${ORIGIN}/builds/?sort=rating&page={n}`,
    `${ORIGIN}/builds/?page={n}`,
  ],
  maxPagesPerView: 3, // scout: sized so three views reach ~100 unique candidates
  delayMs: 1500,
  maxFetches: 400, // politeness: hard cap on total requests, listings plus builds
};
// scout: the listing's detail-page href pattern.
const DETAIL_RE = /href="(\/builds\/(\d+)[^"]*)"/g;
const CALC_RE = /\/calc\/([A-Za-z0-9_-]{1,24})\b/;
const DEVOTION_JSON = `${ORIGIN}/static/gdx3/devotion/devotion.json`;

let fetches = 0;
async function fetchText(cdp: CDP, url: string): Promise<string> {
  if (++fetches > CONFIG.maxFetches) throw new Error(`politeness cap (${CONFIG.maxFetches} requests) hit`);
  await Bun.sleep(CONFIG.delayMs);
  return cdp.evaluate<string>(
    `fetch(${JSON.stringify(url)}).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })`,
  );
}

/** The community title from a detail page's <title>, stripped of the site suffix. */
function detailTitle(html: string): string | null {
  const m = /<title>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return null;
  const t = (m[1] ?? "").split(" - Grim")[0]!.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 100);
  return t.length > 0 ? t : null;
}

interface RawBuild {
  source: string;
  title: string;
  slug: string;
  gameVersion: string;
  skillIds: string[];
  devotionPointsLeft: number | null;
}

const chrome = launchChrome(9418, "gt_harvest");
try {
  const cdp = await CDP.connect(await pageWsUrl(9418));
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.navigate", { url: `${ORIGIN}/builds/` });
  let loaded = false;
  for (let i = 0; i < 60 && !loaded; i++) {
    await Bun.sleep(500);
    loaded = await cdp.evaluate<boolean>(`document.readyState === "complete"`);
  }
  if (!loaded) throw new Error("the builds listing never finished loading");

  const version = await cdp.evaluate<string>(
    `fetch(${JSON.stringify(DEVOTION_JSON)}).then((r) => r.json()).then((j) => String(j.version))`,
  );

  const detailUrls: string[] = [];
  const seenDetail = new Set<string>();
  for (const view of CONFIG.listingViews) {
    for (let page = 1; page <= CONFIG.maxPagesPerView; page++) {
      const html = await fetchText(cdp, view.replace("{n}", String(page)));
      for (const m of html.matchAll(DETAIL_RE)) {
        const u = new URL(m[1]!, ORIGIN).href;
        if (seenDetail.has(u)) continue;
        seenDetail.add(u);
        detailUrls.push(u);
      }
    }
  }
  console.error(`listing crawl: ${detailUrls.length} candidate builds`);

  const builds: RawBuild[] = [];
  const seenSlug = new Set<string>();
  const skips: Record<string, number> = {};
  const skip = (reason: string): void => {
    skips[reason] = (skips[reason] ?? 0) + 1;
  };
  for (const url of detailUrls) {
    if (builds.length >= TARGET) break;
    let detailHtml: string;
    try {
      detailHtml = await fetchText(cdp, url);
    } catch {
      skip("detail-fetch-failed");
      continue;
    }
    const slug = detailHtml.match(CALC_RE)?.[1];
    if (!slug) {
      skip("no-calc-link");
      continue;
    }
    if (seenSlug.has(slug)) {
      skip("duplicate-calc");
      continue;
    }
    seenSlug.add(slug);
    let calcHtml: string;
    try {
      calcHtml = await fetchText(cdp, `${ORIGIN}/calc/${slug}`);
    } catch {
      skip("calc-fetch-failed");
      continue;
    }
    const info = extractBuildInfo(calcHtml);
    if (!info) {
      skip("no-buildinfo");
      continue;
    }
    const bio = (info.data as { bio?: { devotionPoints?: unknown } } | null)?.bio;
    const left = typeof bio?.devotionPoints === "number" ? bio.devotionPoints : null;
    const title = detailTitle(detailHtml) ?? extractBuildTitle(calcHtml) ?? slug;
    builds.push({ source: url, title, slug, gameVersion: info.gameVersion, skillIds: info.skillIds, devotionPointsLeft: left });
    console.error(`ok ${builds.length}/${TARGET}: ${title} (${slug})`);
  }

  writeFileSync(OUT, JSON.stringify({ harvestedUtc: new Date().toISOString(), grimtoolsDataVersion: version, builds }, null, 1));
  console.error(`wrote ${OUT}: ${builds.length} builds; skips ${JSON.stringify(skips)}; requests ${fetches}`);
} finally {
  chrome.kill();
}
```

- [ ] **Step 2: Trial run with a tiny target**

Run: `bun scripts/gt_harvest_builds.ts --out <scratchpad>/raw-trial.json --target 3`
Expected: `wrote ... 3 builds`, each entry carrying a plausible title, a slug, a non-empty `skillIds`, and `devotionPointsLeft` as a number. Inspect the file by hand (`head -c 2000 <scratchpad>/raw-trial.json`). If the listing regexes matched nothing, re-check them against Task 2's findings before touching anything else.

- [ ] **Step 3: Lint and commit**

```bash
just fmt && git add scripts/gt_harvest_builds.ts && git commit -m "feat(scripts): grimtools community-build harvest crawler"
```

---

### Task 4: Converter with gates, TDD

**Files:**
- Create: `web/scripts/build-real-builds-fixture.ts`
- Test: `web/test/real-builds-fixture.test.ts`

**Interfaces:**
- Consumes: `mapStars`, `StarTable` from `../src/core/grimtools`; `repairSelection` from `../src/core/rules`; `buildModel`, `buildReachCons`, `buildCoverTable`, `BUDGET`; `canonicalStarIds` from `../src/core/urlState`; Task 3's raw JSON shape.
- Produces: `convertRawBuild(raw: RawBuild, table: StarTable, known: Set<string>, repair: (stars: string[]) => Set<string>): { ok: FixtureBuild } | { skip: string }` (exported for tests), and the fixture file shape Task 5 commits:

```json
{
  "harvestedUtc": "...",
  "grimtoolsDataVersion": "1a801e4bd308",
  "builds": [{ "source": "...", "calc": "https://www.grimtools.com/calc/AbCd", "title": "...", "starIds": ["bat:0"] }]
}
```

- [ ] **Step 1: Write the failing tests**

```ts
// ABOUTME: Unit tests for the real-build fixture converter's per-build gates: mapping,
// ABOUTME: unknown-star and repair rejection, and the happy-path fixture entry shape.
import { test, expect } from "bun:test";
import { convertRawBuild, type RawBuild } from "../scripts/build-real-builds-fixture";

const table = { sk1: "a:0", sk2: "a:1", sk3: "b:0", sk9: "z:0" };
const known = new Set(["a:0", "a:1", "b:0"]);
const identity = (stars: string[]) => new Set(stars);
const raw = (skillIds: string[]): RawBuild => ({
  source: "https://www.grimtools.com/builds/1-x",
  title: "T",
  slug: "AbCd",
  gameVersion: "1.3.0.7",
  skillIds,
  devotionPointsLeft: 55,
});

test("happy path: mastery ids drop, stars map, entry carries provenance", () => {
  const r = convertRawBuild(raw(["mastery_sk_77", "sk2", "sk1"]), table, known, identity);
  if (!("ok" in r)) throw new Error(`expected ok, got skip: ${(r as { skip: string }).skip}`);
  expect(r.ok.calc).toBe("https://www.grimtools.com/calc/AbCd");
  expect(r.ok.starIds).toEqual(["a:0", "a:1"]); // sorted, deduped
  expect(r.ok.title).toBe("T");
});

test("a build with no mappable devotions is skipped", () => {
  const r = convertRawBuild(raw(["mastery_sk_77"]), table, known, identity);
  expect(r).toEqual({ skip: "no-devotions" });
});

test("a mapped star the model does not know is a loud skip", () => {
  const r = convertRawBuild(raw(["sk9"]), table, known, identity);
  expect("skip" in r && r.skip.startsWith("unknown-star")).toBe(true);
});

test("a selection the planner would repair away is a loud skip", () => {
  const pruning = (stars: string[]) => new Set(stars.slice(1));
  const r = convertRawBuild(raw(["sk1", "sk2"]), table, known, pruning);
  expect("skip" in r && r.skip.startsWith("fails-repair")).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && bun test test/real-builds-fixture.test.ts`
Expected: FAIL, module `../scripts/build-real-builds-fixture` not found.

- [ ] **Step 3: Write the converter**

```ts
// ABOUTME: Turn a raw grimtools harvest (scripts/gt_harvest_builds.ts) into the committed
// ABOUTME: real-build corpus web/test/fixtures/real-builds.json, gated per build and reported.
//
// Usage: bun scripts/build-real-builds-fixture.ts RAW_IN FIXTURE_OUT
// Aborts when the harvest's grimtools data version differs from the committed mapping
// table's (stale table: run `just gt-star-table` first). Skips are per build and loud.
import { readFileSync, writeFileSync } from "node:fs";
import { mapStars, type StarTable } from "../src/core/grimtools";
import { buildModel } from "../src/core/model";
import { buildReachCons, buildCoverTable, BUDGET } from "../src/core/reachability";
import { repairSelection } from "../src/core/rules";
import { canonicalStarIds } from "../src/core/urlState";

export interface RawBuild {
  source: string;
  title: string;
  slug: string;
  gameVersion: string;
  skillIds: string[];
  devotionPointsLeft: number | null;
}
export interface FixtureBuild {
  source: string;
  calc: string;
  title: string;
  starIds: string[];
}

export function convertRawBuild(
  raw: RawBuild,
  table: StarTable,
  known: Set<string>,
  repair: (stars: string[]) => Set<string>,
): { ok: FixtureBuild } | { skip: string } {
  const stars = mapStars(raw.skillIds, table);
  if (stars.length === 0) return { skip: "no-devotions" };
  for (const s of stars) if (!known.has(s)) return { skip: `unknown-star ${s}` };
  const repaired = repair(stars);
  if (repaired.size !== stars.length || stars.some((s) => !repaired.has(s)))
    return { skip: `fails-repair (${stars.length} -> ${repaired.size})` };
  return {
    ok: {
      source: raw.source,
      calc: `https://www.grimtools.com/calc/${raw.slug}`,
      title: raw.title,
      starIds: [...stars].sort(),
    },
  };
}

if (import.meta.main) {
  const [rawPath, outPath] = process.argv.slice(2);
  if (!rawPath || !outPath) {
    console.error("usage: bun scripts/build-real-builds-fixture.ts RAW_IN FIXTURE_OUT");
    process.exit(2);
  }
  const harvest = JSON.parse(readFileSync(rawPath, "utf8")) as {
    harvestedUtc: string;
    grimtoolsDataVersion: string;
    builds: RawBuild[];
  };
  const starsFile = JSON.parse(readFileSync(new URL("../../data/grimtools-stars.json", import.meta.url), "utf8")) as {
    dataVersion: string;
    stars: StarTable;
  };
  if (harvest.grimtoolsDataVersion !== starsFile.dataVersion) {
    console.error(
      `stale mapping table: harvest saw grimtools data ${harvest.grimtoolsDataVersion}, ` +
        `table is ${starsFile.dataVersion}. Run: just gt-star-table`,
    );
    process.exit(2);
  }
  const doc = JSON.parse(readFileSync(new URL("../../data/devotions.json", import.meta.url), "utf8"));
  const model = buildModel(doc);
  const cons = buildReachCons(model);
  const covTable = buildCoverTable(cons);
  const known = new Set(canonicalStarIds(model));
  const repair = (stars: string[]) => repairSelection(model, cons, covTable, new Set(stars), BUDGET);

  const out: FixtureBuild[] = [];
  const skips: Record<string, number> = {};
  for (const raw of harvest.builds) {
    const r = convertRawBuild(raw, starsFile.stars, known, repair);
    if ("skip" in r) {
      skips[r.skip.split(" ")[0]!] = (skips[r.skip.split(" ")[0]!] ?? 0) + 1;
      console.error(`skip ${raw.slug}: ${r.skip} (${raw.source})`);
      continue;
    }
    if (raw.devotionPointsLeft !== null && 55 - raw.devotionPointsLeft !== r.ok.starIds.length)
      console.error(
        `warn ${raw.slug}: mapped ${r.ok.starIds.length} stars but bio says ${55 - raw.devotionPointsLeft} spent ` +
          `(sub-55 earned points or table drift; kept)`,
      );
    out.push(r.ok);
  }
  writeFileSync(
    outPath,
    JSON.stringify(
      { harvestedUtc: harvest.harvestedUtc, grimtoolsDataVersion: harvest.grimtoolsDataVersion, builds: out },
      null,
      1,
    ),
  );
  console.error(`wrote ${outPath}: ${out.length}/${harvest.builds.length} builds; skips ${JSON.stringify(skips)}`);
  if (out.length < 50) {
    console.error("harvest is thin (< 50 mappable builds): investigate the skips before committing");
    process.exit(1);
  }
}
```

Check `repairSelection`'s exact signature at `web/src/core/rules.ts:89` (`(model, cons, table, selected, cap)`) and adjust the call if it differs.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && bun test test/real-builds-fixture.test.ts`
Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
just fmt && git add web/scripts/build-real-builds-fixture.ts web/test/real-builds-fixture.test.ts
git commit -m "feat(scripts): real-build fixture converter with per-build gates"
```

---

### Task 5: Justfile recipe, full harvest, committed fixture

**Files:**
- Modify: `justfile` (beside the `gt-star-table` recipe, in the `deposit` group)
- Modify: `.gitignore` (add `web/test/fixtures/real-builds-raw.json`)
- Create (generated, committed): `web/test/fixtures/real-builds.json`

**Interfaces:**
- Consumes: Task 3's crawler, Task 4's converter.
- Produces: the committed fixture Tasks 6 and 8 read.

- [ ] **Step 1: Add the recipe and gitignore entry**

In `justfile`, after the `gt-star-table` recipe:

```make
# Harvest real community builds from grimtools into the committed order-quality corpus.
# Manual and rate-limited; never run from CI (CI only reads the committed fixture).
[group("deposit")]
[doc("Harvest ~75 real grimtools builds into web/test/fixtures/real-builds.json")]
harvest-real-builds:
    bun "{{justfile_directory()}}/scripts/gt_harvest_builds.ts" --out "{{justfile_directory()}}/web/test/fixtures/real-builds-raw.json"
    cd "{{justfile_directory()}}/web" && bun scripts/build-real-builds-fixture.ts test/fixtures/real-builds-raw.json test/fixtures/real-builds.json
```

Add `web/test/fixtures/real-builds-raw.json` to `.gitignore` (raw scrapes are never committed; keeping the raw file lets the mapping rerun without a recrawl).

- [ ] **Step 2: Run the full harvest**

Run: `just harvest-real-builds`
Expected: several minutes (politeness delays); the converter reports `wrote ... N/M builds` with N >= 50 (target ~75). If N < 50, read the skip lines: `unknown-star`/`fails-repair` skips clustering means table or data drift (run `just gt-star-table`, recrawl); `no-calc-link` clustering means the Task 2 selectors are wrong.

- [ ] **Step 3: Sanity-check the fixture**

```bash
jq '.builds | length' web/test/fixtures/real-builds.json
jq '[.builds[].starIds | length] | min, max' web/test/fixtures/real-builds.json
jq -r '.builds[0]' web/test/fixtures/real-builds.json
```

Expected: length >= 50; star counts in a plausible 10 to 55 range; the first entry shows real provenance URLs.

- [ ] **Step 4: Commit**

```bash
git add justfile .gitignore web/test/fixtures/real-builds.json
git commit -m "feat(test): committed real-build corpus harvested from grimtools"
```

---

### Task 6: Real-build regression gate

**Files:**
- Test (create): `web/test/real-build-order.test.ts`

**Interfaces:**
- Consumes: `web/test/fixtures/real-builds.json` (Task 5); `model`, `cons`, `table` from `../scripts/reachability-fuzz`; `buildOrderPath`, `selectionSummary`, `BUDGET`; `verifyBuildOrder`.
- Produces: the gate later tasks must keep green; `KNOWN_MISSES` as the named-exception mechanism.

- [ ] **Step 1: Write the test**

```ts
// ABOUTME: Real-build corpus gate: every harvested community build must get an oracle-legal
// ABOUTME: order at live settings; a null is a false negative, since real players built these.
import { test, expect } from "bun:test";
import { buildOrderPath, selectionSummary, BUDGET } from "../src/core/reachability";
import { verifyBuildOrder } from "../src/core/orderLegality";
import { model, cons, table } from "../scripts/reachability-fuzz";
import fixtureJson from "./fixtures/real-builds.json";

const fixture = fixtureJson as unknown as {
  grimtoolsDataVersion: string;
  builds: { source: string; calc: string; title: string; starIds: string[] }[];
};

// Builds proven missed at live settings. Every entry must have a BACKLOG investigation item
// (docs/reachability-engine.md playbook); an empty set is the expected steady state.
const KNOWN_MISSES = new Set<string>([]);

test("fixture is populated and every star exists in the model", () => {
  expect(fixture.builds.length).toBeGreaterThanOrEqual(50);
  for (const b of fixture.builds) {
    expect(b.starIds.length).toBeGreaterThan(0);
    for (const s of b.starIds) expect(model.stars.has(s)).toBe(true);
  }
});

test("every real build gets an oracle-legal order at live settings", () => {
  let misses = 0;
  for (const b of fixture.builds) {
    const members = selectionSummary(model, new Set(b.starIds)).built;
    const steps = buildOrderPath(cons, table, members, BUDGET, 16);
    if (!steps) {
      misses++;
      if (!KNOWN_MISSES.has(b.calc)) console.error(`unexpected miss: ${b.calc} (${b.title})`);
      expect(KNOWN_MISSES.has(b.calc)).toBe(true);
      continue;
    }
    const err = verifyBuildOrder(cons, members, steps, BUDGET);
    if (err) console.error(`${b.calc}: ${err}`);
    expect(err).toBeNull();
  }
  expect(misses).toBe(KNOWN_MISSES.size); // a recovered known miss must be removed from the set
});
```

- [ ] **Step 2: Run it**

Run: `cd web && bun test test/real-build-order.test.ts`
Expected: PASS with `KNOWN_MISSES` empty. If a build misses: add its `calc` URL to `KNOWN_MISSES`, and add a BACKLOG item under a new `## Real-build corpus: builds the live search misses` heading naming the calc URL and pointing at the docs/reachability-engine.md playbook. Do not silently drop the build from the fixture.

- [ ] **Step 3: Commit**

```bash
git add web/test/real-build-order.test.ts BACKLOG.md
git commit -m "test(order): real-build corpus must always get an oracle-legal order"
```

(Omit `BACKLOG.md` if there were no misses.)

---

### Task 7: `buildOrderCandidates` refactor (no behavior change) plus witness characterization pin

**Files:**
- Modify: `web/src/core/reachability.ts` (around `buildOrderPath`, line ~972)
- Modify: `web/test/build-order.test.ts` (append two tests)

**Interfaces:**
- Produces: `export interface OrderCandidates { greedy: BuildStep[] | null; sampler: BuildStep[] | null; samplerStepsFirst: BuildStep[] | null }` and `export function buildOrderCandidates(cons: ReachCon[], table: CoverTable, B: ReachCon[], budget?: number, tries?: number, peakNodeCap?: number): OrderCandidates`. `samplerStepsFirst` is always null until Task 9. Task 8's harness and Task 9 consume these. `buildOrderPath`'s signature and behavior are unchanged.

- [ ] **Step 1: Extract the candidates function**

Split `buildOrderPath` so the candidate computation is exported and the pick stays where it is. The bodies move verbatim; only the seam is new:

```ts
/** Both generators' schedules for `B`, before the churn-then-steps pick: the need-driven greedy's
 *  and the sampler's (re-emitted at the cold-path cap, its sampled schedule as fallback).
 *  `samplerStepsFirst` is the steps-first argmin among fitting sampled schedules (null until the
 *  sampler tracks it); the pick itself stays churn-first and lives in buildOrderPath. */
export interface OrderCandidates {
  greedy: BuildStep[] | null;
  sampler: BuildStep[] | null;
  samplerStepsFirst: BuildStep[] | null;
}

export function buildOrderCandidates(
  cons: ReachCon[],
  table: CoverTable,
  B: ReachCon[],
  budget = BUDGET,
  tries = 16,
  peakNodeCap = 3000,
): OrderCandidates {
  B = [...B].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const parts = buildParts(cons, B);
  if (!parts || parts.totalSize > budget) return { greedy: null, sampler: null, samplerStepsFirst: null };
  const nd = needDrivenOrder(cons, B);
  const viaGreedy = nd ? (emitSchedule(nd.order, nd.tail, parts.pool, table, budget)?.steps ?? null) : null;
  const sc = sampledConstruction(cons, table, B, budget, tries, peakNodeCap);
  const viaSampler =
    sc.steps === null ? null : (emitSchedule(sc.order, sc.tail, parts.pool, table, budget)?.steps ?? sc.steps);
  return { greedy: viaGreedy, sampler: viaSampler, samplerStepsFirst: null };
}

export function buildOrderPath(
  cons: ReachCon[],
  table: CoverTable,
  B: ReachCon[],
  budget = BUDGET,
  tries = 16,
  peakNodeCap = 3000,
): BuildStep[] | null {
  const { greedy, sampler } = buildOrderCandidates(cons, table, B, budget, tries, peakNodeCap);
  if (!greedy || !sampler) return greedy ?? sampler;
  const g = churnPoints(greedy);
  const s = churnPoints(sampler);
  if (g !== s) return g < s ? greedy : sampler;
  return greedy.length <= sampler.length ? greedy : sampler;
}
```

Keep the existing doc comment on `buildOrderPath`; move the sentence about the sampler fallback onto `buildOrderCandidates`.

- [ ] **Step 2: Append the pinning tests**

In `web/test/build-order.test.ts` (it already imports `cons`, `table`, `generateValidBuild`, `mulberry32`, `minPeakSampledOrder`; add `buildOrderCandidates`, `buildOrderPath`, `churnPoints` to the import):

```ts
test("buildOrderPath returns one of buildOrderCandidates' schedules", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const B = generateValidBuild(mulberry32(seed));
    const c = buildOrderCandidates(cons, table, B, 55, 16);
    const picked = buildOrderPath(cons, table, B, 55, 16);
    if (!picked) {
      expect(c.greedy).toBeNull();
      expect(c.sampler).toBeNull();
      continue;
    }
    expect([c.greedy, c.sampler]).toContainEqual(picked);
  }
});

// Witness characterization: the reachability-proof path must not move when the sampler
// gains a quality mode. Update this snapshot only for a deliberate witness-path change.
test("witness order characterization over seeds 1..20", () => {
  const orders: Record<string, string[]> = {};
  for (let seed = 1; seed <= 20; seed++) {
    const B = generateValidBuild(mulberry32(seed));
    const o = minPeakSampledOrder(cons, table, B, 55, 16);
    orders[`seed-${seed}`] = o ? o.map((c) => c.id) : [];
  }
  expect(orders).toMatchSnapshot();
});
```

- [ ] **Step 3: Run the full suite**

Run: `cd web && bun test`
Expected: all pass (the refactor is behavior-identical; the oracle test's `CHURN_PIN`/`STEPS_PIN` must not move). A snapshot file is written on first run; rerun to confirm it is stable.

- [ ] **Step 4: Commit**

```bash
git add web/src/core/reachability.ts web/test/build-order.test.ts web/test/__snapshots__
git commit -m "refactor(order): expose buildOrderCandidates behind buildOrderPath, pin witness orders"
```

(Adjust the snapshot path to wherever `bun test` wrote it; the repo already has 2 snapshots to imitate.)

---

### Task 8: Harness extension and baseline capture

**Files:**
- Modify: `web/scripts/order-quality.ts`
- Modify: `docs/superpowers/plans/2026-08-23-shorter-build-orders.md` (fill the Baseline results section)

**Interfaces:**
- Consumes: `buildOrderCandidates`, `churnPoints`, `selectionSummary`, `BUDGET`; the fixture from Task 5.
- Produces: `just order-quality` output extended with a real-corpus section: CSV `build,tries,churn,steps,ms,divergent` on stdout and per-tries aggregates on stderr. Task 10 compares against these numbers.

- [ ] **Step 1: Extend the harness**

Keep the existing synthetic section byte-identical (it is the before/after tool for the 150-seed corpus and the repro hash). Append after it:

Extend the file's existing `../src/core/reachability` import line with `buildOrderCandidates` and `type BuildStep` (one import statement per module, per the lint), add the fixture import, then append:

```ts
import realJson from "../test/fixtures/real-builds.json";

const real = realJson as unknown as { builds: { calc: string; title: string; starIds: string[] }[] };
const TRIES_LADDER = [16, 256, 4096];

const slugOf = (calc: string) => calc.slice(calc.lastIndexOf("/") + 1);
const byChurnThenSteps = (a: BuildStep[], b: BuildStep[]) =>
  churnPoints(a) - churnPoints(b) || a.length - b.length;
const byStepsThenChurn = (a: BuildStep[], b: BuildStep[]) =>
  a.length - b.length || churnPoints(a) - churnPoints(b);

console.log("build,tries,churn,steps,ms,divergent");
const agg = new Map<number, { orders: number; churn: number; steps: number; divergent: number; ms: number }>();
for (const t of TRIES_LADDER) agg.set(t, { orders: 0, churn: 0, steps: 0, divergent: 0, ms: 0 });
for (const b of real.builds) {
  const members = selectionSummary(model, new Set(b.starIds)).built;
  for (const tries of TRIES_LADDER) {
    const t0 = performance.now();
    const c = buildOrderCandidates(cons, table, members, BUDGET, tries);
    const ms = performance.now() - t0;
    const pool = [c.greedy, c.sampler, c.samplerStepsFirst].filter((s): s is BuildStep[] => s !== null);
    if (pool.length === 0) {
      console.log(`${slugOf(b.calc)},${tries},none,none,${ms.toFixed(1)},`);
      continue;
    }
    const pick = [...pool].sort(byChurnThenSteps)[0]!;
    const alt = [...pool].sort(byStepsThenChurn)[0]!;
    const divergent = churnPoints(pick) !== churnPoints(alt) || pick.length !== alt.length;
    const a = agg.get(tries)!;
    a.orders++;
    a.churn += churnPoints(pick);
    a.steps += pick.length;
    a.ms += ms;
    if (divergent) a.divergent++;
    console.log(`${slugOf(b.calc)},${tries},${churnPoints(pick)},${pick.length},${ms.toFixed(1)},${divergent ? 1 : 0}`);
  }
}
for (const tries of TRIES_LADDER) {
  const a = agg.get(tries)!;
  console.error(
    `real corpus @ tries=${tries}: orders=${a.orders}/${real.builds.length} churn=${a.churn} ` +
      `steps=${a.steps} divergent=${a.divergent} mean_ms=${(a.ms / real.builds.length).toFixed(1)}`,
  );
}
```

Also update the file's ABOUTME lines to mention both corpora.

- [ ] **Step 2: Run and record the baseline**

Run: `just order-quality > <scratchpad>/baseline.csv` (the aggregates print on stderr; the CSV lands in the file for later comparison)
Expected at baseline: the tries=16/256/4096 real-corpus churn aggregates are equal or nearly equal for every build that gets an order. That flatness is the early-exit signature the spec predicts; note it explicitly. Paste the three stderr aggregate lines and the synthetic aggregate line into the Baseline results section at the bottom of this plan.

- [ ] **Step 3: Capture the perf baseline**

Run: `just perf`
Paste the reported per-click latency summary (median/p95/p99) into the Baseline results section. Task 10's live-budget decision compares against these numbers.

- [ ] **Step 4: Commit**

```bash
just fmt && git add web/scripts/order-quality.ts docs/superpowers/plans/2026-08-23-shorter-build-orders.md
git commit -m "feat(harness): order-quality runs the real-build corpus with a tries ladder"
```

---

### Task 9: Quality mode in the sampler

**Files:**
- Modify: `web/src/core/reachability.ts` (`sampledConstruction` ~line 671, `SampledConstruction` interface ~line 657, `buildOrderCandidates` from Task 7)
- Test (create): `web/test/order-quality-mode.test.ts`

**Interfaces:**
- Consumes: everything from Task 7.
- Produces: `sampledConstruction(cons, table, B, budget, tries, peakNodeCap, mode: "witness" | "quality" = "witness")`; `SampledConstruction` gains `stepsFirst: BuildStep[] | null`; `buildOrderCandidates` calls the sampler in quality mode and populates `samplerStepsFirst`. `minPeakSampled` and `minPeakSampledOrder` pass nothing extra (witness default), so the reachability verdict path is untouched.

- [ ] **Step 1: Write the failing test**

```ts
// ABOUTME: Quality-mode contract for the sampled construction search: deterministic, monotone
// ABOUTME: in the work budget, and strictly better than first-fit somewhere across both corpora.
import { test, expect } from "bun:test";
import { buildOrderCandidates, churnPoints, selectionSummary, BUDGET, type ReachCon } from "../src/core/reachability";
import { model, cons, table, generateValidBuild, mulberry32 } from "../scripts/reachability-fuzz";
import realJson from "./fixtures/real-builds.json";

const real = realJson as unknown as { builds: { starIds: string[] }[] };

function corpusMembers(): ReachCon[][] {
  const out: ReachCon[][] = [];
  for (let seed = 1; seed <= 150; seed++) out.push(generateValidBuild(mulberry32(seed)));
  for (const b of real.builds) out.push(selectionSummary(model, new Set(b.starIds)).built);
  return out;
}

test("quality search is deterministic and monotone in the work budget", () => {
  let low = 0;
  let high = 0;
  for (const B of corpusMembers()) {
    const c16 = buildOrderCandidates(cons, table, B, BUDGET, 16).sampler;
    const c16again = buildOrderCandidates(cons, table, B, BUDGET, 16).sampler;
    expect(c16again).toEqual(c16); // pure function of the build set
    const c256 = buildOrderCandidates(cons, table, B, BUDGET, 256).sampler;
    if (c16) expect(c256).not.toBeNull(); // more work never loses an order
    if (c16 && c256) {
      expect(churnPoints(c256)).toBeLessThanOrEqual(churnPoints(c16)); // monotone
      low += churnPoints(c16);
      high += churnPoints(c256);
    }
  }
  // The early exit was leaving churn on the table; a bigger budget must actually buy some
  // of it back across 150 synthetic + the real corpus. If this fails after the mode lands,
  // the sampler has no headroom here and the phase-2 premise needs re-examination: STOP and
  // report rather than weakening the assertion.
  expect(high).toBeLessThan(low);
});

test("samplerStepsFirst is a fitting schedule with no more steps than the churn pick", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const B = generateValidBuild(mulberry32(seed));
    const c = buildOrderCandidates(cons, table, B, BUDGET, 64);
    if (!c.sampler) continue;
    expect(c.samplerStepsFirst).not.toBeNull();
    expect(c.samplerStepsFirst!.length).toBeLessThanOrEqual(c.sampler.length);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && bun test test/order-quality-mode.test.ts`
Expected: FAIL. Before the mode exists, tries=16 and tries=256 both stop at the first fit, so `high` equals `low` and the strict `<` fails; `samplerStepsFirst` is null so the second test fails too.

- [ ] **Step 3: Implement the mode**

In `sampledConstruction`:

```ts
type SamplerMode = "witness" | "quality";

interface SampledConstruction {
  peak: number;
  order: ReachCon[];
  tail: ReachCon[];
  steps: BuildStep[] | null;
  stepsFirst: BuildStep[] | null; // quality mode: steps-first argmin among fitting schedules
}
```

Add `mode: SamplerMode = "witness"` as the last parameter. Rework the body:

```ts
  let best = INF;
  let bestOrder: ReachCon[] = [];
  let bestSteps: BuildStep[] | null = null;
  let bestChurn = Infinity; // quality: churn-then-steps argmin among fitting schedules
  let stepsFirst: BuildStep[] | null = null;
  let sfChurn = Infinity;
  // Score a candidate; witness mode returns true when it fits (the caller stops sampling),
  // quality mode always returns false (tries is the deterministic work budget).
  const consider = (candidate: ReachCon[]): boolean => {
    const sched = emitSchedule(candidate, tail, pool, table, budget, peakNodeCap);
    const peak = sched ? sched.peak : INF;
    if (mode === "witness") {
      if (peak < best) {
        best = peak;
        bestOrder = [...candidate];
        bestSteps = sched?.steps ?? null;
      }
      return best <= budget;
    }
    if (sched?.steps) {
      const c = churnPoints(sched.steps);
      const n = sched.steps.length;
      if (bestSteps === null || c < bestChurn || (c === bestChurn && n < bestSteps.length)) {
        best = peak;
        bestOrder = [...candidate];
        bestSteps = sched.steps;
        bestChurn = c;
      }
      if (stepsFirst === null || n < stepsFirst.length || (n === stepsFirst.length && c < sfChurn)) {
        stepsFirst = sched.steps;
        sfChurn = c;
      }
    } else if (bestSteps === null && peak < best) {
      best = peak; // nothing fits yet: keep chasing the lowest peak, as the witness does
      bestOrder = [...candidate];
    }
    return false;
  };
  const done = (): SampledConstruction => ({ peak: best, order: bestOrder, tail, steps: bestSteps, stepsFirst });
  if (consider(order)) return done();
  for (const zeroReqFirst of [true, false]) if (consider(peelOrder(G, zeroReqFirst))) return done();
  // seed + rnd unchanged
  for (let attempt = 0; attempt < tries && (mode === "quality" || best > budget); attempt++) {
    // shuffle unchanged
    consider(order);
  }
  return done();
```

The two early `return { peak: INF, ... }` exits gain `stepsFirst: null`. Update the sampler's block comment: witness mode early-exits at the first fitting schedule (a reachability proof needs nothing more); quality mode spends the whole `tries` budget and keeps the churn-then-steps argmin among fitting schedules, tracking the steps-first argmin alongside for the divergence harness.

In `buildOrderCandidates` (Task 7's function): call `sampledConstruction(cons, table, B, budget, tries, peakNodeCap, "quality")` and return `samplerStepsFirst: sc.stepsFirst` (the sampled-cap schedule; only the churn pick is re-emitted at the cold-path cap, as before). `minPeakSampled` and `minPeakSampledOrder` are untouched.

- [ ] **Step 4: Run the new test, then the full suite**

Run: `cd web && bun test test/order-quality-mode.test.ts`
Expected: PASS. If the strict-improvement assertion fails, per the test comment: stop, capture the numbers, and report to Ted; that outcome would mean first-fit was already optimal on both corpora and phase 2's premise needs re-examination.

Run: `cd web && bun test`
Expected: all pass. The witness snapshot from Task 7 must be unchanged. The oracle test's aggregate pins (`CHURN_PIN = 36`, `STEPS_PIN = 2766` in `web/test/build-order-oracle.test.ts`) may now FAIL in the good direction (measured churn under the pin is a pass; steps pins are ceilings, so only an increase fails). If steps rose above `STEPS_PIN` while churn fell, that is the objective working (churn first, steps second): update the pins per Step 5 rather than reverting.

- [ ] **Step 5: Re-pin the synthetic aggregates**

Run: `just order-quality` and read the synthetic aggregate line. In `web/test/build-order-oracle.test.ts`, set `CHURN_PIN` and `STEPS_PIN` to the new measured values plus ~2% slack, and extend the comment above them with the new measured pair (keep the existing history lines; that comment is the record of deliberate pin moves). The same file pins the reproduction URL's own churn and steps ("meets its quality pins"); if that build's numbers moved, re-pin them from the harness's `repro,...` CSV line by the same rule. Both pins are ceilings: a lower churn passes as is, only a higher step count needs a new pin.

- [ ] **Step 6: Commit**

```bash
git add web/src/core/reachability.ts web/test/order-quality-mode.test.ts web/test/build-order-oracle.test.ts
git commit -m "feat(order): quality-mode sampler keeps optimizing churn after the first fit"
```

---

### Task 10: Calibrate the live budget and the escalation

**Files:**
- Modify: `web/src/core/reachability.ts` (only if the calibration decides a different live `tries` default)
- Modify: `docs/superpowers/plans/2026-08-23-shorter-build-orders.md` (fill the After results section)

**Interfaces:**
- Consumes: Task 8's baseline numbers, Task 9's implementation.
- Produces: the shipped live work budget and the recorded before/after evidence.

- [ ] **Step 1: Measure the after-state**

Run: `just order-quality`. Paste the real-corpus aggregate lines (all three tries levels) and the synthetic aggregate into the After results section below. The headroom curve is now real: churn at 256 and 4096 shows what more work buys.

- [ ] **Step 2: Measure per-click cost and decide the live budget**

Run: `just perf` and compare median/p95/p99 against the Task 8 baseline.

Decision rule: keep the live default `tries = 16` if p95 regresses less than 10% against the baseline; if it regresses more, halve the live default (8, then 4) until it fits; if p95 has more than 10% headroom AND the curve shows churn still falling between 16 and 256, raise the default to 32 and re-measure once. Apply the chosen value to `buildOrderPath`'s default `tries` parameter and the call in `selectionSummary` (reachability.ts ~line 1425) if it differs from 16. Also run the TS-path guard: `cd web && bun test test/reachability-perf-guard.test.ts` must stay green.

- [ ] **Step 3: Confirm the escalation budget**

`buildOrderEscalated` keeps `tries = 4096` and now inherits quality mode through `buildOrderPath`, so the button both recovers missing orders and improves found ones. No code change expected; confirm by reading it and record the After-results line for tries=4096.

- [ ] **Step 4: Full suite and commit**

Run: `cd web && bun test`
Expected: all pass, including the real-build gate and the re-pinned aggregates.

```bash
git add web/src/core/reachability.ts docs/superpowers/plans/2026-08-23-shorter-build-orders.md
git commit -m "feat(order): calibrated live work budget from the real-corpus headroom curve"
```

(Drop `reachability.ts` from the add if the default stayed 16.)

---

### Task 11: Docs, backlog, final gates

**Files:**
- Modify: `docs/reachability-engine.md` (the section describing the build-order search)
- Modify: `BACKLOG.md`

- [ ] **Step 1: Update the living doc**

In `docs/reachability-engine.md`, find the passage describing `buildOrderPath`/the sampled witness and rewrite it in place (evergreen, no changelog phrasing) to state: the sampler has two modes; witness mode early-exits at the first budget-fitting schedule because a reachability proof needs nothing more; quality mode (the panel path) spends a fixed deterministic work budget and returns the churn-then-steps argmin among fitting schedules; the objective is churn first, steps second; the real-build corpus (`web/test/fixtures/real-builds.json`, `just harvest-real-builds`) and `just order-quality`'s tries ladder are the measurement tools.

- [ ] **Step 2: Update the backlog**

Add to `BACKLOG.md`:

- Under a new `## Build-order quality: deferred follow-ups` heading: (1) local improvement (hill-climbing member swaps/reinsertions, directed scaffold shrinking) with a pointer to the spec's "Approaches considered and deferred" section and the measured residual headroom from this plan's After results; (2) steps-first objective revisit, keyed to the harness divergence counter (only if it ever reports meaningful divergence); (3) consolidate `scripts/gt_scrape.ts` and `scripts/gt_star_table.ts` onto `scripts/gt_cdp.ts` (each still carries a private copy of the same plumbing).
- Under "Guided build order: remaining follow-ups": no changes (the background-worker item stays as is).

- [ ] **Step 3: Run the regression gates**

```bash
just check
just fuzz --seeds 500
just build-order-validate
```

Expected: all green. The fuzz and validate runs guard the shared-code seam (witness mode is asserted unchanged, but `sampledConstruction` feeds the verdict path, so prove it).

- [ ] **Step 4: Commit**

```bash
git add docs/reachability-engine.md BACKLOG.md
git commit -m "docs(order): quality-mode search and real-build corpus in the engine doc"
```

---

## Baseline results (filled by Task 8)

- Synthetic corpus aggregate (just order-quality stderr): _recorded at execution_
- Real corpus @ tries=16 / 256 / 4096 (expected ~flat, the early-exit signature): _recorded at execution_
- just perf (median / p95 / p99): _recorded at execution_

## After results (filled by Task 10)

- Synthetic corpus aggregate and new pins: _recorded at execution_
- Real corpus @ tries=16 / 256 / 4096 (the true headroom curve): _recorded at execution_
- just perf (median / p95 / p99) and the chosen live budget: _recorded at execution_
- Divergence counter across both corpora: _recorded at execution_
