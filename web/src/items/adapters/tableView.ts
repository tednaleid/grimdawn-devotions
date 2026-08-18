// ABOUTME: Renders the item table (mastery/skill pickers, chip facets, sortable columns) into #items-table.
// ABOUTME: Every change round-trips through onView; the skill picker is a plain <select> until Task 15's tree.
import { resolveText, type Text } from "../../core/localization";
import type { Localization } from "../../ports/Localization";
import { DOMAINS, EFFECT_KINDS, RARITIES, SLOTS } from "../core/facets";
import { rowEffectLines, type EffectContext } from "../core/effectText";
import type { Row } from "../core/filter";
import type { Catalogue, Item } from "../core/model";
import type { ViewState } from "../core/urlState";
import { renderDetail, type DetailContext } from "./detailView";

export interface TableHandlers {
  onView(next: ViewState, mode?: "push" | "replace"): void;
}

// Row records currently showing their expanded detail. Deliberately not part of ViewState/the
// URL hash: expanding a row doesn't change which items match the current filters (what a shared
// link needs to reproduce), it only reveals more detail about one already-visible item, fully
// derivable from that item's own data. A page reload always starts collapsed.
const expandedRecords = new Set<string>();

// Single-instance page: the latest render inputs, so the wired-once listeners see current state.
let ctx: {
  view: ViewState;
  handlers: TableHandlers;
  loc: Localization;
  rows: Row[];
  detailCtx: DetailContext;
} | null = null;

const COLS: { key: string; label: string; sortable: boolean }[] = [
  { key: "name", label: "items.col.name", sortable: true },
  { key: "slot", label: "items.col.slot", sortable: true },
  { key: "rarity", label: "items.col.rarity", sortable: true },
  { key: "ilvl", label: "items.col.ilvl", sortable: true },
  { key: "levels", label: "items.col.levels", sortable: true },
  { key: "effect", label: "items.col.effect", sortable: false },
];

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

// "main_hand" -> "mainHand": SLOTS ids are snake_case (matching the game record fields), catalog
// keys follow this project's camelCase convention.
function slotKey(id: string): string {
  return id.replace(/_([a-z])/g, (_all, c: string) => c.toUpperCase());
}

function chip(facetKey: string, value: string, label: string, pressed: boolean): string {
  return `<button type="button" class="chip" data-facet="${facetKey}" data-val="${esc(value)}" aria-pressed="${pressed}">${esc(label)}</button>`;
}

function facetGroup(loc: Localization, labelKey: string, chips: string): string {
  const labId = `items-facet-lab-${labelKey.replace(/\./g, "-")}`;
  return `<div class="facet"><span class="lab" id="${labId}">${esc(loc.translate(labelKey))}</span><div class="chips" role="group" aria-labelledby="${labId}">${chips}</div></div>`;
}

/** Pure markup for the four chip facet groups; aria-pressed reflects the current view's sets. */
export function facetsMarkup(loc: Localization, view: ViewState): string {
  const slot = SLOTS.map((s) => chip("fSlot", s, loc.translate(`items.slot.${slotKey(s)}`), view.fSlot.has(s))).join(
    "",
  );
  const rarity = RARITIES.map((r) =>
    chip("fRarity", r, loc.translate(`items.rarity.${r.toLowerCase()}`), view.fRarity.has(r)),
  ).join("");
  const domain = DOMAINS.map((d) => chip("fDomain", d, loc.translate(`items.domain.${d}`), view.fDomain.has(d))).join(
    "",
  );
  const kind = EFFECT_KINDS.map((k) => chip("fKind", k, loc.translate(`items.kind.${k}`), view.fKind.has(k))).join("");
  return (
    facetGroup(loc, "items.ctl.slot", slot) +
    facetGroup(loc, "items.ctl.rarity", rarity) +
    facetGroup(loc, "items.ctl.domain", domain) +
    facetGroup(loc, "items.ctl.kind", kind)
  );
}

function nameOf(loc: Localization, item: Item): string {
  return item.nameTag ? loc.gameText(item.nameTag) : item.record;
}

