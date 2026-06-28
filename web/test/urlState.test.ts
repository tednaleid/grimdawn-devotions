// ABOUTME: Round-trip + tolerance tests for the URL state codec (point cap + selected stars bitset).
import { test, expect } from "bun:test";
import type { StarId } from "../src/core/types";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import {
  canonicalStarIds,
  canonicalStatIds,
  canonicalBenefitIds,
  canonicalPowerStatIds,
  encodeHash,
  decodeHash,
} from "../src/core/urlState";

const model = buildModel(doc as any);
const canonical = canonicalStarIds(model);
const statCanonical = canonicalStatIds(model);

test("canonical ordering covers every star exactly once", () => {
  expect(canonical.length).toBe(model.stars.size);
  expect(new Set(canonical).size).toBe(canonical.length);
});

test("round-trips a selection and point cap", () => {
  const selected = new Set([canonical[0]!, canonical[5]!, canonical[200]!, canonical[canonical.length - 1]!]);
  const decoded = decodeHash(`#${encodeHash(selected, 42, canonical)}`, canonical)!;
  expect(decoded.pointCap).toBe(42);
  expect([...decoded.selected].sort()).toEqual([...selected].sort());
});

test("empty selection encodes to an empty bitset and round-trips", () => {
  const hash = encodeHash(new Set(), 55, canonical);
  expect(hash).toBe("p=55&s=");
  const decoded = decodeHash(`#${hash}`, canonical)!;
  expect(decoded.selected.size).toBe(0);
  expect(decoded.pointCap).toBe(55);
});

test("round-trips selected benefit tags via the b= param", () => {
  const benefits = new Set([statCanonical[0]!, statCanonical[3]!, statCanonical[statCanonical.length - 1]!]);
  const hash = encodeHash(new Set([canonical[0]!]), 30, canonical, benefits, statCanonical);
  expect(hash).toContain("&b=");
  const decoded = decodeHash(`#${hash}`, canonical, statCanonical)!;
  expect([...decoded.benefits].sort()).toEqual([...benefits].sort());
});

test("omits b= when no benefits are selected and decodes to an empty set", () => {
  const hash = encodeHash(new Set(), 55, canonical, new Set(), statCanonical);
  expect(hash).toBe("p=55&s=");
  expect(decodeHash(`#${hash}`, canonical, statCanonical)!.benefits.size).toBe(0);
});

test("returns null when there is nothing to decode", () => {
  expect(decodeHash("", canonical)).toBeNull();
  expect(decodeHash("#", canonical)).toBeNull();
  expect(decodeHash("#garbage", canonical)).toBeNull();
});

test("tolerates a malformed bitset and clamps the cap", () => {
  const decoded = decodeHash("#p=9999&s=@@@not-base64@@@", canonical)!;
  expect(decoded.selected.size).toBe(0);
  expect(decoded.pointCap).toBe(55); // clamped to the max
});

test("clamps a too-small (but nonzero) cap to the minimum", () => {
  expect(decodeHash("#p=-3&s=", canonical)!.pointCap).toBe(1);
});

test("encodes an uncapped (Infinity) cap as the p=0 sentinel and round-trips it", () => {
  const hash = encodeHash(new Set(), Infinity, canonical);
  expect(hash).toBe("p=0&s=");
  expect(decodeHash(`#${hash}`, canonical)!.pointCap).toBe(Infinity);
});

test("canonicalBenefitIds is player ids, then pet: ids, then 10 aff: ids, then power-stat ids", () => {
  const player = canonicalStatIds(model);
  const all = canonicalBenefitIds(model);
  expect(all.slice(0, player.length)).toEqual(player);
  // aff: block is 10 entries; find it by its first index
  const affStart = all.findIndex((k) => k.startsWith("aff:"));
  const affBlock = all.slice(affStart, affStart + 10);
  expect(affBlock.every((k) => k.startsWith("aff:"))).toBe(true);
  expect(affBlock).toContain("aff:grant:eldritch");
  expect(affBlock).toContain("aff:req:eldritch");
  // pet: ids sit between the player block and the aff: block
  const middle = all.slice(player.length, affStart);
  expect(middle.length).toBeGreaterThan(0);
  expect(middle.every((k) => k.startsWith("pet:"))).toBe(true);
  // power-stat ids are appended last, after the aff: block
  const powerBlock = all.slice(affStart + 10);
  expect(powerBlock.length).toBeGreaterThan(0);
  expect(powerBlock.every((k) => !k.startsWith("aff:") && !k.startsWith("pet:"))).toBe(true);
});

