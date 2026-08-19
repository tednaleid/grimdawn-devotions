// ABOUTME: Renders an EffectLine to escaped HTML, tinted by the damage type the line is about.
// ABOUTME: A conversion's two type names are marked inside the Text and each takes its own hue.
import { applyGameFormat, resolveText, stripValueTokens, type Text } from "../../core/localization";
import type { Localization } from "../../ports/Localization";
import type { EffectLine } from "../core/effectText";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

// A marked fragment is carried through resolution wrapped in sentinels and only becomes a tag
// after the whole string is escaped. Resolving straight to HTML instead would leave the
// template's own text unescaped, because applyGameFormat interleaves template and arguments
// itself and only the arguments would pass through esc(). These three control characters cannot
// occur in game text and esc() leaves them alone, so the round trip is exact. Built with
// fromCharCode rather than written as literals so they survive an editor or a diff tool.
const OPEN = String.fromCharCode(1);
const SEP = String.fromCharCode(2);
const CLOSE = String.fromCharCode(3);
const MARK = new RegExp(`${OPEN}([a-z]+)${SEP}`, "g");
const CLOSE_RE = new RegExp(CLOSE, "g");

/** resolveText, but a marked fragment keeps its mark as a sentinel pair. */
function resolveMarked(loc: Localization, t: Text): string {
  switch (t.k) {
    case "marked":
      return `${OPEN}${t.mark}${SEP}${resolveMarked(loc, t.inner)}${CLOSE}`;
    case "join":
      return t.parts.map((p) => resolveMarked(loc, p)).join("");
    case "gameFormat":
      return applyGameFormat(loc.gameText(t.tag), t.args, (x) => resolveMarked(loc, x));
    case "gameStripped":
      return stripValueTokens(loc.gameText(t.tag));
    case "game":
      return loc.gameText(t.tag);
    default:
      // app and lit carry no marks and no nested Text this renderer has to reach.
      return resolveText(loc, t);
  }
}

/** One effect line as escaped HTML: the whole line tinted when it is about a single damage type,
 *  and any marked fragment inside it tinted in its own. A line about nothing in particular (a
 *  cooldown, a weapon-damage percentage) renders exactly the text it always did. */
export function effectHtml(loc: Localization, line: EffectLine): string {
  const inner = esc(resolveMarked(loc, line.text))
    .replace(MARK, (_m, mark: string) => `<span class="dmg dmg-${mark}">`)
    .replace(CLOSE_RE, "</span>");
  return line.damage ? `<span class="dmg dmg-${line.damage}">${inner}</span>` : inner;
}

/** The line as plain text, marks resolved away. For anything that measures or filters a line
 *  rather than displaying it. */
export function effectPlain(loc: Localization, line: EffectLine): string {
  return resolveText(loc, line.text);
}
