// ABOUTME: Metamorphic false-dim harvester. INVARIANT: under ADDITIVE star picks at a fixed budget,
// ABOUTME: reachability is DOWNWARD-CLOSED (a witness build for the larger selection also contains the
// ABOUTME: smaller), so any constellation that becomes completable AFTER an additive pick was a FALSE-DIM
// ABOUTME: in the prior state. Oracle-free: it tests the engine against its own consistency on the real
// ABOUTME: model, which is where exhaustive oracles do not scale. Seeded random additive walks; reports
// ABOUTME: the false-dim rate and dumps distinct (selection, constellation) cases to
// ABOUTME: test/fixtures/false-dims.json. Re-runnable after the dataset changes (it rediscovers cases).
// ABOUTME: Run `just harvest-false-dims [--seeds N] [--start S] [--max-pts P] [--cap C] [--ts] [--no-dump]`.
import { buildModel } from "../src/core/model";
import { buildReachCons, buildCoverTable, classifyForSelection, selectionSummary, setExactResolver, type ReachCon } from "../src/core/reachability";
import { loadWasmResolver } from "../src/adapters/reachWasm";
import type { DevotionModel } from "../src/core/types";
import { fileURLToPath } from "url";
import { resolve } from "path";

function argNum(flag: string, def: number): number {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] !== undefined ? Number(process.argv[i + 1]) : def;
}
const SEEDS = argNum("--seeds", 6);
const START = argNum("--start", 1);
const MAX_PTS = argNum("--max-pts", 42); // walks stop here; deeper states mostly repeat the same false-dims
const CAP = argNum("--cap", 55);
const FORCE_TS = process.argv.includes("--ts");
const DUMP = !process.argv.includes("--no-dump");

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(scriptPath, "..", "..", "..");
const model: DevotionModel = buildModel(JSON.parse(await Bun.file(resolve(root, "data", "devotions.json")).text()));
const cons = buildReachCons(model);
const table = buildCoverTable(cons);
if (!FORCE_TS) {
  const wasmFile = Bun.file(resolve(root, "data", "reach.wasm"));
  if (await wasmFile.exists()) {
    const r = await loadWasmResolver(await wasmFile.arrayBuffer(), cons, table);
    if (r) setExactResolver(r);
  }
}
console.log(`resolver: ${FORCE_TS ? "TS (forced)" : "WASM if present"}  seeds ${START}..${START + SEEDS - 1}  max ${MAX_PTS} pts  cap ${CAP}`);

// Watch the false-dim-prone set: outer constellations (require affinity) that do NOT cover their own
// requirement. Self-covering / requirement-free constellations are trivially completable and never dim.
const reqSum = (c: ReachCon) => c.req[0] + c.req[1] + c.req[2] + c.req[3] + c.req[4];
const selfCovers = (c: ReachCon) => c.grant.every((g, j) => g >= c.req[j]!);
const watch = cons.filter((c) => reqSum(c) > 0 && !selfCovers(c)).map((c) => c.id);
const nameOf = (id: string) => model.constellations.get(id)?.name ?? id;
console.log(`watching ${watch.length} non-self-covering outer constellations for downward-closure violations\n`);

function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const reachable = (sel: Set<string>) => classifyForSelection(cons, table, selectionSummary(model, sel), CAP) === "reachable";
const completable = (sel: Set<string>, conId: string): boolean => {
  const w = new Set(sel);
  for (const sid of model.constellations.get(conId)!.starIds) w.add(sid);
  return classifyForSelection(cons, table, selectionSummary(model, w), CAP) === "reachable";
};
const frontier = (sel: Set<string>): string[] => {
  const out: string[] = [];
  for (const star of model.stars.values()) if (!sel.has(star.id) && star.predecessors.every((p) => sel.has(p))) out.push(star.id);
  return out;
};
// The selection as a constellation -> selected-star-count map (the fixture's compact, reloadable form).
const countsOf = (sel: Set<string>): Record<string, number> => {
  const m: Record<string, number> = {};
  for (const sid of sel) { const cid = model.stars.get(sid)!.constellationId; m[cid] = (m[cid] ?? 0) + 1; }
  return m;
};

interface FalseDim { label: string; sel: Record<string, number>; con: string }
const found: FalseDim[] = [];
const seen = new Set<string>();
let picks = 0;

for (let s = START; s < START + SEEDS; s++) {
  const rng = mulberry32(1000 + s);
  const sel = new Set<string>();
  let prev = new Map(watch.map((id) => [id, completable(sel, id)]));
  for (let step = 0; step < 200 && sel.size < MAX_PTS; step++) {
    const fr = frontier(sel);
    if (!fr.length) break;
    const before = countsOf(sel); // the state BEFORE this additive pick
    // pick a random frontier star that keeps the selection reachable (a real, clickable move)
    let added = false;
    for (let t = 0; t < 10 && !added; t++) {
      const star = fr[Math.floor(rng() * fr.length)]!;
      const trial = new Set(sel); trial.add(star);
      if (reachable(trial)) { sel.add(star); added = true; }
    }
    if (!added) break;
    picks++;
    const cur = new Map(watch.map((id) => [id, completable(sel, id)]));
    // downward-closure violation: completable now, but not before an additive pick => false-dim at `before`
    for (const id of watch)
      if (!prev.get(id) && cur.get(id)) {
        const key = `${Object.entries(before).sort().map(([k, v]) => `${k}:${v}`).join(",")}|${id}`;
        if (!seen.has(key)) { seen.add(key); found.push({ label: `${nameOf(id)} wrongly dim (seed ${s}, step ${step})`, sel: before, con: id }); }
      }
    prev = cur;
  }
  process.stdout.write(".");
}

console.log(`\n\n${found.length} distinct false-dims over ${picks} additive picks (${(100 * found.length / Math.max(1, picks)).toFixed(1)}% of picks revealed one).`);
const byCon = new Map<string, number>();
for (const f of found) byCon.set(f.con, (byCon.get(f.con) ?? 0) + 1);
const top = [...byCon.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
console.log(`\nmost-affected constellations (wrongly dimmed despite being reachable):`);
for (const [id, n] of top) console.log(`  ${String(n).padStart(3)}x  ${nameOf(id)}`);

if (DUMP) {
  const path = resolve(root, "web", "test", "fixtures", "false-dims.json");
  await Bun.write(path, `${JSON.stringify({ cases: found })}\n`);
  console.log(`\nwrote ${found.length} cases to web/test/fixtures/false-dims.json`);
}
if (found.length) console.log("\nEach case is a build the engine wrongly dims; the downward-closure invariant test enforces this stays empty once the resolver is fixed.");
