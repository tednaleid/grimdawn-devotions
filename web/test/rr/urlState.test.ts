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

test("empty damage/rr/search are omitted; the source default is emitted explicitly", () => {
  const h = encodeHash(DEFAULT_VIEW);
  expect(h).not.toContain("q=");
  expect(h).not.toContain("type=");
  expect(h).not.toContain("rr=");
  // Source is always emitted (it has a non-empty default), so the boot hash carries it verbatim.
  expect(h).toContain("source=devotion,skill");
});

test("cleared source (show all) round-trips distinctly from the absent-key default", () => {
  const cleared: ViewState = { ...DEFAULT_VIEW, fCat: new Set() };
  const h = encodeHash(cleared);
  expect(h).toContain("source="); // present but empty, so it differs from the default
  expect(decodeHash(h, new Set()).fCat.size).toBe(0);
  // An absent source key falls back to the devotion+skill default.
  expect(decodeHash("#sort=rr:1", new Set()).fCat).toEqual(new Set(["devotion", "skill"]));
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
  const back = decodeHash("#type=Fire&rr=stacking&source=devotion", new Set());
  expect(back.fType).toEqual(new Set(["Fire"]));
  expect(back.fRR).toEqual(new Set(["stacking"]));
  expect(back.fCat).toEqual(new Set(["devotion"]));
});

test("unknown tokens and the legacy cat/par/trig/group keys are dropped without error", () => {
  // `source=` with an invalid value → empty (show all); the legacy `cat=` key is ignored entirely.
  const back = decodeHash("#type=Fire,Bogus&source=item%20granted&cat=devotion&par=x&trig=y&group=item", new Set());
  expect(back.fType).toEqual(new Set(["Fire"]));
  expect(back.fCat.size).toBe(0);
  expect(back).not.toHaveProperty("fPar");
  expect(back).not.toHaveProperty("fTrig");
  expect(back).not.toHaveProperty("group");
});

test("DEFAULT_VIEW: empty damage/rr facets, source defaults to devotion+skill, no group field", () => {
  expect(DEFAULT_VIEW.fType).toEqual(new Set());
  expect(DEFAULT_VIEW.fRR).toEqual(new Set());
  expect(DEFAULT_VIEW.fCat).toEqual(new Set(["devotion", "skill"]));
  expect(DEFAULT_VIEW).not.toHaveProperty("group");
  expect(DEFAULT_VIEW).not.toHaveProperty("fPar");
  expect(DEFAULT_VIEW).not.toHaveProperty("fTrig");
});
