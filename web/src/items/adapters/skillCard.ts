// ABOUTME: The hover card for a tree node: the skill's own stat lines, so a player can see what
// ABOUTME: an item's modifier is actually modifying (a "-1 Second Skill Recharge" against 18).
import { resolveText, type Text } from "../../core/localization";
import type { Localization } from "../../ports/Localization";
import { effectLines, type EffectContext, type ModStat } from "../core/effectText";
import type { RankRow, Skill } from "../core/model";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Which rank a card reads its values at. The page targets endgame, so a skill's max rank is the
 *  number worth comparing an item's modifier against; `ultimate` is what gear-granted ranks push
 *  it to, which is exactly what many of these items do, so the card shows that too when it
 *  differs. `first` is the game's own tooltip value and is deliberately not shown: three columns
 *  of every stat is a wall, and rank 1 is the least useful of the three for planning. */
export function rankStats(ranks: RankRow[], at: "max" | "ultimate"): ModStat[] {
  return ranks.map((r) => ({ stat: r.stat, value: at === "max" ? r.max : r.ultimate }));
}

/** True when any rank row reads differently at ultimate than at max, so the caller knows whether
 *  a second block says anything the first did not. */
export function ultimateDiffers(ranks: RankRow[]): boolean {
  return ranks.some((r) => r.max !== r.ultimate);
}

/** Pure markup for one skill's hover card: its name, its stat lines at max rank, and - only when
 *  they read differently - the same lines at ultimate rank. Stats the tag table does not name
 *  (engine internals like spawnObjectWeights) are dropped by effectLines rather than shown raw.
 *  A skill whose every line is dropped renders as its name alone rather than an empty box.
 *  Pure and DOM-free so it is testable without jsdom, like buildTreeMarkup. */
export function skillCardMarkup(skill: Skill, loc: Localization, ctx: EffectContext): string {
  const name = esc(skill.nameTag ? loc.gameText(skill.nameTag) : skill.record);
  // A line with no letter in any script is a value whose label was lost, and reads as broken
  // rather than as information. Six of the 3,228 card lines are this, identically in all 13
  // locales: skillChargeLevel's game template is the bare "{%d0}%" (Cadence renders "2%"),
  // because the game pairs that value with a separate heading tag the card does not compose.
  // The check is \p{L}, not [A-Za-z]: an ASCII test would suppress every Japanese and Chinese
  // line on the page.
  const render = (lines: Text[]) =>
    lines
      .map((t) => resolveText(loc, t))
      .filter((s) => /\p{L}/u.test(s))
      .map((s) => `<li>${esc(s)}</li>`)
      .join("");

  const maxLines = effectLines(rankStats(skill.ranks, "max"), ctx);
  const blocks: string[] = [];
  if (maxLines.length) {
    const caption = esc(loc.translate("items.card.atRank", { rank: skill.maxLevel }));
    blocks.push(`<p class="skill-card-rank">${caption}</p><ul>${render(maxLines)}</ul>`);
  }
  if (ultimateDiffers(skill.ranks)) {
    const ultLines = effectLines(rankStats(skill.ranks, "ultimate"), ctx);
    if (ultLines.length) {
      const caption = esc(loc.translate("items.card.atUltimate", { rank: skill.ultimateLevel }));
      blocks.push(`<p class="skill-card-rank">${caption}</p><ul>${render(ultLines)}</ul>`);
    }
  }
  return `<h4>${name}</h4>${blocks.join("")}`;
}
