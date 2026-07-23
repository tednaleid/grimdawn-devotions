// ABOUTME: Pure filter/sort/group over logical RR sources, driven by a ViewState.
// ABOUTME: i18n-free: callers inject a nameOf resolver so search/sort see resolved display text.
import type { LogicalSource } from "./aggregate";
import { sourceHits } from "./ledger";
import type { ViewState } from "./urlState";

type NameOf = (s: LogicalSource) => string;

// Rank the RR types by the order the ledger applies them (stack, then mult, then flat),
// so sorting by the RR column ascending reads in application order rather than alphabetically.
const RR_RANK: Record<LogicalSource["rrType"], number> = {
  stacking: 0,
  "reduced-percent": 1,
  "reduced-flat": 2,
};

const COARSE: Record<string, "devotion" | "skill" | "item"> = {
  devotion: "devotion",
  "mastery skill": "skill",
  modifier: "skill",
};

/** Map a fine category (as stored on a source) to its coarse facet bucket. */
export function coarseCategory(fine: string): "devotion" | "skill" | "item" {
  return COARSE[fine] ?? "item";
}

function matchesFilters(s: LogicalSource, view: ViewState, nameOf: NameOf, parentOf: NameOf): boolean {
  if (view.fRR.size && !view.fRR.has(s.rrType)) return false;
  if (view.fCat.size && !view.fCat.has(coarseCategory(s.category))) return false;
  if (view.fType.size && ![...view.fType].some((t) => sourceHits(s, t))) return false;
  if (view.q) {
    const q = view.q.toLowerCase();
    // Search resolved display text (name + parent/item), so "conduit" matches its resolved
    // parent name rather than the raw tag key.
    const hay = `${nameOf(s)} ${parentOf(s)} ${s.category} ${s.resistances.join(" ")}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function sortKeyValue(s: LogicalSource, key: string, nameOf: NameOf): string | number {
  switch (key) {
    case "name":
      return nameOf(s);
    case "cat":
      return s.category;
    case "rr":
      return RR_RANK[s.rrType];
    case "typesLabel":
      return s.resistances.join(",");
    case "value":
      return Math.abs(s.valueAtMax ?? 0);
    case "trigger":
      return s.trigger;
    default:
      return nameOf(s);
  }
}

/** Filter then sort the logical sources for the current view. Stable, pure. `parentOf` resolves
 *  the parent/item display text so search matches it (defaults to the raw parent key). */
export function applyView(
  sources: LogicalSource[],
  view: ViewState,
  nameOf: NameOf,
  parentOf: NameOf = (s) => s.parent,
): LogicalSource[] {
  const filtered = sources.filter((s) => matchesFilters(s, view, nameOf, parentOf));
  const dir = view.sortDir;
  return filtered.sort((a, b) => {
    const va = sortKeyValue(a, view.sortKey, nameOf);
    const vb = sortKeyValue(b, view.sortKey, nameOf);
    let cmp: number;
    if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
    else cmp = String(va).localeCompare(String(vb));
    // Break ties by id so the order is fully deterministic.
    if (cmp === 0) cmp = a.id.localeCompare(b.id);
    return cmp * dir;
  });
}
