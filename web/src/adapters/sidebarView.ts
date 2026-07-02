// ABOUTME: DOM adapter that renders the benefits and affinity sidebar panels.
// ABOUTME: Formats summed stat totals via statFormat and shows affinity totals with colored orbs.
import { AFFINITIES, type Affinity, type CelestialPower, type DevotionModel, type StarId } from "../core/types";
import type { Vec } from "../core/reachability";
import { sumBonuses, sumPetBonuses, powersGained, racialTargets } from "../core/aggregate";
import { condensedRows, GROUP_KEY, type CondensedGroup, type CondensedSubject } from "../core/statFormat";
import { affinityOrb } from "./affinityColors";
import { affinityTagId } from "../core/urlState";
import { benefitRows, type BenefitGroup, type BenefitSubject } from "../core/benefitRows";
import { resolveText, sortByResolved, gameT } from "../core/localization";
import type { Localization } from "../ports/Localization";

// One row per celestial power: the name plus a data-star-id hook so a hover shows the power's full
// tooltip (proc, level, stats, requires/grants). Shared by the left "gained" list and the right
// "still pickable" list. Sorted by power name (the only text shown) - the source constellation order
// is meaningless here since the constellation only appears on hover.
export function powersListHtml(loc: Localization, powers: { starId: StarId; power: CelestialPower }[]): string {
  return sortByResolved(loc, powers, (p) => gameT(p.power.nameTag))
    .map((p) => `<div class="power" data-star-id="${p.starId}">${loc.gameText(p.power.nameTag)}</div>`)
    .join("");
}

// "up"/"down"/"" depending on how a value changed since the previous render (drives the flash).
function changeClass(prev: Record<string, number> | undefined, key: string, cur: Record<string, number>): string {
  if (!prev) return "";
  const n = cur[key] ?? 0;
  const p = prev[key] ?? 0;
  return n > p ? " up" : n < p ? " down" : "";
}

// One unified row renderer for both modes. comparing=false -> a single value cell (+ flash);
// comparing=true -> Base/Now/Delta cells. selectedBenefits drives the row highlight; flash adds the
// per-render up/down change class (regular mode only).
function benefitListHtml(
  loc: Localization,
  groups: BenefitGroup[],
  comparing: boolean,
  selectedBenefits: Set<string>,
  keyOf: (id: string) => string,
  flash: (id: string) => string,
): string {
  const cells = (r: BenefitGroup["subjects"][number]["rows"][number]) =>
    comparing
      ? `<span class="brow-v base">${resolveText(loc, r.base)}</span><span class="brow-v ${r.verdict}">${resolveText(loc, r.now)}</span><span class="brow-v ${r.verdict}">${resolveText(loc, r.delta)}</span>`
      : `<span class="brow-v${flash(r.id)}">${resolveText(loc, r.now)}</span>`;
  const rowHtml = (s: BenefitSubject, subject: string, r: BenefitGroup["subjects"][number]["rows"][number]) => {
    const vid = keyOf(r.id);
    const sel = selectedBenefits.has(vid) ? " vsel" : "";
    if (r.role === "subject") {
      const ids = s.ids.map(keyOf);
      const vtint = comparing && s.verdict ? ` ${s.verdict}` : "";
      return (
        `<div class="brow${sel}" data-gkey="${keyOf(s.key)}" data-ids="${ids.join(",")}">` +
        `<span class="brow-lbl subj${vtint}" data-gtoggle title="${subject}">${subject}</span>` +
        `<span class="brow-vals" data-vid="${vid}">${cells(r)}</span></div>`
      );
    }
    const lbl =
      r.role === "sub"
        ? `<span class="brow-lbl sub">${resolveText(loc, r.subLabel)}</span>`
        : `<span class="brow-lbl cont"></span>`;
    return `<div class="brow${sel}" data-vid="${vid}">${lbl}<span class="brow-vals">${cells(r)}</span></div>`;
  };
  return groups
    .map((g) => {
      const subjects = sortByResolved(loc, g.subjects, (s) => s.subject);
      const rowsHtml = subjects
        .map((s) => {
          const subject = resolveText(loc, s.subject);
          return s.rows.map((r) => rowHtml(s, subject, r)).join("");
        })
        .join("");
      return `<h3>${loc.translate(GROUP_KEY[g.group])}</h3>${rowsHtml}`;
    })
    .join("");
}

