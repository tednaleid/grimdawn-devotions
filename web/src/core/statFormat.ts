// ABOUTME: Formats raw Grim Dawn devotion stat ids + values into player-facing rows.
// ABOUTME: Encodes the percent/flat split and GD's internal->display quirks (Life=Vitality, Dexterity=Cunning, ...).
import type { PetInfo } from "./types";
import { translate, gameText } from "./localization";
import { STAT_TAGS, STAT_FORMAT_TAGS } from "./statTags";

export interface StatRow {
  label: string;
  value: string;
}

// Resolve a stat catalog key to display text: mapped keys (data/stat-tags.json) go through the
// authoritative game term (gameText); unmapped keys fall back to the app catalog (translate).
// Resolved at call time, never at module load (the localization singleton installs after this
// module evaluates).
function statLabel(key: string): string {
  const tag = STAT_TAGS[key];
  return tag ? gameText(tag) : translate(key);
}

// Instant damage type segments recognized in ids. GD quirks: internal Life = Vitality, Poison = Acid.
// Display names live in the catalog under stat.damage.<Segment>, resolved at the read site (never at
// module load, since the localization singleton is installed after this module evaluates).
const INSTANT_DAMAGE_SEGMENTS = new Set([
  "Physical",
  "Pierce",
  "Fire",
  "Cold",
  "Lightning",
  "Elemental",
  "Aether",
  "Chaos",
  "Poison",
  "Life",
]);
function instantDamageLabel(segment: string): string | undefined {
  return INSTANT_DAMAGE_SEGMENTS.has(segment) ? statLabel(`stat.damage.${segment}`) : undefined;
}
// "Slow" (damage-over-time) type segments. Display names live under stat.dot.<Segment>.
const DOT_DAMAGE_SEGMENTS = new Set(["Bleeding", "Physical", "Fire", "Cold", "Lightning", "Poison", "Life"]);
function dotDamageLabel(segment: string): string | undefined {
  return DOT_DAMAGE_SEGMENTS.has(segment) ? statLabel(`stat.dot.${segment}`) : undefined;
}
// Resistance type segments. (Status effects like Stun/Freeze are NOT resistances in GD - they are
// duration-reduction stats, handled in OVERRIDES.) Display names live under stat.resist.<Segment>.
const RESIST_SEGMENTS = new Set([
  "Physical",
  "Pierce",
  "Fire",
  "Cold",
  "Lightning",
  "Aether",
  "Chaos",
  "Poison",
  "Life",
  "Bleeding",
]);
function resistLabel(segment: string): string | undefined {
  return RESIST_SEGMENTS.has(segment) ? statLabel(`stat.resist.${segment}`) : undefined;
}
// Character attribute segments (GD renamed the classic attributes). Display names live under
// stat.attr.<Segment>.
const ATTR_SEGMENTS = new Set([
  "Strength",
  "Dexterity",
  "Intelligence",
  "Life",
  "Mana",
  "OffensiveAbility",
  "DefensiveAbility",
  "LifeRegen",
  "ManaRegen",
]);
function attrLabel(segment: string): string | undefined {
  return ATTR_SEGMENTS.has(segment) ? statLabel(`stat.attr.${segment}`) : undefined;
}

interface Classified {
  label: string;
  percent: boolean;
  sign: number; // 1 normal, -1 for reductions shown as negative
}

