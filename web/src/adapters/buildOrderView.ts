// ABOUTME: Renders the guided build-order panel: a numbered step list with constellation art, scaffold
// ABOUTME: add/refund rows, a running held total, honest empty states, and the per-step affinity popup
// ABOUTME: (post-step have/need in the Affinity panel's visual language). Pure string output.
import type { Affinity, DevotionModel } from "../core/types";
import { AFFINITIES } from "../core/types";
import type { StepState, TransStep } from "../core/orderLegality";
import type { BuildStep, Vec } from "../core/reachability";
import type { TransitionRung } from "../core/transitionOrder";
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

// The step name shared by rows and the popup: crossroads get a direction label, others their game name.
function stepConName(loc: Localization, model: DevotionModel, conId: string): string {
  const c = model.constellations.get(conId);
  const cr = CROSSROADS[conId];
  return cr
    ? `${c ? loc.gameText(c.nameTag) : loc.translate("ui.buildOrder.crossroads")} (${loc.translate(`ui.buildOrder.dir.${cr.dirKey}`)})`
    : c
      ? loc.gameText(c.nameTag)
      : conId;
}

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
    .map((s, si) => {
      const c = model.constellations.get(s.conId);
      const cr = CROSSROADS[s.conId];
      const name = stepConName(loc, model, s.conId);
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
        return `<div class="bo-step bo-complete" data-con-id="${esc(s.conId)}" data-step-i="${si}"><span class="bo-n">${n}</span>${artCell}<span class="bo-name">${esc(name)}${partial}</span><span class="bo-pts">+${s.points}</span>${held}</div>`;
      }
      const label =
        s.kind === "scaffold-add" ? loc.translate("ui.buildOrder.add") : loc.translate("ui.buildOrder.refund");
      const cls = s.kind === "scaffold-add" ? "bo-add" : "bo-refund";
      // Empty art-column cell (or the crossroads dot) so the five grid columns line up with complete rows.
      const artCell = dot || `<span class="bo-art"></span>`;
      return `<div class="bo-step ${cls}" data-con-id="${esc(s.conId)}" data-step-i="${si}"><span class="bo-n"></span>${artCell}<span class="bo-name">${label} ${esc(name)}</span><span class="bo-pts">${s.points > 0 ? "+" : ""}${s.points}</span>${held}</div>`;
    })
    .join("");
  return `<h2>${loc.translate("ui.panel.buildOrder")}</h2><div class="bo-list">${rows}</div>`;
}

/**
 * Compare mode: the baseline-to-current transition order. Same row vocabulary as the from-scratch
 * panel above (a step's own kind is "add"/"refund" rather than "scaffold-add"/"scaffold-refund"/
 * "complete", so a row numbers and gets art only when an add reaches the constellation's full size
 * AND the constellation survives to the end of the transition - transient scaffolds keep the plain
 * Add vocabulary even at full size;
 * the partial badge instead marks any row - add or refund - that leaves the member short of full
 * size). A heading names the direction, and the full-respec rung carries a plain notice. Zero steps
 * means the builds already match.
 */
