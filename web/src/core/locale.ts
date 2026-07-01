// ABOUTME: Chooses the active locale from an ordered preference list against the shipped locales.
// ABOUTME: Pure; the adapter feeds it navigator.languages and the available set.
export function pickLocale(preferred: readonly string[], available: readonly string[]): string {
  const set = new Set(available.map((a) => a.toLowerCase()));
  for (const pref of preferred) {
    const base = pref.toLowerCase().split("-")[0] ?? "";
    if (set.has(base)) return base;
  }
  return "en";
}
