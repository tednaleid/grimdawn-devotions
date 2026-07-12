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
import { formatBonusRowsWithIds, formatPet, formatPowerStats, type PowerRows } from "../core/statFormat";
import { sumBonuses, sumPetBonuses, powersGained, racialTargets, weaponRequirements } from "../core/aggregate";
import { affinityOrb, presentAffinities } from "./affinityColors";
import { affinityTagId, petTagId } from "../core/benefitTag";
import { resolveText, sortByResolved, type Text } from "../core/localization";
import type { Localization } from "../ports/Localization";

type AffinityTotals = Record<Affinity, number>;

function affinityLine(loc: Localization, map: AffinityMap, selectedBenefits: Set<string>): string {
  return presentAffinities(map)
    .map((a) => {
      const vid = affinityTagId("grant", a);
      const sel = selectedBenefits.has(vid) ? " vsel" : "";
      return `<span class="aff${sel}" data-vid="${vid}">${affinityOrb(a)}${loc.translate(`aff.${a}`)} ${map[a]}</span>`;
    })
    .join(" ");
}

// Required affinities: only the ones the player is still short on are flagged missing (red).
function requiresLine(
  loc: Localization,
  map: AffinityMap,
  totals: AffinityTotals | undefined,
  selectedBenefits: Set<string>,
): string {
  return presentAffinities(map)
    .map((a) => {
      const need = map[a]!;
      const met = !totals || (totals[a] ?? 0) >= need;
      const vid = affinityTagId("req", a);
      const sel = selectedBenefits.has(vid) ? " vsel" : "";
      return `<span class="aff ${met ? "met" : "missing"}${sel}" data-vid="${vid}">${affinityOrb(a)}${loc.translate(`aff.${a}`)} ${need}</span>`;
    })
    .join(" ");
}

