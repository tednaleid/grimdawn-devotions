// ABOUTME: Turns a modifier block's raw stats into the card lines the game would show.
// ABOUTME: Pure and i18n-free: returns Text descriptors built from the game's own tags.
import { type FormatArg, type Text, appT, gameFormatT, gameT, joinT, markedT } from "../../core/localization";
import { damageTypeOfTag, type DamageType } from "./damageTypes";

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
// Any <family>Min with a <family>DurationMin sibling composes one line, not just the
// offensiveSlow families: offensiveTotalResistanceReductionAbsolute, offensiveTotalDamageReductionPercent,
// offensiveProjectileFumble, offensiveFumble, offensiveElementalResistanceReductionAbsolute, and
// offensiveTotalResistanceReductionPercent carry the same DurationMin-plus-sibling shape (45 blocks
// total across those six, verified against data/skill-items.json).
const DOT = /^(.+?)(Duration)?Min$/;
const REFRESH = /^(refreshCooldown|refreshDuration)(Amount|Chance|Max)$/;
const CHANCE = /^(.+)Chance$/;

// The tags whose {%t0} is a TEXT slot holding a duration, not a number to substitute. Both
// sets are the complete reachable answer from data/i18n/game.en.json, not a prefix list that
// grows: CLAUSE_SLOT is every tag in data/stat-item-tags.json's range whose template ENDS in
// "{%t0}" with label text before it ("Petrify target{%t0}"), and QUANTITY_SLOT is every one
// whose template STARTS with "{%t0} of " ("{%t0} of Terrify Retaliation").
//
// CLAUSE_SLOT's slot takes the whole clause, DamageFixedSingleFormatTime ("for {%.1f0}
// Seconds"), pinned to the grimtools card for Mark of Anathema's Callidor's Tempest block:
// offensivePetrifyChance 10 + offensivePetrifyMin 2 reads "10% Chance to Petrify target for
// 2 Seconds". All ten keep the trailing-slot shape in all 13 shipped locales.
//
// QUANTITY_SLOT does NOT fit that composition, and forcing it through one would double the
// preposition: Italian's RetaliationFear is "Ritorsione che Spaventa per {%t0}", so its slot
// holds a bare "0.8 Seconds", not "for 0.8 Seconds". The game's own filler for it is
// RetaliationFixedSingleFormatTime ("{%.1f0} Seconds"), which the committed game tables do not
// carry (see BACKLOG.md), so the same text is composed from the value and the game's own unit
// tag - the shape the refresh composers already use for their own durations.
const CLAUSE_SLOT = new Set([
  "DamageConfusion",
  "DamageConvert",
  "DamageDisruption",
  "DamageFear",
  "DamageFreeze",
  "DamageKnockdown",
  "DamagePetrify",
  "DamageStun",
  "DamageTrap",
  "tagDamageSleep",
]);
const QUANTITY_SLOT = new Set(["RetaliationConfusion", "RetaliationFear", "RetaliationFreeze", "RetaliationStun"]);

const unit = (v: number): Text => gameT(v === 1 ? "tagSecond" : "tagSeconds");

// Only these seven families are damage over time, where the record stores damage PER
// SECOND and the card shows the total. Every other <family>Min with a DurationMin
// sibling is a debuff whose magnitude is already absolute: a 25% slow lasting 2 seconds
// is 25%, not 50%. Verified on one grimtools card, Eldrun's Cursed Vision, which shows
// "160 Electrocute Damage over 2 Seconds" beside "25% Slow target for 2 Seconds" from
// the same block at the same duration.
const DOT_DAMAGE = new Set([
  "offensiveSlowBleeding",
  "offensiveSlowFire",
  "offensiveSlowCold",
  "offensiveSlowLightning",
  "offensiveSlowPoison",
  "offensiveSlowLife",
  "offensiveSlowPhysical",
]);

