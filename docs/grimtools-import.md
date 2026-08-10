# Importing devotions from a grimtools build

Paste a grimtools calculator link (or a bare slug) into the planner and that build's
devotion stars appear on the map, with a link back to the build it came from.

This describes how the feature works now. The dated design record that led to it, with
the full investigation, is
[docs/superpowers/specs/2026-08-09-grimtools-devotion-import-design.md](superpowers/specs/2026-08-09-grimtools-devotion-import-design.md);
prefer this document when the two disagree.

## Two facts the whole design rests on

**The build arrives in one plain GET.** `https://www.grimtools.com/calc/<slug>` returns
HTML with the whole character server-rendered inline as `window['buildInfo'] = {...}`,
plus a `<title>` naming it ("Warder, Level 100 (GD 1.2.1.6)"). There is no secondary
request and the page does not need to run. The slug is a server-side key, not an
encoding of the character.

**A browser cannot read it from our origin.** Grimtools serves
`Access-Control-Allow-Origin: https://www.grimtools.com`, hardcoded, and it does not
reflect. There is no JSONP. GitHub Pages cannot help: it is a static CDN with no
request-time execution. So a cooperating server is required, and that is the only
reason the worker exists.

## The three pieces

**A committed lookup table**, `data/grimtools-stars.json`: 559 entries mapping
grimtools' internal `sk<id>` skill ids to our star ids, plus the grimtools devotion data
version it was derived from.

**A Cloudflare Worker** (`worker/`) that fetches a build by slug and returns its skill
ids. It holds no game knowledge.

**The planner**, which maps those ids through the table, applies the selection, and
records the source slug in the URL hash.

The split is deliberate. A grimtools shape change touches only the worker. A game update
that renumbers skills touches only the table. Neither requires touching the other, and
the worker never needs redeploying for a data change.

**Grimtools is contacted once per import, never per view.** A shared link restores the
build from the `s=` bitset alone.

## The mapping table

Regenerate with `just gt-star-table` (needs headless Chrome: `just install-e2e`). It
loads a calculator page, reads grimtools' internal `f6I` table, fetches their static
`devotion.json`, joins the two, then joins to our `data/devotions.json` by DBR record
path. It runs when we choose, never at request time.

The generator **writes nothing unless every gate passes**. A short count means grimtools'
data moved, which is a thing to look at rather than an obstacle to route around. The
gates:

| Gate | Expected |
| --- | --- |
| Constellations joined on display tag plus granted affinity | 110 of 110 |
| Per-constellation star counts agree | 110 of 110 |
| Star-less grimtools constellations (decorative hub art) | exactly 1 |
| Affinity requirements agree | every constellation |
| `sk<id>` to star-id entries | 559, all distinct |
| Stars in our data left uncovered | 0 |
| Bonus magnitudes matching grimtools' rendered tooltips | 47 of 47 |
| Within-constellation orderings | 559 of 559 |

The last two deserve explanation, because the counting gates alone would pass on a
table whose stars are scrambled *within* a constellation.

**The bonus cross-check** compares our stored bonus magnitudes against the tooltip text
grimtools renders, for the stars of the one build the generator loads. That is 12
constellations of 109, so it is evidence rather than proof.

**The ordering invariant** covers everything. The game numbers a constellation's star
skills sequentially, so sorting a constellation's `sk` ids ascending must reproduce our
star indices `0..n-1`. This is emergent from the join rather than imposed by it:
grimtools' own key order does not ascend (Bat is 679, 680, 678, 681, 682, mapping to
indices 1, 2, 0, 3, 4), and the join pairs their tag order against their geometry order,
neither of which is sk-numeric. Any within-constellation scramble breaks it. It is a
write gate in the generator and an assertion in `web/test/grimtoolsTable.test.ts`, so CI
enforces it on the committed artifact with no Chrome and no network.

### Four traps, each producing silently wrong data rather than a visible failure

1. **`devotion.json` is in geometry order; `f6I` is in tag order.** A positional join
   scores 1 of 110. Join on the display tag.
2. **`f6I`'s minified affinity fields are inverted from their apparent meaning.** `Va` is
   the requirement and `cb` is the grant. Taking them at face value scores 6 of 110.
3. **Grimtools has 110 constellations and we have 109.** The extra one has zero stars: it
   is decorative hub art. Both sides still total 559.
4. **Damage-over-time bonuses are stored by us as rates and printed by grimtools as
   totals.** `offensiveSlowPhysicalMin: 12` over a 5 second duration renders as "60
   Internal Trauma over 5 Seconds". Multiply before comparing.

## The worker

**It accepts a slug and never a URL.** The grimtools host is a compile-time constant, so
no code path fetches a caller-supplied host. This removes the open-proxy and SSRF
capability rather than mitigating it, and it is the one decision everything else rests
on. Do not add a URL, host, or redirect-target parameter.

The rest follows from the same principle:

