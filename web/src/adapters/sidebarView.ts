// ABOUTME: DOM adapter that renders the benefits and affinity sidebar panels.
// ABOUTME: Formats summed stat totals via statFormat and shows affinity totals with colored orbs.
import { AFFINITIES, type DevotionModel, type StarId } from "../core/types";
import { sumBonuses, powersGained, racialTargets } from "../core/aggregate";
import { affinityTotals } from "../core/affinity";
import { formatBonusRows } from "../core/statFormat";
import { affinityOrb } from "./affinityColors";

export function renderBenefits(el: HTMLElement, model: DevotionModel, selected: Set<StarId>): void {
  const bonuses = sumBonuses(model, selected);
  const powers = powersGained(model, selected);
  const rows = formatBonusRows(bonuses, { racialTarget: racialTargets(model, selected) })
    .map((r) => `<div class="benefit"><span>${r.label}</span><span class="val">${r.value}</span></div>`)
    .join("");
  const powerRows = powers.map((p) => `<div class="power">${p}</div>`).join("");
  el.innerHTML = `<h2>Benefits</h2>${rows}${powers.length ? `<h3>Celestial Powers</h3>${powerRows}` : ""}`;
}

export function renderAffinities(el: HTMLElement, model: DevotionModel, selected: Set<StarId>): void {
  const totals = affinityTotals(model, selected);
  const rows = AFFINITIES.map(
    (a) => `<div class="affinity affinity-${a}"><span>${affinityOrb(a)}${a}</span><span class="val">${totals[a]}</span></div>`,
  ).join("");
  el.innerHTML = `<h2>Affinity</h2>${rows}`;
}
