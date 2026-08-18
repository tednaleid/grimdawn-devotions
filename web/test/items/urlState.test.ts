// ABOUTME: Round-trip + tolerance tests for the items page view-state hash codec.
import { test, expect } from "bun:test";
import { decodeHash, DEFAULT_VIEW, encodeHash, type ViewState } from "../../src/items/core/urlState";

const known = { masteries: new Set(["m1"]), skills: new Set(["s1"]) };

test("round-trips a non-default state", () => {
  const v = decodeHash("mastery=m1&skill=s1&slot=medal,amulet&rarity=Legendary&sort=ilvl:-1", known);
  expect(v.mastery).toBe("m1");
  expect(v.fSlot).toEqual(new Set(["medal", "amulet"]));
  expect(decodeHash(encodeHash(v), known)).toEqual(v);
});

test("defaults encode as absent so a bare link stays short", () => {
  expect(encodeHash(decodeHash("", known))).toBe("");
});

test("a stale skill id falls back to no selection rather than throwing", () => {
  const v = decodeHash("mastery=m1&skill=deleted-skill", known);
  expect(v.mastery).toBe("m1");
  expect(v.skill).toBeNull();
});

test("unknown slot tokens are dropped, known ones kept", () => {
  expect(decodeHash("slot=medal,teapot", known).fSlot).toEqual(new Set(["medal"]));
});

test("a stale mastery id falls back to no selection", () => {
  expect(decodeHash("mastery=deleted-mastery", known).mastery).toBeNull();
});

test("domain and kind facets round-trip and reject unknown tokens", () => {
  const v = decodeHash("domain=gear,teapot&kind=modifies,bogus", known);
  expect(v.fDomain).toEqual(new Set(["gear"]));
  expect(v.fKind).toEqual(new Set(["modifies"]));
  expect(decodeHash(encodeHash(v), known)).toEqual(v);
});

test("masteryWide and q round-trip; both are omitted at their default", () => {
  const v: ViewState = { ...DEFAULT_VIEW, masteryWide: true, q: "cadence" };
  const h = encodeHash(v);
  expect(h).toContain("wide=1");
  expect(h).toContain("q=cadence");
  expect(decodeHash(h, known)).toEqual(v);
  expect(encodeHash(DEFAULT_VIEW)).not.toContain("wide=");
  expect(encodeHash(DEFAULT_VIEW)).not.toContain("q=");
});

test("a hand-edited wide=0 decodes to false, not just left at the default", () => {
  // The encoder only ever emits wide=1 (masteryWide's default is already false), so this is
  // the only test that exercises the false branch of `val === "1"` at all.
  expect(decodeHash("wide=0", known).masteryWide).toBe(false);
  expect(decodeHash("wide=0", known)).toEqual(DEFAULT_VIEW);
});

test("an unknown sort key discards the direction with it, leaving no hybrid state", () => {
  expect(decodeHash("sort=bogus:-1", known)).toEqual(DEFAULT_VIEW);
});

test("a hash with no '=' anywhere is skipped entirely by the pair guard, yielding defaults", () => {
  expect(decodeHash("%%%bad", known)).toEqual(DEFAULT_VIEW);
});

test("a value that fails decodeURIComponent is dropped via the catch, yielding defaults", () => {
  expect(decodeHash("q=%zz", known)).toEqual(DEFAULT_VIEW);
});
