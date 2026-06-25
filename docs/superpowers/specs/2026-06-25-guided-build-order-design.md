# Guided build order - design draft (for review, not yet approved)

Status: DRAFT for a brainstorming pass with Ted. The engine substrate exists and is tested; the
feature shape (output granularity, scaffold presentation, UI, URL state) has open decisions that need
Ted's input before implementation. Do NOT build the UI from this draft as-is.

## The idea

Tell the user a legal click order that reaches their target build, including the non-obvious temporary
scaffolding - "add the Eldritch Crossroads + Quill to unlock the Affliction lock, then refund them once
the build covers its own requirement". These orders are hard to work out by hand; the scaffold-then-
refund moves are the part users can't see. This is the BACKLOG "Guided build order" headline item.

## Why it is now cheap

Reachability is a yes/no boolean today. Producing an order needs a witness, not a boolean - the reason
this sat in the backlog. The tight-build peak witness (`minPeakSampled`, shipped 2026-06-25) already
finds a real, peak-bounded construction order internally; we now expose it:

- `minPeakSampledOrder(cons, table, B, budget) -> ReachCon[] | null` (`web/src/core/reachability.ts`,
  tested in `web/test/build-order.test.ts`). Returns the constellations of a self-covering build `B` in
  an order that builds it within `budget` points held at once (granting members first in their peak-
  minimizing order, then zero-grant members), or null if no sampled order fits. Sound and deterministic.

This is the design-agnostic substrate: the SEQUENCE of constellations. It is useful on its own
("complete these constellations in this order").

## What is NOT built yet (engine)

The per-step transient SCAFFOLD schedule - which crossroads/constellations to hold before a step and
refund after - is the high-value, non-obvious part. The peak math already finds the scaffold SET per
step (`peakToReach`), but it currently returns only the cost, not the set, and does not record refund
points. Surfacing the full schedule is a bounded engine task once the OUTPUT SHAPE is decided (below).

## Open design decisions (need Ted)

1. **Output granularity.** Constellation-by-constellation ("complete Spear of the Heavens, then ...") or
   star-by-star (every point in order)? Star-by-star is precise but long (55 steps); constellation-level
   is readable but the user still has to pick star order within a constellation (usually obvious).
2. **Scaffold presentation.** How to show "add X and Y now, refund them after step 4"? Inline steps
   ("Step 3: temporarily add Eldritch Crossroads")? A separate "scaffolding" annotation on the affected
   steps? This is the crux of the feature's value and its clarity.
3. **Trigger + scope.** Plan the CURRENT selection's remaining points to a target? Or plan a whole
   shared/imported build from empty? Is the target the current selection, or a separate "goal" build?
4. **UI placement.** A panel, a modal, an overlay numbering the map stars? Does it animate/step through?
5. **URL state.** The plan is derived from the selection, so it need not be stored - but a "goal build"
   (if we add one) is new shareable state and must round-trip through `urlState.ts` per the project
   invariant.
6. **Determinism vs optimality.** `minPeakSampledOrder` is a sampled witness (deterministic but not the
   minimum-peak order). For guidance that is fine; if we want the provably-lowest-peak order, the costed
   branch's `exactMinPeak`/`minPeakCost` give it but cost 1-5s - acceptable for an on-demand action,
   off the per-click path.

## Suggested next step

A brainstorming session on decisions 1-3 (they drive everything), then a spec, then implement the
scaffold schedule in the engine and the chosen UI. The order substrate and its test are already in
place to build on.
