// ABOUTME: Turns a modifier block's raw stats into the card lines the game would show.
// ABOUTME: Pure and i18n-free: returns Text descriptors built from the game's own tags.
import { type FormatArg, type Text, gameFormatT, gameT, joinT } from "../../core/localization";

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

// The five triggers that actually occur, mapped to the game's condition tags. 851 of
// 964 records carry the untouched 13-token enum instead of a choice; the pipeline
// reads those as absent, so anything arriving here is a real selection.
const TRIGGER_TAG: Record<string, string> = {
  HitByEnemy: "tagRefreshSkillCondition03",
  AttackEnemy: "tagRefreshSkillCondition07",
  AttackEnemyCrit: "tagRefreshSkillCondition10",
  Block: "tagRefreshSkillCondition11",
  OnKill: "tagRefreshSkillCondition12",
};
const DOT = /^offensiveSlow(.+?)(Duration)?Min$/;
const REFRESH = /^(refreshCooldown|refreshDuration)(Amount|Chance)$/;

const unit = (v: number): Text => gameT(v === 1 ? "tagSecond" : "tagSeconds");

// Only these seven offensiveSlow families are damage over time, where the record
// stores damage PER SECOND and the card shows the total. The other five that also
// carry a DurationMin are debuffs whose magnitude is already absolute: a 25% slow
// lasting 2 seconds is 25%, not 50%. Verified on one grimtools card, Eldrun's
// Cursed Vision, which shows "160 Electrocute Damage over 2 Seconds" beside
// "25% Slow target for 2 Seconds" from the same block at the same duration.
const DOT_DAMAGE = new Set(["Bleeding", "Fire", "Cold", "Lightning", "Poison", "Life", "Physical"]);

// A plain label carries no placeholder, so the value cannot ride inside it. Task 9
// extends this with the COMPOSER table; here it is only the plain/templated split.
function valueLine(value: number, tag: string, template: string): Text {
  if (!/\{%/.test(template)) {
    const label = gameT(tag);
    // A label that already begins with its own percent takes no separator, so
    // "% Slow target" reads "25% Slow target" rather than "25 % Slow target".
    return template.startsWith("%") ? joinT(String(value), label) : joinT(String(value), " ", label);
  }
  return gameFormatT(tag, [value]);
}

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

  // A duration sibling makes one line. Damage families show the product and read
  // "over"; every other family keeps its magnitude and reads "for". The real data
  // (data/stat-item-tags.json) maps a DurationMin stat to the SAME tag as its value
  // stat, and sorts DurationMin first by stat id, so the Duration record is often
  // visited before its value sibling: it defers to that sibling rather than
  // rendering on its own (a lone duration collapsing to a plain label would
  // silently drop the number, the same bug this whole rule exists to avoid).
  const dot = s.stat.match(DOT);
  if (dot) {
    if (dot[2]) return null;
    const dur = byId.get(`offensiveSlow${dot[1]}DurationMin`);
    if (dur) {
      used.add(dur.stat);
      const isDamage = DOT_DAMAGE.has(dot[1]!);
      const suffixTag = isDamage ? "DamageSingleFormatTime" : "DamageFixedSingleFormatTime";
      const head = valueLine(isDamage ? s.value * dur.value : s.value, tag, template);
      return ctx.templateOf(suffixTag) ? joinT(head, " ", gameFormatT(suffixTag, [dur.value])) : head;
    }
  }

  // A refresh family composes one line from its amount, its chance, and the target
  // and trigger the pipeline carries alongside them. The target is frequently a
  // different skill from the block's own, so it is never inferred.
  const ref = s.stat.match(REFRESH);
  if (ref) {
    const family = ref[1];
    const amount = byId.get(`${family}Amount`);
    const chance = byId.get(`${family}Chance`);
    if (!amount) return null;
    used.add(`${family}Amount`);
    used.add(`${family}Chance`);
    const q = amount.refresh_trigger ? TRIGGER_TAG[amount.refresh_trigger] : undefined;
    const cond: FormatArg = q ? gameFormatT(q, [chance?.value ?? 0]) : (chance?.value ?? 0);
    const target = amount.refresh_skill ? ctx.nameOf(amount.refresh_skill) : undefined;
    return target
      ? gameFormatT(`${family === "refreshCooldown" ? "tagSkillCooldownRefreshName" : "tagSkillDurationRefresh"}`, [
          cond,
          target,
          amount.value,
          unit(amount.value),
        ])
      : gameFormatT(`${family === "refreshCooldown" ? "tagSkillCooldownRefresh" : "tagSkillDurationRefresh"}`, [
          cond,
          amount.value,
          unit(amount.value),
        ]);
  }

  // Each conversion percentage is its own line, carrying its own type pair. They
  // share one tag, so a naive shared-tag merge would wrongly fuse them on 148 blocks.
  if (s.stat.startsWith("conversionPercentage") && s.from_tag && s.to_tag) {
    return gameFormatT(tag, [s.value, gameT(s.from_tag), gameT(s.to_tag)]);
  }

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
  return valueLine(s.value, tag, template);
}
