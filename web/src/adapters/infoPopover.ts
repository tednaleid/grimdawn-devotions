// ABOUTME: About-panel content helper for the header app menu: the description, game-data version,
// ABOUTME: and GitHub repo link. Pure and DOM-free; the menu shell/wiring lives in appMenu.ts.

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
