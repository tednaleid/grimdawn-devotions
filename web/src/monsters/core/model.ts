// ABOUTME: The Monster type, the monsters.json parse, and the effective-resistance transforms.
// ABOUTME: Pure and locale-independent: names stay as tags here and resolve in the adapters.
import { DAMAGE_TYPES, type DamageType, type Difficulty } from "./facets";

export type { DamageType, Difficulty };

export type Resistances = Record<DamageType, number>;

/** One logical monster as emitted by scripts/parse_monsters.py, in camelCase. */
export interface Monster {
  id: string;
  nameTag: string;
  classification: string;
  role: string;
  raceTag: string | null;
  minLevel: number;
  maxLevel: number;
  isSummon: boolean;
  variantCount: number;
  variantsDisagree: boolean;
  /** Inline plus resident passives, as shipped. Always carries all ten keys. */
  resistances: Resistances;
  /** Sparse: only the types a passive skill contributed to. */
  passive: Partial<Resistances>;
  /** Sparse: aura grants, deliberately NOT included in `resistances`. */
  aura: Partial<Resistances>;
}

export interface MonsterDoc {
  meta: Record<string, unknown>;
  monsters: Monster[];
  offsets: Record<string, Record<string, Partial<Resistances>>>;
}

interface RawMonster {
  id: string;
  name_tag: string;
  classification: string;
  role: string;
  race_tag: string | null;
  min_level: number;
  max_level: number;
  is_summon: boolean;
  variant_count: number;
  variants_disagree: boolean;
  resistances: Resistances;
  passive_resistances?: Partial<Resistances>;
  aura_resistances?: Partial<Resistances>;
}

function mapMonster(r: RawMonster): Monster {
  return {
    id: r.id,
    nameTag: r.name_tag,
    classification: r.classification,
    role: r.role,
    raceTag: r.race_tag ?? null,
    minLevel: r.min_level ?? 0,
    maxLevel: r.max_level ?? 0,
    isSummon: r.is_summon ?? false,
    variantCount: r.variant_count ?? 1,
    variantsDisagree: r.variants_disagree ?? false,
    resistances: r.resistances,
    // Sparse by contract: absent means "nothing granted", which is an empty object here
    // so every consumer can index it without a null check.
    passive: r.passive_resistances ?? {},
    aura: r.aura_resistances ?? {},
  };
}

/** Every row must carry all ten resistance keys as finite numbers, or `effective()` silently
 *  computes `undefined + offset = NaN`, which renders as the literal string "NaN" in a cell and
 *  poisons every mean/median that row feeds into.
 */
function validateResistances(id: unknown, resistances: unknown): void {
  const rowId = typeof id === "string" ? id : "<unknown id>";
  if (typeof resistances !== "object" || resistances === null) {
    throw new Error(`monster ${rowId}: resistances must be an object`);
  }
  const r = resistances as Record<string, unknown>;
  for (const type of DAMAGE_TYPES) {
    const v = r[type];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`monster ${rowId}: resistances.${type} must be a finite number, got ${JSON.stringify(v)}`);
    }
  }
}

/** Parse the `{meta, monsters, difficulty_offsets}` doc.
 *
 *  Throws when the document is not an object, carries no monsters array, or a row is missing
 *  one of the ten resistance keys. A dataset that parses but is structurally wrong should fail
 *  loudly at load rather than render blank (NaN) cells.
 */
export function parseMonsters(doc: unknown): MonsterDoc {
  if (typeof doc !== "object" || doc === null) {
    throw new Error("monsters doc must be an object");
  }
  const d = doc as {
    meta?: Record<string, unknown>;
    monsters?: RawMonster[];
    difficulty_offsets?: Record<string, Record<string, Partial<Resistances>>>;
  };
  if (!Array.isArray(d.monsters)) {
    throw new Error("monsters doc must carry a monsters array");
  }
  for (const raw of d.monsters) validateResistances(raw?.id, raw?.resistances);
  return {
    meta: d.meta ?? {},
    monsters: d.monsters.map(mapMonster),
    offsets: d.difficulty_offsets ?? {},
  };
}

const ZERO_OFFSETS: Resistances = Object.fromEntries(DAMAGE_TYPES.map((t) => [t, 0])) as Resistances;

/** The flat global offset for a difficulty and player count, all-zero when the data lacks it.
 *
 *  A missing bracket is not an error: Normal at three players is simply absent in some
 *  datasets, and reporting the base value is more useful than refusing to render.
 */
export function offsetFor(doc: MonsterDoc, difficulty: Difficulty, players: string): Resistances {
  const raw = doc.offsets[difficulty]?.[players];
  if (!raw) return { ...ZERO_OFFSETS };
  return Object.fromEntries(DAMAGE_TYPES.map((t) => [t, raw[t] ?? 0])) as Resistances;
}

/** Whether two offset rows impose identical values across all ten types.
 *
 *  Lets the page state that two difficulties are equivalent only while the data says so.
 *  Nothing asserts that equivalence in app code: if a patch makes the rows diverge this
 *  returns false and the claim stops being rendered.
 */
export function sameOffsets(a: Resistances, b: Resistances): boolean {
  return DAMAGE_TYPES.every((t) => a[t] === b[t]);
}

/** What a player actually faces: base plus offset, plus aura grants when included.
 *
 *  Always returns all ten keys in canonical order so callers can index without checking.
 */
export function effective(m: Monster, offsets: Resistances, includeAuras: boolean): Resistances {
  return Object.fromEntries(
    DAMAGE_TYPES.map((t) => [t, m.resistances[t] + offsets[t] + (includeAuras ? (m.aura[t] ?? 0) : 0)]),
  ) as Resistances;
}
