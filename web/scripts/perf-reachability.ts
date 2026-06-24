// ABOUTME: Seeded, UI-free perf harness for the engine's PER-CLICK cost = selectionView (the validity-floor
// ABOUTME: search PLUS the dimming sweep), the exact work one UI refresh does. THIS is the core engine to
// ABOUTME: optimize so the UI is fast; the harness never wires up the DOM. Two passes: (1) demanding
// ABOUTME: singletons - each non-self-covering constellation selected WHOLE from empty (the multi-second
// ABOUTME: freeze cases, e.g. Affliction); (2) seeded random play, timing selectionView after every star.
// ABOUTME: Run `just perf` (deployed WASM path) or `just perf --ts` (the pure TS core algorithm you iterate
// ABOUTME: on). Flags: --seeds N --start S --cap C --max-ms M --replay S --ts. NOTE: until the engine is
// ABOUTME: optimized a single demanding click can take seconds, so the random sweep defaults to few seeds.
import { buildModel } from "../src/core/model";
import { buildReachCons, buildCoverTable, reachabilityForSelection, selectionView, selectionSummary, setExactResolver, type ReachCon } from "../src/core/reachability";
import { loadWasmResolver } from "../src/adapters/reachWasm";
import type { DevotionModel } from "../src/core/types";
import { fileURLToPath } from "url";
import { resolve } from "path";

// --- args -------------------------------------------------------------------
function argNum(flag: string, def: number): number {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] !== undefined ? Number(process.argv[i + 1]) : def;
}
const SEEDS = argNum("--seeds", 8); // selectionView per-click is seconds at demanding states until optimized; scale up once fast
const START = argNum("--start", 1);
const CAP = argNum("--cap", 55);
const MAX_MS = argNum("--max-ms", 400); // accepted bar: a ~350ms first-hit on the hardest borderline state
const REPLAY = process.argv.indexOf("--replay") >= 0 ? argNum("--replay", 1) : null;
const FORCE_TS = process.argv.includes("--ts"); // force the pure TS resolver (skip reach.wasm)

// --- model + table (built once; the UI loads this from a blob) --------------
const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(scriptPath, "..", "..", "..");
const jsonText = await Bun.file(resolve(root, "data", "devotions.json")).text();
export const model: DevotionModel = buildModel(JSON.parse(jsonText));
export const cons = buildReachCons(model);
const tTable = performance.now();
export const table = buildCoverTable(cons);
console.log(`cover table built in ${(performance.now() - tTable).toFixed(0)} ms over ${cons.length} constellations`);

// Use the shipped WASM resolver if present (just wasm), so the harness measures the real path.
// Pass --ts to force the pure TS resolver (to compare distributions).
if (!FORCE_TS) {
  const wasmFile = Bun.file(resolve(root, "data", "reach.wasm"));
  if (await wasmFile.exists()) {
    const r = await loadWasmResolver(await wasmFile.arrayBuffer(), cons, table);
    if (r) { setExactResolver(r); console.log("resolver: WASM (data/reach.wasm)"); } else console.log("resolver: TS (reach.wasm failed to load)");
  } else console.log("resolver: TS (no data/reach.wasm; run `just wasm`)");
} else console.log("resolver: TS (forced via --ts)");

const reqSum = (id: string) => { const c = cons.find((x) => x.id === id)!; return c.req[0] + c.req[1] + c.req[2] + c.req[3] + c.req[4]; };
const outerIds = [...model.constellations.values()].map((c) => c.id).filter((id) => reqSum(id) > 0);
const nameOf = (id: string) => model.constellations.get(id)?.name ?? id;
console.log(`outer constellations (require affinity): ${outerIds.length} of ${model.constellations.size}\n`);

function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = <T>(rng: () => number, arr: T[]): T => arr[Math.floor(rng() * arr.length)]!;

export interface Step { seed: number; idx: number; own: number; ms: number; completable: number; clickable: number; partials: number; clicked: string }
const allSteps: Step[] = [];

/** Play one seeded game; record a timed sweep after every star click.
 *  onStep, if given, receives a clone of the selection after each sweep (for instrumentation). */
export function playGame(seed: number, verbose = false, onStep?: (selected: Set<string>, step: Step) => void): Step[] {
  const rng = mulberry32(seed);
  const selected = new Set<string>();
  const steps: Step[] = [];
  let idx = 0;

  // A timed sweep on the CURRENT selection = the latency the UI shows after a click.
  let lastView = reachabilityForSelection(model, cons, table, selected, CAP);
  const sweep = (clicked: string): void => {
    const t = performance.now();
    const view = selectionView(model, cons, table, selected, CAP); // the FULL per-click cost (floor + sweep)
    const ms = performance.now() - t;
    lastView = view.reach;
    const st = selectionSummary(model, selected);
    const step: Step = { seed, idx: idx++, own: selected.size, ms, completable: lastView.completable.size, clickable: lastView.clickable.size, partials: st.partialFinish.length, clicked };
    steps.push(step);
    onStep?.(new Set(selected), step);
    if (verbose) console.log(`  step ${String(step.idx).padStart(3)}  own ${String(step.own).padStart(2)}  ${ms.toFixed(1).padStart(7)} ms  completable ${String(step.completable).padStart(2)}  clickable ${String(step.clickable).padStart(2)}  partials ${step.partials}  +${clicked}`);
  };

  // Click every star of a constellation in predecessor order, measuring after each new star.
  // Returns false if the budget filled mid-constellation (game over).
  const completeCon = (conId: string): boolean => {
    const c = model.constellations.get(conId)!;
    for (const sid of c.starIds) {
      if (selected.has(sid)) continue;
      if (selected.size >= CAP) return false;
      selected.add(sid);
      sweep(`${nameOf(conId)}:${sid.split(":").pop()}`);
      if (selected.size >= CAP) return false;
    }
    return true;
  };

  // Seed: two random OUTER constellations the player could actually reach (completable when picked).
  const startOuter = outerIds.filter((id) => lastView.completable.has(id));
  if (startOuter.length) {
    const first = pick(rng, startOuter);
    if (!completeCon(first)) return steps;
    const startOuter2 = outerIds.filter((id) => lastView.completable.has(id) && !selected.has(model.constellations.get(id)!.starIds[0]!));
    if (startOuter2.length) { if (!completeCon(pick(rng, startOuter2))) return steps; }
  }

  // Then keep completing surviving (completable, not-yet-finished) constellations until none fit.
  for (let guard = 0; guard < 200; guard++) {
    const candidates = [...lastView.completable].filter((id) => {
      const c = model.constellations.get(id)!;
      return !c.starIds.every((s) => selected.has(s));
    });
    if (!candidates.length || selected.size >= CAP) break;
    if (!completeCon(pick(rng, candidates))) break;
  }
  return steps;
}