// The plain-label tags that need a composer and a unit, pinned against real grimtools
// cards and data/i18n/game.en.json. A tag absent from this map falls back to a bare
// value prefix, which is correct for labels that already carry their own "%"
// ("% Slow target") and for plain counts ("Bleeding Damage" -> "300 Bleeding Damage").
//
// Rows composing through SkillSecondFormat, SkillDistanceFormat, SkillCostFormat, or
// SkillPercentFormat need an actual unit word or "%" the label itself doesn't carry.
// Rows composing through SkillIntFormat (including ComboChargeLevels) are plain counts
// that data/stat-item-tags.json's full catalog (not just the tags real modifier blocks
// currently use) also requires a row for; SkillIntFormat renders identically to the
// bare-value-prefix fallback for integer values (verified: no non-integer occurrence of
// any of these stats in data/skill-items.json), so those rows are coverage, not a
// behavior change, for tags already rendering correctly today - though SkillIntFormat's
// %d rounds (Math.round) where the bare fallback used String(value), a difference in
// kind and arguably more game-faithful, not just in coverage, should a non-integer ever occur.
export const COMPOSER: Record<string, string> = {
  CooldownTime: "SkillSecondFormat", // "Skill Recharge"
  ActiveDuration: "SkillSecondFormat", // "Duration"
  ComboChargeDuration: "SkillSecondFormat", // "Onslaught Stack Duration"
  SkillChargeDuration: "SkillSecondFormat", // "Charge Level Duration"
  TargetRadius: "SkillDistanceFormat", // "Target Area"
  ExplosionRadius: "SkillDistanceFormat", // "Radius"
  TargetRange: "SkillDistanceFormat", // "Range" (waveDistance, a wave skill's reach)
  ManaCost: "SkillCostFormat", // "Energy Cost"
  ComboChargeLevels: "SkillIntFormat", // "Onslaught Stacks:"
  tagCharStatsBlockChance: "SkillPercentFormat", // "Chance to Block"
  DamageElementalResistanceReductionAbsolute: "SkillIntFormat", // "Reduced target's Elemental Resistances"
  DamagePhysicalResistanceReductionAbsolute: "SkillIntFormat", // "Reduced target's Physical Resistance"
  DamageDurationBleeding: "SkillIntFormat", // "Bleeding Damage"
  DamageDurationCold: "SkillIntFormat", // "Frostburn Damage"
  DamageDurationDefensiveAbility: "SkillIntFormat", // "Reduced target's Defensive Ability"
  DamageDurationDefensiveReduction: "SkillIntFormat", // "Reduced target's Armor"
  DamageDurationFire: "SkillIntFormat", // "Burn Damage"
  DamageDurationLife: "SkillIntFormat", // "Vitality Decay Damage"
  DamageDurationLightning: "SkillIntFormat", // "Electrocute Damage"
  DamageDurationManaLeach: "SkillIntFormat", // "Energy Leech"
  DamageDurationOffensiveAbility: "SkillIntFormat", // "Reduced target's Offensive Ability"
  DamageDurationPhysical: "SkillIntFormat", // "Internal Trauma"
  DamageDurationPoison: "SkillIntFormat", // "Poison Damage"
  DamageTaunt: "SkillIntFormat", // "Taunt target"
  DamageTotalResistanceReductionAbsolute: "SkillIntFormat", // "Reduced target's Resistances"
  RetaliationDurationFire: "SkillIntFormat", // "Burn Retaliation"
  RetaliationDurationLightning: "SkillIntFormat", // "Electrocute Retaliation"
  RetaliationDurationManaLeach: "SkillIntFormat", // "Energy Leech Retaliation"
  RetaliationDurationPhysical: "SkillIntFormat", // "Internal Trauma Retaliation"
  RetaliationDurationPoison: "SkillIntFormat", // "Poison Retaliation"
};

// A substitution marker inside a `{...}` group: %<sign><precision><conv><index>. Mirrors
// core/localization.ts's SUBST closely enough to find the highest arg index a template
// references. Exported so the test suite's coverage guard calls this directly rather than
// reimplementing it, keeping the guard and this function from silently drifting apart.
const PLACEHOLDER_INDEX = /%[+-]?(?:\.\d)?[a-z](\d)/g;

