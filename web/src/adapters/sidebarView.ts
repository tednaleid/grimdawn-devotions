// ABOUTME: DOM adapter that renders the benefits and affinity sidebar panels.
// ABOUTME: Formats summed stat totals via statFormat and shows affinity totals with colored orbs.
import { AFFINITIES, type Affinity, type DevotionModel, type StarId } from "../core/types";
import { sumBonuses, powersGained, racialTargets } from "../core/aggregate";
import { affinityTotals } from "../core/affinity";
import { groupedBonusRows } from "../core/statFormat";
import { affinityOrb } from "./affinityColors";

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// "up"/"down"/"" depending on how a value changed since the previous render (drives the flash).
function changeClass(prev: Record<string, number> | undefined, key: string, cur: Record<string, number>): string {
  if (!prev) return "";
  const n = cur[key] ?? 0;
  const p = prev[key] ?? 0;
  return n > p ? " up" : n < p ? " down" : "";
}

// Renders the Benefits panel; returns the summed bonuses so the caller can pass them
// back as `prev` next time to highlight what changed.
export function renderBenefits(
  el: HTMLElement,
  model: DevotionModel,
  selected: Set<StarId>,
  prev?: Record<string, number>,
): Record<string, number> {
  const bonuses = sumBonuses(model, selected);
  const powers = powersGained(model, selected);
  const rows = groupedBonusRows(bonuses, { racialTarget: racialTargets(model, selected) })
    .map((g) =>
      `<h3>${g.group}</h3>` +
      g.rows
        .map((r) => `<div class="benefit${changeClass(prev, r.id, bonuses)}"><span>${r.label}</span><span class="val">${r.value}</span></div>`)
        .join(""),
    )
    .join("");
  const powerRows = powers
    .map((p) => `<div class="power"${p.description ? ` title="${escapeAttr(p.description)}"` : ""}>${p.name}</div>`)
    .join("");
  el.innerHTML = `<h2>Benefits</h2>${rows}${powers.length ? `<h3>Celestial Powers</h3>${powerRows}` : ""}`;
  return bonuses;
}

// Renders the Affinity panel; returns the totals so the caller can pass them back as
// `prev` next time to highlight what changed.
export function renderAffinities(
  el: HTMLElement,
  model: DevotionModel,
  selected: Set<StarId>,
  prev?: Record<Affinity, number>,
): Record<Affinity, number> {
  const totals = affinityTotals(model, selected);
  const rows = AFFINITIES.map(
    (a) => `<div class="affinity affinity-${a}${changeClass(prev, a, totals)}"><span>${affinityOrb(a)}${a}</span><span class="val">${totals[a]}</span></div>`,
  ).join("");
  el.innerHTML = `<h2>Affinity</h2>${rows}`;
  return totals;
}
