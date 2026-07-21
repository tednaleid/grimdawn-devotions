// ABOUTME: Transition pair generators: small-delta mutations (moved from the spike), star-level
// ABOUTME: resizes, load-bearing swaps, and real-URL fixture pairs for the transition test corpus.
import { cons, generateValidBuild, isValidBuild, model } from "../../scripts/reachability-fuzz";
import { selectionSummary, type ReachCon, type Vec } from "../../src/core/reachability";
import { canonicalStarIds, decodeHash } from "../../src/core/urlState";

const BUDGET = 55;
const SEED_AFF: Vec = [1, 1, 1, 1, 1]; // the refundable crossroads seed, as in the fuzzer
const zero = (): Vec => [0, 0, 0, 0, 0];
const add = (g: Vec, x: Vec): Vec => [g[0] + x[0], g[1] + x[1], g[2] + x[2], g[3] + x[3], g[4] + x[4]];
const covers = (g: Vec, d: Vec): boolean =>
  g[0] >= d[0] && g[1] >= d[1] && g[2] >= d[2] && g[3] >= d[3] && g[4] >= d[4];

/** Grow `B` with legal picks (the fuzzer's forward rule) until no candidate fits `budget`. */
function grow(B: ReachCon[], rng: () => number, budget: number): ReachCon[] {
  const inB = new Set(B.map((c) => c.id));
  let grants = zero();
  let stars = 0;
  for (const c of B) {
    grants = add(grants, c.grant);
    stars += c.size;
  }
  for (let guard = 0; guard < 300; guard++) {
    const reach = add(SEED_AFF, grants);
    const cand = cons.filter(
      (c) => !inB.has(c.id) && stars + c.size <= budget && covers(reach, c.req) && covers(add(grants, c.grant), c.req),
    );
    if (!cand.length) break;
    const c = cand[Math.floor(rng() * cand.length)]!;
    B = [...B, c];
    inB.add(c.id);
    grants = add(grants, c.grant);
    stars += c.size;
  }
  return B;
}

/**
 * A small-delta pair: a generated valid build, and a copy with 1-3 members removed and different
 * members grown in their place, both valid. Null when no valid mutation lands in bounded retries.
 */
export function mutatePair(rng: () => number, budget = BUDGET): { base: ReachCon[]; cur: ReachCon[] } | null {
  const base = generateValidBuild(rng);
  if (base.length < 4 || !isValidBuild(base)) return null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const k = 1 + Math.floor(rng() * 3);
    const keep = [...base];
    for (let i = 0; i < k && keep.length > 2; i++) keep.splice(Math.floor(rng() * keep.length), 1);
    if (!isValidBuild(keep)) continue; // removing these strands a dependent; try another removal
    const cur = grow(keep, rng, budget);
    const baseIds = new Set(base.map((c) => c.id));
    const changed = cur.length !== base.length || cur.some((c) => !baseIds.has(c.id));
    if (changed && isValidBuild(cur)) return { base, cur };
  }
  return null;
}

/** Two independently generated valid builds (the stress corpus). */
export function randomPair(rng: () => number): { base: ReachCon[]; cur: ReachCon[] } {
  return { base: generateValidBuild(rng), cur: generateValidBuild(rng) };
}

/** A pair differing only in one member's star count: the cur side holds a PARTIAL copy (reduced
 *  size, zero grant - grants land only at completion) of one base member, or vice versa. */
export function resizePair(rng: () => number, _budget = BUDGET): { base: ReachCon[]; cur: ReachCon[] } | null {
  const base = generateValidBuild(rng);
  const candidates = base.filter((c) => c.size >= 3);
  if (!candidates.length) return null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const m = candidates[Math.floor(rng() * candidates.length)]!;
    const k = 1 + Math.floor(rng() * (m.size - 1)); // 1..size-1
    const partial: ReachCon = { id: m.id, size: k, req: m.req, grant: zero() };
    const cur = base.map((c) => (c.id === m.id ? partial : c));
    if (!isValidBuild(cur)) continue; // the shrunk member's grant was load-bearing
    // Randomly orient: half the time the partial side is the BASE (a grow transition).
    return rng() < 0.5 ? { base, cur } : { base: cur, cur: base };
  }
  return null;
}

/** A pair whose delta removes a LOAD-BEARING granter (its removal alone is invalid) and regrows
 *  different members around the hole until the result is valid again - the hardest realistic shape
 *  the spike's keep-valid mutation filter biased away from. */
export function swapPair(rng: () => number, budget = BUDGET): { base: ReachCon[]; cur: ReachCon[] } | null {
  const base = generateValidBuild(rng);
  if (base.length < 4) return null;
  const bearing = base.filter((_, j) => !isValidBuild(base.filter((_, k) => k !== j)));
  if (!bearing.length) return null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const m = bearing[Math.floor(rng() * bearing.length)]!;
    const hole = base.filter((c) => c.id !== m.id);
    const cur = grow(hole, rng, budget).filter((c) => c.id !== m.id);
    if (!isValidBuild(cur)) continue;
    const changed = cur.length !== base.length || cur.some((c) => !base.some((b) => b.id === c.id));
    if (changed) return { base, cur };
  }
  return null;
}

/** Real planner links decoded into member lists (the Eel pair from the spike, near-cap by design). */
export function urlFixturePairs(): { label: string; base: ReachCon[]; cur: ReachCon[] }[] {
  const canonical = canonicalStarIds(model);
  const members = (hash: string) => selectionSummary(model, decodeHash(hash, canonical)!.selected).built;
  const CUR = "p=55&s=AAAAgAAHAAAAAAAAAAAAPADAwQf44AEAAIA_AAD8AAAAAAAAAAAAAPAD4AMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfg";
  const BASE = "p=55&s=AAAAAAAAAADABgAAAAAAPADAwQcA4AEAAIA_AAD8AAAAAAAAAPABAPAD4AMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfg";
  const CHURN_CUR = "p=55&s=AAAAAAB_AADAPgAAAAAAPADAwQcA4AEA-AMAAAAAAAAAAAAAAAAAAPAD4AMAAAAAAAAAAAAAAAAAAAD4Aw";
  return [
    { label: "eel-pair", base: members(BASE), cur: members(CUR) },
    { label: "yugol-churn-pair", base: members(CUR), cur: members(CHURN_CUR) },
  ];
}
