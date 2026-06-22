# Reachability sweep performance: findings and decision record

Status: investigation complete, fix direction recommended but not yet chosen.
Date: 2026-06-22.
Scope: the per-click reachability sweep in `web/src/core/reachability.ts`.

This document records why the reachability sweep can hang, what makes the
problem hard, and which fixes we evaluated and rejected with measurements. It
exists so we do not re-derive the same dead ends. If you are about to "just add
a tighter bound" or "just cache it" or "rewrite it in Rust", read the relevant
section first: we tried it and measured it.

## TL;DR

- The per-click sweep can take 10+ seconds. Root cause: the exact gap-resolver
  (`reachableExactFrom`) is exponential, and the hard instances are infeasible
  by exactly one star (true minimum cost 56 against a budget of 55), so proving
  "dim" requires exhausting on the order of 10^8 search nodes.
- "Provably sound AND fast" is not realistically achievable. The underlying
  decision is a precedence-constrained 0/1 minimum-cost cover, which is NP-hard
  in flavor, and every cheap sound bound we built is too loose to prove the
  borderline dims.
- Ruled out with data: a resolver node cap, a reuse-allowed lattice lower
  bound, a per-color 0/1 lower bound, a tighter in-DFS prune, a bounded beam
  upper bound, a Rust/WASM rewrite, and the exact reformulations (min-cost flow,
  matroid intersection, Lagrangian, ILP, cardinality bounding).
- Recommended direction: leash the exact resolver (node or time cap) and return
  a safe-side "uncertain, lean reachable" verdict when it trips, then verify the
  residual misclassification rate on the harness. This is a verified-on-data
  heuristic, stated plainly. It is the same shape the reference tool (gd-starnav)
  uses.
- Reproduce everything with `just perf` and the probes described in
  "Reproductions" below.

## The decision problem (precise)

The model has about 109 constellations. Each constellation `c` has `size`
(its star count, 1 to 8, which is its cost), `req` (a 5-vector of affinity
requirements), and `grant` (a 5-vector of affinity granted when `c` is
complete). There are 5 affinity colors with hard per-color caps
`[20, 8, 20, 10, 20]`.

A build `B` (a set of constellations) is valid if and only if:

1. Cover: the capped sum of grants over `B` is at least the elementwise maximum
   of `req` over `B` (per color).
2. Constructible: there is an order to add `B`'s members, starting from a
   refundable crossroads seed `[1,1,1,1,1]`, so that each member's `req` is met
   by the seed plus the grants of members already placed. The seed is free
   scaffolding (refundable), so a build is constructible if and only if some
   order places every member with its requirement met.

A selection state additionally has mandatory members (the constellations the
user has started, some complete, some partial). The per-click question, asked
for every candidate "current selection plus one more constellation or one more
star", is: does a valid build exist that includes all started constellations
with total stars no greater than the budget (default 55)? Stars already spent
count against the budget.

### The current algorithm: a bracket plus an exact gap-closer

- Sound lower bound (proves "dim"): a precomputed cover table,
  `cost[D]` = minimum stars of a subset of constellations whose summed capped
  grants reach `D`, built as a 0/1 knapsack over the affinity lattice and
  ignoring constructibility. If `own + coverCost(deficit) > budget`, the
  candidate is genuinely dim. Sound because ignoring constructibility only
  lowers cost.
- Sound upper bound (proves "reachable"): `greedyFrom`, a refund-aware greedy
  that constructs one valid build. If it lands at or under budget, the candidate
  is genuinely reachable.
- The gap: when neither fires, `reachableExactFrom` runs an exact DFS over
  filler subsets, pruned by the cover table, early-exiting on the first witness.
  For a reachable candidate it stops at the first witness. For a dim candidate
  it must exhaust.

The exact gap-closer is the hotspot. Everything below is about it.

## Symptom and root cause (measured)

The seeded harness (`just perf`, `web/scripts/perf-reachability.ts`) simulates
real play: pick two random outer constellations, then keep completing surviving
constellations star by star until the budget is spent, timing
`reachabilityForSelection` (the full per-click sweep) after every star. Over 8
seeds (440 clicks):

```
mean 185.4 ms   median 4.0 ms   p95 1115.8 ms   p99 4393.4 ms   max 10396.9 ms
```

The maximum single click took 10.4 seconds.

Breaking down one bad sweep (seed 5, step 23, 24 stars selected) per candidate
shows where the time goes:

