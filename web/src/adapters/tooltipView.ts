// ABOUTME: DOM adapter that shows/hides a floating tooltip for a hovered devotion star.
// ABOUTME: Reads star and constellation data from DevotionModel; positions the element by client coords.
import { AFFINITIES, type DevotionModel, type StarId } from "../core/types";

export function tooltipView(el: HTMLElement) {
  return {
    show(model: DevotionModel, starId: StarId, clientX: number, clientY: number, label: (s: string) => string) {
      const star = model.stars.get(starId);
      if (!star) return;
      const con = model.constellations.get(star.constellationId)!;
      const bonusRows = Object.entries(star.bonuses)
        .map(([s, v]) => `<div>${label(s)}: ${v}</div>`).join("");
      const power = star.celestialPower ? `<div class="tip-power">${star.celestialPower.name}</div>` : "";
      const req = AFFINITIES
        .filter((a) => (con.affinityRequired[a] ?? 0) > 0)
        .map((a) => `${a} ${con.affinityRequired[a]}`).join(", ");
      el.innerHTML = `<strong>${con.name}</strong>${power}${bonusRows}${req ? `<div class="tip-req">Requires: ${req}</div>` : ""}`;
      el.style.left = `${clientX + 14}px`;
      el.style.top = `${clientY + 14}px`;
      el.style.display = "block";
    },
    hide() { el.style.display = "none"; },
  };
}
