// ABOUTME: Application entry point for the Grim Dawn Devotion Planner.
// ABOUTME: Owns SelectionState and wires every adapter (data, svg, nav, sidebars, tooltip) to the core.
import { httpDataSource } from "../adapters/httpDataSource";
import {
  loadLocalization,
  SUPPORTED_LOCALES,
  LOCALE_NAMES,
  storedLocale,
  storeLocale,
} from "../adapters/localizationAdapter";
import { mountLanguagePicker } from "../adapters/languagePicker";
import { mountSvg } from "../adapters/svgRenderer";
import { attachNav, navHandlers } from "../adapters/navController";
import { renderBenefits, renderAffinities, powersListHtml } from "../adapters/sidebarView";
import { buildOrderHtml, type NoOrderInfo } from "../adapters/buildOrderView";
import { tooltipView } from "../adapters/tooltipView";
import { toggleDrawer, type DrawerState } from "../core/drawerState";
import { toggleStar, toggleConstellation, recapValue, repairSelection } from "../core/rules";
import { commitButton, type CommitTarget } from "../core/commitAction";
import {
  buildReachCons,
  selectionView,
  completionMinCost,
  selectionSummary,
  setExactResolver,
  INF,
  type ReachView,
  type ReachCon,
  type BuildStep,
  type Vec,
} from "../core/reachability";
import { loadWasmResolver } from "../adapters/reachWasm";
import {
  canonicalStarIds,
  canonicalStatIds,
  canonicalPetStatIds,
  canonicalBenefitIds,
  canonicalPowerStatIds,
  decodeHash,
  encodeHash,
} from "../core/urlState";
import { parseTag } from "../core/benefitTag";
import { affinityTotals } from "../core/affinity";
import {
  starsGranting,
  availableBonusIds,
  starsGrantingPet,
  availablePetKeys,
  availablePowers,
} from "../core/aggregate";
import { condensedRows } from "../core/statFormat";
import type { Affinity, SelectionState, StarId } from "../core/types";

