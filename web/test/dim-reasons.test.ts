// ABOUTME: A dim verdict must come with its reasons: the fewest points the target needs (searched past
// ABOUTME: the cap), the affinity it is short and who sets that need, and the members that need transient affinity.
import { test, expect } from "bun:test";
import doc from "../../data/devotions.json";
import { buildModel } from "../src/core/model";
import { canonicalStarIds, decodeHash } from "../src/core/urlState";
import { buildCoverTable, buildReachCons, reachabilityForSelection, selectionSummary } from "../src/core/reachability";
import { affinityDeficits, dimReport, membersNeedingScaffold } from "../src/core/dimReasons";

const model = buildModel(doc as any);
const cons = buildReachCons(model);
const table = buildCoverTable(cons);
const canon = canonicalStarIds(model);

// A real user's link: 50 points at cap 55, eleven complete constellations, Order 6 against Scales of
// Ulcama's 8. Lion (+3 Order, 3 stars) lit up; Dryad (+3 Order, 5 stars) did not, and the user asked
// why when "the only thing missing is 2 Order".
const HASH = "#p=55&s=AAAAgAQAAMADwAMAAAAAAMADAAAAAAAAAIA_AAAAwA8A4AcAAAAAAPADAAA_AD4";
const build50 = decodeHash(HASH, canon)!.selected;
const withCon = (sel: Set<string>, conId: string, k?: number): Set<string> => {
  const out = new Set(sel);
  const ids = model.constellations.get(conId)!.starIds;
  for (const sid of ids.slice(0, k ?? ids.length)) out.add(sid);
  return out;
};
const ORDER = 3; // AFFINITIES index

test("the current selection is short 2 Order, and Scales of Ulcama is the constellation that needs it", () => {
  const st = selectionSummary(model, build50);
  expect(affinityDeficits(model, st)).toEqual([{ color: ORDER, count: 2, sources: ["scales_of_ulcama"] }]);
});

test("four members can only be activated with affinity the rest of the build does not supply", () => {
  // Blades of Nadaan needs Ascendant 10 (the rest supply 7), Murmur Chaos 3 (1), Scales Order 8 (4),
  // Solemn Watcher Primordial 10 (7). Listed in map order, so the phrase is stable across sessions.
  const st = selectionSummary(model, build50);
  expect(membersNeedingScaffold(model, st)).toEqual([
    "blades_of_nadaan",
    "murmur_mistress_of_rumors",
    "scales_of_ulcama",
    "solemn_watcher",
  ]);
});

test("Dryad: a 55-point build with no legal last move needs 56, has no affinity deficit, and names the scaffold needers", () => {
  const r = dimReport(model, cons, table, withCon(build50, "dryad"));
  expect(r.needs).toBe(56);
  expect(r.deficit).toEqual([]);
  expect(r.scaffolders).toEqual([
    "blades_of_nadaan",
    "murmur_mistress_of_rumors",
    "scales_of_ulcama",
    "solemn_watcher",
  ]);
});

test("Lion: the 53-point build needs 54 (one transient point while the last self-dependent member activates)", () => {
  const r = dimReport(model, cons, table, withCon(build50, "lion"));
  expect(r.needs).toBe(54);
  expect(r.deficit).toEqual([]);
});

test("a locked star's report is about its own path: Dryad's third star needs 56, its second 55", () => {
  expect(dimReport(model, cons, table, withCon(build50, "dryad", 3)).needs).toBe(56);
  expect(dimReport(model, cons, table, withCon(build50, "dryad", 2)).needs).toBe(55);
});

test("a completion that leaves the affinity short reports the short colors and who needs them", () => {
  // Oleron alone requires Ascendant 20 and Order 7 and grants nothing: both deficits are Oleron's own.
  const r = dimReport(model, cons, table, withCon(new Set(), "oleron"), 20);
  expect(r.deficit).toEqual([
    { color: 0, count: 20, sources: ["oleron"] },
    { color: ORDER, count: 7, sources: ["oleron"] },
  ]);
  expect(r.needs).toBeNull(); // 7 stars plus 27 affinity does not fit in 20
  expect(r.scaffolders).toEqual(["oleron"]);
});

test("needs is null when no budget within the search bound builds the target", () => {
  // Every constellation with a big requirement plus a tiny bound: nothing fits.
  const r = dimReport(model, cons, table, withCon(new Set(), "leviathan"), 10);
  expect(r.needs).toBeNull();
});

// The verdicts themselves, pinned as a false-reach guard: lighting Dryad here would be a bug (no legal
// last move exists at 55), while Crane (same 5 stars and Order 1 requirement, but a grant of 5) lets
// Scales of Ulcama be the last piece and is rightly lit.
test("Lion and Crane are completable at 55, Dryad is not, and exactly two Dryad stars are reachable", () => {
  const view = reachabilityForSelection(model, cons, table, build50, 55);
  expect(view.completable.has("lion")).toBe(true);
  expect(view.completable.has("crane")).toBe(true);
  expect(view.completable.has("dryad")).toBe(false);
  const dryad = model.constellations.get("dryad")!.starIds;
  expect(dryad.filter((s) => view.reachableStars.has(s))).toEqual(dryad.slice(0, 2));
});
