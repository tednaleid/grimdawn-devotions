// ABOUTME: Builds the damage-type ranking markup, each row carrying its distribution inline.
// ABOUTME: All ten histograms share one vertical scale so their shapes compare directly.
import { BUCKETS, rankTypes } from "../core/stats";
import type { Monster, Resistances } from "../core/model";
import type { Localization } from "../../ports/Localization";
import { esc } from "./markup";

/** The ranking as an HTML string: a header row, then one row per damage type. */
export function rankMarkup(loc: Localization, rows: Monster[], offsets: Resistances, includeAuras: boolean): string {
  const result = rankTypes(rows, offsets, includeAuras);
  if (!result) {
    // No population means no mean: say so rather than drawing a chart of zeroes,
    // which would read as "these enemies have no resistance".
    return `<div class="mon-empty">${esc(loc.translate("monsters.rank.empty"))}</div>`;
  }

  const bucketLabels = BUCKETS.map((b) => `<span>${esc(b.key)}</span>`).join("");
  const head =
    `<div class="rank-grid rank-head">` +
    `<span></span>` +
    `<span>${esc(loc.translate("monsters.rank.type"))}</span>` +
    `<span class="buckets">${bucketLabels}</span>` +
    `<span style="text-align:right">${esc(loc.translate("monsters.rank.mean"))}</span>` +
    `<span style="text-align:right">${esc(loc.translate("monsters.rank.median"))}</span>` +
    `</div>`;

  const body = result.stats
    .map((s, i) => {
      const bars = s.counts
        .map((n, b) => {
          const height = ((n / result.peak) * 100).toFixed(1);
          const title = `${BUCKETS[b]!.key}: ${n}`;
          return (
            `<span class="hcol" title="${esc(title)}">` +
            `<span class="hcount">${n ? n : ""}</span>` +
            // .htrack is the space actually available to the bar (.hcol's height minus .hcount's
            // fixed height); the bar's height:N% resolves against that, not against .hcol's full
            // height as before, so buckets no longer compress once .hcount and .hbar compete for
            // the same flex space.
            `<span class="htrack"><span class="hbar${n ? "" : " empty"}" style="height:${height}%;background:var(--t-${s.type})"></span></span>` +
            `</span>`
          );
        })
        .join("");
      return (
        `<div class="rank-grid rank-row" data-type="${s.type}">` +
        `<span class="rank-pos">${i + 1}</span>` +
        `<span class="rank-name">${esc(loc.translate(`monsters.type.${s.type}`))}</span>` +
        `<span class="rank-hist">${bars}</span>` +
        `<span class="rank-mean">${s.mean.toFixed(1)}</span>` +
        `<span class="rank-median">${s.median.toFixed(0)}</span>` +
        `</div>`
      );
    })
    .join("");

  return head + body;
}

/** Mount the ranking into `el`, replacing whatever was there. */
export function renderRank(
  el: HTMLElement,
  loc: Localization,
  rows: Monster[],
  offsets: Resistances,
  includeAuras: boolean,
): void {
  el.innerHTML = rankMarkup(loc, rows, offsets, includeAuras);
}
