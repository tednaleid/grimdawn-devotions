// ABOUTME: DOM adapter that renders the benefits and affinity sidebar panels.
// ABOUTME: Formats summed stat totals via statFormat and shows affinity totals with colored orbs.
import { AFFINITIES, type Affinity, type DevotionModel, type StarId } from "../core/types";
import type { Vec } from "../core/reachability";
import { sumBonuses, sumPetBonuses, powersGained, racialTargets } from "../core/aggregate";
import { condensedRows, type CondensedGroup, type CondensedPart, type CondensedSubject } from "../core/statFormat";
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

// Renders the Benefits panel: the subjects the current selection grants, with condensed values.
// The rest of the catalog (benefits you could still pick up) is returned as `availHtml` rather than
// rendered here, so the caller can place it under the Affinity panel on the right, kept distinct
// from the benefits the build actually grants. `catalog` is condensedRows over every stat id in the
// model (subject -> its ids). Returns the summed bonuses so the caller can flash changes via `prev`.
export function renderBenefits(
  el: HTMLElement,
  model: DevotionModel,
  selected: Set<StarId>,
  prev?: Record<string, number>,
  selectedBenefits: Set<string> = new Set(),
  catalog: CondensedGroup[] = [],
  prevPet?: Record<string, number>,
): { bonuses: Record<string, number>; petBonuses: Record<string, number>; availHtml: string } {
  const bonuses = sumBonuses(model, selected);
  const petBonuses = sumPetBonuses(model, selected);
  const powers = powersGained(model, selected);

  // Every subject's full set of stat ids (for subject-level tagging + group-selected),
  // so selecting a subject highlights all of its sources, not just the dimensions held.
  const catalogIds = new Map<string, string[]>();
  for (const g of catalog) for (const s of g.subjects) catalogIds.set(s.key, s.parts.map((p) => p.id));
  const subjectIds = (s: CondensedSubject) => catalogIds.get(s.key) ?? s.parts.map((p) => p.id);
  const groupSel = (s: CondensedSubject) => {
    const ids = subjectIds(s);
    return ids.length > 0 && ids.every((id) => selectedBenefits.has(id)) ? " gsel" : "";
  };
  const chip = (p: CondensedPart) =>
    `<span class="bchip${selectedBenefits.has(p.id) ? " vsel" : ""}${changeClass(prev, p.id, bonuses)}" data-vid="${p.id}">${partText(p)}</span>`;

  // Active subject (with values): damage types split into damage/duration sub-rows.
  const activeSubject = (s: CondensedSubject) => {
    const open = `<div class="bgroup${groupSel(s)}" data-gkey="${s.key}" data-ids="${subjectIds(s).join(",")}">`;
    const main = s.parts.filter((p) => p.dim !== "durFlat" && p.dim !== "durPct");
    const dur = s.parts.filter((p) => p.dim === "durFlat" || p.dim === "durPct");
    if (dur.length) {
      return `${open}<div class="bsubj" data-gtoggle>${s.subject}</div>` +
        `<div class="bsub"><span class="blbl">damage</span><span class="bvals">${main.map(chip).join("")}</span></div>` +
        `<div class="bsub"><span class="blbl">duration</span><span class="bvals">${dur.map(chip).join("")}</span></div></div>`;
    }
    return `${open}<div class="bsingle"><span class="bsubj" data-gtoggle>${s.subject}</span><span class="bvals">${main.map(chip).join("")}</span></div></div>`;
  };

  const activeGroups = condensedRows(bonuses, { racialTarget: racialTargets(model, selected) });
  const activeKeys = new Set<string>();
  for (const g of activeGroups) for (const s of g.subjects) activeKeys.add(s.key);

  const activeHtml = activeGroups
    .map((g) => `<h3>${g.group}</h3>${g.subjects.map(activeSubject).join("")}`)
    .join("");

  // Inactive catalog subjects, grouped by category, as name-only selectable tags.
  const availHtml = catalog
    .map((g) => {
      const subs = g.subjects
        .filter((s) => !activeKeys.has(s.key))
        .map((s) => `<div class="bgroup avail${groupSel(s)}" data-gkey="${s.key}" data-ids="${subjectIds(s).join(",")}"><span class="bsubj" data-gtoggle>${s.subject}</span></div>`)
        .join("");
      return subs ? `<h3>${g.group}</h3><div class="avail-list">${subs}</div>` : "";
    })
    .join("");

  // data-star-id lets main.ts show the same rich tooltip as the power's map star on hover.
  const powerRows = powers
    .map((p) => `<div class="power" data-star-id="${p.starId}">${p.power.name}</div>`)
    .join("");

  // "Bonus to All Pets": summed pet bonuses as their own read-only section. Pet stat ids
  // overlap player ones, so these are not taggable/highlightable; and they carry no
  // duration dimensions, so a flat subject line suffices. Flashes on change like above.
  const petChip = (p: CondensedPart) => `<span class="bchip${changeClass(prevPet, p.id, petBonuses)}">${partText(p)}</span>`;
  const petHtml = condensedRows(petBonuses)
    .map((g) => `<h3>${g.group}</h3>` + g.subjects
      .map((s) => `<div class="bgroup"><div class="bsingle"><span class="bsubj">${s.subject}</span><span class="bvals">${s.parts.map(petChip).join("")}</span></div></div>`)
      .join(""))
    .join("");

  el.innerHTML =
    `<h2>Benefits</h2>${activeHtml || '<div class="bempty">Select stars to gain benefits.</div>'}` +
    (petHtml ? `<h2 class="avail-head">Bonus to All Pets</h2>${petHtml}` : "") +
    (powers.length ? `<h3>Celestial Powers</h3>${powerRows}` : "");
  // availHtml (the "available to get" catalog) is returned, not rendered here - the caller places
  // it under the Affinity panel on the right.
  return { bonuses, petBonuses, availHtml };
}

// Renders the Affinity panel as two columns: the current total ("have") and, when a
// started constellation demands a color ("need"), a second value colored met/unmet whose
// title lists the demanding constellation names. Returns the have-totals so the caller can
// pass them back as `prev` next time to highlight what changed.
export function renderAffinities(
  el: HTMLElement,
  model: DevotionModel,
  have: Vec,
  need: Vec,
  needSource: Map<number, string[]>,
  prev?: Record<Affinity, number>,
): Record<Affinity, number> {
  const totals = { ascendant: have[0], chaos: have[1], eldritch: have[2], order: have[3], primordial: have[4] } as Record<Affinity, number>;
  const rows = AFFINITIES.map((a, i) => {
    const flash = changeClass(prev, a, totals as Record<string, number>);
    const n = need[i]!;
    let needCell: string;
    if (n > 0) {
      const met = have[i]! >= n;
      const names = (needSource.get(i) ?? []).map((cid) => model.constellations.get(cid)?.name ?? cid).join(", ");
      needCell = `<span class="aff-need ${met ? "met" : "missing"}" title="${names ? `needed by ${names}` : ""}">${n}</span>`;
    } else {
      // Nothing requires this color: still render the cell (dimmed 0) so both columns stay aligned.
      needCell = `<span class="aff-need none">0</span>`;
    }
    return `<div class="affinity affinity-${a}${flash}"><span>${affinityOrb(a)}${a}</span><span class="aff-have">${have[i]}</span>${needCell}</div>`;
  }).join("");
  el.innerHTML = `<h2>Affinity</h2><div class="affinity-head"><span></span><span class="aff-have">have</span><span class="aff-need-h">need</span></div>${rows}`;
  return totals;
}
