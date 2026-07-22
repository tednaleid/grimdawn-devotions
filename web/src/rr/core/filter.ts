// ABOUTME: Pure filter/sort/group over logical RR sources, driven by a ViewState.
// ABOUTME: i18n-free: callers inject a nameOf resolver so search/sort see resolved display text.
import type { LogicalSource } from "./aggregate";
import { sourceHits } from "./ledger";
import type { ViewState } from "./urlState";

type NameOf = (s: LogicalSource) => string;

function matchesFilters(s: LogicalSource, view: ViewState, nameOf: NameOf): boolean {
  if (view.fRR && s.rrType !== view.fRR) return false;
  if (view.fCat && s.category !== view.fCat) return false;
  if (view.fPar && s.parent !== view.fPar) return false;
  if (view.fTrig && s.trigger !== view.fTrig) return false;
  if (view.fType && !sourceHits(s, view.fType)) return false;
  if (view.q) {
    const q = view.q.toLowerCase();
    const hay = `${nameOf(s)} ${s.parent} ${s.category} ${s.resistances.join(" ")}`.toLowerCase();
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
      return s.rrType;
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

/** Filter then sort the logical sources for the current view. Stable, pure. */
export function applyView(sources: LogicalSource[], view: ViewState, nameOf: NameOf): LogicalSource[] {
  const filtered = sources.filter((s) => matchesFilters(s, view, nameOf));
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

/** Partition sorted sources into sections. group "none" is a single unnamed section. */
export function groupView(
  sorted: LogicalSource[],
  view: ViewState,
  keyOf: (s: LogicalSource) => string,
): { key: string; items: LogicalSource[] }[] {
  if (view.group === "none") return [{ key: "", items: sorted }];
  const sections = new Map<string, LogicalSource[]>();
  for (const s of sorted) {
    const k = keyOf(s);
    let items = sections.get(k);
    if (!items) {
      items = [];
      sections.set(k, items);
    }
    items.push(s);
  }
  return [...sections.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, items]) => ({ key, items }));
}
