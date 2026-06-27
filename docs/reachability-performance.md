# Reachability sweep performance

Why the per-click reachability sweep is computationally hard, how the engine stays
interactive anyway, and which fixes we evaluated and rejected with measurements. It
exists so we do not re-derive the same dead ends: before you "just add a tighter
bound" or "just cache it" or "rewrite it in Rust", read the relevant section. For how
the engine decides a verdict see [reachability-engine.md](reachability-engine.md).

## TL;DR

- The expensive part is the exact gap-resolver (`reachableExactFrom`). The hard
  instances are infeasible by exactly one star (true minimum cost 56 against a budget
  of 55), so proving "dim" means exhausting a large subset space. The underlying
  decision is a precedence-constrained 0/1 minimum-cost cover, NP-hard in flavor; no
  cheap sound bound is tight enough to prove the borderline dims.
- The exact search is made fast without trading correctness by three composing,
  sound moves: a dominance memo (branch-and-bound), a Rust/WebAssembly port, and a
  covering-node prune that stops the search the moment a build self-covers (further
  filler is refundable and can only raise the peak, so the verdict there is final).
- Current per-click latency (`just perf`, WASM): mean ~6ms, median ~2ms, p95 ~19ms,
  p99 ~90ms, max ~220ms, with no clicks over 400ms.

## How the hot path stays fast

The cheap sound bracket decides almost every candidate in O(1): `lowerBoundFrom`
proves dim, the `greedyFrom + bootColors` gate and the sampled peak witness prove
reachable (see reachability-engine.md). Only the gap reaches `reachableExactFrom`,
and three things keep it bounded:

1. **Dominance memo (sound).** The exponential DFS re-explores affinity-equivalent
   subsets millions of times. A memo keyed on `(filler index, capped build vector,
   capped maxReqPlaced)` storing the minimum failing cost prunes the revisits. It is
   verdict-exact and cut the worst dim proof from ~94M nodes to ~2.7M states.
2. **WebAssembly port (sound, constant factor).** The memoized search is ported to
   Rust (`web/wasm/src/lib.rs`), built to raw wasm32 as `data/reach.wasm`, loaded by
   `web/src/adapters/reachWasm.ts`, and swapped in via `setExactResolver`. Absent the
   wasm it falls back to the pure TS resolver, so the site always works. WASM is only
   useful because the memo made the search bounded; a constant factor cannot fix an
   unbounded search.
3. **Covering-node prune (sound).** Every covering node in the DFS is self-covering,
   so any further filler is refundable and the peak witness already models it as a
   transient scaffold; keeping filler permanent is never better for the peak. So the
   resolver decides the verdict at the first covering node and returns, pruning the
   post-covering filler-superset subtree, which was the dominant remaining cost on
   near-ceiling dim candidates (~18.8M nodes on one measured slow click). Witnessing
   every covering node (uncapped) is now affordable and makes the verdict
   order-independent, so the TS and WASM resolvers stay verdict-equivalent.

A second sound, free speedup: a frontier star of a completable constellation is
always clickable (any prefix of a reachable completion is reachable), so the
clickable half of the sweep skips the resolver for it.

Toolchain: `just install-rust` (rustup + wasm32 target), `just wasm` (builds
`data/reach.wasm`), `just build` copies it into `dist`. None are required to run the
site, only to rebuild the fast resolver.

## The decision problem (precise)

About 109 constellations. Each `c` has `size` (star count 1-8, its cost), `req` (a
5-vector of affinity requirements), and `grant` (5-vector granted when complete). Five
colors, hard per-color caps `[20, 8, 20, 10, 20]`. A build `B` is valid iff:

1. **Cover:** the capped sum of grants over `B` is at least the elementwise maximum of
   `req` over `B`, per color.
2. **Constructible within budget:** some order adds `B`'s members so each member's
   `req` is met by already-held affinity (the refundable crossroads seed plus prior
   grants), and every intermediate state stays at or under budget. The budget binds on
   the construction *peak*, not the final total.

The per-click question, for every candidate "current selection plus one more": does a
valid build exist that includes all started constellations within budget?

## Why it is intrinsically hard

