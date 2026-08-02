// ABOUTME: Scrape a grimtools.com/calc/<id> build into one JSON file via headless Chrome + CDP.
// ABOUTME: Captures gear, skills, devotions and the character sheet in three named buff states.
//
// Usage: bun scripts/gt_scrape.ts <calc-url> <out.json>
//
// The build is not server-rendered and there is no API call to intercept: the whole
// character is encoded in the URL slug and decoded client side, so the page has to run.
// Playwright's own transports do not connect under Bun on Windows (see web/e2e/smoke.ts),
// hence the raw CDP client here.
import { readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const URL_TO_LOAD = process.argv[2];
const OUT = process.argv[3];
if (!URL_TO_LOAD || !OUT) {
  console.error("usage: bun scripts/gt_scrape.ts <calc-url> <out.json>");
  process.exit(2);
}

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

const dbgPort = 9412;
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

// One expression, run in the page. Everything the audit needs, so a rerun is deterministic
// rather than a sequence of hand-authored probes.
const PROBE = String.raw`(() => {
  // Hidden character-sheet tabs are in the DOM but have no innerText, so read textContent:
  // 160+ stats arrive instead of the ~19 the summary panel shows.
  const readStats = () => {
    const s = {};
    document.querySelectorAll("[stat]").forEach((el) => {
      const k = el.getAttribute("stat");
      const v = (el.textContent || "").trim();
      if (k && v && !(k in s)) s[k] = v;
    });
    return s;
  };
  const RES = ["resFire","resCold","resLightning","resPoison","resPierce","resBleeding",
               "resLife","resAether","resChaos","resPhysical",
               "resStun","resFreeze","resPetrify","resTotalSpeedResistance","resTrap",
               "resSlowLifeLeach","resDisruption"];
  // The panel shows the CAPPED value, so 80% may sit on a huge cushion or none and they
  // look identical. Only the hover tooltip carries "(+N% Over Maximum)".
  const overcap = () => {
    const out = {};
    for (const r of RES) {
      const el = document.querySelector('[stat="' + r + '"]');
      if (!el) { out[r] = null; continue; }
      try { $(el).trigger("mouseenter"); } catch (e) {}
      const tip = [...document.querySelectorAll(".tooltip-v2")]
        .map((n) => (n.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean).pop() || "";
      const m = tip.match(/\(\s*([+-]?\d+)%\s*Over Maximum\s*\)/i);
      // Stats in hidden tabs carry their label in the same node ("Stun Resist80%"),
      // so drop everything before the first digit or sign.
      const shown = el.textContent.trim().replace(/^[^0-9+-]*/, "");
      out[r] = { shown, over: m ? Number(m[1]) : 0 };
      try { $(el).trigger("mouseleave"); } catch (e) {}
    }
    return out;
  };
  // .buff-row does not exist until the panel is opened.
  const openPanel = () => {
    if (!document.querySelectorAll(".buff-row").length)
      document.querySelector(".buff-toggle.text-image-button")?.click();
  };
  const catalogue = () => [...document.querySelectorAll(".buff-group")].map((g) => ({
    group: (g.textContent || "").trim().split(/\s{2,}|\n/)[0],
    rows: [...g.querySelectorAll(".buff-row")].map((r) => ({
      name: r.querySelector(".buff-name")?.textContent.trim(),
      source: r.querySelector(".buff-source")?.textContent.trim(),
      state: /buff-locked/.test(r.className) ? "locked"
           : /buff-off/.test(r.className) ? "off" : "on",
    })),
  }));
  const header = () => document.querySelector(".buff-popup-header")?.textContent.trim();
  // Toggling REPLACES the row element, so a held reference goes stale: re-query by name.
  const turnOn = (names) => {
    const hit = [];
    for (const name of names) {
      const row = [...document.querySelectorAll(".buff-row")]
        .find((r) => (r.querySelector(".buff-name")?.textContent || "").trim().startsWith(name));
      if (row && /buff-off/.test(row.className)) { row.click(); hit.push(name); }
    }
    return hit;
  };

  // Difficulty is a viewer control, and it moves every resistance: Elite subtracts 25 and
  // Ultimate 50 from the player's totals, so the same character reads +79 poison overcap on
  // Normal and +29 on Ultimate. Force Ultimate before reading anything, because that is the
  // difficulty the numbers have to be judged at.
  const difficultyLabel = () =>
    ([...document.querySelectorAll(".difficulty-selector-popup a")]
      .map((a) => a.textContent.trim())
      .find((n) => (document.querySelector(".difficulty-selector")?.textContent || "").startsWith(n))) || "unknown";
  const difficultyAsShared = difficultyLabel();
  const ult = [...document.querySelectorAll(".difficulty-selector-popup a")]
    .find((a) => a.textContent.trim() === "Ultimate");
  if (ult) ult.click();

  const out = {
    url: location.href,
    difficultyAsShared,
    difficulty: difficultyLabel(),
    className: getCombinedClassName(),
    gameVersion: buildInfo.created_for_build,
    masteries: buildInfo.masteries,
    bio: buildInfo.data.bio,
    equipmentRaw: buildInfo.data.equipment,
    items: dumpItems(),
    skills: dumpSkills(),
    devotions: dumpDevotion(),
    itemSkills: buildInfo.data.itemSkills,
    potions: buildInfo.data.potions,
    states: {},
  };
  openPanel();
  out.buffCatalogue = catalogue();

  // Shared builds arrive with most buffs OFF, so the "as shared" column understates
  // everything defensive. Report named states, never one ambiguous column.
  out.states.asShared = { header: header(), stats: readStats(), overcap: overcap() };

  const SUSTAINED = ["Pneumatic Burst","Word of Renewal","Lethal Assault","Barrier","Deadly Aim",
                     "Blood of Dreeg","Ascension","Inner Focus","Maiven's Sphere of Protection",
                     "Prismatic Diamond","Turn of Fate","Vindictive Flame","Menhir's Will"];
  out.sustainedApplied = turnOn(SUSTAINED);
  out.states.sustained = { header: header(), stats: readStats(), overcap: overcap() };

  // Everything still off that is not a potion: item, set and devotion procs.
  const rest = [];
  for (const g of catalogue())
    for (const r of g.rows)
      if (r.state === "off" && !/Potion/i.test(r.source || "")) rest.push(r.name);
  out.procsApplied = turnOn(rest);
  out.states.everything = { header: header(), stats: readStats(), overcap: overcap() };
  out.finalBuffCatalogue = catalogue();
  return JSON.stringify(out);
})()`;

try {
  const cdp = await CDP.connect(await pageWsUrl());
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.navigate", { url: URL_TO_LOAD });

  let ready = false;
  for (let i = 0; i < 80; i++) {
    await Bun.sleep(500);
    ready = await cdp.evaluate<boolean>(
      `typeof player === "object" && player !== null && !!document.body.innerText.match(/Level \\d+/)`,
    );
    if (ready === true) break;
  }
  if (!ready) throw new Error(`the calculator never decoded a build at ${URL_TO_LOAD}`);
  await Bun.sleep(3000);

  const raw = await cdp.evaluate<string>(PROBE);
  const data = JSON.parse(raw);
  writeFileSync(OUT, JSON.stringify(data, null, 1), "utf8");
  const n = (s: string) => data.states[s]?.header ?? "?";
  if (data.difficulty !== "Ultimate")
    console.error(
      `WARNING: could not switch to Ultimate (reads "${data.difficulty}"). Resistance overcap ` +
        `is 25 points high on Elite and 50 on Normal; do not judge cushions from this scrape.`,
    );
  console.error(
    `wrote ${OUT}: ${data.className} level ${data.bio?.level}, ${data.items.length} items, ` +
      `${data.devotions.length} devotion stars | difficulty ${data.difficultyAsShared} -> ` +
      `${data.difficulty} | buffs ${n("asShared")} -> ${n("sustained")} -> ${n("everything")}`,
  );
} finally {
  cleanup();
}