function nameCell(loc: Localization, item: Item): string {
  const name = esc(nameOf(loc, item));
  return item.grimtools
    ? `<a href="${esc(item.grimtools)}" target="_blank" rel="noopener noreferrer">${name}</a>`
    : name;
}

function rowHtml(loc: Localization, row: Row, effectCtx: EffectContext): string {
  const item = row.item;
  const slots = item.slots.map((s) => esc(loc.translate(`items.slot.${slotKey(s)}`))).join(", ");
  const rarity = esc(loc.translate(`items.rarity.${item.rarity.toLowerCase()}`));
  const lines: Text[] = rowEffectLines(row.modBlocks, effectCtx);
  const effect = lines.length ? lines.map((t) => esc(resolveText(loc, t))).join("<br>") : "—";
  const expanded = expandedRecords.has(item.record);
  const caret = expanded ? "▾" : "▸";
  return `<tr class="item-row" data-record="${esc(item.record)}" role="button" tabindex="0" aria-expanded="${expanded}">
    <td class="name"><span class="row-caret" aria-hidden="true">${caret}</span>${nameCell(loc, item)}</td>
    <td>${slots}</td>
    <td>${rarity}</td>
    <td class="num">${item.itemLevel}</td>
    <td class="num">${row.levels}</td>
    <td class="effect">${effect}</td>
  </tr>`;
}

/** Pure tbody markup for the current sorted rows, or the empty-state row. */
export function bodyMarkup(loc: Localization, rows: Row[], effectCtx: EffectContext): string {
  if (!rows.length) {
    return `<tr class="empty"><td colspan="${COLS.length}">${esc(loc.translate("items.table.empty"))}</td></tr>`;
  }
  return rows.map((r) => rowHtml(loc, r, effectCtx)).join("");
}

function skeleton(loc: Localization): string {
  const mastery = `<div class="ctl"><label class="ctl-label" for="items-mastery">${esc(loc.translate("items.ctl.mastery"))}</label><select id="items-mastery"></select></div>`;
  const skill = `<div class="ctl"><label class="ctl-label" for="items-skill">${esc(loc.translate("items.ctl.skill"))}</label><select id="items-skill"></select></div>`;
  const wideLabel = esc(loc.translate("items.ctl.masteryWide"));
  const wide = `<div class="ctl"><button type="button" class="chip" id="items-wide" aria-pressed="false">${wideLabel}</button></div>`;
  const search = `<div class="ctl"><label class="ctl-label" for="items-q">${esc(loc.translate("items.ctl.search"))}</label><input type="search" id="items-q" placeholder="${esc(loc.translate("items.ctl.searchPlaceholder"))}" /></div>`;
  const facets = `<div class="items-facets" id="items-facets"></div>`;
  const footer = `<div class="barfoot"><span class="items-count" id="items-count"></span><button type="button" class="reset" id="items-reset">${esc(loc.translate("items.ctl.reset"))}</button></div>`;
  const controls = `<div class="items-controls"><div class="ctl-row">${mastery}${skill}${wide}${search}</div>${facets}${footer}</div>`;
  const heads = COLS.map((c) =>
    c.sortable
      ? `<th data-sort="${c.key}">${esc(loc.translate(c.label))}<span class="arr" data-arr="${c.key}"></span></th>`
      : `<th>${esc(loc.translate(c.label))}</th>`,
  ).join("");
  return `${controls}<div class="tablewrap"><table><thead><tr>${heads}</tr></thead><tbody id="items-tbody"></tbody></table></div>`;
}

