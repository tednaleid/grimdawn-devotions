// ABOUTME: Verify the Rust/WASM resolver (data/reach.wasm) is verdict-equivalent to the TS
// ABOUTME: reachableExactFrom: identical reachable/dim answers on random small models AND the real-model
// ABOUTME: fixture builds. Run via `just validate-wasm` after `just wasm`. Exits non-zero on any mismatch.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModel } from "../src/core/model";
import { buildReachCons, buildCoverTable, reachableExactFrom, selectionSummary } from "../src/core/reachability";
import { loadWasmResolver } from "../src/adapters/reachWasm";
import { randModel, mulberry32, stateFromCounts } from "../test/support/reach-oracle";

const root = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const wasmFile = Bun.file(resolve(root, "data", "reach.wasm"));
if (!(await wasmFile.exists())) {
  console.error("data/reach.wasm not found - run `just wasm` first.");
  process.exit(1);
}
const wasmBytes = await wasmFile.arrayBuffer();

let mismatch = 0;
let checked = 0;
const examples: string[] = [];
for (let seed = 1; seed <= 150; seed++) {
  const rng = mulberry32(seed);
  const { cons, budget } = randModel(rng);
  const table = buildCoverTable(cons);
  const wasm = await loadWasmResolver(wasmBytes, cons, table);
  if (!wasm) {
    console.error("WASM load failed");
    process.exit(1);
  }
  for (let t = 0; t < 6; t++) {
    const S = cons.map(() => 0);
    const nStart = 1 + Math.floor(rng() * 3);
    let total = 0;
    for (let n = 0; n < nStart; n++) {
      const i = Math.floor(rng() * cons.length);
      if (S[i]! > 0) continue;
      const want = 1 + Math.floor(rng() * cons[i]!.size);
      if (total + want > budget) continue;
      S[i] = want;
      total += want;
    }
    if (S.every((v) => v === 0)) continue;
    const st = stateFromCounts(S, cons);
    const ts = reachableExactFrom(cons, table, st, budget);
    const w = wasm(cons, table, st, budget);
    checked++;
    if (ts !== w) {
      mismatch++;
      if (examples.length < 6) examples.push(`seed=${seed} budget=${budget} S=${JSON.stringify(S)} ts=${ts} wasm=${w}`);
    }
  }
}
console.log(`small models: ${mismatch} mismatches / ${checked} compared`);
for (const e of examples) console.log(`  ${e}`);

const model = buildModel(JSON.parse(await Bun.file(resolve(root, "data", "devotions.json")).text()));
const cons = buildReachCons(model);
const table = buildCoverTable(cons);
const wasm = await loadWasmResolver(wasmBytes, cons, table);
const fixture = JSON.parse(await Bun.file(resolve(root, "web", "test", "fixtures", "reachable-builds.json")).text());
let rmm = 0;
let rchecked = 0;
if (wasm) {
  for (const c of fixture.cases as { label: string; sel: Record<string, number> }[]) {
    const selected = new Set<string>();
    for (const [id, count] of Object.entries(c.sel)) {
      const con = model.constellations.get(id);
      if (con) for (const sid of con.starIds.slice(0, count)) selected.add(sid);
    }
    const st = selectionSummary(model, selected);
    const ts = reachableExactFrom(cons, table, st, 55);
    const w = wasm(cons, table, st, 55);
    rchecked++;
    if (ts !== w) {
      rmm++;
      if (rmm <= 6) console.log(`  REAL MISMATCH ${c.label}: ts=${ts} wasm=${w}`);
    }
  }
}
console.log(`real fixture: ${rmm} mismatches / ${rchecked} compared`);
if (mismatch + rmm === 0) {
  console.log("VERDICT-EQUIVALENT: WASM matches TS");
  process.exit(0);
}
console.error("MISMATCHES FOUND: WASM diverges from TS");
process.exit(1);
