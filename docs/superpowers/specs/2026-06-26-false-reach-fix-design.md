# False-reach fix: decide reachability on construction peak, not refunded cost

**Status:** implemented. This note records the design; the final shape evolved during
implementation in two ways worth recording here:

- The cheap reachable gate in `classifyForSelection` became **greedy + bootstrapped
  colors** (`greedyFrom` now tracks the distinct colors it had to seed a Crossroads
  for, exposed via `lastGreedyBootColors()`): the peak of greedy's own order is
  `greedyCost + thatCount`, a tighter and faster proof than the standalone
  `size + requiredColors` gate. `peakGateReachable` (the `size + requiredColors`
  form) remains the order-independent gate inside the exact resolver.
- The resolver perf and the TS/WASM verdict divergence were both fixed by one
  insight not in the original plan: every covering node in the resolver is
  self-covering, so any further filler is refundable and the peak witness already
  models it as a transient scaffold. The verdict at a covering node is therefore
  final, so the resolver **returns at every covering node**, pruning the
  post-covering filler-superset subtree (the dominant cost, ~18.8M nodes measured on
  one slow click) and witnessing every covering node uncapped. Removing the
  witness-call cap made the verdict order-independent, so TS and WASM agree with no
  memoization parity work.

Verified: Eel-at-3 and the eight tier-1 constellations dim; both real-map false-reach
seeds dim; `realmap-hunt` reports 0 false-reaches; `build-order-validate` clean;
`validate-reach` synthetic false-reach 705 -> 454 and net disagreements 727 -> 545;
WASM verdict-equivalent; per-click perf max ~217ms with no hotspots (the ~1.3s
near-ceiling freeze is gone).

## The bug, in one line

