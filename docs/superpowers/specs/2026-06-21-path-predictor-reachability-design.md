# Path Predictor / Reachability Mode - Design

Date: 2026-06-21
Status: Draft for review
Resolves: BACKLOG.md item 2 (path predictor). Supersedes item 1 (blocked-activation flash).

## Summary

A planning mode where the user claims constellations in any order, including
far capstones first, and the map continuously shows which other constellations
are still achievable within the 55-point budget, dimming the rest. Deselection
is free (no flashing, no "remove X first" friction). The decision is a pure,
testable function of the claimed set.

The engine answers one question per constellation: "if I add this to what I have
already claimed, does a valid 55-point build still exist that contains all of
it?" That reduces to a minimum-cost set-completion (`minCost`). A P0 probe
(2026-06-21) established that this requires an exact 0/1 search (the cheap
precompute is only a lower bound); see the Algorithm section.

This is a prototype-first effort: build the engine as a pure core, prove its
correctness and speed on the real 109-constellation data, and only then wire it
into the UI. The P0 probe has already corrected the algorithm direction once,
which is the point of going prototype-first.

## Goal

Today the planner only lets the user build strictly bottom-up (Crossroads, then
tier 1, and so on), with flashing feedback when an action is blocked. The new
mode inverts this into a freer, exploratory flow:

- Load with 55 points and nothing claimed: every achievable constellation is
  highlighted.
- Click a constellation you want, even a distant capstone like Leviathan. It is
  claimed, its own stars are spent, and the map re-narrows to what is still
  achievable.
- Keep claiming and watch the options narrow. Deselect anything at any time to
  get its points back.

## Domain facts (from data/devotions.json)

- 109 constellations, 559 stars total. Budget is 55 devotion points (1 star = 1
  point).
- 5 affinity colors: ascendant, chaos, eldritch, order, primordial.
- Affinity is granted only on FULL completion of a constellation. It is a
  standing threshold, never consumed.
- The combined requirement of a SET of constellations is the elementwise MAX of
  their requirements. If accumulated affinity clears the per-color max across the
  set, every member is satisfied at once.
- 5 Crossroads constellations: 1 star, no requirement, grant 1 affinity each.
  They are the only bootstrap.
- 88 constellations grant nonzero affinity (the "filler" universe). 21 grant
  nothing (capstones and dead-ends, e.g. Leviathan, Tree of Life); these are
  never useful as filler.
- Per-color maximum requirement (the useful cap on accumulated affinity, beyond
  which more is worthless): eldritch 20, ascendant 20, primordial 20, order 10,
  chaos 8.
- Example capstones: Leviathan (7 stars, requires eldritch 13 + ascendant 13,
  grants nothing). Tree of Life (6 stars, requires primordial 20 + order 7,
  grants nothing).

## The model

### Claimed set

The user maintains a claimed set S of constellations. Claiming C adds it to S
and spends only C's own stars. There is no affinity gate to claim. So claiming
Leviathan spends 7 stars; the affinity scaffolding it implies is not committed.

### minCost

`minCost(S)` is the minimum total stars of an orderable set B with S subset of B
that fully completes every constellation in S. "Orderable" means there is an
acquisition order in which each constellation's affinity requirement is met by
the accumulated grants of its predecessors.

`minCost` is monotonic and shared: scaffolding is costed but reused. A second
eldritch capstone reuses the eldritch path the first one paid for, so
`minCost({Leviathan, X}) <= minCost(Leviathan) + minCost(X)`. This sharing is
why the model is correct rather than double-counting.

### Highlight predicate

A candidate constellation C stays highlighted (achievable) if and only if:

    minCost(S union {C}) <= 55

This is exactly gd-starnav's feasibility logic. Claiming Leviathan should dim Tree
of Life because `minCost({Leviathan, Tree of Life})` needs to cover
`max((e13,a13),(p20,o7)) = (e13,a13,p20,o7)` from scaffolding that no longer fits
in the remaining points. This is observed in the reference tool; our exact engine
must reproduce it. The P0 relaxations did not (they underestimate, as expected),
so confirming this exact dimming on our data is a prototype acceptance test.

### What the user sees

