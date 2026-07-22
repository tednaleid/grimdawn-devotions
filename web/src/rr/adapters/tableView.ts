// ABOUTME: Renders the RR source table (controls, sortable columns, group sections) into #rr-table.
// ABOUTME: Whole-row click/keyboard toggles ledger selection; every change round-trips through onView.
import type { Localization } from "../../ports/Localization";
import type { LogicalSource } from "../core/aggregate";
import type { ViewState } from "../core/urlState";
import { RESISTANCES } from "../core/ledger";

export interface TableHandlers {
  onView(next: ViewState, mode?: "push" | "replace"): void;
}
interface Group {
  key: string;
  items: LogicalSource[];
}

// Single-instance page: the latest render inputs, so the wired-once listeners see current state.
let ctx: { loc: Localization; all: LogicalSource[]; groups: Group[]; view: ViewState; handlers: TableHandlers } | null =
  null;

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

function rowHtml(loc: Localization, s: LogicalSource, selected: boolean): string {
  const verify = s.verifyNote ? ` <span class="verify" title="${esc(loc.translate("rr.verify.title"))}">*</span>` : "";
  const name = esc(loc.gameText(s.name));
  const parent = esc(loc.gameText(s.parent));
  // Omit the parent subtext when it duplicates the name (nameless sources borrow the parent name).
  const parentSpan = parent && parent !== name ? `<span class="parent">${parent}</span>` : "";
  return `<tr class="${s.rrType}${selected ? " selrow" : ""}" data-id="${esc(s.id)}" role="button" tabindex="0" aria-pressed="${selected}">
    <td class="name">${name}${parentSpan}</td>
    <td>${esc(loc.translate(categoryKey(s.category)))}</td>
    <td>${rrBadge(loc, s.rrType)}</td>
    <td>${esc(typesLabel(loc, s))}${verify}</td>
    <td class="val">${esc(valLabel(loc, s))}</td>
    <td>${esc(loc.translate(triggerKey(s.trigger)))}</td>
    <td>${esc(durLabel(loc, s))}</td>
  </tr>`;
}

function optionList(values: { value: string; label: string }[], current: string, allLabel: string): string {
  const opts = values.map(
    (o) => `<option value="${esc(o.value)}"${o.value === current ? " selected" : ""}>${esc(o.label)}</option>`,
  );
  return `<option value="">${esc(allLabel)}</option>${opts.join("")}`;
}

function facet(all: LogicalSource[], pick: (s: LogicalSource) => string): string[] {
  return [...new Set(all.map(pick))].sort((a, b) => a.localeCompare(b));
}

function skeleton(loc: Localization): string {
  const label = (k: string, inner: string) => `<label>${esc(loc.translate(k))}${inner}</label>`;
  const controls = `<div class="rr-controls">
    ${label("rr.ctl.search", `<input type="search" id="rr-q" />`)}
    ${label("rr.ctl.type", `<select id="rr-fType"></select>`)}
    ${label("rr.ctl.rr", `<select id="rr-fRR"></select>`)}
    ${label("rr.ctl.category", `<select id="rr-fCat"></select>`)}
    ${label("rr.ctl.parent", `<select id="rr-fPar"></select>`)}
    ${label("rr.ctl.trigger", `<select id="rr-fTrig"></select>`)}
    <label class="rr-groupby">${esc(loc.translate("rr.ctl.group"))}<select id="rr-group"></select></label>
  </div>`;
  const heads = COLS.map(
    (c) => `<th data-sort="${c.key}">${esc(loc.translate(c.label))}<span class="arr" data-arr="${c.key}"></span></th>`,
  ).join("");
  return `${controls}<div class="tablewrap"><table><thead><tr>${heads}</tr></thead><tbody id="rr-tbody"></tbody></table></div><div class="rr-count" id="rr-count"></div>`;
}

