// ABOUTME: DOM adapter for the grimtools panel: the import box with its status line and source link,
// ABOUTME: and the Export button with its own state and hint. Mounted once, mirroring searchPanel.ts.
import { parseSlug } from "../core/grimtools";
import { escapeHtml } from "./tooltipView";
import type { Localization } from "../ports/Localization";

export type ImportErrorCode = "notFound" | "network" | "version" | "empty";

export type ImportState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; code: ImportErrorCode }
  /** `pruned` counts stars the engine could not place; absent or 0 means a clean import.
   * `title` is the build's grimtools display name (already sanitized by the worker); absent or
   * null falls back to the untitled source link, which also covers a pre-`title` cached response. */
  | { kind: "done"; slug: string; pruned?: number; title?: string | null };

export type ExportDisabledReason = "empty" | "uncapped" | "incomplete";
export type ExportErrorCode = "rateLimited" | "network" | "upstream" | "base";

/** The Export button, independent of the import state (see the spec's panel table). `hidden` is
 * "the link already is the export": the current selection matches the associated build. `saved` is
 * the same, right after this session minted that build: the button stays away and its row explains
 * that the link above is a new build (grimtools builds are immutable), with a copy button for it. */
export type ExportState =
  | { kind: "hidden" }
  | { kind: "saved"; slug: string }
  | { kind: "disabled"; reason: ExportDisabledReason }
  | { kind: "ready" }
  | { kind: "exporting" }
  | { kind: "error"; code: ExportErrorCode };

export interface ImportPanelHandle {
  setState(s: ImportState): void;
  setExportState(e: ExportState): void;
  relocalize(loc: Localization): void;
}

const CALC = "https://www.grimtools.com/calc/";

