// ABOUTME: Application entry point for the Grim Dawn Devotion Planner.
// ABOUTME: Owns SelectionState and wires every adapter (data, svg, nav, sidebars, tooltip) to the core.
import { httpDataSource } from "../adapters/httpDataSource";
import { mountSvg } from "../adapters/svgRenderer";
import { attachNav, navHandlers } from "../adapters/navController";
import { renderBenefits, renderAffinities } from "../adapters/sidebarView";
import { tooltipView } from "../adapters/tooltipView";
import { toggleStar, toggleConstellation, validClosure, removalBlockers } from "../core/rules";
import { canonicalStarIds, canonicalStatIds, decodeHash, encodeHash } from "../core/urlState";
import { affinityTotals } from "../core/affinity";
import { starsGranting } from "../core/aggregate";
import type { Affinity, SelectionState } from "../core/types";

async function boot() {
  const data = await httpDataSource(".").load();
  const model = data.model;

  // Restore state from the URL hash if present (validated so a stale link can't be invalid).
  const canonical = canonicalStarIds(model);
  const statCanonical = canonicalStatIds(model);
  const restored = decodeHash(location.hash, canonical, statCanonical);
  let state: SelectionState = restored
    ? { selected: validClosure(model, restored.selected), pointCap: restored.pointCap }
    : { selected: new Set(), pointCap: 55 };
  // The cap can never be below the points actually allocated; raise it if a restored
  // link is over budget (the slider also enforces this floor below).
  state = { selected: state.selected, pointCap: Math.max(state.pointCap, state.selected.size) };
  // Benefit "tags": the raw stat ids selected in the Benefits panel; they highlight the
  // matching map nodes and are persisted in the URL so a shared link restores them.
  const selectedBenefits = new Set<string>(restored?.benefits ?? []);

  const mapContainer = document.getElementById("map-container") as HTMLElement;
  const benefitsEl = document.getElementById("benefits") as HTMLElement;
  const affinityEl = document.getElementById("affinity") as HTMLElement;
  const tooltipEl = document.getElementById("tooltip") as HTMLElement;
  const slider = document.getElementById("point-slider") as HTMLInputElement;
  const countEl = document.getElementById("point-count") as HTMLElement;
  const resetBtn = document.getElementById("reset-view") as HTMLButtonElement;
  const resetPointsBtn = document.getElementById("reset-points") as HTMLButtonElement;
  const tip = tooltipView(tooltipEl);
  slider.value = String(state.pointCap);

  // Pulse one element by retriggering the transient flash animation.
  function flashEl(el: Element | null | undefined) {
    if (!el) return;
    el.classList.remove("flash-blocked");
    void (el as SVGElement).getBoundingClientRect(); // restart the animation if it is mid-flash
    el.classList.add("flash-blocked");
    el.addEventListener("animationend", () => el.classList.remove("flash-blocked"), { once: true });
  }

  // A rejected deselection leaves state unchanged; flash the stars that must be
  // removed first (predecessor or affinity dependents) so the block is visible.
  // For a whole-constellation deselect we are likely zoomed out, so also flash
  // the blocking constellations' art icons, which read at that distance.
  function flashBlockers(ids: Set<string>, includeArt: boolean) {
    const svg = mapContainer.querySelector("svg");
    if (!svg) return;
    const conIds = new Set<string>();
    for (const id of ids) {
      flashEl(svg.querySelector(`[data-star-id="${id}"]`)?.nextElementSibling);
      const con = model.stars.get(id)?.constellationId;
      if (con) conIds.add(con);
    }
    if (includeArt) for (const cid of conIds) flashEl(svg.querySelector(`image.art[data-con-id="${cid}"]`));
  }

  const handle = mountSvg(mapContainer, model, {
    manifest: data.manifest,
    onStarClick: (id) => {
      const next = toggleStar(model, state, id);
      if (next === state) { // rejected: only flash if it was a removal attempt
        if (state.selected.has(id)) flashBlockers(removalBlockers(model, state, new Set([id])), false);
        return;
      }
      state = next; refresh();
    },
    onConstellationClick: (id) => {
      const next = toggleConstellation(model, state, id);
      if (next === state) { // rejected: flash blockers only when it was a full-constellation removal
        const con = model.constellations.get(id);
        if (con && con.starIds.length > 0 && con.starIds.every((s) => state.selected.has(s))) {
          flashBlockers(removalBlockers(model, state, new Set(con.starIds)), true);
        }
        return;
      }
      state = next; refresh();
    },
    onHover: (t, x, y) => {
      if (!t) { tip.hide(); return; }
      const totals = affinityTotals(model, state.selected);
      if (t.kind === "star") tip.show(model, t.id, x, y, totals);
      else tip.showConstellation(model, t.id, x, y, totals);
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
      const ids = [...group.querySelectorAll("[data-vid]")].map((c) => c.getAttribute("data-vid")!);
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

  // Previous totals, so each render can highlight what just changed. Undefined on the
  // first render (the baseline), so restoring a build from the URL does not flash.
  let prevBonuses: Record<string, number> | undefined;
  let prevAffinity: Record<Affinity, number> | undefined;
  // Re-render only the Benefits panel (used by benefit-tag clicks, which do not
  // change the star selection so nothing flashes).
  function renderBenefitsPanel() {
    prevBonuses = renderBenefits(benefitsEl, model, state.selected, prevBonuses, selectedBenefits);
  }
  function refresh() {
    handle.update(state, starsGranting(model, selectedBenefits));
    slider.min = String(Math.max(1, state.selected.size)); // cannot drag below allocated points
    renderBenefitsPanel();
    prevAffinity = renderAffinities(affinityEl, model, state.selected, prevAffinity);
    countEl.textContent = `${state.selected.size} / ${state.pointCap}`;
    history.replaceState(null, "", `#${encodeHash(state.selected, state.pointCap, canonical, selectedBenefits, statCanonical)}`);
  }
  refresh();
}

boot().catch((e) => { document.body.innerHTML = `<pre style="color:#f88;padding:1rem">${String(e)}</pre>`; });
