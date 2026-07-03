// ABOUTME: Tests for aggregate.ts -- sumBonuses, sumPetBonuses, powersGained, weaponRequirements,
// ABOUTME: starsGranting (bonuses + powers), starsGrantingPet, availableBonusIds, availablePetKeys, availablePowers.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { isFilterableStat } from "../src/core/statFormat";
import {
  sumBonuses,
  sumPetBonuses,
  powersGained,
  starsGranting,
  starsGrantingPet,
  availableBonusIds,
  availablePetKeys,
  availablePowers,
  weaponRequirements,
} from "../src/core/aggregate";
import { enLoc } from "./helpers/localizeEn";

const model = buildModel(doc as any);

const conByName = (name: string) => [...model.constellations.values()].find((c) => enLoc.gameText(c.nameTag) === name)!;
const bonusIdsOf = (starIds: Iterable<string>, skip: Set<string> = new Set()): Set<string> => {
  const out = new Set<string>();
  for (const sid of starIds) if (!skip.has(sid)) for (const k of Object.keys(model.stars.get(sid)!.bonuses)) out.add(k);
  return out;
};

// Filterable power stat ids for a set of stars (mirrors what availableBonusIds now collects).
const filtPowerIdsOf = (starIds: Iterable<string>, skip: Set<string> = new Set()): Set<string> => {
  const out = new Set<string>();
  for (const sid of starIds) {
    if (skip.has(sid)) continue;
    const p = model.stars.get(sid)!.celestialPower;
    if (p) for (const k of Object.keys(p.stats)) if (isFilterableStat(k)) out.add(k);
  }
  return out;
};

// Union of bonus ids and filterable power stat ids for a set of stars.
const availableIdsOf = (starIds: Iterable<string>, skip: Set<string> = new Set()): Set<string> => {
  const ids = [...starIds];
  const out = bonusIdsOf(ids, skip);
  for (const k of filtPowerIdsOf(ids, skip)) out.add(k);
  return out;
};

test("availableBonusIds: union of bonus ids of unselected stars in completable constellations", () => {
  const bat = conByName("Bat");
  const got = availableBonusIds(model, new Set(), new Set([bat.id]));
  expect([...got].sort()).toEqual([...availableIdsOf(bat.starIds)].sort());
});

test("availableBonusIds: skips already-selected stars, keeps the rest of the constellation", () => {
  const bat = conByName("Bat");
  const selected = new Set([bat.starIds[0]!]);
  const got = availableBonusIds(model, selected, new Set([bat.id]));
  expect([...got].sort()).toEqual([...availableIdsOf(bat.starIds, selected)].sort());
});

test("availableBonusIds: ignores constellations not in the completable set", () => {
  const bat = conByName("Bat");
  const crane = conByName("Crane");
  const got = availableBonusIds(model, new Set(), new Set([bat.id]));
  // A bonus id unique to Crane (not granted anywhere in Bat) must not appear.
  const craneOnly = [...bonusIdsOf(crane.starIds)].find((id) => !bonusIdsOf(bat.starIds).has(id));
  expect(craneOnly).toBeTruthy();
  expect(got.has(craneOnly!)).toBe(false);
});

test("availableBonusIds: empty when nothing is completable", () => {
  expect(availableBonusIds(model, new Set(), new Set()).size).toBe(0);
});

test("sumPetBonuses sums 'Bonus to All Pets' stats, separate from player bonuses", () => {
  // Shepherd's Crook's elemental-resistance star: 10% to the player, 15% to pets.
  const con = [...model.constellations.values()].find((c) => enLoc.gameText(c.nameTag) === "Shepherd's Crook")!;
  const star = con.starIds.map((id) => model.stars.get(id)!).find((s) => s.petBonuses?.defensiveElementalResistance)!;
  expect(star.bonuses.defensiveElementalResistance).toBe(10);
  expect(star.petBonuses!.defensiveElementalResistance).toBe(15);
  expect(sumPetBonuses(model, [star.id])).toEqual({ defensiveElementalResistance: 15 });
});

function manualCount(pred: (b: Record<string, number>) => boolean): number {
  let n = 0;
  for (const s of model.stars.values()) if (pred(s.bonuses)) n++;
  return n;
}

test("starsGranting returns exactly the stars whose bonuses include a selected id", () => {
  const got = starsGranting(model, new Set(["characterStrength"]));
  expect(got.size).toBe(manualCount((b) => "characterStrength" in b));
  for (const id of got) expect("characterStrength" in model.stars.get(id)!.bonuses).toBe(true);
});

test("starsGranting unions multiple ids and is empty for an empty set", () => {
  const got = starsGranting(model, new Set(["characterStrength", "characterIntelligence"]));
  expect(got.size).toBe(manualCount((b) => "characterStrength" in b || "characterIntelligence" in b));
  expect(starsGranting(model, new Set()).size).toBe(0);
});

test("starsGranting matches a star whose celestial power grants the stat", () => {
  const bonusIds = new Set<string>();
  for (const s of model.stars.values()) for (const k of Object.keys(s.bonuses)) bonusIds.add(k);
  let powerStarId: string | undefined;
  let powerOnlyId: string | undefined;
  for (const s of model.stars.values()) {
    const p = s.celestialPower;
    if (!p) continue;
    const k = Object.keys(p.stats).find((key) => !bonusIds.has(key));
    if (k) {
      powerStarId = s.id;
      powerOnlyId = k;
      break;
    }
  }
  expect(powerOnlyId).toBeTruthy();
  const got = starsGranting(model, new Set([powerOnlyId!]));
  expect(got.has(powerStarId!)).toBe(true);
});

