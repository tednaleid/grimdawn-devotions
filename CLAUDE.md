# grimdawn-devotions

For project orientation (stack, build/test commands, architecture, entry points), see [ONBOARDING.md](./ONBOARDING.md).

## The domain (read this first)

This planner models Grim Dawn's devotion system: constellations, stars, affinity,
and the non-obvious rules for which selections form a legal build (activation before
self-sustain, refundable crossroads, temporary scaffolding and refund). All of that
is documented in [docs/devotion-system.md](docs/devotion-system.md), the core
reference for the whole system. Read it before working on selection, reachability,
or URL state.

## Backlog / new ideas

New ideas and backlog items go in [BACKLOG.md](BACKLOG.md) at the project root.
When you think of an enhancement that isn't ready to build, capture it there
(with implementation pointers) rather than starting it.

## URL state is shareable (invariant we maintain)

Every planner state must be bookmarkable and shareable: the full state lives in
the URL hash so a copied link restores exactly what the user saw. Any new
state-bearing feature must round-trip through `web/src/core/urlState.ts`
(`encodeHash`/`decodeHash`) and tolerate stale or malformed links. Do not add
client state that only lives in memory or the DOM.