test("affinity tags round-trip via b=", () => {
  const benefitCanonical = canonicalBenefitIds(model);
  const benefits = new Set(["aff:grant:eldritch", "aff:req:chaos"]);
  const hash = encodeHash(new Set([canonical[0]!]), 30, canonical, benefits, benefitCanonical);
  const decoded = decodeHash(`#${hash}`, canonical, benefitCanonical)!;
  expect([...decoded.benefits].sort()).toEqual([...benefits].sort());
});

test("an old player-only b= payload still decodes under the extended canonical", () => {
  const benefits = new Set([statCanonical[0]!, statCanonical[3]!]);
  const oldHash = encodeHash(new Set([canonical[0]!]), 30, canonical, benefits, statCanonical);
  const benefitCanonical = canonicalBenefitIds(model);
  const decoded = decodeHash(`#${oldHash}`, canonical, benefitCanonical)!;
  expect([...decoded.benefits].sort()).toEqual([...benefits].sort());
});

test("mixed player and pet tags round-trip via b=", () => {
  const benefitCanonical = canonicalBenefitIds(model);
  const petKey = benefitCanonical.find((k) => k.startsWith("pet:"))!;
  const benefits = new Set([statCanonical[0]!, petKey]);
  const hash = encodeHash(new Set([canonical[0]!]), 30, canonical, benefits, benefitCanonical);
  const decoded = decodeHash(`#${hash}`, canonical, benefitCanonical)!;
  expect([...decoded.benefits].sort()).toEqual([...benefits].sort());
});

test("round-trips a baseline build as cs=/cp=", () => {
  const canon = canonicalStarIds(model);
  const stat = canonicalBenefitIds(model);
  const cur = new Set<StarId>([canon[0]!, canon[5]!]);
  const base = new Set<StarId>([canon[0]!, canon[9]!]);
  const hash = encodeHash(cur, 55, canon, new Set(), stat, { selected: base, pointCap: 40 });
  expect(hash).toContain("&cs=");
  expect(hash).toContain("&cp=40");
  const decoded = decodeHash(hash, canon, stat)!;
  expect([...decoded.baseline!.selected].sort()).toEqual([...base].sort());
  expect(decoded.baseline!.pointCap).toBe(40);
});

test("no baseline encodes byte-identical to the legacy form and decodes baseline null", () => {
  const canon = canonicalStarIds(model);
  const cur = new Set<StarId>([canon[0]!]);
  const withArg = encodeHash(cur, 55, canon, new Set(), [], null);
  const legacy = encodeHash(cur, 55, canon); // old call shape
  expect(withArg).toBe(legacy);
  expect(decodeHash(withArg, canon)!.baseline).toBeNull();
});

test("a malformed cs= decodes to a null baseline without throwing", () => {
  const canon = canonicalStarIds(model);
  const decoded = decodeHash("p=55&s=&cs=@@@not-base64@@@&cp=40", canon)!;
  expect(decoded.baseline).toBeNull();
});

test("canonicalPowerStatIds: recognized power-only stat ids, excluding bonuses and meta", () => {
  const ids = canonicalPowerStatIds(model);
  const bonusIds = new Set(statCanonical);
  expect(ids).toContain("offensiveStunMin");
  expect(ids.every((id) => !bonusIds.has(id))).toBe(true);
  expect(ids).not.toContain("skillCooldownTime");
});

test("a power-only benefit tag round-trips through the URL without disturbing old positions", () => {
  const benefitCanonical = canonicalBenefitIds(model);
  const tag = "offensiveStunMin"; // a power-only tag (appended block)
  const hash = encodeHash(new Set(), 55, canonical, new Set([tag]), benefitCanonical);
  const decoded = decodeHash(`#${hash}`, canonical, benefitCanonical);
  expect(decoded!.benefits.has(tag)).toBe(true);
});