// Irregular keys that do not follow the family rules below. percent/sign are structural; the display
// label is resolved from the catalog at the read site (stat.override.<id>).
const OVERRIDES: Record<string, { percent: boolean; sign: number }> = {
  defensiveProtection: { percent: false, sign: 1 },
  defensiveProtectionModifier: { percent: true, sign: 1 },
  defensiveAbsorptionModifier: { percent: true, sign: 1 },
  defensiveBlockModifier: { percent: true, sign: 1 },
  defensiveBlockAmountModifier: { percent: true, sign: 1 },
  defensiveElementalResistance: { percent: true, sign: 1 },
  defensiveTotalSpeedResistance: { percent: true, sign: 1 },
  defensivePercentReflectionResistance: { percent: true, sign: 1 },
  defensiveSlowLifeLeach: { percent: true, sign: 1 },
  defensiveSlowManaLeach: { percent: true, sign: 1 },
  defensiveSlowLifeLeachDuration: { percent: true, sign: 1 },
  // Status effects: duration-reduction / protection stats, NOT resistances.
  defensiveStun: { percent: true, sign: 1 },
  defensiveFreeze: { percent: true, sign: 1 },
  defensivePetrify: { percent: true, sign: 1 },
  defensiveTrap: { percent: true, sign: 1 },
  defensiveDisruption: { percent: true, sign: 1 },

  offensiveTotalDamageModifier: { percent: true, sign: 1 },
  offensiveCritDamageModifier: { percent: true, sign: 1 },
  offensiveLifeLeechMin: { percent: true, sign: 1 },
  offensiveSlowManaLeachMin: { percent: false, sign: 1 },
  offensiveSlowManaLeachChance: { percent: true, sign: 1 },
  offensiveSlowManaLeachDurationMin: { percent: false, sign: 1 },
  offensiveElementalResistanceReductionPercentMin: { percent: true, sign: 1 },
  offensiveElementalResistanceReductionPercentDurationMin: { percent: false, sign: 1 },
  offensiveLightningModifierChance: { percent: true, sign: 1 },
  retaliationTotalDamageModifier: { percent: true, sign: 1 },
  retaliationDamagePct: { percent: true, sign: 1 },
  retaliationFearMin: { percent: false, sign: 1 },
  retaliationFearChance: { percent: true, sign: 1 },

  racialBonusPercentDamage: { percent: true, sign: 1 },
  racialBonusPercentDefense: { percent: true, sign: 1 },
  skillManaCostReduction: { percent: true, sign: -1 },

  characterAttackSpeedModifier: { percent: true, sign: 1 },
  characterSpellCastSpeedModifier: { percent: true, sign: 1 },
  characterRunSpeedModifier: { percent: true, sign: 1 },
  characterRunSpeedMaxModifier: { percent: true, sign: 1 },
  characterTotalSpeedModifier: { percent: true, sign: 1 },
  characterConstitutionModifier: { percent: true, sign: 1 },
  // Value-suffix game format ("Healing Effects Increased by {v}%") - the value cannot be stripped to a
  // clean prefix label across languages, so the label is app-authored (see stat.override.<id>).
  characterHealIncreasePercent: { percent: true, sign: 1 },
  characterDodgePercent: { percent: true, sign: 1 },
  characterDeflectProjectile: { percent: true, sign: 1 },
  characterEnergyAbsorptionPercent: { percent: true, sign: 1 },
  characterDefensiveBlockRecoveryReduction: { percent: true, sign: -1 },

  // Attribute/requirement reductions (official game labels; shown as a negative percent).
  characterArmorStrengthReqReduction: { percent: true, sign: -1 },
  characterMeleeStrengthReqReduction: { percent: true, sign: -1 },
  characterShieldStrengthReqReduction: { percent: true, sign: -1 },
  characterMeleeDexterityReqReduction: { percent: true, sign: -1 },
  characterHuntingDexterityReqReduction: { percent: true, sign: -1 },
  characterWeaponIntelligenceReqReduction: { percent: true, sign: -1 },
  characterJewelryIntelligenceReqReduction: { percent: true, sign: -1 },
};