```
213 candidates, total 11154 ms
  cheap-dim:     6
  cheap-reach:   192
  resolver:      15 calls, 11148 ms (100% of sweep)

  4934 ms  [resolver] verdict dim   nodes 94,036,955  click aeon_s_hourglass:0
  3363 ms  [resolver] verdict dim   nodes 62,194,448  click spear_of_the_heavens:0
  1622 ms  [resolver] verdict dim   nodes 29,773,894  complete Ultos, Shepherd of Storms
   690 ms  [resolver] verdict dim   nodes 12,487,382  click yugol_the_insatiable_night:0
   194 ms  [resolver] verdict dim   nodes  2,955,002  complete Oleron
   165 ms  [resolver] verdict reach nodes  2,700,001  complete Revenant
   148 ms  [resolver] verdict reach nodes  2,522,751  complete Rattosh, the Veilwarden
```

Only 15 of 213 candidates reach the resolver, but they consume essentially all
the sweep time. The slow ones are all "dim" verdicts. Reachable candidates
early-exit on a witness and are mostly fast.

### The hard instances are infeasible by exactly one star

This is the key fact. Binary-searching the true minimum budget at which each dim
killer flips to reachable (`reachableExactFrom` at varying budgets), at the same
seed-5 / step-23 state:

```
start Aeon's Hourglass   own 25  soundLB 53  greedyUB INF  trueMinBudget 56  (vs budget 55)  [5006 ms]
start Yugol              own 25  soundLB 53  greedyUB INF  trueMinBudget 56  (vs budget 55)  [1315 ms]
```

The true minimum cost is 56 against a budget of 55. The build misses by one
star. The sound cover-table lower bound reports 53, three stars short, so it
cannot prove dim. The greedy fails to find any build at all (INF). The exact
search must therefore enumerate enough of the subset space to prove that no
55-star build exists, and it is expensive precisely because near-miss 56-star
builds are everywhere. This is the hard region of a constraint-satisfaction
phase transition: the decision is most expensive exactly when the answer is
barely no.

A broader sample by an independent review corroborated this: an ordinary
playthrough hit a single completion check (`+Yugol`, own 17) costing 109.5M
nodes / 4.4 s, and roughly 9 to 12 percent of completion checks fall into the
bracket gap and reach the resolver. The pathology is normal play, not an
adversarial corner.

## Why it is intrinsically hard

The decision is "does a minimum-cost constructible 0/1 cover with mandatory
items fit in the budget". Three properties block a cheap exact answer:

1. 0/1 (each constellation usable once) matters for cost. See "reuse-allowed
   lower bound" below: allowing reuse undercuts the true cost by 3 to 5 stars on
   exactly the colors the capstones need, because the cheapest per-star affinity
   granters (the 1.5-affinity-per-star duals) are few and 0/1 forbids repeating
   them.
2. Constructibility is a precedence gate on top of the 0/1 cover. This is the
   NP-hard core the design spec already identified.
3. The combined requirement is an elementwise maximum over chosen items, not a
   sum. This coupling is why min-cost flow and matroid intersection do not model
   the problem (no flow conservation or matroid rank constraint expresses
   "max").

Because the hard instances miss the budget by one star, any bound that is even
two stars loose proves nothing. You would need an essentially exact bound to
prove these dims, and an exact bound is the exact problem.

## Problem dimensions (for reference)

```
affinity caps (max req per color): [20, 8, 20, 10, 20]
lattice cells: 916,839
constellations: 109   granting (filler pool): 88   require affinity: 104
star sizes: 1 to 8

per color: providers / total grant available / cap
  ascendant   31   90   20
  chaos       22   46    8
  eldritch    33   90   20
  order       22   46   10
  primordial  30   88   20

requiring cons by shape: single-color 51   multi-color 53
```

Note the per-color totals (46 to 90) are 4 to 9 times the caps (8 to 20), with
22 to 33 distinct providers per color. That abundance is why item reuse never
helps you reach a target (distinct providers easily hit any cap), but it does
not stop reuse from lowering the cost, which is the trap in the next section.

## Approaches evaluated and rejected (with data)

### 1. Node cap on the resolver

Idea: cap the DFS node count and return a verdict when it trips.

Measured: at the seed-5 / step-23 state, reachable verdicts cost up to 2.7M
nodes (Revenant) and dim verdicts start at 2.96M (Oleron). A broader sample
found reachable cases up to 10.2M nodes and dim cases as low as 0.23M. The two
distributions overlap across the entire band. Any cap high enough to let the
expensive reachable witnesses through is far too high to bound the dim
exhaustions, and any cap low enough to bound dim will guillotine real reachable
witnesses and falsely dim them.

Verdict: a fixed cap cannot cleanly separate reach from dim. A cap is still
useful as a leash (see "Recommended direction"), but not as a precise classifier.

