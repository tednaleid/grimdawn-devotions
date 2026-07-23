// ABOUTME: Round-trip + tolerance tests for the RR view-state hash codec.
import { test, expect } from "bun:test";
import { encodeHash, decodeHash, DEFAULT_VIEW, type ViewState } from "../../src/rr/core/urlState";

test("encode∘decode is identity over a representative view", () => {
  const known = new Set(["veilofshadows2.s", "tier2_01c_skill.f"]);
  const v: ViewState = {
    ...DEFAULT_VIEW,
    q: "night",
    fRR: new Set(["stacking"]),
    sortKey: "value",
    sortDir: -1,
    r0: 80,
    sel: new Set(["veilofshadows2.s"]),
  };
  const back = decodeHash(encodeHash(v), known);
  expect(back).toEqual(v);
});

test("stale sel ids are dropped; garbage hash → defaults", () => {
  expect(decodeHash("sel=doesnotexist", new Set()).sel.size).toBe(0);
  expect(decodeHash("%%%bad", new Set())).toEqual(DEFAULT_VIEW);
});

test("empty filters are omitted from the hash", () => {
  expect(encodeHash(DEFAULT_VIEW)).not.toContain("q=");
  expect(encodeHash(DEFAULT_VIEW)).not.toContain("type=");
  expect(encodeHash(DEFAULT_VIEW)).not.toContain("rr=");
  expect(encodeHash(DEFAULT_VIEW)).not.toContain("cat=");
});

test("multi-select facets round-trip as equal sets", () => {
  const known = new Set<string>();
  const v: ViewState = {
    ...DEFAULT_VIEW,
    fType: new Set(["Fire", "Cold", "Poison & Acid"]),
    fRR: new Set(["stacking"]),
    fCat: new Set(["item", "skill"]),
  };
  const back = decodeHash(encodeHash(v), known);
  expect(back.fType).toEqual(v.fType);
  expect(back.fRR).toEqual(v.fRR);
  expect(back.fCat).toEqual(v.fCat);
});

test("a stale single-value link decodes to a one-element set", () => {
  const back = decodeHash("#type=Fire&rr=stacking&cat=devotion", new Set());
  expect(back.fType).toEqual(new Set(["Fire"]));
  expect(back.fRR).toEqual(new Set(["stacking"]));
  expect(back.fCat).toEqual(new Set(["devotion"]));
});

test("unknown tokens and removed par/trig/group keys are dropped without error", () => {
  const back = decodeHash("#type=Fire,Bogus&cat=item%20granted&par=x&trig=y&group=item", new Set());
  expect(back.fType).toEqual(new Set(["Fire"]));
  expect(back.fCat.size).toBe(0);
  expect(back).not.toHaveProperty("fPar");
  expect(back).not.toHaveProperty("fTrig");
  expect(back).not.toHaveProperty("group");
});

test("DEFAULT_VIEW has three empty facet sets and no group field", () => {
  expect(DEFAULT_VIEW.fType).toEqual(new Set());
  expect(DEFAULT_VIEW.fRR).toEqual(new Set());
  expect(DEFAULT_VIEW.fCat).toEqual(new Set());
  expect(DEFAULT_VIEW).not.toHaveProperty("group");
  expect(DEFAULT_VIEW).not.toHaveProperty("fPar");
  expect(DEFAULT_VIEW).not.toHaveProperty("fTrig");
});
