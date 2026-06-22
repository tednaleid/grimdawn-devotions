// ABOUTME: Application entry point for the Grim Dawn Devotion Planner.
// ABOUTME: Owns SelectionState and wires every adapter (data, svg, nav, sidebars, tooltip) to the core.
import { httpDataSource } from "../adapters/httpDataSource";
import { mountSvg } from "../adapters/svgRenderer";
import { attachNav, navHandlers } from "../adapters/navController";
import { renderBenefits, renderAffinities } from "../adapters/sidebarView";
import { tooltipView } from "../adapters/tooltipView";
import { toggleStar, toggleConstellation, recapValue, repairSelection } from "../core/rules";
import { buildReachCons, reachabilityForSelection, completionMinCost, selectionSummary, setExactResolver, type ReachView, type ReachCon } from "../core/reachability";
import { loadWasmResolver } from "../adapters/reachWasm";
import { canonicalStarIds, canonicalStatIds, decodeHash, encodeHash } from "../core/urlState";
import { affinityTotals } from "../core/affinity";
import { starsGranting } from "../core/aggregate";
import { condensedRows } from "../core/statFormat";
import type { Affinity, SelectionState } from "../core/types";

async function boot() {
  const data = await httpDataSource(".").load();
  const model = data.model;
  const cons: ReachCon[] = buildReachCons(model);
  const table = data.coverTable;                                 // null -> dimming disabled (degraded)

  // Swap in the WASM resolver for the expensive bracket gap (verdict-equivalent, ~30x faster on the
  // worst sweep). Must happen before repairSelection below, which classifies. Any failure leaves the
  // pure TS resolver in place, so the page still works (just slower) without reach.wasm.
  let resolverKind = "ts";
  if (data.reachWasm && table) {
    const wasm = await loadWasmResolver(data.reachWasm, cons, table);
    if (wasm) { setExactResolver(wasm); resolverKind = "wasm"; }
  }
  (globalThis as Record<string, unknown>).__reachResolver = resolverKind; // diagnostic; the e2e asserts this

  // Restore state from the URL hash if present (validated so a stale link can't be invalid).
  const canonical = canonicalStarIds(model);
  const statCanonical = canonicalStatIds(model);
  const restored = decodeHash(location.hash, canonical, statCanonical);
  let state: SelectionState = restored
    ? { selected: repairSelection(model, cons, table, restored.selected, restored.pointCap), pointCap: restored.pointCap }
    : { selected: new Set(), pointCap: 55 };
  // The cap can never be below the points actually allocated; raise it if a restored
  // link is over budget (the slider also enforces this floor below).
  state = { selected: state.selected, pointCap: Math.max(state.pointCap, state.selected.size) };
  // The finite cap to fall back to when the user re-imposes the limit after going uncapped.
  let lastFiniteCap = Number.isFinite(state.pointCap) ? state.pointCap : 55;
  // Benefit "tags": the raw stat ids selected in the Benefits panel; they highlight the
  // matching map nodes and are persisted in the URL so a shared link restores them.
  const selectedBenefits = new Set<string>(restored?.benefits ?? []);
  // The full benefit catalog (every subject + its stat ids), so the panel can list
  // benefits the current build does not grant yet. Static per model, computed once.
  const allBonuses: Record<string, number> = {};
  for (const id of statCanonical) allBonuses[id] = 1;
  const benefitCatalog = condensedRows(allBonuses);

  const mapContainer = document.getElementById("map-container") as HTMLElement;
  const benefitsEl = document.getElementById("benefits") as HTMLElement;
  const affinityEl = document.getElementById("affinity") as HTMLElement;
  const tooltipEl = document.getElementById("tooltip") as HTMLElement;
  const slider = document.getElementById("point-slider") as HTMLInputElement;
  const countEl = document.getElementById("point-count") as HTMLElement;
  const usedEl = document.getElementById("point-used") as HTMLElement;
  const capToggle = document.getElementById("cap-toggle") as HTMLButtonElement;
  const resetBtn = document.getElementById("reset-view") as HTMLButtonElement;
  const resetPointsBtn = document.getElementById("reset-points") as HTMLButtonElement;
  const tip = tooltipView(tooltipEl);
  if (Number.isFinite(state.pointCap)) slider.value = String(state.pointCap);

  // Pulse one element by retriggering the transient flash animation.
  function flashEl(el: Element | null | undefined) {
    if (!el) return;
    el.classList.remove("flash-blocked");
    void (el as SVGElement).getBoundingClientRect(); // restart the animation if it is mid-flash
    el.classList.add("flash-blocked");
    el.addEventListener("animationend", () => el.classList.remove("flash-blocked"), { once: true });
  }

  // The current ReachView, recomputed each refresh. When the table is present and the
  // cap is finite the engine drives dimming; otherwise (uncapped or no table) a permissive
  // view is built so nothing dims, while have/need still come from the selection summary.
  let reach: ReachView;
  function computeReach(): ReachView {
    const s = selectionSummary(model, state.selected);
    const needSource = new Map<number, string[]>();
    for (let i = 0; i < 5; i++) {
      if (s.target[i] === 0) continue;
      const src: string[] = [];
      for (const cid of s.startedIds) {
        const c = model.constellations.get(cid)!;
        const r = [c.affinityRequired.ascendant ?? 0, c.affinityRequired.chaos ?? 0, c.affinityRequired.eldritch ?? 0, c.affinityRequired.order ?? 0, c.affinityRequired.primordial ?? 0];
        if (r[i] === s.target[i]) src.push(cid);
      }
      needSource.set(i, src);
    }
    if (table && Number.isFinite(state.pointCap)) return reachabilityForSelection(model, cons, table, state.selected, state.pointCap);
    const completable = new Set<string>([...model.constellations.keys()]);
    const clickable = new Set<string>();
    for (const st of model.stars.values()) if (!state.selected.has(st.id) && st.predecessors.every((p) => state.selected.has(p))) clickable.add(st.id);
    return { completable, clickable, have: s.supply, need: s.target, needSource };
  }

  // The minimum points to complete a faded constellation, cached per refresh. Returns
  // undefined when the constellation is already completable (no "needs" line) or when
  // dimming is off, so the tooltip only shows the line for genuinely un-completable ones.
  const completionCache = new Map<string, number>();           // cleared each refresh
  function completionInfo(conId: string): { needs: number; cap: number } | undefined {
    if (!table || !Number.isFinite(state.pointCap)) return undefined;
    if (reach.completable.has(conId)) return undefined;        // completable -> no "needs" line
    if (!completionCache.has(conId)) completionCache.set(conId, completionMinCost(model, cons, table, state.selected, conId, state.pointCap));
    const needs = completionCache.get(conId)!;
    return Number.isFinite(needs) ? { needs, cap: state.pointCap } : undefined;
  }

  const handle = mountSvg(mapContainer, model, {
    manifest: data.manifest,
    onStarClick: (id) => { const next = toggleStar(model, state, reach, id); if (next !== state) { state = next; refresh(); } },
    onConstellationClick: (id) => { const next = toggleConstellation(model, state, reach, id); if (next !== state) { state = next; refresh(); } },
    onHover: (t, x, y) => {
      if (!t) { tip.hide(); return; }
      const totals = affinityTotals(model, state.selected);
      if (t.kind === "star") tip.show(model, t.id, x, y, totals);
      else tip.showConstellation(model, t.id, x, y, totals, completionInfo(t.id));
    },
  });

  // The sidebar "Celestial Powers" list shows the same rich tooltip as the power's
  // map star (proc, level, stats, requires/grants) when a row is hovered.
  benefitsEl.addEventListener("mousemove", (e) => {
    const sid = (e.target as Element)?.closest?.(".power[data-star-id]")?.getAttribute("data-star-id");
    if (sid) tip.show(model, sid, (e as MouseEvent).clientX, (e as MouseEvent).clientY, affinityTotals(model, state.selected));
    else tip.hide();
  });
  benefitsEl.addEventListener("mouseleave", () => tip.hide());

  // Benefit selection: click a value to toggle just it; click a subject to toggle
  // all of its values (so the group reads as selected only when every value is).
  benefitsEl.addEventListener("click", (e) => {
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
  });

  const nav = attachNav(() => mapContainer.querySelector("svg"), {
    fitPoints: [...model.stars.values()].map((s) => s.position),
    onDragStateChange: (d) => mapContainer.classList.toggle("grabbing", d),
  });
  const h = navHandlers();
  mapContainer.addEventListener("wheel", h.onWheel, { passive: false });
  mapContainer.addEventListener("mousedown", h.onDown);
  mapContainer.addEventListener("click", h.onClickCapture, true);
  resetBtn.addEventListener("click", () => nav.reset());
  resetPointsBtn.addEventListener("click", () => {
    state = { selected: new Set(), pointCap: state.pointCap };
    refresh();
  });

  slider.addEventListener("input", () => {
    // The cap cannot drop below the points already allocated; snap the thumb back
    // up to that floor if dragged under it.
    const cap = Math.max(Number(slider.value), state.selected.size);
    if (String(cap) !== slider.value) slider.value = String(cap);
    state = { selected: state.selected, pointCap: cap };
    refresh();
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
    if (cap === null) { flashEl(countEl); return; }
    state = { selected: state.selected, pointCap: cap };
    refresh();
  });

  // Previous totals, so each render can highlight what just changed. Undefined on the
  // first render (the baseline), so restoring a build from the URL does not flash.
  let prevBonuses: Record<string, number> | undefined;
  let prevPet: Record<string, number> | undefined;
  let prevAffinity: Record<Affinity, number> | undefined;
  // Re-render only the Benefits panel (used by benefit-tag clicks, which do not
  // change the star selection so nothing flashes).
  function renderBenefitsPanel() {
    const r = renderBenefits(benefitsEl, model, state.selected, prevBonuses, selectedBenefits, benefitCatalog, prevPet);
    prevBonuses = r.bonuses;
    prevPet = r.petBonuses;
  }
  function refresh() {
    completionCache.clear();
    reach = computeReach();
    handle.update(state, starsGranting(model, selectedBenefits), reach);
    slider.min = String(Math.max(1, state.selected.size)); // cannot drag below allocated points
    renderBenefitsPanel();
    prevAffinity = renderAffinities(affinityEl, model, reach.have, reach.need, reach.needSource, prevAffinity);
    const uncapped = !Number.isFinite(state.pointCap);
    usedEl.textContent = String(state.selected.size);
    capToggle.textContent = uncapped ? "∞" : String(state.pointCap);
    capToggle.title = uncapped ? "Click to restore the 55-point limit" : "Click to remove the point limit";
    slider.disabled = uncapped;
    if (!uncapped) slider.value = String(state.pointCap);
    history.replaceState(null, "", `#${encodeHash(state.selected, state.pointCap, canonical, selectedBenefits, statCanonical)}`);
  }
  refresh();
}

boot().catch((e) => { document.body.innerHTML = `<pre style="color:#f88;padding:1rem">${String(e)}</pre>`; });
