// ABOUTME: Pure filter and sort over monsters, driven by a ViewState.
// ABOUTME: i18n-free: the caller injects nameOf so search and name-sort see resolved display text.
import { effective, type DamageType, type Monster, type Resistances } from "./model";
import { TIERS } from "./facets";
import type { ViewState } from "./urlState";

type NameOf = (m: Monster) => string;

const TIER_RANK: Record<string, number> = Object.fromEntries(TIERS.map((t, i) => [t, i]));

function matches(m: Monster, view: ViewState, nameOf: NameOf): boolean {
  if (view.tiers.size && !view.tiers.has(m.classification)) return false;
  if (view.roles.size && !view.roles.has(m.role)) return false;
  if (view.hideSummons && m.isSummon) return false;
  // Search the resolved display name only: the raw tag is never shown, so matching it
  // would surface rows the user cannot see a reason for.
  if (view.q && !nameOf(m).toLowerCase().includes(view.q.toLowerCase())) return false;
  return true;
}

function sortValue(m: Monster, key: string, eff: Resistances, nameOf: NameOf): string | number {
  switch (key) {
    case "name":
      return nameOf(m);
    case "tier":
      return TIER_RANK[m.classification] ?? TIERS.length;
    case "role":
      return m.role;
    default:
      return eff[key as DamageType] ?? 0;
  }
}

/** Filter then sort for the current view. Stable, pure, and deterministic.
 *
 *  `offsets` is passed in so sorting by a damage type ranks on the same effective value the
 *  table displays, rather than on the base value behind it.
 */
export function applyView(rows: Monster[], view: ViewState, offsets: Resistances, nameOf: NameOf): Monster[] {
  const filtered = rows.filter((m) => matches(m, view, nameOf));
  const effCache = new Map<string, Resistances>();
  const effOf = (m: Monster): Resistances => {
    let e = effCache.get(m.id);
    if (!e) {
      e = effective(m, offsets, view.includeAuras);
      effCache.set(m.id, e);
    }
    return e;
  };
  return filtered.sort((a, b) => {
    const va = sortValue(a, view.sortKey, effOf(a), nameOf);
    const vb = sortValue(b, view.sortKey, effOf(b), nameOf);
    let cmp: number;
    if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
    else cmp = String(va).localeCompare(String(vb));
    // Break ties on id so the order never depends on input order.
    if (cmp === 0) return a.id.localeCompare(b.id);
    return cmp * view.sortDir;
  });
}
