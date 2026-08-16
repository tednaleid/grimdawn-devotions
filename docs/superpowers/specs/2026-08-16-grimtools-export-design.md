# Exporting a selection to a fresh grimtools build

Let someone press one button and get a grimtools calculator link that shows the
devotion stars they planned here. This is the reverse of the import shipped on
2026-08-09 ([spec](2026-08-09-grimtools-devotion-import-design.md),
[how it works now](../../grimtools-import.md)), and it reuses that feature's three
pieces: the mapping table, the Cloudflare Worker, and the planner's import panel.

The runtime work is small. This spec records what the investigation established
about how grimtools saves a build, because it is the reason the feature is small,
and it fixes the decisions that keep the worker safe to expose.

## What the investigation established

Measured against the live site on 2026-08-16, game build 1.3.0.7, by reading
`calc.js`, driving the calculator in a headless browser, and replaying the request
with curl.

**The calculator is entirely client-side.** Clicking devotion stars makes no server
request at all (only static `devotion.json` and map tiles load). The whole build
lives in JavaScript globals until the user presses Share.

**Share is a single POST that returns the slug.** The Share handler serializes the
whole build and sends:

```
POST https://www.grimtools.com/save_build.php
Content-Type: application/x-www-form-urlencoded
X-Requested-With: XMLHttpRequest
Referer: https://www.grimtools.com/calc/

data=<JSON, see below>&mod=
```

and receives `{"id":"2ga0aJyZ"}`; the calculator then navigates to
`/calc/2ga0aJyZ`. No login, no session cookie and no CSRF token are involved: the
page's `token` global is the literal string `"-"` and only the separate
`load_build.php` sends it. The response is `Cache-Control: no-store`.

**A non-browser client is accepted.** The same POST from curl (same headers, a
stripped payload with empty quickbars) returned `{"id":"28qWq43V"}`, and that page
renders in grimtools with the star lit. Cloudflare did not challenge the request.
So the worker can relay it. Two throwaway builds exist from the investigation:
`2ga0aJyZ` (via the UI) and `28qWq43V` (via curl).

**Builds are immutable.** Every POST mints a new id; there is no update endpoint.
The calculator only reuses an id when its own "unchanged since last save" check
passes, which is a client-side optimisation, not a server feature.

**The payload is the object our importer already reads back.** It is
`window['buildInfo'].data` on the saved page. Devotion stars are
`{name: "sk<id>", level: 1}` entries in `skills`, the same `sk` id space the
committed mapping table covers (`sk739` is `crossroads_primordial:0`), so the
export is the inverse of the lookup the import already does. The exact body the
calculator sent for a level-100 character with one crossroads star:

```json
{"bio":{"level":100,"attributePoints":109,"skillPoints":250,"devotionPoints":54,
        "physique":50,"cunning":50,"spirit":50},
 "equipment":{},"potions":{},
 "skills":[{"name":"sk739","level":1}],
 "itemSkills":[],"transformSkills":[],
 "quickbar":{"mouse1":{"left":{"isSkill":true,"skillName":"sk1350"},"right":null},
             "mouse2":{"left":null,"right":null},
             "quickbar1":[null,null,null,null,null,null,null,null,null,null],
             "quickbar2":[null,null,null,null,null,null,null,null,null,null]},
 "devotionsProgression":[],"skillsProgression":[]}
```

`devotionPoints` is the points remaining out of 55. The server stamps
`created_for_build` (game version) itself; the client does not send it. The
stripped payload (empty quickbars, `mouse1.left` null) saved and rendered
identically, so the export sends that simpler shape.

**`devotionsProgression` is a passthrough.** It is stored on load and written on
save, but the only recorder in the UI is the Skill Progression one; nothing renders
a devotion progression. There is nothing to gain by sending our build order in it,
so the export sends an empty array. Separately, grimtools now shows a "Devotion
path" panel that computes a step-by-step path from the selected constellations; it
is their own feature and not part of the saved build.

