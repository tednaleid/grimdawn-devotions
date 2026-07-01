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

## Living docs are evergreen

The top-level reference docs in `docs/` (for example `devotion-system.md`,
`reachability-engine.md`, `reachability-performance.md`, `display-model.md`) describe how the system
works **now**. Keep them concise and current: when behavior changes, rewrite the
affected part in place. Do not append chronological "Update YYYY-MM-DD" sections,
leave superseded claims standing, or turn a reference doc into a change-log. A
point-in-time design record belongs in a dated spec under
`docs/superpowers/specs/`; those (and `docs/specs/`) are the historical artifacts,
the top-level docs are not.

## URL state is shareable (invariant we maintain)

Every planner state must be bookmarkable and shareable: the full state lives in
the URL hash so a copied link restores exactly what the user saw. Any new
state-bearing feature must round-trip through `web/src/core/urlState.ts`
(`encodeHash`/`decodeHash`) and tolerate stale or malformed links. Do not add
client state that only lives in memory or the DOM.

## Internationalization (invariant we maintain)

This is a fully internationalized app. No user-facing string is hardcoded in app
code: every app-authored string resolves through `translate(key, params?)` against
`web/src/i18n/app.<locale>.json`, with a per-key fallback of active locale, then
English, then the raw key. Game-data text resolves from extracted per-language tag
tables (authoritative, see docs/i18n.md). Locale is a viewer preference detected
from the browser and is never in the URL hash; selection ids stay language
independent. When you add a user-facing string, add a catalog key (never a literal)
and add it to the `web/test/appCatalog.test.ts` guard.
