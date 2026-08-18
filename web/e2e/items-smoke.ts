// ABOUTME: Self-contained headless e2e for the built items page (web/dist/items/).
// ABOUTME: Serves dist, drives Chrome over CDP, asserts tree/skill-pick/table + app menu, cleans up.
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
  ".png": "image/png",
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
const ITEMS = `http://localhost:${server.port}/items/`;

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
  `--user-data-dir=${join(tmpdir(), `pw_items_${dbgPort}`)}`,
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
  await cdp.send("Page.navigate", { url: ITEMS });

  // Boot: the mastery radiogroup is populated from the catalogue once loadCatalogue resolves.
  const booted = await waitFor<number>(
    cdp,
    "document.querySelectorAll('#items-mastery [data-mastery]').length",
    (n) => n > 1,
  );
  check(booted, "page loads and the mastery picker is populated from the catalogue");

  // No mastery chosen yet: the tree area shows the hint, not an SVG, and the table is empty
  // (mastery is the entry point into the item list - see docs/superpowers/specs).
  const hintShown = await cdp.evaluate<boolean>("!!document.querySelector('.items-tree-hint')");
  check(hintShown, "no mastery selected: the tree shows its hint instead of a tree");

  // Pick a mastery by clicking a real button, like a user would - not a hash edit, so this also
  // exercises the delegated click listener wired in tableView.ts.
  await cdp.evaluate(`document.querySelector('#items-mastery [data-mastery]').click()`);
  const treeRendered = await waitFor<number>(cdp, "document.querySelectorAll('.tree-node').length", (n) => n > 0);
  const nodeCount = await cdp.evaluate<number>("document.querySelectorAll('.tree-node').length");
  check(treeRendered && nodeCount > 5, `choosing a mastery renders the skill tree (${nodeCount} nodes)`);

  const rowsAfterMastery = await cdp.evaluate<number>("document.querySelectorAll('tr.item-row').length");
  check(rowsAfterMastery > 0, `the table lists items touching that mastery (${rowsAfterMastery} rows)`);

  // Pick one skill node: the table narrows to that node group, and the hash records the skill.
  await cdp.evaluate(`document.querySelector('.tree-node').dispatchEvent(new MouseEvent('click', {bubbles: true}))`);
  const narrowed = await waitFor<number>(
    cdp,
    "document.querySelectorAll('tr.item-row').length",
    (n) => n > 0 && n < rowsAfterMastery,
  );
  const skillRows = await cdp.evaluate<number>("document.querySelectorAll('tr.item-row').length");
  check(narrowed, `picking a skill node narrows the table (${skillRows} of ${rowsAfterMastery} rows)`);
  const hash = await cdp.evaluate<string>("location.hash");
  check(hash.includes("skill="), `the picked skill is recorded in the hash (${hash})`);

  // A second skill WIDENS rather than replaces: the table shows items touching either group.
  // Clicking a node of a different group is the whole point of multi-select, so drive it that way
  // rather than editing the hash.
  await cdp.evaluate(`(() => {
    const first = document.querySelector('.tree-node').getAttribute('data-group');
    const other = [...document.querySelectorAll('.tree-node')].find((n) => n.getAttribute('data-group') !== first);
    other.dispatchEvent(new MouseEvent('click', {bubbles: true}));
  })()`);
  const widened = await waitFor<number>(cdp, "document.querySelectorAll('tr.item-row').length", (n) => n > skillRows);
  const twoSkillRows = await cdp.evaluate<number>("document.querySelectorAll('tr.item-row').length");
  check(widened, `a second skill widens the table (${skillRows} -> ${twoSkillRows} rows)`);
  const twoHash = await cdp.evaluate<string>("location.hash");
  check(/skill=[^&]+,[^&]+/.test(twoHash), "both picked skills are recorded in the hash as one list");

  // Expanding a row shows its per-skill detail (Task 14/16's expanded row).
  await cdp.evaluate(`document.querySelector('tr.item-row').dispatchEvent(new MouseEvent('click', {bubbles: true}))`);
  const detailShown = await waitFor<number>(cdp, "document.querySelectorAll('.item-detail').length", (n) => n > 0);
  check(detailShown, "clicking a row expands its skill-by-skill detail");

  // Localization: no raw items.* keys leak onto the page.
  const leaked = await cdp.evaluate<string[]>("(document.body.innerText.match(/items\\.[a-zA-Z.]+/g) || [])");
  check(leaked.length === 0, `no raw items.* keys leak (${leaked.slice(0, 3).join(",")})`);

  // App menu: the hamburger opens one popover with all three sibling links, the language list,
  // and About - and each link's browser-resolved URL must actually serve (catches a wrong
  // relative depth, the four-edit trap this page's menu wiring is prone to).
  await cdp.evaluate(`document.querySelector('.app-menu-btn').click()`);
  const menuOk = await cdp.evaluate<boolean>(
    `(() => { const p = document.querySelector('.app-menu-panel'); if (!p || p.hidden) return false;
       return !!p.querySelector('a.app-menu-nav') && !!p.querySelector('[data-locale]') && !!p.querySelector('a[href*="github.com"]'); })()`,
  );
  check(menuOk, "app menu opens with cross-app links, the language list, and GitHub");
  const itemsNav = await cdp.evaluate<string[]>(
    `Array.from(document.querySelectorAll('.app-menu-panel a.app-menu-nav')).map((a) => a.href)`,
  );
  const itemsOrigin = new URL(ITEMS).origin;
  check(itemsNav.length === 3, `the app menu links to all three sibling apps (${itemsNav.length})`);
  check(itemsNav.includes(`${itemsOrigin}/`), `it links to the planner (${itemsNav.join(", ")})`);
  check(itemsNav.includes(`${itemsOrigin}/resistance-reduction/`), "it links to the resistance-reduction page");
  check(itemsNav.includes(`${itemsOrigin}/monster-resistances/`), "it links to the monster-resistances page");
  const itemsStatuses = await Promise.all(itemsNav.map(async (h) => (await fetch(h)).status));
  check(
    itemsStatuses.every((s) => s === 200),
    `every app-menu link resolves to a served page (${itemsStatuses.join(", ")})`,
  );

  check(cdp.consoleErrors.length === 0, `no console errors (${cdp.consoleErrors.slice(0, 2).join("; ")})`);

  failed = results.some((r) => !r.ok);
} catch (err) {
  console.error(`\nITEMS E2E ERROR: ${(err as Error).message}`);
  failed = true;
} finally {
  cleanup();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${failed ? "ITEMS E2E FAIL" : "ITEMS E2E PASS"} - ${passed}/${results.length} checks`);
process.exit(failed ? 1 : 0);
