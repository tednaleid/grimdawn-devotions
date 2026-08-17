# Round-tripping a grimtools build: the planner as the devotions editor

Let someone import a whole grimtools character, rework its devotions here, and export a
copy of that character with the new devotions and everything else (gear, masteries,
attributes, quickbar, celestial-power bindings that still apply) exactly as it was. Until
now export produced a bare level-100 character with only stars, so a player editing a
real build had to redo the devotions by hand in grimtools.

This builds on the export shipped on 2026-08-16
([spec](2026-08-16-grimtools-export-design.md), [how it works now](../../grimtools-import.md))
and changes three things: the export request can name a base build, the planner reads
the associated build at load so the panel always shows its name, and the source link
renders that name plainly.

## What the probe established

Measured against the live site on 2026-08-16 by reading `buildInfo` from two public
builds (`qNYgbjeV`, `VWPyL95Z`) and the serializer and loader in `calc.js`.

**`buildInfo` is `{ data, masteries, created_for_build }`.** Only `data` is what Share
posts (`data=<JSON>&mod=`); `masteries` and `created_for_build` are derived server-side.
`data` is `{ bio, equipment, potions?, skills, itemSkills, transformSkills, quickbar,
devotionsProgression, skillsProgression }`, about 5 KB for a full character. `mod` is
hardcoded to `""` in the calculator's Share, and our star table is vanilla-only, so mods
are out of scope.

**Devotion stars are `skills[]` entries `{ name: "sk<id>", level: 1 }` mixed in with
mastery skills**, exactly as import already assumes. The loader recognizes a star by
membership in its devotion table and computes points available as
`maxDevotionPoints (55) - starCount`; `bio.devotionPoints` is written by the serializer
but not read back for that number, so it is bookkeeping.

**Celestial-power bindings name the star's own `sk` id.** A mastery skill bound to a
power carries `autoCastSkill: "sk<star id>"` on its `skills[]` entry. An item-granted
skill bound to a power is an `itemSkills[]` entry `{ autoCastSkill, name, itemName,
itemSlot }`, and a transformed skill bound to a power is a `transformSkills[]` entry
`{ autoCastSkill, name, mastery, transformSkill }`; the serializer emits those two arrays
only from bindings (one entry per bound star), so an entry with its binding removed has
no reason to exist. In `qNYgbjeV` all eight `autoCastSkill` values are stars in our table
(e.g. `sk699` = anvil:4). Nothing else in `data` references stars: the quickbar holds
mastery and item skills only, because celestial powers are auto-cast in the game.

## Decisions

1. **The base build is the associated build, by reference.** `gt=<slug>` already stays in
   the hash after the selection is edited (only ✕ removes it) and grimtools builds are
   immutable, so the URL already names the character to copy from. No new hash parameter
   and no in-memory "held build": a reloaded or shared link round-trips as well as the
   session that made it, and the URL-state invariant holds by construction.
2. **The worker splices, by instruction.** `POST /export` gains an optional
   `base: { slug, remove }`. The worker fetches the base page, replaces the named skill
   entries with the new stars, and posts everything else byte-for-byte as grimtools wrote
   it. It still holds no game knowledge: the planner tells it which of the base's skill
   ids are devotion stars (`remove`), because only the planner has the table. The
   alternative, widening the GET response to the whole `data` and having the planner post
   a full character, would turn the worker into a relay for arbitrary caller-supplied
   JSON; with the chosen shape the only caller-controlled bytes that reach grimtools are
   validated `sk` ids and a slug.
3. **A fetched build never changes the selection or the cap.** Only Import applies stars
   to the planner. The load-time read (Decision 5) and the export-time read supply the
   title and the base's star list; a user who imported X, toggled stars and refreshed sees
   their tweaked selection with X's name on the link. One case is an import: a hash that
   names a build but selects nothing (a link straight to a grimtools build) runs the
   import on the user's behalf, rewriting the hash in place; a reset map keeps its `gt=`
   and so shows the build again on reload, which is accepted.
4. **A base that cannot be read is reported, not worked around.** If the base slug does
   not resolve, or its `dataVersion` disagrees with the table (so `remove` cannot be
   trusted, the same rule import applies), Export shows an error and creates nothing.
   ✕ is the existing escape hatch: it drops the base and Export produces the bare
   devotions-only build. Silently exporting a bare character in that case would hand the
   user a link that is not what they were promised.
5. **The associated build's title is always shown, fetched at load.** With a `gt=` in the
   hash the planner reads the build through the gateway once and repaints the link with
   its title; until then, or if the read fails, the link says "grimtools build". The title
   is not put in the URL: the slug is the fact and the title derives from it, text in the
   hash would be spoofable and would bloat every shared link. This replaces the earlier
   "a shared link never re-fetches" property; the selection still restores from the
   bitset without the network, so a worker outage costs only the title and the memo.
   The same read fills the duplicate-export memo, so an unchanged imported build no
   longer offers Export after a refresh.
