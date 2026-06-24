// ABOUTME: Regenerates web/test/fixtures/reachable-builds.json: ground-truth-reachable builds the current
// ABOUTME: engine wrongly dims (confirmed by the scaffold-refund constructor) plus reachable guards and the
// ABOUTME: named Affliction build. Run via `just gen-reach-fixtures` (slow to make, the test only checks).
import { join } from "node:path";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { buildReachCons, buildCoverTable, classifyForSelection } from "../src/core/reachability";
import { canonicalStarIds, decodeHash } from "../src/core/urlState";
import { genSelfCovering, constructReachable, type ReachableCase } from "../test/support/walk-fuzzer";
import { stateFromCounts, mulberry32, type Counts } from "../test/support/reach-oracle";

const model = buildModel(doc as any);
const cons = buildReachCons(model);
const table = buildCoverTable(cons);
const idToIdx = new Map(cons.map((c, i) => [c.id, i]));
const TARGET_FALSE_DIM = 40; // failing-now cases in the fast fixture (each is slow on today's engine)
const TARGET_GUARD = 110; // reachable builds the engine already handles (must stay reachable after the fix)

const selOf = (counts: Counts): Record<string, number> => {
  const sel: Record<string, number> = {};
  for (let i = 0; i < cons.length; i++) if (counts[i]) sel[cons[i]!.id] = counts[i]!;
  return sel;
};

// The original share link with Affliction completed: the canonical real-user false-dim.
const HASH =
  "#p=55&s=AAAAAAAAAAAAAAAAAAAAAAA8AAD4AAAAOAMA4A_8AAAAAAAAAAAAwA8AAADADz4AAAAAAAAAAAAAAAAAAIA_&b=AAAAAABg";
const afflCounts = cons.map(() => 0);
for (const sid of decodeHash(HASH, canonicalStarIds(model))!.selected) afflCounts[idToIdx.get(model.stars.get(sid)!.constellationId)!]++;
afflCounts[idToIdx.get("affliction")!] = model.constellations.get("affliction")!.starIds.length;
const namedCases: ReachableCase[] = [
  { label: "affliction-share-link-completed", sel: selOf(afflCounts) },
  // A real forum build (lightning "Thunder Warder", levelskip Shaman guide): self-covering at 55 points,
  // proven reachable by the constructor, yet wrongly dimmed by today's engine. A real-world false-dim.
  {
    label: "thunder-warder-real-forum-build",
    sel: { crossroads_order: 1, crossroads_eldritch: 1, crossroads_ascendant: 1, eel: 3, jackal: 3, tortoise: 5, tsunami: 5, chariot_of_the_dead: 7, harvestman_s_scythe: 6, kraken: 5, rhowan_s_crown: 5, tempest: 7, spear_of_the_heavens: 6 },
  },
];

const falseDims: ReachableCase[] = [];
const guards: ReachableCase[] = [];
for (let seed = 1; (falseDims.length < TARGET_FALSE_DIM || guards.length < TARGET_GUARD) && seed <= 200_000; seed++) {
  const b = genSelfCovering(cons, 55, mulberry32(seed * 7 + 1));
  if (!b) continue;
  const reachable = classifyForSelection(cons, table, stateFromCounts(b, cons), 55) === "reachable";
  if (!reachable && falseDims.length < TARGET_FALSE_DIM) {
    // engine dims it; confirm it is genuinely reachable (a real construction exists) before keeping it.
    if (constructReachable(cons, b, 55)) falseDims.push({ label: `false-dim-s${seed}-n${b.reduce((a, x) => a + x, 0)}`, sel: selOf(b) });
  } else if (reachable && guards.length < TARGET_GUARD) {
    guards.push({ label: `guard-s${seed}-n${b.reduce((a, x) => a + x, 0)}`, sel: selOf(b) });
  }
}

const cases = [...namedCases, ...falseDims, ...guards];
const path = join(import.meta.dir, "..", "test", "fixtures", "reachable-builds.json");
await Bun.write(
  path,
  `${JSON.stringify(
    {
      note: "Ground-truth-reachable builds the engine must classify reachable. 'false-dim-*' are confirmed reachable by the scaffold-refund constructor yet dimmed by today's engine (red now, green after the fix); 'guard-*' are reachable builds it already handles. Regenerate with `just gen-reach-fixtures`.",
      counts: { falseDims: falseDims.length, guards: guards.length, named: namedCases.length },
      cases,
    },
    null,
    0,
  )}\n`,
);
console.log(`wrote ${cases.length} cases: ${falseDims.length} confirmed false-dims + ${guards.length} guards + ${namedCases.length} named -> ${path}`);
