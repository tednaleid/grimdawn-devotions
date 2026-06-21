// ABOUTME: DOM adapter that shows/hides a floating tooltip for a hovered star or whole constellation.
// ABOUTME: Star view shows that star's bonuses; constellation view shows the union of all its stars' bonuses.
import type { Affinity, AffinityMap, CelestialPower, Constellation, DevotionModel, PetInfo, StarId } from "../core/types";
import { formatBonusRows, formatPet, formatPowerStats } from "../core/statFormat";
import { sumBonuses, powersGained, racialTargets } from "../core/aggregate";
import { affinityOrb, presentAffinities } from "./affinityColors";

type AffinityTotals = Record<Affinity, number>;

function affinityLine(map: AffinityMap): string {
  return presentAffinities(map)
    .map((a) => `<span class="aff">${affinityOrb(a)}${a} ${map[a]}</span>`)
    .join(" ");
}

// Required affinities: only the ones the player is still short on are flagged missing (red).
function requiresLine(map: AffinityMap, totals?: AffinityTotals): string {
  return presentAffinities(map)
    .map((a) => {
      const need = map[a]!;
      const met = !totals || (totals[a] ?? 0) >= need;
      return `<span class="aff ${met ? "met" : "missing"}">${affinityOrb(a)}${a} ${need}</span>`;
    })
    .join(" ");
}

function bonusRowsHtml(bonuses: Record<string, number>, racialTarget?: string[]): string {
  return formatBonusRows(bonuses, { racialTarget })
    .map((r) => `<div class="tip-bonus"><span class="val">${r.value}</span> ${r.label}</div>`)
    .join("");
}

// Star tooltip: power name + proc trigger ("Scorpion Sting (25% Chance on Attack)"),
// description, granted level, then the ability's stat lines GD-style.
function powerHtml(power: CelestialPower): string {
  const proc = power.proc
    ? ` <span class="tip-proc">(${power.proc.chance}% Chance on ${power.proc.trigger})</span>`
    : "";
  const desc = power.description ? `<div class="tip-power-desc">${power.description}</div>` : "";
  const level = power.level ? `<div class="tip-power-level">Current Level: ${power.level}</div>` : "";
  const stats = formatPowerStats(power.stats)
    .map((r) => `<div class="tip-bonus"><span class="val">${r.value}</span> ${r.label}</div>`)
    .join("");
  const pet = power.pet ? petHtml(power.pet) : "";
  return `<div class="tip-power">${power.name}${proc}</div>${desc}${level}${stats}${pet}`;
}

// A summon proc's pet: the "Summons N <Pet>..." line, then the pet's base attack
// rendered like the power's own ability stat lines.
function petHtml(pet: PetInfo): string {
  const { summon, attack } = formatPet(pet);
  const lines = attack
    .map((r) => `<div class="tip-bonus"><span class="val">${r.value}</span> ${r.label}</div>`)
    .join("");
  return `<div class="tip-pet">${summon}</div>${lines}`;
}

function affinitySections(con: Constellation, totals?: AffinityTotals): string {
  const req = requiresLine(con.affinityRequired, totals);
  const grant = affinityLine(con.affinityBonus);
  return (req ? `<div class="tip-req">Requires: ${req}</div>` : "") +
    (grant ? `<div class="tip-grant">Grants: ${grant}</div>` : "");
}

export function tooltipView(el: HTMLElement) {
  // Position near the cursor, but flip to the left/above and clamp so the tooltip
  // stays fully on screen (measured after it is shown so its size is known).
  function place(clientX: number, clientY: number) {
    el.style.display = "block";
    const gap = 14;
    const margin = 12;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = clientX + gap;
    if (left + w > vw - margin) left = clientX - gap - w; // flip to the left of the cursor
    left = Math.max(margin, Math.min(left, vw - margin - w));
    let top = clientY + gap;
    if (top + h > vh - margin) top = clientY - gap - h; // flip above the cursor
    top = Math.max(margin, Math.min(top, vh - margin - h));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }
  return {
    show(model: DevotionModel, starId: StarId, clientX: number, clientY: number, totals?: AffinityTotals) {
      const star = model.stars.get(starId);
      if (!star) return;
      const con = model.constellations.get(star.constellationId)!;
      const power = star.celestialPower ? powerHtml(star.celestialPower) : "";
      el.innerHTML = `<strong>${con.name}</strong>${power}${bonusRowsHtml(star.bonuses, star.racialTarget)}${affinitySections(con, totals)}`;
      place(clientX, clientY);
    },
    showConstellation(model: DevotionModel, conId: string, clientX: number, clientY: number, totals?: AffinityTotals) {
      const con = model.constellations.get(conId);
      if (!con) return;
      const stars = new Set(con.starIds);
      const powers = powersGained(model, stars)
        .map((p) => `<div class="tip-power">${p.power.name}</div>`)
        .join("");
      const head = `<strong>${con.name}</strong> <span class="tip-cost">${con.starIds.length} pts</span>`;
      el.innerHTML = `${head}${powers}${bonusRowsHtml(sumBonuses(model, stars), racialTargets(model, stars))}${affinitySections(con, totals)}`;
      place(clientX, clientY);
    },
    hide() {
      el.style.display = "none";
    },
  };
}
