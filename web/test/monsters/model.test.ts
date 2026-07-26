// ABOUTME: Tests for the monster model: parsing, difficulty offsets, and aura inclusion.
// ABOUTME: These pin the effective-resistance formula the whole page depends on.
import { test, expect } from "bun:test";
import {
  parseMonsters,
  offsetFor,
  effective,
  sameOffsets,
  type Monster,
  type Resistances,
} from "../../src/monsters/core/model";
import { DAMAGE_TYPES } from "../../src/monsters/core/facets";

const ZERO = Object.fromEntries(DAMAGE_TYPES.map((t) => [t, 0]));

function mon(over: Partial<Monster> = {}): Monster {
  return {
    id: "enemies.x",
    nameTag: "tagX",
    classification: "Hero",
    role: "hero",
    raceTag: null,
    minLevel: 1,
    maxLevel: 100,
    isSummon: false,
    variantCount: 1,
    variantsDisagree: false,
    resistances: { ...ZERO },
    passive: {},
    aura: {},
    ...over,
  } as Monster;
}

const DOC = {
  meta: { game_version: "1.3.0.0" },
  monsters: [
    {
      id: "enemies.a",
      name_tag: "tagA",
      classification: "Hero",
      role: "hero",
      race_tag: "tagRace005",
      min_level: 1,
      max_level: 100,
      is_summon: false,
      variant_count: 2,
      variants_disagree: true,
      resistances: { ...ZERO, fire: 30, bleeding: 80 },
      passive_resistances: { bleeding: 80 },
      aura_resistances: { cold: 20 },
    },
  ],
  difficulty_offsets: {
    ultimate: { "1": { ...ZERO, fire: 8, cold: 5 }, "4": { ...ZERO, fire: 15, cold: 12 } },
    normal: { "1": { ...ZERO } },
  },
};

test("parseMonsters maps snake_case to camelCase and defaults the sparse objects", () => {
  const doc = parseMonsters(DOC);
  expect(doc.monsters).toHaveLength(1);
  const m = doc.monsters[0]!;
  expect(m.nameTag).toBe("tagA");
  expect(m.raceTag).toBe("tagRace005");
  expect(m.variantsDisagree).toBe(true);
  expect(m.passive).toEqual({ bleeding: 80 });
  expect(m.aura).toEqual({ cold: 20 });
  expect(doc.meta.game_version).toBe("1.3.0.0");
});

test("a monster with no provenance gets empty objects, not undefined", () => {
  const doc = parseMonsters({
    ...DOC,
    monsters: [{ ...DOC.monsters[0], passive_resistances: undefined, aura_resistances: undefined }],
  });
  expect(doc.monsters[0]!.passive).toEqual({});
  expect(doc.monsters[0]!.aura).toEqual({});
});

test("parseMonsters throws on a non-object, and on a doc with no monsters array", () => {
  expect(() => parseMonsters(null)).toThrow();
  expect(() => parseMonsters({ meta: {} })).toThrow();
});

test("parseMonsters throws naming the row id and key when a resistance is missing", () => {
  const { fire: _omit, ...missingFire } = DOC.monsters[0]!.resistances;
  const doc = { ...DOC, monsters: [{ ...DOC.monsters[0], id: "enemies.badrow", resistances: missingFire }] };
  expect(() => parseMonsters(doc)).toThrow(/enemies\.badrow/);
  expect(() => parseMonsters(doc)).toThrow(/fire/);
});

test("parseMonsters throws when a resistance value is not a finite number", () => {
  const bad = { ...DOC.monsters[0], id: "enemies.badval", resistances: { ...ZERO, fire: Number.NaN } };
  expect(() => parseMonsters({ ...DOC, monsters: [bad] })).toThrow(/enemies\.badval/);
  const stringy = { ...DOC.monsters[0], id: "enemies.badval2", resistances: { ...ZERO, fire: "30" } };
  expect(() => parseMonsters({ ...DOC, monsters: [stringy] })).toThrow(/enemies\.badval2/);
});

test("a fully valid row parses without throwing", () => {
  expect(() => parseMonsters(DOC)).not.toThrow();
});

test("offsetFor selects the difficulty and player bracket", () => {
  const doc = parseMonsters(DOC);
  expect(offsetFor(doc, "ultimate", "1").fire).toBe(8);
  expect(offsetFor(doc, "ultimate", "4").fire).toBe(15);
  expect(offsetFor(doc, "normal", "1").fire).toBe(0);
});

test("offsetFor falls back to all-zero for a difficulty or bracket the data lacks", () => {
  const doc = parseMonsters(DOC);
  expect(offsetFor(doc, "elite", "1")).toEqual(ZERO as Resistances);
  expect(offsetFor(doc, "normal", "3")).toEqual(ZERO as Resistances);
});

test("effective adds the offset to the base for every type", () => {
  const off = { ...ZERO, fire: 8, cold: 5 } as Resistances;
  const e = effective(mon({ resistances: { ...ZERO, fire: 30 } as Monster["resistances"] }), off, false);
  expect(e.fire).toBe(38);
  expect(e.cold).toBe(5);
});

test("effective excludes auras by default and includes them when asked", () => {
  const m = mon({ resistances: { ...ZERO, cold: 10 } as Monster["resistances"], aura: { cold: 20 } });
  expect(effective(m, ZERO as Resistances, false).cold).toBe(10);
  expect(effective(m, ZERO as Resistances, true).cold).toBe(30);
});

test("including auras stacks with the difficulty offset", () => {
  const m = mon({ resistances: { ...ZERO, cold: 10 } as Monster["resistances"], aura: { cold: 20 } });
  expect(effective(m, { ...ZERO, cold: 5 } as Resistances, true).cold).toBe(35);
});

test("effective always returns all ten keys in the canonical order", () => {
  // Feed a monster whose own resistance keys are in a deliberately scrambled order. If
  // `effective` derived its output order from the input object instead of enumerating
  // DAMAGE_TYPES, this would come back scrambled too. A fixture built from DAMAGE_TYPES
  // cannot catch that, because its order already coincides with the canonical one.
  const scrambled = Object.fromEntries([...DAMAGE_TYPES].reverse().map((t) => [t, 0])) as Resistances;
  expect(Object.keys(scrambled)).not.toEqual([...DAMAGE_TYPES]);
  const out = effective(mon({ resistances: scrambled }), ZERO as Resistances, false);
  expect(Object.keys(out)).toEqual([...DAMAGE_TYPES]);
});

test("offsetFor reads the ascendant block", () => {
  const doc = parseMonsters({
    monsters: [],
    difficulty_offsets: { ascendant: { "1": { fire: 12, cold: 3 } } },
  });
  expect(offsetFor(doc, "ascendant", "1").fire).toBe(12);
  expect(offsetFor(doc, "ascendant", "1").cold).toBe(3);
});

test("sameOffsets is true only when every type matches", () => {
  const base = Object.fromEntries(DAMAGE_TYPES.map((t) => [t, 5])) as Resistances;
  expect(sameOffsets(base, { ...base })).toBe(true);
  // The differing type is the last in the list, so an implementation comparing
  // only the first few still fails here.
  expect(sameOffsets(base, { ...base, bleeding: 6 })).toBe(false);
  // Equal totals, different rows: a sum-based comparison would wrongly pass.
  expect(sameOffsets(base, { ...base, fire: 4, cold: 6 })).toBe(false);
});
