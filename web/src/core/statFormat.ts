// ABOUTME: Formats raw Grim Dawn devotion stat ids + values into player-facing rows.
// ABOUTME: Encodes the percent/flat split and GD's internal->display quirks (Life=Vitality, Dexterity=Cunning, ...).
import type { PetInfo } from "./types";
export interface StatRow {
  label: string;
  value: string;
}

// Instant damage type segment -> display name. GD quirks: internal Life = Vitality, Poison = Acid.
const INSTANT_DAMAGE: Record<string, string> = {
  Physical: "Physical",
  Pierce: "Pierce",
  Fire: "Fire",
  Cold: "Cold",
  Lightning: "Lightning",
  Elemental: "Elemental",
  Aether: "Aether",
  Chaos: "Chaos",
  Poison: "Acid",
  Life: "Vitality",
};
// "Slow" (damage-over-time) type segment -> display name.
const DOT_DAMAGE: Record<string, string> = {
  Bleeding: "Bleeding",
  Physical: "Internal Trauma",
  Fire: "Burn",
  Cold: "Frostburn",
  Lightning: "Electrocute",
  Poison: "Poison",
  Life: "Vitality Decay",
};
// Resistance type segment -> display name. (Status effects like Stun/Freeze are NOT
// resistances in GD - they are duration-reduction stats, handled in OVERRIDES.)
const RESIST: Record<string, string> = {
  Physical: "Physical",
  Pierce: "Pierce",
  Fire: "Fire",
  Cold: "Cold",
  Lightning: "Lightning",
  Aether: "Aether",
  Chaos: "Chaos",
  Poison: "Poison & Acid",
  Life: "Vitality",
  Bleeding: "Bleeding",
};
// Character attribute segment -> display name (GD renamed the classic attributes).
const ATTR: Record<string, string> = {
  Strength: "Physique",
  Dexterity: "Cunning",
  Intelligence: "Spirit",
  Life: "Health",
  Mana: "Energy",
  OffensiveAbility: "Offensive Ability",
  DefensiveAbility: "Defensive Ability",
  LifeRegen: "Health Regeneration",
  ManaRegen: "Energy Regeneration",
};

interface Classified {
  label: string;
  percent: boolean;
  sign: number; // 1 normal, -1 for reductions shown as negative
}

