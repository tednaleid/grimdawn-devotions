// ABOUTME: Self-contained headless-browser e2e for the built planner page (web/dist).
// ABOUTME: Serves dist, drives Chrome over a raw CDP client on Bun's native WebSocket, asserts, cleans up.
import { readdirSync } from "node:fs";

const DIST = `${import.meta.dir}/../dist`;
const results: { ok: boolean; msg: string }[] = [];
function check(ok: unknown, msg: string): void {
  results.push({ ok: Boolean(ok), msg });
  console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`);
}

// --- Minimal static server for dist (no external deps) ---
const TYPES: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
};
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    let path = new URL(req.url).pathname;
    if (path === "/") path = "/index.html";
    const file = Bun.file(DIST + path);
    if (!(await file.exists())) return new Response("not found", { status: 404 });
    const ext = path.slice(path.lastIndexOf("."));
    return new Response(file, { headers: { "content-type": TYPES[ext] ?? "application/octet-stream" } });
  },
});
const BASE = `http://localhost:${server.port}/`;

// --- Launch headless Chrome with a debug port ---
const msRoot = `${process.env.LOCALAPPDATA}\\ms-playwright`;
const shellDir = readdirSync(msRoot).find((d) => d.startsWith("chromium_headless_shell-"));
if (!shellDir) throw new Error("chrome-headless-shell not found; run: bunx playwright@1.61.0 install chromium");
const exe = `${msRoot}\\${shellDir}\\chrome-headless-shell-win64\\chrome-headless-shell.exe`;
const dbgPort = 9222 + Math.floor(server.port % 1000);
Bun.spawn(["cmd.exe", "/c", exe,
  `--remote-debugging-port=${dbgPort}`, "--remote-allow-origins=*",
  `--user-data-dir=${process.env.TEMP}\\pw_e2e_${dbgPort}`,
  "--no-sandbox", "--no-first-run", "--disable-gpu",
  "about:blank",
], { stdout: "ignore", stderr: "ignore" });

function cleanup(): void {
  server.stop(true);
  Bun.spawnSync(["taskkill", "/F", "/IM", "chrome-headless-shell.exe"], { stdout: "ignore", stderr: "ignore" });
}

// --- Find the page target's websocket url ---
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

// --- Tiny CDP client over native WebSocket ---
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
        this.consoleErrors.push("exception: " + (m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text ?? "unknown"));
      }
    };
  }
  static connect(url: string): Promise<CDP> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const t = setTimeout(() => reject(new Error("CDP websocket open timeout")), 10_000);
      ws.onopen = () => { clearTimeout(t); resolve(new CDP(ws)); };
      ws.onerror = () => { clearTimeout(t); reject(new Error("CDP websocket error")); };
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
    if (r.exceptionDetails) throw new Error("evaluate threw: " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    return r.result.value as T;
  }
}

let failed = true;
try {
  const cdp = await CDP.connect(await pageWsUrl());
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.navigate", { url: BASE });

  // Wait for the app to fetch JSON and render stars.
  let rendered = false;
  for (let i = 0; i < 40; i++) {
    await Bun.sleep(250);
    if ((await cdp.evaluate<number>("document.querySelectorAll('circle.star').length")) > 0) { rendered = true; break; }
  }
  check(rendered, "page loads and renders the constellation map");

  check(await cdp.evaluate<number>("document.querySelectorAll('circle.star').length") === 438,
    "renders all 438 star circles");

  const selectable = await cdp.evaluate<string[]>(
    "[...document.querySelectorAll('circle.hit.selectable')].map(c => c.getAttribute('data-star-id'))");
  check(selectable.length === 5, `exactly 5 selectable stars from empty (got ${selectable.length})`);
  check(selectable.every((id) => id.startsWith("crossroads_")), `all 5 selectable are Crossroads (${selectable.sort().join(", ")})`);

  // Click a Crossroads star via a bubbling synthetic click (the app delegates on the container).
  await cdp.evaluate(
    `document.querySelector('circle[data-star-id="crossroads_eldritch:0"]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))`);

  let counted = false;
  for (let i = 0; i < 20; i++) {
    await Bun.sleep(100);
    if ((await cdp.evaluate<string>("document.getElementById('point-count').textContent")) === "1 / 55") { counted = true; break; }
  }
  check(counted, 'point count reads "1 / 55" after selecting a Crossroads');

  check(await cdp.evaluate<string | null>(
    "document.querySelector('.affinity-eldritch')?.querySelector('span:last-child')?.textContent") === "1",
    "eldritch affinity total becomes 1");

  check(await cdp.evaluate<boolean>(
    `document.querySelector('circle[data-star-id="bat:0"]').classList.contains('selectable')`),
    "bat:0 becomes selectable once its affinity requirement is met");

  check(await cdp.evaluate<boolean>(
    `document.querySelector('circle[data-star-id="crossroads_eldritch:0"]').classList.contains('selected')`),
    "the clicked Crossroads star is marked selected");

  // Hover a celestial-power star and confirm the tooltip shows the proc + ability stats.
  await cdp.evaluate(
    `document.querySelector('circle[data-star-id="akeron_s_scorpion:4"]').dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:200,clientY:200}))`);
  const tip = await cdp.evaluate<string>("document.getElementById('tooltip').textContent");
  check(tip.includes("Scorpion Sting") && tip.includes("25% Chance on Attack"),
    "power tooltip shows the proc line (Scorpion Sting, 25% Chance on Attack)");
  check(tip.includes("40% Weapon Damage") && tip.includes("1125 Poison Damage over 5 Seconds")
    && tip.includes("150 Reduced target's Defensive Ability for 5 Seconds"),
    "power tooltip shows the level-25 ability stat lines");

  check(cdp.consoleErrors.length === 0, `no console errors or page exceptions (got ${cdp.consoleErrors.length})`);
  if (cdp.consoleErrors.length) for (const e of cdp.consoleErrors) console.log("    console: " + e);

  failed = results.some((r) => !r.ok);
} catch (err) {
  console.error("\nE2E ERROR: " + (err as Error).message);
  failed = true;
} finally {
  cleanup();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${failed ? "E2E FAIL" : "E2E PASS"} - ${passed}/${results.length} checks`);
process.exit(failed ? 1 : 0);
