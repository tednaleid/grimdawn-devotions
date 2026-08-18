// ABOUTME: Entry point for the monster page: loads the dataset + localization, owns the render loop.
// ABOUTME: All view state lives in the URL hash; render reads the decoded ViewState.
import { loadMonsters } from "../adapters/dataSource";
import { diffNoteMarkup } from "../adapters/controlsView";
import { renderRank } from "../adapters/rankView";
import { renderTable } from "../adapters/tableView";
import { applyView } from "../core/filter";
import { offsetFor, type Monster } from "../core/model";
import { DAMAGE_TYPES, DIFFICULTIES, PLAYER_COUNTS, TIERS } from "../core/facets";
import { decodeHash, encodeHash, type ViewState } from "../core/urlState";
import {
  loadLocalization,
  SUPPORTED_LOCALES,
  LOCALE_NAMES,
  storedLocale,
  storeLocale,
} from "../../adapters/localizationAdapter";
import { mountAppMenu, type AppMenuContent } from "../../adapters/appMenu";
import type { InfoPopoverText } from "../../adapters/infoPopover";
import { esc } from "../adapters/markup";

const GITHUB_URL = "https://github.com/tednaleid/grimdawn-devotions";
const STEAMDB_PATCHNOTES_URL = "https://steamdb.info/patchnotes/";