export function mountImportPanel(
  el: HTMLElement,
  loc: Localization,
  opts: {
    onSubmit(slug: string): void;
    onExport(): void;
    /** Writes the saved build's link to the clipboard; defaults to the browser's clipboard, tests inject. */
    copyText?(text: string): Promise<void>;
  },
): ImportPanelHandle {
  let localization = loc;
  let state: ImportState = { kind: "idle" };
  let exportState: ExportState = { kind: "hidden" };
  const copyText = opts.copyText ?? ((text: string) => navigator.clipboard.writeText(text));

  // Import and ✕ are two states of one control, not two things that coexist: State A
  // (idle/loading/error) has nothing yet to clear, so it shows the textbox and Import; State B
  // (done) has nothing left to submit, so it shows the source link and ✕ instead. `hidden` on
  // whichever pair is inactive starts them matching the initial "idle" state before paint() runs.
  el.innerHTML =
    `<hr class="panel-sep"/><h2 id="import-h"></h2>` +
    `<div class="import-row">` +
    `<input id="import-input" type="text" autocomplete="off" spellcheck="false"/>` +
    `<button id="import-go" type="button"></button>` +
    `<a id="import-source" href="${CALC}" target="_blank" rel="noopener noreferrer" hidden></a>` +
    `<button id="import-clear" type="button" hidden></button>` +
    `</div><div id="import-msg" aria-live="polite"></div>` +
    `<div class="import-row" id="export-row" hidden>` +
    `<button id="export-go" type="button"></button>` +
    `</div><div id="export-msg" aria-live="polite"></div>`;

  const head = el.querySelector("#import-h") as HTMLElement;
  const input = el.querySelector("#import-input") as HTMLInputElement;
  const go = el.querySelector("#import-go") as HTMLButtonElement;
  const source = el.querySelector("#import-source") as HTMLAnchorElement;
  const clear = el.querySelector("#import-clear") as HTMLButtonElement;
  const msg = el.querySelector("#import-msg") as HTMLElement;
  const exportRow = el.querySelector("#export-row") as HTMLElement;
  const exportGo = el.querySelector("#export-go") as HTMLButtonElement;
  const exportMsg = el.querySelector("#export-msg") as HTMLElement;

  function applyChrome() {
    head.textContent = localization.translate("ui.grimtools.label");
    input.placeholder = localization.translate("ui.import.placeholder");
    input.setAttribute("aria-label", localization.translate("ui.import.label"));
    go.textContent = localization.translate("ui.import.submit");
    // source's own text is state-dependent (it names the build once one is known) and is set in
    // paint() instead; nothing here needs it to also hold a value between "done" states.
    clear.setAttribute("aria-label", localization.translate("ui.import.clear"));
    clear.textContent = "✕";
    exportGo.textContent = localization.translate("ui.export.submit");
  }

  // #import-msg stays innerHTML-driven in every branch, including the plain-text ones: the
  // "done" branch's pruned count needs markup, and mixing textContent/innerHTML setters across
  // branches would leave stale markup behind on a real element that does not keep the two in
  // sync internally.
  function paint() {
    const associated = state.kind === "done";
    input.hidden = associated;
    go.hidden = associated;
    source.hidden = !associated;
    clear.hidden = !associated;

    if (state.kind === "done") {
      source.setAttribute("href", `${CALC}${state.slug}`);
      // title is upstream content relayed through the worker; escape it before it enters this
      // innerHTML string. The slug above needs no escaping - parseSlug's charset already
      // guarantees it, so it is never attacker-influenced text. The tooltip carries the full
      // title for when the CSS truncates the label; an attribute value is inert text.
      source.innerHTML = state.title ? escapeHtml(state.title) : localization.translate("ui.import.source");
      if (state.title) source.setAttribute("title", state.title);
      else source.removeAttribute("title");
      msg.innerHTML =
        state.pruned && state.pruned > 0
          ? `<div id="import-pruned">${localization.translate("ui.import.pruned", { n: state.pruned })}</div>`
          : "";
      return;
    }

    // State A: Import is enabled only when the box parses to a slug. A non-empty box that does
    // not parse shows the same message submitting used to error on, but now as a live hint that
    // tracks every keystroke: without it a disabled button would offer no explanation, and
    // gating submission without it would leave ui.import.err.badInput unreachable.
    const parsed = parseSlug(input.value);
    go.disabled = !parsed;
    if (input.value && !parsed) {
      msg.innerHTML = localization.translate("ui.import.err.badInput");
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
    msg.innerHTML = "";
  }

  // The export row is its own state machine: it shows in State A and State B alike, and only
  // `hidden` and `saved` remove it (the associated link already is the export). Messages go
  // through innerHTML for the same reason #import-msg does.
  function paintExport() {
    const hidden = exportState.kind === "hidden" || exportState.kind === "saved";
    exportRow.hidden = hidden;
    if (exportState.kind === "saved") {
      // The copy button lives inside the message, so it is re-created on every paint and its
      // click is delegated from #export-msg below rather than bound here.
      exportMsg.innerHTML =
        `<div>${localization.translate("ui.export.saved")}</div>` +
        `<button id="export-copy" type="button">${localization.translate("ui.export.copy")}</button>`;
      return;
    }
    if (hidden) {
      exportMsg.innerHTML = "";
      return;
    }
    exportGo.disabled = exportState.kind === "disabled" || exportState.kind === "exporting";
    if (exportState.kind === "disabled")
      exportMsg.innerHTML = localization.translate(`ui.export.hint.${exportState.reason}`);
    else if (exportState.kind === "exporting") exportMsg.innerHTML = localization.translate("ui.export.exporting");
    else if (exportState.kind === "error")
      exportMsg.innerHTML = localization.translate(`ui.export.err.${exportState.code}`);
    else exportMsg.innerHTML = "";
  }

  function submit() {
    const slug = parseSlug(input.value);
    // The Import button is disabled and the hint already shown whenever this would fail, but
    // Enter reaches here directly, bypassing the disabled attribute.
    if (!slug) return;
    opts.onSubmit(slug);
  }

  applyChrome();
  go.addEventListener("click", submit);
  input.addEventListener("input", paint);
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
  exportGo.addEventListener("click", () => opts.onExport());
  exportMsg.addEventListener("click", (e) => {
    const target = e.target as Element | null;
    if (target?.id !== "export-copy" || exportState.kind !== "saved") return;
    // Confirm in place once the write lands; a refused write (no permission, insecure context)
    // leaves the button as it was, and the link above can still be copied by hand.
    void copyText(`${CALC}${exportState.slug}`).then(
      () => {
        target.textContent = localization.translate("ui.export.copied");
      },
      () => {},
    );
  });
  paint();
  paintExport();

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
    setExportState(e) {
      exportState = e;
      paintExport();
    },
    relocalize(next) {
      localization = next;
      applyChrome();
      paint();
      paintExport();
    },
  };
}