// Renders the Benefits panel: the subjects the current selection grants, with condensed values,
// and the read-only celestial powers and "Bonus to All Pets" sections (the pet section is now
// taggable too). The catalogs of benefits you could still pick up are returned as `availHtml`
// (player) and `petAvailHtml` (pet) rather than rendered here, so the caller places them under the
// Affinity panel on the right. Tag keys are scoped: player benefits use the bare stat id, pet
// benefits use `pet:<id>`, so a player tag and a pet tag of the same stat never collide.
export function renderBenefits(
  loc: Localization,
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
  baselineSelected: Set<StarId> | null = null,
): { bonuses: Record<string, number>; petBonuses: Record<string, number>; availHtml: string; petAvailHtml: string } {
  const bonuses = sumBonuses(model, selected);
  const petBonuses = sumPetBonuses(model, selected);
  const powers = powersGained(model, selected);

  // A render scope (player or pet) over one catalog. keyOf namespaces a raw stat id into its tag
  // key (identity for player, "pet:"+id for pet). The scope closes over selectedBenefits for
  // selection state.
  function makeScope(keyOf: (id: string) => string, scopeCatalog: CondensedGroup[]) {
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
    return { keys, gkey, groupSel };
  }

  type Scope = ReturnType<typeof makeScope>;
  const player = makeScope((id) => id, catalog);
  const pet = makeScope((id) => `pet:${id}`, petCatalog);

  const activeKeysOf = (groups: CondensedGroup[]) => {
    const set = new Set<string>();
    for (const g of groups) for (const s of g.subjects) set.add(s.key);
    return set;
  };

  // Active benefits: the unified one-row-per-value model, rendered for both modes.
  const rows = benefitRows(model, selected, baselineSelected);
  const flashPlayer = (id: string) => changeClass(prev, id, bonuses);
  const flashPet = (id: string) => changeClass(prevPet, id, petBonuses);
  const comparing = baselineSelected !== null;
  const activeHtml = benefitListHtml(loc, rows.player, comparing, selectedBenefits, (id) => id, flashPlayer);
  const petActiveHtml = benefitListHtml(loc, rows.pet, comparing, selectedBenefits, (id) => `pet:${id}`, flashPet);
  const activeKeys = activeKeysOf(condensedRows(bonuses, { racialTarget: racialTargets(model, selected) }));
  const petActiveKeys = activeKeysOf(condensedRows(petBonuses));

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
        const subs = sortByResolved(
          loc,
          g.subjects.filter((s) => {
            if (scopeActiveKeys.has(s.key)) return false;
            const ks = scope.keys(s);
            const obtainable = availKeys === undefined || ks.some((k) => availKeys.has(k));
            return obtainable || ks.some((k) => selectedBenefits.has(k));
          }),
          (s) => s.subject,
        )
          .map(
            (s) =>
              `<div class="bgroup avail${scope.groupSel(s)}" data-gkey="${scope.gkey(s)}" data-ids="${scope.keys(s).join(",")}"><span class="bsubj" data-gtoggle>${resolveText(loc, s.subject)}</span></div>`,
          )
          .join("");
        return subs ? `<h3>${loc.translate(GROUP_KEY[g.group])}</h3><div class="avail-list">${subs}</div>` : "";
      })
      .join("");

  const availHtml = availListHtml(catalog, player, activeKeys, availableIds);
  const petAvailHtml = availListHtml(petCatalog, pet, petActiveKeys, availablePetKeys);

  // data-star-id lets main.ts show the same rich tooltip as the power's map star on hover.
  const powerRows = powersListHtml(loc, powers);

  if (comparing) {
    const bar = `<div class="cmp-bar">${loc.translate("ui.compare.banner")}</div>`;
    const controls =
      `<div class="cmp-controls"><span class="cmp-spacer"></span>` +
      `<span class="cmp-revert-slot"><button id="cmp-revert" type="button">${loc.translate("ui.compare.revert")}</button></span>` +
      `<span class="cmp-upd-slot"><button id="cmp-update" type="button">${loc.translate("ui.compare.updateBaseline")}</button></span></div>`;
    const head = `<div class="cmp-head"><span class="brow-lbl"></span><span class="brow-v">${loc.translate("ui.compare.base")}</span><span class="brow-v">${loc.translate("ui.compare.now")}</span><span class="brow-v">${loc.translate("ui.compare.delta")}</span></div>`;
    el.innerHTML =
      `<h2>${loc.translate("ui.panel.benefits")}<button id="set-baseline" class="hidden" type="button"></button></h2>${bar}${controls}${head}` +
      (activeHtml || `<div class="bempty">${loc.translate("ui.benefits.empty")}</div>`) +
      (petActiveHtml ? `<h2 class="avail-head">${loc.translate("ui.panel.petBonus")}</h2>${petActiveHtml}` : "") +
      (powers.length ? `<h3>${loc.translate("ui.panel.celestialPowers")}</h3>${powerRows}` : "");
  } else {
    el.innerHTML =
      `<h2>${loc.translate("ui.panel.benefits")}<button id="set-baseline" type="button">${loc.translate("ui.compare.setBaseline")}</button></h2>` +
      `${activeHtml || `<div class="bempty">${loc.translate("ui.benefits.empty")}</div>`}` +
      (petActiveHtml ? `<h2 class="avail-head">${loc.translate("ui.panel.petBonus")}</h2>${petActiveHtml}` : "") +
      (powers.length ? `<h3>${loc.translate("ui.panel.celestialPowers")}</h3>${powerRows}` : "");
  }
  // availHtml and petAvailHtml are returned, not rendered here - the caller places them under the
  // Affinity panel on the right.
  return { bonuses, petBonuses, availHtml, petAvailHtml };
}