- **It never relays upstream bytes.** The response is constructed field by field and
  every id is re-validated against `^sk\d+$`. The one exception is the build title, which
  is genuinely upstream text: it is sanitized at the worker (angle brackets stripped,
  whitespace collapsed, capped) and HTML-escaped again at the panel, because the panel
  builds markup as `innerHTML`.
- **Redirects are refused** (`redirect: "manual"`, 3xx treated as an upstream error), so
  grimtools cannot redirect us off-origin.
- **It bounds its work**: a byte cap, a subrequest timeout, and an early exit as soon as
  `buildInfo` parses. The early exit is safe because the brace matcher fails on
  unbalanced input, so "extraction succeeded" cannot mean "truncated".
- **GET only, single route**, with `Access-Control-Allow-Origin` scoped to our Pages
  origin rather than `*`.
- **It holds no secrets**, no auth, no storage.

### Response contract

```
GET /?slug=<slug>&v=<contract version>
-> { slug, skills: string[], gameVersion, dataVersion, title }
```

`skills` carries **all** the build's skill ids, mastery skills included. The worker
cannot tell stars from mastery skills, which is the point: membership in the mapping
table is what separates them, and only the planner has the table.

Grimtools returns HTTP 200 with `buildInfo = null` for a nonexistent slug, never a 404,
so the worker detects that case and returns its own 404. Otherwise a missing build would
be reported to the user as "could not reach the import service".

### Caching

Successful responses are cached at the edge for 24 hours and carry
`Cache-Control: public, max-age=86400`. **Errors carry `no-store`**, so a brief grimtools
outage cannot pin a failure into someone's browser for a day.

The edge cache key is normalized to the validated slug plus the worker's own
`IMPORT_CONTRACT_VERSION`, so every query-string variant collapses onto one entry.
**The client's `v` parameter is never used for keying.** If it were, a caller could mint
unbounded distinct keys and each would be a fresh grimtools fetch, defeating the cap
entirely. Its only job is to make the *browser* see a different URL.

The two are named differently on purpose: the client sends `v=`, the worker keys on
`cv=`. They carry the same constant but they are not the same thing, and a reader who
sees only one name tends to assume the request's value flows into the key.

Cloudflare's cache is per-colo and evicts on its own schedule regardless of TTL. Treat a
hit as a hint, never a guarantee; a miss costs one grimtools fetch and nothing else.

## The planner

The import control sits beside the search box and is a two-state machine. With no build
associated it shows a textbox and an Import button, enabled only when the text parses to
a slug, with a live hint when it does not. Once a build is associated the textbox is
replaced by the source link and a clear button.

- **`gt=<slug>` in the URL hash is provenance only.** The authoritative selection stays in
  `s=`. A shared link restores from the bitset and never re-fetches, and a hand-edited
  `gt=` cannot change which build renders.
- **The point cap only rises**, to fit the incoming star count. Importing never reduces a
  budget.
- **Pruning is reported.** If `repairSelection` drops stars, the count is shown.
- **A data-version mismatch refuses the import.** If the worker's `dataVersion` differs
  from the table's, the mapping would be plausible but wrong. A null version means "could
  not determine" and degrades to proceeding.
- **Clearing drops the association only**, leaving the selection and cap untouched.

## Running it locally

```
just worker-dev     # the real worker on wrangler's local runtime, port 8787
just serve          # the planner, port 5173
```

The committed `ALLOWED_ORIGIN` is the production Pages origin, so the worker will refuse
a locally served planner until you create `worker/.dev.vars` (gitignored) containing
`ALLOWED_ORIGIN=http://localhost:5173`. See `worker/README.md`.

Local builds point at `http://localhost:8787` by default; deploys substitute the real URL
from the `IMPORT_API_URL` repository variable at build time.

## Changing things

**The response shape:** bump `IMPORT_CONTRACT_VERSION` in `web/src/core/grimtools.ts`.
A guard test pins the exact set of response fields and will tell you when this is needed.
Tolerant parsing is still the primary defense, because no cache mechanism helps a
deployed old bundle talking to a new worker mid-rollout.

**The worker:** deploys from CI on push to `main` touching `worker/**` or
`web/src/core/grimtools.ts` (it bundles that module, so the path filter includes it).
`just deploy-worker` is the manual escape hatch. Setup and token handling are in
`worker/README.md`.

**The table:** `just gt-star-table`, then commit the result. A daily canary imports a
known build and asserts the mapped star count, so a grimtools change or an `sk`
renumbering reaches us from CI rather than from a confused user.

## Known limits

- The bonus cross-check covers 12 of 109 constellations. The ordering invariant covers all
  559 stars, so this is corroboration rather than the primary guarantee. Regenerating
  against a build that touches different constellations is cheap insurance.
- Import covers devotions only. `buildInfo` also carries gear, mastery skills, attributes
  and item skills; nothing consumes them because the planner models devotions.
- The source link persists after the build is edited and is dismissed by hand. There is no
  automatic "modified since import" marking.
