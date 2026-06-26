// ABOUTME: Renders the guided build-order panel for the right sidebar: a numbered step list with
// ABOUTME: constellation art on complete rows, distinct scaffold add/refund rows, and a running held
// ABOUTME: total. Pure string output; the null state offers an on-demand "Find valid order" button.
import type { DevotionModel } from "../core/types";
import type { BuildStep } from "../core/reachability";
import type { AssetManifest } from "../ports/DataSource";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildOrderHtml(
  model: DevotionModel,
  manifest: AssetManifest | null,
  steps: BuildStep[] | null,
): string {
  if (!steps) {
    return (
      `<h2>Build order</h2>` +
      `<div class="bo-empty">No quick build order found.` +
      ` <button type="button" data-find-order>Find valid order</button></div>`
    );
  }
  let n = 0;
  const rows = steps
    .map((s) => {
      const c = model.constellations.get(s.conId);
      const name = c ? c.name : s.conId;
      const artName = c?.background?.image?.split("/").pop() ?? "";
      const art = manifest?.images[artName];
      const img = art && s.kind === "complete" ? `<img class="bo-art" src="${esc(art.url)}" alt=""/>` : "";
      const held = `<span class="bo-held">${s.heldAfter}</span>`;
      if (s.kind === "complete") {
        n++;
        return `<div class="bo-step bo-complete" data-con-id="${esc(s.conId)}"><span class="bo-n">${n}</span>${img}<span class="bo-name">${esc(name)}</span><span class="bo-pts">+${s.points}</span>${held}</div>`;
      }
      const label = s.kind === "scaffold-add" ? "Add" : "Refund";
      const cls = s.kind === "scaffold-add" ? "bo-add" : "bo-refund";
      return `<div class="bo-step ${cls}" data-con-id="${esc(s.conId)}"><span class="bo-n"></span><span class="bo-name">${label} ${esc(name)}</span><span class="bo-pts">${s.points > 0 ? "+" : ""}${s.points}</span>${held}</div>`;
    })
    .join("");
  return `<h2>Build order</h2><div class="bo-list">${rows}</div>`;
}
