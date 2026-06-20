// ABOUTME: DOM adapter that shows/hides a floating tooltip for a hovered devotion star.
// ABOUTME: Renders formatted stat rows plus the constellation's required and granted affinities.
import { type AffinityMap, type DevotionModel, type StarId } from "../core/types";
import { formatBonusRows } from "../core/statFormat";
import { affinityOrb, presentAffinities } from "./affinityColors";

function affinityLine(map: AffinityMap): string {
  return presentAffinities(map)
    .map((a) => `<span class="aff">${affinityOrb(a)}${a} ${map[a]}</span>`)
    .join(" ");
}

export function tooltipView(el: HTMLElement) {
  return {
    show(model: DevotionModel, starId: StarId, clientX: number, clientY: number) {
      const star = model.stars.get(starId);
      if (!star) return;
      const con = model.constellations.get(star.constellationId)!;
      const bonusRows = formatBonusRows(star.bonuses)
        .map((r) => `<div class="tip-bonus"><span class="val">${r.value}</span> ${r.label}</div>`)
        .join("");
      const power = star.celestialPower ? `<div class="tip-power">${star.celestialPower.name}</div>` : "";
      const req = affinityLine(con.affinityRequired);
      const grant = affinityLine(con.affinityBonus);
      el.innerHTML =
        `<strong>${con.name}</strong>${power}${bonusRows}` +
        (req ? `<div class="tip-req">Requires: ${req}</div>` : "") +
        (grant ? `<div class="tip-grant">Grants: ${grant}</div>` : "");
      el.style.left = `${clientX + 14}px`;
      el.style.top = `${clientY + 14}px`;
      el.style.display = "block";
    },
    hide() {
      el.style.display = "none";
    },
  };
}