// Strip Grim Dawn value placeholders ("{%.0f0}%", ranges "{%.0f0}-{%.0f1}%") and the leading/trailing
// "%"/dash/space they leave behind, so a value-embedded stat format tag reduces to its bare noun. A
// no-op on the plain-noun tags in STAT_TAGS. Used only for value-PREFIX stats (value leads the noun in
// every language); value-suffix stats are app-authored instead.
function stripValueTokens(s: string): string {
  return s
    .replace(/\{%[^}]*\}/g, "")
    .replace(/^[\s%-]+|[\s%-]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

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
  if (o) return { label: translate(`stat.override.${id}`), percent: o.percent, sign: o.sign };

  let m: RegExpMatchArray | null;

  // Offensive damage-over-time: offensiveSlow<Type>[Duration][Modifier|Min|Max]
  if ((m = id.match(/^offensiveSlow([A-Za-z]+?)(Duration)?(Modifier|Min|Max)?$/))) {
    const type = dotDamageLabel(m[1]!);
    if (type) {
      const percent = m[3] === "Modifier";
      const label = m[2] ? translate("stat.template.duration", { type }) : translate("stat.template.damage", { type });
      return { label, percent, sign: 1 };
    }
  }
  // Offensive instant damage: offensive<Type>[Modifier|Min|Max]
  if ((m = id.match(/^offensive([A-Za-z]+?)(Modifier|Min|Max)?$/))) {
    const type = instantDamageLabel(m[1]!);
    if (type) return { label: translate("stat.template.damage", { type }), percent: m[2] === "Modifier", sign: 1 };
  }
  // Defensive maximum resistance: defensive<Type>MaxResist
  if ((m = id.match(/^defensive([A-Za-z]+?)MaxResist$/))) {
    const type = resistLabel(m[1]!);
    if (type) return { label: translate("stat.template.maxResistance", { type }), percent: true, sign: 1 };
  }
  // Defensive reduced damage-over-time duration: defensive<Type>Duration.
  // GD names these by the DoT (Internal Trauma/Burn/Frostburn/...) and shows them as a positive percent.
  if ((m = id.match(/^defensive([A-Za-z]+?)Duration$/))) {
    const type = dotDamageLabel(m[1]!);
    if (type) return { label: translate("stat.template.reducedDuration", { type }), percent: true, sign: 1 };
  }
  // Defensive base resistance: defensive<Type>
  if ((m = id.match(/^defensive([A-Za-z]+?)$/))) {
    const type = resistLabel(m[1]!);
    if (type) return { label: translate("stat.template.resistance", { type }), percent: true, sign: 1 };
  }
  // Retaliation damage: retaliation<Type>[Modifier|Min|Max]. Modifier is the percent form.
  if ((m = id.match(/^retaliation([A-Za-z]+?)(Modifier|Min|Max)?$/))) {
    const type = instantDamageLabel(m[1]!);
    if (type) return { label: translate("stat.template.retaliation", { type }), percent: m[2] === "Modifier", sign: 1 };
  }
  // Character attribute: character<Attr>[Modifier]
  if ((m = id.match(/^character([A-Za-z]+?)(Modifier)?$/))) {
    const name = attrLabel(m[1]!);
    if (name) return { label: name, percent: m[2] === "Modifier", sign: 1 };
  }

  // Value-embedded game format stats ("{v}% <noun>"): source the noun from the game tag, strip the value.
  const fmtTag = STAT_FORMAT_TAGS[id];
  if (fmtTag) return { label: stripValueTokens(gameText(fmtTag)), percent: true, sign: 1 };

  // Fallback: humanize, treating Modifier/Percent/Resistance/Chance as percent and Reduction as a negative percent.
  const percent = /Modifier$|Percent|Reduction$|Resistance$|Chance$/.test(id);
  return { label: humanize(id), percent, sign: /Reduction$/.test(id) ? -1 : 1 };
}

function fmtValue(value: number, percent: boolean, sign: number): string {
  const n = sign * value;
  const s = n >= 0 ? `+${n}` : `${n}`;
  return percent ? `${s}%` : s;
}

// Internal race name -> player-facing (GD shows the plural, except Undead). Display names and the
// multi-race join separator live in the catalog under stat.race.<Race> / stat.race.join.
const RACE_SEGMENTS = new Set(["Beast", "Chthonic", "Human", "Undead"]);
function raceLabel(targets?: string[]): string | null {
  if (!targets || targets.length === 0) return null;
  return targets.map((t) => (RACE_SEGMENTS.has(t) ? translate(`stat.race.${t}`) : t)).join(translate("stat.race.join"));
}

/** Format a single stat id + value into a display row, or null if it is not a stat (weapon token). */
export function statRow(id: string, value: number, racialTarget?: string[]): StatRow | null {
  const c = classify(id);
  if (!c) return null;
  let label = c.label;
  const race = raceLabel(racialTarget);
  if (race) {
    if (id === "racialBonusPercentDamage") label = translate("stat.subject.damageToRace", { race });
    else if (id === "racialBonusPercentDefense") label = translate("stat.subject.lessDamageFromRace", { race });
  }
  return { label, value: fmtValue(value, c.percent, c.sign) };
}

// Display groups for the benefits sidebar, in render order. Offense-side debuff sections
// (Resistance Reduction, Crowd Control, Retaliation) and the three-way Defense split keep the
// high-value concepts from being buried in one giant section. Routing lives in groupFor.
// These act as internal identifiers (Map keys in this file and in benefitRows.ts, and asserted
// directly by statFormat.test.ts / condense.test.ts), so they stay plain English here. The
// sidebar's rendered header resolves the display text via GROUP_KEY + translate (see
// sidebarView.ts), never this raw value.
export const GROUP_ORDER = [
  "Attributes",
  "Offense",
  "Resistance Reduction",
  "Crowd Control",
  "Retaliation",
  "Resistances",
  "Status Protection",
  "Armor & Mitigation",
  "Other",
] as const;
export type StatGroup = (typeof GROUP_ORDER)[number];