// Irregular keys that do not follow the family rules below.
const OVERRIDES: Record<string, Classified> = {
  defensiveProtection: { label: "Armor", percent: false, sign: 1 },
  defensiveProtectionModifier: { label: "Armor", percent: true, sign: 1 },
  defensiveAbsorptionModifier: { label: "Armor Absorption", percent: true, sign: 1 },
  defensiveBlockModifier: { label: "Shield Block Chance", percent: true, sign: 1 },
  defensiveBlockAmountModifier: { label: "Shield Damage Blocked", percent: true, sign: 1 },
  defensiveElementalResistance: { label: "Elemental Resistance", percent: true, sign: 1 },
  defensiveTotalSpeedResistance: { label: "Slow Resistance", percent: true, sign: 1 },
  defensivePercentReflectionResistance: { label: "Reflected Damage Reduction", percent: true, sign: 1 },
  defensiveSlowLifeLeach: { label: "Life Leech Resistance", percent: true, sign: 1 },
  defensiveSlowManaLeach: { label: "Energy Leech Resistance", percent: true, sign: 1 },
  defensiveSlowLifeLeachDuration: { label: "Reduced Life Leech Duration", percent: true, sign: 1 },
  // Status effects: duration-reduction / protection stats, NOT resistances.
  defensiveStun: { label: "Reduced Stun Duration", percent: true, sign: 1 },
  defensiveFreeze: { label: "Reduced Freeze Duration", percent: true, sign: 1 },
  defensivePetrify: { label: "Reduced Petrify Duration", percent: true, sign: 1 },
  defensiveTrap: { label: "Reduced Entrapment Duration", percent: true, sign: 1 },
  defensiveDisruption: { label: "Skill Disruption Protection", percent: true, sign: 1 },

  offensiveTotalDamageModifier: { label: "Total Damage", percent: true, sign: 1 },
  offensiveCritDamageModifier: { label: "Crit Damage", percent: true, sign: 1 },
  offensiveLifeLeechMin: { label: "of Attack Damage converted to Health", percent: true, sign: 1 },
  offensiveSlowManaLeachMin: { label: "Energy Leech", percent: false, sign: 1 },
  offensiveSlowManaLeachChance: { label: "Energy Leech Chance", percent: true, sign: 1 },
  offensiveSlowManaLeachDurationMin: { label: "Energy Leech Duration", percent: false, sign: 1 },
  offensiveElementalResistanceReductionPercentMin: {
    label: "Reduced target's Elemental Resistances",
    percent: true,
    sign: 1,
  },
  offensiveElementalResistanceReductionPercentDurationMin: {
    label: "Reduced Elemental Resistance Duration",
    percent: false,
    sign: 1,
  },
  offensiveLightningModifierChance: { label: "Chance for Lightning Damage", percent: true, sign: 1 },
  retaliationTotalDamageModifier: { label: "Total Retaliation Damage", percent: true, sign: 1 },

  racialBonusPercentDamage: { label: "Damage to specific enemy types", percent: true, sign: 1 },
  racialBonusPercentDefense: { label: "Less damage from specific enemy types", percent: true, sign: 1 },
  skillManaCostReduction: { label: "Skill Energy Cost", percent: true, sign: -1 },

  characterAttackSpeedModifier: { label: "Attack Speed", percent: true, sign: 1 },
  characterSpellCastSpeedModifier: { label: "Casting Speed", percent: true, sign: 1 },
  characterRunSpeedModifier: { label: "Movement Speed", percent: true, sign: 1 },
  characterRunSpeedMaxModifier: { label: "Maximum Movement Speed", percent: true, sign: 1 },
  characterTotalSpeedModifier: { label: "Total Speed", percent: true, sign: 1 },
  characterConstitutionModifier: { label: "Constitution", percent: true, sign: 1 },
  characterDodgePercent: { label: "Chance to Avoid Melee Attacks", percent: true, sign: 1 },
  characterDeflectProjectile: { label: "Chance to Avoid Projectiles", percent: true, sign: 1 },
  characterEnergyAbsorptionPercent: { label: "Energy Absorbed from Enemy Spells", percent: true, sign: 1 },
  characterDefensiveBlockRecoveryReduction: { label: "Shield Recovery", percent: true, sign: -1 },

  // Attribute/requirement reductions (official game labels; shown as a negative percent).
  characterArmorStrengthReqReduction: { label: "Physique Requirement for Armor", percent: true, sign: -1 },
  characterMeleeStrengthReqReduction: { label: "Physique Requirement for Melee Weapons", percent: true, sign: -1 },
  characterShieldStrengthReqReduction: { label: "Physique Requirement for Shields", percent: true, sign: -1 },
  characterMeleeDexterityReqReduction: { label: "Cunning Requirement for Melee Weapons", percent: true, sign: -1 },
  characterHuntingDexterityReqReduction: { label: "Cunning Requirement for Ranged Weapons", percent: true, sign: -1 },
  characterWeaponIntelligenceReqReduction: { label: "Spirit Requirement for all Weapons", percent: true, sign: -1 },
  characterJewelryIntelligenceReqReduction: { label: "Spirit Requirement for Jewelry", percent: true, sign: -1 },
};

