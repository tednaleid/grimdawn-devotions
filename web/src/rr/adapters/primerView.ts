// ABOUTME: Renders the RR mechanics primer: the three RR types, how they interact, and the formula.
// ABOUTME: All copy resolves through the Localization port; ported from the desktop prototype's primer.
import type { Localization } from "../../ports/Localization";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Render the mechanics primer into `el`. Static once localized; re-rendered on locale change. */
export function renderPrimer(el: HTMLElement, loc: Localization): void {
  const t = (k: string) => esc(loc.translate(k));
  const card = (cls: string, badgeKey: string, titleKey: string, bodyKey: string) =>
    `<div class="k ${cls}"><b><span class="badge b-${cls === "stack" ? "stacking" : cls === "mult" ? "reduced-percent" : "reduced-flat"}">${t(badgeKey)}</span>&nbsp; ${t(titleKey)}</b>${t(bodyKey)}</div>`;
  el.innerHTML = `<h2>${t("rr.primer.heading")}</h2>
    <div class="rrkey">
      ${card("stack", "rr.badge.stacking", "rr.primer.stackTitle", "rr.primer.stackBody")}
      ${card("mult", "rr.badge.reduced-percent", "rr.primer.multTitle", "rr.primer.multBody")}
      ${card("flat", "rr.badge.reduced-flat", "rr.primer.flatTitle", "rr.primer.flatBody")}
    </div>
    <p>${t("rr.primer.reducedNote")}</p>
    <p>${t("rr.primer.elementalNote")}</p>
    <div class="formula">${t("rr.primer.formula")}</div>`;
}
