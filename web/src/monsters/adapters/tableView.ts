// ABOUTME: Builds the monster table markup: facet columns, heat-shaded cells, provenance markers.
// ABOUTME: The aura marker's meaning tracks the toggle, so its tooltip is chosen per render.
import { DAMAGE_TYPES } from "../core/facets";
import { effective, type DamageType, type Monster, type Resistances } from "../core/model";
import type { ViewState } from "../core/urlState";
import type { Localization } from "../../ports/Localization";
import { esc } from "./markup";

// No level column: max_level is 250 on 1,630 of the 1,635 rows, so it printed the same
// number nearly everywhere. Monster.maxLevel stays in the model as part of the data contract.
const FACET_COLUMNS = [
  { key: "name", label: "monsters.table.colName", left: true },
  { key: "tier", label: "monsters.table.colTier", left: true },
  { key: "role", label: "monsters.table.colRole", left: true },
];

/** The alpha the strongest cell reaches. Short of 1 so the row rules stay visible through it. */
const SHADE_CEILING = 0.85;

/** A cell background tinted by how resistant the monster is, saturating at 100. */
function shade(type: DamageType, value: number): string {
  const a = Math.max(0, Math.min(1, value / 100));
  if (a === 0) return "";
  // The full type hue, not its -dim partner: dim is a near-black tint that reads as a hint of
  // colour at any value, so a 90 and a 20 looked nearly alike. Mixing the saturated hue toward
  // transparent puts the whole 0-100 range on a visible ramp.
  return ` style="background:color-mix(in srgb, var(--t-${type}) ${(a * SHADE_CEILING * 100).toFixed(0)}%, transparent)"`;
}

function header(loc: Localization, view: ViewState): string {
  const th = (key: string, label: string, left: boolean) => {
    const sorted = view.sortKey === key ? ` aria-sort="${view.sortDir === 1 ? "ascending" : "descending"}"` : "";
    return `<th ${left ? 'class="left" ' : ""}data-key="${esc(key)}"${sorted}>${esc(label)}</th>`;
  };
  return (
    FACET_COLUMNS.map((c) => th(c.key, loc.translate(c.label), c.left)).join("") +
    DAMAGE_TYPES.map((t) => th(t, loc.translate(`monsters.type.${t}`), false)).join("")
  );
}

function marker(cls: string, amount: number, phrase: string): string {
  // The amount is prepended here rather than living in the catalogue, so the catalogue
  // string stays a plain phrase with no placeholder to keep in sync across locales.
  return `<i class="prov ${cls}" title="+${amount} ${esc(phrase)}"></i>`;
}

function row(
  loc: Localization,
  m: Monster,
  view: ViewState,
  offsets: Resistances,
  nameOf: (m: Monster) => string,
): string {
  const eff = effective(m, offsets, view.includeAuras);
  const warn = m.variantsDisagree
    ? `<b class="disagree" title="${esc(loc.translate("monsters.table.disagreeTitle"))}">&#9888;</b>`
    : "";
  const roleText = m.isSummon ? `${m.role} ${loc.translate("monsters.table.summonSuffix")}` : m.role;

  const cells = DAMAGE_TYPES.map((t) => {
    const v = eff[t];
    const cls = `cell${v >= 100 ? " over" : ""}${v < 0 ? " neg" : ""}`;
    const passive = m.passive[t];
    const aura = m.aura[t];
    const marks =
      (passive ? marker("passive", passive, loc.translate("monsters.table.passiveTitle")) : "") +
      (aura
        ? marker(
            "aura",
            aura,
            loc.translate(
              // The ring means the opposite thing depending on the toggle: with auras off it
              // flags a value NOT in this number, with them on it explains part of the number.
              view.includeAuras ? "monsters.table.auraIncludedTitle" : "monsters.table.auraExcludedTitle",
            ),
          )
        : "");
    return `<td class="${cls}" data-cell="${t}"${shade(t, v)}>${v}${marks}</td>`;
  }).join("");

  return (
    `<tr data-id="${esc(m.id)}">` +
    `<td class="left m-name">${esc(nameOf(m))}${warn}</td>` +
    `<td class="left m-facet">${esc(m.classification)}</td>` +
    `<td class="left m-facet">${esc(roleText)}</td>` +
    cells +
    `</tr>`
  );
}

function legend(loc: Localization, view: ViewState): string {
  const auraKey = view.includeAuras ? "monsters.legend.auraIncluded" : "monsters.legend.auraExcluded";
  return (
    `<div class="legend">` +
    `<span><i class="prov passive"></i>${esc(loc.translate("monsters.legend.passive"))}</span>` +
    `<span><i class="prov aura"></i>${esc(loc.translate(auraKey))}</span>` +
    `<span>${esc(loc.translate("monsters.legend.disagree"))}</span>` +
    `<span>${esc(loc.translate("monsters.legend.negative"))}</span>` +
    `</div>`
  );
}

/** The whole table as an HTML string, including its legend. */
export function tableMarkup(
  loc: Localization,
  rows: Monster[],
  view: ViewState,
  offsets: Resistances,
  nameOf: (m: Monster) => string,
): string {
  const span = FACET_COLUMNS.length + DAMAGE_TYPES.length;
  const body = rows.length
    ? rows.map((m) => row(loc, m, view, offsets, nameOf)).join("")
    : `<tr><td class="mon-empty" colspan="${span}">${esc(loc.translate("monsters.table.empty"))}</td></tr>`;
  return (
    `<div class="table-scroll"><table>` +
    `<thead><tr>${header(loc, view)}</tr></thead>` +
    `<tbody>${body}</tbody>` +
    `</table></div>` +
    legend(loc, view)
  );
}

/** Mount the table into `el` and wire one delegated handler for header sorting. */
export function renderTable(
  el: HTMLElement,
  loc: Localization,
  rows: Monster[],
  view: ViewState,
  offsets: Resistances,
  nameOf: (m: Monster) => string,
  onSort: (key: string) => void,
): void {
  el.innerHTML = tableMarkup(loc, rows, view, offsets, nameOf);
  // Delegated once per render on the container, so re-rendering the body cannot leak listeners.
  const head = el.querySelector("thead");
  head?.addEventListener("click", (ev) => {
    const th = (ev.target as HTMLElement).closest("th");
    const key = th?.getAttribute("data-key");
    if (key) onSort(key);
  });
}
