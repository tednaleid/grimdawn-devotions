// ABOUTME: parseCatalogue for data/skill-items.json, mapping the committed snake_case JSON to camelCase.
// ABOUTME: Pure; tolerates a missing/short doc and only throws when the doc is not an object.
import type { ModStat } from "./effectText";

export interface Mastery {
  record: string;
  nameTag: string;
}

export interface RankRow {
  stat: string;
  first: number;
  max: number;
  ultimate: number;
}

export interface PetStat {
  sourceKind: "pet" | "pet_skill";
  source: string;
  sourceNameTag: string | null;
  stat: string;
  first: number;
  max: number;
  ultimate: number;
}

export interface PetBlock {
  record: string;
  nameTag: string;
  stats: PetStat[];
}

export interface Skill {
  record: string;
  mastery: string;
  group: string;
  nodeKind: "base" | "modifier" | "transmuter" | "pet_modifier";
  uiX: number | null;
  uiY: number | null;
  nameTag: string | null;
  // The skill's own prose, the paragraph the game opens its tooltip with. Present on every
  // skill today; typed nullable because it is a game field, not one this page controls.
  descriptionTag: string | null;
  icon: string;
  maxLevel: number;
  ultimateLevel: number;
  ranks: RankRow[];
  pets: PetBlock[];
}

export interface Boost {
  skill: string;
  level: number;
}

/** A set's own contribution, and the piece count that turns it on. A set bonus is not the item's:
 *  the player only has it while wearing `pieces` members, so it is kept apart everywhere rather
 *  than folded into the item's own boosts and modifiers. */
export interface SetModBlock {
  pieces: number;
  skill: string;
  stats: ModStat[];
}

export interface SetBoost {
  pieces: number;
  skill: string;
  level: number;
}

export interface SetMasteryBoost {
  pieces: number;
  mastery: string;
  level: number;
}

/** One loot set, stored once on the catalogue rather than copied onto each of its members. */
export interface ItemSet {
  record: string;
  nameTag: string;
  // How many pieces the set has, from the set's own setMembers list. Not the same number as a
  // bonus's `pieces`, which is the count that bonus needs.
  members: number;
  modifiers: SetModBlock[];
  boosts: SetBoost[];
  masteryBoosts: SetMasteryBoost[];
}

export interface MasteryBoost {
  mastery: string;
  level: number;
}

// ModStat's stats pass through RAW (snake_case), not mapped here - see the module comment
// on ModBlock below.
export interface ModBlock {
  skill: string;
  stats: ModStat[];
}

export interface Item {
  record: string;
  nameTag: string | null;
  domain: "gear" | "relic";
  slots: string[];
  // The item's gear class (sword2h, dagger, head, ...). `slots` cannot tell a one-handed
  // weapon from a two-handed one - every weapon carries the same pair - so this is what the
  // page's category facet is built from. See core/facets.ts.
  gearType: string;
  rarity: string;
  itemLevel: number;
  tiers: number[];
  grimtools: string | null;
  boosts: Boost[];
  masteryBoosts: MasteryBoost[];
  modifiers: ModBlock[];
  // The record of the set this piece belongs to, or null. Resolve it through Catalogue.sets;
  // an item can name a set the catalogue does not carry (one with no skill wiring of its own).
  set: string | null;
}

export interface Catalogue {
  meta: Record<string, unknown>;
  masteries: Mastery[];
  skills: Skill[];
  sets: ItemSet[];
  items: Item[];
}

interface RawMastery {
  record: string;
  name_tag: string;
}

interface RawRankRow {
  stat: string;
  first: number;
  max: number;
  ultimate: number;
}

interface RawPetStat {
  source_kind: "pet" | "pet_skill";
  source: string;
  source_name_tag: string | null;
  stat: string;
  first: number;
  max: number;
  ultimate: number;
}

interface RawPetBlock {
  record: string;
  name_tag: string;
  stats: RawPetStat[];
}

interface RawSkill {
  record: string;
  mastery: string;
  group: string;
  node_kind: "base" | "modifier" | "transmuter" | "pet_modifier";
  ui_x: number | null;
  ui_y: number | null;
  name_tag: string | null;
  description_tag: string | null;
  icon: string;
  max_level: number;
  ultimate_level: number;
  ranks: RawRankRow[];
  pets: RawPetBlock[];
}

interface RawBoost {
  skill: string;
  level: number;
}

interface RawSetModBlock {
  pieces: number;
  skill: string;
  stats: ModStat[];
}

interface RawSet {
  record: string;
  name_tag: string;
  members: number;
  modifiers: RawSetModBlock[];
  boosts: { pieces: number; skill: string; level: number }[];
  mastery_boosts: { pieces: number; mastery: string; level: number }[];
}

