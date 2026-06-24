// ABOUTME: Heavy reachability validation for big algorithm changes (minutes, not the fast suite). Cross-
// ABOUTME: checks the engine against the BFS oracle at scale (both directions) and harvests ground-truth
// ABOUTME: real-model false-dims via the scaffold-refund constructor. Exits non-zero on any disagreement.
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { buildReachCons, buildCoverTable, classifyForSelection } from "../src/core/reachability";
import { randModel, reachableSet, extendableReachable, stateFromCounts, mulberry32, type Counts } from "../test/support/reach-oracle";
import { genSelfCovering, constructReachable } from "../test/support/walk-fuzzer";

const arg = (name: string, def: number) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
};
const aSeeds = arg("--a-seeds", 4000); // small-model oracle-match seeds
const bSeeds = arg("--b-seeds", 12000); // real-model false-dim harvest seeds

// Part A: the classifier must match the exhaustive BFS oracle in both directions on small models.
console.log(`Part A: oracle-match on ${aSeeds} small models (both directions)...`);
let aFalseDim = 0;
let aFalseReach = 0;
let aCases = 0;
for (let seed = 1; seed <= aSeeds; seed++) {
  const rng = mulberry32(seed);
  const { cons, budget } = randModel(rng);
  const R = reachableSet(cons, budget, 120_000);
  if (!R) continue;
  const table = buildCoverTable(cons);
  for (let t = 0; t < 3; t++) {
    const S: Counts = cons.map(() => 0);
    const nStart = 1 + Math.floor(rng() * 3);
    let tot = 0;
    for (let n = 0; n < nStart; n++) {
      const i = Math.floor(rng() * cons.length);
      if (S[i]! > 0) continue;
      const want = 1 + Math.floor(rng() * cons[i]!.size);
      if (tot + want > budget) continue;
      S[i] = want;
      tot += want;
    }
    if (S.every((v) => v === 0)) continue;
    aCases++;
    const truth = extendableReachable(S, R);
    const reach = classifyForSelection(cons, table, stateFromCounts(S, cons), budget) === "reachable";
    if (truth && !reach) aFalseDim++;
    if (!truth && reach) aFalseReach++;
  }
}
console.log(`  cases=${aCases}  falseDim=${aFalseDim}  falseReach=${aFalseReach}`);

// Part B: real-model false-dims. A self-covering build the engine dims, confirmed reachable by a real
// construction, is an unarguable engine error. (This direction only; over-approximation is covered by A.)
console.log(`\nPart B: real-model false-dim harvest over ${bSeeds} user-like self-covering builds...`);
const model = buildModel(doc as any);
const cons = buildReachCons(model);
const table = buildCoverTable(cons);
const nameOf = new Map([...model.constellations.values()].map((c) => [c.id, c.name]));
let gen = 0;
let realFalseDim = 0;
const examples: string[] = [];
for (let seed = 1; seed <= bSeeds; seed++) {
  const b = genSelfCovering(cons, 55, mulberry32(seed * 7 + 1));
  if (!b) continue;
  gen++;
  if (classifyForSelection(cons, table, stateFromCounts(b, cons), 55) === "reachable") continue;
  if (constructReachable(cons, b, 55)) {
    realFalseDim++;
    if (examples.length < 5) examples.push(cons.map((c, i) => (b[i] ? `${nameOf.get(c.id) ?? c.id}` : "")).filter(Boolean).join("+"));
  }
}
console.log(`  self-covering=${gen}  CONFIRMED false-dims (reachable but engine-dimmed)=${realFalseDim}`);
for (const e of examples) console.log(`    e.g. ${e}`);

const errors = aFalseDim + aFalseReach + realFalseDim;
console.log(`\n${errors === 0 ? "PASS" : "FAIL"} - total engine disagreements with ground truth: ${errors}`);
process.exit(errors === 0 ? 0 : 1);