test("starsGranting ignores summon-pet attack stats", () => {
  let petPowerStarId: string | undefined;
  let attackOnlyId: string | undefined;
  for (const s of model.stars.values()) {
    const p = s.celestialPower;
    if (!p?.pet) continue;
    const k = Object.keys(p.pet.attackStats).find((key) => !(key in p.stats) && !(key in s.bonuses));
    if (k) {
      petPowerStarId = s.id;
      attackOnlyId = k;
      break;
    }
  }
  expect(attackOnlyId).toBeTruthy();
  // The pet-summoning star itself must NOT match on a stat only its pet's attack carries.
  expect(starsGranting(model, new Set([attackOnlyId!])).has(petPowerStarId!)).toBe(false);
});

test("sums like stat ids additively across stars", () => {
  // bat:0 offensiveLifeModifier=15, bat:2 offensiveLifeModifier=24 -> 39
  const totals = sumBonuses(model, new Set(["bat:0", "bat:2"]));
  expect(totals.offensiveLifeModifier).toBe(39);
  expect(totals.offensiveSlowBleedingModifier).toBe(65); // 15 + 50
});

test("collects celestial powers with their star ids", () => {
  const powers = powersGained(model, new Set(["bat:4"]));
  expect(powers.map((p) => enLoc.gameText(p.power.nameTag))).toContain("Twin Fangs");
  expect(powers[0]!.power.descriptionTag).toBeTruthy();
  expect(enLoc.gameText(powers[0]!.power.descriptionTag!)).toBeTruthy();
  expect(powers[0]!.starId).toBe("bat:4");
});

test("starsGrantingPet returns exactly the stars whose petBonuses include an id", () => {
  const petStar = [...model.stars.values()].find((s) => s.petBonuses && Object.keys(s.petBonuses).length > 0)!;
  const id = Object.keys(petStar.petBonuses!)[0]!;
  let n = 0;
  for (const s of model.stars.values()) if (s.petBonuses && id in s.petBonuses) n++;
  const got = starsGrantingPet(model, new Set([id]));
  expect(got.size).toBe(n);
  for (const sid of got) expect(id in model.stars.get(sid)!.petBonuses!).toBe(true);
  expect(starsGrantingPet(model, new Set()).size).toBe(0);
});

const conWithPet = () =>
  [...model.constellations.values()].find((c) =>
    c.starIds.some((id) => {
      const p = model.stars.get(id)?.petBonuses;
      return p && Object.keys(p).length > 0;
    }),
  )!;

test("availablePetKeys returns pet: keys for unselected stars' petBonuses in completable cons", () => {
  const con = conWithPet();
  const expected = new Set<string>();
  for (const sid of con.starIds) {
    const p = model.stars.get(sid)?.petBonuses;
    if (p) for (const k of Object.keys(p)) expected.add(`pet:${k}`);
  }
  const got = availablePetKeys(model, new Set(), new Set([con.id]));
  expect([...got].sort()).toEqual([...expected].sort());
  expect(availablePetKeys(model, new Set(), new Set()).size).toBe(0);
});

test("availablePetKeys skips already-selected stars", () => {
  const con = conWithPet();
  expect(availablePetKeys(model, new Set(con.starIds), new Set([con.id])).size).toBe(0);
});

test("availableBonusIds includes recognized power stats of unselected stars in completable cons", () => {
  // Find a constellation whose power grants a recognized stat that no star bonus in that con grants.
  let conId: string | undefined;
  let powerStat: string | undefined;
  for (const c of model.constellations.values()) {
    const bonusIds = bonusIdsOf(c.starIds);
    for (const sid of c.starIds) {
      const p = model.stars.get(sid)!.celestialPower;
      if (!p) continue;
      const k = Object.keys(p.stats).find(
        (key) => !bonusIds.has(key) && /^offensive|^defensive|^character|^retaliation/.test(key),
      );
      if (k) {
        conId = c.id;
        powerStat = k;
        break;
      }
    }
    if (conId) break;
  }
  expect(powerStat).toBeTruthy();
  const got = availableBonusIds(model, new Set(), new Set([conId!]));
  expect(got.has(powerStat!)).toBe(true);
});

test("availablePowers lists completable, not-yet-gained powers and excludes gained ones", () => {
  const bat = conByName("Bat");
  const powerStar = bat.starIds.map((id) => model.stars.get(id)!).find((s) => s.celestialPower)!;
  // Not selected -> listed.
  const avail = availablePowers(model, new Set(), new Set([bat.id]));
  expect(avail.map((p) => p.starId)).toContain(powerStar.id);
  expect(enLoc.gameText(avail.find((p) => p.starId === powerStar.id)!.power.nameTag)).toBe(
    enLoc.gameText(powerStar.celestialPower!.nameTag),
  );
  // Power star selected (gained) -> excluded.
  const gained = availablePowers(model, new Set([powerStar.id]), new Set([bat.id]));
  expect(gained.map((p) => p.starId)).not.toContain(powerStar.id);
  // Not completable -> excluded.
  expect(availablePowers(model, new Set(), new Set()).length).toBe(0);
});

test("weaponRequirements carries each gated star's description", () => {
  const reqs = weaponRequirements(model, new Set(["kraken:0"]));
  expect(reqs).toHaveLength(1);
  expect(enLoc.gameText(reqs[0]!.descriptionTag!)).toBe("Requires a two-handed melee or two-handed ranged weapon.");
});