interface RawMasteryBoost {
  mastery: string;
  level: number;
}

// RawModBlock.stats is ModStat, not a raw shape: those four fields stay snake_case all
// the way through, see the ModBlock comment above.
interface RawModBlock {
  skill: string;
  stats: ModStat[];
}

interface RawItem {
  record: string;
  name_tag: string | null;
  domain: "gear" | "relic";
  slots: string[];
  gear_type: string;
  rarity: string;
  item_level: number;
  tiers: number[];
  grimtools: string | null;
  boosts: RawBoost[];
  mastery_boosts: RawMasteryBoost[];
  modifiers: RawModBlock[];
  set: string | null;
}

function mapMastery(r: RawMastery): Mastery {
  return { record: r.record, nameTag: r.name_tag };
}

function mapRankRow(r: RawRankRow): RankRow {
  return { stat: r.stat, first: r.first, max: r.max, ultimate: r.ultimate };
}

function mapPetStat(r: RawPetStat): PetStat {
  return {
    sourceKind: r.source_kind,
    source: r.source,
    sourceNameTag: r.source_name_tag,
    stat: r.stat,
    first: r.first,
    max: r.max,
    ultimate: r.ultimate,
  };
}

function mapPetBlock(r: RawPetBlock): PetBlock {
  return { record: r.record, nameTag: r.name_tag, stats: (r.stats ?? []).map(mapPetStat) };
}

function mapSkill(r: RawSkill): Skill {
  return {
    record: r.record,
    mastery: r.mastery,
    group: r.group,
    nodeKind: r.node_kind,
    uiX: r.ui_x,
    uiY: r.ui_y,
    nameTag: r.name_tag,
    descriptionTag: r.description_tag ?? null,
    icon: r.icon,
    maxLevel: r.max_level,
    ultimateLevel: r.ultimate_level,
    ranks: (r.ranks ?? []).map(mapRankRow),
    pets: (r.pets ?? []).map(mapPetBlock),
  };
}

function mapSet(r: RawSet): ItemSet {
  return {
    record: r.record,
    nameTag: r.name_tag,
    members: r.members ?? 0,
    modifiers: (r.modifiers ?? []).map((m) => ({
      pieces: m.pieces,
      skill: m.skill,
      stats: m.stats ?? [],
    })),
    boosts: (r.boosts ?? []).map((b) => ({ pieces: b.pieces, skill: b.skill, level: b.level })),
    masteryBoosts: (r.mastery_boosts ?? []).map((b) => ({
      pieces: b.pieces,
      mastery: b.mastery,
      level: b.level,
    })),
  };
}

function mapBoost(r: RawBoost): Boost {
  return { skill: r.skill, level: r.level };
}

function mapMasteryBoost(r: RawMasteryBoost): MasteryBoost {
  return { mastery: r.mastery, level: r.level };
}

// Leaves stats untouched in their raw snake_case shape - the one documented exception
// to camelCase-out. See the ModBlock comment above and effectText.ts's ModStat.
function mapModBlock(r: RawModBlock): ModBlock {
  return { skill: r.skill, stats: r.stats ?? [] };
}

function mapItem(r: RawItem): Item {
  return {
    record: r.record,
    nameTag: r.name_tag,
    domain: r.domain,
    slots: r.slots ?? [],
    gearType: r.gear_type ?? "",
    rarity: r.rarity,
    itemLevel: r.item_level,
    tiers: r.tiers ?? [],
    grimtools: r.grimtools,
    boosts: (r.boosts ?? []).map(mapBoost),
    masteryBoosts: (r.mastery_boosts ?? []).map(mapMasteryBoost),
    modifiers: (r.modifiers ?? []).map(mapModBlock),
    set: r.set ?? null,
  };
}

/** Parse the `{meta, masteries, skills, items}` catalogue doc into camelCase. Throws only on a non-object. */
export function parseCatalogue(doc: unknown): Catalogue {
  if (typeof doc !== "object" || doc === null) {
    throw new Error("skill-items catalogue must be an object");
  }
  const d = doc as {
    meta?: Record<string, unknown>;
    masteries?: RawMastery[];
    skills?: RawSkill[];
    sets?: RawSet[];
    items?: RawItem[];
  };
  return {
    meta: d.meta ?? {},
    masteries: Array.isArray(d.masteries) ? d.masteries.map(mapMastery) : [],
    skills: Array.isArray(d.skills) ? d.skills.map(mapSkill) : [],
    sets: Array.isArray(d.sets) ? d.sets.map(mapSet) : [],
    items: Array.isArray(d.items) ? d.items.map(mapItem) : [],
  };
}
