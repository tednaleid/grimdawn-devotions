// ABOUTME: Renders the RR source table (search, chip facets, sortable columns) into #rr-table.
// ABOUTME: Whole-row click/keyboard toggles ledger selection; every change round-trips through onView.
import type { Localization } from "../../ports/Localization";
import type { LogicalSource } from "../core/aggregate";
import { DAMAGE_TYPES, RR_TYPES, COARSE_CATEGORIES } from "../core/facets";
import type { ViewState } from "../core/urlState";

export interface TableHandlers {
  onView(next: ViewState, mode?: "push" | "replace"): void;
}

// Single-instance page: the latest render inputs, so the wired-once listeners see current state.
// Render helpers take loc/all/sorted as direct params; only view/handlers are read by the wired-once listeners.
let ctx: {
  view: ViewState;
  handlers: TableHandlers;
} | null = null;

const COLS: { key: string; label: string }[] = [
  { key: "name", label: "rr.col.source" },
  { key: "cat", label: "rr.col.category" },
  { key: "rr", label: "rr.col.rrtype" },
  { key: "typesLabel", label: "rr.col.types" },
  { key: "value", label: "rr.col.value" },
  { key: "trigger", label: "rr.col.trigger" },
  { key: "dur", label: "rr.col.duration" },
];

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export function triggerKey(trigger: string): string {
  return `rr.trigger.${trigger.replace(/[^a-z]/gi, "").toLowerCase()}`;
}

export function categoryKey(category: string): string {
  return `rr.cat.${category.replace(/[^a-z]/gi, "").toLowerCase()}`;
}

export function typesLabel(loc: Localization, s: LogicalSource): string {
  if (s.resistances.includes("All")) return loc.translate("rr.types.all");
  if (s.resistances.includes("Elemental")) {
    const extra = s.resistances.filter((r) => r !== "Elemental");
    return loc.translate("rr.types.elemental") + (extra.length ? ` + ${extra.join(" + ")}` : "");
  }
  return s.resistances.join(" + ");
}

function rrBadge(loc: Localization, rrType: LogicalSource["rrType"]): string {
  return `<span class="badge b-${rrType}">${esc(loc.translate(`rr.badge.${rrType}`))}</span>`;
}

function valLabel(loc: Localization, s: LogicalSource): string {
  const tokens = s.resistances.filter((t) => s.perResistance[t] !== undefined);
  const distinct = new Set(tokens.map((t) => s.perResistance[t]));
  let base: string;
  if (distinct.size > 1) {
    base = tokens.map((t) => `${s.perResistance[t]}% ${t}`).join(" / ");
  } else {
    const v = s.valueAtMax ?? 0;
    base =
      s.rrType === "stacking"
        ? `${v}%`
        : s.rrType === "reduced-percent"
          ? loc.translate("rr.value.reduced", { v })
          : loc.translate("rr.value.flat", { v });
  }
  if (s.valueAtUltimate != null) {
    const over = s.rrType === "stacking" ? `${s.valueAtUltimate}%` : `${s.valueAtUltimate}`;
    base += ` ${loc.translate("rr.value.overcap", { v: over })}`;
  }
  return base;
}

function durLabel(loc: Localization, s: LogicalSource): string {
  return s.durationSeconds != null ? loc.translate("rr.dur.seconds", { s: s.durationSeconds }) : "—";
}

export function triggerLabel(loc: Localization, s: LogicalSource): string {
  // An item-granted proc reads as its chance + condition ("10% on attack"); everything else
  // keeps the coarse trigger category (debuff, aura, trap...).
  if (s.triggerChancePercent != null && s.procCondition) {
    const when = loc.translate(`rr.proc.${s.procCondition}`);
    return loc.translate("rr.proc.fmt", { chance: s.triggerChancePercent, when });
  }
  return loc.translate(triggerKey(s.trigger));
}