async function boot() {
  // A prior failed load may have set this guard (see bootFailed() in index.html). The module has now
  // loaded, so clear it — a later same-session deploy mismatch can then auto-recover again.
  try {
    sessionStorage.removeItem("bootReloaded");
  } catch {}
  const data = await httpDataSource(".").load();
  // A stored override (from the language picker) wins over browser auto-detection; if none, pass
  // undefined so loadLocalization falls back to navigator.languages as before.
  const overrideLocale = storedLocale(SUPPORTED_LOCALES);
  let localization = await loadLocalization({
    base: ".",
    available: SUPPORTED_LOCALES,
    preferred: overrideLocale ? [overrideLocale] : undefined,
  });
  const model = data.model;
  const cons: ReachCon[] = buildReachCons(model);
  const table = data.coverTable; // null -> dimming disabled (degraded)

  // Swap in the WASM resolver for the expensive bracket gap (verdict-equivalent, ~30x faster on the
  // worst sweep). Must happen before repairSelection below, which classifies. Any failure leaves the
  // pure TS resolver in place, so the page still works (just slower) without reach.wasm.
  let resolverKind = "ts";
  if (data.reachWasm && table) {
    const wasm = await loadWasmResolver(data.reachWasm, cons, table);
    if (wasm) {
      setExactResolver(wasm);
      resolverKind = "wasm";
    }
  }
  (globalThis as Record<string, unknown>).__reachResolver = resolverKind; // diagnostic; the e2e asserts this

  // Restore state from the URL hash if present (validated so a stale link can't be invalid).
  const canonical = canonicalStarIds(model);
  const statCanonical = canonicalStatIds(model);
  const benefitCanonical = canonicalBenefitIds(model);
  const restored = decodeHash(location.hash, canonical, benefitCanonical);
  let state: SelectionState = restored
    ? {
        selected: repairSelection(model, cons, table, restored.selected, restored.pointCap),
        pointCap: restored.pointCap,
      }
    : { selected: new Set(), pointCap: 55 };
  // The cap can never be below the points actually allocated; raise it if a restored
  // link is over budget (the slider also enforces this floor below).
  state = { selected: state.selected, pointCap: Math.max(state.pointCap, state.selected.size) };
  // Baseline for the comparison mode: null when not comparing.
  let baseline: SelectionState | null = restored?.baseline ?? null;
  // The finite cap to fall back to when the user re-imposes the limit after going uncapped.
  let lastFiniteCap = Number.isFinite(state.pointCap) ? state.pointCap : 55;
  // Benefit "tags": the raw stat ids selected in the Benefits panel; they highlight the
  // matching map nodes and are persisted in the URL so a shared link restores them.
  const selectedBenefits = new Set<string>(restored?.benefits ?? []);
  // The full benefit catalog (every subject + its stat ids), so the panel can list benefits the
  // current build does not grant yet. condensedRows now returns ids/keys/Text descriptors (no
  // resolved strings), so the catalog is locale-independent and built once at boot.
  const allBonuses: Record<string, number> = {};
  for (const id of statCanonical) allBonuses[id] = 1;
  for (const id of canonicalPowerStatIds(model)) allBonuses[id] = 1;
  // The pet benefit catalog (every pet subject + its stat ids), for the pet "Available to get" list.
  // Pet stat ids are raw here (static per model); the renderer scopes them.
  const allPetBonuses: Record<string, number> = {};
  for (const id of canonicalPetStatIds(model)) allPetBonuses[id] = 1;
  const benefitCatalog = condensedRows(allBonuses);
  const petCatalog = condensedRows(allPetBonuses);

  const mapContainer = document.getElementById("map-container") as HTMLElement;
  const benefitsEl = document.getElementById("benefits") as HTMLElement;
  const affinityEl = document.getElementById("affinity") as HTMLElement;
  const tooltipEl = document.getElementById("tooltip") as HTMLElement;
  const barEl = document.getElementById("point-bar") as HTMLElement;
  const totalWord = document.getElementById("total-word") as HTMLElement;
  const capToggle = document.getElementById("cap-toggle") as HTMLButtonElement;
  const resetPointsBtn = document.getElementById("reset-points") as HTMLButtonElement;
  const headerEl = document.querySelector("header") as HTMLElement;
  const leftBtn = document.getElementById("drawer-left-btn") as HTMLButtonElement;
  const rightBtn = document.getElementById("drawer-right-btn") as HTMLButtonElement;
  const scrim = document.getElementById("drawer-scrim") as HTMLElement;
  // Static chrome text, re-applied after a language switch (the views re-render via refresh()).
  function applyChrome() {
    document.title = localization.translate("ui.title");
    (document.querySelector(".plabel") as HTMLElement).textContent = localization.translate("ui.points.label");
    totalWord.textContent = ` ${localization.translate("ui.points.total")}`;
    resetPointsBtn.textContent = localization.translate("ui.points.reset");
    leftBtn.setAttribute("aria-label", localization.translate("ui.drawer.benefitsAria"));
    rightBtn.setAttribute("aria-label", localization.translate("ui.drawer.affinityAria"));
    leftBtn.textContent = localization.translate("ui.drawer.benefits");
    rightBtn.textContent = localization.translate("ui.drawer.affinity");
    barEl.setAttribute("aria-label", localization.translate("ui.points.budgetAria"));
  }
  applyChrome();
  // Language picker (globe button, right of the header). Switching swaps catalogs, re-applies chrome,
  // and re-renders the views; locale is a viewer preference, never in the URL hash.
  const picker = mountLanguagePicker(headerEl, {
    current: localization.locale,
    available: SUPPORTED_LOCALES,
    names: LOCALE_NAMES,
    label: localization.translate("ui.lang.label"),
    onSelect: async (locale) => {
      storeLocale(locale);
      localization = await loadLocalization({ base: ".", available: SUPPORTED_LOCALES, preferred: [locale] });
      applyChrome();
      picker.setCurrent(localization.locale, localization.translate("ui.lang.label"));
      refresh();
    },
  });
  const tip = tooltipView(tooltipEl);
  const isTouch = () => matchMedia("(hover: none) and (pointer: coarse)").matches;
  let popoverTarget: CommitTarget | null = null; // the star/constellation the open popover commits
  let popoverXY = { x: 0, y: 0 }; // last popover anchor, so a tag toggle can re-show it in place
  let dismissedPopoverTap = false; // a tap that just dismissed a popover; its click must not reopen one
  // Max devotion points = the bar's full extent; the slider floor is the validity minimum (curMin).
  const MAX_POINTS = 55;
  let curMin = 0; // selectionMinCost for the current selection, recomputed each refresh

  // Pulse one element by retriggering the transient flash animation.
  function flashEl(el: Element | null | undefined) {
    if (!el) return;
    el.classList.remove("flash-blocked");
    void (el as SVGElement).getBoundingClientRect(); // restart the animation if it is mid-flash
    el.classList.add("flash-blocked");
    el.addEventListener("animationend", () => el.classList.remove("flash-blocked"), { once: true });
  }

  // The map stars to emphasize for the current benefit tags: player tags scan player bonuses,
  // pet tags scan pet bonuses; affinity tags are constellation-level (see affinityFilterSets).
  function taggedStars(): Set<StarId> {
    const playerTags = new Set<string>();
    const petTags = new Set<string>();
    for (const k of selectedBenefits) {
      const tag = parseTag(k);
      if (tag?.kind === "player") playerTags.add(tag.statId);
      else if (tag?.kind === "pet") petTags.add(tag.statId);
    }
    const out = starsGranting(model, playerTags);
    for (const id of starsGrantingPet(model, petTags)) out.add(id);
    return out;
  }

  // The active affinity filter as grant/require sets, or undefined when no affinity tag is selected.
  // The renderer matches each constellation against these (matchedAffinities) to glow it or mild-fade it.
  function affinityFilterSets(): { grants: Set<Affinity>; requires: Set<Affinity> } | undefined {
    const grants = new Set<Affinity>();
    const requires = new Set<Affinity>();
    for (const k of selectedBenefits) {
      const tag = parseTag(k);
      if (tag?.kind !== "affinity") continue;
      (tag.dir === "grant" ? grants : requires).add(tag.affinity);
    }
    if (grants.size === 0 && requires.size === 0) return undefined;
    return { grants, requires };
  }

  // The permissive ReachView for the degraded path (uncapped, or no cover table): nothing dims, every
  // constellation is completable and every frontier star clickable, while have/need still come from the
  // selection summary. The dimming-on path goes through the core selectionView port (see refresh).
  let reach: ReachView;
  function permissiveReach(): ReachView {
    const s = selectionSummary(model, state.selected);
    const needSource = new Map<number, string[]>();
    for (let i = 0; i < 5; i++) {
      if (s.target[i] === 0) continue;
      const src: string[] = [];
      for (const cid of s.startedIds) {
        const c = model.constellations.get(cid)!;
        const r = [
          c.affinityRequired.ascendant ?? 0,
          c.affinityRequired.chaos ?? 0,
          c.affinityRequired.eldritch ?? 0,
          c.affinityRequired.order ?? 0,
          c.affinityRequired.primordial ?? 0,
        ];
        if (r[i] === s.target[i]) src.push(cid);
      }
      needSource.set(i, src);
    }
    const completable = new Set<string>([...model.constellations.keys()]);
    const clickable = new Set<string>();
    for (const st of model.stars.values())
      if (!state.selected.has(st.id) && st.predecessors.every((p) => state.selected.has(p))) clickable.add(st.id);
    return { completable, clickable, have: s.supply, need: s.target, needSource };
  }

  // The minimum points to complete a faded constellation, cached per refresh. Returns
  // undefined when the constellation is already completable (no "needs" line) or when
  // dimming is off, so the tooltip only shows the line for genuinely un-completable ones.
  const completionCache = new Map<string, number>(); // cleared each refresh
  function completionInfo(conId: string): { needs?: number; cap: number } | undefined {
    if (!table || !Number.isFinite(state.pointCap)) return undefined;
    if (reach.completable.has(conId)) return undefined; // completable -> no "needs" line
    if (!completionCache.has(conId))
      completionCache.set(conId, completionMinCost(model, cons, table, state.selected, conId, state.pointCap));
    const needs = completionCache.get(conId)!;
    // A finite cost is the completion minimum; INF means no completion within the cap, so show a
    // plain "cannot" line rather than leaking the sentinel as a giant point count.
    return needs < INF ? { needs, cap: state.pointCap } : { cap: state.pointCap };
  }

  const handle = mountSvg(mapContainer, model, {
    manifest: data.manifest,
    onStarClick: (id, x, y) => {
      if (isTouch()) {
        showCommitPopover({ kind: "star", id }, x, y);
        return;
      }
      const next = toggleStar(model, state, reach, id);
      if (next !== state) {
        state = next;
        refresh();
      }
    },
    onConstellationClick: (id, x, y) => {
      if (isTouch()) {
        showCommitPopover({ kind: "constellation", id }, x, y);
        return;
      }
      const next = toggleConstellation(model, state, reach, id);
      if (next !== state) {
        state = next;
        refresh();
      }
    },
    onHover: (t, x, y) => {
      if (!t) {
        tip.hide();
        return;
      }
      const totals = affinityTotals(model, state.selected);
      if (t.kind === "star") tip.show(localization, model, t.id, x, y, totals, undefined, selectedBenefits);
      else
        tip.showConstellation(
          localization,
          model,
          t.id,
          x,
          y,
          totals,
          completionInfo(t.id),
          undefined,
          selectedBenefits,
        );
    },
  });

  // A hovered power row (left "gained" list or right "still pickable" list) shows the power's full
  // tooltip - the same rich tooltip as its map star - and lights up the power's own star on the map with
  // the benefit-match treatment (enlarged + halo) so it is obvious which node grants it. Attached to both
  // sidebar containers; both survive innerHTML re-renders because the listener is on the container.
  const powerRowHover = (e: Event) => {
    const sid = (e.target as Element)?.closest?.(".power[data-star-id]")?.getAttribute("data-star-id");
    if (sid) {
      tip.show(
        localization,
        model,
        sid,
        (e as MouseEvent).clientX,
        (e as MouseEvent).clientY,
        affinityTotals(model, state.selected),
        undefined,
        selectedBenefits,
      );
      handle.highlightStar(sid);
    } else {
      tip.hide();
      handle.highlightStar(null);
    }
  };
  const powerRowLeave = () => {
    tip.hide();
    handle.highlightStar(null);
  };
  benefitsEl.addEventListener("mousemove", powerRowHover);
  affinityEl.addEventListener("mousemove", powerRowHover);
  benefitsEl.addEventListener("mouseleave", powerRowLeave);
  affinityEl.addEventListener("mouseleave", powerRowLeave);

  // Benefit selection: click a value to toggle just it; click a subject to toggle
  // all of its values (so the group reads as selected only when every value is). Attached to both
  // sidebars: the "have" benefits live in the left panel, "available to get" in the right one.
  function onBenefitClick(e: Event) {
    const t = e.target as HTMLElement;
    if (t.id === "set-baseline") {
      baseline = { selected: new Set(state.selected), pointCap: state.pointCap };
      refresh();
      return;
    }
    if (t.id === "cmp-revert" && baseline) {
      // Revert: discard the live edits, restore the baseline snapshot, and exit compare.
      state = { selected: new Set(baseline.selected), pointCap: baseline.pointCap };
      baseline = null;
      refresh();
      return;
    }
    if (t.id === "cmp-update") {
      // Adopt the live (Now) build and exit compare.
      baseline = null;
      refresh();
      return;
    }
    const valEl = (e.target as Element)?.closest?.("[data-vid]");
    if (valEl) {
      const id = valEl.getAttribute("data-vid")!;
      selectedBenefits.has(id) ? selectedBenefits.delete(id) : selectedBenefits.add(id);
    } else {
      const group = (e.target as Element)?.closest?.("[data-gtoggle]")?.closest("[data-gkey]");
      if (!group) return;
      const ids = (group.getAttribute("data-ids") ?? "").split(",").filter(Boolean);
      if (ids.length === 0) return;
      const allSel = ids.every((id) => selectedBenefits.has(id));
      for (const id of ids) allSel ? selectedBenefits.delete(id) : selectedBenefits.add(id);
    }
    refresh(); // re-render benefits, re-highlight the map, and persist tags to the URL
  }
  benefitsEl.addEventListener("click", onBenefitClick);
  affinityEl.addEventListener("click", onBenefitClick);

  attachNav(() => mapContainer.querySelector("svg"), {
    fitPoints: [...model.stars.values()].map((s) => s.position),
    onDragStateChange: (d) => mapContainer.classList.toggle("grabbing", d),
  });
  const h = navHandlers();
  mapContainer.addEventListener("wheel", h.onWheel, { passive: false });
  mapContainer.addEventListener("pointerdown", h.onDown);
  mapContainer.addEventListener("click", h.onClickCapture, true);
  resetPointsBtn.addEventListener("click", () => {
    state = { selected: new Set(), pointCap: state.pointCap };
    refresh();
  });

  // The points bar: a custom control showing used (spent) / min (validity floor) / cap (budget),
  // with a grey grabber for the cap. The grabber is floored at curMin - the fewest points that keep
  // the current selection a legal build - not merely at the points already spent.
  function capFromClientX(clientX: number): number {
    const r = barEl.getBoundingClientRect();
    const v = Math.round(((clientX - r.left) / r.width) * MAX_POINTS);
    return Math.max(curMin, Math.min(MAX_POINTS, v));
  }
  function setCap(cap: number): void {
    state = { selected: state.selected, pointCap: cap };
    refresh();
  }
  function renderPointBar(): void {
    const used = state.selected.size;
    const uncapped = !Number.isFinite(state.pointCap);
    const cap = uncapped ? MAX_POINTS : (state.pointCap as number);
    const pct = (v: number) => (v / MAX_POINTS) * 100;
    const showMin = curMin > used;
    // The min label is anchored at the used boundary and runs right, so it overlaps the grabber once
    // used is within ~8 points of the cap; hide just the label then (the orange band still shows).
    const hideMinLabel = cap - used <= 8;
    const headStart = showMin ? curMin : used;
    let html = `<div class="pb-seg pb-used" style="width:${pct(used)}%"></div>`;
    if (showMin)
      html += `<div class="pb-seg pb-min" style="left:${pct(used)}%;width:${pct(curMin) - pct(used)}%"></div>`;
    html += `<div class="pb-seg pb-head" style="left:${pct(headStart)}%;width:${pct(cap) - pct(headStart)}%"></div>`;
    html += `<span class="pb-lab" style="left:0">${localization.translate("ui.points.used", { count: used })}</span>`;
    if (showMin && !hideMinLabel)
      html += `<span class="pb-lab" style="left:${pct(used)}%">${localization.translate("ui.points.min", { count: curMin })}</span>`;
    if (!uncapped) html += `<div class="pb-grab" style="left:${pct(cap)}%"></div>`;
    barEl.innerHTML = html;
    barEl.classList.toggle("uncapped", uncapped);
    barEl.setAttribute("aria-valuemin", String(curMin));
    barEl.setAttribute("aria-valuemax", String(MAX_POINTS));
    barEl.setAttribute("aria-valuenow", String(cap));
  }
  let dragging = false;
  const onBarMove = (e: PointerEvent) => {
    if (dragging) setCap(capFromClientX(e.clientX));
  };
  const onBarUp = () => {
    dragging = false;
    window.removeEventListener("pointermove", onBarMove);
    window.removeEventListener("pointerup", onBarUp);
    window.removeEventListener("pointercancel", onBarUp);
  };
  barEl.addEventListener("pointerdown", (e) => {
    if (!Number.isFinite(state.pointCap)) return; // uncapped: the bar is read-only
    dragging = true;
    setCap(capFromClientX(e.clientX));
    window.addEventListener("pointermove", onBarMove);
    window.addEventListener("pointerup", onBarUp);
    window.addEventListener("pointercancel", onBarUp);
  });
  barEl.addEventListener("keydown", (e) => {
    if (!Number.isFinite(state.pointCap)) return;
    let c = state.pointCap as number;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") c -= 1;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") c += 1;
    else if (e.key === "Home") c = curMin;
    else if (e.key === "End") c = MAX_POINTS;
    else return;
    e.preventDefault();
    setCap(Math.max(curMin, Math.min(MAX_POINTS, c)));
  });

  // The cap button toggles between the finite limit and uncapped (Infinity).
  // Re-imposing the limit is blocked while over the max - the user must deselect
  // back under it first, signalled by flashing the used count.
  capToggle.addEventListener("click", () => {
    if (Number.isFinite(state.pointCap)) {
      lastFiniteCap = state.pointCap;
      state = { selected: state.selected, pointCap: Infinity };
      refresh();
      return;
    }
    const cap = recapValue(state.selected.size, lastFiniteCap);
    if (cap === null) {
      flashEl(capToggle);
      return;
    }
    state = { selected: state.selected, pointCap: cap };
    refresh();
  });

  // Previous totals, so each render can highlight what just changed. Undefined on the
  // first render (the baseline), so restoring a build from the URL does not flash.
  let prevBonuses: Record<string, number> | undefined;
  let prevPet: Record<string, number> | undefined;
  let prevAffinity: Record<Affinity, number> | undefined;
  let availHtml = ""; // "available to get" catalog HTML; rendered under the Affinity panel on the right
  let petAvailHtml = ""; // pet "available to get" catalog HTML; rendered below the player one on the right
  let curBuildOrder: BuildStep[] | null = null; // live build order from selectionView; null in degraded path
  // Re-render only the Benefits panel (used by benefit-tag clicks, which do not
  // change the star selection so nothing flashes).
  function paintBuildOrder(steps: BuildStep[] | null, noOrder?: NoOrderInfo | null) {
    let panel = document.getElementById("build-order-panel");
    if (!panel) {
      affinityEl.insertAdjacentHTML("beforeend", `<hr class="panel-sep"/><div id="build-order-panel"></div>`);
      panel = document.getElementById("build-order-panel")!;
    }
    panel.innerHTML = buildOrderHtml(localization, model, data.manifest, steps, noOrder);
    // Hover-sync: build-order rows carry data-con-id; box that constellation on the map (drawn on top).
    panel.querySelectorAll<HTMLElement>(".bo-step[data-con-id]").forEach((row) => {
      const cid = row.dataset.conId;
      if (!cid) return;
      row.addEventListener("mouseenter", () => handle.highlightCon(cid));
      row.addEventListener("mouseleave", () => handle.highlightCon(null));
    });
  }
  function renderBenefitsPanel() {
    // "Available to get" lists only benefits still reachable from here: bonuses on unselected stars
    // in constellations that remain completable. In the permissive path completable is every
    // constellation, so this lists everything not yet held (the prior behavior).
    const availableIds = availableBonusIds(model, state.selected, reach.completable);
    const availPetKeys = availablePetKeys(model, state.selected, reach.completable);
    const r = renderBenefits(
      localization,
      benefitsEl,
      model,
      state.selected,
      prevBonuses,
      selectedBenefits,
      benefitCatalog,
      availableIds,
      prevPet,
      petCatalog,
      availPetKeys,
      baseline?.selected ?? null,
    );
    prevBonuses = r.bonuses;
    prevPet = r.petBonuses;
    availHtml = r.availHtml;
    petAvailHtml = r.petAvailHtml;
  }
  function refresh() {
    completionCache.clear();
    // The full per-click engine cost (validity floor + dimming sweep) is the core selectionView port;
    // this controller is a thin caller, so optimize selectionView, not refresh. The degraded path
    // (uncapped or no table) stays permissive and cheap.
    if (table && Number.isFinite(state.pointCap)) {
      const view = selectionView(model, cons, table, state.selected, state.pointCap);
      curMin = view.minCost;
      // The cap can never sit below the validity floor (raise a stale/over-tight restored link).
      if (state.pointCap < curMin) state = { selected: state.selected, pointCap: curMin };
      reach = view.reach;
      curBuildOrder = view.buildOrder;
    } else {
      curMin = state.selected.size;
      reach = permissiveReach();
      curBuildOrder = null;
    }
    document.body.classList.toggle("comparing", baseline !== null);
    updateNarrow();
    const diff = baseline
      ? {
          added: new Set([...state.selected].filter((s) => !baseline!.selected.has(s))),
          removed: new Set([...baseline.selected].filter((s) => !state.selected.has(s))),
        }
      : null;
    handle.update(state, taggedStars(), reach, diff, affinityFilterSets());
    renderBenefitsPanel();
    prevAffinity = renderAffinities(
      localization,
      affinityEl,
      model,
      reach.have,
      reach.need,
      reach.needSource,
      prevAffinity,
      selectedBenefits,
    );
    // "Available to get" goes under the Affinity panel, separated from the affinity rows.
    if (availHtml)
      affinityEl.insertAdjacentHTML(
        "beforeend",
        `<hr class="panel-sep"/><h2>${localization.translate("ui.panel.availableToGet")}</h2>${availHtml}`,
      );
    if (petAvailHtml)
      affinityEl.insertAdjacentHTML(
        "beforeend",
        `<hr class="panel-sep"/><h2>${localization.translate("ui.panel.petBonus")}</h2>${petAvailHtml}`,
      );
    const availPowers = availablePowers(model, state.selected, reach.completable);
    if (availPowers.length)
      affinityEl.insertAdjacentHTML(
        "beforeend",
        `<hr class="panel-sep"/><h2>${localization.translate("ui.panel.celestialPowers")}</h2>${powersListHtml(localization, availPowers)}`,
      );
    // Empty-state copy. The build order shows whenever the selection is self-covering: the cap is auto-raised
    // to the validity floor (above), so a self-covering selection that still has no order is genuinely
    // unbuildable within 55, not merely under-budgeted. Otherwise show a prompt (nothing to order yet) or the
    // affinity-deficit instructions for an incomplete selection.
    let boInfo: NoOrderInfo | null = null;
    if (!curBuildOrder) {
      const capped = !!table && Number.isFinite(state.pointCap);
      if (capped && state.selected.size > 0 && reach.have && reach.need) {
        const deficit = reach.need.map((n, i) => Math.max(0, n - reach.have[i]!)) as Vec;
        boInfo = deficit.some((d) => d > 0) ? { kind: "incomplete", deficit } : { kind: "searched", minCap: null };
      } else {
        boInfo = { kind: "empty" };
      }
    }
    paintBuildOrder(curBuildOrder, boInfo);
    const uncapped = !Number.isFinite(state.pointCap);
    capToggle.textContent = uncapped ? "∞" : String(state.pointCap);
    capToggle.title = uncapped
      ? localization.translate("ui.points.capRestoreTitle")
      : localization.translate("ui.points.capRemoveTitle");
    totalWord.style.display = uncapped ? "none" : "";
    renderPointBar();
    history.replaceState(
      null,
      "",
      `#${encodeHash(state.selected, state.pointCap, canonical, selectedBenefits, benefitCanonical, baseline)}`,
    );
  }

  // Expose the header height to CSS so the corner toggles sit just below the top bar.
  function setHeaderH() {
    document.body.style.setProperty("--header-h", `${headerEl.offsetHeight}px`);
  }
  setHeaderH();
  window.addEventListener("resize", setHeaderH);

  // Narrow layout: collapse when the docked sidebars would exceed half the viewport. The threshold is
  // compare-mode-dependent (the left panel widens to 450px when comparing), so it is computed here from
  // two width queries rather than duplicated across @media blocks. body.narrow gates all collapse CSS.
  const mqNarrow = matchMedia("(max-width: 1060px)");
  const mqNarrowCompare = matchMedia("(max-width: 1400px)");
  let drawer: DrawerState = "none";
  function renderDrawer() {
    benefitsEl.classList.toggle("open", drawer === "left");
    affinityEl.classList.toggle("open", drawer === "right");
    scrim.classList.toggle("show", drawer !== "none");
    leftBtn.setAttribute("aria-expanded", String(drawer === "left"));
    rightBtn.setAttribute("aria-expanded", String(drawer === "right"));
  }
  function setDrawer(next: DrawerState) {
    drawer = next;
    renderDrawer();
  }
  function updateNarrow() {
    const narrow = mqNarrow.matches || (baseline !== null && mqNarrowCompare.matches);
    document.body.classList.toggle("narrow", narrow);
    if (!narrow && drawer !== "none") setDrawer("none"); // docked layout must not keep a drawer/scrim open
  }
  mqNarrow.addEventListener("change", updateNarrow);
  mqNarrowCompare.addEventListener("change", updateNarrow);
  leftBtn.addEventListener("click", () => setDrawer(toggleDrawer(drawer, "left")));
  rightBtn.addEventListener("click", () => setDrawer(toggleDrawer(drawer, "right")));
  scrim.addEventListener("click", () => setDrawer("none"));
  // Escape closes an open drawer or popover (keyboard dismiss; the scrim handles pointer dismiss).
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (drawer !== "none") setDrawer("none");
    if (popoverTarget) {
      popoverTarget = null;
      tip.hide();
    }
  });
  updateNarrow();

  // Touch popover: show the inspect tooltip with an Add/Remove button; commit only via that button.
  function showCommitPopover(target: CommitTarget, x: number, y: number) {
    popoverTarget = target;
    popoverXY = { x, y };
    const totals = affinityTotals(model, state.selected);
    const btn = commitButton(model, state.selected, reach, target);
    if (target.kind === "star") tip.show(localization, model, target.id, x, y, totals, btn, selectedBenefits);
    else
      tip.showConstellation(
        localization,
        model,
        target.id,
        x,
        y,
        totals,
        completionInfo(target.id),
        btn,
        selectedBenefits,
      );
  }
  function commitPopover() {
    if (!popoverTarget) return;
    const next =
      popoverTarget.kind === "star"
        ? toggleStar(model, state, reach, popoverTarget.id)
        : toggleConstellation(model, state, reach, popoverTarget.id);
    popoverTarget = null;
    tip.hide();
    if (next !== state) {
      state = next;
      refresh();
    }
  }
  // Commit on pointerup, not click: iOS Safari can swallow the synthetic click on a just-shown popover,
  // but the low-level pointerup always fires. The button only exists in touch mode, so pointerup is safe.
  tooltipEl.addEventListener("pointerup", (e) => {
    const t = e.target as Element;
    if (t?.closest?.(".tip-commit")) {
      commitPopover();
      return;
    }
    // Tapping a tagged benefit/affinity row toggles that filter and keeps the popover open (re-shown in
    // place with the new highlight). Guarded by popoverTarget so it only acts in the touch popover.
    const vidEl = t?.closest?.("[data-vid]");
    if (vidEl && popoverTarget) {
      const id = vidEl.getAttribute("data-vid")!;
      selectedBenefits.has(id) ? selectedBenefits.delete(id) : selectedBenefits.add(id);
      refresh();
      showCommitPopover(popoverTarget, popoverXY.x, popoverXY.y);
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (popoverTarget && !tooltipEl.contains(e.target as Node)) {
      popoverTarget = null;
      tip.hide();
      dismissedPopoverTap = true; // swallow this tap's click so it does not open a new popover
    }
  });
  // On mobile it is hard to find empty space, so a dismissing tap often lands on a constellation. Stop
  // that tap's click from reaching the map (capture phase runs before the map's bubble click handler).
  document.addEventListener(
    "click",
    (e) => {
      if (dismissedPopoverTap) {
        dismissedPopoverTap = false;
        if (mapContainer.contains(e.target as Node)) e.stopPropagation();
      }
    },
    true,
  );

  refresh();
}

boot().catch((e) => {
  document.body.innerHTML = `<pre style="color:#f88;padding:1rem">${String(e)}</pre>`;
});
