// ABOUTME: Renders the item table (mastery picker, skill tree, chip facets, sortable columns) into #items-table.
// ABOUTME: Every change round-trips through onView; the skill picker is the SVG mastery tree from treeView.ts.
import { litT, resolveText } from "../../core/localization";
import type { Localization } from "../../ports/Localization";
import { CATEGORIES, categoryGameTag, DOMAINS, EFFECT_KINDS, RARITIES } from "../core/facets";
import { rowEffectLines, type EffectContext } from "../core/effectText";
import { effectHtml } from "./effectMarkup";
import { itemCategory, type Row } from "../core/filter";
import type { Catalogue, Item } from "../core/model";
import type { ViewState } from "../core/urlState";
import type { SkillIconIndex } from "./dataSource";
import { renderDetail, type DetailContext } from "./detailView";
import { skillCardMarkup } from "./skillCard";
import { renderTree, type TreeContext } from "./treeView";

export interface TableHandlers {
  onView(next: ViewState, mode?: "push" | "replace"): void;
}

// Row records currently showing their expanded detail. Deliberately not part of ViewState/the
// URL hash: expanding a row doesn't change which items match the current filters (what a shared
// link needs to reproduce), it only reveals more detail about one already-visible item, fully
// derivable from that item's own data. A page reload always starts collapsed.
const expandedRecords = new Set<string>();

// Open pet <details> panels, keyed by PetBlock.record (a specific dbr path, unique per skill).
// Native <details> open/closed state lives in the DOM element itself, and renderBody rebuilds
// every expanded row's detail markup on every call (toggling another row, sorting, a locale
// switch) - without tracking it separately here, opening a pet panel and then touching anything
// else on the page silently re-closes it (fix-1). Same rationale as expandedRecords: not in
// ViewState/the hash, since it doesn't change which items match the current filters.
const openPetPanels = new Set<string>();

// Restores each pet panel's open state from openPetPanels after (re)inserting a detail row's
// markup, and keeps openPetPanels in sync with the user's own toggling from then on. Attached
// directly to each <details> (its "toggle" event does not bubble), not delegated on the tbody.
function restorePetPanels(detailEl: HTMLElement): void {
  detailEl.querySelectorAll<HTMLDetailsElement>(".pet-panel[data-pet-key]").forEach((details) => {
    const key = details.dataset.petKey!;
    details.open = openPetPanels.has(key);
    details.addEventListener("toggle", () => {
      if (details.open) openPetPanels.add(key);
      else openPetPanels.delete(key);
    });
  });
}

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
  { key: "skills", label: "items.col.skills", sortable: false },
  { key: "effect", label: "items.col.effect", sortable: false },
];

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

const CATEGORY_SET = new Set(CATEGORIES);

