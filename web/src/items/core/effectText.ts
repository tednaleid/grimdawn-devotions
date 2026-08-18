// ABOUTME: Turns a modifier block's raw stats into the card lines the game would show.
// ABOUTME: Pure and i18n-free: returns Text descriptors built from the game's own tags.
import { type FormatArg, type Text, gameFormatT } from "../../core/localization";

export interface ModStat {
  stat: string;
  value: number;
  from_tag?: string;
  to_tag?: string;
  refresh_skill?: string;
  refresh_trigger?: string;
}

export interface EffectContext {
  tagOf: (statId: string) => string | undefined;
  templateOf: (tag: string) => string | undefined;
  nameOf: (skillRecord: string) => Text | undefined;
}

const RANGE = /^(.*)(Min|Max)$/;

/** One card line per group, in first-appearance order. */
export function effectLines(stats: ModStat[], ctx: EffectContext): Text[] {
  const byId = new Map(stats.map((s) => [s.stat, s]));
  const used = new Set<string>();
  const out: Text[] = [];

  for (const s of stats) {
    if (used.has(s.stat)) continue;
    const tag = ctx.tagOf(s.stat);
    if (!tag) continue;
    const line = renderOne(s, byId, used, ctx, tag);
    if (line) out.push(line);
  }
  return out;
}

function renderOne(
  s: ModStat,
  byId: Map<string, ModStat>,
  used: Set<string>,
  ctx: EffectContext,
  tag: string,
): Text | null {
  used.add(s.stat);
  const template = ctx.templateOf(tag);
  if (!template) return null;

  // A Min with its Max is one range line; a lone Min is a single value. Min appears
  // alone far more often than paired (1,715 against 80), so the lone case is normal.
  const m = s.stat.match(RANGE);
  if (m && m[2] === "Min") {
    const max = byId.get(`${m[1]}Max`);
    if (max) {
      used.add(max.stat);
      return gameFormatT(tag, [[s.value, max.value] as FormatArg]);
    }
  }
  return gameFormatT(tag, [s.value]);
}
