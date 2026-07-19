# Build order validity: legal at every step, verified or absent

Point-in-time design record. The build-order panel can emit refund steps that
are illegal in-game: on roughly 1 in 23 builds, a scaffold refund strands a
standing constellation whose requirement the refunded grant still sustains. A
player following the panel star by star hits a wall at that step. The rule,
confirmed in-game during design: a star cannot be refunded when the refund
would leave any standing constellation with unmet affinity requirements. The
project owner's bar, stated plainly: the build order must be valid at every
step, and no order is better than an illegal order.

This work fixes the vanilla panel and builds the test suite that keeps it
fixed. The compare-mode transition feature that surfaced the bug is parked on
the `compare-transition` branch until this lands; this effort proceeds on the
`build-order-validity` branch cut from the deployed main.

## The two defects (both root-caused, evidence in hand)

**1. Illegal refunds.** `buildOrderPath` (web/src/core/reachability.ts)
diffs consecutive scaffold need-sets and emits the refund batch in held-array
order. Nothing checks whether a refunded scaffold's grant still sustains a
standing member. Live reproduction (deployed site, found by the project
owner): `#p=55&s=_38AQAIAAAAAAOAfAAAAAADAAYAHAMAHAAAAAPADPwAAAAAAPw` - the
panel's step 5 says Refund Falcon while Berserker (completed step 4, requires
5 Ascendant and 5 Eldritch) still leans on Falcon's grant. A prior sweep
measured 43 of 999 sampled orders affected (4.3 percent), all at refund
steps, never at adds.

**2. Call-site order sensitivity.** `buildOrderPath`'s output depends on the
ORDER of the members array, not just the set: `sampledConstruction` sorts the
granting members with a stable sort (ties keep input position) and its seeded
shuffles start from that arrangement. The panel (members in
`selectionSummary` iteration order) and a test harness (members in generator
pick order) therefore produce different, individually-deterministic orders
for the same build - which is how an early diagnostic "reproduction" printed
an order the live panel never showed. A regression net cannot hold if the
harness provably exercises different orders than users see.

## The fix

Both changes land in `buildOrderPath` and its helpers, smallest reasonable
diff, test-first:

- **Canonicalize input**: sort the members array by constellation id at
  entry, making the output a pure function of the build set. Any caller -
  panel, test, script - gets the identical order for the identical build.
- **Dependency-order refund batches**: when a step's need-set drops held
  scaffolds, refund them in an order where each refunded scaffold's grant is
  not load-bearing for what remains (iterate the batch, refund the safe
  ones, repeat until drained; the parked spike's `drain()` in
  web/scripts/transition-spike.ts on the `compare-transition` branch is the
  reference pattern). If a batch cannot fully drain, the order is not
  emittable as-is and the search must treat that schedule as failed rather
  than emit an illegal step (the honest-null philosophy, extended to
  refunds).

## The test suite (built first, before the fix)

The legality oracle from the transition spike is the ground truth: an
independent step-replayer asserting, at every step, that every standing
constellation's requirement is covered by standing complete grants
(conservative mid-step semantics), the cap is respected on adds, and the end
state equals the target build. It was reviewed against
docs/devotion-system.md and the engine's own `selectionSummary` semantics,
and it caught this bug.

- **Promote the oracle** from the `compare-transition` branch (cherry-pick
  or extract from web/scripts/transition-spike.ts, commit 8a13994) into a
  from-scratch-order guard: a from-empty order is a transition from the
  empty build, so the oracle applies unchanged.
- **Seeded replay at scale in CI**: generate valid builds with the fuzzer's
  forward generator, run `buildOrderPath` on each through the PANEL's exact
  member path (`selectionSummary(...).built`), and assert every emitted
  order passes the oracle. Before the fix this fails at the measured ~4
  percent rate; after the fix it must pass at zero and stays as the
  permanent regression net.
- **Named regression fixture**: the owner's live URL above, decoded with
  `decodeHash`/`selectionSummary` - asserting its order is oracle-clean and,
  until the fix lands, documenting the exact illegal step it currently
  produces.
- **Determinism pinning**: same build set in shuffled member orders produces
  byte-identical orders (locks the canonicalization); repeated runs are
  byte-identical (locks against accidental entropy).
- **Tight-cap adversarial corpus**: the seeded generator yields organically
  valid builds (mostly 51 to 55 stars) and the fixture file adds real ones,
  but neither deliberately stresses zero-slack shapes - builds at or within
  a point or two of the 55 cap whose construction needs heavy scaffolding,
  where refund batches are largest and the drain logic works hardest. Sweep
  seeds for the orders with the most refund steps and the least cap slack,
  pin the worst offenders as named fixtures, and run them through the
  oracle alongside the rest.
- **Escalated-path coverage**: `minBuildableCap` and any other
  `buildOrderPath` callers inherit the canonicalized, legal behavior; a
  test covers at least one such caller.

## Verified or absent (production gate)

The panel renders only orders that passed the oracle. `selectionView` (or
the adapter boundary, whichever the plan finds cleaner) runs the legality
replay on the order before handing it to `buildOrderHtml`; a failing order
is withheld and the panel shows the existing honest empty state
(`NoOrderInfo`) instead. After the fix the gate should never trip - it
exists so that displaying an illegal order is structurally impossible, not
merely tested against. The replay is linear and sub-millisecond; it adds no
perceptible per-click cost.

## Documentation (same change, living docs)

- docs/devotion-system.md: the strict reading of "removal cannot strand a
  dependent," confirmed in-game - a constellation cannot be refunded while
  any standing constellation (itself included, mid-teardown) would be left
  with unmet requirements.
- docs/reachability-engine.md: the verified-or-absent invariant and the
  canonicalized-input contract of `buildOrderPath`.
- CLAUDE.md: a short invariant entry alongside the URL-state and i18n
  invariants: the build-order panel renders only verified-legal orders.

## Acceptance

- The owner's reproduction URL renders a legal order end to end.
- CI replays seeded panel-path orders through the oracle at zero failures.
- Same build set, any member order, any call site: identical output.
- `just check`, `just fuzz` (unchanged engine semantics elsewhere), and the
  perf guard stay green; `just perf` confirms no per-click regression.

## Non-goals

- No transition/compare-mode work (parked on `compare-transition`).
- No change to which builds GET an order (reachability semantics untouched);
  only step ordering, canonicalization, and the display gate.
- No panel UI changes beyond the gate's use of the existing empty states.