**CORS blocks calling it from the browser.** `save_build.php` returns
`Access-Control-Allow-Origin: https://www.grimtools.com`, hardcoded. A POST from our
origin would either be preflighted and refused (with the `X-Requested-With` header)
or sent as an opaque simple request whose `{id}` we cannot read. So, as with import,
a cooperating server is required, and it is the only reason the worker is involved.

## Decisions

These were made in the design conversation and the rest of the spec follows from
them.

1. **The planner maps, the worker relays.** The worker keeps holding no game
   knowledge: the planner turns star ids into `sk` ids with the table it already
   loads for import, and the worker validates shape, builds the payload and posts
   it. A game-data update touches only the table, never the worker, exactly as for
   import. The alternative (the worker bundling the table so it can refuse
   non-star ids) was rejected: grimtools' own endpoint is open to anyone
   unauthenticated, so that check protects nothing, and rate limiting is what
   protects our quota.
2. **An exported build becomes the associated grimtools build.** Success puts the
   panel in the same link-plus-clear state an import ends in and writes
   `gt=<slug>` to the hash, so a shared planner link also carries the grimtools
   link. No one-off "copy this link" box, and no automatic new tab (the fetch is
   asynchronous, so browsers would treat the `window.open` as a popup and block
   it).
3. **Only a complete build can be exported.** grimtools models what the game
   allows, so exporting stars the game cannot grant would put a misleading page
   behind a link. Export is disabled for an empty selection, for the uncapped
   ("infinite") point mode, and for any selection the engine does not classify as
   a legal build within 55 points. The reason is stated in one short line.
4. **An unchanged selection is not exported twice, within a session.** The planner
   remembers the exact star set behind every build it imported cleanly or
   exported this session. When the current selection matches one, the panel shows
   that build's link and hides Export. This is session-scoped by design: there is
   no way to ask whether the current map matches a build made directly in
   grimtools or in another session, and a reloaded link restores the association
   but not the memo, so Export is offered again there (a duplicate build if
   pressed, which is harmless).
5. **The planner talks to the worker through a port.** Both directions (fetch a
   build, save a build) go behind a `GrimtoolsGateway` interface with one adapter,
   so the controller maps results to panel states and tests use a fake. The
   existing inline import fetch moves into the adapter unchanged in behaviour.

## Architecture

```
planner (browser, GitHub Pages)
  core/grimtools.ts        invertStarTable, toGrimtoolsSkills, savePayload,
                           EXPORT_CONTRACT_VERSION (shared with the worker)
  core/reachability.ts     SelectionView.legal
  ports/GrimtoolsGateway   fetchBuild(slug), saveBuild(skills)
  adapters/grimtoolsWorkerGateway   the only code that knows the worker's URL,
                           routes, query params and JSON shapes
  adapters/importPanel     Import textbox + Export button, one panel
  app/main.ts              wiring, session memo, hash

worker (Cloudflare)
  GET  /?slug=       unchanged (import)
  POST /export       new: {skills} -> {slug}
  ports: fetchImpl (grimtools) and limiter (rate limit binding), both injected
         through env so tests never touch the network
```

## Part 1: the worker route

`POST /export`, request body `{"skills": ["sk739", ...]}` as `application/json`,
response `{"slug": "2ga0aJyZ"}` with status 201, or `{"error": <code>}`.

The handler, in order, all bounded before any upstream call:

1. **Dispatch.** `GET /` is the import route, unchanged, including its edge cache
   (which is already bypassed for anything that is not a validated GET). `OPTIONS`
   now advertises `GET, POST, OPTIONS` and allows the `Content-Type` request
   header, because a JSON POST is preflighted. An unknown path is 404 `not_found`
   and a wrong method on a known path is 405 `method_not_allowed`, both in the
   same JSON error shape as today.