async function boot() {
  // Clear any boot-fail guard now the module has loaded (see bootFailed() in the HTML shell).
  try {
    sessionStorage.removeItem("monBootReloaded");
  } catch {}

  const doc = await loadMonsters("..");
  const overrideLocale = storedLocale(SUPPORTED_LOCALES);
  let localization = await loadLocalization({
    base: "..",
    available: SUPPORTED_LOCALES,
    preferred: overrideLocale ? [overrideLocale] : undefined,
  });

  // Roles come from record paths, so the valid set is derived from the data, not a constant.
  const knownRoles = new Set(doc.monsters.map((m) => m.role));
  // Monster names are game data: gameText reads the extracted tag tables, translate would not.
  const nameOf = (m: Monster) => localization.gameText(m.nameTag);

  const headerEl = document.querySelector("header") as HTMLElement;

  let view: ViewState = decodeHash(location.hash, knownRoles);

  function pushHash(replace: boolean) {
    const body = encodeHash(view);
    const url = `${location.pathname}${location.search}${body ? `#${body}` : ""}`;
    if (replace) history.replaceState(null, "", url);
    else history.pushState(null, "", url);
  }

  function set(patch: Partial<ViewState>) {
    view = { ...view, ...patch };
    pushHash(false);
    render();
  }

  function toggled(current: Set<string>, v: string): Set<string> {
    const next = new Set(current);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  }

  function selectMarkup(id: string, options: string[], value: string, labelOf: (v: string) => string): string {
    const opts = options
      .map((o) => `<option value="${esc(o)}"${o === value ? " selected" : ""}>${esc(labelOf(o))}</option>`)
      .join("");
    return `<select id="${id}">${opts}</select>`;
  }

  function chipsMarkup(facet: string, values: string[], selected: Set<string>): string {
    return values
      .map(
        (v) =>
          `<button type="button" class="chip" data-facet="${facet}" data-val="${esc(v)}" aria-pressed="${selected.has(v)}">${esc(v)}</button>`,
      )
      .join("");
  }

  function controlsMarkup(): string {
    const t = (k: string) => localization.translate(k);
    return (
      `<div class="ctl-row">` +
      `<div class="ctl"><span class="ctl-label">${esc(t("monsters.ctl.difficulty"))}</span>` +
      selectMarkup("mon-diff", [...DIFFICULTIES], view.diff, (d) => t(`monsters.diff.${d}`)) +
      diffNoteMarkup(
        localization,
        view.diff,
        offsetFor(doc, "ascendant", view.players),
        offsetFor(doc, "ultimate", view.players),
      ) +
      `</div>` +
      `<div class="ctl"><span class="ctl-label">${esc(t("monsters.ctl.players"))}</span>` +
      selectMarkup("mon-players", PLAYER_COUNTS, view.players, (p) => p) +
      `</div>` +
      `<div class="ctl"><span class="ctl-label">${esc(t("monsters.ctl.search"))}</span>` +
      // The clear button must be the input's immediate next sibling: monsters.css hides it via
      // `input:placeholder-shown + .search-clear`, so an empty field shows no stray affordance
      // without any JS tracking the input's content.
      `<span class="search-wrap">` +
      `<input type="search" id="mon-q" value="${esc(view.q)}" placeholder="${esc(t("monsters.ctl.searchPlaceholder"))}">` +
      `<button type="button" class="search-clear" id="mon-q-clear" aria-label="${esc(t("monsters.ctl.clearSearch"))}">&times;</button>` +
      `</span></div>` +
      `</div>` +
      `<div class="ctl-row">` +
      `<div class="ctl"><span class="ctl-label">${esc(t("monsters.ctl.tier"))}</span>` +
      `<div class="chips">${chipsMarkup("tier", TIERS, view.tiers)}</div></div>` +
      `<div class="ctl"><span class="ctl-label">${esc(t("monsters.ctl.role"))}</span>` +
      `<div class="chips">${chipsMarkup("role", [...knownRoles].sort(), view.roles)}</div></div>` +
      `<div class="ctl"><span class="ctl-label">${esc(t("monsters.ctl.toggles"))}</span><div class="chips">` +
      `<button type="button" class="chip" id="mon-summons" aria-pressed="${view.hideSummons}">${esc(t("monsters.ctl.hideSummons"))}</button>` +
      `<button type="button" class="chip" id="mon-auras" aria-pressed="${view.includeAuras}">${esc(t("monsters.ctl.includeAuras"))}</button>` +
      `</div></div>` +
      `</div>`
    );
  }

  function wireControls(host: HTMLElement) {
    host
      .querySelector("#mon-diff")
      ?.addEventListener("change", (e) => set({ diff: (e.target as HTMLSelectElement).value as ViewState["diff"] }));
    host
      .querySelector("#mon-players")
      ?.addEventListener("change", (e) => set({ players: (e.target as HTMLSelectElement).value }));
    host.querySelector("#mon-summons")?.addEventListener("click", () => set({ hideSummons: !view.hideSummons }));
    host.querySelector("#mon-auras")?.addEventListener("click", () => set({ includeAuras: !view.includeAuras }));

    const search = host.querySelector<HTMLInputElement>("#mon-q");
    // Typing must not re-render the controls: that would rebuild the input and drop focus.
    search?.addEventListener("input", () => {
      view = { ...view, q: search.value };
      pushHash(true);
      renderResults();
    });
    // Clearing takes the same path as typing rather than going through set(): a controls
    // re-render would rebuild the input, and returning focus to it is the point of the button.
    host.querySelector("#mon-q-clear")?.addEventListener("click", () => {
      if (!search) return;
      search.value = "";
      view = { ...view, q: "" };
      pushHash(true);
      renderResults();
      search.focus();
    });

    host.querySelectorAll<HTMLElement>(".chip[data-facet]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const facet = chip.dataset.facet;
        const val = chip.dataset.val!;
        if (facet === "tier") set({ tiers: toggled(view.tiers, val) });
        else set({ roles: toggled(view.roles, val) });
      });
    });
  }

  function onSort(key: string) {
    // Re-clicking the sorted column flips it; a fresh column starts descending for a
    // resistance ("who resists this most") and ascending for a facet.
    if (view.sortKey === key) set({ sortDir: view.sortDir === 1 ? -1 : 1 });
    else set({ sortKey: key, sortDir: (DAMAGE_TYPES as readonly string[]).includes(key) ? -1 : 1 });
  }

  function renderResults() {
    const offsets = offsetFor(doc, view.diff, view.players);
    const rows = applyView(doc.monsters, view, offsets, nameOf);

    const rankHost = document.getElementById("mon-rank-body");
    if (rankHost) renderRank(rankHost, localization, rows, offsets, view.includeAuras);
    const rankSub = document.getElementById("mon-rank-sub");
    if (rankSub) {
      rankSub.textContent = localization.translate("monsters.rank.caveat", { count: rows.length });
    }

    const tableHost = document.getElementById("mon-table");
    if (tableHost) renderTable(tableHost, localization, rows, view, offsets, nameOf, onSort);

    const heading = document.getElementById("mon-table-heading");
    if (heading) {
      heading.textContent = `${localization.translate("monsters.table.heading")} - ${localization.translate("monsters.table.count", { count: rows.length })}`;
    }
  }

  function render() {
    const t = (k: string) => localization.translate(k);
    document.title = t("monsters.title");
    const title = document.getElementById("mon-title");
    if (title) title.textContent = t("monsters.title");
    const rankHeading = document.getElementById("mon-rank-heading");
    if (rankHeading) rankHeading.textContent = t("monsters.rank.heading");

    const controls = document.getElementById("mon-controls-body");
    if (controls) {
      controls.innerHTML = controlsMarkup();
      wireControls(controls);
    }
    renderResults();
  }

  // The App menu's About panel: this page's provenance (description, game-data version, repo link).
  function infoText(): InfoPopoverText {
    const meta = doc.meta;
    const version = typeof meta.game_version === "string" ? meta.game_version : "";
    const date = (typeof meta.generated_utc === "string" ? meta.generated_utc : "").slice(0, 10);
    const gameData = version
      ? date
        ? localization.translate("ui.info.gameData", { version, date })
        : localization.translate("ui.info.gameDataNoDate", { version })
      : null;
    const build = meta.steam_buildid
      ? {
          label: localization.translate("ui.info.build", { buildid: String(meta.steam_buildid) }),
          url: `${STEAMDB_PATCHNOTES_URL}${String(meta.steam_buildid)}/`,
        }
      : null;
    return {
      label: localization.translate("ui.menu.label"),
      description: localization.translate("monsters.info.description"),
      gameData,
      build,
      github: localization.translate("ui.info.github"),
    };
  }
  // Header app menu (hamburger): links to the three sibling apps, the language list, and the
  // About panel. Locale is a viewer preference (never in the hash); switching swaps catalogs and re-renders.
  function menuContent(): AppMenuContent {
    return {
      nav: [
        { href: "../", label: localization.translate("ui.nav.planner") },
        { href: "../resistance-reduction/", label: localization.translate("ui.nav.rr") },
        { href: "../items/", label: localization.translate("ui.nav.items") },
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
    onSelect: async (locale: string) => {
      storeLocale(locale);
      localization = await loadLocalization({ base: "..", available: SUPPORTED_LOCALES, preferred: [locale] });
      menu.update(menuContent(), localization.translate("ui.menu.label"));
      render();
    },
  });

  window.addEventListener("hashchange", () => {
    view = decodeHash(location.hash, knownRoles);
    render();
  });

  render();
}

boot().catch((err) => {
  console.error(err);
  const fail = (globalThis as { bootFailed?: () => void }).bootFailed;
  if (typeof fail === "function") fail();
});
