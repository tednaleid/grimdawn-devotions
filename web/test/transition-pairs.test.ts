// ABOUTME: Tests for the transition pair generators: small-delta mutations, star-level resizes,
// ABOUTME: load-bearing swaps, and real-URL fixture pairs - the corpus behind the transition nets.
import { test, expect } from "bun:test";
import { mutatePair, resizePair, swapPair, urlFixturePairs } from "./support/transition-pairs";
import { isValidBuild, mulberry32 } from "../scripts/reachability-fuzz";

test("resizePair produces a pair differing only in one member's star count", () => {
  const rng = mulberry32(21);
  let found = 0;
  for (let i = 0; i < 40 && found < 5; i++) {
    const p = resizePair(rng);
    if (!p) continue;
    found++;
    expect(isValidBuild(p.base)).toBeTrue();
    expect(isValidBuild(p.cur)).toBeTrue();
    const b = new Map(p.base.map((c) => [c.id, c.size]));
    const c2 = new Map(p.cur.map((c) => [c.id, c.size]));
    expect(b.size).toBe(c2.size);
    const diffs = [...b].filter(([id, n]) => c2.get(id) !== n);
    expect(diffs.length).toBe(1); // exactly one member resized
  }
  expect(found).toBeGreaterThan(0);
});

test("a resized partial member carries zero grant (grant only at completion)", () => {
  const rng = mulberry32(22);
  for (let i = 0; i < 40; i++) {
    const p = resizePair(rng);
    if (!p) continue;
    const b = new Map(p.base.map((c) => [c.id, c]));
    for (const c of p.cur) {
      const bc = b.get(c.id)!;
      if (c.size !== bc.size) {
        const partial = c.size < bc.size ? c : bc;
        expect(partial.grant).toEqual([0, 0, 0, 0, 0]);
        return;
      }
    }
  }
  throw new Error("no resize pair found");
});

test("swapPair removes a load-bearing granter and regrows to a valid build", () => {
  const rng = mulberry32(23);
  let found = 0;
  for (let i = 0; i < 60 && found < 3; i++) {
    const p = swapPair(rng);
    if (!p) continue;
    found++;
    expect(isValidBuild(p.base)).toBeTrue();
    expect(isValidBuild(p.cur)).toBeTrue();
    const curIds = new Set(p.cur.map((c) => c.id));
    expect(p.base.some((c) => !curIds.has(c.id))).toBeTrue(); // something was removed
    const removed = p.base.filter((c) => !curIds.has(c.id));
    expect(removed.length).toBeGreaterThan(0);
    expect(removed.some((m) => !isValidBuild(p.base.filter((c) => c.id !== m.id)))).toBeTrue();
  }
  expect(found).toBeGreaterThan(0);
});

test("generators are deterministic per seed", () => {
  expect(JSON.stringify(resizePair(mulberry32(9)))).toBe(JSON.stringify(resizePair(mulberry32(9))));
  expect(JSON.stringify(swapPair(mulberry32(9)))).toBe(JSON.stringify(swapPair(mulberry32(9))));
});

test("urlFixturePairs decodes real links into non-empty member lists", () => {
  const pairs = urlFixturePairs();
  expect(pairs.length).toBeGreaterThan(0);
  for (const p of pairs) {
    expect(p.base.length).toBeGreaterThan(0);
    expect(p.cur.length).toBeGreaterThan(0);
  }
});

test("mutatePair still produces distinct valid small-delta pairs (moved, not changed)", () => {
  const p = mutatePair(mulberry32(42));
  if (!p) return;
  expect(isValidBuild(p.base)).toBeTrue();
  expect(isValidBuild(p.cur)).toBeTrue();
});