2. **Origin.** The `Origin` header must equal `ALLOWED_ORIGIN`, else 403
   `forbidden`. Browsers set it and cannot forge it; for anything else it is
   friction, not security. It keeps the CORS response identical to the import
   route's.
3. **Body.** At most 4 KB read (the cap is enforced while reading, not after).
   Must parse as JSON with `skills` an array of 1 to 55 distinct strings, each
   matching `^sk\d+$`. Anything else is 400 `bad_request`. As with import, the
   worker cannot tell a devotion star from a mastery skill; the count bound and
   the rate limit are the protection (Decision 1).
4. **Rate limit.** One Workers rate-limit binding, consulted with two keys:
   `ip:<CF-Connecting-IP>` at 5 per 60 seconds and `global` at 60 per 60 seconds,
   so neither one client nor a crowd can turn our endpoint into a firehose at
   grimtools. Either failing is 429 `rate_limited`. The binding is per Cloudflare
   location and eventually consistent, which is fine: this is a brake, not
   accounting. When the binding is absent (tests, or a local runtime that lacks
   it) limiting is skipped; the handler receives it through `env` like
   `fetchImpl`.
5. **Payload.** `savePayload(skills)` from `core/grimtools.ts`, pure and shared,
   returns the stripped shape recorded above: `bio` for a level-100 character with
   `devotionPoints = 55 - skills.length`, empty `equipment`, `potions`,
   `itemSkills`, `transformSkills`, empty quickbars, `skills` as
   `{name, level: 1}`, both progressions empty.
6. **Upstream.** POST to the constant `https://www.grimtools.com/save_build.php`
   as `application/x-www-form-urlencoded` with fields `data=<JSON>` and `mod=`
   (empty: base game), headers `X-Requested-With: XMLHttpRequest`, our existing
   `User-Agent`, and `Referer: https://www.grimtools.com/calc/`;
   `redirect: "manual"`; the same 10 second timeout. Any thrown error, redirect or
   non-2xx is 502 `upstream`. The response body is read under the existing byte
   cap and must be JSON with a string `id` matching the slug charset
   `^[A-Za-z0-9_-]{1,24}$`; anything else is 502 `unparseable`. The returned slug
   is that re-validated string and nothing else from upstream is relayed.
7. **Caching.** Every export response is `Cache-Control: no-store`. The `json()`
   helper already marks non-200 responses `no-store`; the 201 goes the same way.

The host is a compile-time constant, as for import: no request field can name a
URL, host or redirect target. Do not add one.

`EXPORT_CONTRACT_VERSION` lives beside `IMPORT_CONTRACT_VERSION` in
`core/grimtools.ts`. The client sends it as `?v=` on the export URL for the same
reason as import (a new browser-cache URL when the shape changes) even though
export responses are never cached; keeping the two routes symmetrical costs
nothing. A response-shape guard test pins the exact field set and fails if it
changes without a bump.

Deploy is unchanged: CI deploys the worker on push to `main` touching `worker/**`
or `web/src/core/grimtools.ts`. `wrangler.toml` gains the `[[ratelimits]]`
binding (wrangler 4.36 or later; the repo pins 4.120).

## Part 2: planner core

`core/grimtools.ts`:

- `invertStarTable(table)`: `sk` id to star id becomes star id to `sk` id. A test
  asserts it is a bijection over the committed 559-entry table (a collision would
  mean two stars share an `sk` id, which the import ordering invariant already
  forbids, so this is a second guard on the same artifact).
- `toGrimtoolsSkills(selected, inverse)`: the selected star ids mapped through the
  inverse, in a stable order (sorted by star id) so the same selection always
  produces the same request body. A selected star missing from the table is a
  bug (the table covers every star, gated at generation) and is reported as an
  error result rather than silently dropped.
- `savePayload(skills)`: as in Part 1, pure, with a fixture test equal to the
  stripped body that saved successfully.
