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

/** The slice of a CDP Runtime.evaluate reply this module reads. */
export type CdpResult = {
  result?: { value?: unknown };
  exceptionDetails?: { text?: string; exception?: { description?: string } };
};

export class CDP {
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
