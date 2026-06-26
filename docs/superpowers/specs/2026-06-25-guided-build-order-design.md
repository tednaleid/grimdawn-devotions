# Guided build order - design

Status: APPROVED (brainstormed with Ted 2026-06-25). Supersedes the earlier draft of the same name.
Ready for an implementation plan.

## Goal

Tell the user a legal click order that assembles their currently-selected build within their point cap,
including the non-obvious transient scaffolding (add a refundable crossroads/filler to unlock a locked
constellation, then refund it once the build covers its own affinity). When the selection cannot be
validly built, say so. This is the core in-game use: the player has chosen a desired end state, and needs
to know how to validly get there with the points they have - which, as the reachability work showed, is
not always easy and is sometimes impossible even when the engine lights the build.

## Scope

The path is computed for the CURRENT selection (the marks the user has placed) against the current point
cap. It is a pure function of `(selection, cap)`, so it introduces NO new shareable state - it rides the
existing share link. There is no separate "goal build" to import; the selection IS the goal.

Out of scope: a star-by-star leveling guide (every intermediate point total as you level); planning toward
a target the user has not selected; reordering across multiple saved builds.

## Engine and data model

### Output

A pure function `buildOrder(model, cons, table, selection, cap) -> BuildPath`, where `BuildPath` is either
an ordered `Step[]` or a not-found result. Each `Step` is one of:

- `{ kind: "complete", conId, name, points, heldAfter }` - complete a selected constellation
- `{ kind: "scaffold-add", conId, name, points, heldAfter }` - temporarily add a refundable constellation
- `{ kind: "scaffold-refund", conId, name, points, heldAfter }` - refund a scaffold no longer needed

Granularity is CONSTELLATION-level. Star order within a constellation is left implicit (it is mostly
forced by the in-game prerequisite chain and is obvious to the player). `points` is the constellation's
star count (signed for refunds); `heldAfter` is the running points-held total after the step, which never
exceeds `cap`.

### How it is computed

The substrate already exists in `web/src/core/reachability.ts`:

- `minPeakSampledOrder(cons, table, B, cap, tries)` returns the constellations of a self-covering build in
  a peak-bounded construction order (granting members first in peak-minimizing order, then zero-grant
  members), or null when no sampled order fits. Deterministic.
- `sampledConstruction` (behind it) already simulates the construction and calls `peakToReach` at each
  step to size the transient scaffold needed to keep every placed member valid.

The one real engine task is to make this machinery EMIT the per-step scaffold SET, not just its cost:

1. `peakToReach` (reachability.ts:407) already DFS-searches the minimum scaffold subset to cover a step's
   affinity deficit and tracks the chosen subset in `used[]`; return that subset (the `used` set at the
   recorded `best`) alongside the size.
2. Walk the member order, hold the scaffold set `peakToReach` chose at each step, and DIFF consecutive
   steps' scaffold sets: a scaffold newly held emits `scaffold-add`; a scaffold dropped emits
   `scaffold-refund`. A scaffold's refund lands at the first step where the build's own accumulated grants
   cover what that scaffold was bootstrapping.
3. Emit the `complete` steps for the selected members in order, interleaved with the add/refund events,
   tracking `heldAfter`.

### Scaffold preference

Bias the scaffold pick toward CROSSROADS and other cheap-to-refund (small, refundable) constellations.
In-game, removing a point costs a Tonic of Clarity, so a 1-star crossroads is a far nicer instruction than
refunding a 5-star constellation. `peakToReach` currently ratio-sorts scaffolds by grant/size; add a
tie-break (or primary preference) toward requirement-free, low-star scaffolds so the emitted schedule
favors crossroads when they suffice.

### Cost (measured 2026-06-25, `just realmap-hunt --perf`)

Producing a path via the sampled constructor is cheap enough to run live on every selection change:

| build type                  | sampled order (tries=16) median / p99 / max |
|-----------------------------|---------------------------------------------|
| typical user-like builds    | 0.09ms / 4.8ms / 19ms                       |
| pathological tight stacks   | 0.20ms / 6.6ms / 20ms                       |

Computing the scaffold SET is already inside that budget (`peakToReach` runs there today). The EXACT DP
(`minPeakCost`) is the only expensive path - median ~120-230ms with a brutal tail (p95 ~3-4s, worst 11-26s)
- and must never run on the live/per-click path. It is used only for the bounded tier-3 verify below.

Because the path is computed on EVERY selection change, it is part of the real per-click cost and MUST be
measured as such. The existing per-click perf guard measures only the reachability sweep; build-order
production must be added to it (see "Performance guard" under Testing) so the guard reflects what the user
actually experiences, not a subset. This is the lesson from the false-reach work: a guard that tests less
than the live interaction gives false confidence.

## Correctness strategy (the "no valid order" case)

The sampled constructor is heuristic, so an empty result has two opposite meanings: a CLIFF-MISS (a valid
order exists but the cheap sampler missed it - ~1.2% of reachable builds, per `reach-peakcost.test.ts`'s
20/1668; 0/240 in a 2026-06-25 exact-checked sample) versus GENUINELY UNBUILDABLE (no order exists - the
user over-selected, or it is a confirmed false-reach the engine wrongly lit). Three tiers tell them apart:

1. Live, every selection change: sampled at `tries=16` (sub-ms). Found -> show steps.
2. On a miss, escalate: retry at high tries. ADJUSTED 2026-06-25 (perf): the escalation does NOT run
   live - on an unreachable selection the sampler never early-exits, so high tries can cost ~1s per
   render (worst on the false-reach builds the engine wrongly lights). It moves to an on-demand "Find
   valid order" button (the same affordance tier 3 will use), keeping the live path strictly tries=16.
   Found -> show steps.
