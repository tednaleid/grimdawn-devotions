# Need-driven build ordering: the build builds itself

Point-in-time design record. Build orders are now legal at every step
(2026-07-18-build-order-validity-design.md) and self-explaining
(2026-07-19-build-order-affinity-popup-design.md), but they are often
wasteful: the reproduction build renders 35 steps with off-build scaffolding
(Falcon, Quill) where a hand-built path needs about 19 using only crossroads.
The cause, established during the validity investigation: on a full-budget
build the sampler takes the first seeded shuffle whose construction peak
fits the cap, so the member order is effectively arbitrary, and the replay
then buys scaffolds to cover deficits a better member order would never
create. This effort implements the owner's algorithm sketch (BACKLOG.md,
"Guided build order: churn-minimizing, need-driven ordering"): order the
members so each is activated by what the build has already placed, and
scaffold only when genuinely stuck.

Decided during design:

- **Objective, in order:** (1) scaffold churn - points spent on
  constellations outside the final build - minimized, zero when the build
  can bootstrap from crossroads alone; (2) step count minimized; (3) the
  55-point cap as a hard constraint, falling back to the current sampler
  when the greedy cannot fit.
- **Quality gets a CI net like legality did:** the seeded corpus test pins
  aggregate churn points and step totals; a regression fails CI loudly.
  Individual orders stay unpinned so legal reshuffles do not break tests.
- Built on the `need-driven-ordering` branch from the deployed main.

## The boundary that shapes the architecture

`sampledConstruction` is not just the order-finder: through
`minPeakSampled` it is the engine's reachability WITNESS (the classify path
that decides dimming consumes it). Its ordering heuristic therefore cannot
change - a different heuristic changes which builds get witnessed at a
given `tries`, which shifts reachability semantics. The greedy is a
separate, pure order generator consumed only by `buildOrderPath`; the
sampler stays untouched as both witness and fallback.

## Architecture (approach A: greedy ordering, existing emission)

Three parts, all in `web/src/core/reachability.ts` beside the machinery
they compose with:

**1. The greedy order generator.** A pure function

    needDrivenOrder(cons, table, B):
      { order: ReachCon[]; tail: ReachCon[] } | null

Forward-constructs an order of B's granting members, deterministically, no
randomness:

- Track accumulated grants of placed members (capped addition, as
  everywhere in the engine).
- At each step the CANDIDATES are the unplaced granting members whose
  requirement is covered by the accumulated grants plus the ever-present
  crossroads seed (one point of each color is always reachable through a
  refundable crossroads; the emission replay decides whether a crossroads
  is actually bought).
- Among candidates, pick by contribution toward the most expensive
  outstanding need: the highest ratio of (points granted in colors still
  deficient for unplaced members) per star, ties broken by constellation id
  for determinism. This is the owner's Scholar's Light tiebreak: 4 green
  for 3 stars beats 5 green for 5 stars.
- When NO member is a candidate, the build is genuinely stuck without
  scaffolding: pick the unplaced member with the smallest deficit
  (elementwise shortfall against accumulated grants, summed; ties broken by
  constellation id), and let the emission replay's `peakToReach` buy
  exactly that gap - it is already
  crossroads-biased and minimal, and the drain logic refunds it legally at
  the right time.
- Zero-grant members go to `tail`, placed last, exactly as the sampler
  does today.
- Returns null only when B is not self-covering (mirroring `buildParts`),
  so callers have one honest no-order signal.

**2. buildOrderPath restructured: generate, then emit.** The emission loop
(the per-member `peakToReach` need-sets, the `drainRefunds` legality
draining, the cap guards, the tail placement) is extracted into a private
`emitSchedule(order, tail, ...): BuildStep[] | null` used by both paths.
`buildOrderPath` becomes: canonicalize input (unchanged contract), try
`emitSchedule(needDrivenOrder(...))`, and if that returns null (cap bust,
undrainable scaffold), fall back to the current sampler path
(`emitSchedule(sampledConstruction(...).order)`) exactly as today. The
public signature and the honest-null semantics are unchanged;
`buildOrderEscalated` and `minBuildableCap` inherit both paths
automatically. On builds where the greedy lands (the common case), the
per-click cost DROPS - the sampler never runs.

**3. Metrics and pins.** `just build-order-validate` gains per-group churn
metrics (scaffold points bought-then-refunded, total steps) reported next
to the legality tallies. The seeded corpus CI test
(web/test/build-order-oracle.test.ts) computes aggregate churn points and
aggregate steps across its 150 orders and asserts both stay at or below
pinned values, set from the post-change measurement with a small slack
margin and updated deliberately when the algorithm improves. The pins are
the quality analogue of the legality net: silent churn regressions become
CI failures.

## What does not change

- Legality machinery: `emitSchedule` is the existing loop verbatim
  (extraction, not rewrite); the oracle, the gate, and every legality net
  run unchanged and must stay green.
- Reachability: `sampledConstruction`, `minPeakSampled`, the classify
  path, dimming - untouched.
- The canonical-input and determinism contracts: the greedy is
  deterministic, so same build set, any member order, any call site still
  produces byte-identical output (the existing determinism tests enforce
  this automatically against the new orders).
- The popup: `StepState`s ride whatever order is emitted; zero changes.
- URL state, i18n: no new strings, no state changes.

## Testing

- Greedy unit tests (new file web/test/need-driven-order.test.ts) on
  synthetic constellations: activatable-members-first (a granter chain
  orders itself with no stuck picks), the ratio tiebreak (Scholar's Light
  shape: the denser granter goes first), the smallest-deficit stuck pick,
  zero-grant members in tail, null for a non-self-covering set,
  deterministic id tiebreaks.
- The reproduction build, measured: a test asserts its order's churn and
  step count land at or below pinned values (expected: churn near zero,
  steps in the low twenties versus 35 today; exact pins set from the
  implemented measurement, recorded in the plan's execution).
- Aggregate corpus pins as above; all existing legality, determinism,
  tight-cap, popup, and panel-agreement tests unchanged and green.
- `just build-order-validate` before/after comparison recorded in the
  final task's report (churn and FALSE-POSITIVE/NEGATIVE tallies).
- Perf: `just perf` must show no regression; improvement on greedy-hit
  builds is expected but not pinned.

## Documentation

docs/reachability-engine.md, "The guided build order" section: a short
paragraph on the ordering strategy - need-driven greedy first (the build
builds itself; scaffolding only when stuck), min-peak sampler as cap
fallback and reachability witness - rewritten in place per the living-docs
rule.

## Non-goals

- No joint member-and-scaffold scheduler (approach B); the emission loop
  stays authoritative for scaffold timing.
- No sampler heuristic changes (approach C, forbidden by the witness
  boundary).
- No compare-transition work (parked on `compare-transition`; it inherits
  better ordering when it lands later).
- No UI changes.

## Acceptance

- The reproduction URL's order: churn and steps at or below their pins
  (target: crossroads-only scaffolding, low-twenties steps).
- Seeded corpus: zero oracle failures (unchanged bar) AND aggregate
  churn/step pins hold.
- Full gate, `just fuzz`, `just e2e`, `just perf` green; per-click cost on
  greedy-hit builds at or below today's.
