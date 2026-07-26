// ABOUTME: Round-trip and tolerance tests for the monster page's view-state hash codec.
// ABOUTME: Every control must survive a copied link, and a stale link must never throw.
import { test, expect } from "bun:test";
import { encodeHash, decodeHash, DEFAULT_VIEW, type ViewState } from "../../src/monsters/core/urlState";

const ROLES = new Set(["hero", "nemesis", "boss&quest"]);

test("encode then decode is identity over a fully populated view", () => {
  const v: ViewState = {
    ...DEFAULT_VIEW,
    diff: "elite",
    players: "3",
    tiers: new Set(["Hero", "Boss"]),
    roles: new Set(["nemesis"]),
    q: "kaisan",
    hideSummons: true,
    includeAuras: true,
    sortKey: "fire",
    sortDir: -1,
  };
  expect(decodeHash(encodeHash(v), ROLES)).toEqual(v);
});

test("the default view encodes to an empty hash", () => {
  expect(encodeHash(DEFAULT_VIEW)).toBe("");
});

test("only non-default values appear in the hash", () => {
  const h = encodeHash({ ...DEFAULT_VIEW, q: "fire" });
  expect(h).toBe("q=fire");
});

test("a garbage hash decodes to the default view", () => {
  expect(decodeHash("%%%bad", ROLES)).toEqual(DEFAULT_VIEW);
  expect(decodeHash("", ROLES)).toEqual(DEFAULT_VIEW);
  expect(decodeHash("#", ROLES)).toEqual(DEFAULT_VIEW);
});

test("unknown keys are ignored without disturbing known ones", () => {
  const back = decodeHash("q=alkamos&bogus=1&legacyKey=x", ROLES);
  expect(back.q).toBe("alkamos");
  expect(back).toEqual({ ...DEFAULT_VIEW, q: "alkamos" });
});

test("an unknown tier or role token is dropped, valid ones survive", () => {
  const back = decodeHash("tier=Hero,Nonsense&role=nemesis,notarole", ROLES);
  expect(back.tiers).toEqual(new Set(["Hero"]));
  expect(back.roles).toEqual(new Set(["nemesis"]));
});

test("a role needing escaping round-trips", () => {
  const v: ViewState = { ...DEFAULT_VIEW, roles: new Set(["boss&quest"]) };
  const h = encodeHash(v);
  expect(h).toContain("role=boss%26quest");
  expect(decodeHash(h, ROLES).roles).toEqual(new Set(["boss&quest"]));
});

test("an out-of-range difficulty or player count falls back to the default", () => {
  expect(decodeHash("diff=nightmare", ROLES).diff).toBe(DEFAULT_VIEW.diff);
  expect(decodeHash("players=9", ROLES).players).toBe(DEFAULT_VIEW.players);
});

test("a link carrying the retired minlv key is ignored, not rejected", () => {
  // The Min level control shipped briefly and was removed; old links still carry minlv.
  // It must decode to the plain default view rather than throwing or poisoning the state.
  expect(decodeHash("minlv=90", ROLES)).toEqual(DEFAULT_VIEW);
  expect(decodeHash("minlv=abc", ROLES)).toEqual(DEFAULT_VIEW);
});

test("the boolean toggles read as present-means-on", () => {
  expect(decodeHash("summons=0&auras=0", ROLES).hideSummons).toBe(false);
  const on = decodeHash("summons=1&auras=1", ROLES);
  expect(on.hideSummons).toBe(true);
  expect(on.includeAuras).toBe(true);
});

test("sort decodes key and direction, and tolerates a missing direction", () => {
  expect(decodeHash("sort=fire:-1", ROLES).sortKey).toBe("fire");
  expect(decodeHash("sort=fire:-1", ROLES).sortDir).toBe(-1);
  expect(decodeHash("sort=fire", ROLES).sortDir).toBe(1);
});

test("an unknown sort key discards the direction with it, leaving no hybrid state", () => {
  // Applying the direction while falling back on the key would produce a view that is
  // neither what the link asked for nor the default.
  expect(decodeHash("sort=bogus:-1", ROLES)).toEqual(DEFAULT_VIEW);
});

test("one bad value does not discard the other fields in the same hash", () => {
  // Each key is handled independently, so a stale enum must not wipe out a user's filters.
  const back = decodeHash("diff=nightmare&q=alkamos&summons=1", ROLES);
  expect(back.diff).toBe(DEFAULT_VIEW.diff);
  expect(back.q).toBe("alkamos");
  expect(back.hideSummons).toBe(true);
});

test("ascendant round-trips through the hash", () => {
  const v: ViewState = { ...DEFAULT_VIEW, diff: "ascendant" };
  expect(encodeHash(v)).toContain("diff=ascendant");
  expect(decodeHash("diff=ascendant", ROLES).diff).toBe("ascendant");
});

test("a difficulty outside the list is still rejected", () => {
  // Pins that adding ascendant widened the allowed set by exactly one value rather
  // than dropping the check. "ascendent" is the plausible misspelling a hand-edited
  // link carries, so it is the useful negative case.
  expect(decodeHash("diff=ascendent", ROLES).diff).toBe(DEFAULT_VIEW.diff);
  expect(decodeHash("diff=nightmare", ROLES).diff).toBe(DEFAULT_VIEW.diff);
});
