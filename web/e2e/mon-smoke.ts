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
