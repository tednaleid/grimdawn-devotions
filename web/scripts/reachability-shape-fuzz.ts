// ABOUTME: Shape-biased reachability fuzzer. The generic fuzzer (just validate-reach) makes uniform-random
// ABOUTME: models, which barely produce the shape that caused our real-world trouble - constellations with a
// ABOUTME: MULTI-COLOR requirement that grant those same colors back but not enough to self-pay (Affliction,
// ABOUTME: Vulture, Ghoul, Oklaine). This biases generation toward that shape, with enough providers that
// ABOUTME: every requirement is genuinely achievable (real-map-like abundance), so unreachability comes from
// ABOUTME: BUDGET / construction-peak pressure, not impossible requirements. It checks the engine against the
// ABOUTME: exhaustive BFS oracle in BOTH directions and breaks out the cases that involve the target shape.
// ABOUTME: Run `just shape-fuzz [--seeds N] [--start S] [--dump K]`.
import { buildCoverTable, classifyForSelection, type ReachCon, type Vec } from "../src/core/reachability";
import { reachableSet, extendableReachable, stateFromCounts, mulberry32, type Counts } from "../test/support/reach-oracle";

const argNum = (flag: string, def: number): number => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] !== undefined ? Number(process.argv[i + 1]) : def;
};
const SEEDS = argNum("--seeds", 3000);
const START = argNum("--start", 1);
const DUMP = argNum("--dump", 3); // how many false-reach-with-target-shape counterexamples to print in full

const zero = (): Vec => [0, 0, 0, 0, 0];
const reqColorsOf = (c: ReachCon): number[] => c.req.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
// The target shape: a multi-color requirement whose grant gives back EVERY required color, but not enough
// to cover its own requirement (it needs a temporary bootstrap, then partially pays itself back).
const isTargetShape = (c: ReachCon): boolean => {
  const rc = reqColorsOf(c);
  if (rc.length < 2) return false;
  const selfCovers = c.grant.every((g, i) => g >= c.req[i]!);
  if (selfCovers) return false;
  return rc.every((i) => c.grant[i]! > 0); // pays back something on every required color
};

// Generate a model biased toward the target shape, with abundance so every requirement is achievable.
function randShapeModel(rng: () => number): { cons: ReachCon[]; budget: number } {
  const cons: ReachCon[] = [];
  const nBoot = 2 + Math.floor(rng() * 2); // 2-3 target-shape "outer" constellations
  // Bootstrap-shape outer constellations: 2-3 required colors, grant covers all of them but partially.
  for (let i = 0; i < nBoot; i++) {
    const allColors = [0, 1, 2, 3, 4];
    for (let s = allColors.length - 1; s > 0; s--) {
      const j = Math.floor(rng() * (s + 1));
      [allColors[s], allColors[j]] = [allColors[j]!, allColors[s]!];
    }
    const nReqColors = 2 + Math.floor(rng() * 2); // 2-3 colors -> multi-color
    const req = zero();
    const grant = zero();
    for (let k = 0; k < nReqColors; k++) {
      const ci = allColors[k]!;
      req[ci] = 2 + Math.floor(rng() * 3); // 2-4
      grant[ci] = 1 + Math.floor(rng() * req[ci]!); // 1..req (clamped below to < req so it never self-covers)
      if (grant[ci]! >= req[ci]!) grant[ci] = req[ci]! - 1;
    }
    const size = 2 + Math.floor(rng() * 4); // 2-5 stars
    cons.push({ id: `b${i}`, size, req, grant });
  }
  // Pure providers (no requirement) - the abundance that lets the outer constellations be bootstrapped.
  const nProv = 4 + Math.floor(rng() * 3); // 4-6
  for (let i = 0; i < nProv; i++) {
    const grant = zero();
    grant[Math.floor(rng() * 5)] = 1 + Math.floor(rng() * 3); // 1-3
    cons.push({ id: `p${i}`, size: 1 + Math.floor(rng() * 2), req: zero(), grant });
  }
  // The five crossroads (size 1, one affinity each), matching the engine's refundable seed.
  for (let i = 0; i < 5; i++) {
    const grant = zero();
    grant[i] = 1;
    cons.push({ id: `x${i}`, size: 1, req: zero(), grant });
  }
  // Abundance guarantee: for every required color, top up REQUIREMENT-FREE providers until the supply that
  // is reachable WITHOUT circular bootstrapping comfortably exceeds the max requirement. Only req-free
  // grants count: a target-shape constellation's own grant is locked behind its own requirement, so it
  // cannot bootstrap that color. This makes every requirement genuinely achievable, so unreachability comes
  // from BUDGET / construction-peak pressure (the real-map regime), not circular scarcity.
  const isProvider = (c: ReachCon) => c.req.every((r) => r === 0);
  const maxReq = zero();
  for (const c of cons) for (let i = 0; i < 5; i++) maxReq[i] = Math.max(maxReq[i]!, c.req[i]!);
  // Add at most ONE big-grant size-1 provider per deficient color, so abundance stays cheap in STARS and
  // the model stays small enough for the exhaustive oracle (many small providers blow up the state space).
  for (let i = 0; i < 5; i++) {
    const supply = cons.filter(isProvider).reduce((s, c) => s + c.grant[i]!, 0);
    const need = maxReq[i]! + 2 - supply;
    if (need > 0) {
      const grant = zero();
      grant[i] = need;
      cons.push({ id: `f${i}`, size: 1, req: zero(), grant });
    }
  }
  // Budget tight enough that not every build fits (so unreachable selections - and thus false-reaches - can
  // exist), but loose enough that many do. Tuned to the model's size.
  const total = cons.reduce((s, c) => s + c.size, 0);
  const budget = Math.max(7, Math.min(16, Math.round(total * 0.5)));
  return { cons, budget };
}