3. Still nothing -> honest "No valid build order found within N points", with an opt-in [Verify] action
   that runs the BOUNDED exact DP (`minPeakCost` with a work/time cap so it returns in ~1-2s, never the
   25s tail). Outcomes: a real order (rare cliff case the escalation also missed) -> show it; proven
   peak > cap -> "Not validly buildable at N points"; cap hit (very rare) -> "couldn't determine".

### v1 cut

v1 builds tiers 1-2 only: live sampled (tries=16) plus an on-demand "Find valid order" escalation button,
with an honest "couldn't find a valid order within N points" when both miss. v1 is never wrong about a path it DOES show (the replay invariant below guards
that). Tier 3 - the bounded exact verify that turns "couldn't find" into a trustworthy "not buildable" and
makes the false-reaches visible - is a fast-follow, because it requires porting `minPeakCost` (today on
branch `reachability-costed-scaffolding`, vendored in `web/scripts/reachability-realmap-hunt.ts`) into
`web/src/core`.

## UI

Placement: the right sidebar, below the Affinity panel and the benefit/filter "available to get" tags
(`renderAffinities` and the `availHtml`/`petAvailHtml` block in `web/src/adapters/sidebarView.ts`). When
points are spent, fewer benefits are obtainable and that lower area empties, opening the space.

v1 primary surface: a sidebar STEP-LIST WITH CONSTELLATION IMAGES.

- Numbered rows rendering the `Step[]`: `complete` rows show the constellation image + name + points;
  `scaffold-add` / `scaffold-refund` rows are visually distinct (e.g. an "add/refund" marker) and show the
  running "held: N" total. Constellation art is the same manifest art the map uses
  (`svgRenderer.ts`: `c.background.image` -> `manifest.images[name]`).
- list <-> map hover-sync: hovering a step row highlights that constellation on the map, reusing the
  existing hover/`data-con-id` infrastructure (`svgRenderer` tags constellations with `data-con-id`;
  powers already use `data-star-id` for hover -> map tooltip).
- The not-found state renders the honest message and (tier 3) the [Verify] button in the same panel.

Follow-on (not v1): full numbered map badges (a step-number badge on each constellation on the map). A
single static number per constellation cannot express the scaffold add/refund timing or the running total,
so it complements the list rather than replacing it.

## Data flow

`main.ts` computes the `BuildPath` from the current `selection` + `cap` (the same inputs it already holds
for the reachability sweep) and passes it to `sidebarView` to render under the affinity panel. Because it
is a pure function of existing state, it recomputes on the same events that drive selection re-render; no
new state, no URL changes.

## Testing

- Engine, hand-verifiable: small synthetic models (`modelFromCons`, as in `reach-peakcost.test.ts`) with a
  known scaffold dance - assert the emitted path contains the expected `scaffold-add` + `scaffold-refund`,
  `heldAfter` never exceeds the cap, and the final state equals the selection.
- Engine, real bootstrap cases: Affliction/Vulture/Ghoul and Oklaine produce a path whose scaffold step is
  the expected crossroads, refunded once the build self-covers.
- Invariant (the strong guard): for fuzzed reachable builds, REPLAY the produced order and assert it is a
  legal construction - at each step the held affinity covers the next member's requirement, held points <=
  cap, and the end state equals the selection. This guarantees v1 never shows an invalid path.
- No-path cases: the two confirmed false-reaches (`just realmap-hunt --probe 5563,41966`) return "no valid
  order" from tiers 1-2; when tier 3 lands, the bounded exact verify confirms "not buildable".
- UI: render the step-list from a fixed path and assert rows, scaffold markers, images, and running
  totals; hover-sync highlights the right constellation.
- Performance guard (REQUIRED, do not skip): because the path is always-on, it is part of the real
  per-click cost and must be inside what the perf guard and harness measure. Today both time `selectionView`
  (the per-click engine throat): `web/test/reachability-perf-guard.test.ts` (the coarse seconds-scale
  regression bound over the tight-build fixtures) and `web/scripts/perf-reachability.ts` (`just perf`,
  the distribution harness). Build-order production must be folded into that same timed path - either by
  computing it inside `selectionView` or by extending the guard/harness to time `selectionView + buildOrder`
  together over the same fixtures (including the tight Affliction-stacks, where the path costs the most).
  The guard must fail if always-on build-order pushes per-click wall-clock past its bound. This is the
  explicit fix for the prior gap of testing a subset of the live interaction rather than the whole thing.

## Code pointers

- `web/src/core/reachability.ts`: `minPeakSampledOrder` (583), `sampledConstruction`, `peakToReach` (407),
  `minPeakSampled`. The scaffold-schedule emitter is a new function here (or a focused new module) plus the
  small `peakToReach` change to return the chosen subset.
- `minPeakCost` (tier 3): branch `reachability-costed-scaffolding` `web/src/core/reachability.ts`; vendored
  in `web/scripts/reachability-realmap-hunt.ts`. Port into `web/src/core` for the bounded verify.
- `web/src/adapters/sidebarView.ts`: render the step-list panel under `renderAffinities`.
- `web/src/adapters/svgRenderer.ts`: constellation art manifest (`manifest.images`), `data-con-id` for
  hover-sync.
- `web/src/app/main.ts`: compute `BuildPath` from selection + cap, wire the panel and hover-sync.
