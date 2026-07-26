// ABOUTME: Self-contained headless e2e for the built monsters page (web/dist/monster-resistances/).
// ABOUTME: Serves dist, drives Chrome over CDP, asserts ranking/table render + hash round-trip, cleans up.
import { readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const DIST = `${import.meta.dir}/../dist`;
const results: { ok: boolean; msg: string }[] = [];
function check(ok: unknown, msg: string): void {
  results.push({ ok: Boolean(ok), msg });
  console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`);
}

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".map": "application/json",
};
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    let path = new URL(req.url).pathname;
    if (path.endsWith("/")) path += "index.html";
    const file = Bun.file(DIST + path);
    if (!(await file.exists())) return new Response("not found", { status: 404 });
    const ext = path.slice(path.lastIndexOf("."));
    return new Response(file, { headers: { "content-type": TYPES[ext] ?? "application/octet-stream" } });
  },
});
const MON = `http://localhost:${server.port}/monster-resistances/`;

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

const exe = chromeShellPath();
const dbgPort = 9222 + Math.floor((server.port % 1000) + 2);
const args = [
  `--remote-debugging-port=${dbgPort}`,
  "--remote-allow-origins=*",
  `--user-data-dir=${join(tmpdir(), `pw_mon_${dbgPort}`)}`,
  "--no-sandbox",
  "--no-first-run",
  "--disable-gpu",
  "about:blank",
];
const chrome = isWin
  ? Bun.spawn(["cmd.exe", "/c", exe, ...args], { stdout: "ignore", stderr: "ignore" })
  : Bun.spawn([exe, ...args], { stdout: "ignore", stderr: "ignore" });

function cleanup(): void {
  server.stop(true);
  if (isWin)
    Bun.spawnSync(["taskkill", "/F", "/IM", "chrome-headless-shell.exe"], { stdout: "ignore", stderr: "ignore" });
  else chrome.kill();
}

async function pageWsUrl(): Promise<string> {
  for (let i = 0; i < 60; i++) {
    await Bun.sleep(250);
    try {
      const list = (await (await fetch(`http://127.0.0.1:${dbgPort}/json`)).json()) as any[];
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
  }
  throw new Error("chrome debug endpoint never exposed a page target");
}

class CDP {
  private id = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  readonly consoleErrors: string[] = [];
  private constructor(private ws: WebSocket) {
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (m.id != null && this.pending.has(m.id)) {
        const p = this.pending.get(m.id)!;
        this.pending.delete(m.id);
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
        this.consoleErrors.push(m.params.args.map((a: any) => a.value ?? a.description ?? "").join(" "));
      } else if (m.method === "Runtime.exceptionThrown") {
        this.consoleErrors.push(
          `exception: ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text ?? "unknown"}`,
        );
      }
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
  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate<T>(expression: string): Promise<T> {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails)
      throw new Error(`evaluate threw: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value as T;
  }
}

async function waitFor<T>(cdp: CDP, expr: string, ok: (v: T) => boolean, tries = 40): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    await Bun.sleep(150);
    if (ok(await cdp.evaluate<T>(expr))) return true;
  }
  return false;
}

let failed = true;
try {
  const cdp = await CDP.connect(await pageWsUrl());
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.navigate", { url: MON });

  // The page loads and the ranking renders ten rows (one per damage type), physical first.
  const rendered = await waitFor<number>(cdp, "document.querySelectorAll('.rank-row').length", (n) => n === 10);
  check(rendered, "page loads and the ranking renders ten rows");
  const firstType = await cdp.evaluate<string>("document.querySelector('.rank-row')?.getAttribute('data-type') ?? ''");
  check(firstType === "physical", `ranking is ordered by mean, weakest first (${firstType})`);

  // The table renders rows for the default (unfiltered) view.
  const tableRows = await cdp.evaluate<number>("document.querySelectorAll('#mon-table tbody tr[data-id]').length");
  check(tableRows > 1000, `the table renders rows for the default view (${tableRows})`);

  // Geometry, not just content: an unscoped `main { display: grid; grid-template-columns: ... }`
  // rule in the shared styles.css once put ranking/controls/table side by side in one row
  // (each squeezed into its own column) instead of stacked, and every content-only assertion
  // above stayed green through that. Pin the actual layout: the three sections stack top to
  // bottom, and the table is not clipped to a narrow grid track.
  const geometry = await cdp.evaluate<{
    rankBottom: number;
    controlsTop: number;
    controlsBottom: number;
    tableTop: number;
    scrollWidth: number;
  }>(
    `(() => {
      const rank = document.getElementById('mon-rank').getBoundingClientRect();
      const controls = document.getElementById('mon-controls').getBoundingClientRect();
      const table = document.getElementById('mon-table-section').getBoundingClientRect();
      const scroll = document.querySelector('.table-scroll').getBoundingClientRect();
      return { rankBottom: rank.bottom, controlsTop: controls.top, controlsBottom: controls.bottom,
        tableTop: table.top, scrollWidth: scroll.width };
    })()`,
  );
  check(
    geometry.controlsTop >= geometry.rankBottom && geometry.tableTop >= geometry.controlsBottom,
    `ranking, controls and table stack vertically (rankBottom=${geometry.rankBottom.toFixed(0)}, ` +
      `controlsTop=${geometry.controlsTop.toFixed(0)}, controlsBottom=${geometry.controlsBottom.toFixed(0)}, ` +
      `tableTop=${geometry.tableTop.toFixed(0)})`,
  );
  check(
    geometry.scrollWidth >= 800,
    `the table's scroll container is not clipped (width=${geometry.scrollWidth.toFixed(0)}px)`,
  );

  // Localization: monster names resolve through the game tag tables, not raw tags or catalogue keys.
  const firstName = await cdp.evaluate<string>(
    "document.querySelector('#mon-table tbody tr[data-id] td.m-name')?.textContent ?? ''",
  );
  check(
    firstName.length > 0 && !firstName.startsWith("tag") && !firstName.startsWith("monsters."),
    `monster name resolves via gameText, not a raw tag: "${firstName.slice(0, 30)}"`,
  );

  // A hash with filters set (difficulty, tier, search) restores that exact state on a fresh load.
  const hash = "#diff=elite&tier=Boss&q=a";
  await cdp.send("Page.navigate", { url: MON + hash });
  await waitFor<number>(cdp, "document.querySelectorAll('.rank-row').length", (n) => n === 10);
  const restoredDiff = await cdp.evaluate<string>("document.querySelector('#mon-diff')?.value ?? ''");
  const restoredTier = await cdp.evaluate<string>(
    `document.querySelector('.chip[data-facet="tier"][data-val="Boss"]')?.getAttribute('aria-pressed') ?? ''`,
  );
  const restoredQ = await cdp.evaluate<string>("document.querySelector('#mon-q')?.value ?? ''");
  const restoredRows = await cdp.evaluate<number>("document.querySelectorAll('#mon-table tbody tr[data-id]').length");
  check(
    restoredDiff === "elite" &&
      restoredTier === "true" &&
      restoredQ === "a" &&
      restoredRows > 0 &&
      restoredRows < tableRows,
    `a filtered hash restores diff/tier/search on load (diff=${restoredDiff}, boss=${restoredTier}, q="${restoredQ}", rows=${restoredRows})`,
  );

  // Selecting Ascendant keeps the table populated and records itself in the hash.
  await cdp.evaluate(`(() => {
    const s = document.querySelector('#mon-diff');
    s.value = 'ascendant';
    s.dispatchEvent(new Event('change'));
  })()`);
  await waitFor<string>(cdp, "location.hash", (h) => h.includes("diff=ascendant"));
  const ascRows = await cdp.evaluate<number>("document.querySelectorAll('#mon-table tbody tr[data-id]').length");
  check(ascRows > 0, `ascendant keeps the table populated (${ascRows})`);
  check((await cdp.evaluate<string>("location.hash")).includes("diff=ascendant"), "ascendant is recorded in the hash");
  // The note is data-derived, so it must actually render while the two rows match.
  const notes = await cdp.evaluate<number>("document.querySelectorAll('.ctl-note').length");
  check(notes === 1, `the derived difficulty note renders on ascendant (${notes})`);

  // The search clear button. Its visibility is pure CSS (`input:placeholder-shown + .search-clear`),
  // which no markup test can see, so the rendered geometry is asserted here instead.
  await cdp.evaluate(`(() => {
    const q = document.querySelector('#mon-q');
    q.value = 'kaisan';
    q.dispatchEvent(new Event('input'));
  })()`);
  const clearShown = await cdp.evaluate<number>("document.querySelector('#mon-q-clear').getBoundingClientRect().width");
  check(clearShown > 0, `the search clear button is visible once text is typed (${clearShown}px)`);
  await cdp.evaluate("document.querySelector('#mon-q-clear').click()");
  const afterClear = await cdp.evaluate<string>("document.querySelector('#mon-q').value");
  const clearHidden = await cdp.evaluate<number>(
    "document.querySelector('#mon-q-clear').getBoundingClientRect().width",
  );
  check(afterClear === "", `clicking it empties the search box ("${afterClear}")`);
  check(clearHidden === 0, `and the button hides itself again on an empty box (${clearHidden}px)`);
  check(!(await cdp.evaluate<string>("location.hash")).includes("q="), "clearing the search drops q from the hash");

  // App menu: this page must offer BOTH siblings, not just the planner. `a.href` reports the
  // browser-resolved absolute URL, so a wrong relative depth (the bug this covers) shows up here,
  // and fetching each one proves the target actually serves rather than merely being well-formed.
  await cdp.evaluate(`document.querySelector('.app-menu-btn').click()`);
  const navHrefs = await cdp.evaluate<string[]>(
    `Array.from(document.querySelectorAll('.app-menu-panel a.app-menu-nav')).map((a) => a.href)`,
  );
  check(navHrefs.length === 2, `the app menu links to both sibling apps (${navHrefs.length})`);
  const origin = new URL(MON).origin;
  check(navHrefs.includes(`${origin}/`), `it links to the planner (${navHrefs.join(", ")})`);
  check(navHrefs.includes(`${origin}/resistance-reduction/`), "it links to the resistance-reduction page");
  const navStatuses = await Promise.all(navHrefs.map(async (h) => (await fetch(h)).status));
  check(
    navStatuses.every((s) => s === 200),
    `every app-menu link resolves to a served page (${navStatuses.join(", ")})`,
  );

  check(cdp.consoleErrors.length === 0, `no console errors (${cdp.consoleErrors.slice(0, 2).join("; ")})`);

  failed = results.some((r) => !r.ok);
} catch (err) {
  console.error(`\nMONSTERS E2E ERROR: ${(err as Error).message}`);
  failed = true;
} finally {
  cleanup();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${failed ? "MONSTERS E2E FAIL" : "MONSTERS E2E PASS"} - ${passed}/${results.length} checks`);
process.exit(failed ? 1 : 0);