let aCases = 0;
let falseDim = 0;
let falseReach = 0;
let falseReachTarget = 0; // false-reaches whose selection contains a target-shape constellation
let falseDimTarget = 0;
let unreachableSels = 0; // genuinely-unreachable selections (the pool in which a false-reach could occur)
let unreachableTargetSels = 0;
let modelsWithTarget = 0;
let skipped = 0;
const dumps: string[] = [];
const colors = ["A", "B", "C", "D", "E"];
const fmt = (v: readonly number[]) => `{${v.map((x, i) => (x > 0 ? `${colors[i]}:${x}` : "")).filter(Boolean).join(" ")}}`;

for (let seed = START; seed < START + SEEDS; seed++) {
  const rng = mulberry32(seed);
  const { cons, budget } = randShapeModel(rng);
  if (cons.some(isTargetShape)) modelsWithTarget++;
  const R = reachableSet(cons, budget, 70_000);
  if (!R) {
    skipped++;
    continue;
  }
  const table = buildCoverTable(cons);
  const targetIdx = cons.map((c, i) => (isTargetShape(c) ? i : -1)).filter((i) => i >= 0);
  for (let t = 0; t < 6; t++) {
    const S: Counts = cons.map(() => 0);
    let tot = 0;
    // Half the trials: STACK the target-shape constellations fully (the tight-budget regime where their
    // combined bootstrap peak can overflow). Other half: the original small random selections.
    if (targetIdx.length && rng() < 0.5) {
      for (const i of targetIdx) {
        if (tot + cons[i]!.size > budget) continue;
        S[i] = cons[i]!.size;
        tot += cons[i]!.size;
      }
    } else {
      const nStart = 1 + Math.floor(rng() * 3);
      for (let n = 0; n < nStart; n++) {
        const i = Math.floor(rng() * cons.length);
        if (S[i]! > 0) continue;
        const want = 1 + Math.floor(rng() * cons[i]!.size);
        if (tot + want > budget) continue;
        S[i] = want;
        tot += want;
      }
    }
    if (S.every((v) => v === 0)) continue;
    aCases++;
    const truth = extendableReachable(S, R);
    const reach = classifyForSelection(cons, table, stateFromCounts(S, cons), budget) === "reachable";
    const selHasTarget = cons.some((c, i) => S[i]! > 0 && isTargetShape(c));
    if (!truth) unreachableSels++;
    if (!truth && selHasTarget) unreachableTargetSels++;
    if (truth && !reach) {
      falseDim++;
      if (selHasTarget) falseDimTarget++;
    }
    if (!truth && reach) {
      falseReach++;
      if (selHasTarget) {
        falseReachTarget++;
        if (dumps.length < DUMP) {
          const lines: string[] = [];
          lines.push(`\n--- FALSE-REACH involving the target shape (seed ${seed}, budget ${budget}) ---`);
          for (const c of cons)
            lines.push(
              `  ${c.id.padEnd(6)} size ${c.size}  needs ${fmt(c.req).padEnd(16)} gives ${fmt(c.grant).padEnd(16)}${isTargetShape(c) ? "  <- TARGET SHAPE" : ""}`,
            );
          const selStr = cons.map((c, i) => (S[i] ? `${c.id}x${S[i]}` : "")).filter(Boolean).join(", ");
          lines.push(`  selection: ${selStr}  -> engine REACHABLE, truth UNREACHABLE`);
          dumps.push(lines.join("\n"));
        }
      }
    }
  }
}

console.log(`shape-biased fuzz: seeds ${START}..${START + SEEDS - 1}  (${skipped} models too big for the oracle, skipped)`);
console.log(`models containing the target shape: ${modelsWithTarget}/${SEEDS - skipped} oracled`);
console.log(`oracle-checked selections: ${aCases}  (of these, ${unreachableSels} are genuinely UNREACHABLE - the`);
console.log(`  pool where a false-reach could occur; ${unreachableTargetSels} of those involve the target shape)`);
console.log(`  false-dim  (legal build wrongly BLOCKED): ${falseDim}   (of those, ${falseDimTarget} involve the target shape)`);
console.log(`  false-reach (illegal selection wrongly LIT): ${falseReach}   (of those, ${falseReachTarget} involve the target shape)`);
for (const d of dumps) console.log(d);
if (falseReachTarget === 0) console.log(`\nNo false-reach involving the target shape was found in this run.`);
