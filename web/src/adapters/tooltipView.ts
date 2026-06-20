// ABOUTME: DOM adapter that shows/hides a floating tooltip for a hovered star or whole constellation.
// ABOUTME: Star view shows that star's bonuses; constellation view shows the union of all its stars' bonuses.
import { type Affinity, type AffinityMap, type Constellation, type DevotionModel, type StarId } from "../core/types";
import { formatBonusRows } from "../core/statFormat";
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

function affinitySections(con: Constellation, totals?: AffinityTotals): string {
  const req = requiresLine(con.affinityRequired, totals);
  const grant = affinityLine(con.affinityBonus);
  return (req ? `<div class="tip-req">Requires: ${req}</div>` : "") +
    (grant ? `<div class="tip-grant">Grants: ${grant}</div>` : "");
}

export function tooltipView(el: HTMLElement) {
  function place(clientX: number, clientY: number) {
    el.style.left = `${clientX + 14}px`;
    el.style.top = `${clientY + 14}px`;
    el.style.display = "block";
  }
  return {
    show(model: DevotionModel, starId: StarId, clientX: number, clientY: number, totals?: AffinityTotals) {
      const star = model.stars.get(starId);
      if (!star) return;
      const con = model.constellations.get(star.constellationId)!;
      const power = star.celestialPower ? `<div class="tip-power">${star.celestialPower.name}</div>` : "";
      el.innerHTML = `<strong>${con.name}</strong>${power}${bonusRowsHtml(star.bonuses, star.racialTarget)}${affinitySections(con, totals)}`;
      place(clientX, clientY);
    },
    showConstellation(model: DevotionModel, conId: string, clientX: number, clientY: number, totals?: AffinityTotals) {
      const con = model.constellations.get(conId);
      if (!con) return;
      const stars = new Set(con.starIds);
      const powers = powersGained(model, stars)
        .map((p) => `<div class="tip-power">${p}</div>`)
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
