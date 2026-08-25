// ABOUTME: Build-order quality over the pinned 150-seed synthetic corpus + repro URL and the 99-build
// ABOUTME: real corpus climb-off vs climb-on: per-build churn/steps CSV on stdout, aggregates on stderr.
import {
  buildOrderPath,
  buildOrderCandidates,
  selectionSummary,
  BUDGET,
  churnPoints,
  type BuildStep,
} from "../src/core/reachability";
import { model, cons, table, generateValidBuild, mulberry32 } from "./reachability-fuzz";
import { canonicalStarIds, decodeHash } from "../src/core/urlState";
import realJson from "../test/fixtures/real-builds.json";

const SEEDS = 150; // must match web/test/build-order-oracle.test.ts
console.log("build,churn,steps");
let orders = 0;
let churn = 0;
let stepsTotal = 0;
for (let seed = 1; seed <= SEEDS; seed++) {
  const B = generateValidBuild(mulberry32(seed));
  const selected = new Set<string>();
  for (const m of B) for (const sid of model.constellations.get(m.id)!.starIds) selected.add(sid);
  const members = selectionSummary(model, selected).built;
  const s = buildOrderPath(cons, table, members, BUDGET, 16);
  if (!s) {
    console.log(`seed-${seed},none,none`);
    continue;
  }
  orders++;
  const c = churnPoints(s);
  churn += c;
  stepsTotal += s.length;
  console.log(`seed-${seed},${c},${s.length}`);
}
const REPRO_HASH = "p=55&s=_38AQAIAAAAAAOAfAAAAAADAAYAHAMAHAAAAAPADPwAAAAAAPw";
const decoded = decodeHash(REPRO_HASH, canonicalStarIds(model))!;
const rm = selectionSummary(model, decoded.selected).built;
const rs = buildOrderPath(cons, table, rm, 55, 16);
console.log(rs ? `repro,${churnPoints(rs)},${rs.length}` : "repro,none,none");
console.error(
  `aggregate: orders=${orders}/${SEEDS} churn=${churn} steps=${stepsTotal}` +
    (rs ? ` | repro: churn=${churnPoints(rs)} steps=${rs.length}` : " | repro: NO ORDER"),
);

const real = realJson as unknown as { builds: { calc: string; title: string; starIds: string[] }[] };
const CONFIGS = [
  { name: "climb-off", climbEvals: 0 },
  { name: "climb-on", climbEvals: undefined }, // undefined takes the shipped default (CLIMB_EVALS)
] as const;

const slugOf = (calc: string) => calc.slice(calc.lastIndexOf("/") + 1);
const byChurnThenSteps = (a: BuildStep[], b: BuildStep[]) =>
  churnPoints(a) - churnPoints(b) || a.length - b.length;
const byStepsThenChurn = (a: BuildStep[], b: BuildStep[]) =>
  a.length - b.length || churnPoints(a) - churnPoints(b);

console.log("build,config,churn,steps,ms,divergent");
const agg = new Map<string, { orders: number; churn: number; steps: number; divergent: number; ms: number }>();
for (const c of CONFIGS) agg.set(c.name, { orders: 0, churn: 0, steps: 0, divergent: 0, ms: 0 });
for (const b of real.builds) {
  const members = selectionSummary(model, new Set(b.starIds)).built;
  for (const cfg of CONFIGS) {
    const t0 = performance.now();
    const c = buildOrderCandidates(cons, table, members, BUDGET, 32, 3000, cfg.climbEvals);
    const ms = performance.now() - t0;
    // `pick` reproduces buildOrderPath's rule exactly (churn, then steps, greedy on a full tie,
    // over the two shipped generators), so the churn and steps columns are the panel's own numbers.
    // `alt` is the steps-first alternative over every candidate the sampler tracked.
    const shipped = [c.greedy, c.sampler].filter((s): s is BuildStep[] => s !== null);
    const pool = [...shipped, c.samplerStepsFirst].filter((s): s is BuildStep[] => s !== null);
    const a = agg.get(cfg.name)!;
    a.ms += ms;
    if (shipped.length === 0) {
      console.log(`${slugOf(b.calc)},${cfg.name},none,none,${ms.toFixed(1)},`);
      continue;
    }
    const pick = [...shipped].sort(byChurnThenSteps)[0]!;
    const alt = [...pool].sort(byStepsThenChurn)[0]!;
    const divergent = churnPoints(pick) !== churnPoints(alt) || pick.length !== alt.length;
    a.orders++;
    a.churn += churnPoints(pick);
    a.steps += pick.length;
    if (divergent) a.divergent++;
    console.log(
      `${slugOf(b.calc)},${cfg.name},${churnPoints(pick)},${pick.length},${ms.toFixed(1)},${divergent ? 1 : 0}`,
    );
  }
}
for (const cfg of CONFIGS) {
  const a = agg.get(cfg.name)!;
  console.error(
    `real corpus @ ${cfg.name}: orders=${a.orders}/${real.builds.length} churn=${a.churn} ` +
      `steps=${a.steps} divergent=${a.divergent} mean_ms=${(a.ms / real.builds.length).toFixed(1)}`,
  );
}
