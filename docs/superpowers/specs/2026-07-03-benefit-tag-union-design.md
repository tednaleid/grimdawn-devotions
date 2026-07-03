# Benefit-tag discriminated union: one codec for the tag vocabulary

Date: 2026-07-03
Status: approved design, not yet implemented

## Problem

Benefit filter tags are stringly typed with prefix conventions: a bare stat id
is a player tag, `pet:<id>` is a pet tag, `aff:grant:<affinity>` and
`aff:req:<affinity>` are affinity tags. The vocabulary is constructed and
parsed by scattered string surgery:

- `urlState.affinityTagId` and `canonicalBenefitIds` format tags.
- `aggregate.availablePetKeys` formats `pet:<id>` inline.
- `main.ts` `taggedStars` and `affinityFilterSets` parse with
  `startsWith`/`slice`, including an unchecked `as Affinity` cast.
- `sidebarView` builds `pet:<id>` in two `keyOf` closures; `tooltipView`
  takes a raw `scope: string` prefix parameter and concatenates it.

Nothing stops a malformed tag from being constructed, and the namespace
knowledge lives at nine sites. The URL bitset decoder happens to make garbage
unreachable at runtime today, so this is a compile-time-safety and
single-source-of-truth refactor, not a bug fix; behavior must not change.

## Decision

A codec plus typed constructors, with `Set<string>` retained as the working
representation. The DOM (`data-vid` attributes) and the URL bitset speak
canonical strings either way, and membership checks at the DOM boundary are
string shaped, so pushing the union into `selectedBenefits` would add a parse
step at every boundary check for no gain. The union is used at the semantic
sites; strings remain the wire and storage form.

## The module: `web/src/core/benefitTag.ts`

```ts
export type BenefitTag =
  | { kind: "player"; statId: string }
  | { kind: "pet"; statId: string }
  | { kind: "affinity"; dir: "grant" | "req"; affinity: Affinity };

/** Canonical string form: "<id>" | "pet:<id>" | "aff:<dir>:<affinity>". */
export function formatTag(tag: BenefitTag): string;
/** Total for player/pet forms; null only for malformed "aff:*" strings. */
export function parseTag(s: string): BenefitTag | null;
/** Convenience string builders used at construction sites. */
export function petTagId(statId: string): string;
export function affinityTagId(dir: "grant" | "req", a: Affinity): string; // moves here from urlState
```

Rules, matching current behavior exactly:

- A bare id (no recognized prefix) parses as `player`.
- `pet:<anything>` parses as `pet` with the remainder as `statId`.
- `aff:<dir>:<affinity>` parses as `affinity` only when `dir` is `grant` or
  `req` AND the affinity segment is in `AFFINITIES`; any other `aff:*` form
  returns null. This deletes the `as Affinity` cast in `main.ts`.
- Codec invariant: `formatTag(parseTag(s)!) === s` for every canonical id.

## Site conversions (mechanical, nine sites)

- `core/urlState.ts`: `affinityTagId` moves out (importers update);
  `canonicalBenefitIds` builds its pet block with `petTagId` and its affinity
  block with `affinityTagId`. Output strings are unchanged, so the URL `b=`
  format and bit ordering are untouched.
- `core/aggregate.ts` `availablePetKeys`: `petTagId(k)` instead of
  `` `pet:${k}` ``.
- `app/main.ts` `taggedStars` and `affinityFilterSets`: each becomes a loop
  over `parseTag` with a `switch` on `kind`; all `startsWith`/`slice` calls
  and the `as Affinity` cast are removed. Null parses are skipped.
- `adapters/sidebarView.ts`: the two `(id) => \`pet:${id}\`` closures become
  `petTagId`; `affinityTagId` import path changes.
- `adapters/tooltipView.ts`: `bonusRowsHtml`'s `scope: string` prefix
  parameter becomes `keyOf: (id: string) => string` (identity for player,
  `petTagId` for pet), so no caller concatenates a namespace prefix again;
  `affinityTagId` import path changes.

## Testing

- New `web/test/benefitTag.test.ts`: round-trip property over every id in
  `canonicalBenefitIds(model)` built from the real dataset; explicit cases
  for each variant and for malformed forms (`aff:grant:banana`, `aff:bogus`,
  and `aff:grant:` all parse to null; a bare `pet:` parses as a pet tag with
  an empty statId, matching today's `slice(4)` behavior).
- Existing guards carry the rest: `urlState.test.ts` pins canonical ordering
  (URL compatibility), sidebar/tooltip tests pin rendered `data-vid`
  attributes. No behavior change, so no new snapshot.

## Scope

Pure refactor, no behavior change. Roughly 150 lines across six files plus
the new module and test. Small enough for inline execution on a short branch;
the standard `just check` gate covers it.