- The points readout stays the existing "stars used / 55" convention, counting
  only OWN STARS actually placed. Claiming Leviathan reads 7 / 55 (7 placed, 48
  free), not the 22 / 55 a `55 - minCost(S)` readout would show. Rationale:
  `55 - minCost(S)` moves in large, non-intuitive jumps (claiming Leviathan would
  drop the free figure by roughly 33 for a 7-star click, because minCost bakes in
  unplaced shared scaffolding) and "reserved" points are shared and non-additive,
  so they cannot be displayed predictably. Own-stars moves one per star; the
  dimming carries the "what is still compatible" signal.
- A dimmed constellation explains itself on demand (on hover), for example
  "needs about N more points than fit alongside your claims". The explanation
  appears where the question is asked instead of polluting the counter.

### Hidden honest pool

`effectiveRemaining = 55 - minCost(S)` is computed but not shown on the headline.
It governs the leftover-star feature below and feeds the hover explanation.

### Free deselection

Removing C from S and recomputing is automatic. Because minCost is monotonic,
`effectiveRemaining` only rises on removal, so giving points back never strands a
claim. No flashing, no blockers, by construction. This is why this mode
supersedes backlog item 1 (the forward-flash): it is no longer needed.

### Leftover individual stars

Partial picks (the classic "2 leftover points" case) are a separate ledger P of
stars that grant no affinity. They never feed minCost and never change any
requirement. A partial star is placeable while `effectiveRemaining - |P| >= 1`,
so leftover points work at any time, not only at the end. If a partially picked
constellation is later fully completed, its stars are absorbed into S and start
contributing affinity.

The exact rule for WHICH individual stars are offered (predecessor order, the
constellation being affinity-startable in the realized build) reuses the
existing `selectableStars` logic and is pinned during the prototype.

## Algorithm

### Resolution (2026-06-21): the crossroads-refund reframe makes it tractable

