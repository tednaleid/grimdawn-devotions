// ABOUTME: Entry point for the /items/ page: loads the catalogue + localization, owns the render loop.
// ABOUTME: All view state lives in the URL hash; render reads the decoded ViewState, changes push/replace it.
import { mountAppMenu, type AppMenuContent } from "../../adapters/appMenu";
import type { InfoPopoverText } from "../../adapters/infoPopover";
import {
  LOCALE_NAMES,
  loadLocalization,
  storeLocale,
  storedLocale,
  SUPPORTED_LOCALES,
} from "../../adapters/localizationAdapter";
import { gameT } from "../../core/localization";
import { loadCatalogue, loadSkillIcons, loadStatTags } from "../adapters/dataSource";
import type { DetailContext } from "../adapters/detailView";
import { renderTable } from "../adapters/tableView";
import { applyView } from "../core/filter";
import type { Item } from "../core/model";
import { decodeHash, encodeHash, type ViewState } from "../core/urlState";

async function boot() {
  // Clear any boot-fail guard now the module has loaded (see bootFailed() in the HTML shell).
  try {
    sessionStorage.removeItem("itemsBootReloaded");
  } catch {}

  // All three fetches are independent IO, so they run concurrently; the 3.1 MB catalogue is
  // fetched and parsed exactly once here, never per facet change (renderTable only reads the
  // parsed result). skillIcons is threaded into every renderTable call below (treeView.ts's
  // renderTree takes it via a TreeContext parameter, not module-level state).
  const [catalogue, statTags, skillIcons] = await Promise.all([
    loadCatalogue(".."),
    loadStatTags(".."),
    loadSkillIcons(".."),
  ]);
  const knownMasteries = new Set(catalogue.masteries.map((m) => m.record));
  // skill record -> mastery record, so decodeHash can backfill a hash's mastery from its skill.
  const knownSkills = new Map(catalogue.skills.map((s) => [s.record, s.mastery]));
  const skillByRecord = new Map(catalogue.skills.map((s) => [s.record, s]));
  const masteryByRecord = new Map(catalogue.masteries.map((m) => [m.record, m]));
  // A set's bonuses are stored once on the catalogue, not copied onto its members, so an item's
  // `set` record is resolved through here.
  const setByRecord = new Map(catalogue.sets.map((s) => [s.record, s]));

  const overrideLocale = storedLocale(SUPPORTED_LOCALES);
  let localization = await loadLocalization({
    base: "..",
    available: SUPPORTED_LOCALES,
    preferred: overrideLocale ? [overrideLocale] : undefined,
  });

  const tableEl = document.getElementById("items-table") as HTMLElement;
  const headerEl = document.querySelector("header") as HTMLElement;

  // Static chrome text, re-applied after a language switch (like the RR/monsters pages).
  function applyChrome(): void {
    document.title = localization.translate("items.title");
    (document.getElementById("items-title") as HTMLElement).textContent = localization.translate("items.title");
  }

  // Injected resolver keeps the pure core i18n-free: the item's display name resolves through
  // the current locale, falling back to its record when it carries no name tag.
  const nameOf = (item: Item) => (item.nameTag ? localization.gameText(item.nameTag) : item.record);

  // Rebuilt each render so a locale switch is reflected immediately: templateOf reads the active
  // locale's game text (effectText.ts's valueLine sees the active locale's template, not always
  // English), and tagOf/nameOf/masteryNameOf/skillOf are locale-independent lookups over the
  // loaded catalogue. DetailContext extends EffectContext, so this single context serves both the
  // row-summary effect lines (tableView.ts) and the expanded detail row (detailView.ts).
  function detailContext(): DetailContext {
    return {
      tagOf: (statId) => statTags[statId],
      // gameText falls back to the tag itself (never undefined) when a tag is missing from both
      // the active and English catalogs, but effectText.ts relies on templateOf's declared
      // `string | undefined` contract to drop a line for a genuinely unknown tag rather than
      // render it as a bare label. Restore that contract without a second fetch of the already-
      // loaded game text (fix round 1, M5).
      templateOf: (tag) => {
        const t = localization.gameText(tag);
        return t === tag ? undefined : t;
      },
      nameOf: (skillRecord) => {
        const skill = skillByRecord.get(skillRecord);
        return skill?.nameTag ? gameT(skill.nameTag) : undefined;
      },
      masteryNameOf: (masteryRecord) => {
        const mastery = masteryByRecord.get(masteryRecord);
        return mastery?.nameTag ? gameT(mastery.nameTag) : undefined;
      },
      skillOf: (skillRecord) => skillByRecord.get(skillRecord),
      setOf: (setRecord) => (setRecord ? setByRecord.get(setRecord) : undefined),
      loc: localization,
    };
  }

  // The whole view lives here, decoded from the hash; render reads it, changes re-encode it.
  let view: ViewState = decodeHash(location.hash, { masteries: knownMasteries, skills: knownSkills });
  function applyHash(hash: string): void {
    view = decodeHash(hash, { masteries: knownMasteries, skills: knownSkills });
  }

  const handlers = {
    onView(next: ViewState, mode: "push" | "replace" = "push"): void {
      view = next;
      refresh(mode);
    },
  };

  function render(): void {
    const rows = applyView(catalogue.items, catalogue.skills, catalogue.sets, view, nameOf);
    renderTable(tableEl, localization, catalogue, skillIcons, rows, view, detailContext(), handlers);
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

  // Header app menu (hamburger): links to the three sibling apps, the language list, and the About
  // panel. Locale is a viewer preference (never in the hash); switching swaps catalogs and re-renders.
  const GITHUB_URL = "https://github.com/tednaleid/grimdawn-devotions";
  const STEAMDB_PATCHNOTES_URL = "https://steamdb.info/patchnotes/";
  function infoText(): InfoPopoverText {
    const meta = catalogue.meta;
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
      description: localization.translate("items.info.description"),
      gameData,
      build,
      github: localization.translate("ui.info.github"),
    };
  }
  function menuContent(): AppMenuContent {
    return {
      nav: [
        { href: "../", label: localization.translate("ui.nav.planner") },
        { href: "../resistance-reduction/", label: localization.translate("ui.nav.rr") },
        { href: "../monster-resistances/", label: localization.translate("ui.nav.monsters") },
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
