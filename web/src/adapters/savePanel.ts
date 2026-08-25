// ABOUTME: DOM adapter for the save-file panel: a file control that reads a Grim Dawn player.gdc
// ABOUTME: and hands its bytes on, plus the status line for the result. Mounted once, like importPanel.ts.
import type { Localization } from "../ports/Localization";

export type SaveErrorKey = "notSave" | "version" | "corrupt" | "empty";

export type SavePanelState =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "error"; code: SaveErrorKey }
  /** `pruned` counts stars the engine could not place; absent or 0 means a clean load. */
  | { kind: "done"; name: string; level: number; spent: number; total: number; pruned?: number };

export interface SavePanelHandle {
  setState(s: SavePanelState): void;
  relocalize(loc: Localization): void;
}

/** The file the control accepts. Narrower than File so tests can pass a plain double. */
export interface SaveFile {
  name?: string;
}

export function mountSavePanel(
  el: HTMLElement,
  loc: Localization,
  opts: {
    onBytes(bytes: Uint8Array): void;
    /** Reads a chosen file to bytes; defaults to the browser's own reader, tests inject. */
    readFile?(file: SaveFile): Promise<Uint8Array>;
  },
): SavePanelHandle {
  let localization = loc;
  let state: SavePanelState = { kind: "idle" };
  const readFile = opts.readFile ?? (async (f: SaveFile) => new Uint8Array(await (f as unknown as File).arrayBuffer()));

  el.innerHTML =
    `<hr class="panel-sep"/><h2 id="save-h"></h2>` +
    `<div class="save-row"><input id="save-input" type="file" accept=".gdc"/></div>` +
    `<div id="save-hint"></div>` +
    `<div id="save-msg" aria-live="polite"></div>`;

  const head = el.querySelector("#save-h") as HTMLElement;
  const input = el.querySelector("#save-input") as HTMLInputElement;
  const hint = el.querySelector("#save-hint") as HTMLElement;
  const msg = el.querySelector("#save-msg") as HTMLElement;

  function applyChrome() {
    head.textContent = localization.translate("ui.save.label");
    input.setAttribute("aria-label", localization.translate("ui.save.choose"));
    hint.innerHTML = localization.translate("ui.save.hint");
  }

  // #save-msg is innerHTML-driven in every branch: the "done" branch needs markup for its two
  // lines, and mixing textContent and innerHTML across branches would strand stale markup.
  function paint() {
    if (state.kind === "reading") {
      msg.innerHTML = localization.translate("ui.save.reading");
      return;
    }
    if (state.kind === "error") {
      msg.innerHTML = localization.translate(`ui.save.err.${state.code}`);
      return;
    }
    if (state.kind === "done") {
      const lines = [
        localization.translate("ui.save.loaded", { name: state.name, level: state.level }),
        localization.translate("ui.save.points", { spent: state.spent, total: state.total }),
      ];
      if (state.pruned && state.pruned > 0) lines.push(localization.translate("ui.save.pruned", { n: state.pruned }));
      msg.innerHTML = lines.map((l) => `<div>${l}</div>`).join("");
      return;
    }
    msg.innerHTML = "";
  }

  input.addEventListener("change", () => {
    const file = (input as unknown as { files: SaveFile[] | null }).files?.[0];
    if (!file) return;
    void readFile(file).then(
      (bytes) => opts.onBytes(bytes),
      () => {
        state = { kind: "error", code: "corrupt" };
        paint();
      },
    );
  });

  applyChrome();
  paint();

  return {
    setState(s) {
      state = s;
      paint();
    },
    relocalize(next) {
      localization = next;
      applyChrome();
      paint();
    },
  };
}
