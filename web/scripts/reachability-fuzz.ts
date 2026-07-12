// ABOUTME: Seeded correctness fuzzer for the reachability engine. Builds known-valid 55-point builds
// ABOUTME: FORWARD from free footholds using the ground-truth validity rule (not the engine), then
// ABOUTME: replays them BACKWARD in claim-anywhere order and asserts the engine never dims a
// ABOUTME: constellation that is genuinely part of the valid build (a false dim = an engine bug).
// ABOUTME: Run via `just fuzz [--seeds N] [--start S] [--ts]`. Uses the shipped WASM resolver if built.
// ABOUTME: The pure pieces are exported so web/test/reachability-fuzz.test.ts can guard them in CI.
import { buildModel } from "../src/core/model";
import { buildReachCons, buildCoverTable, reachabilityForSelection, setExactResolver, type ReachCon, type Vec } from "../src/core/reachability";
import { loadWasmResolver } from "../src/adapters/reachWasm";
import type { DevotionModel } from "../src/core/types";
import { resolve } from "path";
import { fileURLToPath } from "url";

const BUDGET = 55;
const CAP: Vec = [20, 8, 20, 10, 20], SEED: Vec = [1, 1, 1, 1, 1];
const covers = (g: Vec, d: Vec) => g[0] >= d[0] && g[1] >= d[1] && g[2] >= d[2] && g[3] >= d[3] && g[4] >= d[4];
const addCap = (g: Vec, x: Vec): Vec => [Math.min(g[0] + x[0], CAP[0]!), Math.min(g[1] + x[1], CAP[1]!), Math.min(g[2] + x[2], CAP[2]!), Math.min(g[3] + x[3], CAP[3]!), Math.min(g[4] + x[4], CAP[4]!)];
const maxV = (a: Vec, b: Vec): Vec => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3]), Math.max(a[4], b[4])];
const reqMag = (c: ReachCon) => c.req[0] + c.req[1] + c.req[2] + c.req[3] + c.req[4];
export function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(scriptPath, "..", "..", "..");
export const model: DevotionModel = buildModel(JSON.parse(await Bun.file(resolve(root, "data", "devotions.json")).text()));
export const cons = buildReachCons(model);
export const table = buildCoverTable(cons);

/** Ground-truth validity: total grant covers max requirement (refundable seed) AND constructible from the seed. */
export function isValidBuild(B: ReachCon[]): boolean {
  let total: Vec = [0, 0, 0, 0, 0], maxreq: Vec = [0, 0, 0, 0, 0];
  for (const c of B) { total = addCap(total, c.grant); maxreq = maxV(maxreq, c.req); }
  if (!covers(total, maxreq)) return false;
  let gain: Vec = [...SEED]; const done = B.map(() => false); let placed = 0, ch = true;
  while (ch) { ch = false; for (let i = 0; i < B.length; i++) { if (done[i] || !covers(gain, B[i]!.req)) continue; done[i] = true; placed++; gain = addCap(gain, B[i]!.grant); ch = true; } }
  return placed === B.length;
}

/**
 * Build a known-valid build forward, independent of the engine. Start from free footholds (req met by
 * the crossroads seed) and move outward, only adding a constellation when (a) it is placeable now
 * (req <= seed + accumulated grants: constructible) AND (b) its req is covered by the accumulated
 * grants plus its own grant (so the build stays self-covering when the seed is refunded). Every member
 * is thus a legal pick and the result is a genuine valid build (asserted by isValidBuild).
 */
export function generateValidBuild(rng: () => number): ReachCon[] {
  const B: ReachCon[] = []; const inB = new Set<string>();
  let grants: Vec = [0, 0, 0, 0, 0], stars = 0;
  for (let guard = 0; guard < 300; guard++) {
    const reach = addCap(SEED, grants);
    const cand = cons.filter((c) => !inB.has(c.id) && stars + c.size <= BUDGET && covers(reach, c.req) && covers(addCap(grants, c.grant), c.req));
    if (!cand.length) break;
    const c = cand[Math.floor(rng() * cand.length)]!;
    B.push(c); inB.add(c.id); grants = addCap(grants, c.grant); stars += c.size;
  }
  return B;
}

