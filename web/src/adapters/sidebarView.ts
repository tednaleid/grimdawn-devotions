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

// Renders the Benefits panel: the subjects the current selection grants, with condensed values,
// and the read-only celestial powers and "Bonus to All Pets" sections (the pet section is now
// taggable too). The catalogs of benefits you could still pick up are returned as `availHtml`
// (player) and `petAvailHtml` (pet) rather than rendered here, so the caller places them under the
// Affinity panel on the right. Tag keys are scoped: player benefits use the bare stat id, pet
// benefits use `pet:<id>`, so a player tag and a pet tag of the same stat never collide.
export function renderBenefits(
  el: HTMLElement,
  model: DevotionModel,
  selected: Set<StarId>,
  prev?: Record<string, number>,
  selectedBenefits: Set<string> = new Set(),
  catalog: CondensedGroup[] = [],
  availableIds?: Set<string>,
  prevPet?: Record<string, number>,
  petCatalog: CondensedGroup[] = [],
  availablePetKeys?: Set<string>,
): { bonuses: Record<string, number>; petBonuses: Record<string, number>; availHtml: string; petAvailHtml: string } {
  const bonuses = sumBonuses(model, selected);
  const petBonuses = sumPetBonuses(model, selected);
  const powers = powersGained(model, selected);

  // A render scope (player or pet) over one catalog. keyOf namespaces a raw stat id into its tag
  // key (identity for player, "pet:"+id for pet). The scope closes over selectedBenefits for
  // selection state and over flashPrev/totals for the per-render change flash.
  function makeScope(
    keyOf: (id: string) => string,
    scopeCatalog: CondensedGroup[],
    flashPrev: Record<string, number> | undefined,
    totals: Record<string, number>,
  ) {
    const catIds = new Map<string, string[]>();
    for (const g of scopeCatalog)
      for (const s of g.subjects)
        catIds.set(
          s.key,
          s.parts.map((p) => p.id),
        );
    const rawIds = (s: CondensedSubject) => catIds.get(s.key) ?? s.parts.map((p) => p.id);
    const keys = (s: CondensedSubject) => rawIds(s).map(keyOf);
    const gkey = (s: CondensedSubject) => keyOf(s.key);
    const groupSel = (s: CondensedSubject) => {
      const k = keys(s);
      return k.length > 0 && k.every((x) => selectedBenefits.has(x)) ? " gsel" : "";
    };
    const chip = (p: CondensedPart) =>
      `<span class="bchip${selectedBenefits.has(keyOf(p.id)) ? " vsel" : ""}${changeClass(flashPrev, p.id, totals)}" data-vid="${keyOf(p.id)}">${partText(p)}</span>`;
    // Active subject (with values): damage types split into damage/duration sub-rows.
    const activeSubject = (s: CondensedSubject) => {
      const open = `<div class="bgroup${groupSel(s)}" data-gkey="${gkey(s)}" data-ids="${keys(s).join(",")}">`;
      const main = s.parts.filter((p) => p.dim !== "durFlat" && p.dim !== "durPct");
      const dur = s.parts.filter((p) => p.dim === "durFlat" || p.dim === "durPct");
      if (dur.length) {
        return (
          `${open}<div class="bsubj" data-gtoggle>${s.subject}</div>` +
          `<div class="bsub"><span class="blbl">damage</span><span class="bvals">${main.map(chip).join("")}</span></div>` +
          `<div class="bsub"><span class="blbl">duration</span><span class="bvals">${dur.map(chip).join("")}</span></div></div>`
        );
      }
      return `${open}<div class="bsingle"><span class="bsubj" data-gtoggle>${s.subject}</span><span class="bvals">${main.map(chip).join("")}</span></div></div>`;
    };
    return { keys, gkey, groupSel, activeSubject };
  }

  type Scope = ReturnType<typeof makeScope>;
  const player = makeScope((id) => id, catalog, prev, bonuses);
  const pet = makeScope((id) => `pet:${id}`, petCatalog, prevPet, petBonuses);

  // The benefits a selection grants, rendered as interactive value chips, per scope.
  const activeListHtml = (groups: CondensedGroup[], scope: Scope) =>
    groups.map((g) => `<h3>${g.group}</h3>${g.subjects.map(scope.activeSubject).join("")}`).join("");
  const activeKeysOf = (groups: CondensedGroup[]) => {
    const set = new Set<string>();
    for (const g of groups) for (const s of g.subjects) set.add(s.key);
    return set;
  };

  const activeGroups = condensedRows(bonuses, { racialTarget: racialTargets(model, selected) });
  const activeHtml = activeListHtml(activeGroups, player);
  const activeKeys = activeKeysOf(activeGroups);

  const petGroups = condensedRows(petBonuses);
  const petActiveHtml = activeListHtml(petGroups, pet);
  const petActiveKeys = activeKeysOf(petGroups);

  // "Available to get": inactive catalog subjects still obtainable (a key in availKeys) or tagged
  // (so a tag can always be cleared). availKeys undefined disables the filter (permissive path).
  const availListHtml = (
    scopeCatalog: CondensedGroup[],
    scope: Scope,
    scopeActiveKeys: Set<string>,
    availKeys: Set<string> | undefined,
  ) =>
    scopeCatalog
      .map((g) => {
        const subs = g.subjects
          .filter((s) => {
            if (scopeActiveKeys.has(s.key)) return false;
            const ks = scope.keys(s);
            const obtainable = availKeys === undefined || ks.some((k) => availKeys.has(k));
            return obtainable || ks.some((k) => selectedBenefits.has(k));
          })
          .map(
            (s) =>
              `<div class="bgroup avail${scope.groupSel(s)}" data-gkey="${scope.gkey(s)}" data-ids="${scope.keys(s).join(",")}"><span class="bsubj" data-gtoggle>${s.subject}</span></div>`,
          )
          .join("");
        return subs ? `<h3>${g.group}</h3><div class="avail-list">${subs}</div>` : "";
      })
      .join("");

  const availHtml = availListHtml(catalog, player, activeKeys, availableIds);
  const petAvailHtml = availListHtml(petCatalog, pet, petActiveKeys, availablePetKeys);

  // data-star-id lets main.ts show the same rich tooltip as the power's map star on hover.
  const powerRows = powers.map((p) => `<div class="power" data-star-id="${p.starId}">${p.power.name}</div>`).join("");

  el.innerHTML =
    `<h2>Benefits</h2>${activeHtml || '<div class="bempty">Select stars to gain benefits.</div>'}` +
    (petActiveHtml ? `<h2 class="avail-head">Bonus to All Pets</h2>${petActiveHtml}` : "") +
    (powers.length ? `<h3>Celestial Powers</h3>${powerRows}` : "");
  // availHtml and petAvailHtml are returned, not rendered here - the caller places them under the
  // Affinity panel on the right.
  return { bonuses, petBonuses, availHtml, petAvailHtml };
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
  const totals = {
    ascendant: have[0],
    chaos: have[1],
    eldritch: have[2],
    order: have[3],
    primordial: have[4],
  } as Record<Affinity, number>;
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
