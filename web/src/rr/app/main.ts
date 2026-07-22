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
import { mountLanguagePicker } from "../../adapters/languagePicker";
import { aggregate, type LogicalSource } from "../core/aggregate";
import { applyView, groupView } from "../core/filter";
import { renderTable } from "../adapters/tableView";
import { decodeHash, encodeHash, type ViewState } from "../core/urlState";

async function boot() {
  // Clear any boot-fail guard now the module has loaded (see bootFailed() in the HTML shell).
  try {
    sessionStorage.removeItem("rrBootReloaded");
  } catch {}

  const sources = await loadCatalogue("..");
  const logical = aggregate(sources);
  const knownIds = new Set(logical.map((s) => s.id));

  const overrideLocale = storedLocale(SUPPORTED_LOCALES);
  let localization = await loadLocalization({
    base: "..",
    available: SUPPORTED_LOCALES,
    preferred: overrideLocale ? [overrideLocale] : undefined,
  });

  const tableEl = document.getElementById("rr-table") as HTMLElement;
  const headerEl = document.querySelector("header") as HTMLElement;

  // Injected resolvers keep the pure core i18n-free: names/parents resolve through the current locale.
  const nameOf = (s: LogicalSource) => localization.gameText(s.name);
  const parentKeyOf = (s: LogicalSource) => s.parent;

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

  function render(): void {
    const sorted = applyView(logical, view, nameOf);
    const groups = groupView(sorted, view, parentKeyOf);
    renderTable(tableEl, localization, logical, groups, view, handlers);
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

  // Language picker (viewer preference, never in the hash): switching swaps catalogs and re-renders.
  const picker = mountLanguagePicker(headerEl, {
    current: localization.locale,
    available: SUPPORTED_LOCALES,
    names: LOCALE_NAMES,
    label: localization.translate("ui.lang.label"),
    onSelect: async (locale) => {
      storeLocale(locale);
      localization = await loadLocalization({ base: "..", available: SUPPORTED_LOCALES, preferred: [locale] });
      picker.setCurrent(localization.locale, localization.translate("ui.lang.label"));
      refresh("replace");
    },
  });

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
