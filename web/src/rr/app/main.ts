// ABOUTME: Entry point for the RR page: loads the catalogue + localization, owns the render loop.
// ABOUTME: All view state lives in the URL hash; render reads the decoded ViewState, changes push/replace it.
import { loadCatalogue } from "../adapters/catalogueSource";
import {
  loadLocalization,
  SUPPORTED_LOCALES,
  LOCALE_NAMES,
  storedLocale,
  storeLocale,
} from "../../adapters/localizationAdapter";
import { mountAppMenu, type AppMenuContent } from "../../adapters/appMenu";
import type { InfoPopoverText } from "../../adapters/infoPopover";
import { aggregate, type LogicalSource } from "../core/aggregate";
import { applyView } from "../core/filter";
import { resolveLedger } from "../core/ledger";
import { renderTable } from "../adapters/tableView";
import { renderLedger } from "../adapters/ledgerView";
import { renderPrimer } from "../adapters/primerView";
import { decodeHash, encodeHash, type ViewState } from "../core/urlState";

async function boot() {
  // Clear any boot-fail guard now the module has loaded (see bootFailed() in the HTML shell).
  try {
    sessionStorage.removeItem("rrBootReloaded");
  } catch {}

  const { sources, meta } = await loadCatalogue("..");
  const logical = aggregate(sources);
  const knownIds = new Set(logical.map((s) => s.id));

  const overrideLocale = storedLocale(SUPPORTED_LOCALES);
  let localization = await loadLocalization({
    base: "..",
    available: SUPPORTED_LOCALES,
    preferred: overrideLocale ? [overrideLocale] : undefined,
  });

  const tableEl = document.getElementById("rr-table") as HTMLElement;
  const ledgerEl = document.getElementById("rr-ledger") as HTMLElement;
  const primerEl = document.getElementById("rr-primer") as HTMLElement;
  const headerEl = document.querySelector("header") as HTMLElement;

  // Static chrome text, re-applied after a language switch (like the planner's applyChrome).
  function applyChrome(): void {
    document.title = localization.translate("rr.title");
    (document.getElementById("rr-title") as HTMLElement).textContent = localization.translate("rr.title");
    renderPrimer(primerEl, localization);
  }

  // Injected resolvers keep the pure core i18n-free: names/parents resolve through the current locale.
  const nameOf = (s: LogicalSource) => localization.gameText(s.name);
  const parentNameOf = (s: LogicalSource) => localization.gameText(s.parent);

  // The whole view lives here, decoded from the hash; render reads it, changes re-encode it.
  let view: ViewState = decodeHash(location.hash, knownIds);
  function applyHash(hash: string): void {
    view = decodeHash(hash, knownIds);
  }

  const handlers = {
    onView(next: ViewState, mode: "push" | "replace" = "push"): void {
      view = next;
      refresh(mode);
    },
  };
  const ledgerHandlers = {
    onR0(next: number): void {
      // r0 typing coalesces into one history entry, like search.
      view = { ...view, r0: next };
      refresh("replace");
    },
  };

  function render(): void {
    const sorted = applyView(logical, view, nameOf, parentNameOf);
    renderTable(tableEl, localization, logical, sorted, view, handlers);
    const selected = logical.filter((s) => view.sel.has(s.id));
    renderLedger(ledgerEl, localization, resolveLedger(selected, view.r0), view.r0, ledgerHandlers);
  }

  function refresh(urlMode: "push" | "replace" = "push"): void {
    render();
    const next = `#${encodeHash(view)}`;
    // Only touch history when the hash actually changed, so no-op renders create no entry.
    if (next !== location.hash) {
      if (urlMode === "push") history.pushState(null, "", next);
      else history.replaceState(null, "", next);
    }
  }

  // Header app menu (hamburger): cross-app link back to the planner, the language list, and the About
  // panel. Locale is a viewer preference (never in the hash); switching swaps catalogs and re-renders.
  const GITHUB_URL = "https://github.com/tednaleid/grimdawn-devotions";
  const STEAMDB_PATCHNOTES_URL = "https://steamdb.info/patchnotes/";
  function infoText(): InfoPopoverText {
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
      description: localization.translate("rr.info.description"),
      gameData,
      build,
      github: localization.translate("ui.info.github"),
    };
  }
  function menuContent(): AppMenuContent {
    return {
      nav: { href: "../", label: localization.translate("rr.plannerLink") },
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
      localization = await loadLocalization({ base: "..", available: SUPPORTED_LOCALES, preferred: [locale] });
      menu.update(menuContent(), localization.translate("ui.menu.label"));
      applyChrome();
      refresh("replace");
    },
  });
  applyChrome();

  // Back/Forward, bookmark clicks, hand-edited URLs; our own pushState never fires hashchange.
  window.addEventListener("hashchange", () => {
    applyHash(location.hash);
    refresh("replace");
  });

  refresh("replace"); // boot render; canonicalize the hash without a history entry
}

boot().catch((e) => {
  const el = document.getElementById("boot-loading");
  if (el) el.textContent = String(e);
});
