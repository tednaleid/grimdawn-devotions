// ABOUTME: DOM adapter that renders the benefits and affinity sidebar panels.
// ABOUTME: Formats summed stat totals via statFormat and shows affinity totals with colored orbs.
import { AFFINITIES, type Affinity, type DevotionModel, type StarId } from "../core/types";
import { sumBonuses, powersGained, racialTargets } from "../core/aggregate";
import { affinityTotals } from "../core/affinity";
import { condensedRows, type CondensedPart } from "../core/statFormat";
import { affinityOrb } from "./affinityColors";

// "up"/"down"/"" depending on how a value changed since the previous render (drives the flash).
function changeClass(prev: Record<string, number> | undefined, key: string, cur: Record<string, number>): string {
  if (!prev) return "";
  const n = cur[key] ?? 0;
  const p = prev[key] ?? 0;
  return n > p ? " up" : n < p ? " down" : "";
}

// A condensed value's display text: the max-resist and duration-seconds get a hint.
function partText(p: CondensedPart): string {
  if (p.dim === "max") return `max ${p.value}`;
  if (p.dim === "durFlat") return `${p.value}s`;
  return p.value;
}

// Renders the Benefits panel (condensed: one selectable subject line per concept,
// each value individually selectable). Returns the summed bonuses so the caller can
// pass them back as `prev` next time to highlight what changed.
export function renderBenefits(
  el: HTMLElement,
  model: DevotionModel,
  selected: Set<StarId>,
  prev?: Record<string, number>,
  selectedBenefits: Set<string> = new Set(),
): Record<string, number> {
  const bonuses = sumBonuses(model, selected);
  const powers = powersGained(model, selected);
  const chip = (p: CondensedPart) =>
    `<span class="bchip${selectedBenefits.has(p.id) ? " vsel" : ""}${changeClass(prev, p.id, bonuses)}" data-vid="${p.id}">${partText(p)}</span>`;
  const rows = condensedRows(bonuses, { racialTarget: racialTargets(model, selected) })
    .map((g) => {
      const subs = g.subjects
        .map((s) => {
          const gsel = s.parts.every((p) => selectedBenefits.has(p.id)) ? " gsel" : "";
          const main = s.parts.filter((p) => p.dim !== "durFlat" && p.dim !== "durPct");
          const dur = s.parts.filter((p) => p.dim === "durFlat" || p.dim === "durPct");
          if (dur.length) {
            return `<div class="bgroup${gsel}" data-gkey="${s.key}"><div class="bsubj" data-gtoggle>${s.subject}</div>` +
              `<div class="bsub"><span class="blbl">damage</span><span class="bvals">${main.map(chip).join("")}</span></div>` +
              `<div class="bsub"><span class="blbl">duration</span><span class="bvals">${dur.map(chip).join("")}</span></div></div>`;
          }
          return `<div class="bgroup${gsel}" data-gkey="${s.key}"><div class="bsingle"><span class="bsubj" data-gtoggle>${s.subject}</span><span class="bvals">${main.map(chip).join("")}</span></div></div>`;
        })
        .join("");
      return `<h3>${g.group}</h3>${subs}`;
    })
    .join("");
  // data-star-id lets main.ts show the same rich tooltip as the power's map star on hover.
  const powerRows = powers
    .map((p) => `<div class="power" data-star-id="${p.starId}">${p.power.name}</div>`)
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
