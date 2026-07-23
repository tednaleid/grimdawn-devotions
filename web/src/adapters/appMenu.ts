// ABOUTME: Header app menu: a hamburger button opening one popover with cross-app nav, the language
// ABOUTME: list, and the About/provenance panel. Composes the languagePicker + infoPopover content helpers.
import { languageOptions, languageMenuHtml } from "./languagePicker";
import { infoPanelHtml, type InfoPopoverText } from "./infoPopover";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface AppMenuNav {
  href: string;
  label: string;
}

/** Everything the popover renders; rebuilt on a locale switch and handed to update(). */
export interface AppMenuContent {
  nav: AppMenuNav; // link to the other app (planner <-> RR)
  languageHeading: string; // the "Language" section heading
  current: string; // active locale
  available: readonly string[];
  names: Record<string, string>;
  info: InfoPopoverText; // About panel content (description, provenance, GitHub)
  githubUrl: string;
}

/** The popover's inner markup: cross-app link, language list, About panel. Pure; no DOM. */
export function appMenuPanelHtml(c: AppMenuContent): string {
  const nav = `<a class="app-menu-nav" href="${esc(c.nav.href)}">${esc(c.nav.label)}</a>`;
  const language =
    `<div class="app-menu-section"><span class="app-menu-heading">${esc(c.languageHeading)}</span>` +
    `<ul class="app-menu-langlist" role="menu">${languageMenuHtml(languageOptions(c.current, c.available, c.names))}</ul></div>`;
  const about = `<div class="app-menu-section app-menu-about">${infoPanelHtml(c.info, c.githubUrl)}</div>`;
  return `${nav}<div class="app-menu-sep"></div>${language}<div class="app-menu-sep"></div>${about}`;
}

// A simple inline hamburger, sized/colored by CSS (currentColor) to match the header buttons.
const MENU_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor"' +
  ' stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';

export interface AppMenuHandle {
  /** Re-render the panel (language checkmark, About) and button label after a locale switch. */
  update(content: AppMenuContent, menuLabel: string): void;
}

export interface AppMenuOptions extends AppMenuContent {
  menuLabel: string; // accessible label for the hamburger button
  onSelect: (locale: string) => void;
}

/** Build the menu into `header` (pushed to the right by CSS) and wire open/close + selection. */
export function mountAppMenu(header: HTMLElement, opts: AppMenuOptions): AppMenuHandle {
  const wrap = document.createElement("div");
  wrap.className = "app-menu";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "app-menu-btn";
  btn.setAttribute("aria-haspopup", "true");
  btn.setAttribute("aria-expanded", "false");
  btn.innerHTML = MENU_SVG;

  const panel = document.createElement("div");
  panel.className = "app-menu-panel";
  panel.setAttribute("role", "menu");
  panel.hidden = true;

  wrap.append(btn, panel);
  header.appendChild(wrap);

  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
  };

  const render = (content: AppMenuContent, menuLabel: string) => {
    btn.setAttribute("aria-label", menuLabel);
    btn.title = menuLabel;
    panel.setAttribute("aria-label", menuLabel);
    panel.innerHTML = appMenuPanelHtml(content);
  };

  btn.addEventListener("click", () => {
    setOpen(panel.hidden);
  });
  panel.addEventListener("click", (e) => {
    const locale = (e.target as HTMLElement).closest<HTMLElement>("[data-locale]");
    if (locale) {
      setOpen(false);
      opts.onSelect(locale.dataset.locale as string);
      return;
    }
    if ((e.target as HTMLElement).closest("a")) setOpen(false); // following a link (nav or GitHub) closes it
  });
  // Dismiss on outside click (containment check so clicks inside never close it) or Escape.
  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target as Node)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });

  render(opts, opts.menuLabel);
  return { update: render };
}
