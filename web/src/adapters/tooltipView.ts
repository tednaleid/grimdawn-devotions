// ABOUTME: DOM adapter that shows/hides a floating tooltip for a hovered star or whole constellation.
// ABOUTME: Star view shows that star's bonuses; constellation view shows the union of all its stars' bonuses.
import type {
  Affinity,
  AffinityMap,
  CelestialPower,
  Constellation,
  DevotionModel,
  PetInfo,
  StarId,
} from "../core/types";
import { formatBonusRows, formatPet, formatPowerStats } from "../core/statFormat";
import { sumBonuses, sumPetBonuses, powersGained, racialTargets, weaponRequirements } from "../core/aggregate";
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

// A star's conditional qualifier (e.g. Kraken's two-handed weapon requirement), shown verbatim
// under its bonuses. Empty when the star has no requirement or no description text.
function weaponReqHtml(description: string | null | undefined): string {
  return description ? `<div class="tip-weapon-req">${description}</div>` : "";
}

// "Bonus to All Pets": the same stat lines as a player bonus, under a header (GD shows
// these in a distinct block). Empty when the star/constellation grants no pet bonuses.
function petBonusHtml(petBonuses?: Record<string, number>): string {
  if (!petBonuses || Object.keys(petBonuses).length === 0) return "";
  return `<div class="tip-pet-bonus-head">Bonus to All Pets</div>${bonusRowsHtml(petBonuses)}`;
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
  return (
    (req ? `<div class="tip-req">Requires: ${req}</div>` : "") +
    (grant ? `<div class="tip-grant">Grants: ${grant}</div>` : "")
  );
}

// The interactive commit button for the touch popover; empty in passive (hover) mode.
function commitHtml(commit?: { label: string; enabled: boolean }): string {
  if (!commit) return "";
  return `<button class="tip-commit" type="button"${commit.enabled ? "" : " disabled"}>${commit.label}</button>`;
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
    show(
      model: DevotionModel,
      starId: StarId,
      clientX: number,
      clientY: number,
      totals?: AffinityTotals,
      commit?: { label: string; enabled: boolean },
    ) {
      const star = model.stars.get(starId);
      if (!star) return;
      const con = model.constellations.get(star.constellationId)!;
      const power = star.celestialPower ? powerHtml(star.celestialPower) : "";
      el.innerHTML = `<strong>${con.name}</strong>${power}${bonusRowsHtml(star.bonuses, star.racialTarget)}${weaponReqHtml(star.weaponRequirement?.description)}${petBonusHtml(star.petBonuses)}${affinitySections(con, totals)}${commitHtml(commit)}`;
      el.style.pointerEvents = commit ? "auto" : "";
      place(clientX, clientY);
    },
    showConstellation(
      model: DevotionModel,
      conId: string,
      clientX: number,
      clientY: number,
      totals?: AffinityTotals,
      dim?: { needs?: number; cap: number },
      commit?: { label: string; enabled: boolean },
    ) {
      const con = model.constellations.get(conId);
      if (!con) return;
      const stars = new Set(con.starIds);
      const powers = powersGained(model, stars)
        .map((p) => `<div class="tip-power">${p.power.name}</div>`)
        .join("");
      const head = `<strong>${con.name}</strong> <span class="tip-cost">${con.starIds.length} pts</span>`;
      // `dim` with a `needs` count: how many points would complete it. `dim` without one: the engine
      // found no completion within the cap (do not leak the INF sentinel as a giant point count).
      const dimLine = dim
        ? dim.needs !== undefined
          ? `<div class="tip-dim">Needs ${dim.needs} of your ${dim.cap} points</div>`
          : `<div class="tip-dim">Cannot be completed within ${dim.cap} points</div>`
        : "";
      // Weapon requirement(s) across the constellation's stars. When every star shares one
      // requirement (true of every gated constellation in the data today), show it verbatim like
      // the star tooltip; only hedge with "Some bonuses require ..." if the gating is partial or mixed.
      const reqDescs = weaponRequirements(model, stars)
        .map((r) => r.description)
        .filter((d): d is string => !!d);
      const distinctReqs = [...new Set(reqDescs)];
      const fullyGated = distinctReqs.length === 1 && reqDescs.length === stars.size;
      const weaponReq = fullyGated
        ? `<div class="tip-weapon-req">${distinctReqs[0]}</div>`
        : distinctReqs
            .map((d) => `<div class="tip-weapon-req">Some bonuses require ${d.replace(/^Requires\s+/i, "")}</div>`)
            .join("");
      el.innerHTML = `${head}${powers}${bonusRowsHtml(sumBonuses(model, stars), racialTargets(model, stars))}${weaponReq}${petBonusHtml(sumPetBonuses(model, stars))}${affinitySections(con, totals)}${dimLine}${commitHtml(commit)}`;
      el.style.pointerEvents = commit ? "auto" : "";
      place(clientX, clientY);
    },
    hide() {
      el.style.display = "none";
      el.style.pointerEvents = "";
    },
  };
}
