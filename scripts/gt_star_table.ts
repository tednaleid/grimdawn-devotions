// ABOUTME: Regenerates data/grimtools-stars.json, mapping grimtools sk ids to our star ids.
// ABOUTME: Joins grimtools' internal f6I table to devotion.json, then to our own devotions.json.
//
// Usage: bun scripts/gt_star_table.ts
//
// Every count below is asserted before anything is written: a short count means grimtools' data
// moved, which is a thing to look at rather than a table to ship.
import { readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const CALC_URL = "https://www.grimtools.com/calc/qNYgbjeV";
const DEVOTION_JSON = "https://www.grimtools.com/static/gdx3/devotion/devotion.json";
const UA = "grimdawn-devotions-import/1.0 (+https://github.com/tednaleid/grimdawn-devotions)";

const isWin = process.platform === "win32";
function chromeShellPath(): string {
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

const dbgPort = 9417;
const chrome = (() => {
  const exe = chromeShellPath();
  const args = [
    `--remote-debugging-port=${dbgPort}`,
    "--remote-allow-origins=*",
    `--user-data-dir=${join(tmpdir(), `gt_scrape_${dbgPort}`)}`,
    "--no-sandbox",
    "--no-first-run",
    "--disable-gpu",
    "about:blank",
  ];
  return isWin
    ? Bun.spawn(["cmd.exe", "/c", exe, ...args], { stdout: "ignore", stderr: "ignore" })
    : Bun.spawn([exe, ...args], { stdout: "ignore", stderr: "ignore" });
})();

function cleanup(): void {
  if (isWin)
    Bun.spawnSync(["taskkill", "/F", "/IM", "chrome-headless-shell.exe"], {
      stdout: "ignore",
      stderr: "ignore",
    });
  else chrome.kill();
}

async function pageWsUrl(): Promise<string> {
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

/** The slice of a CDP Runtime.evaluate reply this script reads. */
type CdpResult = {
  result?: { value?: unknown };
  exceptionDetails?: { text?: string; exception?: { description?: string } };
};

class CDP {
  private id = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private constructor(private ws: WebSocket) {
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      const p = m.id != null ? this.pending.get(m.id) : undefined;
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message));
      else p.resolve(m.result);
    };
  }
  static connect(url: string): Promise<CDP> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const t = setTimeout(() => reject(new Error("CDP websocket open timeout")), 10_000);
      ws.onopen = () => {
        clearTimeout(t);
        resolve(new CDP(ws));
      };
      ws.onerror = () => {
        clearTimeout(t);
        reject(new Error("CDP websocket error"));
      };
    });
  }
  send(method: string, params: Record<string, unknown> = {}): Promise<CdpResult> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: (v) => resolve(v as CdpResult), reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  /** Evaluate in the page. The caller names the type it expects the expression to return. */
  async evaluate<T>(expression: string): Promise<T> {
    const r = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails)
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? "evaluate failed");
    return r.result?.value as T;
  }
}

/** One expression, run in the page: the whole f6I table, flattened to what the join needs. */
const PROBE = `JSON.stringify(Object.keys(f6I).map((k) => ({
  displayTag: f6I[k].constellation.ta,
  requires: f6I[k].constellation.Va,
  grants: f6I[k].constellation.cb,
  skIds: Object.keys(f6I[k].Ab),
})))`;

function fail(msg: string): never {
  console.error(`REFUSING TO WRITE: ${msg}`);
  process.exit(1);
}

const norm = (o: Record<string, number> | undefined) =>
  Object.entries(o ?? {})
    .sort()
    .map(([k, v]) => `${k}:${v}`)
    .join(",");

type F6Con = { displayTag: string; requires: Record<string, number>; grants: Record<string, number>; skIds: string[] };
type GtCon = { displayTag: string; affinitiesGiven: Record<string, number>; stars: { skill: string }[] };
type OurStar = { index: number; dbr: string; bonuses: Record<string, number> };
type OurCon = { id: string; stars: OurStar[] };