6. **No extra ready-state text.** The source link beside the button is the signal that
   Export copies that build; the disabled and error hints remain the only messages.

## Architecture

```
planner (browser)
  core/grimtools.ts        extractBuildInfo returns data; spliceDevotions;
                           EXPORT_CONTRACT_VERSION = 2
  ports/GrimtoolsGateway   fetchBuild(slug), saveBuild(skills, base?)
  adapters/grimtoolsWorkerGateway   adds base to the POST body, sends v=2
  adapters/importPanel     link text = title, title attribute = title
  app/main.ts              builds memo (slug -> fetched build), load-time read,
                           export with base

worker (Cloudflare)
  GET  /?slug=       unchanged
  POST /export       {skills, base?} -> {slug}; with base: fetch, splice, save
```

## Part 1: core

`web/src/core/grimtools.ts`:

- `extractBuildInfo(html)` returns `{ skillIds, gameVersion, data }` where `data` is the
  parsed `buildInfo.data` object as-is (`unknown` shaped, validated by the splice). It
  already parses the object; it stops discarding it.
- `spliceDevotions(data: unknown, remove: readonly string[], stars: readonly string[]): unknown | null`
  returns a new `data` where:
  - `skills` = the base entries whose `name` is not in `remove`, in their original order,
    followed by `{ name, level: 1 }` for each of `stars` not already present among the
    kept entries (a star both kept and requested is not duplicated).
  - `bio.devotionPoints` = `max(0, base.bio.devotionPoints + removedCount - addedCount)`,
    where `removedCount` is the number of entries actually dropped and `addedCount` the
    number actually appended.
  - Every `skills[]` entry whose `autoCastSkill` names a removed star that is not in
    `stars` loses that field (the mastery skill itself stays). Every `itemSkills[]` and
    `transformSkills[]` entry whose `autoCastSkill` names such a star is dropped, matching
    what the serializer would have written with the binding gone. Bindings to stars that
    remain are untouched.
  - Every other field of `data`, and every other field of every entry, is passed through
    unchanged (`potions`, `equipment`, `quickbar`, both progressions, unknown future
    fields).
  - Returns `null` unless `data` is an object with a `skills` array whose entries are
    objects with a string `name` and a number `level`, and a `bio` object with a number
    `devotionPoints`; `itemSkills`/`transformSkills` may be absent (treated as empty).
    A page we do not understand becomes a clean failure rather than a corrupted save.
- `savePayload(stars)` is unchanged and remains the bare path.
- `EXPORT_CONTRACT_VERSION` becomes `2`.

## Part 2: the worker route

`POST /export` body: `{ skills: string[], base?: { slug: string, remove: string[] } }`.

Validation, in addition to today's (origin, 4096-byte bound, 1..55 distinct `sk` ids in
`skills`): when `base` is present it must be an object whose `slug` passes `isSlug` and
whose `remove` is an array of 0..128 distinct `sk` ids. Anything else is 400
`bad_request`. `remove` may be empty (a gear-only base with no stars). The 128 bound is
looser than 55 only so an odd hand-built base does not produce a misleading refusal;
it is not a semantic limit. Rate limits are checked before any upstream call, as now.

Flow with a base, after the limiter:

1. Read the base page with the same calc-page reader the import route uses. A 404, a
   grimtools `null` (no such build) or a fetch failure is 502 `upstream`: the planner
   confirmed the slug moments earlier, so this is a race, not a user state. A page whose
   `buildInfo` cannot be extracted is 502 `unparseable`.
2. `spliceDevotions(info.data, base.remove, skills)`; `null` is 502 `unparseable`.
3. POST `data = JSON.stringify(spliced)`, `mod = ""` to `save_build.php` exactly as the
   bare path does (same headers, timeout, redirect handling, response re-validation).

Without a base the route behaves exactly as today. Responses stay `no-store`, 201
`{ slug }` on success. `MAX_EXPORT_BODY` stays 4096: a full request is about 1 KB.

## Part 3: the planner

**Builds memo.** `main.ts` keeps `builds: Map<slug, { title: string | null; skills: string[]; dataVersion: string | null }>`
for every build read this session, holding the gateway response as received (`skills`
are grimtools `sk` ids, stars and mastery skills mixed). It is filled by import and by
the load-time read, and never consulted for the selection. `knownBuilds` (star-set key
to slug), the duplicate-export memo, stays and is filled from the same reads: the
build's full mapped star set (`mapStars(skills, table)`) is memoized under its key,
because "this exact set is that build" holds whether or not the planner could show it
unpruned. Import keeps its rule of memoizing `state.selected` only when nothing was
pruned; the two agree whenever the import was clean.

**Load-time read.** At boot and on every hashchange that yields a `source`, if `builds`
has no entry for it, `gateway.fetchBuild(source)` runs in the background. On success, if
`source` is still that slug, the memo is filled and `syncImportPanel` repaints the link
with the title and the export state (so an unchanged imported build hides Export). On
`notFound` or `network` nothing changes: the link keeps the fallback label. No error is
shown, and the selection is never touched (Decision 3). A `dataVersion` mismatch still
records the title (display only) but does not memoize the star set.