// A base skill's own group is itself, so grouping into the picker is just "one option per base
// skill in the selected mastery" - the modifier/transmuter siblings are pulled in automatically
// by filter.ts's scope resolution once the base is picked. Options are rebuilt on every sync
// (cheap: at most a few dozen skills per mastery), not just once, since the list depends on
// the currently selected mastery.
function syncControls(el: HTMLElement, loc: Localization, catalogue: Catalogue, view: ViewState): void {
  const masterySel = el.querySelector<HTMLSelectElement>("#items-mastery")!;
  const masteryOpts = catalogue.masteries
    .map((m) => ({ record: m.record, label: loc.gameText(m.nameTag) }))
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(
      (m) => `<option value="${esc(m.record)}"${m.record === view.mastery ? " selected" : ""}>${esc(m.label)}</option>`,
    )
    .join("");
  masterySel.innerHTML = `<option value="">${esc(loc.translate("items.ctl.selectMastery"))}</option>${masteryOpts}`;

  const skillSel = el.querySelector<HTMLSelectElement>("#items-skill")!;
  skillSel.disabled = !view.mastery;
  const skillOpts = catalogue.skills
    .filter((s) => s.mastery === view.mastery && s.nodeKind === "base")
    .map((s) => ({ record: s.record, label: s.nameTag ? loc.gameText(s.nameTag) : s.record }))
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(
      (s) => `<option value="${esc(s.record)}"${s.record === view.skill ? " selected" : ""}>${esc(s.label)}</option>`,
    )
    .join("");
  skillSel.innerHTML = `<option value="">${esc(loc.translate("items.ctl.allSkills"))}</option>${skillOpts}`;

  el.querySelector<HTMLButtonElement>("#items-wide")!.setAttribute("aria-pressed", String(view.masteryWide));

  const q = el.querySelector<HTMLInputElement>("#items-q")!;
  if (document.activeElement !== q) q.value = view.q;

  el.querySelector<HTMLElement>("#items-facets")!.innerHTML = facetsMarkup(loc, view);

  el.querySelectorAll<HTMLElement>("[data-arr]").forEach((s) => {
    s.textContent = "";
  });
  const arr = el.querySelector<HTMLElement>(`[data-arr="${view.sortKey}"]`);
  if (arr) arr.textContent = view.sortDir === 1 ? " ▲" : " ▼";
}

// Detail rows are inserted after their summary row rather than baked into bodyMarkup's HTML
// string: renderDetail returns an HTMLElement (built once per skill/pet section from Text
// descriptors), not markup, so it slots in via the DOM rather than string concatenation. Summary
// rows and Row entries stay in the same order and count (bodyMarkup emits exactly one <tr> per
// row, or a single empty-state row when rows is empty), so the two are matched up by index.
function renderBody(el: HTMLElement, loc: Localization, rows: Row[], detailCtx: DetailContext): void {
  const tbody = el.querySelector<HTMLElement>("#items-tbody")!;
  tbody.innerHTML = bodyMarkup(loc, rows, detailCtx);
  if (!rows.length) return;
  const summaryRows = tbody.children;
  rows.forEach((row, i) => {
    if (!expandedRecords.has(row.item.record)) return;
    const summaryTr = summaryRows[i] as HTMLElement;
    const detailTr = document.createElement("tr");
    detailTr.className = "item-detail-row";
    const td = document.createElement("td");
    td.colSpan = COLS.length;
    td.appendChild(renderDetail(row.item, detailCtx));
    detailTr.appendChild(td);
    summaryTr.after(detailTr);
  });
}

function renderCount(el: HTMLElement, loc: Localization, catalogue: Catalogue, rows: Row[]): void {
  el.querySelector<HTMLElement>("#items-count")!.textContent = loc.translate("items.count", {
    shown: rows.length,
    total: catalogue.items.length,
  });
}