// Renders the Affinity panel as two columns: the current total ("have") and, when a
// started constellation demands a color ("need"), a second value colored met/unmet whose
// title lists the demanding constellation names. Returns the have-totals so the caller can
// pass them back as `prev` next time to highlight what changed.
export function renderAffinities(
  loc: Localization,
  el: HTMLElement,
  model: DevotionModel,
  have: Vec,
  need: Vec,
  needSource: Map<number, string[]>,
  prev?: Record<Affinity, number>,
  selectedBenefits: Set<string> = new Set(),
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
      const names = (needSource.get(i) ?? [])
        .map((cid) => {
          const tag = model.constellations.get(cid)?.nameTag;
          return tag ? loc.gameText(tag) : cid;
        })
        .join(", ");
      needCell = `<span class="aff-need ${met ? "met" : "missing"}" title="${names ? loc.translate("ui.affinity.neededBy", { names }) : ""}">${n}</span>`;
    } else {
      // Nothing requires this color: still render the cell (dimmed 0) so both columns stay aligned.
      needCell = `<span class="aff-need none">0</span>`;
    }
    const grantId = affinityTagId("grant", a);
    const reqId = affinityTagId("req", a);
    const sel = selectedBenefits.has(grantId) ? " vsel" : "";
    return `<div class="affinity affinity-${a}${flash}${sel}" data-gkey="${grantId}" data-gtoggle data-ids="${grantId},${reqId}"><span>${affinityOrb(a)}${loc.translate(`aff.${a}`)}</span><span class="aff-have">${have[i]}</span>${needCell}</div>`;
  }).join("");
  el.innerHTML = `<h2>${loc.translate("ui.panel.affinity")}</h2><div class="affinity-head"><span></span><span class="aff-have">${loc.translate("ui.affinity.have")}</span><span class="aff-need-h">${loc.translate("ui.affinity.need")}</span></div>${rows}`;
  return totals;
}
