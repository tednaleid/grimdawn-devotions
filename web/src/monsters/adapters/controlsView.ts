// ABOUTME: Markup for control-strip annotations that depend on the loaded dataset.
// ABOUTME: The difficulty note is computed from the offset rows, so it can never outlive its truth.
import { sameOffsets, type Difficulty, type Resistances } from "../core/model";
import type { Localization } from "../../ports/Localization";
import { esc } from "./markup";

/** A note under the difficulty select, rendered only while the data supports it.
 *
 *  Ascendant is a toggle layered on Ultimate in-game, and today it adds no resistance
 *  offset of its own. Rather than hardcode that, compare the rows: a reader who selects
 *  Ascendant and simply sees Ultimate's numbers cannot otherwise tell a genuine match
 *  from a page that failed to model Ascendant at all.
 */
export function diffNoteMarkup(
  loc: Localization,
  diff: Difficulty,
  ascendant: Resistances,
  ultimate: Resistances,
): string {
  if (diff !== "ascendant" || !sameOffsets(ascendant, ultimate)) return "";
  return `<span class="ctl-note">${esc(loc.translate("monsters.note.ascendantSameAsUltimate"))}</span>`;
}
