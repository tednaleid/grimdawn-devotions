// ABOUTME: Renders the guided build-order panel for the right sidebar: a numbered step list with
// ABOUTME: constellation art on complete rows, distinct scaffold add/refund rows, and a running held
// ABOUTME: total. Pure string output; the null state offers an on-demand "Find valid order" button.
import type { DevotionModel } from "../core/types";
import type { BuildStep, Vec } from "../core/reachability";
import type { AssetManifest } from "../ports/DataSource";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const AFFINITY = ["Ascendant", "Chaos", "Eldritch", "Order", "Primordial"];

// Why no order is shown, for the empty-state copy:
// - empty: nothing meaningful to order yet (no selection, or no point cap to assemble within).
// - incomplete: the selection does not cover its own affinity (deficit per color); it needs other
//   constellations, so no order exists yet. This is the common partial-selection case (e.g. a capstone alone).
// - searched: the selection is self-covering but no construction order assembles it within budget. minCap is
//   the fewest points at which it would assemble (<= 55), or null when no legal path exists even at 55.
export type NoOrderInfo =
  | { kind: "empty" }
  | { kind: "incomplete"; deficit: Vec }
  | { kind: "searched"; minCap: number | null };

// "20 more Ascendant and 7 more Order" from a deficit vector.
function deficitPhrase(deficit: Vec): string {
  const parts = deficit.map((d, i) => (d > 0 ? `${d} more ${AFFINITY[i]}` : "")).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export function buildOrderHtml(
  model: DevotionModel,
  manifest: AssetManifest | null,
  steps: BuildStep[] | null,
  noOrder?: NoOrderInfo | null,
): string {
  if (!steps) {
    const info: NoOrderInfo = noOrder ?? { kind: "empty" };
    let body: string;
    if (info.kind === "incomplete") {
      body =
        `<div class="bo-empty-msg">Incomplete build: needs ${esc(deficitPhrase(info.deficit))} affinity.</div>` +
        `<div class="bo-empty-sub">Add supporting constellations that grant it.</div>`;
    } else if (info.kind === "searched") {
      body =
        info.minCap != null
          ? `<div class="bo-empty-msg">No path to this build in fewer than ${info.minCap} points.</div>` +
            `<div class="bo-empty-sub">Assembling it needs transient scaffolding that pushes the running total past your cap.</div>`
          : `<div class="bo-empty-msg">No legal path to this build exists.</div>`;
    } else {
      // nothing to order yet: the order appears once the selection covers its own affinity.
      body = `<div class="bo-empty-msg">Select a self-covering build to see its order.</div>`;
    }
    return `<h2>Build order</h2><div class="bo-empty">${body}</div>`;
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
      // Empty art-column cell so the five grid columns (n, art, name, pts, held) line up with the
      // complete rows; without it the name lands in the 1.4em art column and the row shifts left.
      return `<div class="bo-step ${cls}" data-con-id="${esc(s.conId)}"><span class="bo-n"></span><span class="bo-art"></span><span class="bo-name">${label} ${esc(name)}</span><span class="bo-pts">${s.points > 0 ? "+" : ""}${s.points}</span>${held}</div>`;
    })
    .join("");
  return `<h2>Build order</h2><div class="bo-list">${rows}</div>`;
}
