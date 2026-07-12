// ABOUTME: Renders the guided build-order panel for the right sidebar: a numbered step list with
// ABOUTME: constellation art on complete rows, distinct scaffold add/refund rows, and a running held
// ABOUTME: total. Pure string output; the null state offers an on-demand "Find valid order" button.
import type { Affinity, DevotionModel } from "../core/types";
import type { BuildStep, Vec } from "../core/reachability";
import type { AssetManifest } from "../ports/DataSource";
import { affinityOrb } from "./affinityColors";
import type { Localization } from "../ports/Localization";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const AFFINITY = ["Ascendant", "Chaos", "Eldritch", "Order", "Primordial"];

// The five Crossroads share the generic name "Crossroads" and have no art. Label each by its fixed
// position on the devotion map (cardinal direction) and show a dot in the affinity it grants.
const CROSSROADS: Record<string, { dirKey: string; affinity: Affinity }> = {
  crossroads_primordial: { dirKey: "n", affinity: "primordial" },
  crossroads_chaos: { dirKey: "nw", affinity: "chaos" },
  crossroads_order: { dirKey: "ne", affinity: "order" },
  crossroads_eldritch: { dirKey: "sw", affinity: "eldritch" },
  crossroads_ascendant: { dirKey: "se", affinity: "ascendant" },
};

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
function deficitPhrase(loc: Localization, deficit: Vec): string {
  const parts = deficit
    .map((d, i) =>
      d > 0
        ? loc.translate("ui.buildOrder.deficitMore", {
            count: d,
            affinity: loc.translate(`aff.${AFFINITY[i]!.toLowerCase()}`),
          })
        : "",
    )
    .filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")}${loc.translate("ui.buildOrder.deficitJoin")}${parts[parts.length - 1]}`;
}

export function buildOrderHtml(
  loc: Localization,
  model: DevotionModel,
  manifest: AssetManifest | null,
  steps: BuildStep[] | null,
  noOrder?: NoOrderInfo | null,
): string {
  if (!steps) {
    const info: NoOrderInfo = noOrder ?? { kind: "empty" };
    let body: string;
    if (info.kind === "incomplete") {
      const deficit = esc(deficitPhrase(loc, info.deficit));
      body =
        `<div class="bo-empty-msg">${loc.translate("ui.buildOrder.incompleteAffinity", { deficit })}</div>` +
        `<div class="bo-empty-sub">${loc.translate("ui.buildOrder.addSupporting")}</div>`;
    } else if (info.kind === "searched") {
      body =
        info.minCap != null
          ? `<div class="bo-empty-msg">${loc.translate("ui.buildOrder.noPathCap", { minCap: info.minCap })}</div>` +
            `<div class="bo-empty-sub">${loc.translate("ui.buildOrder.scaffoldingNote")}</div>`
          : `<div class="bo-empty-msg">${loc.translate("ui.buildOrder.noLegalPath")}</div>`;
    } else {
      // nothing to order yet: the order appears once the selection covers its own affinity.
      body = `<div class="bo-empty-msg">${loc.translate("ui.buildOrder.selectPrompt")}</div>`;
    }
    return `<h2>${loc.translate("ui.panel.buildOrder")}</h2><div class="bo-empty">${body}</div>`;
  }
  let n = 0;
  const rows = steps
    .map((s) => {
      const c = model.constellations.get(s.conId);
      const cr = CROSSROADS[s.conId];
      const name = cr
        ? `${c ? loc.gameText(c.nameTag) : loc.translate("ui.buildOrder.crossroads")} (${loc.translate(`ui.buildOrder.dir.${cr.dirKey}`)})`
        : c
          ? loc.gameText(c.nameTag)
          : s.conId;
      const artName = c?.background?.image?.split("/").pop() ?? "";
      const art = manifest?.images[artName];
      // Crossroads have no art; their art-column cell holds a dot in the granted affinity's color.
      const dot = cr ? `<span class="bo-art">${affinityOrb(cr.affinity)}</span>` : "";
      const img = art && s.kind === "complete" ? `<img class="bo-art" src="${esc(art.url)}" alt=""/>` : "";
      const held = `<span class="bo-held">${s.heldAfter}</span>`;
      if (s.kind === "complete") {
        n++;
        const artCell = img || dot;
        // A step smaller than its constellation is a deliberate partial pick (e.g. 4 of 6 stars to
        // reach a celestial power): annotate it so the row does not read as the full constellation.
        const partial =
          c && s.points < c.starIds.length
            ? ` <span class="bo-partial">${loc.translate("ui.buildOrder.partial", { taken: s.points, total: c.starIds.length })}</span>`
            : "";
        return `<div class="bo-step bo-complete" data-con-id="${esc(s.conId)}"><span class="bo-n">${n}</span>${artCell}<span class="bo-name">${esc(name)}${partial}</span><span class="bo-pts">+${s.points}</span>${held}</div>`;
      }
      const label =
        s.kind === "scaffold-add" ? loc.translate("ui.buildOrder.add") : loc.translate("ui.buildOrder.refund");
      const cls = s.kind === "scaffold-add" ? "bo-add" : "bo-refund";
      // Empty art-column cell (or the crossroads dot) so the five grid columns line up with complete rows.
      const artCell = dot || `<span class="bo-art"></span>`;
      return `<div class="bo-step ${cls}" data-con-id="${esc(s.conId)}"><span class="bo-n"></span>${artCell}<span class="bo-name">${label} ${esc(name)}</span><span class="bo-pts">${s.points > 0 ? "+" : ""}${s.points}</span>${held}</div>`;
    })
    .join("");
  return `<h2>${loc.translate("ui.panel.buildOrder")}</h2><div class="bo-list">${rows}</div>`;
}