// Maps a StatGroup identifier to its catalog key, for the sidebar header render site.
export const GROUP_KEY: Record<StatGroup, string> = {
  Attributes: "stat.group.attributes",
  Offense: "stat.group.offense",
  "Resistance Reduction": "stat.group.resistanceReduction",
  "Crowd Control": "stat.group.crowdControl",
  Retaliation: "stat.group.retaliation",
  Resistances: "stat.group.resistances",
  "Status Protection": "stat.group.statusProtection",
  "Armor & Mitigation": "stat.group.armorAndMitigation",
  Other: "stat.group.other",
};

function groupFor(id: string): StatGroup {
  if (id === "racialBonusPercentDamage") return "Offense";
  if (id === "racialBonusPercentDefense") return "Armor & Mitigation";
  if (/^retaliation/.test(id)) return "Retaliation";
  if (/ResistanceReduction/.test(id) || /^offensivePhysicalReductionPercent/.test(id)) return "Resistance Reduction";
  if (
    /^offensive(Stun|Freeze|Petrify|Knockdown|Confusion|Fumble|ProjectileFumble|SlowRunSpeed|SlowTotalSpeed|SlowAttackSpeed|SlowOffensiveAbility|SlowDefensiveAbility|TotalDamageReductionPercent)/.test(
      id,
    )
  )
    return "Crowd Control";
  if (/^offensive/.test(id)) return "Offense";
  // Defensive split. Order matters: damage-type resistances first, then the
  // status/effect protections, then everything else defensive (armor, block, reflect).
  if (
    /^defensive(Physical|Pierce|Fire|Cold|Lightning|Aether|Chaos|Poison|Life|Bleeding)(MaxResist)?$/.test(id) ||
    id === "defensiveElementalResistance"
  )
    return "Resistances";
  if (/^defensive(Physical|Fire|Cold|Lightning|Poison|Life|Bleeding)Duration$/.test(id)) return "Status Protection";
  if (/^defensive(Stun|Freeze|Petrify|Trap|Disruption)$/.test(id)) return "Status Protection";
  if (id === "defensiveTotalSpeedResistance" || /^defensiveSlow(Life|Mana)Leach/.test(id)) return "Status Protection";
  if (/^defensive/.test(id)) return "Armor & Mitigation";
  if (/^character/.test(id)) return "Attributes";
  return "Other";
}

/** Whether a raw stat id belongs in the benefit filter vocabulary: any group except "Other".
 *  Used to admit recognized celestial-power stats and exclude ability-meta (cooldown, projectiles, etc.). */
