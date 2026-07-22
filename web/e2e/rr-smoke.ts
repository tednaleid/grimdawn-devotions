// ABOUTME: Self-contained headless e2e for the built RR page (web/dist/resistance-reduction/).
// ABOUTME: Serves dist, drives Chrome over CDP, asserts table/filter/ledger + hash round-trip, cleans up.
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
const RR = `http://localhost:${server.port}/resistance-reduction/`;

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
const dbgPort = 9222 + Math.floor((server.port % 1000) + 1);
const args = [
  `--remote-debugging-port=${dbgPort}`,
  "--remote-allow-origins=*",
  `--user-data-dir=${join(tmpdir(), `pw_rr_${dbgPort}`)}`,
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
  await cdp.send("Page.navigate", { url: RR });

  const rendered = await waitFor<number>(cdp, "document.querySelectorAll('tr[data-id]').length", (n) => n > 0);
  check(rendered, "page loads and renders table rows");
  const rows = await cdp.evaluate<number>("document.querySelectorAll('tr[data-id]').length");
  check(rows > 300, `renders the full catalogue (${rows} rows)`);

  // Localization: no raw rr.* keys leaked, and source names resolve to real text (not raw tags).
  const leaked = await cdp.evaluate<string[]>("(document.body.innerText.match(/rr\\.[a-zA-Z.]+/g) || [])");
  check(leaked.length === 0, `no raw rr.* keys leak (${leaked.slice(0, 3).join(",")})`);
  const firstName = await cdp.evaluate<string>("document.querySelector('tr[data-id] td.name')?.textContent ?? ''");
  check(firstName.length > 0 && !firstName.startsWith("tag"), `source name resolves: "${firstName.slice(0, 30)}"`);
  // No source shows a raw synthesized key or record path in its name.
  const rawNames = await cdp.evaluate<number>(
    "[...document.querySelectorAll('tr[data-id] td.name')].filter(c => /x:|records\\//.test(c.textContent||'')).length",
  );
  check(rawNames === 0, `no raw x:/record-path source names (${rawNames})`);

  // Filter through the hash: RR-type = stacking narrows the table to stacking rows only.
  await cdp.evaluate(`location.hash = "#rr=stacking"`);
  await waitFor<number>(cdp, "document.querySelectorAll('tr[data-id]').length", (n) => n < rows);
  const stackingRows = await cdp.evaluate<number>("document.querySelectorAll('tr[data-id]').length");
  const allStacking = await cdp.evaluate<boolean>(
    "[...document.querySelectorAll('tr[data-id]')].every(r => r.classList.contains('stacking'))",
  );
  check(stackingRows > 0 && stackingRows < rows && allStacking, `RR-type filter narrows to stacking (${stackingRows})`);

  // Clear the filter, click a row: the ledger computes and the hash records the selection.
  await cdp.evaluate(`location.hash = ""`);
  await waitFor<number>(cdp, "document.querySelectorAll('tr[data-id]').length", (n) => n === rows);
  await cdp.evaluate("document.querySelector('tr[data-id]').click()");
  await waitFor<number>(cdp, "document.querySelectorAll('#rr-ledger .resline').length", (n) => n > 0);
  const reslines = await cdp.evaluate<number>("document.querySelectorAll('#rr-ledger .resline').length");
  check(reslines > 0, `ticking a row computes the ledger (${reslines} resistance lines)`);
  const hash = await cdp.evaluate<string>("location.hash");
  check(hash.includes("sel="), `selection is recorded in the hash (${hash})`);

  // Hash round-trip: reload the captured hash in a fresh load; the selection + ledger restore.
  await cdp.send("Page.navigate", { url: RR + hash });
  const restored = await waitFor<number>(cdp, "document.querySelectorAll('#rr-ledger .resline').length", (n) => n > 0);
  const pressed = await cdp.evaluate<number>("document.querySelectorAll('tr[aria-pressed=\"true\"]').length");
  check(restored && pressed > 0, `a shared hash restores the selection + ledger (${pressed} row selected)`);

  check(cdp.consoleErrors.length === 0, `no console errors (${cdp.consoleErrors.slice(0, 2).join("; ")})`);

  failed = results.some((r) => !r.ok);
} catch (err) {
  console.error(`\nRR E2E ERROR: ${(err as Error).message}`);
  failed = true;
} finally {
  cleanup();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${failed ? "RR E2E FAIL" : "RR E2E PASS"} - ${passed}/${results.length} checks`);
process.exit(failed ? 1 : 0);