- `EXPORT_CONTRACT_VERSION`.

`core/reachability.ts`: `ReachView` and `SelectionView` gain `legal: boolean`, true
when the selection is a legal build on its own, which needs two things:

- **Valid.** Every constellation with at least one selected star has its
  requirement met by the affinity of the completed constellations
  (`docs/devotion-system.md`, "A selection is valid when..."). On the summary this
  is `target[i] <= supplyUncapped[i]` for every color, the same comparison the
  affinity panel and `affinityDeficits` make. The forum link's build (Scales of
  Ulcama short 2 Order) fails this.
- **Constructible.** The selection classifies "reachable" at the sweep budget.
  `reachabilityForSelection` already classifies the selection itself once
  (`selfReachable`); because the sweep budget is never below the validity floor and
  never above 55, that verdict is exactly "constructible within 55". The forum
  build plus all of Dryad (55 stars needing 56) fails this.

The two are distinct: "reachable" for a selection means it can be held within the
budget with scaffolding still standing, so a selection with an affinity deficit can
be reachable (the forum build is, at 54) without being a build the game would let
you finish on. Both must hold, and the flag costs no extra engine work.

Export requires: the cover table loaded, a finite cap, a non-empty selection, and
`legal`. The cap is auto-raised to the validity floor on every refresh, so `legal`
is about the game's 55, not the slider.

## Part 3: the planner

**Port** `web/src/ports/GrimtoolsGateway.ts`:

```ts
type FetchBuildResult =
  | { kind: "ok"; skills: string[]; dataVersion: string | null; title?: string | null }
  | { kind: "notFound" }
  | { kind: "network" };
type SaveBuildResult =
  | { kind: "ok"; slug: string }
  | { kind: "rateLimited" }
  | { kind: "upstream" }
  | { kind: "network" };
interface GrimtoolsGateway {
  fetchBuild(slug: string): Promise<FetchBuildResult>;
  saveBuild(skills: string[]): Promise<SaveBuildResult>;
}
```

Results are discriminated unions, never thrown errors, so the controller maps them
to panel states without try/catch.

**Adapter** `web/src/adapters/grimtoolsWorkerGateway.ts`, constructed with the
worker base URL. `fetchBuild` is the current inline import fetch moved here
without behaviour change (the `v=` cache-busting comment and the 404 mapping come
along). `saveBuild` POSTs `{skills}` to `/export?v=<EXPORT_CONTRACT_VERSION>` and
maps 201 to `ok` (after checking the slug charset again on the client, since it
becomes an `href`), 429 to `rateLimited`, 502 to `upstream`, anything else and any
thrown fetch error to `network`.

**Controller** (`main.ts`):

- Session memo: `Map<string, string>` from a canonical key (sorted star ids joined
  with `,`) to a slug. Written after a clean import (`pruned === 0`; a pruned
  import means the grimtools build differs from what the planner shows) and after
  a successful export. Read on every refresh: if the current selection's key is
  memoized, `source` becomes that slug and the panel shows it with Export hidden.
  A hash restore does not populate the memo (Decision 4).
- Export flow: build `skills` via `toGrimtoolsSkills`; panel to the exporting
  state; `gateway.saveBuild`; on `ok`, memoize, set `source`, panel to done,
  `writeHash("push")` (like import, so Back returns to the un-associated state);
  on any other result, panel to the matching error state and nothing else changes.
- Clear (✕) drops the association only, as today, and leaves the memo intact, so
  returning to that exact selection re-associates it.

**Panel** (`adapters/importPanel.ts`, keeping its file and DOM/CSS conventions):

```
grimtools
[ grimtools build link or id      ] [Import]     state A (no association)
[Export to grimtools]
   hint line

grimtools
[ grimtools: Warder, Level 100 ↗ ] [✕]           state B (associated)
[Export to grimtools]                             only when the selection differs
   hint line                                      from the memoized set
```