function humanize(id: string): string {
  const s = id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._]/g, " ")
    .replace(/^character /i, "") // "Character" prefix is redundant in the planner
    .replace(/\bStrength\b/g, "Physique")
    .replace(/\bDexterity\b/g, "Cunning")
    .replace(/\bIntelligence\b/g, "Spirit")
    .replace(/\bMana\b/g, "Energy")
    .trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function classify(id: string): Classified | null {
  if (/^[A-Z]/.test(id)) return null; // weapon-class token (Spear2h, Dagger, ...) - shown via weapon requirement
  const o = OVERRIDES[id];
  if (o) return o;

  let m: RegExpMatchArray | null;

  // Offensive damage-over-time: offensiveSlow<Type>[Duration][Modifier|Min|Max]
  if ((m = id.match(/^offensiveSlow([A-Za-z]+?)(Duration)?(Modifier|Min|Max)?$/))) {
    const type = DOT_DAMAGE[m[1]!];
    if (type) {
      const percent = m[3] === "Modifier";
      return { label: m[2] ? `${type} Duration` : `${type} Damage`, percent, sign: 1 };
    }
  }
  // Offensive instant damage: offensive<Type>[Modifier|Min|Max]
  if ((m = id.match(/^offensive([A-Za-z]+?)(Modifier|Min|Max)?$/))) {
    const type = INSTANT_DAMAGE[m[1]!];
    if (type) return { label: `${type} Damage`, percent: m[2] === "Modifier", sign: 1 };
  }
  // Defensive maximum resistance: defensive<Type>MaxResist
  if ((m = id.match(/^defensive([A-Za-z]+?)MaxResist$/))) {
    const type = RESIST[m[1]!];
    if (type) return { label: `Maximum ${type} Resistance`, percent: true, sign: 1 };
  }
  // Defensive reduced damage-over-time duration: defensive<Type>Duration.
  // GD names these by the DoT (Internal Trauma/Burn/Frostburn/...) and shows them as a positive percent.
  if ((m = id.match(/^defensive([A-Za-z]+?)Duration$/))) {
    const type = DOT_DAMAGE[m[1]!];
    if (type) return { label: `Reduced ${type} Duration`, percent: true, sign: 1 };
  }
  // Defensive base resistance: defensive<Type>
  if ((m = id.match(/^defensive([A-Za-z]+?)$/))) {
    const type = RESIST[m[1]!];
    if (type) return { label: `${type} Resistance`, percent: true, sign: 1 };
  }
  // Retaliation damage: retaliation<Type>[Min|Max]
  if ((m = id.match(/^retaliation([A-Za-z]+?)(Min|Max)?$/))) {
    const type = INSTANT_DAMAGE[m[1]!];
    if (type) return { label: `${type} Retaliation`, percent: false, sign: 1 };
  }
  // Character attribute: character<Attr>[Modifier]
  if ((m = id.match(/^character([A-Za-z]+?)(Modifier)?$/))) {
    const name = ATTR[m[1]!];
    if (name) return { label: name, percent: m[2] === "Modifier", sign: 1 };
  }

  // Fallback: humanize, treating Modifier/Percent/Resistance/Chance as percent and Reduction as a negative percent.
  const percent = /Modifier$|Percent|Reduction$|Resistance$|Chance$/.test(id);
  return { label: humanize(id), percent, sign: /Reduction$/.test(id) ? -1 : 1 };
}

function fmtValue(value: number, percent: boolean, sign: number): string {
  const n = sign * value;
  const s = n >= 0 ? `+${n}` : `${n}`;
  return percent ? `${s}%` : s;
}

// Internal race name -> player-facing (GD shows the plural, except Undead).
const RACE_LABEL: Record<string, string> = {
  Beast: "Beasts",
  Chthonic: "Chthonics",
  Human: "Humans",
  Undead: "Undead",
};
function raceLabel(targets?: string[]): string | null {
  if (!targets || targets.length === 0) return null;
  return targets.map((t) => RACE_LABEL[t] ?? t).join(" & ");
}

/** Format a single stat id + value into a display row, or null if it is not a stat (weapon token). */
export function statRow(id: string, value: number, racialTarget?: string[]): StatRow | null {
  const c = classify(id);
  if (!c) return null;
  let label = c.label;
  const race = raceLabel(racialTarget);
  if (race) {
    if (id === "racialBonusPercentDamage") label = `Damage to ${race}`;
    else if (id === "racialBonusPercentDefense") label = `Less Damage from ${race}`;
  }
  return { label, value: fmtValue(value, c.percent, c.sign) };
}

// Display groups for the benefits sidebar, in render order.
export const GROUP_ORDER = ["Attributes", "Offense", "Defense", "Other"] as const;
export type StatGroup = (typeof GROUP_ORDER)[number];

function groupFor(id: string): StatGroup {
  if (id === "racialBonusPercentDamage") return "Offense";
  if (id === "racialBonusPercentDefense") return "Defense";
  if (/^offensive|^retaliation/.test(id)) return "Offense";
  if (/^defensive/.test(id)) return "Defense";
  if (/^character/.test(id)) return "Attributes";
  return "Other";
}

