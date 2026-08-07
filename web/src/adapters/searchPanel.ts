// ABOUTME: DOM adapter for the map search box and its match count.
// ABOUTME: Mounted once into a stable container, because the affinity panel rewrites its own innerHTML.
import type { SearchMatch } from "../core/search";
import type { Localization } from "../ports/Localization";

export interface SearchPanelHandle {
  /** null clears the line (empty query); a match renders counts or the empty state. */
  setCount(m: SearchMatch | null): void;
  relocalize(loc: Localization): void;
  value(): string;
  setValue(q: string): void;
}

export function mountSearchPanel(
  el: HTMLElement,
  loc: Localization,
  opts: { initial: string; onInput(q: string): void },
): SearchPanelHandle {
  let localization = loc;
  let last: SearchMatch | null = null;

  el.innerHTML =
    `<hr class="panel-sep"/><h2 id="search-h"></h2>` +
    `<div class="search-row">` +
    `<input id="search-input" type="search" autocomplete="off" spellcheck="false"/>` +
    `<button id="search-clear" type="button"></button>` +
    `</div><div id="search-count" aria-live="polite"></div>`;

  const head = el.querySelector("#search-h") as HTMLElement;
  const input = el.querySelector("#search-input") as HTMLInputElement;
  const clear = el.querySelector("#search-clear") as HTMLButtonElement;
  const count = el.querySelector("#search-count") as HTMLElement;

  function applyChrome() {
    head.textContent = localization.translate("ui.search.label");
    input.placeholder = localization.translate("ui.search.placeholder");
    input.setAttribute("aria-label", localization.translate("ui.search.label"));
    clear.setAttribute("aria-label", localization.translate("ui.search.clear"));
    clear.textContent = "✕";
  }

  function paintCount() {
    if (!last) {
      count.textContent = "";
      return;
    }
    const cons = last.constellations.size;
    const stars = last.stars.size;
    count.textContent =
      cons === 0 && stars === 0
        ? localization.translate("ui.search.none")
        : localization.translate("ui.search.count", { cons, stars });
  }

  input.value = opts.initial;
  applyChrome();
  input.addEventListener("input", () => opts.onInput(input.value));
  input.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key !== "Escape") return;
    input.value = "";
    opts.onInput("");
  });
  clear.addEventListener("click", () => {
    input.value = "";
    opts.onInput("");
    input.focus();
  });

  return {
    setCount(m) {
      last = m;
      paintCount();
    },
    relocalize(next) {
      localization = next;
      applyChrome();
      paintCount();
    },
    value: () => input.value,
    setValue(q) {
      if (input.value !== q) input.value = q;
    },
  };
}
