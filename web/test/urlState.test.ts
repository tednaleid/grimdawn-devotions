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

test("a query round-trips through the hash", () => {
  const h = encodeHash(new Set(), 55, canonical, new Set(), statCanonical, null, "fire res");
  expect(h).toContain("q=fire%20res");
  expect(decodeHash(h, canonical, statCanonical)!.query).toBe("fire res");
});

test("an empty query emits no q param", () => {
  expect(encodeHash(new Set(), 55, canonical, new Set(), statCanonical, null, "")).not.toContain("q=");
});

test("a missing q decodes to an empty query", () => {
  expect(decodeHash("p=55&s=", canonical, statCanonical)!.query).toBe("");
});

test("an overlong query is truncated, not rejected", () => {
  const long = "x".repeat(500);
  const decoded = decodeHash(`p=55&s=&q=${long}`, canonical, statCanonical)!;
  expect(decoded.query.length).toBe(100);
});

test("a malformed percent-escape decodes to a harmless query rather than throwing", () => {
  expect(() => decodeHash("p=55&s=&q=%E0%A4%A", canonical, statCanonical)).not.toThrow();
  // URLSearchParams substitutes U+FFFD for the bad escape instead of throwing, so the query
  // survives as unmatchable text; the rest of the hash still decodes.
  const decoded = decodeHash("p=55&s=&q=%E0%A4%A", canonical, statCanonical)!;
  expect(decoded.query).toBe("�%A");
  expect(decoded.pointCap).toBe(55);
});

test("a query containing & and = round-trips intact", () => {
  const raw = "a&b=c";
  const h = encodeHash(new Set(), 55, canonical, new Set(), statCanonical, null, raw);
  expect(h).toContain(`q=${encodeURIComponent(raw)}`);
  const decoded = decodeHash(h, canonical, statCanonical)!;
  expect(decoded.query).toBe(raw);
  // encodeURIComponent means the & and = inside the query never introduce extra params
  const params = new URLSearchParams(h);
  expect([...params.keys()].sort()).toEqual(["p", "q", "s"]);
});

test("a whitespace-only query emits no q param", () => {
  expect(encodeHash(new Set(), 55, canonical, new Set(), statCanonical, null, "   ")).not.toContain("q=");
});

test("adding a query does not disturb the other params", () => {
  const canon = canonicalStarIds(model);
  const stat = canonicalBenefitIds(model);
  const selected = new Set<StarId>([canon[0]!, canon[5]!]);
  const benefits = new Set([stat[0]!, stat[3]!]);
  const hash = encodeHash(selected, 42, canon, benefits, stat, null, "acid");
  const decoded = decodeHash(hash, canon, stat)!;
  expect([...decoded.selected].sort()).toEqual([...selected].sort());
  expect(decoded.pointCap).toBe(42);
  expect([...decoded.benefits].sort()).toEqual([...benefits].sort());
  expect(decoded.query).toBe("acid");
});

// A hash is a shareable link people hand-edit and truncate. Every param is optional and each
// one defaults on its own, so a partial hash restores a sensible planner rather than nothing.
test("a query-only hash decodes, with the full point budget", () => {
  const decoded = decodeHash("#q=owl", canonical, statCanonical)!;
  expect(decoded).not.toBeNull();
  expect(decoded.query).toBe("owl");
  expect(decoded.pointCap).toBe(55);
  expect(decoded.selected.size).toBe(0);
  expect(decoded.benefits.size).toBe(0);
});

test("a missing p= defaults to the full 55 points, not the floor", () => {
  // Number(null) is 0, which IS finite, so an absent p= used to slip past the isFinite guard
  // and clamp to the 1-point minimum. A link without p= means "no cap was shared", not "one point".
  expect(decodeHash("#s=", canonical)!.pointCap).toBe(55);
  expect(decodeHash("#b=", canonical, statCanonical)!.pointCap).toBe(55);
});

test("an empty or unparseable p= defaults to 55", () => {
  expect(decodeHash("#p=&s=", canonical)!.pointCap).toBe(55);
  expect(decodeHash("#p=abc&s=", canonical)!.pointCap).toBe(55);
});

test("a missing cp= defaults the baseline to 55 too", () => {
  const canon = canonicalStarIds(model);
  const cur = new Set<StarId>([canon[0]!, canon[5]!]);
  const base = new Set<StarId>([canon[0]!, canon[9]!]);
  const full = encodeHash(cur, 55, canon, new Set(), [], { selected: base, pointCap: 40 });
  const withoutCp = full.replace("&cp=40", "");
  expect(decodeHash(withoutCp, canon)!.baseline!.pointCap).toBe(55);
});

test("p=0 is still the uncapped sentinel, not a missing value", () => {
  expect(decodeHash("#p=0&s=", canonical)!.pointCap).toBe(Number.POSITIVE_INFINITY);
});

test("a hash with no recognized param still decodes to null", () => {
  expect(decodeHash("#garbage", canonical)).toBeNull();
  expect(decodeHash("#zzz=1", canonical)).toBeNull();
});

test("encodeHash carries the source slug and decodeHash returns it", () => {
  const h = encodeHash(new Set(["bat:0"]), 55, canonical, new Set(), [], null, "", "qNYgbjeV");
  expect(h).toContain("gt=qNYgbjeV");
  expect(decodeHash(h, canonical, [])!.source).toBe("qNYgbjeV");
});

test("an absent gt= decodes to an empty source", () => {
  expect(decodeHash("p=55&s=AA", canonical, [])!.source).toBe("");
});

test("a malformed gt= is dropped rather than restored", () => {
  // Same tolerance discipline as every other param: a hand-edited link restores a sensible
  // planner rather than propagating junk into a rendered outbound link.
  expect(decodeHash("p=55&gt=not a slug", canonical, [])!.source).toBe("");
  expect(decodeHash(`p=55&gt=${"a".repeat(25)}`, canonical, [])!.source).toBe("");
  expect(decodeHash("p=55&gt=%3Cscript%3E", canonical, [])!.source).toBe("");
});

test("gt= alone is enough to make a hash ours to decode", () => {
  expect(decodeHash("gt=qNYgbjeV", canonical, [])).not.toBeNull();
});

test("an empty source emits no gt= at all", () => {
  expect(encodeHash(new Set(), 55, canonical, new Set(), [], null, "", "")).not.toContain("gt=");
});