At budget 3 the planner lights 8 constellations (Eel, Hammer, Hawk, Hound,
Jackal, Lion, Lizard, Scholar's Light) as completable. None are: each is 3
stars requiring 1 affinity of a color, and the only source of that first point
of color is a crossroads you must hold while you place the constellation. The
true construction peak is 4 points, not 3.

## Root cause: a "free crossroads seed" baked into three places

The engine models the refundable crossroads as a free starting affinity
`SEED = [1,1,1,1,1]`. Three components charge zero for holding it, so all three
report the post-refund steady-state cost instead of the transient construction
peak:

1. `greedyFrom` (reachability.ts:283) - the reachable proof. Auto-places a
   constellation the moment `addCap(SEED, build)` covers its requirement, and
   returns the sum of placed star counts. For Eel: places Eel (seed supplies
   the 1 affinity), returns 3, never charges the crossroads. **This is what
   false-reaches Eel-at-3** - it declares reachable at classifyForSelection:862
   before the sound witness ever runs.
2. `constructible` (reachability.ts:374) - the exact resolver's covering-node
   short-circuit (line 790). Same free-seed fixpoint; this is what
   false-reaches the two near-ceiling real-map seeds (5563, 41966).
3. `lowerBoundFrom` (reachability.ts:219) - the dim proof. Also ignores the
   bootstrap, but that is the SAFE direction: it can only fail to dim, never
   false-reach. **Leave it alone.**

The witness `minPeakSampled` is the one sound cost model, and it already
computes the correct peak (verified: 4 for Eel at budget 3). The architecture
put two unsound fast paths *in front of* the sound witness, so the witness's
correct answer is discarded.

## Answering Ted's "are the early choices still optimal?"

No. Two early decisions are now wrong given what we learned:

- Letting `greedyFrom`'s refunded cost stand as a *reachable* proof. Refunded
  cost is a sound LOWER bound on the peak (you end holding every permanent
  member), so it is fine as a *dim* accelerator but must never declare
  reachable on its own.
- Setting `GATE_WITNESS_TRIES = 0`, which made the in-resolver witness branch
  dead and left the unsound `constructible` as the resolver's sole decider for
  WASM determinism. The determinism goal was right; killing the witness to get
  it was not - the deterministic (no-shuffle) witness order is itself RNG-free
  and sound.

`constructible` itself is not deleted - it finds its correct home as one
conjunct of the cheap sound gate below.

## The fix: reachability is a question about the PEAK

Ted's ladder insight gives a cheap, provably sound reachable gate. Affinity
persists, so each required color needs at most one transient crossroads held at
once; a no-refund schedule that places one crossroads per distinct required
color and then the whole build holds at most `size + distinctRequiredColors`
points. Therefore:

> **Cheap sound reachable gate:** if the build is self-covering AND
> `constructible(build)` (unit-seed order exists) AND
> `size + distinctRequiredColors <= budget`, it is reachable.

Measured 0 wrong-accepts across ~18k near-ceiling builds. It fires for
crossroads (1+0 <= budget), for roomy self-covering builds (50+5 <= 55), and
correctly does NOT fire for Eel-at-3 (3+1 = 4 > 3).

The narrow band `size < budget < size + distinctRequiredColors` - where colors
can be bootstrapped sequentially so not all crossroads are held at once - falls
through to the existing sound witness, then the exact resolver.

### Change 1 - `classifyForSelection` (reachability.ts:860)

Replace the unsound greedy reachable proof:

```
if (greedyFrom(cons, st, budget) <= budget) return "reachable";   // DELETE
```

with the cheap sound gate (self-covering + constructible + size+reqColors).
Everything below it (the `minPeakSampled` witness at :879, then the exact
resolver) is already sound and stays. Net effect: the tight band now decides on
the real peak; the roomy and trivial cases stay O(1).

### Change 2 - `reachableExactFrom` covering node (reachability.ts:790)

Replace the `constructible(members)` short-circuit with the same sound gate,
then the deterministic (no-shuffle, RNG-free) witness:

```
if (selfCovers(members) && constructible(members)
    && size(members) + distinctReqColors(members) <= budget) { found = true; return; }
if (witnessLeft > 0) {
  witnessLeft--;
  if (minPeakSampled(cons, table, members, budget, GATE_WITNESS_TRIES, PEAK_NODE_CAP) <= budget) {
    found = true; return;
  }
}
```

The gate makes the common case O(1) (no witness call), so `WITNESS_CALL_CAP`
still bounds the worst case. The resolver becomes sound and stays
WASM-deterministic.

### Change 3 - WASM port (wasm/src/lib.rs:122, 309)

Mirror change 2 exactly: add the self-cover + size+reqColors gate, route the
residual through the deterministic peak witness. `validate-wasm` guards verdict
equivalence with the TS resolver.

### Change 4 - witness tries (only if measured necessary)

The 40k-build sweep showed 2.31% of near-ceiling builds false-dim at tries=8
but are rescued by higher tries; 0% irreducible. The live classify path
(`PEAK_WITNESS_TRIES`, not WASM) may raise tries if the regression gate shows
real false-dims. The resolver/WASM path stays deterministic (tries=0) and
accepts conservative false-dims, which the gate above already minimizes.

## TDD order

1. **Headline failing test** (cheap, human-checkable): at budget 3, each of the
   8 tier-1 constellations classifies `dim`; the 5 crossroads classify
   `reachable`; at budget 4 all 8 classify `reachable`. This is the new
   regression anchor - far cheaper than the seed builds and exercises the same
   `greedyFrom` root cause.
2. Flip the two existing `test.failing` real-map cases (seeds 5563, 41966) to
   passing - they exercise the `constructible`/resolver root cause.
3. Implement changes 1-3; both test groups go green.
4. WASM: rebuild, run `validate-wasm` for verdict equivalence.

## Regression gates (false-dim cost must stay bounded)

- `just build-order-validate` - false-negative / false-positive rates across
  12k+ builds must not regress.
- the realmap hunt - must report 0 false-reaches after the fix.
- the existing perf-guard test - the gate keeps the common path O(1); confirm
  the sweep stays within its measured budget.
```
