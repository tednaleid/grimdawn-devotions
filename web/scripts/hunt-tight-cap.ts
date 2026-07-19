// ABOUTME: Harvests the tight-cap adversarial build-order corpus: sweeps seeded valid builds, ranks
// ABOUTME: their live orders by construction peak (closeness to the 55 cap) and refund count, and pins
// ABOUTME: the worst offenders into web/test/fixtures/tight-cap-builds.json.
// ABOUTME: Run `just hunt-tight-cap [--seeds N] [--keep K]`. Deterministic: same flags, same file.
import { resolve } from "node:path";
import { buildOrderPath, BUDGET } from "../src/core/reachability";
import { cons, table, generateValidBuild, mulberry32 } from "./reachability-fuzz";

const argNum = (flag: string, def: number): number => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] !== undefined ? Number(process.argv[i + 1]) : def;
};
const SEEDS = argNum("--seeds", 2000);
const KEEP = argNum("--keep", 12);

interface Row { seed: number; peak: number; refunds: number; sel: Record<string, number> }
const rows: Row[] = [];
for (let seed = 1; seed <= SEEDS; seed++) {
  const B = generateValidBuild(mulberry32(seed));
  const steps = buildOrderPath(cons, table, B, BUDGET, 16);
  if (!steps) continue;
  const peak = Math.max(...steps.map((s) => s.heldAfter));
  const refunds = steps.filter((s) => s.kind === "scaffold-refund").length;
  if (!refunds) continue; // only refund-bearing orders stress the drain logic
  const sel: Record<string, number> = {};
  for (const c of B) sel[c.id] = c.size;
  rows.push({ seed, peak, refunds, sel });
}
rows.sort((a, b) => b.peak - a.peak || b.refunds - a.refunds || a.seed - b.seed);
const cases = rows.slice(0, KEEP).map((r) => ({ label: `tight-cap-s${r.seed}-peak${r.peak}-r${r.refunds}`, sel: r.sel }));
const out = resolve(import.meta.dir, "..", "test", "fixtures", "tight-cap-builds.json");
await Bun.write(out, JSON.stringify({ cases }, null, 2) + "\n");
console.log(`kept ${cases.length} of ${rows.length} refund-bearing orders (${SEEDS} seeds swept) -> ${out}`);
for (const c of cases) console.log(`  ${c.label}`);
