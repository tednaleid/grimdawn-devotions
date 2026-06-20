// ABOUTME: DOM adapter that renders the benefits and affinity sidebar panels.
// ABOUTME: Reads from core aggregate/affinity functions; writes directly to HTMLElement.innerHTML.
import { AFFINITIES, type DevotionModel, type StarId } from "../core/types";
import { sumBonuses, powersGained } from "../core/aggregate";
import { affinityTotals } from "../core/affinity";

export function renderBenefits(
  el: HTMLElement, model: DevotionModel, selected: Set<StarId>, label: (s: string) => string,
): void {
  const bonuses = sumBonuses(model, selected);
  const powers = powersGained(model, selected);
  const rows = Object.entries(bonuses)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([stat, val]) => `<div class="benefit"><span>${label(stat)}</span><span>${val}</span></div>`)
    .join("");
  const powerRows = powers.map((p) => `<div class="power">${p}</div>`).join("");
  el.innerHTML = `<h2>Benefits</h2>${rows}${powers.length ? `<h3>Celestial Powers</h3>${powerRows}` : ""}`;
}

export function renderAffinities(el: HTMLElement, model: DevotionModel, selected: Set<StarId>): void {
  const totals = affinityTotals(model, selected);
  const rows = AFFINITIES.map(
    (a) => `<div class="affinity affinity-${a}"><span>${a}</span><span>${totals[a]}</span></div>`,
  ).join("");
  el.innerHTML = `<h2>Affinity</h2>${rows}`;
}
