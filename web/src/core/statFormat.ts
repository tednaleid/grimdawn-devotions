// ABOUTME: Formats raw Grim Dawn devotion stat ids + values into player-facing rows.
// ABOUTME: Encodes the percent/flat split and GD's internal->display quirks (Life=Vitality, Dexterity=Cunning, ...).
export interface StatRow {
  label: string;
  value: string;
}

// Instant damage type segment -> display name. GD quirks: internal Life = Vitality, Poison = Acid.
const INSTANT_DAMAGE: Record<string, string> = {
  Physical: "Physical", Pierce: "Pierce", Fire: "Fire", Cold: "Cold", Lightning: "Lightning",
  Elemental: "Elemental", Aether: "Aether", Chaos: "Chaos", Poison: "Acid", Life: "Vitality",
};
// "Slow" (damage-over-time) type segment -> display name.
const DOT_DAMAGE: Record<string, string> = {
  Bleeding: "Bleeding", Physical: "Internal Trauma", Fire: "Burn", Cold: "Frostburn",
  Lightning: "Electrocute", Poison: "Poison", Life: "Vitality Decay",
};
// Resistance type segment -> display name.
const RESIST: Record<string, string> = {
  Physical: "Physical", Pierce: "Pierce", Fire: "Fire", Cold: "Cold", Lightning: "Lightning",
  Aether: "Aether", Chaos: "Chaos", Poison: "Poison", Life: "Vitality", Bleeding: "Bleeding",
  Stun: "Stun", Freeze: "Freeze", Petrify: "Petrify", Trap: "Trap", Disruption: "Disruption",
};
// Character attribute segment -> display name (GD renamed the classic attributes).
const ATTR: Record<string, string> = {
  Strength: "Physique", Dexterity: "Cunning", Intelligence: "Spirit",
  Life: "Health", Mana: "Energy",
  OffensiveAbility: "Offensive Ability", DefensiveAbility: "Defensive Ability",
  LifeRegen: "Health Regeneration", ManaRegen: "Energy Regeneration",
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
  defensiveAbsorptionModifier: { label: "Absorption", percent: true, sign: 1 },
  defensiveBlockModifier: { label: "Block Chance", percent: true, sign: 1 },
  defensiveBlockAmountModifier: { label: "Shield Damage Blocked", percent: true, sign: 1 },
  defensiveElementalResistance: { label: "Elemental Resistance", percent: true, sign: 1 },
  defensiveTotalSpeedResistance: { label: "Slow Resistance", percent: true, sign: 1 },
  defensivePercentReflectionResistance: { label: "Reflected Damage Reduction", percent: true, sign: 1 },
  defensiveSlowLifeLeach: { label: "Life Leech Resistance", percent: true, sign: 1 },
  defensiveSlowManaLeach: { label: "Energy Leech Resistance", percent: true, sign: 1 },
  defensiveSlowLifeLeachDuration: { label: "Life Leech Duration", percent: true, sign: -1 },

  offensiveTotalDamageModifier: { label: "Total Damage", percent: true, sign: 1 },
  offensiveCritDamageModifier: { label: "Crit Damage", percent: true, sign: 1 },
  offensiveLifeLeechMin: { label: "of Attack Damage converted to Health", percent: true, sign: 1 },
  offensiveSlowManaLeachMin: { label: "Energy Leech", percent: false, sign: 1 },
  offensiveSlowManaLeachChance: { label: "Energy Leech Chance", percent: true, sign: 1 },
  offensiveSlowManaLeachDurationMin: { label: "Energy Leech Duration", percent: false, sign: 1 },
  offensiveElementalResistanceReductionPercentMin: { label: "Reduced target's Elemental Resistance", percent: true, sign: -1 },
  offensiveElementalResistanceReductionPercentDurationMin: { label: "Reduced Elemental Resistance Duration", percent: false, sign: 1 },
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
  characterEnergyAbsorptionPercent: { label: "Energy Absorbed from Skills", percent: true, sign: 1 },
  characterDefensiveBlockRecoveryReduction: { label: "Shield Recovery", percent: true, sign: -1 },
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

function classify(id: string): Classified | null {
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
  // Defensive reduced duration: defensive<Type>Duration
  if ((m = id.match(/^defensive([A-Za-z]+?)Duration$/))) {
    const type = RESIST[m[1]!];
    if (type) return { label: `${type} Duration`, percent: true, sign: -1 };
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

/** Format a single stat id + value into a display row, or null if it is not a stat (weapon token). */
export function statRow(id: string, value: number): StatRow | null {
  const c = classify(id);
  if (!c) return null;
  return { label: c.label, value: fmtValue(value, c.percent, c.sign) };
}

/**
 * Format a bonuses map into sorted display rows. Merges flat <base>Min/<base>Max
 * damage pairs into a single "+min-max" range row, and drops weapon-class tokens.
 */
export function formatBonusRows(bonuses: Record<string, number>): StatRow[] {
  const used = new Set<string>();
  const rows: StatRow[] = [];
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
          rows.push({ label: c.label, value: `+${bonuses[minK]}-${bonuses[maxK]}` });
          continue;
        }
      }
    }
    const r = statRow(k, bonuses[k]!);
    used.add(k);
    if (r) rows.push(r);
  }
  rows.sort((a, b) => a.label.localeCompare(b.label));
  return rows;
}