const devotionRes = await fetch(DEVOTION_JSON, { headers: { "User-Agent": UA } });
if (!devotionRes.ok) fail(`devotion.json fetch returned ${devotionRes.status}`);
const devotion = (await devotionRes.json()) as { version: string; constellations: Record<string, GtCon> };

let f6i: F6Con[];
try {
  const cdp = await CDP.connect(await pageWsUrl());
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.navigate", { url: CALC_URL });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    await Bun.sleep(500);
    ready = await cdp.evaluate<boolean>(`typeof f6I === "object" && f6I !== null`);
    if (ready) break;
  }
  if (!ready) fail("the calculator never exposed f6I");
  await Bun.sleep(3000);
  f6i = JSON.parse(await cdp.evaluate<string>(PROBE));
} finally {
  cleanup();
}

const gtCons = Object.keys(devotion.constellations)
  .sort((a, b) => Number(a) - Number(b))
  .map((k) => devotion.constellations[k] as GtCon);

if (f6i.length !== 110) fail(`expected 110 constellations in f6I, got ${f6i.length}`);
if (gtCons.length !== 110) fail(`expected 110 constellations in devotion.json, got ${gtCons.length}`);

const starless = gtCons.filter((c) => c.stars.length === 0);
if (starless.length !== 1)
  fail(`expected exactly one star-less grimtools constellation (the hub art), got ${starless.length}`);

// Join on display tag plus the GRANTED affinity. f6I's `cb` is the grant despite the field order
// suggesting otherwise; the grant is what separates the five same-tagged Crossroads.
const byKey = new Map<string, GtCon>();
for (const c of gtCons) byKey.set(`${c.displayTag}|${norm(c.affinitiesGiven)}`, c);

const skToDbr = new Map<string, string>();
for (const a of f6i) {
  const b = byKey.get(`${a.displayTag}|${norm(a.grants)}`);
  if (!b) fail(`no devotion.json match for ${a.displayTag} granting ${norm(a.grants)}`);
  if (a.skIds.length !== b.stars.length)
    fail(`${a.displayTag}: f6I has ${a.skIds.length} stars, devotion.json has ${b.stars.length}`);
  a.skIds.forEach((sk, j) => {
    skToDbr.set(sk, (b.stars[j] as { skill: string }).skill);
  });
}
if (skToDbr.size !== 559) fail(`expected 559 sk-to-dbr entries, got ${skToDbr.size}`);

const ours = JSON.parse(await Bun.file("data/devotions.json").text()) as {
  meta?: { game_version?: string };
  constellations: OurCon[];
};
const dbrToStarId = new Map<string, string>();
const dbrToBonuses = new Map<string, Record<string, number>>();
for (const c of ours.constellations)
  for (const s of c.stars) {
    dbrToStarId.set(s.dbr, `${c.id}:${s.index}`);
    dbrToBonuses.set(s.dbr, s.bonuses ?? {});
  }
if (dbrToStarId.size !== 559) fail(`expected 559 stars in our data, got ${dbrToStarId.size}`);

const stars: Record<string, string> = {};
for (const [sk, dbr] of skToDbr) {
  const id = dbrToStarId.get(dbr);
  if (!id) fail(`${sk} maps to ${dbr}, which is absent from data/devotions.json`);
  stars[sk] = id;
}
const covered = new Set(Object.values(stars));
if (covered.size !== 559) fail(`expected 559 distinct star ids, got ${covered.size}`);

writeFileSync(
  "data/grimtools-stars.json",
  `${JSON.stringify(
    {
      dataVersion: devotion.version,
      gameVersion: ours.meta?.game_version ?? "",
      generatedUtc: new Date().toISOString(),
      stars,
    },
    null,
    1,
  )}\n`,
  "utf8",
);
console.error(`wrote data/grimtools-stars.json: 559 stars at devotion data version ${devotion.version}`);
