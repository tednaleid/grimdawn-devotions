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
import { mountAppMenu, type AppMenuContent } from "../adapters/appMenu";
import type { InfoPopoverText } from "../adapters/infoPopover";
import { mountSvg } from "../adapters/svgRenderer";
import { attachNav, navHandlers } from "../adapters/navController";
import { renderBenefits, renderAffinities, powersListHtml } from "../adapters/sidebarView";
import { buildOrderHtml, transitionHtml, buildStepPopupHtml, type NoOrderInfo } from "../adapters/buildOrderView";
import type { StepState } from "../core/orderLegality";
import { tooltipView, escapeHtml, type DimInfo } from "../adapters/tooltipView";
import { affinityDeficits, dimReport, membersNeedingScaffold, type DimReport } from "../core/dimReasons";
import { reasonLines } from "../adapters/dimText";
import { toggleDrawer, type DrawerState } from "../core/drawerState";
import { toggleStar, toggleConstellation, recapValue, repairSelection } from "../core/rules";
import { commitButton, type CommitTarget } from "../core/commitAction";
import {
  buildReachCons,
  selectionView,
  selectionSummary,
  setExactResolver,
  pathToStar,
  type ReachView,
  type ReachCon,
  type BuildStep,
  type SelectionView,
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
  normalizeQuery,
} from "../core/urlState";
import { parseTag } from "../core/benefitTag";
import { searchCorpus, matchQuery, type SearchMatch } from "../core/search";
import { resolveIndex } from "../adapters/searchIndex";
import { mountSearchPanel } from "../adapters/searchPanel";
import { mapStars, invertStarTable, toGrimtoolsSkills, type StarTable } from "../core/grimtools";
import { mountImportPanel, type ExportErrorCode, type ExportState, type ImportState } from "../adapters/importPanel";
import { makeWorkerGateway } from "../adapters/grimtoolsWorkerGateway";
import type { ExportBase, FetchBuildResult } from "../ports/GrimtoolsGateway";
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

const GITHUB_URL = "https://github.com/tednaleid/grimdawn-devotions";
const STEAMDB_PATCHNOTES_URL = "https://steamdb.info/patchnotes/"; // per-build page: <base><buildid>/