export function isFilterableStat(id: string): boolean {
  return groupFor(id) !== "Other";
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

// Shared " for N Seconds" suffix used by several ability-debuff lines below and by formatPet.
function forSecondsSuffix(seconds: number): string {
  return translate("stat.power.forSeconds", { seconds: fmtNum(seconds) });
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
  if (cd !== undefined) rows.push({ value: fmtNum(cd), label: translate("stat.power.secondSkillRecharge") });

  const dur = take("skillActiveDuration");
  if (dur !== undefined) rows.push({ value: fmtNum(dur), label: translate("stat.power.secondDuration") });

  const proj = take("projectileLaunchNumber");
  if (proj !== undefined) rows.push({ value: fmtNum(proj), label: translate("stat.power.projectiles") });

  const pierce = take("projectilePiercingChance");
  if (pierce !== undefined) rows.push({ value: `${fmtNum(pierce)}%`, label: translate("stat.power.passThrough") });

  const radius = take("projectileExplosionRadius") ?? take("skillTargetRadius");
  if (radius !== undefined) rows.push({ value: fmtNum(radius), label: translate("stat.power.meterRadius") });

  const absorb = take("damageAbsorption");
  if (absorb !== undefined) rows.push({ value: fmtNum(absorb), label: translate("stat.power.damageAbsorption") });

  // Heal / restore procs (Dryad's Blessing, Giant's Blood, Inspiration): a flat and a
  // percent health restore, plus a percent energy restore. Value carries the unit.
  const healFlat = take("skillLifeBonus");
  if (healFlat !== undefined) rows.push({ value: fmtNum(healFlat), label: translate("stat.power.healthRestored") });
  const healPct = take("skillLifePercent");
  if (healPct !== undefined) rows.push({ value: `${fmtNum(healPct)}%`, label: translate("stat.power.healthRestored") });
  const energyPct = take("skillManaPercent");
  if (energyPct !== undefined)
    rows.push({ value: `${fmtNum(energyPct)}%`, label: translate("stat.power.energyRestored") });

  const weapon = take("weaponDamagePct");
  if (weapon !== undefined) rows.push({ value: `${fmtNum(weapon)}%`, label: translate("stat.power.weaponDamage") });

  // Damage-over-time: offensiveSlow<Type>Min holds per-second damage paired with a
  // duration; grimtools shows the total over the listed duration.
  for (const seg of DOT_DAMAGE_SEGMENTS) {
    const minK = `offensiveSlow${seg}Min`;
    const durK = `offensiveSlow${seg}DurationMin`;
    if (minK in stats && durK in stats) {
      used.add(minK);
      used.add(durK);
      const total = Math.round(stats[minK]! * stats[durK]!);
      const name = statLabel(`stat.dot.${seg}`);
      rows.push({
        value: fmtNum(total),
        label: translate("stat.power.dotDamageOverSeconds", { name, seconds: fmtNum(stats[durK]!) }),
      });
    }
  }

  // Offensive/Defensive Ability debuffs (e.g. Scorpion Sting's reduced DA).
  const abilityDebuffs: [string, string][] = [
    ["DefensiveAbility", translate("stat.power.reducedDefensiveAbility")],
    ["OffensiveAbility", translate("stat.power.reducedOffensiveAbility")],
  ];
  for (const [seg, name] of abilityDebuffs) {
    const minK = `offensiveSlow${seg}Min`;
    const durK = `offensiveSlow${seg}DurationMin`;
    if (minK in stats) {
      used.add(minK);
      const dur = stats[durK];
      if (durK in stats) used.add(durK);
      const suffix = dur !== undefined ? forSecondsSuffix(dur) : "";
      rows.push({ value: fmtNum(stats[minK]!), label: `${name}${suffix}` });
    }
  }

  // Other timed target debuffs: a percent movement slow, plus flat/percent resistance
  // and damage reductions (which lack the "Slow" infix the ability debuffs use).
  const timedDebuffs: [string, string, string, boolean][] = [
    [
      "offensiveSlowRunSpeedMin",
      "offensiveSlowRunSpeedDurationMin",
      translate("stat.power.slowerTargetMovement"),
      true,
    ],
    [
      "offensiveTotalResistanceReductionAbsoluteMin",
      "offensiveTotalResistanceReductionAbsoluteDurationMin",
      translate("stat.power.reducedTargetResistances"),
      false,
    ],
    [
      "offensiveTotalDamageReductionPercentMin",
      "offensiveTotalDamageReductionPercentDurationMin",
      translate("stat.power.reducedTargetDamage"),
      true,
    ],
  ];
  for (const [minK, durK, label, pct] of timedDebuffs) {
    if (minK in stats) {
      used.add(minK);
      const dur = stats[durK];
      if (durK in stats) used.add(durK);
      const suffix = dur !== undefined ? forSecondsSuffix(dur) : "";
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
  const name = `${(pet.nameTag ? gameText(pet.nameTag) : null) ?? translate("stat.pet.minion")}${plural ? "s" : ""}`;
  const dur = pet.duration ? forSecondsSuffix(pet.duration) : "";
  return { summon: translate("stat.pet.summons", { num, name, dur }), attack: formatPowerStats(pet.attackStats) };
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
  if ((m = id.match(/^offensiveSlow([A-Za-z]+?)(Duration)?(Modifier|Min|Max)?$/))) {
    const type = dotDamageLabel(m[1]!);
    if (type) {
      const pct = m[3] === "Modifier";
      const dim: StatDim = m[2] ? (pct ? "durPct" : "durFlat") : pct ? "pct" : "flat";
      return { group, subject: type, dim };
    }
  }
  if ((m = id.match(/^offensive([A-Za-z]+?)(Modifier|Min|Max)?$/))) {
    const type = instantDamageLabel(m[1]!);
    if (type) return { group, subject: type, dim: m[2] === "Modifier" ? "pct" : "flat" };
  }
  if ((m = id.match(/^defensive([A-Za-z]+?)MaxResist$/))) {
    const type = resistLabel(m[1]!);
    if (type) return { group, subject: translate("stat.template.resistance", { type }), dim: "max" };
  }
  if ((m = id.match(/^defensive([A-Za-z]+?)$/))) {
    const type = resistLabel(m[1]!);
    if (type) return { group, subject: translate("stat.template.resistance", { type }), dim: "pct" };
  }
  if ((m = id.match(/^character([A-Za-z]+?)(Modifier)?$/))) {
    const name = attrLabel(m[1]!);
    if (name) return { group, subject: name, dim: m[2] ? "pct" : "flat" };
  }
  if (id === "defensiveProtection")
    return { group, subject: translate("stat.override.defensiveProtection"), dim: "flat" };
  if (id === "defensiveProtectionModifier")
    return { group, subject: translate("stat.override.defensiveProtectionModifier"), dim: "pct" };
  // Resistance reduction: flat and percent are distinct subjects (they stack differently in game).
  if (id.match(/^offensiveTotalResistanceReductionAbsolute(Duration)?Min$/))
    return {
      group,
      subject: translate("stat.power.reducedTargetResistances"),
      dim: /Duration/.test(id) ? "durFlat" : "flat",
    };
  if (id.match(/^offensiveElementalResistanceReductionAbsolute(Duration)?Min$/))
    return {
      group,
      subject: translate("stat.subject.reducedElementalResistancesFlat"),
      dim: /Duration/.test(id) ? "durFlat" : "flat",
    };
  if (id.match(/^offensiveElementalResistanceReductionPercent(Duration)?Min$/))
    return {
      group,
      subject: translate("stat.override.offensiveElementalResistanceReductionPercentMin"),
      dim: /Duration/.test(id) ? "durFlat" : "pct",
    };
  if (id.match(/^offensivePhysicalReductionPercent(Duration)?Min$/))
    return {
      group,
      subject: translate("stat.subject.reducedPhysicalResistance"),
      dim: /Duration/.test(id) ? "durFlat" : "pct",
    };
  // Crowd control: a status effect (magnitude Min + a Chance facet).
  let cc: RegExpMatchArray | null;
  if ((cc = id.match(/^offensive(Stun|Freeze|Petrify|Knockdown|Confusion)(Chance)?(Min|Max)?$/)))
    return { group, subject: translate(`stat.subject.cc${cc[1]}`), dim: cc[2] ? "pct" : "flat" };
  if (id.match(/^offensiveFumble(Duration)?Min$/))
    return { group, subject: translate("stat.subject.fumble"), dim: /Duration/.test(id) ? "durFlat" : "flat" };
  if (id.match(/^offensiveProjectileFumble(Duration)?Min$/))
    return { group, subject: translate("stat.subject.impairedAim"), dim: /Duration/.test(id) ? "durFlat" : "flat" };
  if (id.match(/^offensiveSlowRunSpeed(Duration)?Min$/))
    return { group, subject: translate("stat.subject.slowMovement"), dim: /Duration/.test(id) ? "durFlat" : "pct" };
  if (id.match(/^offensiveSlowTotalSpeed(Duration)?Min$/))
    return { group, subject: translate("stat.subject.slowTotalSpeed"), dim: /Duration/.test(id) ? "durFlat" : "pct" };
  if (id.match(/^offensiveSlowAttackSpeed(Duration)?Min$/))
    return { group, subject: translate("stat.subject.slowAttackSpeed"), dim: /Duration/.test(id) ? "durFlat" : "pct" };
  if (id.match(/^offensiveSlowOffensiveAbility(Duration)?Min$/))
    return {
      group,
      subject: translate("stat.power.reducedOffensiveAbility"),
      dim: /Duration/.test(id) ? "durFlat" : "flat",
    };
  if (id.match(/^offensiveSlowDefensiveAbility(Duration)?Min$/))
    return {
      group,
      subject: translate("stat.power.reducedDefensiveAbility"),
      dim: /Duration/.test(id) ? "durFlat" : "flat",
    };
  if (id.match(/^offensiveTotalDamageReductionPercent(Duration)?Min$/))
    return {
      group,
      subject: translate("stat.power.reducedTargetDamage"),
      dim: /Duration/.test(id) ? "durFlat" : "pct",
    };
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
