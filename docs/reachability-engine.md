# Reachability engine

How the planner decides which selections are legal (reachable) within the point
budget. The engine lives in `web/src/core/reachability.ts`, with the exact
gap-resolver ported to `data/reach.wasm` (`web/wasm/src/lib.rs`). For the domain
rules it implements see [devotion-system.md](devotion-system.md); for why the exact
search is hard and the dead ends we rejected see
[reachability-performance.md](reachability-performance.md).

## The question

For a selection state (the constellations the user has started, some complete, some
partial) and a budget, decide whether the selection extends to a valid build that
fits the budget. Asked for every candidate "current selection plus one more
constellation or star" on every click, so it must be fast.

Reachability is decided on the **construction peak**: the most points held at any
single instant of a legal construction, including transient refundable scaffolding
(a Crossroads held to bootstrap a color, then refunded). It is the peak that must
fit the budget, not the point total of the finished build. A build that fits 55
points in its final form is still unreachable if no construction order keeps the
peak at or under 55. (See devotion-system.md "The construction peak".)

## How a verdict is decided

`classifyForSelection` brackets the answer with cheap sound tests, then resolves the
gap exactly. In order:

1. **Dim lower bound (sound).** A precomputed cover table gives the minimum stars to
   cover the selection's affinity deficit. If `own + coverCost > budget` the
   selection is genuinely dim.
2. **Reachable gate (sound).** `greedyFrom` constructs one valid build and reports
   its refunded cost plus the distinct colors it had to bootstrap a Crossroads for
   (`lastGreedyBootColors`). That sum is the construction peak of greedy's own order
   (each bootstrapped color is one transiently held Crossroads), so
   `greedyCost + bootColors <= budget` proves reachable. This is the ladder bound:
   affinity persists, so each color is a one-time bottom-of-ladder cost.
3. **Peak witness (sound).** For a complete self-covering selection, `minPeakSampled`
   samples real construction orders; a sampled peak `<= budget` is a genuine order,
   so it proves reachable. It only ever flips a would-be dim to reachable.
4. **Exact resolver.** The remaining gap goes to `reachableExactFrom` (or its WASM
   port): a memoized branch-and-bound DFS over filler subsets, cover-table pruned.
   At every covering node the build is self-covering, so any further filler is
   refundable and the peak witness already models it as a transient scaffold; the
   verdict there is final, so the resolver decides (gate or witness) and returns,
   pruning the post-covering filler-superset subtree. Reachable iff some covering
   build has a construction order within budget.

The cheap bracket decides almost every candidate; only the gap reaches the resolver.

## The per-selection sweep

`reachabilityForSelection` emits the per-element signals one UI refresh needs:

- `completable` (per constellation): classify "selection + the whole constellation".
- `reachableStars` (per star): every unselected star whose path (the star plus its unselected
  predecessors) keeps the selection reachable. For a completable constellation that is all its
  unselected stars. For one that is enterable but not completable, the engine finds `maxK`, the
  largest per-constellation star count that still classifies reachable, by binary search over the
  count (at most 3 classify calls for an 8-star constellation): the verdict depends only on the
  count (selectionSummary reduces selections to counts) and is monotone in it (a bigger proper
  prefix costs more and grants nothing until complete). A star is reachable iff its path keeps the
  count at or under `maxK`. This is what lights a 4-point path to a celestial power inside a
  constellation too expensive to finish.

## Soundness

These one-sided facts are exact, and the engine never contradicts them:

- `lowerBoundFrom > budget` implies genuinely dim.
- `greedyCost + bootColors <= budget` implies genuinely reachable.
- a witnessed construction peak `<= budget` implies genuinely reachable.

The exact resolver decides the gap on the construction peak. The seed-only
`constructible` fixpoint and greedy's bare refunded cost both ignore the peak and so
once produced false-reaches (lighting a build whose construction peak overflows the
budget, e.g. a 3-star tier-1 constellation at a 3-point budget, whose peak is 4); the
gate and witness above charge the peak instead.

## Known limits

- **Residual false-reach on random synthetic models.** Against an exhaustive BFS
  oracle on small random models (`just validate-reach` Part A), the engine still
  false-reaches on roughly 450 of 12,000 sampled states. These shapes are not
  observed on the real 109-constellation map: `just realmap-hunt` finds 0
  construction-peak false-reaches, and both formerly-confirmed real-map cases now
  classify dim. The real map's affinity abundance (per-color supply 4-9x the caps)
  makes the peak rarely bind. This is an upper bound from a targeted hunt, not a
  formal proof that no real-map false-reach shape exists.
- **The peak witness is a sampler**, so its dim is conservative: a build whose only
  valid order the sampler misses can be false-dimmed. Real-model false-dims are ~2
  per 6,600 self-covering builds (`validate-reach` Part B), the safe direction
  (hiding an achievable build, never lighting an unbuildable one). Raising
  `PEAK_WITNESS_TRIES` trades speed for fewer of these.

## The costed-scaffolding oracle

An order-exact minimum-construction-peak DP (`minPeakCost`) lives on branch
`reachability-costed-scaffolding` and is vendored into
`web/test/support/costed-oracle.ts`. It is far too slow for the interactive path
(it searches ~100 real scaffolds per query), but it is sound by construction, so it
serves as the validation oracle: the arbiter in `just realmap-hunt` and the ground
truth in the costed-oracle tests. The shipped engine returns only a verdict; the
guided build order builds its construction schedule from the same sampled witness
(`buildOrderPath`), not from this DP.

## Verifying after a resolver change

Re-run all of these; they are the regression gates:

- `just test` and `just test-slow` (the metamorphic downward-closure walk).
- `just validate-wasm` - the WASM port must stay verdict-equivalent to TS.
- `just realmap-hunt` - must report 0 confirmed false-reaches.
- `just validate-reach` - tracks the synthetic false-reach and real-model false-dim
  rates (a heavy oracle cross-check, minutes).
- `just build-order-validate` - the guided-build-order false-negative/positive rates.
- `just perf` - per-click latency must stay within the interactive budget.