**Panel.** `syncImportPanel` passes `title: builds.get(source)?.title` with every
`done` state, so the title survives every repaint (hashchange, ✕ then re-associate,
export flow) instead of only the import that produced it. The link text is the title
when there is one, else `ui.import.source` ("grimtools build"); no "grimtools:" prefix,
so `ui.import.sourceTitled` is removed from the catalog and its guard. The text is set as
text, not markup. The link's `title` attribute is always the full title, so the browser
tooltip shows it whenever the CSS truncates the label.

**Export with a base.** In `runExport`, when `source` is set:

1. Base = `builds.get(source)`, else `await gateway.fetchBuild(source)` (also memoized).
   `notFound` sets `exportError = { key, code: "base" }`; `network` sets `network`.
2. If the base's `dataVersion` is present and differs from the table's, error `base`.
3. `remove` = the base's `skills` that are keys in the star table (its devotion stars in
   `sk` form; a mastery skill is never in the table, so it is never removed).
4. `gateway.saveBuild(skills, { slug: source, remove })`.

Everything else in `runExport` (pinning to the selection captured before the first
await, the memo short-circuit, association only if the selection is unchanged,
`writeHash("push")`) is unchanged. On success the new slug becomes `source`; a later
export chains from it, which is a full character too.

**Port and adapter.** `saveBuild(skills: string[], base?: { slug: string; remove: string[] })`.
The adapter puts `base` in the JSON body when given and sends `v=EXPORT_CONTRACT_VERSION`
(2). Result mapping is unchanged (201 ok, 429 rateLimited, 502 upstream, else network).

**Panel states.** `ExportErrorCode` gains `"base"`. Catalog: `ui.export.err.base` in all
13 locales ("The source build could not be read. Clear it (✕) to export a fresh build."
in English), added to the `appCatalog` guard; `ui.import.sourceTitled` removed from
all 13 locales and the guard.

## Errors

| Situation | Where | User sees |
|---|---|---|
| Base slug gone or `dataVersion` mismatch at export | planner | `ui.export.err.base` |
| Network failure reading the base at export | planner | `ui.export.err.network` |
| Base unreadable at the worker (race, malformed page) | worker 502 | `ui.export.err.upstream` |
| Malformed `base` field | worker 400 | `ui.export.err.network` (a planner bug, not a user state) |
| Load-time read fails | planner | fallback label "grimtools build", no message |

## Testing

- **Core** (`web/test/grimtools.test.ts`): `spliceDevotions` against a fixture cut from
  `qNYgbjeV`'s `buildInfo.data` (checked in under `web/test/fixtures/`): removes and
  adds; `devotionPoints` arithmetic and the floor at 0; a requested star already kept is
  not duplicated; `autoCastSkill` stripped from the `skills[]` entry, `itemSkills[]` and
  `transformSkills[]` entries dropped, when their star is removed; bindings to kept stars
  untouched; every field other than `skills`, `bio.devotionPoints`, `itemSkills`,
  `transformSkills` deep-equal to the input; `null` for a missing `skills`, a non-object
  entry, a missing `bio.devotionPoints`; `extractBuildInfo` returns `data`.
- **Worker** (`web/test/worker.test.ts`): base path fetches the base page and posts the
  spliced `data` (asserted by parsing the form body); `remove: []` accepted; base 404,
  `null` page and fetch failure are 502 `upstream`; unextractable base is 502
  `unparseable`; malformed `base` (bad slug, non-array `remove`, 129 ids, duplicates) is
  400; the bare path is byte-identical to before; version 2 in the contract test.
- **Gateway** (`web/test/grimtoolsWorkerGateway.test.ts`): body with and without `base`,
  `v=2`.
- **Panel** (`web/test/importPanel.test.ts`): title as link text without prefix, `title`
  attribute set to the full title, fallback label when null; `base` error text.
- **Catalog** (`web/test/appCatalog.test.ts`): key added and key removed.
- **End to end** (playwright against `just worker-dev` + `just serve`, manual gate):
  import `qNYgbjeV`; swap a bound constellation for another; export; open the new slug
  on grimtools and confirm gear, masteries and attributes intact, devotions changed, the
  removed binding gone and the others kept; refresh the planner and confirm the title
  shows and Export is hidden for the unchanged import.

## Documentation

- `docs/grimtools-import.md`: base semantics, the load-time read (replacing "never
  re-fetches on load"), the `base` error, title display; drop "Export covers devotions
  only" from Known limits and add "quickbar entries are passed through untouched".
- `worker/README.md`: contract v2 body shape and the base flow.
- `BACKLOG.md`: remove the round-trip entry.

## Out of scope

- Mods (`mod` stays `""`; the star table is vanilla-only).
- Quickbar entries: passed through untouched; celestial powers do not appear there.
- A hint in the ready state naming the base (Decision 6).
- Marking a selection as "modified since import".
