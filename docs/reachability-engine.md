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
3. **Peak witness (sound, schedule-backed).** For a complete self-covering selection,
   `minPeakSampled` samples member orders and scores each by the peak of its actual
   legal schedule (`emitSchedule`, the same loop the build-order panel renders:
   scaffolds added before the step that needs them and refunded the moment the
   rules allow, so a scaffold swap holds both sides until the old one may go). A
   peak `<= budget` therefore comes with a schedule the independent oracle
   verifies (web/test/witness-schedule.test.ts pins "lit implies a verified
   order"), so it proves reachable and only ever flips a would-be dim to reachable.
   A per-step model that sized each step's scaffold in isolation undercounted the
   swap and lit a real 53-point build at 53 whose cheapest schedule needs 54. It
   tries three deterministic orders first - the bootstrap heuristic (lowest requirement
   first, then densest grant) and two peel orders (`peelOrder`: members chosen back
   to front so each is placed last among what remains only when the others' grants
   already cover every remaining requirement; one variant puts zero-requirement
   members in front, the other peels them like any member) - then
   `PEAK_WITNESS_TRIES` seeded shuffles. The peel orders exist for members whose
   requirement is met only with their own grant: they need a scaffold whenever they
   are placed, so the heuristic's habit of placing the highest-requirement member
   last overshoots a cap-tight build. The two variants split on whether the
   crossroads members' colors are needed: in front they shrink every later deficit,
   but when nobody needs them they only inflate the size held at the scaffold step.
4. **Exact resolver.** The remaining gap goes to `reachableExactFrom` (or its WASM
   port): a memoized branch-and-bound DFS over filler subsets, cover-table pruned.
   At every covering node the build is self-covering, so any further filler is
   refundable and the peak witness already models it as a transient scaffold; the
   verdict there is final, so the resolver decides (gate or witness) and returns,
   pruning the post-covering filler-superset subtree. The witness here is the
   deterministic candidates only (no shuffles): a resolver call witnesses many
   covering nodes, and shuffling at each one was measured at 2.5x the mean and 4.6x
   the p99 per-click latency for 32 tries (1.4x / 1.8x for 8), while the second
   peel variant recovered most of what the shuffles would have for the cost of one
   more schedule. It also keeps the Rust port RNG-free and verdict-equivalent
   (`schedule_peak` in web/wasm/src/lib.rs mirrors `emitSchedule`'s peak).
   Reachable iff some covering build has a construction schedule within budget.

The cheap bracket decides almost every candidate; only the gap reaches the resolver.

## The per-selection sweep

`reachabilityForSelection` emits the per-element signals one UI refresh needs:

- `completable` (per constellation): classify "selection + the whole constellation".
- `reachableStars` (per star): every unselected star whose path (the star plus its unselected
  predecessors) keeps the selection reachable. For a completable constellation that is all its
  unselected stars. For one that is enterable but not completable, the engine finds `maxK`, the
  largest per-constellation star count that still classifies reachable: one probe at the cheapest
  entry (selCount + 1), then a bisection of at most 3 further classify calls for an 8-star
  constellation, on top of the whole-constellation check the sweep already pays for every
  constellation. The verdict depends only on the count (selectionSummary reduces selections to
  counts) and is monotone in it (a bigger proper prefix costs more and grants nothing until
  complete). A star is reachable iff its path keeps the count at or under `maxK`. This is what
  lights a 4-point path to a celestial power inside a constellation too expensive to finish.

### Explaining a dim verdict

A dim verdict is a number the UI can explain. `dimReport` (web/src/core/dimReasons.ts) is
computed on hover only, cached per refresh, for the target asked about (the selection plus a
whole constellation, or plus a locked star's path). It carries three things, and the star and
constellation tooltips, the points bar's floor segment, and the build-order panel's empty state
render them through one adapter (`web/src/adapters/dimText.ts`):

- `needs`: `minCostFrom`, the fewest points at which the target classifies reachable, searched
  past the cap (`DIM_SEARCH_MAX`, cap plus ten) so the line can say "Needs 56 of your 55 points"
  rather than only "cannot"; null when nothing within the bound builds it.
- `deficit`: the colors the target's completed members do not supply for its own requirements,
  each with the constellations whose requirement sets that need ("2 more Order for Scales of
  Ulcama"). This is the affinity panel's have/need with its `needSource`, made per-target.
- `scaffolders`: the members whose requirement in some color exceeds what the rest of the target
  supplies. Each can only be activated with transient affinity from outside the build, which is
  why a build sitting exactly at the cap can be unfinishable: the last piece placed must activate
  with no room for a scaffold. It is a sufficient explanation, not a necessary one: a pure lock
  (two members each covering the other's requirement) needs a scaffold with an empty list, and
  the tooltip then shows only the points line.

The floor segment of the points bar (`curMin - used`) is the same idea for the current selection:
its title names the deficit and the scaffold needers of the selection itself, without a resolver
call.

## Soundness

These one-sided facts are exact, and the engine never contradicts them:

- `lowerBoundFrom > budget` implies genuinely dim.
- `greedyCost + bootColors <= budget` implies genuinely reachable. Greedy's
  transient seed is honest: a crossroads counts once, either as the transient +1
  it lends while a member activates or as a placed member or filler, never both
  (`crossroadsColor`/`seedFor`; the seed offers a color only while one of its
  crossroads is unplaced). The resolver's `constructible` gate uses the same seed.
- a witnessed construction peak `<= budget` implies genuinely reachable: the peak is
  that of a legal schedule the independent oracle accepts.

Every reachable proof charges the construction peak. Neither `constructible` (a
seed fixpoint that says an order exists) nor greedy's bare refunded cost is enough
on its own: each ignores what is held transiently, so each would light a build
whose peak overflows the budget (a 3-star tier-1 constellation at a 3-point budget
has a peak of 4: the crossroads is held while its stars go in).

## Known limits

- **No known false-reach.** Against an exhaustive BFS oracle on small random models
  (`just validate-reach` Part A, 12,000 sampled states on models with only two or
  three sources per color) the engine false-reaches on 0. On the real map
  `just realmap-hunt` finds 0 construction-peak false-reaches and the two
  formerly-confirmed real-map cases classify dim. Both are evidence from sampling,
  not a formal proof; what is proven is per verdict, since every reachable proof
  is a schedule (witness) or a schedule-shaped bound (greedy's ladder, the peak
  gate) with an honest seed. The two mechanisms closed most recently were the
  crossroads seed counted twice and the witness sizing each step's scaffold in
  isolation (missing the swap cost); each is pinned by a test.
- **Conservative false-dims on the synthetic models.** The same Part A dims 48 of
  12,000 states the oracle proves reachable: partial selections reachable only by
  transiently over-completing a kept-partial constellation to bootstrap a lock and
  refunding it (a star-level move the whole-build resolver does not model), and
  covering builds whose only in-budget schedule all three deterministic witness
  candidates miss (the resolver has no shuffles). Part B finds none of either on
  real-map whole-constellation builds.
- **The peak witness is a sampler**, so its dim is conservative: a build whose only
  valid schedule the sampler misses can be false-dimmed. `validate-reach` Part B
  finds 0 real-model false-dims in 6,618 self-covering builds, and the direction is
  the safe one (hiding an achievable build, never lighting an unbuildable one). On
  5,000 generated near-cap (52-55 point) builds at cap 55 the engine dims 7, none of
  which a 2,000-try search or the constructor can prove reachable. Raising
  `PEAK_WITNESS_TRIES` trades speed for fewer misses on the classify path; the
  resolver's covering-node witness has only the deterministic orders.

## The costed-scaffolding oracle

An order-exact minimum-construction-peak DP (`minPeakCost`) lives on branch
`reachability-costed-scaffolding` and is vendored into
`web/test/support/costed-oracle.ts`. It is far too slow for the interactive path
(it searches ~100 real scaffolds per query). It sizes each step's scaffold in
isolation, without the swap cost a real schedule pays, so its minimum is a lower
bound on the true minimum peak: `minPeakCost > budget` proves unreachable (the
arbiter `just realmap-hunt` relies on, sound), while `minPeakCost <= budget` is
only evidence that an order exists (what `just build-order-validate` and the
"recovered" line of the hunt report). The shipped engine's witness is stricter
than this oracle: it lights nothing without a schedule.

## The guided build order: legal at every step, verified or absent

`buildOrderPath` (web/src/core/reachability.ts) turns a self-covering selection
into a step-by-step construction schedule. Two candidate member orders are
emitted and the better schedule wins by the ordering objective (fewer scaffold
churn points, then fewer steps): the need-driven greedy order
(`needDrivenOrder`, each member activated by what the build has already placed
plus at most a refundable crossroads, so the build builds itself), and the
sampled peak-minimizing order (`sampledConstruction`), which is also the
engine's reachability witness (`minPeakSampled`) and arrives with its own legal
schedule. Neither generator dominates - the greedy wins cap-tight builds the
sampler scaffolds heavily, the sampler's deterministic orders win typical builds
- so the per-build best of both is never worse than either alone. Both orders
feed the same emission loop (`emitSchedule`), which adds transient scaffold
constellations before the steps that need them and refunds each the moment the
in-game rules allow; the panel re-emits the sampled order at a deeper
scaffold-search cap for smaller scaffolds and falls back to the witness's own
schedule, so a lit build always has an order. Its contract:

- **Canonical input.** The member array is sorted by constellation id at entry,
  so the output is a pure function of the build set. Panel, tests, and scripts
  get the identical order for the identical selection.
- **Legal at every step.** Every emitted step obeys the in-game rules, refunds
  included: a scaffold is refunded only when everything still standing keeps its
  requirement covered without it (docs/devotion-system.md, "Removal cannot
  strand a dependent"). Refunds not yet safe stay held and are retried after
  later adds; a schedule whose scaffolds can never be legally refunded returns
  null instead of emitting an illegal step.
- **Verified or absent.** An independent oracle (`verifyBuildOrder` in
  web/src/core/orderLegality.ts) replays every schedule from an empty board and
  re-derives validity at each step with no shared engine code. `selectionView`
  renders only orders the oracle proves legal; anything else is withheld and the
  panel shows its honest empty state. No order is better than an illegal order.
  The verifying replay's per-step states ride along (`replayBuildOrder`, one
  walk, two outputs) to feed the panel's step popup, so the have/need numbers a
  user hovers are exactly the numbers the judge saw.

While comparing, the panel shows a baseline-to-current TRANSITION instead:
`transitionOrderPath` (web/src/core/transitionOrder.ts) computes four
candidate schedules and selects among them by fewest moved points, then fewest
steps. The state walk is a deterministic greedy over actual game states, one
oracle-legal move at a time - complete a target member, refund whatever is free
(standing above target with no outstanding deficit leaning on its grant), add a
minimal scaffold, and, only when none of those apply, tear down a standing
member so it rejoins the pool for a later re-add. Run in both directions, its
opposite-direction schedule (current to baseline) reversed - adds becoming
refunds, refunds becoming adds, order flipped - is a second, independent
candidate for the baseline-to-current direction: a legal schedule traversed
backward visits the same board states in reverse, so when either direction's
walk resolves, both do. The seeded two-pass replay holds kept members,
treats baseline-only members as pre-paid scaffolds, and schedules refunds in a
second pass. The full respec reverses the baseline's own from-scratch order,
then plays the current build's. Every candidate's output must pass the
transition oracle (`replayTransition` in web/src/core/orderLegality.ts, the
same one-walk-two-outputs pattern) before it enters the pool. A verified
candidate is then simplified by a verify-gated peephole (`simplifySteps`):
pairs of steps that exactly cancel (a constellation leaving and returning to
the same star count) are removed whenever the oracle still verifies the
shortened schedule, so no candidate carries tear-down-and-rebuild churn the
rules never required. Only verified candidates compete, and the winner is
displayed. A pair with no verified transition falls back to the current
build's from-scratch order, so compare mode never shows less than the normal
panel. The panel's full-rebuild notice tracks the schedule's actual shape: a
respec candidate whose simplification no longer tears every baseline member
down is relabeled incremental, so the notice appears only when the displayed
order really rebuilds everything - the common case is the state walk or the
two-pass replay, not a teardown.

The regression net: oracle unit tests (web/test/order-legality.test.ts), the
real-build fixture replay and determinism pins (web/test/build-order-path.test.ts),
a seeded 150-build panel-path sweep plus the live-site reproduction URL
(web/test/build-order-oracle.test.ts), the tight-cap adversarial corpus
(web/test/build-order-tightcap.test.ts, harvested by `just hunt-tight-cap`),
the aggregate churn/step quality pins in web/test/build-order-oracle.test.ts
(a silent ordering regression fails CI; `just order-quality` is the
per-build measurement tool), and the offline harness `just build-order-validate`,
whose illegal-path count must stay zero.

## Investigating a reported build

A user report usually arrives as a share link ("it shows 54 used but will not let me
spend the last point", "X lit up only after I added a crossroads"). Everything the
UI decides is reproducible headlessly from that hash:

1. **Decode and summarize.** `decodeHash(hash, canonicalStarIds(model))` gives the
   selection and cap; `selectionSummary(model, selected)` gives the per-color
   supply and target, the complete members (`built`) and any partials
   (`partialFinish`). `selectionView(model, cons, table, selected, cap)` is the
   exact per-click result: `reach.completable`, `reach.reachableStars`, `minCost`,
   and the verified build order (or null). `dimReport(model, cons, table, target)` on
   the selection plus the constellation in question is what the tooltip shows for it:
   the points it needs past the cap, the affinity short and who needs it, and the
   members that need transient affinity. Often that alone answers the report.
2. **Replay the ladder** on the suspect candidate (selection plus the constellation
   or star in question): `lowerBoundFrom`, `greedyFrom` + `lastGreedyBootColors`,
   `minPeakSampled` (partial-free builds only), then `reachableExactFrom` (the TS
   twin of the WASM resolver). Whichever rung dims it is the one to explain.
3. **Prove the truth independently** before calling anything a bug. Sound
   "reachable" witnesses: `buildOrderEscalated` (or `buildOrderPath` at high tries)
   replayed through `replayBuildOrder`/`verifyBuildOrder` in
   `web/src/core/orderLegality.ts` (returns null when legal), `constructReachable`
   in `web/test/support/walk-fuzzer.ts`, or `minPeakSampled` with thousands of
   tries. If one of them succeeds where the engine dims, it is a false-dim; if the
   engine lights something none of them can build, that is the serious direction
   (a false-reach) and `just realmap-hunt` is the tool. A build lit only after an
   additive change (adding a crossroads made a constellation viable) is a
   monotonicity violation and always a false-dim in the earlier state.
4. **Pin it as a test.** Real-user builds go into `namedCases` in
   `web/scripts/gen-reach-fixtures.ts` and, hand-inserted in the same shape, into
   `web/test/fixtures/reachable-builds.json` (regenerating re-mines the seeded
   cases against the current engine, so do not regenerate just to add a name);
   `web/test/reachability-walk.test.ts` asserts every named case classifies
   reachable. A focused file per real report (for example
   `web/test/reach-last-point.test.ts`) can pin the exact symptoms: the sweep,
   the validity floor, the live build order, the resolver path.
5. **Mirror deterministic witness changes in Rust.** Anything that changes the
   deterministic (tries = 0) verdict of `minPeakSampled` (its candidate orders and
   `emitSchedule`, whose peak scores them), `peakGateReachable`, or the DFS in
   `reachableExactFrom` must be ported to `web/wasm/src/lib.rs`, then
   `just wasm` and `just validate-wasm`. `data/reach.wasm` is a gitignored artifact
   (CI builds it before deploying), so the Rust source is what ships.
6. **Measure before and after** with `just perf` and, for the reported state, a
   direct timing of `selectionView` on it, so the fix's cost is a number and not
   a guess.

## Verifying after a resolver change

Re-run all of these; they are the regression gates:

- `just test` and `just test-slow` (the metamorphic downward-closure walk).
- `just validate-wasm` - the WASM port must stay verdict-equivalent to TS.
- `just realmap-hunt` - must report 0 confirmed false-reaches.
- `just validate-reach` - tracks the synthetic false-reach and real-model false-dim
  rates (a heavy oracle cross-check, minutes).
- `just build-order-validate` - the guided-build-order false-negative/positive rates.
- `just perf` - per-click latency must stay within the interactive budget.
