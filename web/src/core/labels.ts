// ABOUTME: Stat labeler factory for the devotion planner UI.
// ABOUTME: Returns a function that looks up known labels or humanizes camelCase stat ids.
export function makeLabeler(statLabels: Record<string, string>): (statId: string) => string {
  return (statId: string): string => {
    const known = statLabels[statId];
    if (known) return known;
    const spaced = statId
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[._]/g, " ")
      .trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  };
}
