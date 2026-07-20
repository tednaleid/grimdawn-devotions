// ABOUTME: Build-order quality over the pinned 150-seed corpus + the reproduction URL: per-build
// ABOUTME: churn/steps CSV on stdout, aggregates on stderr. The launch-gate before/after tool.
import { buildOrderPath, selectionSummary, BUDGET, churnPoints } from "../src/core/reachability";
import { model, cons, table, generateValidBuild, mulberry32 } from "./reachability-fuzz";
import { canonicalStarIds, decodeHash } from "../src/core/urlState";

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