### 2. Reuse-allowed, constructibility-aware lattice lower bound

Idea: a Dijkstra over the affinity lattice that respects constructibility
(filler placeable only when its req is met by seed plus current affinity) but
allows reusing a constellation. Reuse-allowed cost is a valid lower bound (reuse
only lowers cost), so it is sound for dim, and it credits per-state supply and
the cascade, so it should be tighter than the cover table.

Measured: it is sound (0 false dims across the gap candidates) but far too
loose. It rated `aeon_s_hourglass` at 38 when the truth is dim (over 55). It
dimmed 0 of the 15 gap candidates. It is also slow (up to 357 ms per candidate,
1877 ms total) because at full caps the lattice is about 917k cells.

Why it fails: reuse genuinely undercuts 0/1 here. The independent review
measured the gap directly (for example reaching primordial 20 costs 12 with
reuse versus 15 with 0/1; the vector `[12,0,20,0,20]` is 34 versus 39), and
several targets are reachable with reuse but infeasible under 0/1. Reuse is not
equal to 0/1 on this data, so a reuse-allowed bound cannot prove the borderline
dims.

### 3. Per-color 0/1 lower bound

Idea: for each color, precompute `colorCost[g][k]` = minimum stars of a distinct
subset granting at least `k` of color `g` (a 1-D 0/1 knapsack, exact and cheap).
Bound = `own + max over colors of colorCost[g][deficit_g]`, crediting per-state
supply via the deficit. O(1) per candidate, provably admissible.

Measured: also too loose. It rated `aeon_s_hourglass` at 34. Every gap candidate
scored at or under 44 against a budget of 55, so it dimmed 0 of them. Fast
(0.2 ms) but useless here.

Why it fails: the missing star lives in the 0/1-plus-constructibility coupling,
which is not color-separable. A per-color bound ignores that a distinct
eldritch granter needs its own affinity first (the cascade), so it
underestimates.

### 4. Tighter admissible prune inside the DFS

Idea: replace the cover-table prune with a tighter admissible bound so the dim
search prunes earlier.

