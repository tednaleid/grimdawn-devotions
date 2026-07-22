// ABOUTME: Renders the debuff ledger: r0 input, one line per affected resistance with the resolution.
// ABOUTME: Ports the prototype's calc() markup (breakdown, chain, comparison bar) onto LedgerLine.
import type { Localization } from "../../ports/Localization";
import { type LedgerLine, sourceValue } from "../core/ledger";

export interface LedgerHandlers {
  onR0(next: number): void;
}

let handlers: LedgerHandlers | null = null;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function fmt(v: number): string {
  return (Math.round(v * 10) / 10).toString();
}

/** Pure markup for the ledger lines (empty state when nothing is selected). */
export function linesMarkup(loc: Localization, lines: LedgerLine[], r0: number): string {
  if (!lines.length) return `<div class="empty">${esc(loc.translate("rr.ledger.empty"))}</div>`;

  // Shared bar scale so lines compare visually (mirrors the prototype).
  const lo = Math.min(-20, ...lines.map((l) => Math.floor(l.final / 10) * 10 - 10));
  const hi = Math.max(110, r0 + 10);
  const pos = (v: number) => `${(((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * 100).toFixed(2)}%`;

  return lines
    .map((l) => {
      const base = r0 - l.sumStack;
      const sgn = Math.sign(base);
      const afterMult = base * (1 - (sgn * l.maxMult) / 100);
      const names = (ss: typeof l.stackSources) => ss.map((s) => esc(loc.gameText(s.name))).join(", ");

      const parts: string[] = [];
      if (l.stackSources.length) {
        const list = l.stackSources
          .map((s) => `${esc(loc.gameText(s.name))} (${sourceValue(s, l.resistance)}%)`)
          .join(" + ");
        parts.push(
          `<div class="srcline"><span class="lbl s">${esc(loc.translate("rr.ledger.stack"))}</span> ${list} <b>= −${l.sumStack}%</b></div>`,
        );
      }
      if (l.bestMult) {
        const losers = l.multLosers.length ? ` <s>${names(l.multLosers)}</s>` : "";
        parts.push(
          `<div class="srcline"><span class="lbl m">${esc(loc.translate("rr.ledger.mult"))}</span> ${esc(loc.gameText(l.bestMult.name))} <b>(${l.maxMult}% ${esc(loc.translate("rr.ledger.reduced"))})</b>${losers}</div>`,
        );
      }
      if (l.bestFlat) {
        const losers = l.flatLosers.length ? ` <s>${names(l.flatLosers)}</s>` : "";
        parts.push(
          `<div class="srcline"><span class="lbl f">${esc(loc.translate("rr.ledger.flat"))}</span> ${esc(loc.gameText(l.bestFlat.name))} <b>(−${l.maxFlat})</b>${losers}</div>`,
        );
      }

      const chain =
        `${r0} <b class="s">− ${l.sumStack}</b> = ${fmt(base)}` +
        (l.maxMult ? ` <b class="m">× ${(1 - (sgn * l.maxMult) / 100).toFixed(2)}</b> = ${fmt(afterMult)}` : "") +
        (l.maxFlat ? ` <b class="f">− ${l.maxFlat}</b>` : "") +
        ` = <b>${fmt(l.final)}</b>`;

      const left = pos(Math.min(l.final, r0));
      const right = pos(Math.max(l.final, r0));
      return `<div class="resline">
        <div class="top"><span class="rname">${esc(l.resistance)}</span><span class="final ${l.final < 0 ? "neg" : "pos"}">${fmt(l.final)}%</span></div>
        <div class="bar"><span class="zero" style="left:${pos(0)}"></span><span class="span" style="left:${left};width:calc(${right} - ${left})"></span><span class="start" style="left:${pos(r0)}"></span></div>
        <div class="axis"><span>${lo}%</span><span>0</span><span>${hi}%</span></div>
        ${parts.join("")}
        <div class="chain">${chain}</div>
      </div>`;
    })
    .join("");
}

/** Render the ledger into `el`; wires the r0 input once, updates lines each call. */
export function renderLedger(
  el: HTMLElement,
  loc: Localization,
  lines: LedgerLine[],
  r0: number,
  h: LedgerHandlers,
): void {
  handlers = h;
  if (!el.querySelector(".startrow")) {
    el.innerHTML = `<h2>${esc(loc.translate("rr.ledger.title"))}</h2>
      <div class="startrow"><label>${esc(loc.translate("rr.ledger.start"))}<input type="number" id="rr-r0" step="5" /></label></div>
      <div id="rr-lines"></div>`;
    el.querySelector<HTMLInputElement>("#rr-r0")!.addEventListener("input", (e) => {
      const n = Number.parseFloat((e.target as HTMLInputElement).value);
      handlers?.onR0(Number.isFinite(n) ? n : 0);
    });
  }
  const r0input = el.querySelector<HTMLInputElement>("#rr-r0")!;
  if (document.activeElement !== r0input) r0input.value = String(r0);
  el.querySelector<HTMLElement>("#rr-lines")!.innerHTML = linesMarkup(loc, lines, r0);
}