function syncControls(el: HTMLElement, loc: Localization, all: LogicalSource[], view: ViewState): void {
  const q = el.querySelector<HTMLInputElement>("#rr-q")!;
  if (document.activeElement !== q) q.value = view.q;

  const types = ["Elemental", ...RESISTANCES].map((r) => ({ value: r, label: r }));
  el.querySelector<HTMLSelectElement>("#rr-fType")!.innerHTML = optionList(
    types,
    view.fType,
    loc.translate("rr.ctl.allTypes"),
  );

  const rrTypes = ["stacking", "reduced-percent", "reduced-flat"].map((r) => ({
    value: r,
    label: loc.translate(`rr.badge.${r}`),
  }));
  el.querySelector<HTMLSelectElement>("#rr-fRR")!.innerHTML = optionList(
    rrTypes,
    view.fRR,
    loc.translate("rr.ctl.allRr"),
  );

  const cats = facet(all, (s) => s.category)
    .map((c) => ({ value: c, label: loc.translate(categoryKey(c)) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  el.querySelector<HTMLSelectElement>("#rr-fCat")!.innerHTML = optionList(
    cats,
    view.fCat,
    loc.translate("rr.ctl.allCategories"),
  );

  const pars = [...new Set(all.map((s) => s.parent))]
    .map((p) => ({ value: p, label: loc.gameText(p) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  el.querySelector<HTMLSelectElement>("#rr-fPar")!.innerHTML = optionList(
    pars,
    view.fPar,
    loc.translate("rr.ctl.allParents"),
  );

  const trigs = facet(all, (s) => s.trigger).map((t) => ({ value: t, label: loc.translate(triggerKey(t)) }));
  el.querySelector<HTMLSelectElement>("#rr-fTrig")!.innerHTML = optionList(
    trigs,
    view.fTrig,
    loc.translate("rr.ctl.allTriggers"),
  );

  const groups = ["none", "mastery", "constellation", "item"].map((g) => ({
    value: g,
    label: loc.translate(`rr.group.${g}`),
  }));
  el.querySelector<HTMLSelectElement>("#rr-group")!.innerHTML = groups
    .map((g) => `<option value="${g.value}"${g.value === view.group ? " selected" : ""}>${esc(g.label)}</option>`)
    .join("");

  el.querySelectorAll<HTMLElement>("[data-arr]").forEach((s) => {
    s.textContent = "";
  });
  const arr = el.querySelector<HTMLElement>(`[data-arr="${view.sortKey}"]`);
  if (arr) arr.textContent = view.sortDir === 1 ? " ▲" : " ▼";
}

/** Pure tbody markup for the current groups: a group-head row per section (when grouped) then its rows. */
export function bodyMarkup(loc: Localization, groups: Group[], view: ViewState): string {
  const parts: string[] = [];
  for (const g of groups) {
    if (view.group !== "none") {
      const label = g.key ? loc.gameText(g.key) : loc.translate("rr.group.ungrouped");
      parts.push(`<tr class="rr-group-head"><td colspan="${COLS.length}">${esc(label)} (${g.items.length})</td></tr>`);
    }
    for (const s of g.items) parts.push(rowHtml(loc, s, view.sel.has(s.id)));
  }
  return parts.join("");
}

function renderBody(el: HTMLElement, loc: Localization, groups: Group[], view: ViewState): void {
  el.querySelector<HTMLElement>("#rr-tbody")!.innerHTML = bodyMarkup(loc, groups, view);
}

function renderCount(el: HTMLElement, loc: Localization, all: LogicalSource[], groups: Group[], view: ViewState): void {
  const shown = groups.reduce((n, g) => n + g.items.length, 0);
  el.querySelector<HTMLElement>("#rr-count")!.textContent = loc.translate("rr.count", {
    shown,
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
  const sel = (id: string, key: keyof ViewState) =>
    el.querySelector<HTMLSelectElement>(id)!.addEventListener("change", (e) => {
      fire({ [key]: (e.target as HTMLSelectElement).value } as Partial<ViewState>);
    });
  sel("#rr-fType", "fType");
  sel("#rr-fRR", "fRR");
  sel("#rr-fCat", "fCat");
  sel("#rr-fPar", "fPar");
  sel("#rr-fTrig", "fTrig");
  el.querySelector<HTMLSelectElement>("#rr-group")!.addEventListener("change", (e) => {
    fire({ group: (e.target as HTMLSelectElement).value as ViewState["group"] });
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
  groups: Group[],
  view: ViewState,
  handlers: TableHandlers,
): void {
  ctx = { loc, all, groups, view, handlers };
  if (!el.querySelector(".rr-controls")) {
    el.innerHTML = skeleton(loc);
    wire(el);
  }
  syncControls(el, loc, all, view);
  renderBody(el, loc, groups, view);
  renderCount(el, loc, all, groups, view);
}