// Bonus rows tagged with their filter id (`keyOf` maps a raw stat id to its tag key: identity for
// player rows, petTagId for pet rows); a row whose tag is in selectedBenefits is marked selected
// (vsel) so it reads like the sidebar.
function bonusRowsHtml(
  loc: Localization,
  bonuses: Record<string, number>,
  selectedBenefits: Set<string>,
  keyOf: (id: string) => string,
  racialTarget?: string[],
): string {
  return sortByResolved(loc, formatBonusRowsWithIds(bonuses, { racialTarget }), (r) => r.label)
    .map((r) => ({ id: r.id, label: resolveText(loc, r.label), value: resolveText(loc, r.value) }))
    .map((r) => {
      const vid = keyOf(r.id);
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
function petBonusHtml(
  loc: Localization,
  petBonuses: Record<string, number> | undefined,
  selectedBenefits: Set<string>,
): string {
  if (!petBonuses || Object.keys(petBonuses).length === 0) return "";
  return `<div class="tip-pet-bonus-head">${loc.translate("ui.tooltip.petBonus")}</div>${bonusRowsHtml(loc, petBonuses, selectedBenefits, petTagId)}`;
}

// Ability stat lines: the semantic rows render in core's order, untouched; the
// fallthrough segment is resolved, sorted by resolved label, and appended.
function powerRowsHtml(loc: Localization, power: PowerRows): string {
  const resolve = (r: { label: Text; value: Text }) => ({
    label: resolveText(loc, r.label),
    value: resolveText(loc, r.value),
  });
  return power.rows
    .map(resolve)
    .concat(sortByResolved(loc, power.fallthrough, (r) => r.label).map(resolve))
    .map((r) => `<div class="tip-bonus"><span class="val">${r.value}</span> ${r.label}</div>`)
    .join("");
}

// Star tooltip: power name + proc trigger ("Scorpion Sting (25% Chance on Attack)"),
// description, granted level, then the ability's stat lines GD-style.
function powerHtml(loc: Localization, power: CelestialPower): string {
  const proc = power.proc
    ? ` <span class="tip-proc">${loc.translate("ui.tooltip.procQualifier", { chance: power.proc.chance, trigger: loc.translate(`trigger.${power.proc.triggerKey}`) })}</span>`
    : "";
  const desc = power.descriptionTag ? `<div class="tip-power-desc">${loc.gameText(power.descriptionTag)}</div>` : "";
  const level = power.level
    ? `<div class="tip-power-level">${loc.translate("ui.tooltip.currentLevel", { level: power.level })}</div>`
    : "";
  const stats = powerRowsHtml(loc, formatPowerStats(power.stats));
  const pet = power.pet ? petHtml(loc, power.pet) : "";
  return `<div class="tip-power">${loc.gameText(power.nameTag)}${proc}</div>${desc}${level}${stats}${pet}`;
}

// A summon proc's pet: the "Summons N <Pet>..." line, then the pet's base attack
// rendered like the power's own ability stat lines.
function petHtml(loc: Localization, pet: PetInfo): string {
  const { summon, attack } = formatPet(pet);
  return `<div class="tip-pet">${resolveText(loc, summon)}</div>${powerRowsHtml(loc, attack)}`;
}

function affinitySections(
  loc: Localization,
  con: Constellation,
  totals: AffinityTotals | undefined,
  selectedBenefits: Set<string>,
): string {
  const req = requiresLine(loc, con.affinityRequired, totals, selectedBenefits);
  const grant = affinityLine(loc, con.affinityBonus, selectedBenefits);
  return (
    (req ? `<div class="tip-req">${loc.translate("ui.tooltip.requires")}${req}</div>` : "") +
    (grant ? `<div class="tip-grant">${loc.translate("ui.tooltip.grants")}${grant}</div>` : "")
  );
}

// The interactive commit button for the touch popover; empty in passive (hover) mode.
function commitHtml(loc: Localization, commit?: { label: Text; enabled: boolean }): string {
  if (!commit) return "";
  return `<button class="tip-commit" type="button"${commit.enabled ? "" : " disabled"}>${resolveText(loc, commit.label)}</button>`;
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
      loc: Localization,
      model: DevotionModel,
      starId: StarId,
      clientX: number,
      clientY: number,
      totals?: AffinityTotals,
      commit?: { label: Text; enabled: boolean },
      selectedBenefits: Set<string> = new Set(),
      pathCost?: number,
    ) {
      const star = model.stars.get(starId);
      if (!star) return;
      const con = model.constellations.get(star.constellationId)!;
      const power = star.celestialPower ? powerHtml(loc, star.celestialPower) : "";
      const weaponReqTag = star.weaponRequirement?.descriptionTag;
      // The cost of claiming this star from here (its unselected predecessor path). The controller
      // passes it only for deep reachable stars (cost >= 2); frontier stars keep the plain tooltip.
      const costLine =
        pathCost !== undefined
          ? `<div class="tip-path-cost">${loc.translate("ui.tooltip.pointsToReach", { count: pathCost })}</div>`
          : "";
      el.innerHTML = `<strong>${loc.gameText(con.nameTag)}</strong>${costLine}${power}${bonusRowsHtml(loc, star.bonuses, selectedBenefits, (id) => id, star.racialTarget)}${weaponReqHtml(weaponReqTag ? loc.gameText(weaponReqTag) : null)}${petBonusHtml(loc, star.petBonuses, selectedBenefits)}${affinitySections(loc, con, totals, selectedBenefits)}${commitHtml(loc, commit)}`;
      el.style.pointerEvents = commit ? "auto" : "";
      place(clientX, clientY);
    },
    showConstellation(
      loc: Localization,
      model: DevotionModel,
      conId: string,
      clientX: number,
      clientY: number,
      totals?: AffinityTotals,
      dim?: { needs?: number; cap: number },
      commit?: { label: Text; enabled: boolean },
      selectedBenefits: Set<string> = new Set(),
    ) {
      const con = model.constellations.get(conId);
      if (!con) return;
      const stars = new Set(con.starIds);
      const powers = powersGained(model, stars)
        .map((p) => `<div class="tip-power">${loc.gameText(p.power.nameTag)}</div>`)
        .join("");
      const head = `<strong>${loc.gameText(con.nameTag)}</strong> <span class="tip-cost">${loc.translate("ui.tooltip.pts", { count: con.starIds.length })}</span>`;
      // `dim` with a `needs` count: how many points would complete it. `dim` without one: the engine
      // found no completion within the cap (do not leak the INF sentinel as a giant point count).
      const dimLine = dim
        ? dim.needs !== undefined
          ? `<div class="tip-dim">${loc.translate("ui.tooltip.needsPoints", { needs: dim.needs, cap: dim.cap })}</div>`
          : `<div class="tip-dim">${loc.translate("ui.tooltip.cannotComplete", { cap: dim.cap })}</div>`
        : "";
      // Weapon requirement(s) across the constellation's stars. When every star shares one
      // requirement (true of every gated constellation in the data today), show it verbatim like
      // the star tooltip; only hedge with "Some bonuses require ..." if the gating is partial or mixed.
      const reqDescs = weaponRequirements(model, stars)
        .map((r) => (r.descriptionTag ? loc.gameText(r.descriptionTag) : null))
        .filter((d): d is string => !!d);
      const distinctReqs = [...new Set(reqDescs)];
      const fullyGated = distinctReqs.length === 1 && reqDescs.length === stars.size;
      const weaponReq = fullyGated
        ? `<div class="tip-weapon-req">${distinctReqs[0]}</div>`
        : distinctReqs
            .map((d) => {
              const req = d.replace(/^Requires\s+/i, "");
              return `<div class="tip-weapon-req">${loc.translate("ui.tooltip.partialGate", { req })}</div>`;
            })
            .join("");
      el.innerHTML = `${head}${powers}${bonusRowsHtml(loc, sumBonuses(model, stars), selectedBenefits, (id) => id, racialTargets(model, stars))}${weaponReq}${petBonusHtml(loc, sumPetBonuses(model, stars), selectedBenefits)}${affinitySections(loc, con, totals, selectedBenefits)}${dimLine}${commitHtml(loc, commit)}`;
      el.style.pointerEvents = commit ? "auto" : "";
      place(clientX, clientY);
    },
    hide() {
      el.style.display = "none";
      el.style.pointerEvents = "";
    },
  };
}
