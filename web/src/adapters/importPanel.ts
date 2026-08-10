// ABOUTME: DOM adapter for the grimtools import box, its status line and the source-build link.
// ABOUTME: Mounted once into a stable container, mirroring searchPanel.ts.
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
    `</div><div id="import-msg" aria-live="polite"></div>`;

  const head = el.querySelector("#import-h") as HTMLElement;
  const input = el.querySelector("#import-input") as HTMLInputElement;
  const go = el.querySelector("#import-go") as HTMLButtonElement;
  const source = el.querySelector("#import-source") as HTMLAnchorElement;
  const clear = el.querySelector("#import-clear") as HTMLButtonElement;
  const msg = el.querySelector("#import-msg") as HTMLElement;

  function applyChrome() {
    head.textContent = localization.translate("ui.import.label");
    input.placeholder = localization.translate("ui.import.placeholder");
    input.setAttribute("aria-label", localization.translate("ui.import.label"));
    go.textContent = localization.translate("ui.import.submit");
    // source's own text is state-dependent (it names the build once one is known) and is set in
    // paint() instead; nothing here needs it to also hold a value between "done" states.
    clear.setAttribute("aria-label", localization.translate("ui.import.clear"));
    clear.textContent = "✕";
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
      // guarantees it, so it is never attacker-influenced text.
      source.innerHTML = state.title
        ? localization.translate("ui.import.sourceTitled", { title: escapeHtml(state.title) })
        : localization.translate("ui.import.source");
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
  paint();

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