Measured (independent review): swapping in the tighter reuse-Dijkstra bound
(52 versus the cover table's 54 on a hard state) made the search worse, from
158M to 312M nodes. Tightening from 54 to 52 still leaves the bound at or under
55, so it never prunes near the root where it would matter, and the per-node
lookup got more expensive.

Verdict: tighter bounds are a dead end in this regime. A bound that is two stars
short of a one-star-infeasible instance prunes essentially nothing.

### 5. Bounded beam upper bound

Idea: a width-bounded beam search is a polynomial, sound-for-reachable
constructive upper bound (a hit is always a real build). If it could catch every
reachable gap candidate, the resolver would only ever run on dims.

Measured (beam ordered by deficit, then cost):

```
W=  4  caught 5/10 reachable   false-dims 5    12 ms
W= 16  caught 5/10 reachable   false-dims 5    32 ms
W= 64  caught 4/10 reachable   false-dims 6   135 ms
W=256  caught 7/10 reachable   false-dims 3   458 ms
```

Verdict: too weak and not even monotone in width. The deficit heuristic does not
know which filler unlocks the cascade, so the beam misses real witnesses even at
width 256. A polynomial constructive UB does not reliably replace the exact
resolver on the reachable side.

### 6. Rust / WASM rewrite

Idea: rewrite the core in Rust/WASM for speed.

Verdict: wrong lever. The hotspot is algorithmic (exponential, worst case
measured at 94M to 109M nodes and unbounded in principle). WASM buys a 2 to 10x
constant factor, which moves a 10 s hang to roughly 1 to 2 s, still well past the
frame budget, while adding a Rust toolchain to a lean bun/uv repo. Fix the
algorithm first. WASM only becomes interesting as an accelerator for an
already-correct bounded algorithm, never as the fix for the unbounded one.

### 7. Exact polynomial reformulations

- Min-cost flow and matroid intersection do not model the elementwise-maximum
  requirement coupling.
- Lagrangian relaxation of the cover gives bounds, not the integral one-star-tight
  answer.
- ILP is exact but a per-candidate solve, about 213 per click, is not
  interactive and adds a solver dependency.
- Cardinality bounding fails: builds use up to 13 to 19 filler constellations
  within budget, so enumerating subsets by cardinality is astronomical.

## What is sound and one-sided (keep these)

The bracket gives genuinely sound one-sided facts, and the fix should preserve
them:

- `lowerBoundFrom > budget` implies genuinely dim.
- `greedyFrom <= budget` implies genuinely reachable.

Only the gap between them is uncertain. Every hard dim we currently display is
provably correct; the cost is paid only to resolve the gap.

## Recommended direction (not yet chosen)

Given the evidence, an exact, sound, polynomial decision is not on the table for
the interactive hot path. The pragmatic, defensible design:

1. Leash the exact resolver. Give `reachableExactFrom` a hard node budget (on
   the order of 1 to 2M nodes) or a wall-clock budget (about 10 to 20 ms). The
   early-exit-on-witness path means reachable answers almost always finish
   cheaply and stay exact; it is the dim exhaustions and the rare expensive
   reachable witnesses that trip the leash.
2. On trip, return a safe-side verdict, not a hard claim. When the leash trips,
   default the residual to "reachable / uncertain" and render it distinctly. A
   false dim (hiding a truly achievable capstone) is the worse failure for a
   planning tool, so bias the uncertain residual toward not hard-dimming. Every
   hard dim still comes only from `lowerBound > budget` and stays provably
   correct.
3. Verify the residual error on the harness. With the leash in place, measure
   p99 and max per-click latency and how many candidates end up "uncertain" and
   of those how many the unleashed oracle would call dim. If the
   uncertain-but-actually-dim set is a handful of borderline capstones in deep
   states, ship it.
4. Optional, sound, and the one structural lever not yet exhausted: a memoized
   branch-and-bound keyed on (remaining filler window, capped affinity vector,
   cost) with dominance pruning (a state reached at greater-or-equal cost and
   less-or-equal affinity is dominated). The current DFS re-explores
   affinity-equivalent subsets repeatedly; memoization over the roughly 917k-cell
   lattice times a coarse cost axis is the only thing with a real chance of
   turning 10^8 nodes into 10^6 on the dim cases. It may still not prove the
   one-star-infeasible cases cheaply, but it is the highest-value sound
   experiment left. Prototype it after the leash makes the product correct and
   fast.

This is a verified-on-data heuristic, stated plainly. It is also what the
reference tool gd-starnav does and what the P1 notes already anticipated.

## Note on the harness measurement

An independent review claimed the harness under-measures by timing one
`reachabilityForSelection` on the current selection per step rather than the
candidate sweep. We checked this and it is incorrect.
`reachabilityForSelection` internally classifies every candidate (every
constellation for "completable" and every frontier star for "clickable"), so a
single timed call is the full roughly 213-candidate sweep. The harness's 10.4 s
maximum is a real full sweep.

The fair limitation is different: the harness samples sweep cost at states along
greedy playthroughs, not across all reachable selection states. For per-candidate
breakdowns (which candidate in a sweep is slow, and its node count), use the
hotspot probe described below.

## Reproductions

The committed harness is the durable tool:

```
just perf                       # default seeds, reports the latency distribution
just perf --seeds 100 --start 1 # wider sweep
just perf --replay 5            # replay one seed verbosely, slowest steps
```

The diagnostic probes used for the per-candidate findings lived in `.llm/`
(gitignored, transient). They import the harness's exported `model`, `cons`,
`table`, and `playGame`, reconstruct a state via the `onStep` callback, and then
classify each candidate. The essential measurements they produced are quoted
above. The key ones, by purpose:

- Per-candidate node-count breakdown of a sweep (which candidate is slow, reach
  versus dim, node count). Requires a node counter (`lastExactNodes()`) inside
  `reachableExactFrom`; we added one during this investigation, and any
  leashed-resolver fix needs it anyway.
- True minimum budget per candidate (binary search of `reachableExactFrom` over
  budget). This is what proved the one-star-infeasible result.
- Problem dimensions (lattice size, per-color providers and totals).
- The two rejected sound lower bounds and the rejected beam upper bound, each
  comparing its verdict to `reachableExactFrom` across the gap candidates.

If you re-open this investigation, start from `just perf` to confirm the
hotspot still reproduces, then rebuild the per-candidate probe against the
current engine rather than trusting stale numbers.

## References

- Engine: `web/src/core/reachability.ts`. `reachableExactFrom` is the unbounded
  hotspot; `classifyForSelection` is the per-candidate entry; `lowerBoundFrom`
  and `greedyFrom` are the sound bracket; `completionMinCost` binary-searches
  the exact minimum cost.
- Harness: `web/scripts/perf-reachability.ts` (run via `just perf`).
- Design spec: `docs/superpowers/specs/2026-06-21-path-predictor-reachability-design.md`.
- Precompute-and-ship-a-blob precedent with graceful degradation:
  `web/src/adapters/coverTableBlob.ts`, `web/scripts/build-cover-table.ts`, and
  the disable-dimming fallback in `web/src/adapters/httpDataSource.ts`.
