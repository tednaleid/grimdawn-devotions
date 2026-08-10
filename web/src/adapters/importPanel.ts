// ABOUTME: DOM adapter for the grimtools import box, its status line and the source-build link.
// ABOUTME: Mounted once into a stable container, mirroring searchPanel.ts.
import { parseSlug } from "../core/grimtools";
import type { Localization } from "../ports/Localization";

export type ImportErrorCode = "badInput" | "notFound" | "network" | "version" | "empty";

export type ImportState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; code: ImportErrorCode }
  /** `pruned` counts stars the engine could not place; absent or 0 means a clean import. */
  | { kind: "done"; slug: string; pruned?: number };

export interface ImportPanelHandle {
  setState(s: ImportState): void;
  relocalize(loc: Localization): void;
}

const CALC = "https://www.grimtools.com/calc/";

export function mountImportPanel(
  el: HTMLElement,
  loc: Localization,
  opts: { onSubmit(slug: string): void },
): ImportPanelHandle {
  let localization = loc;
  let state: ImportState = { kind: "idle" };

  el.innerHTML =
    `<hr class="panel-sep"/><h2 id="import-h"></h2>` +
    `<div class="import-row">` +
    `<input id="import-input" type="text" autocomplete="off" spellcheck="false"/>` +
    `<button id="import-go" type="button"></button>` +
    `<button id="import-clear" type="button"></button>` +
    `</div><div id="import-msg" aria-live="polite"></div>`;

  const head = el.querySelector("#import-h") as HTMLElement;
  const input = el.querySelector("#import-input") as HTMLInputElement;
  const go = el.querySelector("#import-go") as HTMLButtonElement;
  const clear = el.querySelector("#import-clear") as HTMLButtonElement;
  const msg = el.querySelector("#import-msg") as HTMLElement;

  function applyChrome() {
    head.textContent = localization.translate("ui.import.label");
    input.placeholder = localization.translate("ui.import.placeholder");
    input.setAttribute("aria-label", localization.translate("ui.import.label"));
    go.textContent = localization.translate("ui.import.submit");
    clear.setAttribute("aria-label", localization.translate("ui.import.clear"));
    clear.textContent = "✕";
  }

  // Every branch paints via innerHTML, including the plain-text ones: the "done" branch needs
  // markup for the source link, and mixing textContent/innerHTML setters across states would
  // leave stale markup behind on a real element that does not keep the two in sync internally.
  function paint() {
    if (state.kind === "idle") {
      msg.innerHTML = "";
      return;
    }
    if (state.kind === "loading") {
      msg.innerHTML = localization.translate("ui.import.loading");
      return;
    }
    if (state.kind === "error") {
      msg.innerHTML = localization.translate(`ui.import.err.${state.code}`);
      return;
    }
    // state.kind === "done". parseSlug only ever returns strings matching ^[A-Za-z0-9_-]{1,24}$
    // (see core/grimtools.ts), and that is the only way a "done" state's slug is produced, so
    // interpolating it into the href here is safe.
    const link =
      `<a id="import-source" href="${CALC}${state.slug}" target="_blank" rel="noopener noreferrer">` +
      `${localization.translate("ui.import.source")}</a>`;
    const pruned =
      state.pruned && state.pruned > 0
        ? `<div id="import-pruned">${localization.translate("ui.import.pruned", { n: state.pruned })}</div>`
        : "";
    msg.innerHTML = link + pruned;
  }

  function submit() {
    const slug = parseSlug(input.value);
    if (!slug) {
      state = { kind: "error", code: "badInput" };
      paint();
      return;
    }
    opts.onSubmit(slug);
  }

  applyChrome();
  go.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") submit();
  });
  clear.addEventListener("click", () => {
    input.value = "";
    state = { kind: "idle" };
    paint();
    opts.onSubmit(""); // an empty slug means "drop the association", not "clear the build"
    input.focus();
  });

  return {
    setState(s) {
      state = s;
      if (s.kind === "done") input.value = s.slug;
      // "idle" is not only the clear button (which already empties the box itself): a hash
      // change with no gt= (e.g. pressing Back after an import) reaches here too, and must not
      // leave a slug in the box with no association shown.
      if (s.kind === "idle") input.value = "";
      paint();
    },
    relocalize(next) {
      localization = next;
      applyChrome();
      paint();
    },
  };
}