export function transitionHtml(
  loc: Localization,
  model: DevotionModel,
  manifest: AssetManifest | null,
  steps: TransStep[],
  rung: TransitionRung,
): string {
  const head = `<h2>${loc.translate("ui.panel.buildOrder")}</h2><div class="bo-compare-head">${loc.translate("ui.buildOrder.transitionHeading")}</div>`;
  if (!steps.length) return `${head}<div class="bo-empty">${loc.translate("ui.buildOrder.transitionIdentical")}</div>`;
  const note =
    rung === "full-respec" ? `<div class="bo-note">${loc.translate("ui.buildOrder.fullRespecNote")}</div>` : "";
  // A constellation is TRANSIENT when its LAST step in this transition ends at 0: bought (or held)
  // along the way but gone by the end. An add that reaches full size for a transient constellation is
  // scaffolding, not a member of the resulting build, so it stays an unnumbered Add row below rather
  // than claiming a numbered bo-complete slot.
  const finalTo = new Map<string, number>();
  for (const s of steps) finalTo.set(s.conId, s.to);
  const transient = new Set([...finalTo].filter(([, to]) => to === 0).map(([conId]) => conId));
  let n = 0;
  const rows = steps
    .map((s, si) => {
      const c = model.constellations.get(s.conId);
      const cr = CROSSROADS[s.conId];
      const name = stepConName(loc, model, s.conId);
      const artName = c?.background?.image?.split("/").pop() ?? "";
      const art = manifest?.images[artName];
      const completes = s.kind === "add" && !!c && s.to === c.starIds.length && !transient.has(s.conId);
      // Crossroads have no art; their art-column cell holds a dot in the granted affinity's color.
      const dot = cr ? `<span class="bo-art">${affinityOrb(cr.affinity)}</span>` : "";
      const img = art && completes ? `<img class="bo-art" src="${esc(art.url)}" alt=""/>` : "";
      const delta = s.to - s.from;
      const held = `<span class="bo-held">${s.heldAfter}</span>`;
      if (completes) {
        n++;
        const artCell = img || dot;
        return `<div class="bo-step bo-complete" data-con-id="${esc(s.conId)}" data-step-i="${si}"><span class="bo-n">${n}</span>${artCell}<span class="bo-name">${esc(name)}</span><span class="bo-pts">+${delta}</span>${held}</div>`;
      }
      const label = loc.translate(s.kind === "add" ? "ui.buildOrder.add" : "ui.buildOrder.refund");
      const cls = s.kind === "add" ? "bo-add" : "bo-refund";
      // Empty art-column cell (or the crossroads dot) so the five grid columns line up with complete rows.
      const artCell = dot || `<span class="bo-art"></span>`;
      // A step landing short of full size (add or refund) is a deliberate partial member: annotate it
      // so the row does not read as a full constellation.
      const partial =
        s.to > 0 && c && s.to < c.starIds.length
          ? ` <span class="bo-partial">${loc.translate("ui.buildOrder.partial", { taken: s.to, total: c.starIds.length })}</span>`
          : "";
      return `<div class="bo-step ${cls}" data-con-id="${esc(s.conId)}" data-step-i="${si}"><span class="bo-n"></span>${artCell}<span class="bo-name">${label} ${esc(name)}${partial}</span><span class="bo-pts">${delta > 0 ? "+" : ""}${delta}</span>${held}</div>`;
    })
    .join("");
  return `${head}${note}<div class="bo-list">${rows}</div>`;
}

/**
 * The hover/tap popup for one build-order step: the post-step have/need table in the Affinity
 * panel's visual language (same classes, no filter-toggle attributes - the popup is display-only).
 * The step's own effect folds into the table as dimmed parentheticals: its grant appears in the
 * have column as a signed delta (+N, or -N on a refund), its requirement in the need column as
 * (N). `state` comes from the verifying replay via SelectionView.buildOrderStates, so the numbers
 * are the ones the legality judge saw.
 */
export function buildStepPopupHtml(
  loc: Localization,
  model: DevotionModel,
  step: BuildStep | TransStep,
  state: StepState,
): string {
  const name = esc(stepConName(loc, model, step.conId));
  const sign = step.kind === "scaffold-refund" || step.kind === "refund" ? "-" : "+";
  const rows = AFFINITIES.map((a, i) => {
    const n = state.need[i]!;
    const g = state.conGrant[i]!;
    const r = state.conReq[i]!;
    // Parentheticals sit BEFORE the value so the post-step numbers stay column-aligned.
    const haveDelta = g > 0 ? `<span class="bo-pop-delta">(${sign}${g})</span> ` : "";
    const needNote = r > 0 ? `<span class="bo-pop-delta">(${r})</span> ` : "";
    let needCell: string;
    if (n > 0) {
      const met = state.have[i]! >= n;
      const names = (state.needSource.get(i) ?? [])
        .map((cid) => {
          const tag = model.constellations.get(cid)?.nameTag;
          return tag ? loc.gameText(tag) : cid;
        })
        .join(", ");
      needCell = `<span class="aff-need ${met ? "met" : "missing"}" title="${esc(names ? loc.translate("ui.affinity.neededBy", { names }) : "")}">${needNote}${n}</span>`;
    } else {
      needCell = `<span class="aff-need none">${needNote}0</span>`;
    }
    return `<div class="affinity affinity-${a}"><span>${affinityOrb(a)}${loc.translate(`aff.${a}`)}</span><span class="aff-have">${haveDelta}${state.have[i]}</span>${needCell}</div>`;
  }).join("");
  return (
    `<div class="bo-pop-name">${name}</div>` +
    `<div class="bo-pop-table"><div class="affinity-head"><span></span><span class="aff-have">${loc.translate("ui.affinity.have")}</span><span class="aff-need-h">${loc.translate("ui.affinity.need")}</span></div>${rows}</div>`
  );
}
