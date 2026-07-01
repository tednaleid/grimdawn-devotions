// ABOUTME: Port for resolving app-authored strings to display text in the active locale.
// ABOUTME: Adapters build a Localization; view modules resolve keys through it.
export interface Localization {
  translate(key: string, params?: Record<string, string | number>): string;
  gameText(tag: string): string;
  locale: string;
}
