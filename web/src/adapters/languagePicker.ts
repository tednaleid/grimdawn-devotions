// ABOUTME: Header language picker: a globe button that opens a compact popover of the shipped locales.
// ABOUTME: Pure content helpers (languageOptions/languageMenuHtml) plus a thin DOM mount that wires it up.

export interface LanguageOption {
  locale: string;
  name: string;
  current: boolean;
}

/** The popover's content: every available locale in order, named by its endonym, current one flagged. */
export function languageOptions(
  current: string,
  available: readonly string[],
  names: Record<string, string>,
): LanguageOption[] {
  return available.map((locale) => ({ locale, name: names[locale] ?? locale, current: locale === current }));
}

/** The popover list markup. Endonyms are a fixed safe constant set, so no escaping is needed. */
export function languageMenuHtml(options: LanguageOption[]): string {
  return options
    .map(
      (o) =>
        `<li role="none"><button type="button" role="menuitemradio" data-locale="${o.locale}"` +
        ` aria-checked="${o.current}"${o.current ? ' class="current"' : ""}>${o.name}</button></li>`,
    )
    .join("");
}

// A simple inline globe, sized/colored by CSS (currentColor) to match the header buttons.
const GLOBE_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor"' +
  ' stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18' +
  'M12 3c-2.5 2.5-2.5 15 0 18"/></svg>';

export interface LanguagePickerHandle {
  /** Re-render the menu (checkmark) and button label after a locale switch. */
  setCurrent(current: string, label: string): void;
}

export interface LanguagePickerOptions {
  current: string;
  available: readonly string[];
  names: Record<string, string>;
  label: string;
  onSelect: (locale: string) => void;
}

/** Build the picker into `header` (pushed to the right by CSS) and wire open/close + selection. */
export function mountLanguagePicker(header: HTMLElement, opts: LanguagePickerOptions): LanguagePickerHandle {
  const wrap = document.createElement("div");
  wrap.className = "lang-picker";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "lang-btn";
  btn.setAttribute("aria-haspopup", "true");
  btn.setAttribute("aria-expanded", "false");
  btn.innerHTML = GLOBE_SVG;

  const menu = document.createElement("ul");
  menu.className = "lang-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;

  wrap.append(btn, menu);
  header.appendChild(wrap);

  const setOpen = (open: boolean) => {
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
  };

  const setCurrent = (current: string, label: string) => {
    btn.setAttribute("aria-label", label);
    btn.title = label;
    menu.innerHTML = languageMenuHtml(languageOptions(current, opts.available, opts.names));
  };

  btn.addEventListener("click", () => {
    setOpen(menu.hidden);
  });
  menu.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-locale]");
    if (!target) return;
    setOpen(false);
    opts.onSelect(target.dataset.locale as string);
  });
  // Dismiss on outside click (containment check, so clicks inside this popover never close it -
  // that also lets the OTHER header popover's button click close this one) or Escape.
  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target as Node)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });

  setCurrent(opts.current, opts.label);
  return { setCurrent };
}