function rowHtml(loc: Localization, s: LogicalSource, selected: boolean): string {
  const verify = s.verifyNote ? ` <span class="verify" title="${esc(loc.translate("rr.verify.title"))}">*</span>` : "";
  const roll = s.rollNote
    ? `<span class="roll" title="${esc(loc.translate("rr.roll.title"))}">${esc(loc.translate("rr.roll.tag"))}</span>`
    : "";
  const gtName = loc.gameText(s.name);
  const gtParent = loc.gameText(s.parent);
  // A Tier-3 grant is the Mythical version of the item, which the game names "Mythical <item>";
  // apply that to whichever field shows the item (its parent line, or the name when nameless).
  const withMyth = (t: string) => (s.mythical ? loc.translate("rr.tier.mythicalName", { name: t }) : t);
  const hasParent = Boolean(gtParent) && gtParent !== gtName;
  const name = esc(hasParent ? gtName : withMyth(gtName));
  const parentText = hasParent ? esc(withMyth(gtParent)) : "";
  // The roll marker qualifies the source, not the damage type: this bonus only appears on a specific
  // random roll of the item, so it belongs on the source's item/parent line.
  const meta = [parentText, roll].filter(Boolean).join(" ");
  const parentSpan = meta ? `<span class="parent">${meta}</span>` : "";
  return `<tr class="${s.rrType}${selected ? " selrow" : ""}" data-id="${esc(s.id)}" role="button" tabindex="0" aria-pressed="${selected}">
    <td class="name">${name}${parentSpan}</td>
    <td>${esc(loc.translate(categoryKey(s.category)))}</td>
    <td>${rrBadge(loc, s.rrType)}</td>
    <td>${esc(typesLabel(loc, s))}${verify}</td>
    <td class="val">${esc(valLabel(loc, s))}</td>
    <td>${esc(triggerLabel(loc, s))}</td>
    <td>${esc(durLabel(loc, s))}</td>
  </tr>`;
}

function chip(facetKey: string, value: string, label: string, pressed: boolean, cls = ""): string {
  return `<button type="button" class="chip ${cls}" data-facet="${facetKey}" data-val="${esc(value)}" aria-pressed="${pressed}">${esc(label)}</button>`;
}

function facetGroup(loc: Localization, labelKey: string, chips: string): string {
  const labId = `rr-facet-lab-${labelKey.replace(/\./g, "-")}`;
  return `<div class="facet"><span class="lab" id="${labId}">${esc(loc.translate(labelKey))}</span><div class="chips" role="group" aria-labelledby="${labId}">${chips}</div></div>`;
}

/** Pure markup for the three chip facet groups; aria-pressed reflects the current view's sets. */
export function facetsMarkup(loc: Localization, view: ViewState): string {
  const dmg = DAMAGE_TYPES.map((d) => chip("fType", d, d, view.fType.has(d))).join("");
  const rr = RR_TYPES.map((r) => chip("fRR", r, loc.translate(`rr.badge.${r}`), view.fRR.has(r), `rr-${r}`)).join("");
  const cat = COARSE_CATEGORIES.map((c) => chip("fCat", c, loc.translate(`rr.coarse.${c}`), view.fCat.has(c))).join("");
  return (
    facetGroup(loc, "rr.ctl.type", dmg) + facetGroup(loc, "rr.ctl.rr", rr) + facetGroup(loc, "rr.ctl.category", cat)
  );
}

function skeleton(loc: Localization): string {
  const search = `<div class="searchrow"><label>${esc(loc.translate("rr.ctl.search"))}<input type="search" id="rr-q" /></label></div>`;
  const facets = `<div class="rr-facets" id="rr-facets"></div>`;
  const footer = `<div class="barfoot"><span class="rr-count" id="rr-count"></span><button type="button" class="reset" id="rr-reset">${esc(loc.translate("rr.ctl.reset"))}</button></div>`;
  const controls = `<div class="rr-controls">${search}${facets}${footer}</div>`;
  const heads = COLS.map(
    (c) => `<th data-sort="${c.key}">${esc(loc.translate(c.label))}<span class="arr" data-arr="${c.key}"></span></th>`,
  ).join("");
  return `${controls}<div class="tablewrap"><table><thead><tr>${heads}</tr></thead><tbody id="rr-tbody"></tbody></table></div>`;
}