export function maxPlaceholderIndex(template: string): number {
  let max = -1;
  for (const m of template.matchAll(PLACEHOLDER_INDEX)) max = Math.max(max, Number(m[1]));
  return max;
}

// A single value, or a [min, max] pair for a collapsed Min/Max range line. Kept as one type
// (rather than a range-only sibling function) so plain-vs-templated stays a single decision
// point in valueLine - see the fix-1 note below on why that property matters.
type LineValue = number | [number, number];

function bareValue(value: LineValue): string {
  return Array.isArray(value) ? `${value[0]}-${value[1]}` : String(value);
}

// A plain label carries no `{...}` group, so the value cannot ride inside it: every
// brace group in data/i18n/game.en.json wraps a substitution (verified against the whole
// English catalog), so "does the template contain a brace" is the templated/plain split -
// narrower checks like "starts with {%" miss sign-prefixed groups such as "{-%.0f0}"
// (tagCharDefensiveBlockRecoveryReduction, 13 real occurrences) and silently render the
// raw template text instead of formatting it. This claim is English-only: game.fr.json's
// DamageKnockdown is "{^}Ede renverser la cible{%t0}", where {^} is a formatting escape
// with no substitution, not a counterexample in practice (that tag also carries {%t0}, so
// it classifies as templated under either check in every locale) but a real caveat, since
// valueLine sees the active locale's template at render time, not always English.
//
// The RANGE branch below routes both a scalar and a [min, max] pair through here rather than
// calling gameFormatT itself, so this stays the ONE place deciding plain-versus-templated
// (fix-1): a direct gameFormatT([[min,max]]) call substitutes fine into a templated tag's
// {%t0}, but on a PLAIN tag (no placeholder at all) it has nothing to substitute into and
// silently drops both numbers - found on Wind Devil's Howling Wind ability
// (offensiveSlowLightningMin/Max sharing the plain DamageDurationLightning = "Electrocute
// Damage", with no DurationMin sibling to route it through the DOT branch instead).
function valueLine(value: LineValue, tag: string, template: string): Text | null {
  if (!/\{/.test(template)) {
    // A composer supplies the value and its unit, with the label riding in as %s1 - but
    // composer templates (SkillSecondFormat, SkillIntFormat, ...) are authored for a single
    // formatted number (%d/%.Nf), not a range, so a range value skips the composer and
    // renders as a bare "min-max label" instead, the same shape an uncomposed scalar already
    // takes. DamageDurationLightning is itself composer-mapped (SkillIntFormat) for its
    // ordinary scalar case; only the range call bypasses it.
    if (!Array.isArray(value)) {
      const composer = COMPOSER[tag];
      if (composer) return gameFormatT(composer, [value, gameT(tag)]);
    }
    const label = gameT(tag);
    // A label that already begins with its own percent takes no separator, so
    // "% Slow target" reads "25% Slow target" rather than "25 % Slow target".
    return template.startsWith("%") ? joinT(bareValue(value), label) : joinT(bareValue(value), " ", label);
  }
  // A tag's own template can reference an argument beyond the single value supplied
  // here - a racial-target name (racialBonusPercentDamage), a target count
  // (sparkChance) - that the pipeline doesn't carry upstream. Dropping just the
  // unfilled {...} group still leaves stray literal text outside it ("+16% Damage to"),
  // so the whole line is suppressed rather than shipping a truncated sentence. No real Min/Max
  // pair reaches this guard today (racialBonusPercentDamage and sparkChance are standalone
  // stats, not <family>Min/<family>Max), but it now covers a hypothetical range value too.
  if (maxPlaceholderIndex(template) > 0) return null;
  return gameFormatT(tag, [value]);
}

// The nearest entry the block still has spare that satisfies `match`, searched outward from
// `from` (itself a candidate), forward before backward at equal distance.
//
// A ModBlock is one (item, skill) pair, NOT one carrier: scripts/build_skill_items.py merges
// every modifier record touching that skill into one stats list, ordered by modifier_record
// then stat id, so one block can carry the same stat id twice and each carrier's own stats sit
// CONTIGUOUSLY. Three real blocks do (Stormrend's Werewolf block carries two complete refresh
// carriers, Bloodlord's Blade's Possession block two skillCooldownReduction values, Desert
// Sting two conversionPercentage entries). Identifying stats by id alone - a `new Map(stats)`,
// last wins, plus a used-set keyed by id - dropped one carrier's line outright and let the
// survivor read the OTHER carrier's refresh_skill. Searching outward from the entry being
// rendered keeps sibling resolution inside the carrier without the payload naming it.
function nearestIndex(
  stats: ModStat[],
  used: Set<number>,
  from: number,
  match: (s: ModStat, i: number) => boolean,
): number {
  for (let d = 0; d < stats.length; d++) {
    for (const j of d === 0 ? [from] : [from + d, from - d]) {
      if (j < 0 || j >= stats.length || used.has(j)) continue;
      if (match(stats[j]!, j)) return j;
    }
  }
  return -1;
}

/** Index of the nearest unconsumed entry carrying `statId`, or -1. */
function nearestStat(stats: ModStat[], used: Set<number>, from: number, statId: string): number {
  return nearestIndex(stats, used, from, (s) => s.stat === statId);
}

/** One card line per group, in first-appearance order. */
/** One rendered line, and the damage type it is about. `damage` is null for a line that is not
 *  about one type - a cooldown, a weapon-damage percentage, or a CONVERSION, whose two types are
 *  marked inside the Text instead so a renderer can colour each in its own hue. */
export interface EffectLine {
  text: Text;
  damage: DamageType | null;
}

function isConversion(stat: string): boolean {
  return stat.startsWith("conversionPercentage");
}

// A damage-type name, marked with the type it names so a renderer can colour it. Unmarked when
// the tag is one this page does not colour, so the mark never lies about what it is.
function markedType(tag: string): Text {
  const type = damageTypeOfTag(tag);
  return type ? markedT(type, gameT(tag)) : gameT(tag);
}

export function effectLines(stats: ModStat[], ctx: EffectContext): EffectLine[] {
  const used = new Set<number>();
  const out: EffectLine[] = [];

  for (let i = 0; i < stats.length; i++) {
    if (used.has(i)) continue;
    const tag = ctx.tagOf(stats[i]!.stat);
    if (!tag) continue;
    const line = renderOne(stats, i, used, ctx, tag);
    // The tag is what the line is built from and what names its damage type; the stat id is not,
    // since one tag serves a whole family of ids. A conversion line reports no type of its own.
    if (line) out.push({ text: line, damage: isConversion(stats[i]!.stat) ? null : damageTypeOfTag(tag) });
  }
  return out;
}

// A <X>Chance is a PROBABILITY, never a magnitude, whenever data/stat-item-tags.json points it
// at the display tag its own <X> family's value stat already carries - which the catalog itself
// answers, through tagOf, for every family at once rather than by a growing prefix list. That
// covers offensiveSlow<X>Chance (Blood of Dreeg), skillCooldownReductionChance (Horns of
// Ekket'Zul rendered "+100%" and "+20% Skill Cooldown Reduction" as two contradictory lines),
// offensiveElementalChance (Dawnshard Grip rendered "10 Elemental Damage" above the real "100
// Elemental Damage") and the crowd-control chances. The four real independent chances
// (defensiveBlockChance, offensivePhysicalChance, projectilePiercingChance, sparkChance) carry
// their own tag and are untouched.
function isProcChance(stat: string, tag: string, ctx: EffectContext): boolean {
  const m = stat.match(CHANCE);
  if (!m) return false;
  return ctx.tagOf(m[1]!) === tag || ctx.tagOf(`${m[1]}Min`) === tag || ctx.tagOf(`${m[1]}Max`) === tag;
}

// The duration Text filling a CLAUSE_SLOT/QUANTITY_SLOT tag's {%t0}, or null if uncomposable.
// Leads with the separator the game's own text table carries and the table build strips: the raw
// DamageFixedSingleFormatTime is " {^E}for {^H}{%.1f0} {^E}Seconds", and clean_text's .strip()
// takes that first space off. Same restoration the damage-over-time branch does with
// joinT(head, " ", ...). Harmless where the slot leads the label, since applyGameFormat trims.
function durationSlot(tag: string, seconds: LineValue, ctx: EffectContext): Text | null {
  if (!CLAUSE_SLOT.has(tag)) {
    return joinT(" ", bareValue(seconds), " ", unit(Array.isArray(seconds) ? seconds[1] : seconds));
  }
  const composer = Array.isArray(seconds) ? "DamageFixedRangeFormatTime" : "DamageFixedSingleFormatTime";
  if (!ctx.templateOf(composer)) return null;
  return joinT(" ", gameFormatT(composer, Array.isArray(seconds) ? [seconds[0], seconds[1]] : [seconds]));
}

// A refresh family composes one line from its amount, its chance, and the target and trigger
// the pipeline carries alongside them. The target is frequently a different skill from the
// block's own, so it is never inferred. Only refreshDuration ships a Max variant (23 of its 29
// blocks; refreshCooldown carries one on 0 of 73), so the "(Max N Seconds)" suffix only ever
// applies to that family. Returns undefined when the entry is not a refresh stat at all, which
// is what separates "this family declines to render a line" from "not this family's business".
function renderRefresh(stats: ModStat[], i: number, used: Set<number>, ctx: EffectContext): Text | null | undefined {
  const ref = stats[i]!.stat.match(REFRESH);
  if (!ref) return undefined;
  const family = ref[1];
  const amountIdx = nearestStat(stats, used, i, `${family}Amount`);
  if (amountIdx < 0) return null;
  const amount = stats[amountIdx]!;
  const chanceIdx = nearestStat(stats, used, amountIdx, `${family}Chance`);
  const maxIdx = family === "refreshDuration" ? nearestStat(stats, used, amountIdx, `${family}Max`) : -1;
  const chance = chanceIdx >= 0 ? stats[chanceIdx] : undefined;
  const max = maxIdx >= 0 ? stats[maxIdx] : undefined;
  used.add(i);
  used.add(amountIdx);
  if (chanceIdx >= 0) used.add(chanceIdx);
  if (maxIdx >= 0) used.add(maxIdx);
  const q = amount.refresh_trigger ? TRIGGER_TAG[amount.refresh_trigger] : undefined;
  const cond: FormatArg = q ? gameFormatT(q, [chance?.value ?? 0]) : (chance?.value ?? 0);
  const target = amount.refresh_skill ? ctx.nameOf(amount.refresh_skill) : undefined;
  const composerTag =
    family === "refreshCooldown"
      ? target
        ? "tagSkillCooldownRefreshName"
        : "tagSkillCooldownRefresh"
      : max
        ? target
          ? "tagSkillDurationRefreshNameMax"
          : "tagSkillDurationRefreshMax"
        : target
          ? "tagSkillDurationRefreshName"
          : "tagSkillDurationRefresh";
  const args: FormatArg[] = target
    ? [cond, target, amount.value, unit(amount.value)]
    : [cond, amount.value, unit(amount.value)];
  if (max) args.push(max.value, unit(max.value));
  return gameFormatT(composerTag, args);
}

/** "10% Chance to Petrify target for 2 Seconds" / "10% Chance of 540 Poison Damage over 5 Seconds". */
function withChance(body: Text, chance: number, tag: string): Text {
  // The game's own prefixes are tagChanceOf and tagChanceTo, picked by exactly this split (a
  // clause takes "to", a noun phrase takes "of"). Neither survives the game-table build - both
  // clean to an unbalanced "{" in English - so they are app catalog keys here. See BACKLOG.md.
  return appT(CLAUSE_SLOT.has(tag) ? "items.effect.chanceTo" : "items.effect.chanceOf", { chance, effect: body });
}

function renderOne(stats: ModStat[], i: number, used: Set<number>, ctx: EffectContext, tag: string): Text | null {
  const s = stats[i]!;
  const template = ctx.templateOf(tag);
  if (!template) return null;

  // The refresh family folds its own chance into its own composed line, so it is settled
  // before the general proc-chance rule below ever sees refreshCooldownChance.
  const refresh = renderRefresh(stats, i, used, ctx);
  if (refresh !== undefined) return refresh;

  const sameTag = (o: ModStat, j: number) => j !== i && ctx.tagOf(o.stat) === tag;
  if (isProcChance(s.stat, tag, ctx)) {
    // The magnitude sibling renders the line and reads this chance back off the block, so this
    // entry never renders one of its own - except on a clause tag, whose label is a whole
    // sentence that reads correctly with an empty duration slot ("15% Chance to Immobilize
    // target"). On any other tag the label alone is a lie ("10 Poison Damage"), so it is dropped,
    // which is what the lone offensiveSlowLightningChance on Awakened Inscribed Bracers' Wind
    // Devil block needs: grimtools shows no Wind Devil block for that item at all.
    if (nearestIndex(stats, used, i, (o, j) => sameTag(o, j) && !isProcChance(o.stat, tag, ctx)) >= 0) return null;
    if (!CLAUSE_SLOT.has(tag)) return null;
    used.add(i);
    return withChance(gameFormatT(tag, []), s.value, tag);
  }
  const chanceIdx = nearestIndex(stats, used, i, (o, j) => sameTag(o, j) && isProcChance(o.stat, tag, ctx));

  const body = renderBody(stats, i, used, ctx, tag, template);
  if (!body) return null;
  if (chanceIdx < 0) return body;
  used.add(chanceIdx);
  return withChance(body, stats[chanceIdx]!.value, tag);
}

function renderBody(
  stats: ModStat[],
  i: number,
  used: Set<number>,
  ctx: EffectContext,
  tag: string,
  template: string,
): Text | null {
  const s = stats[i]!;

  // A crowd-control tag's {%t0} is a text slot, and its Min is the DURATION that fills it, not
  // a magnitude: substituting the number straight in produced "Petrify target10" and
  // "Freeze target1". A Min/Max pair fills the range variant instead.
  if (CLAUSE_SLOT.has(tag) || QUANTITY_SLOT.has(tag)) {
    const range = s.stat.match(RANGE);
    const partnerIdx = range ? nearestStat(stats, used, i, `${range[1]}${range[2] === "Min" ? "Max" : "Min"}`) : -1;
    used.add(i);
    let seconds: LineValue = s.value;
    if (partnerIdx >= 0) {
      used.add(partnerIdx);
      const partner = stats[partnerIdx]!.value;
      seconds = range![2] === "Min" ? [s.value, partner] : [partner, s.value];
    }
    const slot = durationSlot(tag, seconds, ctx);
    return slot ? gameFormatT(tag, [slot]) : null;
  }

  // A duration sibling makes one line. Damage families show the product and read
  // "over"; every other family keeps its magnitude and reads "for". The real data
  // (data/stat-item-tags.json) maps a DurationMin stat to the SAME tag as its value
  // stat, and sorts DurationMin first by stat id, so the Duration record is almost
  // always visited before its value sibling: it unconditionally defers to that sibling
  // rather than rendering on its own. A lone DurationMin with no Min sibling (Awakened
  // Inscribed Bracers' Wind Devil block: offensiveSlowLightningChance + DurationMin, no
  // Min) renders nothing, matching grimtools - which shows no Wind Devil block at all -
  // rather than falling through to the plain-label path below and printing the duration
  // as a damage amount ("2 Electrocute Damage"). Task 8's fix round 1 made this
  // conditional on the Min sibling existing, on the theory the unconditional drop was
  // itself a bug dropping a real line; grimtools drops it too, so that theory was wrong -
  // reverted in Task 8b.
  const dot = s.stat.match(DOT);
  if (dot) {
    if (dot[2]) {
      return null;
    }
    const durIdx = nearestStat(stats, used, i, `${dot[1]}DurationMin`);
    if (durIdx >= 0) {
      const dur = stats[durIdx]!;
      used.add(i);
      used.add(durIdx);
      const isDamage = DOT_DAMAGE.has(dot[1]!);
      const suffixTag = isDamage ? "DamageSingleFormatTime" : "DamageFixedSingleFormatTime";
      const head = valueLine(isDamage ? s.value * dur.value : s.value, tag, template);
      if (!head) return null;
      return ctx.templateOf(suffixTag) ? joinT(head, " ", gameFormatT(suffixTag, [dur.value])) : head;
    }
  }

  // Each conversion percentage is its own line, carrying its own type pair. They
  // share one tag, so a naive shared-tag merge would wrongly fuse them on 148 blocks.
  // 1 of 796 conversion stats in the real data lacks a from_tag or to_tag; without
  // both, the 3-arg composer has nothing sensible to render, so the line is dropped
  // rather than falling through to the plain renderer (which would hand it one value
  // for three placeholders).
  if (isConversion(s.stat)) {
    if (!s.from_tag || !s.to_tag) return null;
    // "100% Cold converted to Fire" is two damage types in one line, so the line takes no colour
    // and each type name carries its own. Marking the ARGUMENTS is what makes that safe in every
    // locale: they are substituted whole, so no renderer has to find a word inside translated
    // prose (and Russian declines these nouns, which would defeat any search that tried).
    return gameFormatT(tag, [s.value, markedType(s.from_tag), markedType(s.to_tag)]);
  }

  // A Min and its Max collapse into one range line, regardless of which one appears first
  // in the stat list: the real data orders by stat id, and "Max" sorts before "Min", so every
  // paired block in data/skill-items.json hits Max first. A lone half is a single value (far
  // more common than paired: 1,715 lone-Min against 80 paired). Don't mark either stat used
  // until we know how the pair renders, or a Max seen before its Min emits a spurious line.
  const m = s.stat.match(RANGE);
  if (m) {
    const partnerIdx = nearestStat(stats, used, i, `${m[1]}${m[2] === "Min" ? "Max" : "Min"}`);
    if (partnerIdx >= 0) {
      const partner = stats[partnerIdx]!;
      used.add(i);
      used.add(partnerIdx);
      const [minValue, maxValue] = m[2] === "Min" ? [s.value, partner.value] : [partner.value, s.value];
      return valueLine([minValue, maxValue], tag, template);
    }
  }
  used.add(i);
  return valueLine(s.value, tag, template);
}

// Call effectLines once PER BLOCK, never on blocks flattened together: effectLines resolves
// siblings and a used-set within one call's stats, so a shared call across two blocks' stats lets one
// block's Min pair with a different block's Max (see task-12-13-fix-1.md, C1 - Krieg's
// Mask fabricated "140-300 Aether Damage" from Blitz's flat 140 and War Cry's real
// 180-300). Shared by tableView.ts (one row's in-scope blocks) and detailView.ts (one
// skill's or one pet source's blocks) - both need "concatenate LINES across blocks,
// never STATS", so the helper lives here rather than being duplicated or imported
// adapter-to-adapter (which would create a cycle between tableView.ts and detailView.ts).
//
// Within a single skill-node group, a base skill and its transmuter/modifier sometimes carry
// literally the same block twice (identical stats, same values - e.g. Blackwater's conversion
// block on both blackwater1 and blackwater1b). Deduping by structural equality on the rendered
// Text descriptor (not on resolved, locale-dependent strings) collapses those genuine repeats
// back to one line, matching the pre-fix output for that case, while two DIFFERENT descriptors
// that happen to resolve to the same text in some locale are never merged.
export function rowEffectLines(modBlocks: ModStat[][], ctx: EffectContext): EffectLine[] {
  const seen = new Set<string>();
  const out: EffectLine[] = [];
  for (const stats of modBlocks) {
    for (const line of effectLines(stats, ctx)) {
      // Keyed on the Text descriptor alone: two lines with the same descriptor also carry the
      // same damage type, since both come from the same tag.
      const key = JSON.stringify(line.text);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(line);
    }
  }
  return out;
}