// The import service. Local development points at `just worker-dev`; the deployed value is
// substituted at build time. Both globals come from bundle.ts's define map.
declare const __IMPORT_API__: string;
declare const __BUILD_ID__: string;
const importApi = typeof __IMPORT_API__ === "string" ? __IMPORT_API__ : "http://localhost:8787";
// The one object that talks to the worker, both directions (see ports/GrimtoolsGateway).
const gateway = makeWorkerGateway(importApi);
const buildId = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";

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
  let state: SelectionState = { selected: new Set(), pointCap: 55 };
  // Baseline for the comparison mode: null when not comparing.
  let baseline: SelectionState | null = null;
  // The finite cap to fall back to when the user re-imposes the limit after going uncapped.
  let lastFiniteCap = 55;
  // Benefit "tags": the raw stat ids selected in the Benefits panel; they highlight the
  // matching map nodes and are persisted in the URL so a shared link restores them.
  const selectedBenefits = new Set<string>();
  // The live search query. Emphasizes matching map nodes and rides in the URL so a shared
  // link restores it, like the benefit tags.
  let query = "";
  // The grimtools slug the current build was imported from, or "" when there is none: provenance
  // (see urlState's gt=) and the base an export copies from. Rides in the hash so a shared link
  // keeps it; read once in the background at load for its title (see ensureSourceRead), never
  // applied back to the selection.
  let source = "";
  // Decode and repair a hash into planner state. Runs at boot and on every hashchange
  // (Back/Forward, bookmark clicks, hand-edited URLs); an undecodable hash is the empty build.
  function applyHash(hash: string): void {
    const restored = decodeHash(hash, canonical, benefitCanonical);
    state = restored
      ? {
          selected: repairSelection(model, cons, table, restored.selected, restored.pointCap),
          pointCap: restored.pointCap,
        }
      : { selected: new Set(), pointCap: 55 };
    // The cap can never be below the points actually allocated; raise it if a restored
    // link is over budget (the slider also enforces this floor below).
    state = { selected: state.selected, pointCap: Math.max(state.pointCap, state.selected.size) };
    baseline = restored?.baseline ?? null;
    if (Number.isFinite(state.pointCap)) lastFiniteCap = state.pointCap;
    selectedBenefits.clear();
    for (const b of restored?.benefits ?? []) selectedBenefits.add(b);
    query = restored?.query ?? "";
    source = restored?.source ?? "";
  }
  applyHash(location.hash);
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
  // The search corpus is locale-independent and built once; the index is per-locale and
  // rebuilt on a language switch (see the app menu's onSelect).
  const corpus = searchCorpus(model);
  let searchIndex = resolveIndex(localization, corpus);
  let searchMatch: SearchMatch = { constellations: new Set(), stars: new Set() };
  function recomputeSearch() {
    searchMatch = matchQuery(searchIndex, query);
  }
  recomputeSearch();

  const mapContainer = document.getElementById("map-container") as HTMLElement;
  const benefitsEl = document.getElementById("benefits") as HTMLElement;
  const affinityEl = document.getElementById("affinity") as HTMLElement;
  const affinityPanelEl = document.getElementById("affinity-panel") as HTMLElement;
  const availPanelEl = document.getElementById("avail-panel") as HTMLElement;
  const searchPanelEl = document.getElementById("search-panel") as HTMLElement;
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
  // The App menu's About panel: the planner's provenance (description, game-data version, repo link).
  function infoText(): InfoPopoverText {
    const date = data.meta.generatedUtc.slice(0, 10); // date portion of the ISO stamp, timezone-free
    const gameData = data.meta.gameVersion
      ? date
        ? localization.translate("ui.info.gameData", { version: data.meta.gameVersion, date })
        : localization.translate("ui.info.gameDataNoDate", { version: data.meta.gameVersion })
      : null;
    const build = data.meta.steamBuildid
      ? {
          label: localization.translate("ui.info.build", { buildid: data.meta.steamBuildid }),
          url: `${STEAMDB_PATCHNOTES_URL}${data.meta.steamBuildid}/`,
        }
      : null;
    return {
      label: localization.translate("ui.info.aria"),
      description: localization.translate("ui.info.description"),
      gameData,
      build,
      github: localization.translate("ui.info.github"),
    };
  }
  // Header app menu (hamburger, right of the header): links to the three sibling apps, the
  // language list, and the About panel. Switching locale swaps catalogs, re-applies chrome, and
  // re-renders; locale is a viewer preference, never in the URL hash.
  function menuContent(): AppMenuContent {
    return {
      nav: [
        { href: "resistance-reduction/", label: localization.translate("ui.nav.rr") },
        { href: "monster-resistances/", label: localization.translate("ui.nav.monsters") },
        { href: "items/", label: localization.translate("ui.nav.items") },
      ],
      languageHeading: localization.translate("ui.menu.language"),
      current: localization.locale,
      available: SUPPORTED_LOCALES,
      names: LOCALE_NAMES,
      info: infoText(),
      githubUrl: GITHUB_URL,
    };
  }
  const menu = mountAppMenu(headerEl, {
    ...menuContent(),
    menuLabel: localization.translate("ui.menu.label"),
    onSelect: async (locale) => {
      storeLocale(locale);
      localization = await loadLocalization({ base: ".", available: SUPPORTED_LOCALES, preferred: [locale] });
      applyChrome();
      menu.update(menuContent(), localization.translate("ui.menu.label"));
      // The index is per-locale (the corpus is not), and the panel owns its own chrome.
      searchIndex = resolveIndex(localization, corpus);
      searchPanel.relocalize(localization);
      importPanel.relocalize(localization);
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

  // Benefit tags and search share one glow: both mean "this node matches what you asked for".
  function emphasizedStars(): Set<StarId> {
    const out = taggedStars();
    for (const id of searchMatch.stars) out.add(id);
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
  // constellation is completable and every unselected star reachable, while have/need still come from the
  // selection summary. The dimming-on path goes through the core selectionView port (see refresh).
  // Starts permissive because the import panel reads it when it mounts, which is before the boot
  // render computes the real view.
  let reach: ReachView = permissiveReach();
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
    const reachableStars = new Set<string>();
    for (const st of model.stars.values()) if (!state.selected.has(st.id)) reachableStars.add(st.id);
    return { completable, reachableStars, have: s.supplyUncapped, need: s.target, needSource, legal: false };
  }

  // Why a faded constellation (or a locked star) is dim: the completion minimum searched past the
  // cap, the affinity short and who needs it, the members that need transient affinity. Computed on
  // hover only and cached per refresh (keyed by the constellation or star asked about). Returns
  // undefined when the target is reachable (no explanation to give) or when dimming is off.
  const dimCache = new Map<string, DimReport>(); // cleared each refresh
  function dimInfoFor(key: string, target: Set<StarId>): DimInfo {
    if (!dimCache.has(key)) dimCache.set(key, dimReport(model, cons, table!, target));
    return { report: dimCache.get(key)!, cap: state.pointCap };
  }
  function completionInfo(conId: string): DimInfo | undefined {
    if (!table || !Number.isFinite(state.pointCap)) return undefined;
    if (reach.completable.has(conId)) return undefined;
    const target = new Set(state.selected);
    for (const sid of model.constellations.get(conId)!.starIds) target.add(sid);
    return dimInfoFor(`con:${conId}`, target);
  }
  function starDimInfo(starId: StarId): DimInfo | undefined {
    if (!table || !Number.isFinite(state.pointCap)) return undefined;
    if (state.selected.has(starId) || reach.reachableStars.has(starId)) return undefined;
    const target = new Set(state.selected);
    for (const sid of pathToStar(model, state.selected, starId)) target.add(sid);
    return dimInfoFor(`star:${starId}`, target);
  }

  // The path cost to show in a star tooltip: the star's unselected predecessor path size, only for
  // an unselected reachable star whose path is 2+ (frontier stars keep the plain tooltip).
  function starPathCost(starId: StarId): number | undefined {
    if (state.selected.has(starId) || !reach.reachableStars.has(starId)) return undefined;
    const cost = pathToStar(model, state.selected, starId).size;
    return cost >= 2 ? cost : undefined;
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
      if (t.kind === "star")
        tip.show(
          localization,
          model,
          t.id,
          x,
          y,
          totals,
          undefined,
          selectedBenefits,
          starPathCost(t.id),
          starDimInfo(t.id),
        );
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
    if (t.id === "cmp-swap" && baseline) {
      // Swap: the baseline becomes the live build and vice versa; the comparison stays active.
      // refresh() pushes one history entry, or none when the two builds are identical (hash unchanged).
      const live = state;
      state = { selected: new Set(baseline.selected), pointCap: baseline.pointCap };
      baseline = { selected: new Set(live.selected), pointCap: live.pointCap };
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
  function setCap(cap: number, urlMode: "push" | "replace" = "push"): void {
    state = { selected: state.selected, pointCap: cap };
    refresh(urlMode);
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
    if (showMin) {
      // Why the floor sits above the spent points: the affinity short (and who needs it) and the
      // members that need transient affinity, from the current selection's summary (no engine call).
      const st = selectionSummary(model, state.selected);
      const why = [
        localization.translate("ui.points.minTitle", { count: curMin }),
        ...reasonLines(localization, model, {
          needs: curMin,
          deficit: affinityDeficits(model, st),
          scaffolders: membersNeedingScaffold(model, st),
        }),
      ].join("\n");
      html += `<div class="pb-seg pb-min" title="${escapeHtml(why)}" style="left:${pct(used)}%;width:${pct(curMin) - pct(used)}%"></div>`;
    }
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
  // The pointerdown commit can land exactly on the current cap (grabbing the grabber itself),
  // which no-ops through refresh()'s dedupe guard and pushes nothing. dragPushed tracks whether
  // this gesture has actually pushed yet, so the first commit that really changes the hash is the
  // one that pushes and every commit after that replaces it. Without this, a mid-drag pointermove
  // would blindly replace whatever entry was current before the gesture started, clobbering it.
  let dragPushed = false;
  function commitDragCap(cap: number): void {
    const before = location.hash;
    setCap(cap, dragPushed ? "replace" : "push");
    if (location.hash !== before) dragPushed = true;
  }
  const onBarMove = (e: PointerEvent) => {
    if (dragging) commitDragCap(capFromClientX(e.clientX));
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
    dragPushed = false;
    commitDragCap(capFromClientX(e.clientX));
    window.addEventListener("pointermove", onBarMove);
    window.addEventListener("pointerup", onBarUp);
    window.addEventListener("pointercancel", onBarUp);
  });
  // Coalesce key bursts into one history entry: the first press pushes, presses within
  // 500 ms of the previous one replace that entry, so a held arrow key is one Back step.
  let lastCapKeyAt = 0;
  barEl.addEventListener("keydown", (e) => {
    if (!Number.isFinite(state.pointCap)) return;
    let c = state.pointCap as number;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") c -= 1;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") c += 1;
    else if (e.key === "Home") c = curMin;
    else if (e.key === "End") c = MAX_POINTS;
    else return;
    e.preventDefault();
    const target = Math.max(curMin, Math.min(MAX_POINTS, c));
    // A clamped press that lands back on the current cap (e.g. ArrowRight at the max) must not
    // refresh or arm the coalescing window - otherwise a later effective press within 500ms would
    // replace, clobbering the entry from before this burst started.
    if (target === state.pointCap) return;
    const mode = e.timeStamp - lastCapKeyAt < 500 ? "replace" : "push";
    lastCapKeyAt = e.timeStamp;
    setCap(target, mode);
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
  let curBuildOrderStates: StepState[] | null = null; // the verifying replay's per-step states; parallel to curBuildOrder
  let curTransition: SelectionView["transition"] = null; // compare-mode baseline-to-current transition; null when not comparing
  let boPopRow: HTMLElement | null = null; // the build-order row whose popup is showing (touch toggle + dismiss)
  // The step popup: a fixed singleton beside the hovered build-order row, showing the post-step
  // have/need state from the verifying replay. Display-only (pointer-events none), so taps pass
  // through and the document-level dismiss handles touch.
  function boPopEl(): HTMLElement {
    let el = document.getElementById("bo-pop");
    if (!el) {
      el = document.createElement("div");
      el.id = "bo-pop";
      document.body.appendChild(el);
    }
    return el;
  }
  function hideBoPop() {
    boPopRow = null;
    boPopEl().style.display = "none";
  }
  function showBoPop(row: HTMLElement) {
    const i = Number(row.dataset.stepI ?? -1);
    // The popup's data source is whichever panel is showing: the transition pair when comparing,
    // else the from-scratch build order.
    const steps = curTransition ? curTransition.steps : curBuildOrder;
    const states = curTransition ? curTransition.states : curBuildOrderStates;
    if (!steps || !states || !Number.isInteger(i) || i < 0 || i >= states.length) return;
    const el = boPopEl();
    el.innerHTML = buildStepPopupHtml(localization, model, steps[i]!, states[i]!);
    el.style.display = "block";
    // Beside the row, to its left (the panel hugs the right edge), clamped to the viewport.
    const r = row.getBoundingClientRect();
    el.style.left = `${Math.max(4, r.left - el.offsetWidth - 8)}px`;
    el.style.top = `${Math.min(Math.max(4, r.top - 4), window.innerHeight - el.offsetHeight - 4)}px`;
    boPopRow = row;
  }
  // The build-order panel element, created on first use (lazy: it does not exist until there is
  // something to show).
  function boPanel(): HTMLElement {
    let panel = document.getElementById("build-order-panel");
    if (!panel) {
      affinityEl.insertAdjacentHTML("beforeend", `<hr class="panel-sep"/><div id="build-order-panel"></div>`);
      panel = document.getElementById("build-order-panel")!;
    }
    return panel;
  }
  // Hover-sync: build-order rows carry data-con-id; box that constellation on the map (drawn on
  // top), and show/hide the step popup. Shared by both the from-scratch and transition panels.
  function wireBoRows(panel: HTMLElement) {
    panel.querySelectorAll<HTMLElement>(".bo-step[data-con-id]").forEach((row) => {
      const cid = row.dataset.conId;
      if (!cid) return;
      row.addEventListener("mouseenter", () => {
        handle.highlightCon(cid);
        if (!isTouch()) showBoPop(row);
      });
      row.addEventListener("mouseleave", () => {
        handle.highlightCon(null);
        if (!isTouch()) hideBoPop();
      });
      // Touch: tap toggles this row's popup (the map tooltip's popover pattern).
      row.addEventListener("pointerup", () => {
        if (!isTouch()) return;
        if (boPopRow === row) hideBoPop();
        else showBoPop(row);
      });
    });
  }
  // Re-render only the Benefits panel (used by benefit-tag clicks, which do not
  // change the star selection so nothing flashes).
  function paintBuildOrder(steps: BuildStep[] | null, noOrder?: NoOrderInfo | null) {
    hideBoPop();
    const panel = boPanel();
    // Comparing but no verified transition order (the none pair): the from-scratch panel still
    // renders, with a leading notice that it is showing the current build rather than a transition.
    const note =
      baseline !== null && baseline.selected.size > 0
        ? `<div class="bo-note">${localization.translate("ui.buildOrder.transitionUnavailable")}</div>`
        : "";
    panel.innerHTML = note + buildOrderHtml(localization, model, data.manifest, steps, noOrder);
    wireBoRows(panel);
  }
  function paintTransition(t: NonNullable<SelectionView["transition"]>) {
    hideBoPop();
    const panel = boPanel();
    panel.innerHTML = transitionHtml(localization, model, data.manifest, t.steps, t.rung);
    wireBoRows(panel);
  }
  function renderBenefitsPanel() {
    // "Available to get" lists only benefits still reachable from here: bonuses carried by
    // reach.reachableStars. In the permissive path reachableStars is every unselected star, so this
    // lists everything not yet held (the prior behavior).
    const availableIds = availableBonusIds(model, reach.reachableStars);
    const availPetKeys = availablePetKeys(model, reach.reachableStars);
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
  // The map's per-render inputs. Shared by refresh() and repaint() so the two paths cannot drift:
  // benefit tags and search matches are unioned into one highlight set, while constellation-level
  // search matches go to conHighlight (a constellation hit glows the art, not its stars).
  function paintMap() {
    const diff = baseline
      ? {
          added: new Set([...state.selected].filter((s) => !baseline!.selected.has(s))),
          removed: new Set([...baseline.selected].filter((s) => !state.selected.has(s))),
        }
      : null;
    handle.update(state, {
      highlight: emphasizedStars(),
      reach,
      diff,
      affinityFilter: affinityFilterSets(),
      conHighlight: searchMatch.constellations,
    });
  }
  // The match count line; null (an empty box) clears it rather than showing "no matches".
  // Also hands the tooltip the query, so hovering a match marks up the text that matched -
  // otherwise a hit on flavour text ("owl" inside "acknowledged") looks like a bug.
  function paintSearchCount() {
    searchPanel.setCount(query ? searchMatch : null); // `query` is already normalized (trimmed)
    tip.setHighlight(query);
  }
  // The hash, written by both render paths. Search uses "replace" so typing never floods history.
  function writeHash(urlMode: "push" | "replace") {
    const next = `#${encodeHash(state.selected, state.pointCap, canonical, selectedBenefits, benefitCanonical, baseline, query, source)}`;
    // Only touch history when the hash actually changed: no-op refreshes (language switch,
    // popover re-renders) must create no entry and leave the current one alone.
    if (next === location.hash) return;
    if (urlMode === "push") history.pushState(null, "", next);
    else history.replaceState(null, "", next);
  }
  function refresh(urlMode: "push" | "replace" = "push") {
    dimCache.clear();
    recomputeSearch();
    // The full per-click engine cost (validity floor + dimming sweep) is the core selectionView port;
    // this controller is a thin caller, so optimize selectionView, not refresh. The degraded path
    // (uncapped or no table) stays permissive and cheap.
    if (table && Number.isFinite(state.pointCap)) {
      const view = selectionView(model, cons, table, state.selected, state.pointCap, baseline?.selected ?? null);
      curMin = view.minCost;
      // The cap can never sit below the validity floor (raise a stale/over-tight restored link).
      if (state.pointCap < curMin) state = { selected: state.selected, pointCap: curMin };
      reach = view.reach;
      curBuildOrder = view.buildOrder;
      curBuildOrderStates = view.buildOrderStates;
      curTransition = view.transition;
    } else {
      curMin = state.selected.size;
      reach = permissiveReach();
      curBuildOrder = null;
      curBuildOrderStates = null;
      curTransition = null;
    }
    // The memo is consulted only when the selection actually changes (see lastSelectionKey): a
    // returning selection re-associates its build, and a stale export error or saved notice is
    // dropped.
    const key = selectionKey(state.selected);
    if (key !== lastSelectionKey) {
      lastSelectionKey = key;
      const known = knownBuilds.get(key);
      // Only a re-association repaints the import half. A render is not an import event, so
      // anything the import side is showing - a typed slug, a loading or error message, the title
      // and pruned notice of the build just imported - has to survive every other refresh.
      if (known !== undefined && known !== source) {
        source = known;
        importOwnsPanel = false;
        importPanel.setState(sourceState());
        ensureSourceRead();
      }
      if (exportError && exportError.key !== key) exportError = null;
      if (lastSaved && lastSaved.key !== key) lastSaved = null;
    }
    importPanel.setExportState(exportStateFor());
    document.body.classList.toggle("comparing", baseline !== null);
    updateNarrow();
    paintMap();
    paintSearchCount();
    renderBenefitsPanel();
    prevAffinity = renderAffinities(
      localization,
      affinityPanelEl,
      model,
      reach.have,
      reach.need,
      reach.needSource,
      prevAffinity,
      selectedBenefits,
    );
    // "Available to get" goes under the Affinity panel, separated from the affinity rows.
    let availParts = "";
    if (availHtml)
      availParts += `<hr class="panel-sep"/><h2>${localization.translate("ui.panel.availableToGet")}</h2>${availHtml}`;
    if (petAvailHtml)
      availParts += `<hr class="panel-sep"/><h2>${localization.translate("ui.panel.petBonus")}</h2>${petAvailHtml}`;
    const availPowers = availablePowers(model, reach.reachableStars);
    if (availPowers.length)
      availParts += `<hr class="panel-sep"/><h2>${localization.translate("ui.panel.celestialPowers")}</h2>${powersListHtml(localization, availPowers)}`;
    availPanelEl.innerHTML = availParts;
    // Empty-state copy. The build order shows whenever the selection is self-covering: the cap is auto-raised
    // to the validity floor (above), so a self-covering selection that still has no order is genuinely
    // unbuildable within 55, not merely under-budgeted. Otherwise show a prompt (nothing to order yet) or the
    // affinity-deficit instructions for an incomplete selection.
    let boInfo: NoOrderInfo | null = null;
    if (!curBuildOrder) {
      const capped = !!table && Number.isFinite(state.pointCap);
      if (capped && state.selected.size > 0 && reach.have && reach.need) {
        const deficit = affinityDeficits(model, selectionSummary(model, state.selected));
        boInfo = deficit.length ? { kind: "incomplete", deficit } : { kind: "searched", minCap: null };
      } else {
        boInfo = { kind: "empty" };
      }
    }
    if (curTransition) paintTransition(curTransition);
    else paintBuildOrder(curBuildOrder, boInfo);
    const uncapped = !Number.isFinite(state.pointCap);
    capToggle.textContent = uncapped ? "∞" : String(state.pointCap);
    capToggle.title = uncapped
      ? localization.translate("ui.points.capRestoreTitle")
      : localization.translate("ui.points.capRemoveTitle");
    totalWord.style.display = uncapped ? "none" : "";
    renderPointBar();
    writeHash(urlMode);
  }

  // The search-only render path. refresh() re-runs selectionView (the full per-click engine
  // cost); a keystroke must not pay that, so this reuses the cached `reach` and only redraws
  // what a query can change: map emphasis, the count line, and the hash.
  function repaint() {
    recomputeSearch();
    paintMap();
    paintSearchCount();
    writeHash("replace"); // replace, so typing never floods the back button
  }

  // replaceState (in repaint) is what keeps history clean; this debounce only avoids
  // re-rendering the map on every keystroke.
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  const searchPanel = mountSearchPanel(searchPanelEl, localization, {
    initial: query,
    onInput(q) {
      query = normalizeQuery(q); // the same normal form the hash stores, so a shared link restores what is on screen
      clearTimeout(searchTimer);
      searchTimer = setTimeout(repaint, 120);
    },
  });

  // Fetched on first use rather than at boot: import, export and the load-time read of the
  // associated build all need it, and first load is byte-budgeted. Cache-busted with the same
  // buildId the other data files use.
  let starTable: StarTable | null = null;
  let tableDataVersion = "";
  async function loadStarTable(): Promise<StarTable | null> {
    if (starTable) return starTable;
    // The user-facing message for a failure here is the same "import service" one the worker
    // gets, which is imprecise: this file is ours and same-origin. Warn so the real cause (a
    // deploy that dropped data/grimtools-stars.json) is diagnosable from the console rather
    // than only from a misleading toast, matching httpDataSource's degrade-and-warn habit.
    try {
      const res = await fetch(`./data/grimtools-stars.json?v=${buildId}`);
      if (!res.ok) {
        console.warn(`grimtools-stars.json fetch ${res.status}; import and export unavailable`);
        return null;
      }
      const doc = (await res.json()) as { dataVersion: string; stars: StarTable };
      tableDataVersion = doc.dataVersion;
      starTable = doc.stars;
      return starTable;
    } catch (e) {
      console.warn("grimtools-stars.json load failed; import and export unavailable", e);
      return null;
    }
  }

  // Star sets behind builds this session read (import, the load-time read, export), keyed by
  // selectionKey, so an unchanged selection shows its existing link instead of minting a duplicate
  // grimtools build. Session-only on purpose: a restored gt= carries no star set to compare
  // against, and there is no way to ask grimtools whether a build matches. Clear (the panel's ✕)
  // leaves this intact, so returning to that exact selection re-associates it.
  const knownBuilds = new Map<string, string>();
  function selectionKey(sel: Set<string>): string {
    return [...sel].sort().join(",");
  }

  // Every build read this session, by slug: the gateway's answer as received (`skills` mixes
  // devotion stars and mastery skills, in grimtools' `sk` ids). It supplies the link's title on
  // every repaint and the base an export copies from. Never the selection: only import applies a
  // build's stars to the planner.
  type KnownBuild = { title: string | null; skills: string[]; dataVersion: string | null };
  const builds = new Map<string, KnownBuild>();

  // Read a build through the gateway once per session and remember it. Its full star set is
  // memoized under its key (see knownBuilds) whenever the table can be trusted for it, because
  // "this exact set is that build" holds whether or not the planner could show it unpruned; a
  // data-version mismatch keeps the title (display only) and skips the memo. Errors are not
  // remembered, so a later read retries. Concurrent callers share one in-flight read: the restore
  // of a build-only link and the background title read ask for the same slug at the same time.
  const reading = new Map<string, Promise<FetchBuildResult>>();
  function readBuild(slug: string): Promise<FetchBuildResult> {
    const known = builds.get(slug);
    if (known) return Promise.resolve({ kind: "ok", ...known });
    const pending = reading.get(slug);
    if (pending) return pending;
    const read = fetchBuild(slug).finally(() => reading.delete(slug));
    reading.set(slug, read);
    return read;
  }
  async function fetchBuild(slug: string): Promise<FetchBuildResult> {
    const result = await gateway.fetchBuild(slug);
    if (result.kind !== "ok") return result;
    builds.set(slug, { title: result.title, skills: result.skills, dataVersion: result.dataVersion });
    const table = await loadStarTable();
    if (table && (!result.dataVersion || result.dataVersion === tableDataVersion)) {
      const stars = mapStars(result.skills, table);
      if (stars.length) knownBuilds.set(selectionKey(new Set(stars)), slug);
    }
    return result;
  }

  // The selection key the panel was last reconciled against: the memo is consulted only when the key
  // changes, so a cleared association stays cleared until the selection actually moves, and a
  // restored hash (which adopts the key itself) keeps the provenance it arrived with.
  let lastSelectionKey: string | null = null;
  // In-flight and failed exports, pinned to the selection they were made from: a change of selection
  // supersedes both, and a result that arrives after such a change never re-associates the wrong set.
  let exportingKey: string | null = null;
  let exportError: { key: string; code: ExportErrorCode } | null = null;
  // The build this session minted most recently, pinned the same way: while the selection is still
  // the one it was made from and the link shows it, the panel says so (grimtools builds are
  // immutable, so an export is always a new link, which is not obvious from a title that barely
  // changed). Dropped when the selection moves on.
  let lastSaved: { key: string; slug: string } | null = null;
  // The import half owns the panel from the moment an import paints `loading` until the source side
  // paints again or the import lands `done`. While it holds, the load-time read's background repaint
  // (see ensureSourceRead) must not overwrite the loading/error state or the textbox with a slug that
  // is not the one being imported.
  let importOwnsPanel = false;
  // The inverse mapping table, built once from the same file the import loads.
  let inverseTable: Record<string, string> | null = null;

  // The Export button's state for the current selection, in the spec's precedence: hidden or saved
  // (the link already is the export), then the three disabled reasons, then in-flight and error,
  // then ready.
  function exportStateFor(): ExportState {
    const key = selectionKey(state.selected);
    if (source && knownBuilds.get(key) === source)
      return lastSaved && lastSaved.key === key && lastSaved.slug === source
        ? { kind: "saved", slug: source }
        : { kind: "hidden" };
    if (state.selected.size === 0) return { kind: "disabled", reason: "empty" };
    if (!Number.isFinite(state.pointCap)) return { kind: "disabled", reason: "uncapped" };
    if (!reach.legal) return { kind: "disabled", reason: "incomplete" };
    if (exportingKey === key) return { kind: "exporting" };
    if (exportError && exportError.key === key) return { kind: "error", code: exportError.code };
    return { kind: "ready" };
  }

  // `restore` is the import a build-only link runs on the user's behalf (see restoreFromSource): the
  // same import, except that it rewrites the hash in place rather than pushing a history entry, and
  // it yields to anything the user did while the build was on its way.
  async function runImport(slug: string, mode: "user" | "restore" = "user"): Promise<void> {
    if (!slug) {
      // The clear button: drop the association only. Selection and cap are deliberately untouched,
      // but the export state is not: with no association, this selection can be exported again.
      // The base error names ✕ as the remedy, so ✕ retires it: the selection is unchanged, so an
      // error pinned to its key would otherwise stay on screen after the user did as it asked.
      source = "";
      if (exportError?.code === "base") exportError = null;
      syncImportPanel();
      writeHash("push");
      return;
    }
    importOwnsPanel = true;
    importPanel.setState({ kind: "loading" });
    const starIdTable = await loadStarTable();
    // This is our own same-origin data/grimtools-stars.json, not the worker, so "network" is a
    // stand-in: no catalog key describes "our own bundled data failed to load" and this is rare
    // enough (a bad deploy, a stripped-down offline copy) not to warrant adding one.
    if (!starIdTable) return importPanel.setState({ kind: "error", code: "network" });

    const result = await readBuild(slug);
    if (result.kind === "notFound") return importPanel.setState({ kind: "error", code: "notFound" });
    if (result.kind === "network") return importPanel.setState({ kind: "error", code: "network" });
    const body = result;

    // A null dataVersion means the worker could not determine it: degrade rather than block. A
    // version that is present and different means the table is stale and the mapping would be
    // plausible but wrong, which is the failure mode worth refusing outright.
    if (body.dataVersion && body.dataVersion !== tableDataVersion)
      return importPanel.setState({ kind: "error", code: "version" });

    // body.skills mixes mastery skills and devotion stars (the worker cannot tell them apart);
    // mapStars is what actually splits stars out, via membership in the committed table.
    const stars = mapStars(body.skills, starIdTable);
    if (!stars.length) return importPanel.setState({ kind: "error", code: "empty" });

    // A restore applies only to the empty map it was started for: a star clicked, a build cleared or
    // another slug imported while the read was in flight wins, and the source side simply repaints
    // (with the title the read just supplied).
    if (mode === "restore" && (state.selected.size > 0 || source !== slug)) return syncImportPanel();

    // Raise the cap to fit, never lower an existing higher one.
    const cap = Math.max(state.pointCap, stars.length);
    const wanted = new Set(stars);
    // `table` here is the cover table from boot(), not the mapping table above.
    state = { selected: repairSelection(model, cons, table, wanted, cap), pointCap: cap };
    const pruned = wanted.size - state.selected.size;
    source = slug;
    importOwnsPanel = false;
    importPanel.setState({ kind: "done", slug, pruned, title: body.title });
    // A full refresh, not repaint(): the import replaces state.selected/pointCap wholesale, so
    // reach, the points bar, the benefits/affinity panels and the build-order panel are all stale
    // and must be recomputed, same as every other state-changing action in this file. A restore
    // canonicalizes the link it arrived on instead of pushing: Back then leaves the planner rather
    // than returning to an empty map that would restore itself again.
    refresh(mode === "restore" ? "replace" : "push");
  }

  // A hash that names a build but selects nothing is a link straight to that grimtools build (or a
  // map that was reset while associated), and it is shown as the build: the import runs on the
  // user's behalf. A hash with any stars restores exactly those stars, edits and all; only an empty
  // selection defers to the build, and Reset (which keeps the association) is the way back to empty.
  function restoreFromSource(): void {
    if (source && state.selected.size === 0) void runImport(source, "restore");
  }

  async function runExport(): Promise<void> {
    const key = selectionKey(state.selected);
    // This selection already has a build from this session, so re-associate it instead of minting a
    // duplicate. Only reachable with the export row visible, which after a memo hit means the
    // association was dropped by ✕ or by Back.
    const known = knownBuilds.get(key);
    if (known !== undefined) {
      source = known;
      writeHash("push");
      return syncImportPanel();
    }
    // The export is pinned to the selection it was made from: the star set is copied and the
    // in-flight key claimed before the first await, so a star toggled mid-request neither changes
    // what ships nor lets a second click mint a second build.
    const selected = new Set(state.selected);
    const baseSlug = source; // the base is pinned with the selection: what was on screen when Export was pressed
    exportingKey = key;
    exportError = null;
    syncImportPanel();
    try {
      const starIdTable = await loadStarTable();
      if (!starIdTable) {
        // loadStarTable already warned with the real cause; "network" is the same stand-in import uses.
        exportError = { key, code: "network" };
        return;
      }
      try {
        inverseTable ??= invertStarTable(starIdTable);
      } catch (e) {
        console.warn("export unavailable: grimtools-stars.json does not invert cleanly", e);
        exportError = { key, code: "network" };
        return;
      }
      const skills = toGrimtoolsSkills(selected, inverseTable);
      if (!skills) {
        // Cannot happen with a table that passed its generation gates; a bug report, not a user state.
        const missing = [...selected].filter((s) => inverseTable![s] === undefined);
        console.warn(`export: selected star(s) missing from grimtools-stars.json: ${missing.join(", ")}`);
        exportError = { key, code: "network" };
        return;
      }
      // With an associated build, the export is a copy of it with these devotions: read it (usually
      // from the memo) to learn which of its ids are stars to replace. Only the table decides that.
      let base: ExportBase | undefined;
      if (baseSlug) {
        const b = await readBuild(baseSlug);
        if (b.kind === "notFound") {
          exportError = { key, code: "base" };
          return;
        }
        if (b.kind === "network") {
          exportError = { key, code: "network" };
          return;
        }
        if (b.dataVersion && b.dataVersion !== tableDataVersion) {
          // Its ids cannot be trusted against this table, the same rule import applies.
          exportError = { key, code: "base" };
          return;
        }
        // The read that supplied the base can reveal that this selection is that build: re-associate
        // rather than mint a copy. Like the save below, only the selection the export was made from
        // becomes associated; either way there is nothing left to send, and the memo now re-associates
        // that set on the next return to it.
        const knownAfterRead = knownBuilds.get(key);
        if (knownAfterRead !== undefined) {
          if (selectionKey(state.selected) === key) {
            source = knownAfterRead;
            writeHash("push");
          }
          return;
        }
        base = { slug: baseSlug, remove: [...new Set(b.skills.filter((id) => starIdTable[id] !== undefined))] };
      }
      const result = await gateway.saveBuild(skills, base);
      if (result.kind !== "ok") {
        exportError = { key, code: result.kind };
        return;
      }
      knownBuilds.set(key, result.slug);
      lastSaved = { key, slug: result.slug };
      // The selection may have moved on while the request was in flight: only the selection the build
      // was made from becomes associated with it (a later return to that set re-associates via the memo).
      if (selectionKey(state.selected) === key) {
        source = result.slug;
        writeHash("push"); // like import: Back returns to the un-associated state
      }
    } finally {
      // Only the export that owns the key clears it: a result for a superseded selection must not
      // stop a later export's in-flight indicator.
      if (exportingKey === key) exportingKey = null;
      syncImportPanel();
    }
  }

  const importPanel = mountImportPanel(document.getElementById("import-panel") as HTMLElement, localization, {
    onSubmit: (slug) => void runImport(slug),
    onExport: () => void runExport(),
  });
  // The panel's view of `source`: the link with the build's title when this session has read it,
  // else the untitled fallback.
  function sourceState(): ImportState {
    return source ? { kind: "done", slug: source, title: builds.get(source)?.title ?? null } : { kind: "idle" };
  }
  // A hash-restored or freshly exported gt= is a slug the session may never have read: fetch it
  // in the background for its title (and memo entry) and repaint if it is still the association
  // when the answer lands. Only a success repaints, so a failing read cannot loop; the fallback
  // label simply stays. Never touches the selection. It also defers to an import that holds the
  // panel (see importOwnsPanel): the import's own paint stands, and the title arrives on the next
  // source repaint.
  function ensureSourceRead(): void {
    const slug = source;
    if (!slug || builds.has(slug)) return;
    void readBuild(slug).then((r) => {
      if (r.kind === "ok" && source === slug && !importOwnsPanel) syncImportPanel();
    });
  }
  // Reflects `source` and the export state into the panel: at mount, on every hashchange, on the
  // clear path, and around an export request. A plain refresh pushes only the export state, so
  // rendering never resets what the import half is showing.
  function syncImportPanel(): void {
    importOwnsPanel = false;
    importPanel.setState(sourceState());
    importPanel.setExportState(exportStateFor());
    ensureSourceRead();
  }
  syncImportPanel();

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
    if (target.kind === "star")
      tip.show(
        localization,
        model,
        target.id,
        x,
        y,
        totals,
        btn,
        selectedBenefits,
        starPathCost(target.id),
        starDimInfo(target.id),
      );
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
  // Tap-away dismiss for the build-order step popup (it is pointer-events none, so any tap lands
  // outside it; tapping the same row is handled by the row's own toggle).
  document.addEventListener("pointerdown", (e) => {
    if (boPopRow && !boPopRow.contains(e.target as Node)) hideBoPop();
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

  // Back/Forward, bookmark clicks, and hand-edited URLs land here; our own pushState/replaceState
  // calls never fire hashchange, so there is no feedback loop. After applying, canonicalize in
  // place: a repaired or non-canonical incoming hash must not mint an extra entry.
  window.addEventListener("hashchange", () => {
    // Dismiss any open touch popover before re-rendering: Back/Forward can change the selection
    // out from under it, and a stale popover would keep showing the pre-navigation content.
    if (popoverTarget) {
      popoverTarget = null;
      tip.hide();
    }
    // Drop any debounced repaint still in flight: it captured the pre-navigation query and
    // would land after this render, writing a stale hash over the one Back just restored.
    clearTimeout(searchTimer);
    applyHash(location.hash);
    // A hash carries its own gt=, and that provenance wins: adopting the key restored here keeps
    // refresh from consulting the memo, which would otherwise overwrite the link with a slug this
    // session happened to make for the same stars.
    lastSelectionKey = selectionKey(state.selected);
    searchPanel.setValue(query); // the box must agree with the restored hash
    syncImportPanel(); // ditto, for the source link
    refresh("replace");
    restoreFromSource();
  });

  lastSelectionKey = selectionKey(state.selected); // the boot hash's gt= is authoritative, as above
  refresh("replace"); // boot render; canonicalize the URL without creating a history entry
  restoreFromSource();
}

boot().catch((e) => {
  document.body.innerHTML = `<pre style="color:#f88;padding:1rem">${String(e)}</pre>`;
});