// Set when a demanding singleton exceeds the threshold, so the final exit code reflects it too.
let singletonHotspot = false;

// Deterministic worst case: select each non-self-covering "outer" constellation WHOLE from empty and time
// selectionView. This is exactly the freeze a real user hits (e.g. Affliction from empty), independent of
// random play, so it is the reliable per-click-cost report. Top-K by requirement (where freezes concentrate).
function runSingletons(): void {
  const selfCovers = (c: ReachCon) => c.grant.every((g, j) => g >= c.req[j]!);
  const reqOf = (c: ReachCon) => c.req[0] + c.req[1] + c.req[2] + c.req[3] + c.req[4];
  const demanding = outerIds
    .map((id) => cons.find((c) => c.id === id)!)
    .filter((c) => !selfCovers(c))
    .sort((a, b) => reqOf(b) - reqOf(a))
    .slice(0, 30);
  console.log(`demanding singletons (non-self-covering, top ${demanding.length} by requirement) - selectionView WHOLE from empty:`);
  const rows: { name: string; ms: number; min: number }[] = [];
  for (const c of demanding) {
    const sel = new Set(model.constellations.get(c.id)!.starIds);
    const t = performance.now();
    const view = selectionView(model, cons, table, sel, CAP);
    rows.push({ name: nameOf(c.id), ms: performance.now() - t, min: view.minCost });
  }
  rows.sort((a, b) => b.ms - a.ms);
  for (const r of rows.slice(0, 12)) console.log(`  ${r.ms.toFixed(0).padStart(7)} ms  floor ${String(r.min).padStart(2)}  ${r.name}`);
  const over = rows.filter((r) => r.ms > MAX_MS);
  console.log(`  ${over.length} of ${rows.length} demanding singletons over ${MAX_MS} ms.\n`);
  if (over.length) singletonHotspot = true;
}

// --- CLI (this file also exports model/cons/table/playGame for instrumentation) ---
function runReplay(seed: number): void {
  console.log(`REPLAY seed ${seed} (cap ${CAP}):`);
  const steps = playGame(seed, true);
  const slow = [...steps].sort((a, b) => b.ms - a.ms).slice(0, 5);
  console.log(`\n  ${steps.length} steps, final own ${steps.at(-1)?.own ?? 0}. Slowest:`);
  for (const s of slow) console.log(`    step ${s.idx}  own ${s.own}  ${s.ms.toFixed(1)} ms  (completable ${s.completable}, clickable ${s.clickable}, partials ${s.partials}, +${s.clicked})`);
}

function runSweep(): void {
  const tAll = performance.now();
  let finals = 0;
  for (let s = START; s < START + SEEDS; s++) {
    const steps = playGame(s);
    allSteps.push(...steps);
    finals += steps.at(-1)?.own ?? 0;
    process.stdout.write(".");
  }
  console.log(`\n\nplayed ${SEEDS} games in ${((performance.now() - tAll) / 1000).toFixed(1)} s  (avg final points ${(finals / SEEDS).toFixed(0)}/${CAP})`);

  const ms = allSteps.map((x) => x.ms).sort((a, b) => a - b);
  const q = (p: number) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))]!;
  const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
  console.log(`\nper-click latency over ${ms.length} clicks:`);
  console.log(`  mean ${mean.toFixed(1)} ms   median ${q(0.5).toFixed(1)} ms   p95 ${q(0.95).toFixed(1)} ms   p99 ${q(0.99).toFixed(1)} ms   max ${ms.at(-1)!.toFixed(1)} ms`);

  const worst = [...allSteps].sort((a, b) => b.ms - a.ms).slice(0, 15);
  console.log(`\nslowest 15 clicks (replay a seed with --replay <seed>):`);
  for (const w of worst) console.log(`  seed ${String(w.seed).padStart(4)}  step ${String(w.idx).padStart(3)}  own ${String(w.own).padStart(2)}  ${w.ms.toFixed(1).padStart(7)} ms  completable ${String(w.completable).padStart(2)}  clickable ${String(w.clickable).padStart(2)}  partials ${w.partials}  +${w.clicked}`);

  const over = allSteps.filter((x) => x.ms > MAX_MS);
  console.log(`\n${over.length} click(s) over ${MAX_MS} ms.`);
  if (over.length || singletonHotspot) { console.log("HOTSPOT: per-click latency exceeded the threshold."); process.exit(1); }
  console.log("OK: no hotspots.");
}

if (import.meta.main) { if (REPLAY !== null) runReplay(REPLAY); else { runSingletons(); runSweep(); } }
