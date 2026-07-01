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
import { formatBonusRowsWithIds, formatPet, formatPowerStats } from "../core/statFormat";
import { sumBonuses, sumPetBonuses, powersGained, racialTargets, weaponRequirements } from "../core/aggregate";
import { affinityOrb, presentAffinities } from "./affinityColors";
import { affinityTagId } from "../core/urlState";
import { translate } from "../core/localization";

type AffinityTotals = Record<Affinity, number>;

function affinityLine(map: AffinityMap, selectedBenefits: Set<string>): string {
  return presentAffinities(map)
    .map((a) => {
      const vid = affinityTagId("grant", a);
      const sel = selectedBenefits.has(vid) ? " vsel" : "";
      return `<span class="aff${sel}" data-vid="${vid}">${affinityOrb(a)}${translate(`aff.${a}`)} ${map[a]}</span>`;
    })
    .join(" ");
}

// Required affinities: only the ones the player is still short on are flagged missing (red).
function requiresLine(map: AffinityMap, totals: AffinityTotals | undefined, selectedBenefits: Set<string>): string {
  return presentAffinities(map)
    .map((a) => {
      const need = map[a]!;
      const met = !totals || (totals[a] ?? 0) >= need;
      const vid = affinityTagId("req", a);
      const sel = selectedBenefits.has(vid) ? " vsel" : "";
      return `<span class="aff ${met ? "met" : "missing"}${sel}" data-vid="${vid}">${affinityOrb(a)}${translate(`aff.${a}`)} ${need}</span>`;
    })
    .join(" ");
}

// Bonus rows tagged with their filter id (`scope` is "" for player bonuses, "pet:" for pet bonuses);
// a row whose tag is in selectedBenefits is marked selected (vsel) so it reads like the sidebar.
function bonusRowsHtml(
  bonuses: Record<string, number>,
  selectedBenefits: Set<string>,
  scope: string,
  racialTarget?: string[],
): string {
  return formatBonusRowsWithIds(bonuses, { racialTarget })
    .map((r) => {
      const vid = `${scope}${r.id}`;
      const sel = selectedBenefits.has(vid) ? " vsel" : "";
      return `<div class="tip-bonus${sel}" data-vid="${vid}"><span class="val">${r.value}</span> ${r.label}</div>`;
    })
    .join("");
}

// A star's conditional qualifier (e.g. Kraken's two-handed weapon requirement), shown verbatim
// under its bonuses. Empty when the star has no requirement or no description text.
function weaponReqHtml(description: string | null | undefined): string {
  return description ? `<div class="tip-weapon-req">${description}</div>` : "";
}

// "Bonus to All Pets": the same stat lines as a player bonus, under a header, tagged with pet: ids.
function petBonusHtml(petBonuses: Record<string, number> | undefined, selectedBenefits: Set<string>): string {
  if (!petBonuses || Object.keys(petBonuses).length === 0) return "";
  return `<div class="tip-pet-bonus-head">${translate("ui.tooltip.petBonus")}</div>${bonusRowsHtml(petBonuses, selectedBenefits, "pet:")}`;
}

// Star tooltip: power name + proc trigger ("Scorpion Sting (25% Chance on Attack)"),
// description, granted level, then the ability's stat lines GD-style.
function powerHtml(power: CelestialPower): string {
  const proc = power.proc
    ? ` <span class="tip-proc">${translate("ui.tooltip.procQualifier", { chance: power.proc.chance, trigger: power.proc.trigger })}</span>`
    : "";
  const desc = power.description ? `<div class="tip-power-desc">${power.description}</div>` : "";
  const level = power.level
    ? `<div class="tip-power-level">${translate("ui.tooltip.currentLevel", { level: power.level })}</div>`
    : "";
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

function affinitySections(
  con: Constellation,
  totals: AffinityTotals | undefined,
  selectedBenefits: Set<string>,
): string {
  const req = requiresLine(con.affinityRequired, totals, selectedBenefits);
  const grant = affinityLine(con.affinityBonus, selectedBenefits);
  return (
    (req ? `<div class="tip-req">${translate("ui.tooltip.requires")}${req}</div>` : "") +
    (grant ? `<div class="tip-grant">${translate("ui.tooltip.grants")}${grant}</div>` : "")
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
      selectedBenefits: Set<string> = new Set(),
    ) {
      const star = model.stars.get(starId);
      if (!star) return;
      const con = model.constellations.get(star.constellationId)!;
      const power = star.celestialPower ? powerHtml(star.celestialPower) : "";
      el.innerHTML = `<strong>${con.name}</strong>${power}${bonusRowsHtml(star.bonuses, selectedBenefits, "", star.racialTarget)}${weaponReqHtml(star.weaponRequirement?.description)}${petBonusHtml(star.petBonuses, selectedBenefits)}${affinitySections(con, totals, selectedBenefits)}${commitHtml(commit)}`;
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
      selectedBenefits: Set<string> = new Set(),
    ) {
      const con = model.constellations.get(conId);
      if (!con) return;
      const stars = new Set(con.starIds);
      const powers = powersGained(model, stars)
        .map((p) => `<div class="tip-power">${p.power.name}</div>`)
        .join("");
      const head = `<strong>${con.name}</strong> <span class="tip-cost">${translate("ui.tooltip.pts", { count: con.starIds.length })}</span>`;
      // `dim` with a `needs` count: how many points would complete it. `dim` without one: the engine
      // found no completion within the cap (do not leak the INF sentinel as a giant point count).
      const dimLine = dim
        ? dim.needs !== undefined
          ? `<div class="tip-dim">${translate("ui.tooltip.needsPoints", { needs: dim.needs, cap: dim.cap })}</div>`
          : `<div class="tip-dim">${translate("ui.tooltip.cannotComplete", { cap: dim.cap })}</div>`
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
            .map((d) => {
              const req = d.replace(/^Requires\s+/i, "");
              return `<div class="tip-weapon-req">${translate("ui.tooltip.partialGate", { req })}</div>`;
            })
            .join("");
      el.innerHTML = `${head}${powers}${bonusRowsHtml(sumBonuses(model, stars), selectedBenefits, "", racialTargets(model, stars))}${weaponReq}${petBonusHtml(sumPetBonuses(model, stars), selectedBenefits)}${affinitySections(con, totals, selectedBenefits)}${dimLine}${commitHtml(commit)}`;
      el.style.pointerEvents = commit ? "auto" : "";
      place(clientX, clientY);
    },
    hide() {
      el.style.display = "none";
      el.style.pointerEvents = "";
    },
  };
}