function syncControls(el: HTMLElement, loc: Localization, view: ViewState): void {
  const q = el.querySelector<HTMLInputElement>("#rr-q")!;
  if (document.activeElement !== q) q.value = view.q;

  el.querySelector<HTMLElement>("#rr-facets")!.innerHTML = facetsMarkup(loc, view);

  el.querySelectorAll<HTMLElement>("[data-arr]").forEach((s) => {
    s.textContent = "";
  });
  const arr = el.querySelector<HTMLElement>(`[data-arr="${view.sortKey}"]`);
  if (arr) arr.textContent = view.sortDir === 1 ? " ▲" : " ▼";
}

/** Pure tbody markup for the current sorted rows: a flat list, no group-head rows. */
export function bodyMarkup(loc: Localization, rows: LogicalSource[], view: ViewState): string {
  return rows.map((s) => rowHtml(loc, s, view.sel.has(s.id))).join("");
}

function renderBody(el: HTMLElement, loc: Localization, sorted: LogicalSource[], view: ViewState): void {
  el.querySelector<HTMLElement>("#rr-tbody")!.innerHTML = bodyMarkup(loc, sorted, view);
}

function renderCount(
  el: HTMLElement,
  loc: Localization,
  all: LogicalSource[],
  sorted: LogicalSource[],
  view: ViewState,
): void {
  el.querySelector<HTMLElement>("#rr-count")!.textContent = loc.translate("rr.count", {
    shown: sorted.length,
    total: all.length,
    selected: view.sel.size,
  });
}

function wire(el: HTMLElement): void {
  const fire = (patch: Partial<ViewState>, mode?: "push" | "replace") => {
    if (!ctx) return;
    ctx.handlers.onView({ ...ctx.view, ...patch }, mode);
  };
  el.querySelector<HTMLInputElement>("#rr-q")!.addEventListener("input", (e) => {
    fire({ q: (e.target as HTMLInputElement).value }, "replace");
  });
  // Delegated: chips are regenerated on every render, so the listener lives on the stable container.
  el.querySelector<HTMLElement>("#rr-facets")!.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>(".chip");
    if (!b || !ctx) return;
    const facetKey = b.dataset.facet as "fType" | "fRR" | "fCat";
    const val = b.dataset.val!;
    const next = new Set(ctx.view[facetKey]);
    next.has(val) ? next.delete(val) : next.add(val);
    fire({ [facetKey]: next } as Partial<ViewState>);
  });
  el.querySelector<HTMLButtonElement>("#rr-reset")!.addEventListener("click", () => {
    fire({ q: "", fType: new Set(), fRR: new Set(), fCat: new Set() });
  });
  // Sort: click a header (toggle dir when re-clicking the active key).
  el.querySelector("thead")!.addEventListener("click", (e) => {
    const th = (e.target as Element).closest<HTMLElement>("[data-sort]");
    if (!th || !ctx) return;
    const key = th.dataset.sort!;
    const sortDir = ctx.view.sortKey === key ? ((ctx.view.sortDir * -1) as 1 | -1) : 1;
    fire({ sortKey: key, sortDir });
  });
  // Whole-row selection: click or Enter/Space toggles the row's id in sel.
  const toggleRow = (id: string) => {
    if (!ctx) return;
    const next = new Set(ctx.view.sel);
    next.has(id) ? next.delete(id) : next.add(id);
    fire({ sel: next });
  };
  const tbody = el.querySelector<HTMLElement>("#rr-tbody")!;
  tbody.addEventListener("click", (e) => {
    const tr = (e.target as Element).closest<HTMLElement>("tr[data-id]");
    if (tr) toggleRow(tr.dataset.id!);
  });
  tbody.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const tr = (e.target as Element).closest<HTMLElement>("tr[data-id]");
    if (tr) {
      e.preventDefault();
      toggleRow(tr.dataset.id!);
    }
  });
}

/** Render the controls + source table into `el`; wires listeners once, updates rows each call. */
export function renderTable(
  el: HTMLElement,
  loc: Localization,
  all: LogicalSource[],
  sorted: LogicalSource[],
  view: ViewState,
  handlers: TableHandlers,
): void {
  ctx = { view, handlers };
  if (!el.querySelector(".rr-controls")) {
    el.innerHTML = skeleton(loc);
    wire(el);
  }
  syncControls(el, loc, view);
  renderBody(el, loc, sorted, view);
  renderCount(el, loc, all, sorted, view);
}