The panel's `setState` gains an `exportState` alongside the import state:

| export state | button | hint |
| --- | --- | --- |
| `hidden` (selection matches the associated build) | not rendered | none |
| `disabled: "empty"` | disabled | Select stars to export. |
| `disabled: "uncapped"` | disabled | Restore the 55-point limit to export. |
| `disabled: "incomplete"` | disabled | Only a complete build can be exported. |
| `ready` | enabled | none |
| `exporting` | disabled | Exporting... |
| `error: rateLimited` | enabled | Too many exports. Try again in a minute. |
| `error: network` | enabled | Could not reach the export service. |
| `error: upstream` | enabled | grimtools did not accept the build. |

The `incomplete` hint stays one line: the build-order panel already explains the
deficit in full, and the points bar tooltip names the fewest points that make the
selection legal. Precedence when several apply: hidden, then empty, uncapped,
incomplete, then the in-flight and error states (an error clears on the next
refresh that changes the selection).

Catalog: the panel heading key becomes neutral (`ui.grimtools.label`, "grimtools")
since the panel now does both directions; every `ui.import.*` key stays; new
`ui.export.*` keys for the button, hints and errors are added to all 13 locales and
to the `appCatalog.test.ts` guard.

**URL.** Unchanged contract: `gt=<slug>` is provenance only, the selection lives in
`s=`. Nothing new is added to the hash.

## Errors

| where | condition | outcome |
| --- | --- | --- |
| planner | mapping table not loadable when Export is pressed | `error: network` hint, the same stand-in import uses for this rare case (a bad deploy of our own same-origin data file), with a `console.warn` naming the real cause |
| planner | a selected star missing from the inverse table | `error: network` hint plus a `console.warn` naming the star; this cannot happen with a table that passed its generation gates, so it is a bug report, not a user-actionable state |
| worker | bad origin / body | 403 / 400, panel shows `network` (a client bug, not a user-actionable state) |
| worker | rate limited | 429, panel shows the rate-limit hint |
| worker | grimtools error, timeout, redirect | 502 `upstream`, panel shows the upstream hint |
| worker | grimtools 2xx but no valid id | 502 `unparseable`, panel shows the upstream hint |

## Testing

- **Worker** (`web/test/worker.test.ts`, extended): dispatch (`GET /`, `POST
  /export`, `OPTIONS`, others), origin check, body validation (oversize, non-JSON,
  wrong types, 0 and 56 entries, duplicates, bad charset), both rate-limit keys
  through a fake limiter, the exact outbound request (URL, method, headers,
  `data=`/`mod=` encoding, payload equal to the fixture), upstream mappings (non-2xx,
  redirect, thrown, timeout, 2xx with garbage, 2xx with a bad id), and the
  response-shape guard tied to `EXPORT_CONTRACT_VERSION`.
- **Core**: `invertStarTable` bijection over the committed table; `savePayload`
  fixture; `SelectionView.legal` for a legal build (the forum link with Lion
  completed), an affinity-deficit build (the forum link as posted, which is
  reachable at 54 but not valid), and a valid selection that cannot be built within
  55 (the forum link with Dryad completed).
- **Adapter**: the gateway maps every HTTP outcome to its result union for both
  methods; panel tests for every export state and hint and for the two-state
  layout; i18n catalog guard and characterization snapshots updated.
- **Manual**: `just worker-dev` and `just serve`, export the forum build, open the
  returned grimtools link and confirm the same stars are lit; confirm the memo
  hides Export until a star is toggled, and that Back after an export drops the
  association.

## Out of scope

- Exporting anything but devotion stars (no masteries, gear, or level).
- Sending a build order as `devotionsProgression` (nothing on grimtools reads it).
- Cross-session or cross-tool duplicate detection (Decision 4).
- Updating an existing grimtools build (there is no such endpoint).
- Localising the grimtools page title in the association link (unchanged from
  import).