The P0/P1 sections below trace a wrong turn: they treat strict acquisition
*order* as a hard constraint, which makes the exact answer NP-hard and pure-TS
intractable. The fix (Ted's insight) is that a 1-star Crossroads bootstrap is
effectively free: it has no requirement, grants 1 affinity, and can be deleted
once the constellation it seeded is self-sustaining (its own grant meets its own
requirement). So orderability is not a real cost, and a build is simply valid
when its total affinity covers every member's requirement - exactly the rule the
app's `validClosure` already uses.

Under that rule `minCost(claimed)` is bracketed by two fast computations
(`web/src/core/reachability.ts`):

- A dense 0/1 cover table (`buildCoverTable`): min stars of a subset whose summed
  affinity reaches a target. It is a sound LOWER bound, so `coverLowerBound > 55`
  proves "dim". Built once (about 5 s for the full grid; precompute at build time
  or in a worker), then O(1) lookups.
- A refund-aware greedy (`greedyMinCost`): constructs a real valid build seeded by
  the free crossroads. It is a sound UPPER bound, so `<= 55` proves "reachable".

`classify` returns reachable / dim / unknown from the bracket; a full 109-candidate
sweep is under 2.5 ms. Validated against a brute oracle (same self-sustaining rule)
on 400 random models: the cover never over-counts and the greedy never
under-counts, so the engine never lies (it only ever says "unknown" in the narrow
gap). Real data: nothing dims from one capstone, but two capstones dim ~48
candidates and four dim everything - the "watch it narrow" behavior, working.

Open items: the "unknown" gap (up to ~13 candidates at 2-3 claims) needs a
tiebreaker (tighter greedy, or a bounded exact resolve); the cover build (~5 s)
should move to build time or a worker. The P0/P1 notes below are kept for the
record but are superseded by this section.

### What the P0 probe established (2026-06-21)

A throwaway probe over the real data overturned the precompute-as-answer plan:

- The capped affinity space is dense, not a sparse frontier: 916,541 of 916,839
  cells are reachable. There is no small Pareto frontier to exploit; the natural
  structure is a dense table.
- Dense tables are cheap: a requirement-respecting reach table builds in about
  750 ms (about 900 KB as Uint8), a 5D suffix-min cover table in about 33 ms, and
  a full 109-candidate sweep of O(1) cover lookups runs in about 0.06 ms.
- BUT every cheap dense formulation is a relaxation that is too loose to be
  correct. Both subset-sum (ignoring filler requirements) and a
  requirement-respecting label-setting over `(cost, affinity)` states that does
  not track which constellations are used (so it allows reuse) put
  `minCost(Leviathan + Tree of Life)` at 51 to 52 (at or under 55) and dim
  nothing, while the real behavior dims Tree of Life. The gap is the 0/1
  constraint: the relaxations repeat the most efficient affinity constellations
  (the 1.5-affinity-per-star duals such as Quill and Toad), which a real build,
  taking each constellation at most once, cannot.

Conclusion: exact reachability requires a 0/1 search that tracks the chosen
constellation set (the NP-hard core). A precomputed dense table is a fast lower
bound only, and on this data the bound does not by itself separate the borderline
cases, so it cannot replace the search.

### Source of truth: exact 0/1 search

`minCost(S)` is the minimum-cost orderable set B that includes S, uses each
constellation at most once, and whose summed grants cover the elementwise-max
requirement of B's members. This is gd-starnav's model: a guided search that
tracks the chosen set (its `valid_states` finds a covering set over a chosen
bitmask, `reach` verifies a valid acquisition order). This search is the engine's
source of truth.

### Dense lower-bound table (pruning aid, not the answer)

The dense requirement-respecting reach table (reuse allowed) plus its 5D
suffix-min cover table gives an admissible lower bound on `minCost` in O(1). It is
useful as a fast pre-filter (if the lower bound for `S union {C}` already exceeds
55, C dims with no search) and as the heuristic inside a branch-and-bound exact
search. It is not the answer on its own.

### P1 result (2026-06-21): exact pure-TS is not viable; greedy is fast but approximate

The exact 0/1 search was built and validated in TypeScript
(`web/src/core/reachability.ts`, tests in `web/test/reachability.test.ts`):

- Correct: `exactMinCost` matches a brute-force oracle on 300+ random models.
- Intractable on real data: ~548,000 nodes for a single claimed capstone (about a
  second), and it exceeds a 3,000,000-node cap without resolving two capstones. A
  per-click 109-candidate sweep would take seconds to minutes, and with any
  practical node cap the search returns wrong answers (false dims). The node count
  is representation-independent, so this is an algorithmic wall, not a constant
  factor. Pure-TS exact is out for the interactive hot path.
- A greedy build (`greedyMinCost`) is fast (a full 109-sweep is 3 to 5 ms) and
  sound for "reachable" (0 false positives vs the oracle on 300 models: if it
  finds a build it genuinely exists), but has a ~8 percent false-dim rate, so it
  is not a sound "dim" oracle on its own.

Design-significant finding: at 55 points almost nothing actually dims. Greedy (a
sound reachability witness) finds a cost-53 build for Leviathan + Tree of Life, so
that pair does NOT conflict; the exact search's "dims" was a false dim from the
node cap. The "claim a capstone and watch many others dim" premise barely holds on
this data, which should be revisited before building the UI.

Options going forward: (a) reuse gd-starnav's C++/WASM for the exact answer;
(b) accept greedy's rare false dims (gd-starnav itself ships a heuristic);
(c) reconsider the dimming feature given how seldom constellations actually
conflict at 55 points.

## Precompute: size, role, technology

The precompute question is now answered (P0). There is no sparse frontier (the
space is dense). What we can precompute is the dense lower-bound table, and its
role is reduced to a pruning aid, not the source of truth.

### Size (measured)

The dense reach table is one Uint8 per capped affinity cell:
`21 x 21 x 21 x 11 x 9 = 916,839` cells, about 895 KB. The cover table is the
same size. Build time about 750 ms for the reach table plus about 33 ms for the
suffix-min cover. O(1) lookups: a full 109-candidate sweep in about 0.06 ms.

### Where it is computed

The dense table can be built at page load (about 0.8 s, borderline) or shipped as
a roughly 900 KB Uint8 blob (compresses well). Because it is only a pruning aid
now, this choice is low stakes and deferred. The exact-search engine does not
depend on shipping any artifact.

### Technology

Plain TypeScript with a typed array (`Uint8Array`) indexed by a packed affinity
key, with a 5D suffix-min for the cover table. The exact 0/1 search is also plain
TypeScript (pending the performance probe).

DuckDB and Parquet are explicitly rejected. The data is small and the hot path is
a typed-array index and a guided in-memory search; a SQL or columnar engine adds a
WASM bundle, async init, and query-planning overhead that are the opposite of what
a per-click in-process computation needs. They would only earn their keep for
large analytical queries over much more data, which this design does not have.

## Hexagonal architecture

The engine is a pure core with no DOM or IO:

- `web/src/core/reachability.ts`:
  - `buildLowerBoundTable(model)` returns the dense cover table (the pruning aid).
  - `minCost(model, ctx, S)` returns the exact minimum-cost completion via the
    0/1 search, using the lower-bound table to prune.
  - `achievableConstellations(model, ctx, S)` returns the set of constellation
    ids that stay highlighted.
  - `effectiveRemaining(model, ctx, S)` returns the hidden honest pool.
- Inputs are the existing `DevotionModel` plus the precomputed lower-bound table.
  No new ports needed.
- The existing star-level `selectableStars` stays as the Layer 2 rule for
  immediate star pickability and leftover-point allocation.

Integration (a later phase, after the prototype): `main.ts` `refresh()` calls
`achievableConstellations` and passes the set into `svgRenderer` for a
dim/highlight state, alongside the existing render. The strict gating and the
`removalBlockers` flash path are removed in this mode.

## UI changes (later phase, high level)

- Highlight achievable constellations, dim unachievable ones (compare the
  existing unmet-affinity fade).
- Free deselection: drop the blocked-deselection flash.
- Hover on a dimmed constellation: show the point shortfall.
- Points readout shows own stars out of 55.
- This supersedes backlog item 1.

## Prototype-first plan

The prototype is a pure core plus a test and benchmark harness over the real
data. No UI.

- P0 (done, 2026-06-21): Built the dense reach and cover tables on real data and
  measured them. Result: the space is dense, dense lookups are fast, but the
  relaxations are too loose to be correct. See "What the P0 probe established".
- P1 (done, 2026-06-21): Built and validated the exact 0/1 search plus a greedy
  upper bound in `web/src/core/reachability.ts`. Result: exact is correct but
  intractable in pure TS; greedy is fast and sound for "reachable" but ~8%
  false-dim. See "P1 result" above. Pure-TS exact is out.
- P2 (revisit the premise first): the data shows almost nothing dims at 55 points
  (Leviathan + Tree of Life is reachable), so confirm the dimming feature is worth
  building before more engine work. If yes, pick a path: gd-starnav WASM for exact
  answers, or accept greedy's rare false dims. Then validate the empty,
  leftover-star, and free-deselect scenarios against whichever engine is chosen.
- P3: Confirm a full recompute (all 109 candidates) lands under one frame. Greedy
  already does (3 to 5 ms); the exact path does not.

## Testing

- TDD throughout.
- Oracle: a brute-force minimum-cost solver on small synthetic models validates
  the frontier and the search.
- Scenario tests on the real data (the P2 list).
- Properties: monotonicity (deselect never lowers achievability), determinism.

## Performance target

A full recompute of all 109 candidates under 16 ms (one frame). The 0.06 ms
measured in P0 was the relaxation, which is too loose; the exact 0/1 search cost
is unvalidated, so this target is a requirement to prove in P1, not a result.

## Risks and open questions

- Resolved (P1): exact 0/1 search performance in pure TypeScript. It is not
  viable (intractable on real data). Remaining engine options are WASM or the
  greedy approximation.
- Premise risk (new, raised by P1): at 55 points almost nothing dims, so the core
  user value ("claim a capstone, watch others narrow") may be too weak to justify
  the feature. Revisit before building the UI.
- If the feature proceeds: choosing between gd-starnav WASM (exact) and greedy
  (fast, ~8% false dims), and how to present a possibly-wrong dim.
- The exact "which individual stars" rule for leftover points (refine later).
- UI legibility of dim plus hover explanation (defer to the UI phase).

## References

- Resource-constrained shortest path, label-setting and dominance: Irnich and
  Desaulniers, 2005.
- Multiobjective knapsack Pareto frontier: Nemhauser and Ullmann.
- Build-order optimization as resource-accumulation search: Churchill and Buro,
  2011 ("Build Order Optimization in StarCraft").
- gd-starnav (arctice.github.io/gd-starnav): the reference tool. We adopt its
  feasibility-based dimming logic and reject its own-stars-only points readout in
  favor of an honest hidden pool plus an own-stars headline.
