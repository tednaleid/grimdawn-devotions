// ABOUTME: Application entry point for the Grim Dawn Devotion Planner.
// ABOUTME: Owns SelectionState and wires every adapter (data, svg, nav, sidebars, tooltip) to the core.
import { httpDataSource } from "../adapters/httpDataSource";
import { mountSvg } from "../adapters/svgRenderer";
import { attachNav, navHandlers } from "../adapters/navController";
import { renderBenefits, renderAffinities } from "../adapters/sidebarView";
import { tooltipView } from "../adapters/tooltipView";
import { toggleStar, toggleConstellation, validClosure } from "../core/rules";
import { canonicalStarIds, decodeHash, encodeHash } from "../core/urlState";
import type { SelectionState } from "../core/types";

async function boot() {
  const data = await httpDataSource(".").load();
  const model = data.model;

  // Restore state from the URL hash if present (validated so a stale link can't be invalid).
  const canonical = canonicalStarIds(model);
  const restored = decodeHash(location.hash, canonical);
  let state: SelectionState = restored
    ? { selected: validClosure(model, restored.selected), pointCap: restored.pointCap }
    : { selected: new Set(), pointCap: 55 };

  const mapContainer = document.getElementById("map-container") as HTMLElement;
  const benefitsEl = document.getElementById("benefits") as HTMLElement;
  const affinityEl = document.getElementById("affinity") as HTMLElement;
  const tooltipEl = document.getElementById("tooltip") as HTMLElement;
  const slider = document.getElementById("point-slider") as HTMLInputElement;
  const countEl = document.getElementById("point-count") as HTMLElement;
  const resetBtn = document.getElementById("reset-view") as HTMLButtonElement;
  const tip = tooltipView(tooltipEl);
  slider.value = String(state.pointCap);

  const handle = mountSvg(mapContainer, model, {
    manifest: data.manifest,
    onStarClick: (id) => { state = toggleStar(model, state, id); refresh(); },
    onConstellationClick: (id) => { state = toggleConstellation(model, state, id); refresh(); },
    onHover: (t, x, y) => {
      if (!t) { tip.hide(); return; }
      if (t.kind === "star") tip.show(model, t.id, x, y);
      else tip.showConstellation(model, t.id, x, y);
    },
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

  slider.addEventListener("input", () => {
    // The cap only gates ADDING (selectableStars checks selected.size < pointCap).
    // Lowering it below the current allocation is allowed and shown as over-budget;
    // the user removes leaf stars to get back under. No auto-removal (guarded model).
    state = { selected: state.selected, pointCap: Number(slider.value) };
    refresh();
  });

  function refresh() {
    handle.update(state);
    renderBenefits(benefitsEl, model, state.selected);
    renderAffinities(affinityEl, model, state.selected);
    countEl.textContent = `${state.selected.size} / ${state.pointCap}`;
    history.replaceState(null, "", `#${encodeHash(state.selected, state.pointCap, canonical)}`);
  }
  refresh();
}

boot().catch((e) => { document.body.innerHTML = `<pre style="color:#f88;padding:1rem">${String(e)}</pre>`; });
