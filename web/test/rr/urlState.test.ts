// ABOUTME: Round-trip + tolerance tests for the RR view-state hash codec.
import { test, expect } from "bun:test";
import { encodeHash, decodeHash, DEFAULT_VIEW, type ViewState } from "../../src/rr/core/urlState";

test("encode∘decode is identity over a representative view", () => {
  const known = new Set(["veilofshadows2.s", "tier2_01c_skill.f"]);
  const v: ViewState = {
    ...DEFAULT_VIEW,
    q: "night",
    fRR: "stacking",
    sortKey: "value",
    sortDir: -1,
    group: "mastery",
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
  expect(encodeHash(DEFAULT_VIEW)).not.toContain("group=");
});
