// ABOUTME: Language-list content helpers (languageOptions/languageMenuHtml) for the header app menu.
// ABOUTME: Pure, DOM-free: the menu shell and wiring live in appMenu.ts, which composes these.

export interface LanguageOption {
  locale: string;
  name: string;
  current: boolean;
}

/** The popover's content: every available locale in order, named by its endonym, current one flagged. */
export function languageOptions(
  current: string,
  available: readonly string[],
  names: Record<string, string>,
): LanguageOption[] {
  return available.map((locale) => ({ locale, name: names[locale] ?? locale, current: locale === current }));
}

/** The popover list markup. Endonyms are a fixed safe constant set, so no escaping is needed. */
export function languageMenuHtml(options: LanguageOption[]): string {
  return options
    .map(
      (o) =>
        `<li role="none"><button type="button" role="menuitemradio" data-locale="${o.locale}"` +
        ` aria-checked="${o.current}"${o.current ? ' class="current"' : ""}>${o.name}</button></li>`,
    )
    .join("");
}