export interface Violation { seed: number; order: string; claimed: string[]; dimmed: string; kind: "completable" | "first-star" }

/** Claim B's members in `order` (one sweep per claim). After each claim, every unclaimed member must
 *  stay completable, and its first star must be reachable (you must still be able to start it). Either
 *  failure is the engine dimming something genuinely on a valid path - a false dim, i.e. an engine bug. */
export function backwardCheck(seed: number, orderName: string, B: ReachCon[], order: ReachCon[]): Violation[] {
  const v: Violation[] = [];
  const selected = new Set<string>(), claimed = new Set<string>();
  for (const m of order) {
    for (const sid of model.constellations.get(m.id)!.starIds) selected.add(sid); // claim-anywhere: select the whole member
    claimed.add(m.id);
    const view = reachabilityForSelection(model, cons, table, selected, BUDGET);
    for (const u of B) {
      if (claimed.has(u.id)) continue;
      if (!view.completable.has(u.id)) v.push({ seed, order: orderName, claimed: [...claimed], dimmed: u.id, kind: "completable" });
      const first = model.constellations.get(u.id)!.starIds[0]!; // an unclaimed member's first star is a frontier star
      if (!selected.has(first) && !view.reachableStars.has(first)) v.push({ seed, order: orderName, claimed: [...claimed], dimmed: first, kind: "first-star" });
    }
  }
  return v;
}

/** Run both claim orders for one seed; returns its violations (and whether the generator stayed valid). */
export function fuzzSeed(seed: number): { violations: Violation[]; stars: number; genValid: boolean } {
  const rng = mulberry32(seed);
  const B = generateValidBuild(rng);
  const stars = B.reduce((n, c) => n + c.size, 0);
  if (!isValidBuild(B)) return { violations: [], stars, genValid: false };
  const outerFirst = [...B].sort((a, b) => reqMag(b) - reqMag(a) || rng() - 0.5);
  const shuffled = [...B];
  for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]; }
  return { violations: [...backwardCheck(seed, "outer-first", B, outerFirst), ...backwardCheck(seed, "shuffled", B, shuffled)], stars, genValid: true };
}

if (import.meta.main) {
  const argNum = (flag: string, def: number) => { const i = process.argv.indexOf(flag); return i >= 0 && process.argv[i + 1] !== undefined ? Number(process.argv[i + 1]) : def; };
  const SEEDS = argNum("--seeds", 50), START = argNum("--start", 1), FORCE_TS = process.argv.includes("--ts");
  if (!FORCE_TS) {
    const f = Bun.file(resolve(root, "data", "reach.wasm"));
    if (await f.exists()) { const r = await loadWasmResolver(await f.arrayBuffer(), cons, table); if (r) { setExactResolver(r); console.log("resolver: WASM"); } else console.log("resolver: TS (wasm load failed)"); } else console.log("resolver: TS (no data/reach.wasm)");
  } else console.log("resolver: TS (forced)");

  let builds = 0, genBad = 0, sizeSum = 0; const violations: Violation[] = [];
  for (let s = START; s < START + SEEDS; s++) {
    const r = fuzzSeed(s); builds++; sizeSum += r.stars; if (!r.genValid) genBad++;
    violations.push(...r.violations); process.stdout.write(".");
  }
  console.log(`\n\n${builds} builds (avg ${(sizeSum / builds).toFixed(0)} stars), generator-invalid ${genBad}.`);
  console.log(`VIOLATIONS (engine dimmed a valid-build member; must be 0): ${violations.length}`);
  for (const x of violations.slice(0, 20)) console.log(`  seed ${x.seed} [${x.order}] after {${x.claimed.map((id) => model.constellations.get(id)?.nameTag ?? id).join(", ")}}: dimmed ${x.kind} ${model.constellations.get(x.dimmed.split(":")[0]!)?.nameTag ?? x.dimmed}`);
  if (genBad > builds / 2) console.log("WARNING: many generator-invalid builds; the forward generator may be too strict.");
  process.exit(violations.length ? 1 : 0);
}