function wire(el: HTMLElement): void {
  const fire = (patch: Partial<ViewState>, mode?: "push" | "replace") => {
    if (!ctx) return;
    ctx.handlers.onView({ ...ctx.view, ...patch }, mode);
  };
  el.querySelector<HTMLSelectElement>("#items-mastery")!.addEventListener("change", (e) => {
    const value = (e.target as HTMLSelectElement).value;
    // Changing mastery drops the skill selection: a skill id from the old mastery is meaningless
    // (and possibly invalid) once the mastery scope changes.
    fire({ mastery: value || null, skill: null });
  });
  el.querySelector<HTMLSelectElement>("#items-skill")!.addEventListener("change", (e) => {
    const value = (e.target as HTMLSelectElement).value;
    fire({ skill: value || null });
  });
  el.querySelector<HTMLButtonElement>("#items-wide")!.addEventListener("click", () => {
    if (!ctx) return;
    fire({ masteryWide: !ctx.view.masteryWide });
  });
  el.querySelector<HTMLInputElement>("#items-q")!.addEventListener("input", (e) => {
    fire({ q: (e.target as HTMLInputElement).value }, "replace");
  });
  // Delegated: chips are regenerated on every render, so the listener lives on the stable container.
  el.querySelector<HTMLElement>("#items-facets")!.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>(".chip");
    if (!b || !ctx) return;
    const facetKey = b.dataset.facet as "fSlot" | "fRarity" | "fDomain" | "fKind";
    const val = b.dataset.val!;
    const next = new Set(ctx.view[facetKey]);
    next.has(val) ? next.delete(val) : next.add(val);
    fire({ [facetKey]: next } as Partial<ViewState>);
  });
  // Reset restores the chip facets, mastery-wide toggle, and search to their defaults, but leaves
  // the mastery/skill selection alone: clearing those too would defeat the point of a filter reset.
  el.querySelector<HTMLButtonElement>("#items-reset")!.addEventListener("click", () => {
    fire({ fSlot: new Set(), fRarity: new Set(), fDomain: new Set(), fKind: new Set(), masteryWide: false, q: "" });
  });
  // Sort: click a header (toggle dir when re-clicking the active key).
  el.querySelector("thead")!.addEventListener("click", (e) => {
    const th = (e.target as Element).closest<HTMLElement>("[data-sort]");
    if (!th || !ctx) return;
    const key = th.dataset.sort!;
    const sortDir = ctx.view.sortKey === key ? ((ctx.view.sortDir * -1) as 1 | -1) : 1;
    fire({ sortKey: key, sortDir });
  });
  // Whole-row click/keyboard toggles that row's detail (expandedRecords, not ViewState - see the
  // module comment). A local renderBody call, not fire(): expanding a row is not a view change,
  // so it must not push/replace the hash. Clicks landing on the name's grimtools link are left
  // alone so the link still opens the item's page instead of also toggling the row; a click
  // inside the (detail-row-only) pet <details> never reaches here since that row carries no
  // data-record for closest() to match.
  const tbody = el.querySelector<HTMLElement>("#items-tbody")!;
  const toggleExpanded = (record: string) => {
    if (!ctx) return;
    expandedRecords.has(record) ? expandedRecords.delete(record) : expandedRecords.add(record);
    renderBody(el, ctx.loc, ctx.rows, ctx.detailCtx);
  };
  tbody.addEventListener("click", (e) => {
    const target = e.target as Element;
    if (target.closest("a")) return;
    const tr = target.closest<HTMLElement>("tr[data-record]");
    if (tr) toggleExpanded(tr.dataset.record!);
  });
  tbody.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const target = e.target as Element;
    if (target.closest("a")) return;
    const tr = target.closest<HTMLElement>("tr[data-record]");
    if (tr) {
      e.preventDefault();
      toggleExpanded(tr.dataset.record!);
    }
  });
}

/** Render the controls + item table into `el`; wires listeners once, updates rows each call.
 *  detailCtx is a superset of EffectContext (it also carries loc, masteryNameOf, and skillOf for
 *  the expanded row's level grants, mastery grants, and pet panel - see detailView.ts), so it
 *  serves both the row-summary effect lines and the detail-row rendering. */
export function renderTable(
  el: HTMLElement,
  loc: Localization,
  catalogue: Catalogue,
  rows: Row[],
  view: ViewState,
  detailCtx: DetailContext,
  handlers: TableHandlers,
): void {
  ctx = { view, handlers, loc, rows, detailCtx };
  if (!el.querySelector(".items-controls")) {
    el.innerHTML = skeleton(loc);
    wire(el);
  }
  syncControls(el, loc, catalogue, view);
  renderBody(el, loc, rows, detailCtx);
  renderCount(el, loc, catalogue, rows);
}