// The weapon categories are the game's own (from its loot filter), so they resolve as game text
// and arrive translated; armour, jewellery and relic have no such tag and resolve from the app
// catalogue. A category outside the known vocabulary is a gear class core/facets.ts has not been
// taught yet (see itemCategory): it shows as its raw id rather than as a missing catalog key.
function categoryLabel(loc: Localization, category: string): string {
  const tag = categoryGameTag(category);
  if (tag) return loc.gameText(tag);
  return CATEGORY_SET.has(category) ? loc.translate(`items.category.${category}`) : category;
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
  const cat = CATEGORIES.map((c) => chip("fCat", c, categoryLabel(loc, c), view.fCat.has(c))).join("");
  const rarity = RARITIES.map((r) =>
    chip("fRarity", r, loc.translate(`items.rarity.${r.toLowerCase()}`), view.fRarity.has(r)),
  ).join("");
  const domain = DOMAINS.map((d) => chip("fDomain", d, loc.translate(`items.domain.${d}`), view.fDomain.has(d))).join(
    "",
  );
  const kind = EFFECT_KINDS.map((k) => chip("fKind", k, loc.translate(`items.kind.${k}`), view.fKind.has(k))).join("");
  return (
    facetGroup(loc, "items.ctl.slot", cat) +
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

function rowHtml(loc: Localization, row: Row, effectCtx: EffectContext, view: ViewState): string {
  const item = row.item;
  const category = esc(categoryLabel(loc, itemCategory(item)));
  const rarity = esc(loc.translate(`items.rarity.${item.rarity.toLowerCase()}`));
  // effectHtml escapes as it renders and tints the line by its damage type - see effectMarkup.ts.
  const lines = rowEffectLines(row.modBlocks, effectCtx);
  const effect = lines.length ? lines.map((l) => effectHtml(loc, l)).join("<br>") : "—";
  // Which in-scope skills put this row in the table. Without it the answer is only visible by
  // expanding the row, and with several skills picked (or a whole mastery in scope) the effect
  // lines alone do not say which power they belong to. Falls back to the raw record for a skill
  // the game never named, matching nameOf's convention elsewhere in this file.
  // Each name is a button, not text: it carries the same hover card the tree node does (a row
  // can name a skill the reader cannot see on the tree at all), and clicking it toggles that
  // skill in the selection, so the table is a second way into the same picker. A name the item
  // reaches only through its set is badged: that bonus needs the whole set worn, and the expanded
  // row says which set and how many pieces.
  const fromSet = new Set(row.set?.skills ?? []);
  const badge = ` <span class="set-badge">${esc(loc.translate("items.set.badge"))}</span>`;
  const skills = row.skills.length
    ? row.skills
        .map((r) => {
          const label = esc(resolveText(loc, effectCtx.nameOf(r) ?? litT(r)));
          const mark = fromSet.has(r) ? badge : "";
          return `<button type="button" class="skill-pick" data-record="${esc(r)}" aria-pressed="${view.skills.has(r)}">${label}${mark}</button>`;
        })
        .join("")
    : "—";
  const expanded = expandedRecords.has(item.record);
  const caret = expanded ? "▾" : "▸";
  return `<tr class="item-row" data-record="${esc(item.record)}" role="button" tabindex="0" aria-expanded="${expanded}">
    <td class="name"><span class="row-caret" aria-hidden="true">${caret}</span>${nameCell(loc, item)}</td>
    <td>${category}</td>
    <td>${rarity}</td>
    <td class="num">${item.itemLevel}</td>
    <td class="num">${row.levels}</td>
    <td class="skills">${skills}</td>
    <td class="effect">${effect}</td>
  </tr>`;
}

/** Pure tbody markup for the current sorted rows, or the empty-state row. */
export function bodyMarkup(loc: Localization, rows: Row[], effectCtx: EffectContext, view: ViewState): string {
  if (!rows.length) {
    // Nothing is filtered out before a mastery is chosen - there is simply no scope yet - so
    // saying "no items match the current filters" there would be a lie about the user's filters.
    const key = view.mastery ? "items.table.empty" : "items.table.pickMastery";
    return `<tr class="empty"><td colspan="${COLS.length}">${esc(loc.translate(key))}</td></tr>`;
  }
  return rows.map((r) => rowHtml(loc, r, effectCtx, view)).join("");
}

function skeleton(loc: Localization): string {
  // A radio group rather than a <select>: ten masteries fit on screen at once, so the whole
  // vocabulary is visible instead of hidden behind a click. Exactly one is ever chosen, which is
  // what role=radiogroup says and what the tree below needs (it draws one mastery).
  const mastery =
    `<div class="ctl ctl-wide"><span class="ctl-label" id="items-mastery-lab">${esc(loc.translate("items.ctl.mastery"))}</span>` +
    `<div class="chips mastery-chips" id="items-mastery" role="radiogroup" aria-labelledby="items-mastery-lab"></div></div>`;
  const wideLabel = esc(loc.translate("items.ctl.masteryWide"));
  const wide = `<div class="ctl"><button type="button" class="chip" id="items-wide" aria-pressed="false">${wideLabel}</button></div>`;
  const search = `<div class="ctl"><label class="ctl-label" for="items-q">${esc(loc.translate("items.ctl.search"))}</label><input type="search" id="items-q" placeholder="${esc(loc.translate("items.ctl.searchPlaceholder"))}" /></div>`;
  const tree = `<div class="items-tree-wrap"><span class="ctl-label" id="items-tree-label">${esc(loc.translate("items.ctl.skill"))}</span><div id="items-tree" role="group" aria-labelledby="items-tree-label"></div></div>`;
  const facets = `<div class="items-facets" id="items-facets"></div>`;
  const footer = `<div class="barfoot"><span class="items-count" id="items-count"></span><button type="button" class="reset" id="items-reset">${esc(loc.translate("items.ctl.reset"))}</button></div>`;
  const controls = `<div class="items-controls"><div class="ctl-row">${mastery}${wide}${search}</div>${tree}${facets}${footer}</div>`;
  const heads = COLS.map((c) =>
    c.sortable
      ? `<th data-sort="${c.key}">${esc(loc.translate(c.label))}<span class="arr" data-arr="${c.key}"></span></th>`
      : `<th>${esc(loc.translate(c.label))}</th>`,
  ).join("");
  return `${controls}<div class="tablewrap"><table><thead><tr>${heads}</tr></thead><tbody id="items-tbody"></tbody></table></div>`;
}

// Renders the SVG tree for the current mastery (or a hint when none is picked yet) into
// #items-tree. Rebuilt on every sync, like the mastery <select>'s options: cheap (at most a few
// dozen skills per mastery) and simpler than trying to patch an existing tree in place. Picking a
// node toggles: clicking the already-selected skill's group clears the selection, restoring the
// "All skills" escape hatch the old <select> offered via its empty option.
// Shows one skill's card while the pointer (or keyboard focus) is on something that names a
// skill: a node in the tree, or a name in the table's Skills column. `host` is both where the card
// is parked and the box it is positioned against, so it must be a positioned element that does not
// clip its overflow; `source` is where the hover/focus events are delegated from and `selector`
// what carries the skill's data-record. The card is rebuilt per hover rather than per anchor up
// front: a page holds hundreds of these and only one card is ever visible.
function attachSkillCard(
  host: HTMLElement,
  source: Element,
  selector: string,
  markupFor: (record: string) => string | null,
): void {
  const card = document.createElement("div");
  card.className = "skill-card";
  card.hidden = true;
  // Hover-only detail, and the node itself already carries the skill's accessible name, so the
  // card must not be announced a second time as the user tabs through the tree.
  card.setAttribute("aria-hidden", "true");
  host.appendChild(card);

  const show = (target: Element) => {
    // Both an HTMLElement and an SVG <g> carry dataset and getBoundingClientRect; nothing here
    // needs either one's own interface.
    const node = target.closest(selector) as (Element & { dataset: DOMStringMap }) | null;
    if (!node) return;
    const markup = markupFor(node.dataset.record ?? "");
    if (markup === null) return;
    card.innerHTML = markup;
    card.hidden = false;
    // Anchor to the node's own shape, NOT to its <g>. The group also holds the icon <image>,
    // which is the whole sprite sheet shifted into place and clipped: a clip-path does not shrink
    // the reported box, so the <g> measures the entire sheet and reports a left of -302 for a
    // node sitting at x=139. The shape is the node's real box.
    const box = (node.querySelector(".node-shape") ?? node).getBoundingClientRect();
    const wrap = host.getBoundingClientRect();
    const gap = 8;
    // Beside the node, and on whichever side it fits. Clamping a right-column card back inside
    // the box instead would park it on top of the node the reader is pointing at.
    const toRight = box.left - wrap.left + box.width + gap;
    const toLeft = box.left - wrap.left - card.offsetWidth - gap;
    const left = toRight + card.offsetWidth <= wrap.width || toLeft < 0 ? toRight : toLeft;
    const top = box.top - wrap.top;
    card.style.left = `${Math.max(0, Math.min(left, Math.max(0, wrap.width - card.offsetWidth)))}px`;
    card.style.top = `${Math.max(0, Math.min(top, Math.max(0, wrap.height - card.offsetHeight)))}px`;
  };
  const hide = () => {
    card.hidden = true;
  };

  source.addEventListener("mouseover", (e) => show(e.target as Element));
  source.addEventListener("mouseout", hide);
  source.addEventListener("focusin", (e) => show(e.target as Element));
  source.addEventListener("focusout", hide);
}

/** One skill's card markup, or null when the catalogue does not know that record. Shared by the
 *  tree's nodes and the table's Skills column so both hovers say exactly the same thing. */
function skillCardFor(
  record: string,
  loc: Localization,
  catalogue: Catalogue,
  effectCtx: EffectContext,
): string | null {
  const skill = catalogue.skills.find((s) => s.record === record);
  return skill ? skillCardMarkup(skill, loc, effectCtx) : null;
}

// Toggling one skill: several picks widen the scope (the table shows items touching any of them),
// and clearing the last one goes back to the whole mastery. Shared by the tree's nodes and the
// table's Skills column, which must agree on what picking a skill means.
function toggledSkills(skills: ReadonlySet<string>, record: string): Set<string> {
  const next = new Set(skills);
  if (next.has(record)) next.delete(record);
  else next.add(record);
  return next;
}

function syncTree(
  el: HTMLElement,
  loc: Localization,
  catalogue: Catalogue,
  icons: SkillIconIndex,
  view: ViewState,
  handlers: TableHandlers,
  effectCtx: EffectContext,
): void {
  const treeEl = el.querySelector<HTMLElement>("#items-tree")!;
  treeEl.innerHTML = "";
  if (!view.mastery) {
    const hint = document.createElement("p");
    hint.className = "items-tree-hint";
    hint.textContent = loc.translate("items.ctl.selectMastery");
    treeEl.appendChild(hint);
    return;
  }
  // treeView.ts stays i18n-free (its signature carries no Localization port), so this loc-backed
  // resolver is the caller's contribution to TreeContext - and its own fallback to the raw record
  // for a skill with no nameTag, matching nameOf's convention elsewhere in this file.
  const treeCtx: TreeContext = {
    icons,
    nameOf: (skill) => (skill.nameTag ? loc.gameText(skill.nameTag) : skill.record),
  };
  const svg = renderTree(
    catalogue.skills,
    view.mastery,
    view.skills,
    (record) => handlers.onView({ ...view, skills: toggledSkills(view.skills, record) }),
    treeCtx,
  );
  treeEl.appendChild(svg);
  attachSkillCard(treeEl, svg, "[data-record]", (record) => skillCardFor(record, loc, catalogue, effectCtx));
  const hasOffTree = catalogue.skills.some((s) => s.mastery === view.mastery && (s.uiX === null || s.uiY === null));
  if (hasOffTree) {
    const caption = document.createElement("p");
    caption.className = "items-tree-offtree-caption";
    caption.textContent = loc.translate("items.tree.offTree");
    treeEl.appendChild(caption);
  }
}

function syncControls(
  el: HTMLElement,
  loc: Localization,
  catalogue: Catalogue,
  icons: SkillIconIndex,
  view: ViewState,
  handlers: TableHandlers,
  effectCtx: EffectContext,
): void {
  const masteryEl = el.querySelector<HTMLElement>("#items-mastery")!;
  const masteryOpts = catalogue.masteries
    .map((m) => ({ record: m.record, label: loc.gameText(m.nameTag) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  masteryEl.innerHTML = masteryOpts
    .map((m, i) => {
      const on = m.record === view.mastery;
      // tabindex follows the radiogroup convention: exactly one option is in the tab order - the
      // chosen one, or the first while nothing is chosen yet - and arrows move within the group.
      const tab = on || (!view.mastery && i === 0) ? 0 : -1;
      return (
        `<button type="button" class="chip" role="radio" data-mastery="${esc(m.record)}"` +
        ` aria-checked="${on}" tabindex="${tab}">${esc(m.label)}</button>`
      );
    })
    .join("");

  syncTree(el, loc, catalogue, icons, view, handlers, effectCtx);

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
function renderBody(el: HTMLElement, loc: Localization, rows: Row[], detailCtx: DetailContext, view: ViewState): void {
  const tbody = el.querySelector<HTMLElement>("#items-tbody")!;
  tbody.innerHTML = bodyMarkup(loc, rows, detailCtx, view);
  if (!rows.length) return;
  const summaryRows = tbody.children;
  rows.forEach((row, i) => {
    if (!expandedRecords.has(row.item.record)) return;
    const summaryTr = summaryRows[i] as HTMLElement;
    const detailTr = document.createElement("tr");
    detailTr.className = "item-detail-row";
    const td = document.createElement("td");
    td.colSpan = COLS.length;
    const detailEl = renderDetail(row.item, detailCtx);
    td.appendChild(detailEl);
    restorePetPanels(detailEl);
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

function wire(el: HTMLElement, catalogue: Catalogue): void {
  const fire = (patch: Partial<ViewState>, mode?: "push" | "replace") => {
    if (!ctx) return;
    ctx.handlers.onView({ ...ctx.view, ...patch }, mode);
  };
  // Delegated, like the facet chips: the buttons are regenerated on every render.
  const masteryGroup = el.querySelector<HTMLElement>("#items-mastery")!;
  const pickMastery = (value: string) => {
    if (!ctx || value === ctx.view.mastery) return; // radio: re-picking the chosen one is a no-op
    // Changing mastery drops the skill selection: a skill id from the old mastery is meaningless
    // (and possibly invalid) once the mastery scope changes.
    fire({ mastery: value, skills: new Set() });
  };
  masteryGroup.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-mastery]");
    if (b) pickMastery(b.dataset.mastery!);
  });
  // Arrow keys move within the group, as a radiogroup is expected to: only one option is in the
  // tab order (see syncControls), so without this the keyboard could reach the picker but never
  // change it - worse than the <select> this replaced.
  masteryGroup.addEventListener("keydown", (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    const buttons = [...masteryGroup.querySelectorAll<HTMLElement>("[data-mastery]")];
    const from = buttons.indexOf(e.target as HTMLElement);
    if (from < 0) return;
    e.preventDefault();
    const next = buttons[(from + step + buttons.length) % buttons.length]!;
    // Re-rendering replaces these buttons, so focus is restored by position afterwards.
    const index = buttons.indexOf(next);
    pickMastery(next.dataset.mastery!);
    masteryGroup.querySelectorAll<HTMLElement>("[data-mastery]")[index]?.focus();
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
    const facetKey = b.dataset.facet as "fCat" | "fRarity" | "fDomain" | "fKind";
    const val = b.dataset.val!;
    const next = new Set(ctx.view[facetKey]);
    next.has(val) ? next.delete(val) : next.add(val);
    fire({ [facetKey]: next } as Partial<ViewState>);
  });
  // Reset restores the chip facets, mastery-wide toggle, and search to their defaults, but leaves
  // the mastery/skill selection alone: clearing those too would defeat the point of a filter reset.
  el.querySelector<HTMLButtonElement>("#items-reset")!.addEventListener("click", () => {
    fire({ fCat: new Set(), fRarity: new Set(), fDomain: new Set(), fKind: new Set(), masteryWide: false, q: "" });
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
  // The Skills column carries the same hover card the tree does. Its host is #items-table, not
  // the table wrapper: that wrapper scrolls (overflow:auto) and would clip the card. The
  // catalogue is loaded once and never replaced, so capturing it here is safe; the locale is
  // read from ctx at hover time because it can change under a language switch.
  attachSkillCard(el, tbody, ".skill-pick", (record) =>
    ctx ? skillCardFor(record, ctx.loc, catalogue, ctx.detailCtx) : null,
  );
  const toggleExpanded = (record: string) => {
    if (!ctx) return;
    expandedRecords.has(record) ? expandedRecords.delete(record) : expandedRecords.add(record);
    renderBody(el, ctx.loc, ctx.rows, ctx.detailCtx, ctx.view);
  };
  tbody.addEventListener("click", (e) => {
    const target = e.target as Element;
    if (target.closest("a")) return;
    // A skill name picks that skill; it must not also expand the row it happens to sit in.
    const pick = target.closest<HTMLElement>(".skill-pick");
    if (pick) {
      if (ctx) fire({ skills: toggledSkills(ctx.view.skills, pick.dataset.record!) });
      return;
    }
    const tr = target.closest<HTMLElement>("tr[data-record]");
    if (tr) toggleExpanded(tr.dataset.record!);
  });
  tbody.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const target = e.target as Element;
    // A focused skill-pick button raises its own click for Enter and Space, handled above.
    if (target.closest("a") || target.closest(".skill-pick")) return;
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
  icons: SkillIconIndex,
  rows: Row[],
  view: ViewState,
  detailCtx: DetailContext,
  handlers: TableHandlers,
): void {
  ctx = { view, handlers, loc, rows, detailCtx };
  if (!el.querySelector(".items-controls")) {
    el.innerHTML = skeleton(loc);
    wire(el, catalogue);
  }
  syncControls(el, loc, catalogue, icons, view, handlers, detailCtx);
  renderBody(el, loc, rows, detailCtx, view);
  renderCount(el, loc, catalogue, rows);
}