// Build display rows paired with a representative stat id (for grouping). Merges
// flat <base>Min/<base>Max damage pairs into one "+min-max" row, drops weapon tokens.
function bonusEntries(
  bonuses: Record<string, number>,
  opts: { racialTarget?: string[] },
): { id: string; row: StatRow }[] {
  const used = new Set<string>();
  const out: { id: string; row: StatRow }[] = [];
  for (const k of Object.keys(bonuses)) {
    if (used.has(k)) continue;
    const mm = k.match(/^(.*)(Min|Max)$/);
    if (mm) {
      const minK = `${mm[1]}Min`;
      const maxK = `${mm[1]}Max`;
      if (minK in bonuses && maxK in bonuses) {
        const c = classify(minK);
        if (c && !c.percent) {
          used.add(minK);
          used.add(maxK);
          out.push({ id: minK, row: { label: c.label, value: `+${bonuses[minK]}-${bonuses[maxK]}` } });
          continue;
        }
      }
    }
    const r = statRow(k, bonuses[k]!, opts.racialTarget);
    used.add(k);
    if (r) out.push({ id: k, row: r });
  }
  return out;
}

/** Format a bonuses map into a single list of display rows, sorted by label. */
export function formatBonusRows(bonuses: Record<string, number>, opts: { racialTarget?: string[] } = {}): StatRow[] {
  return bonusEntries(bonuses, opts)
    .map((e) => e.row)
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Like formatBonusRows, but each row keeps its representative stat id (for tagging tooltip rows). */
export function formatBonusRowsWithIds(
  bonuses: Record<string, number>,
  opts: { racialTarget?: string[] } = {},
): { id: string; label: string; value: string }[] {
  return bonusEntries(bonuses, opts)
    .map((e) => ({ id: e.id, label: e.row.label, value: e.row.value }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// A grouped row keeps its representative stat id so callers can diff it (highlight changes).
export interface GroupedRow extends StatRow {
  id: string;
}

// --- Celestial power ability stats ------------------------------------------
// A devotion power's tooltip is not a list of "+N%" bonuses; it is the ability's
// own stat lines the way grimtools shows them ("1.5 Second Skill Recharge",
// "1125 Poison Damage over 5 Seconds"). These render with the same value+label
// shape as bonus rows, but the value carries the unit and no leading sign.

function fmtNum(n: number): string {
  return String(n);
}

/**
 * Format a celestial power's level-selected stat map into GD-style ability rows.
 * Ability meta fields (recharge, projectiles, pass-through, radius, weapon %) and
 * the duration-paired damage-over-time / debuff lines are rendered explicitly, in
 * grimtools' order; any remaining raw stat ids fall through to bonus formatting
 * (sign stripped, since an ability grants the value rather than a +/- modifier).
 */
export function formatPowerStats(stats: Record<string, number>): StatRow[] {
  const rows: StatRow[] = [];
  const used = new Set<string>();
  const take = (k: string): number | undefined => {
    if (k in stats) {
      used.add(k);
      return stats[k];
    }
    return undefined;
  };

  const cd = take("skillCooldownTime");
  if (cd !== undefined) rows.push({ value: fmtNum(cd), label: "Second Skill Recharge" });

  const dur = take("skillActiveDuration");
  if (dur !== undefined) rows.push({ value: fmtNum(dur), label: "Second Duration" });

  const proj = take("projectileLaunchNumber");
  if (proj !== undefined) rows.push({ value: fmtNum(proj), label: "Projectile(s)" });

  const pierce = take("projectilePiercingChance");
  if (pierce !== undefined) rows.push({ value: `${fmtNum(pierce)}%`, label: "Chance to pass through Enemies" });

  const radius = take("projectileExplosionRadius") ?? take("skillTargetRadius");
  if (radius !== undefined) rows.push({ value: fmtNum(radius), label: "Meter Radius" });

  const absorb = take("damageAbsorption");
  if (absorb !== undefined) rows.push({ value: fmtNum(absorb), label: "Damage Absorption" });

  // Heal / restore procs (Dryad's Blessing, Giant's Blood, Inspiration): a flat and a
  // percent health restore, plus a percent energy restore. Value carries the unit.
  const healFlat = take("skillLifeBonus");
  if (healFlat !== undefined) rows.push({ value: fmtNum(healFlat), label: "Health Restored" });
  const healPct = take("skillLifePercent");
  if (healPct !== undefined) rows.push({ value: `${fmtNum(healPct)}%`, label: "Health Restored" });
  const energyPct = take("skillManaPercent");
  if (energyPct !== undefined) rows.push({ value: `${fmtNum(energyPct)}%`, label: "Energy Restored" });

  const weapon = take("weaponDamagePct");
  if (weapon !== undefined) rows.push({ value: `${fmtNum(weapon)}%`, label: "Weapon Damage" });

  // Damage-over-time: offensiveSlow<Type>Min holds per-second damage paired with a
  // duration; grimtools shows the total over the listed duration.
  for (const [seg, name] of Object.entries(DOT_DAMAGE)) {
    const minK = `offensiveSlow${seg}Min`;
    const durK = `offensiveSlow${seg}DurationMin`;
    if (minK in stats && durK in stats) {
      used.add(minK);
      used.add(durK);
      const total = Math.round(stats[minK]! * stats[durK]!);
      rows.push({ value: fmtNum(total), label: `${name} Damage over ${fmtNum(stats[durK]!)} Seconds` });
    }
  }

  // Offensive/Defensive Ability debuffs (e.g. Scorpion Sting's reduced DA).
  for (const [seg, name] of [
    ["DefensiveAbility", "Reduced target's Defensive Ability"],
    ["OffensiveAbility", "Reduced target's Offensive Ability"],
  ] as const) {
    const minK = `offensiveSlow${seg}Min`;
    const durK = `offensiveSlow${seg}DurationMin`;
    if (minK in stats) {
      used.add(minK);
      const dur = stats[durK];
      if (durK in stats) used.add(durK);
      const suffix = dur !== undefined ? ` for ${fmtNum(dur)} Seconds` : "";
      rows.push({ value: fmtNum(stats[minK]!), label: `${name}${suffix}` });
    }
  }

  // Other timed target debuffs: a percent movement slow, plus flat/percent resistance
  // and damage reductions (which lack the "Slow" infix the ability debuffs use).
  for (const [minK, durK, label, pct] of [
    ["offensiveSlowRunSpeedMin", "offensiveSlowRunSpeedDurationMin", "Slower target Movement", true],
    [
      "offensiveTotalResistanceReductionAbsoluteMin",
      "offensiveTotalResistanceReductionAbsoluteDurationMin",
      "Reduced target's Resistances",
      false,
    ],
    [
      "offensiveTotalDamageReductionPercentMin",
      "offensiveTotalDamageReductionPercentDurationMin",
      "Reduced target's Damage",
      true,
    ],
  ] as const) {
    if (minK in stats) {
      used.add(minK);
      const dur = stats[durK];
      if (durK in stats) used.add(durK);
      const suffix = dur !== undefined ? ` for ${fmtNum(dur)} Seconds` : "";
      rows.push({ value: pct ? `${fmtNum(stats[minK]!)}%` : fmtNum(stats[minK]!), label: `${label}${suffix}` });
    }
  }

  // Anything else (instant damage ranges, leech, resist reductions): reuse the
  // bonus formatter and drop the leading "+" an ability line does not show.
  const rest: Record<string, number> = {};
  for (const k of Object.keys(stats)) if (!used.has(k)) rest[k] = stats[k]!;
  for (const r of formatBonusRows(rest)) {
    rows.push({ label: r.label, value: r.value.replace(/^\+/, "") });
  }
  return rows;
}

/**
 * A summon proc's pet: a "Summons N <Pet> for M Seconds" summary line plus the pet's
 * base attack rendered as ability stat rows (reusing the power-stat formatter).
 */
export function formatPet(pet: PetInfo): { summon: string; attack: StatRow[] } {
  const plural = (pet.count ?? 1) > 1;
  const num = plural ? `${fmtNum(pet.count!)} ` : "";
  const name = `${pet.name ?? "minion"}${plural ? "s" : ""}`;
  const dur = pet.duration ? ` for ${fmtNum(pet.duration)} Seconds` : "";
  return { summon: `Summons ${num}${name}${dur}`, attack: formatPowerStats(pet.attackStats) };
}

// --- Condensed view: one line per concept (subject), carrying its dimensions ---
// A "subject" is a damage type, a resistance type, an attribute, or a standalone
// stat. Its dimensions (flat, percent, max-resist, duration flat/percent) collapse
// onto that one subject so a concept is not spread across several rows.
export type StatDim = "flat" | "pct" | "max" | "durFlat" | "durPct";
// Flat before percent: the flat value is added first, then the percent applies.
const DIM_ORDER: StatDim[] = ["flat", "pct", "max", "durFlat", "durPct"];

export interface CondensedPart {
  dim: StatDim;
  value: string;
  id: string;
}
export interface CondensedSubject {
  subject: string;
  key: string;
  parts: CondensedPart[];
}
export interface CondensedGroup {
  group: StatGroup;
  subjects: CondensedSubject[];
}

// Map a raw stat id to its (group, subject, dimension), mirroring classify's families.
function decompose(id: string): { group: StatGroup; subject: string; dim: StatDim } | null {
  const c = classify(id);
  if (!c) return null;
  const group = groupFor(id);
  let m: RegExpMatchArray | null;
  if ((m = id.match(/^offensiveSlow([A-Za-z]+?)(Duration)?(Modifier|Min|Max)?$/)) && DOT_DAMAGE[m[1]!]) {
    const pct = m[3] === "Modifier";
    const dim: StatDim = m[2] ? (pct ? "durPct" : "durFlat") : pct ? "pct" : "flat";
    return { group, subject: DOT_DAMAGE[m[1]!]!, dim };
  }
  if ((m = id.match(/^offensive([A-Za-z]+?)(Modifier|Min|Max)?$/)) && INSTANT_DAMAGE[m[1]!]) {
    return { group, subject: INSTANT_DAMAGE[m[1]!]!, dim: m[2] === "Modifier" ? "pct" : "flat" };
  }
  if ((m = id.match(/^defensive([A-Za-z]+?)MaxResist$/)) && RESIST[m[1]!]) {
    return { group, subject: `${RESIST[m[1]!]} Resistance`, dim: "max" };
  }
  if ((m = id.match(/^defensive([A-Za-z]+?)$/)) && RESIST[m[1]!]) {
    return { group, subject: `${RESIST[m[1]!]} Resistance`, dim: "pct" };
  }
  if ((m = id.match(/^character([A-Za-z]+?)(Modifier)?$/)) && ATTR[m[1]!]) {
    return { group, subject: ATTR[m[1]!]!, dim: m[2] ? "pct" : "flat" };
  }
  if (id === "defensiveProtection") return { group, subject: "Armor", dim: "flat" };
  if (id === "defensiveProtectionModifier") return { group, subject: "Armor", dim: "pct" };
  // Standalone stat: its own one-line subject.
  return { group, subject: c.label, dim: c.percent ? "pct" : "flat" };
}

/** Format a bonuses map into subjects grouped by category, each subject carrying its dimensions. */
export function condensedRows(
  bonuses: Record<string, number>,
  opts: { racialTarget?: string[] } = {},
): CondensedGroup[] {
  const groups = new Map<StatGroup, Map<string, CondensedSubject>>();
  for (const { id, row } of bonusEntries(bonuses, opts)) {
    const d = decompose(id);
    if (!d) continue;
    let subs = groups.get(d.group);
    if (!subs) {
      subs = new Map();
      groups.set(d.group, subs);
    }
    let cs = subs.get(d.subject);
    if (!cs) {
      cs = { subject: d.subject, key: `${d.group}:${d.subject}`, parts: [] };
      subs.set(d.subject, cs);
    }
    cs.parts.push({ dim: d.dim, value: row.value, id });
  }
  return GROUP_ORDER.filter((g) => groups.has(g)).map((g) => ({
    group: g,
    subjects: [...groups.get(g)!.values()]
      .map((cs) => ({ ...cs, parts: cs.parts.sort((a, b) => DIM_ORDER.indexOf(a.dim) - DIM_ORDER.indexOf(b.dim)) }))
      .sort((a, b) => a.subject.localeCompare(b.subject)),
  }));
}

/** Format a bonuses map into display rows grouped by category, in GROUP_ORDER. */
export function groupedBonusRows(
  bonuses: Record<string, number>,
  opts: { racialTarget?: string[] } = {},
): { group: StatGroup; rows: GroupedRow[] }[] {
  const byGroup = new Map<StatGroup, GroupedRow[]>();
  for (const { id, row } of bonusEntries(bonuses, opts)) {
    const g = groupFor(id);
    const arr = byGroup.get(g) ?? [];
    arr.push({ id, ...row });
    byGroup.set(g, arr);
  }
  return GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({
    group: g,
    rows: byGroup.get(g)!.sort((a, b) => a.label.localeCompare(b.label)),
  }));
}
