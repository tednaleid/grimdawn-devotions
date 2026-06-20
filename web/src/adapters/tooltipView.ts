// ABOUTME: DOM adapter that shows/hides a floating tooltip for a hovered star or whole constellation.
// ABOUTME: Star view shows that star's bonuses; constellation view shows the union of all its stars' bonuses.
import { type AffinityMap, type Constellation, type DevotionModel, type StarId } from "../core/types";
import { formatBonusRows } from "../core/statFormat";
import { sumBonuses, powersGained } from "../core/aggregate";
import { affinityOrb, presentAffinities } from "./affinityColors";

function affinityLine(map: AffinityMap): string {
  return presentAffinities(map)
    .map((a) => `<span class="aff">${affinityOrb(a)}${a} ${map[a]}</span>`)
    .join(" ");
}

function bonusRowsHtml(bonuses: Record<string, number>): string {
  return formatBonusRows(bonuses)
    .map((r) => `<div class="tip-bonus"><span class="val">${r.value}</span> ${r.label}</div>`)
    .join("");
}

function affinitySections(con: Constellation): string {
  const req = affinityLine(con.affinityRequired);
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
    show(model: DevotionModel, starId: StarId, clientX: number, clientY: number) {
      const star = model.stars.get(starId);
      if (!star) return;
      const con = model.constellations.get(star.constellationId)!;
      const power = star.celestialPower ? `<div class="tip-power">${star.celestialPower.name}</div>` : "";
      el.innerHTML = `<strong>${con.name}</strong>${power}${bonusRowsHtml(star.bonuses)}${affinitySections(con)}`;
      place(clientX, clientY);
    },
    showConstellation(model: DevotionModel, conId: string, clientX: number, clientY: number) {
      const con = model.constellations.get(conId);
      if (!con) return;
      const stars = new Set(con.starIds);
      const powers = powersGained(model, stars)
        .map((p) => `<div class="tip-power">${p}</div>`)
        .join("");
      const head = `<strong>${con.name}</strong> <span class="tip-cost">${con.starIds.length} pts</span>`;
      el.innerHTML = `${head}${powers}${bonusRowsHtml(sumBonuses(model, stars))}${affinitySections(con)}`;
      place(clientX, clientY);
    },
    hide() {
      el.style.display = "none";
    },
  };
}
