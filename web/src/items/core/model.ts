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
  rarity: string;
  itemLevel: number;
  tiers: number[];
  grimtools: string | null;
  boosts: Boost[];
  masteryBoosts: MasteryBoost[];
  modifiers: ModBlock[];
}

export interface Catalogue {
  meta: Record<string, unknown>;
  masteries: Mastery[];
  skills: Skill[];
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
  rarity: string;
  item_level: number;
  tiers: number[];
  grimtools: string | null;
  boosts: RawBoost[];
  mastery_boosts: RawMasteryBoost[];
  modifiers: RawModBlock[];
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
    icon: r.icon,
    maxLevel: r.max_level,
    ultimateLevel: r.ultimate_level,
    ranks: (r.ranks ?? []).map(mapRankRow),
    pets: (r.pets ?? []).map(mapPetBlock),
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
    rarity: r.rarity,
    itemLevel: r.item_level,
    tiers: r.tiers ?? [],
    grimtools: r.grimtools,
    boosts: (r.boosts ?? []).map(mapBoost),
    masteryBoosts: (r.mastery_boosts ?? []).map(mapMasteryBoost),
    modifiers: (r.modifiers ?? []).map(mapModBlock),
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
    items?: RawItem[];
  };
  return {
    meta: d.meta ?? {},
    masteries: Array.isArray(d.masteries) ? d.masteries.map(mapMastery) : [],
    skills: Array.isArray(d.skills) ? d.skills.map(mapSkill) : [],
    items: Array.isArray(d.items) ? d.items.map(mapItem) : [],
  };
}
