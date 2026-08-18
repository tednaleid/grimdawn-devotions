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
  const template = ctx.templateOf(tag);
  if (!template) return null;

  // A Min and its Max collapse into one range line, regardless of which one appears first
  // in the stat list: the real data orders by stat id, and "Max" sorts before "Min", so every
  // paired block in data/skill-items.json hits Max first. A lone half is a single value (far
  // more common than paired: 1,715 lone-Min against 80 paired). Don't mark either stat used
  // until we know how the pair renders, or a Max seen before its Min emits a spurious line.
  const m = s.stat.match(RANGE);
  if (m) {
    const partnerId = `${m[1]}${m[2] === "Min" ? "Max" : "Min"}`;
    const partner = byId.get(partnerId);
    if (partner && !used.has(partner.stat)) {
      used.add(s.stat);
      used.add(partner.stat);
      const [minValue, maxValue] = m[2] === "Min" ? [s.value, partner.value] : [partner.value, s.value];
      return gameFormatT(tag, [[minValue, maxValue] as FormatArg]);
    }
  }
  used.add(s.stat);
  return gameFormatT(tag, [s.value]);
}
