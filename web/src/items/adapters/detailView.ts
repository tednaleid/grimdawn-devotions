// ABOUTME: Renders one item's full skill-by-skill breakdown: every touched skill's level grant
// ABOUTME: and/or modifier lines, mastery-wide grants, and the grimtools link.
import { gameFormatT, litT, resolveText, type Text } from "../../core/localization";
import type { Localization } from "../../ports/Localization";
import { rowEffectLines, type EffectContext, type ModStat } from "../core/effectText";
import type { Item } from "../core/model";

// Everything the detail view needs beyond EffectContext: a Localization to resolve Text (the
// summary table only ever hands resolved strings to esc(), but the detail view builds its own
// markup so it resolves directly), and a mastery-name resolver for item.masteryBoosts (nameOf
// only covers skills).
export interface DetailContext extends EffectContext {
  loc: Localization;
  masteryNameOf: (record: string) => Text | undefined;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function render(loc: Localization, t: Text): string {
  return esc(resolveText(loc, t));
}

function skillName(ctx: DetailContext, record: string): Text {
  return ctx.nameOf(record) ?? litT(record);
}

// One entry per skill record the item touches, in first-appearance order (modifiers first, then
// boosts): a modifier block and a level grant on the SAME skill record merge into one entry (e.g.
// Badge of the Crimson Company's Leap: a modifier block AND a +2 boost), but a modifier on one
// record and a boost on a differently-recorded sibling (that item's Cadence modifier is on
// cadence1.dbr, its boost is on cadence2.dbr) stay separate entries - they are, in the raw data,
// different skill records, not the same skill twice.
interface SkillEntry {
  record: string;
  modBlocks: ModStat[][];
  boostLevel: number;
}

function touchedSkills(item: Item): SkillEntry[] {
  const byRecord = new Map<string, SkillEntry>();
  const order: string[] = [];
  const entryFor = (record: string): SkillEntry => {
    let e = byRecord.get(record);
    if (!e) {
      e = { record, modBlocks: [], boostLevel: 0 };
      byRecord.set(record, e);
      order.push(record);
    }
    return e;
  };
  for (const mb of item.modifiers) entryFor(mb.skill).modBlocks.push(mb.stats);
  for (const b of item.boosts) entryFor(b.skill).boostLevel += b.level;
  return order.map((r) => byRecord.get(r)!);
}

function skillSectionHtml(ctx: DetailContext, entry: SkillEntry): string {
  const loc = ctx.loc;
  const name = render(loc, skillName(ctx, entry.record));
  const lines: string[] = [];
  if (entry.boostLevel) {
    lines.push(render(loc, gameFormatT("ItemSkillIncrement", [entry.boostLevel, skillName(ctx, entry.record)])));
  }
  if (entry.modBlocks.length) {
    for (const line of rowEffectLines(entry.modBlocks, ctx)) lines.push(render(loc, line));
  }
  return `<section class="skill-detail">
    <h4 class="skill-detail-name">${name}</h4>
    <ul class="skill-detail-lines">${lines.map((l) => `<li>${l}</li>`).join("")}</ul>
  </section>`;
}

/** Pure markup for one item's full detail: every touched skill and its lines, mastery-wide
 *  grants, and the grimtools link. */
export function detailMarkup(item: Item, ctx: DetailContext): string {
  const loc = ctx.loc;
  const skillsHtml = touchedSkills(item)
    .map((e) => skillSectionHtml(ctx, e))
    .join("");
  const masteryLines = item.masteryBoosts
    .map((mb) => gameFormatT("ItemMasteryIncrement", [mb.level, ctx.masteryNameOf(mb.mastery) ?? litT(mb.mastery)]))
    .map((t) => `<li>${render(loc, t)}</li>`)
    .join("");
  const masteryHtml = masteryLines ? `<ul class="item-detail-mastery">${masteryLines}</ul>` : "";
  const gtHtml = item.grimtools
    ? `<a class="item-detail-grimtools" href="${esc(item.grimtools)}" target="_blank" rel="noopener noreferrer">${esc(loc.translate("items.detail.grimtools"))}</a>`
    : "";
  return `<div class="item-detail-skills">${skillsHtml}</div>${masteryHtml}${gtHtml}`;
}

/** Render one item's expanded detail row content. */
export function renderDetail(item: Item, ctx: DetailContext): HTMLElement {
  const el = document.createElement("div");
  el.className = "item-detail";
  el.innerHTML = detailMarkup(item, ctx);
  return el;
}
