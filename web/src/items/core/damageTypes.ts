// ABOUTME: Which damage type a rendered effect line is about, decided from the line's game TAG.
// ABOUTME: Tag-anchored, never word-matched: the type noun is declined in some locales and absent in others.
/** The ten damage types, in the monster page's order and sharing its palette (the `--t-*` custom
 *  properties). `elemental` is an eleventh label the game uses for the fire/cold/lightning trio;
 *  it has no hue of its own and borrows the page's ember. */
export const DAMAGE_TYPES = [
  "physical",
  "pierce",
  "fire",
  "cold",
  "lightning",
  "poison",
  "aether",
  "chaos",
  "vitality",
  "bleeding",
  "elemental",
] as const;

export type DamageType = (typeof DAMAGE_TYPES)[number];

// The game's own spellings, matched as substrings of a tag NAME. GD's `Poison` covers what the
// game shows as both Acid and Poison, which is also how the monster page's single `poison` column
// works. Longest-first, so `Lightning` is tried before nothing shorter can shadow it.
//
// `Life` is deliberately NOT here. In tag names it usually means HEALTH ("Health Restored",
// "Health Regenerated per second", "Reduction to Enemy's Health", "Life Leech Resistance"), and
// only rarely the player-facing Vitality damage type; a substring rule painted seven healing and
// health tags purple. The handful that really are Vitality are listed below instead.
// `Piercing` is likewise absent: it appears in `ProjectilePiercingChance` ("Chance to pass
// through Enemies"), which is about projectiles, not pierce damage. The real pierce tags all
// carry the shorter `Pierce`.
const TOKENS: [string, DamageType][] = [
  ["Elemental", "elemental"],
  ["Lightning", "lightning"],
  ["Bleeding", "bleeding"],
  ["Physical", "physical"],
  ["Vitality", "vitality"],
  ["Aether", "aether"],
  ["Chaos", "chaos"],
  ["Poison", "poison"],
  ["Pierce", "pierce"],
  // The conversion line names its types through tagCharStats*, where the game spells its
  // internal Poison as the player-facing Acid.
  ["Acid", "poison"],
  ["Fire", "fire"],
  ["Cold", "cold"],
];

// The tags whose `Life` is the Vitality damage type rather than health. Enumerated because the
// game's own naming does not separate the two: `DamageLife` is "Vitality Damage" and
// `DamagePercentCurrentLife` is "Reduction to Enemy's Health", and no rule over the name tells
// them apart.
const VITALITY_TAGS = new Set([
  "DamageLife",
  "DamageDurationLife",
  "DamageModifierLife",
  "DamageDurationModifierLife",
  "DefenseLife",
  "RetaliationLife",
  "RetaliationModifierLife",
  "RetaliationDurationLife",
  "DefenseLifeDuration",
  "DefenseLifeMaxResist",
]);

/** Tags whose name carries a damage token but whose LINE is not about that damage type. Each is
 *  here because the token is doing different work in the name, and colouring the line by it would
 *  misdescribe the number. Declared rather than left to a rule, so a game patch adding another of
 *  the same shape fails the guard test instead of quietly picking up a colour - the same
 *  "declare it or fail" rule build_stat_item_tags.py applies to a stat with no label. */
export const DECLARED_NOT_DAMAGE = new Set([
  // Leech: "X% of Attack Damage converted to Health", and the resistance to it. The Life in the
  // name is the health moved, not a damage type.
  "DamageLifeLeech",
  "DamageDurationLifeLeech",
  "RetaliationLifeLeech",
  "RetaliationDurationLifeLeech",
  "DefenseLifeLeach",
  // Health itself: restored, regenerated, or reduced. None of these is Vitality damage.
  "SkillLifeBonus",
  "SkillLifePercent",
  "tagCharLifeRegen",
  "tagCharLifeRegenModifier",
  "DamagePercentCurrentLife",
  "DefensePercentCurrentLife",
  "LifeMonitorPercent",
]);

/** The damage type a line built from `tag` is about, or null when it is about something else.
 *
 *  Decided from the tag NAME, never from the rendered words. Two reasons the words cannot do it:
 *  Russian declines the nouns (Fire resolves to "огнём", Vitality to "уроном здоровью"), so a
 *  substring search finds nothing; and half of these lines never contain the type at all - the
 *  fire damage-over-time tag renders "Burn Damage", cold renders "Frostburn", lightning renders
 *  "Electrocute". The tag name is stable, locale-free, and right in all of those cases. */
export function damageTypeOfTag(tag: string): DamageType | null {
  if (DECLARED_NOT_DAMAGE.has(tag)) return null;
  if (VITALITY_TAGS.has(tag)) return "vitality";
  for (const [token, type] of TOKENS) if (tag.includes(token)) return type;
  return null;
}

/** True when a tag's name carries a damage token at all, whatever this module decides about it.
 *  The guard test uses this to catch a game patch adding a tag that looks like a damage line but
 *  is not classified - the same "declare it or fail" rule build_stat_item_tags.py applies to a
 *  stat with no label. `Life` is in this check even though it is not a colouring token, since a
 *  new `Life` tag is exactly the case that needs a human to look. */
export function namesADamageToken(tag: string): boolean {
  return tag.includes("Life") || TOKENS.some(([token]) => tag.includes(token));
}
