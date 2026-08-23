// ABOUTME: Harvest real community builds from grimtools.com into one raw JSON file: the site's
// ABOUTME: own catalog file plus per-build calc-page buildInfo extraction, one headless Chrome.
//
// Usage: bun scripts/gt_harvest_builds.ts --out FILE [--target N]
// Manual and rate-limited (>= 1500 ms between requests, hard cap on total requests).
// Never run from CI. See docs/superpowers/specs/2026-08-23-shorter-build-orders-design.md.
import { writeFileSync } from "node:fs";
import { launchChrome, pageWsUrl, CDP } from "./gt_cdp";
import { extractBuildInfo } from "../web/src/core/grimtools";

const ORIGIN = "https://www.grimtools.com";
const CONFIG = {
  delayMs: 1500,
  maxFetches: 400, // politeness: hard cap on total requests, catalog plus calc pages
};
const DEVOTION_JSON = `${ORIGIN}/static/gdx3/devotion/devotion.json`;

let fetches = 0;
async function fetchText(cdp: CDP, url: string): Promise<string> {
  if (++fetches > CONFIG.maxFetches) throw new Error(`politeness cap (${CONFIG.maxFetches} requests) hit`);
  await Bun.sleep(CONFIG.delayMs);
  return cdp.evaluate<string>(
    `fetch(${JSON.stringify(url)}).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })`,
  );
}

/** One catalog entry of grimtools' static builds dataset, the fields this harvest reads. */
export interface CatalogBuild {
  buildId: string;
  buildName: string;
  buildVersion: string;
  cls1: number;
  cls2: number;
  createdDate: number;
  url: string;
  youtubeVideoId: string;
}

/** The builds array out of data.js (`window["builds"]=[...];window["authors"]={...}`). */
export function parseCatalog(js: string): CatalogBuild[] {
  const marker = '"builds"]=';
  const markerAt = js.indexOf(marker);
  const start = markerAt < 0 ? -1 : js.indexOf("[", markerAt + marker.length);
  const end = js.indexOf(';window["authors"]');
  if (start < 0 || end < 0 || end < start) throw new Error("data.js: builds array not found");
  return JSON.parse(js.slice(start, end)) as CatalogBuild[];
}

/** Newest-first round-robin across mastery pairs: diversity across masteries, recency within each pair. */
export function pickCandidates(builds: CatalogBuild[], target: number): CatalogBuild[] {
  const byPair = new Map<string, CatalogBuild[]>();
  for (const b of [...builds].sort((a, c) => c.createdDate - a.createdDate)) {
    const key = [b.cls1, b.cls2].sort((x, y) => x - y).join("+");
    const list = byPair.get(key);
    if (list) list.push(b);
    else byPair.set(key, [b]);
  }
  const queues = [...byPair.values()];
  const out: CatalogBuild[] = [];
  for (let round = 0; out.length < target; round++) {
    let any = false;
    for (const q of queues) {
      const b = q[round];
      if (!b) continue;
      any = true;
      out.push(b);
      if (out.length >= target) break;
    }
    if (!any) break;
  }
  return out;
}

/** The community title, sanitized the way the planner sanitizes upstream text: no angle brackets, one space between words, capped. */
function cleanTitle(name: string, fallback: string): string {
  const t = name.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 100);
  return t.length > 0 ? t : fallback;
}

/** Where a build's guide lives: the catalog's url, else its video, else the listing itself. */
function sourceOf(b: CatalogBuild): string {
  if (b.url) return b.url;
  if (b.youtubeVideoId) return `https://www.youtube.com/watch?v=${b.youtubeVideoId}`;
  return `${ORIGIN}/builds/`;
}

interface RawBuild {
  source: string;
  title: string;
  slug: string;
  gameVersion: string;
  skillIds: string[];
  devotionPointsLeft: number | null;
}

if (import.meta.main) {
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

    const src = await cdp.evaluate<string | null>(
      `document.querySelector('script[src^="/static/builds/data.js"]')?.getAttribute("src") ?? null`,
    );
    if (!src) throw new Error("data.js script tag not found on /builds/");

    const catalog = parseCatalog(await fetchText(cdp, new URL(src, ORIGIN).href));
    console.error(`catalog: ${catalog.length} builds`);

    const candidates = pickCandidates(catalog, TARGET * 2);

    const builds: RawBuild[] = [];
    const skips: Record<string, number> = {};
    const skip = (reason: string): void => {
      skips[reason] = (skips[reason] ?? 0) + 1;
    };
    for (const c of candidates) {
      if (builds.length >= TARGET) break;
      let calcHtml: string;
      try {
        calcHtml = await fetchText(cdp, `${ORIGIN}/calc/${c.buildId}`);
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
      const title = cleanTitle(c.buildName, c.buildId);
      builds.push({
        source: sourceOf(c),
        title,
        slug: c.buildId,
        gameVersion: info.gameVersion,
        skillIds: info.skillIds,
        devotionPointsLeft: left,
      });
      console.error(`ok ${builds.length}/${TARGET}: ${title} (${c.buildId})`);
    }

    writeFileSync(
      OUT,
      JSON.stringify({ harvestedUtc: new Date().toISOString(), grimtoolsDataVersion: version, builds }, null, 1),
    );
    console.error(`wrote ${OUT}: ${builds.length} builds; skips ${JSON.stringify(skips)}; requests ${fetches}`);
  } finally {
    chrome.kill();
  }
}
