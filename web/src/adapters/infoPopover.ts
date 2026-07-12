// ABOUTME: Header info popover: an (i) button that opens the planner's provenance - what it is, the
// ABOUTME: game-data version, and the GitHub repo link. Pure content helper plus a thin DOM mount.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface InfoPopoverText {
  label: string; // the button's accessible label
  description: string;
  gameData: string | null; // resolved provenance line, or null to omit (dataset carries no version)
  build: { label: string; url: string } | null; // SteamDB patch-notes link for the exact build, or null to omit
  github: string; // the link's visible text
}

/** The panel's content: description, optional game-data line, and the GitHub link. */
export function infoPanelHtml(text: InfoPopoverText, githubUrl: string): string {
  const buildLink = text.build
    ? `<a href="${esc(text.build.url)}" target="_blank" rel="noopener">${esc(text.build.label)}</a>`
    : "";
  const provenance =
    text.gameData || text.build
      ? `<p class="info-version">${text.gameData ? esc(text.gameData) : ""}${text.gameData && text.build ? " · " : ""}${buildLink}</p>`
      : "";
  return (
    `<p>${esc(text.description)}</p>${provenance}` +
    `<p><a href="${esc(githubUrl)}" target="_blank" rel="noopener">${esc(text.github)}</a></p>`
  );
}

// A simple inline circled i, matching the language picker's globe (sized/colored by CSS currentColor).
const INFO_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor"' +
  ' stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/>' +
  '<circle cx="12" cy="7.5" r="0.6" fill="currentColor" stroke="none"/></svg>';

export interface InfoPopoverHandle {
  /** Re-render the panel and button label after a locale switch. */
  setText(text: InfoPopoverText): void;
}

/** Build the popover into `header`. Mount BEFORE the language picker so the (i) sits left of the globe. */
export function mountInfoPopover(header: HTMLElement, githubUrl: string): InfoPopoverHandle {
  const wrap = document.createElement("div");
  wrap.className = "info-popover";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "info-btn";
  btn.setAttribute("aria-haspopup", "true");
  btn.setAttribute("aria-expanded", "false");
  btn.innerHTML = INFO_SVG;

  const panel = document.createElement("div");
  panel.className = "info-panel";
  panel.setAttribute("role", "dialog");
  panel.hidden = true;

  wrap.append(btn, panel);
  header.appendChild(wrap);

  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
  };

  const setText = (text: InfoPopoverText) => {
    btn.setAttribute("aria-label", text.label);
    btn.title = text.label;
    panel.setAttribute("aria-label", text.label);
    panel.innerHTML = infoPanelHtml(text, githubUrl);
  };

  btn.addEventListener("click", () => {
    setOpen(panel.hidden);
  });
  panel.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("a")) setOpen(false); // following the link closes it
  });
  // Dismiss on outside click (containment check, so clicks inside this popover never close it -
  // that also lets the OTHER header popover's button click close this one) or Escape.
  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target as Node)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });

  return { setText };
}
