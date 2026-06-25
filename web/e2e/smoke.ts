// ABOUTME: Self-contained headless-browser e2e for the built planner page (web/dist).
// ABOUTME: Serves dist, drives Chrome over a raw CDP client on Bun's native WebSocket, asserts, cleans up.
import { readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const DIST = `${import.meta.dir}/../dist`;
const results: { ok: boolean; msg: string }[] = [];
function check(ok: unknown, msg: string): void {
  results.push({ ok: Boolean(ok), msg });
  console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`);
}

// --- Minimal static server for dist (no external deps) ---
const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
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

// --- Launch headless Chrome with a debug port (macOS/Linux/Windows) ---
// The Playwright cache holds chromium_headless_shell-<rev>/chrome-headless-shell-<plat>/<bin>.
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
const dbgPort = 9222 + Math.floor(server.port % 1000);
const args = [
  `--remote-debugging-port=${dbgPort}`,
  "--remote-allow-origins=*",
  `--user-data-dir=${join(tmpdir(), `pw_e2e_${dbgPort}`)}`,
  "--no-sandbox",
  "--no-first-run",
  "--disable-gpu",
  "about:blank",
];
// On Windows, chrome is launched through cmd.exe (a child of that shell), so it is
// reaped with taskkill; elsewhere we hold the process handle and kill it directly.
const chrome = isWin
  ? Bun.spawn(["cmd.exe", "/c", exe, ...args], { stdout: "ignore", stderr: "ignore" })
  : Bun.spawn([exe, ...args], { stdout: "ignore", stderr: "ignore" });

function cleanup(): void {
  server.stop(true);
  if (isWin)
    Bun.spawnSync(["taskkill", "/F", "/IM", "chrome-headless-shell.exe"], { stdout: "ignore", stderr: "ignore" });
  else chrome.kill();
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
    if ((await cdp.evaluate<number>("document.querySelectorAll('.star').length")) > 0) {
      rendered = true;
      break;
    }
  }
  check(rendered, "page loads and renders the constellation map");

  // Stars render as circles, except the 50 celestial-power stars which are polygons,
  // so count the shared .star class rather than circle.star.
  check((await cdp.evaluate<number>("document.querySelectorAll('.star').length")) === 559, "renders all 559 stars");

  // When reach.wasm is shipped in dist, the engine must actually load it in-browser (not silently
  // fall back to TS); when it is not shipped, the TS fallback is expected and fine.
  const wasmShipped = await Bun.file(`${DIST}/data/reach.wasm`).exists();
  const resolverKind = await cdp.evaluate<string>("window.__reachResolver ?? 'unknown'");
  check(
    wasmShipped ? resolverKind === "wasm" : true,
    `reachability resolver in browser: ${resolverKind}${wasmShipped ? " (wasm shipped, must be wasm)" : " (no wasm shipped, TS ok)"}`,
  );

  const selectable = await cdp.evaluate<string[]>(
    "[...document.querySelectorAll('circle.hit.selectable')].map(c => c.getAttribute('data-star-id'))",
  );
  // Reachability model: from an empty map you can START any constellation still completable
  // within budget (claim-anywhere), not just the Crossroads.
  check(selectable.length > 50, `claim-anywhere: many stars selectable from empty (got ${selectable.length})`);
  check(
    selectable.some((id) => !id.startsWith("crossroads_")),
    "non-Crossroads constellations are claimable from empty",
  );

  // Click a Crossroads star via a bubbling synthetic click (the app delegates on the container).
  await cdp.evaluate(
    `document.querySelector('circle[data-star-id="crossroads_eldritch:0"]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))`,
  );

  let counted = false;
  for (let i = 0; i < 20; i++) {
    await Bun.sleep(100);
    if ((await cdp.evaluate<string>("document.getElementById('point-bar').textContent")).includes("1 used")) {
      counted = true;
      break;
    }
  }
  check(counted, 'the point bar reads "1 used" after selecting a Crossroads');

  // The two-column panel renders the current "have" total in .aff-have (the wanted-max
  // "need" column only appears for colors a started constellation requires).
  check(
    await cdp.evaluate<boolean>("document.querySelector('.affinity-head') !== null"),
    "affinity panel renders the have/need header",
  );
  check(
    (await cdp.evaluate<string | null>("document.querySelector('.affinity-eldritch .aff-have')?.textContent")) === "1",
    "eldritch 'have' total becomes 1",
  );

  // Both columns must always render so the rows stay aligned (here every need is 0; the cells must still exist).
  check(
    await cdp.evaluate<boolean>(
      "document.querySelectorAll('.affinity').length === 5 && document.querySelectorAll('.affinity .aff-have').length === 5 && document.querySelectorAll('.affinity .aff-need').length === 5",
    ),
    "every affinity row has both a have and a need cell (columns stay aligned)",
  );

  // "Available to get" now lives under the Affinity panel (right), separated, not in Benefits (left).
  check(
    await cdp.evaluate<boolean>(
      "(document.getElementById('affinity')?.textContent||'').includes('Available to get') && !!document.querySelector('#affinity .avail-list') && !!document.querySelector('#affinity .panel-sep') && !(document.getElementById('benefits')?.textContent||'').includes('Available to get')",
    ),
    "'Available to get' is under the Affinity panel (right), separated, not in Benefits (left)",
  );

  check(
    await cdp.evaluate<boolean>(
      `document.querySelector('circle[data-star-id="bat:0"]').classList.contains('selectable')`,
    ),
    "bat:0 (an affinity-gated constellation) is claimable",
  );

  check(
    await cdp.evaluate<boolean>(
      `document.querySelector('circle[data-star-id="crossroads_eldritch:0"]').classList.contains('selected')`,
    ),
    "the clicked Crossroads star is marked selected",
  );

  // Hover a celestial-power star and confirm the tooltip shows the proc + ability stats.
  await cdp.evaluate(
    `document.querySelector('circle[data-star-id="akeron_s_scorpion:4"]').dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:200,clientY:200}))`,
  );
  const tip = await cdp.evaluate<string>("document.getElementById('tooltip').textContent");
  check(
    tip.includes("Scorpion Sting") && tip.includes("25% Chance on Attack"),
    "power tooltip shows the proc line (Scorpion Sting, 25% Chance on Attack)",
  );
  check(
    tip.includes("40% Weapon Damage") &&
      tip.includes("1125 Poison Damage over 5 Seconds") &&
      tip.includes("150 Reduced target's Defensive Ability for 5 Seconds"),
    "power tooltip shows the level-25 ability stat lines",
  );

  // "Available to get" is filtered to benefits still reachable from here: with points to spare it
  // lists items, and once every point is spent (cap lowered to the points used) it empties out.
  const availWithBudget = await cdp.evaluate<number>(
    "document.querySelectorAll('#affinity .avail-list .bgroup').length",
  );
  check(
    availWithBudget > 0,
    `"Available to get" lists reachable benefits while budget remains (got ${availWithBudget})`,
  );
  // Pet bonuses have their own "Available to get" list and, when tagged, highlight the stars that
  // grant them as a pet bonus (a pet: tag must hit petBonuses, not player bonuses).
  check(
    await cdp.evaluate<boolean>(
      `(document.getElementById('affinity')?.textContent||'').includes('Bonus to All Pets') && !!document.querySelector('#affinity .bgroup.avail[data-ids^="pet:"]')`,
    ),
    "pet 'Bonus to All Pets' available list is present",
  );
  await cdp.evaluate(
    `(() => { const g = [...document.querySelectorAll('#affinity .bgroup.avail')].find(d => (d.getAttribute('data-ids')||'').startsWith('pet:')); g.querySelector('[data-gtoggle]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); })()`,
  );
  let petMatched = false;
  for (let i = 0; i < 20; i++) {
    await Bun.sleep(100);
    if ((await cdp.evaluate<number>("document.querySelectorAll('.star.match').length")) > 0) {
      petMatched = true;
      break;
    }
  }
  check(petMatched, "tagging a pet bonus highlights the stars that grant it as a pet bonus");
  // Clear the pet tag so the later 'empties' assertion sees a clean filter.
  await cdp.evaluate(
    `(() => { const g = document.querySelector('#affinity .bgroup.avail.gsel[data-ids^="pet:"]'); if (g) g.querySelector('[data-gtoggle]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); })()`,
  );
  // Spend every point: drive the point bar's cap to the validity floor (curMin == points used) so
  // nothing else stays completable. Home sets the cap to curMin via the bar's keydown handler.
  // The empties count below spans BOTH the player and pet avail lists and assumes no benefit tag is
  // active (the pet tag was cleared above); a tagged-but-unobtainable subject stays listed by design.
  await cdp.evaluate(
    `(() => { const b = document.getElementById('point-bar'); b.focus(); b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); })()`,
  );
  let emptiedAvail = false;
  for (let i = 0; i < 20; i++) {
    await Bun.sleep(100);
    if ((await cdp.evaluate<number>("document.querySelectorAll('#affinity .avail-list .bgroup').length")) === 0) {
      emptiedAvail = true;
      break;
    }
  }
  check(emptiedAvail, '"Available to get" empties once every point is spent (cap == points used)');

  // Baseline comparison: set a baseline -> compare mode + cs=; Update Baseline adopts now and exits.
  await cdp.evaluate(`document.getElementById('set-baseline').click()`);
  let cmp = false;
  for (let i = 0; i < 20; i++) {
    await Bun.sleep(100);
    if (await cdp.evaluate<boolean>("document.querySelector('.cmp-bar') !== null")) {
      cmp = true;
      break;
    }
  }
  check(cmp, "Set baseline enters compare mode (.cmp-bar renders)");
  check(await cdp.evaluate<boolean>("location.hash.includes('cs=')"), "baseline rides in the URL as cs=");
  check(
    await cdp.evaluate<boolean>("document.body.classList.contains('comparing')"),
    "body.comparing toggles the widened panel",
  );
  check(
    await cdp.evaluate<boolean>(
      "document.getElementById('cmp-keep') !== null && document.getElementById('cmp-update') !== null",
    ),
    "Keep and Update Baseline controls render",
  );
  await cdp.evaluate(`document.getElementById('cmp-update').click()`);
  check(
    await cdp.evaluate<boolean>("document.querySelector('.cmp-bar') === null && !location.hash.includes('cs=')"),
    "Update Baseline exits compare mode and drops cs= from the URL",
  );

  check(cdp.consoleErrors.length === 0, `no console errors or page exceptions (got ${cdp.consoleErrors.length})`);
  if (cdp.consoleErrors.length) for (const e of cdp.consoleErrors) console.log(`    console: ${e}`);

  failed = results.some((r) => !r.ok);
} catch (err) {
  console.error(`\nE2E ERROR: ${(err as Error).message}`);
  failed = true;
} finally {
  cleanup();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${failed ? "E2E FAIL" : "E2E PASS"} - ${passed}/${results.length} checks`);
process.exit(failed ? 1 : 0);