The hard instances miss the budget by exactly one star: true minimum cost 56 against a
budget of 55. The sound cover-table lower bound reports 53 (three short), greedy finds
no build at all, so the exact search must enumerate enough of the subset space to prove
no 55-star build exists, and that is expensive precisely because near-miss 56-star
builds are everywhere. This is the hard region of a constraint-satisfaction phase
transition: the decision is most expensive exactly when the answer is barely no. Any
bound even two stars loose proves nothing, and an essentially exact bound is the
problem itself. Three properties block a cheap exact answer:

1. **0/1** (each constellation usable once) matters for cost: allowing reuse undercuts
   the true cost by 3-5 stars on exactly the colors capstones need, because the
   cheapest per-star granters are few and 0/1 forbids repeating them.
2. **Constructibility** is a precedence gate on top of the 0/1 cover (the NP-hard core).
3. The combined requirement is an **elementwise maximum** over chosen items, not a sum,
   so min-cost flow and matroid intersection cannot model it.

### Problem dimensions (for reference)

```
affinity caps (max req per color): [20, 8, 20, 10, 20]
lattice cells: 916,839
constellations: 109   granting (filler pool): 88   require affinity: 104
per color: providers / total grant available / cap
  ascendant 31/90/20   chaos 22/46/8   eldritch 33/90/20   order 22/46/10   primordial 30/88/20
requiring cons by shape: single-color 51   multi-color 53
```

The per-color totals are 4-9x the caps with 22-33 providers each. That abundance is why
item reuse never helps reach a target, but it does not stop reuse from lowering cost,
which is the trap that sinks the reuse-allowed bound below.

## Approaches rejected (with data)

Each was built and measured against `reachableExactFrom` on the gap candidates; none
replaces it. Do not retry these without new evidence.

1. **Fixed node cap on the resolver.** Reachable verdicts cost up to ~10M nodes and dim
   verdicts as few as ~0.23M; the distributions overlap, so no cap separates reach from
   dim without guillotining real reachable witnesses into false dims.
2. **Reuse-allowed lattice lower bound** (Dijkstra over the affinity lattice). Sound but
   far too loose: rated a true-dim killer at 38 (truth >55), dimmed 0 of 15 gap
   candidates, and slow (~917k cells). Reuse genuinely undercuts 0/1 here.
3. **Per-color 0/1 lower bound.** O(1) and admissible but too loose (rated the same
   killer at 34); the missing star lives in the non-color-separable
   0/1-plus-constructibility coupling.
4. **Tighter admissible in-DFS prune.** A tighter bound (52 vs the cover table's 54)
   made the search *worse* (158M -> 312M nodes): at or under budget it never prunes near
   the root, and the per-node lookup got costlier.
5. **Bounded beam upper bound.** Too weak and not monotone in width (caught 4-7 of 10
   reachable even at width 256); the deficit heuristic does not know which filler unlocks
   the cascade.
6. **Rust/WASM as the first move.** Wrong lever on the *unbounded* search: a constant
   factor moves a 10s hang to ~1-2s, still past frame budget. It became the right move
   only after the memo bounded the search.
7. **Exact polynomial reformulations.** Min-cost flow and matroid intersection cannot
   express the elementwise-max coupling; Lagrangian gives bounds not the one-star-tight
   answer; ILP is exact but a ~213-per-click solver dependency, not interactive;
   cardinality bounding is astronomical (builds use 13-19 filler constellations).

## Reproductions

```
just perf                       # latency distribution over seeded play
just perf --seeds 100 --start 1 # wider sweep
just perf --replay 5            # replay one seed verbosely, slowest steps
```

`reachableExactFrom` exposes `lastExactNodes()` for per-candidate node counts. To find
which candidate in a sweep is slow, reconstruct a state via `playGame`'s `onStep`
callback (exported from `web/scripts/perf-reachability.ts`) and classify each candidate
with a counting/timing resolver wrapper; rebuild the probe against the current engine
rather than trusting stale numbers.

## References

- Engine: `web/src/core/reachability.ts` (`reachableExactFrom` the resolver,
  `classifyForSelection` the per-candidate entry, `lowerBoundFrom`/`greedyFrom` the
  sound bracket). Rust port: `web/wasm/src/lib.rs`. Adapter: `web/src/adapters/reachWasm.ts`.
- Harness: `web/scripts/perf-reachability.ts` (`just perf`).
- Precompute-and-ship-a-blob precedent with graceful degradation:
  `web/src/adapters/coverTableBlob.ts`, `web/scripts/build-cover-table.ts`.
