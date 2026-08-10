# Importing devotions from a grimtools build

Let someone paste a grimtools calculator link (or a bare slug) into the planner and
have their devotion selection appear on the map, with a link back to the build it
came from.

The feature is small at runtime. Almost all of the difficulty is in one place: the
lookup that turns grimtools' internal skill ids into our star ids. This spec records
what the investigation established, because several of those facts are non-obvious
and getting any of them wrong produces a plausible but incorrect import rather than a
visible failure.

## What the investigation established

Everything below was measured against the live site on 2026-08-09, at grimtools
devotion data version `1a801e4bd308`, game build 1.3.0.6.

**The build arrives in one plain GET.** `https://www.grimtools.com/calc/<slug>`
returns HTML with the whole character server-rendered inline as
`window['buildInfo'] = {...}`. There is no secondary request and no JavaScript needs
to run. This corrects a claim in `docs/grimtools-build-audit.md`, which says the
build is "encoded in the URL slug and decoded client side". The half about there
being no XHR to intercept is right; the conclusion is not. An eight-character slug is
a server-side key, and PHP inlines the record into the document. That mistaken
inference is why the existing scraper reaches for headless Chrome.

**Devotion stars are in `buildInfo.data.skills`.** That array is a flat list of
`{name: "sk688", level: N}` mixing mastery skills and devotion stars. On the audited
build it holds 83 entries: 28 mastery skills and exactly 55 devotion stars. All 55
star ids reported by grimtools' own `dumpDevotion()` are present in the array, with
none missing, and `dumpDevotion()` returns ids in the identical `sk<N>` space.

**CORS blocks reading it from the browser.** The response carries
`Access-Control-Allow-Origin: https://www.grimtools.com`, hardcoded. Tested with
`Origin: https://example.com`, it does not reflect. There is no JSONP or callback
parameter. A browser fetch from our origin receives the bytes and is forbidden from
reading them, so a cooperating server is required. GitHub Pages cannot serve that
role: it is a static CDN with no request-time execution, and Actions is a build
system rather than a request server (dispatch-and-poll would need a write-scoped
token in the client and would add tens of seconds of latency).

**`robots.txt` permits this.** `User-agent: *` is `Allow: /`. The `Disallow: /`
entries are Cloudflare's managed AI-crawler list (ClaudeBot, GPTBot, CCBot,
Google-Extended, Bytespider, OAI-SearchBot) alongside `Content-Signal: ai-train=no`,
aimed at training and mass crawling rather than at a person pasting their own build
link. A user-initiated, one-page-per-click, aggressively cached fetch is within
`Allow: /`, and it obliges us to behave like a well-mannered client: an honest
User-Agent naming the project with a contact URL, never impersonating a browser and
never claiming to be one of the listed bots, hard caching, and graceful surrender if
grimtools ever starts returning 403.

**The star mapping is derivable and was verified.** Grimtools' static
`/static/gdx3/devotion/devotion.json` keys stars by DBR record path
(`records/skills/devotion/tier3_21b.dbr`), the same record space our
`data/devotions.json` uses, so a join key exists on both sides. The missing hop,
`sk<id>` to DBR path, is in neither `calc.js` nor `itemdb.js`, but it is reachable at
runtime: `dumpDevotion`'s source names an internal table `f6I`, which is reachable
from global scope because `calc.js` is a plain script. `f6I` holds 110 constellations,
each with a display tag and an `Ab` map of star objects keyed by `sk` id in insertion
order.

Joining `f6I` to `devotion.json` on display tag plus granted affinity, then taking
stars positionally within each constellation, yields:

| Check | Result |
| --- | --- |
| Constellations joined | 110 of 110 |
| Per-constellation star counts agree | 110 of 110 |
| `sk<id>` to DBR entries derived | 559 of 559 |
| Stars in our `data/devotions.json` left uncovered | 0 |
| Bonus magnitudes cross-checked against grimtools tooltips | 47 of 47 |
| Within-constellation orderings confirmed | 559 of 559 |

The strongest confirmation was not designed for: every celestial power lands in its
parent constellation (Targo's Hammer in Anvil, Elemental Storm in Rhowan's Crown,
Trample in Autumn Boar, Arcane Bomb in Widow). That relationship appears nowhere in
the join key and only falls out if the alignment is correct.

### Four traps, each of which produces silently wrong data

1. **`devotion.json` is in geometry order, `f6I` is in tag order.** A positional join
   between them scores 1 of 110 on display tag. Join on the tag, not the index.
2. **`f6I`'s minified affinity fields are inverted from their apparent meaning.** `Va`
   is the requirement and `cb` is the grant. Using them as named produces 6 joins of
   110.
3. **Grimtools has 110 constellations and we have 109.** The extra,
   `devotion_constellation087_crossroads`, has zero stars: it is the decorative hub
   art, not a constellation. Both sides still total 559 stars. The generator must
   assert exactly one star-less entry rather than treating the count difference as an
   error. There are five real Crossroads, as the existing docs say.
4. **Damage-over-time bonuses are printed as totals and stored as rates.** Our
   `tier1_05d` carries `offensiveSlowPhysicalMin: 12` over
   `offensiveSlowPhysicalDurationMin: 5`, while grimtools' tooltip reads "60 Internal
   Trauma over 5 Seconds". A naive magnitude comparison reports a false mismatch. The
   verification gate must multiply rate by duration before comparing.

## Architecture

Three pieces. The property that matters is that grimtools is contacted once per
import and never per view.

**A committed lookup table**, `data/grimtools-stars.json`, mapping `sk<id>` to our
star id, 559 entries, plus the grimtools devotion data version it was derived from.

**A Cloudflare Worker** that fetches a build by slug and returns its skill ids
(mastery skills and devotion stars both - it holds no game knowledge, so it cannot
tell them apart). It never claims otherwise: the response field is `skills`.

**The planner**, which maps those ids through the committed table, applies the
selection, and records the source slug in the URL hash.

The split is deliberate. A grimtools shape change touches only the worker. A game
update that renumbers skills touches only the table. Neither requires touching the
other.

## Part 1: the mapping table

A `just` recipe regenerates `data/grimtools-stars.json`. It runs when we choose it,
never at request time, so headless Chrome stays a development dependency and never
touches production.

Steps: load a calc page in headless Chrome and dump `f6I` (reusing the CDP client
pattern in `scripts/gt_scrape.ts`); fetch `devotion.json`; join on display tag plus
granted affinity and take stars positionally; join DBR path to our star ids through
`data/devotions.json`; write the table with the `devotion.json` `version` recorded
alongside it.

The recipe fails loudly and writes nothing rather than emitting a partial table. It
asserts every count in the table above: 110 constellations joined, per-constellation
star counts equal, exactly one star-less grimtools constellation, 559 entries, zero
uncovered stars in our data, and the bonus cross-check passing for every star with
numeric bonuses (with rate-times-duration applied for DoT lines). A count that comes
up short is a data change we need to look at, not a table to ship.

## Part 2: the worker

Lives in `worker/` in this repo, so it is versioned next to what it serves. Normal
deployment is from CI on push to `main`. A `just deploy-worker` recipe wraps the same
`wrangler deploy` for the first deploy and as an escape hatch, but it is not the usual
path.

Contract: `GET /?slug=<slug>` returns
`{slug, skills: ["sk688", ...], title, gameVersion, dataVersion}`. The field is
`skills`, not `stars`: it is every `sk<id>` in the build, mastery skills included,
since the worker cannot tell the two apart (see below).

`title` is the build's display name, pulled from the calculator page's
server-rendered `<title>` (stripped of the trailing " - Grim Dawn Build
Calculator"), or `null` when there is none, when it is empty after sanitizing, or
when the slug is not a build. `buildInfo` itself carries no class/build name, so
the `<title>` is the only cheap source; no mastery-code lookup is attempted.
`title` is the first upstream text this feature ever puts in the UI, so the worker
sanitizes rather than trusts it before it ever leaves the response: `<`/`>` are
stripped outright (entities are left encoded on purpose, since decoding them is
what would reintroduce markup), whitespace collapses to single spaces, and the
result is trimmed and capped at 100 characters. The app still HTML-escapes it
again where it is interpolated into the panel's markup, since defense in depth
against upstream-relayed text costs nothing here.

The security design rests on one decision: **the worker never accepts a URL.** It
accepts only a slug, validated against `^[A-Za-z0-9_-]{1,24}$`, and builds the
grimtools URL from a hardcoded constant. This removes the capability rather than
mitigating it, so there is no code path that fetches a caller-supplied host and the
worker cannot be turned into an open proxy or SSRF relay.

The rest follows from the same principle:

- **It never returns upstream bytes.** It parses `buildInfo` and constructs the
  response, re-validating each id against `^sk\d+$` before emitting it. The response
  is structurally incapable of carrying attacker-influenced content, so the worker
  cannot be used to serve arbitrary material from our domain.
- **It caches on slug plus its own `IMPORT_CONTRACT_VERSION`** with a long TTL via the
  Cache API. Builds are immutable, so a slug's content never changes and the hit rate
  is near perfect. Keying on the slug alone (never the whole request) caps both our
  cost and any amplification against grimtools; the client sends its own version
  param too, but purely to bust its own browser cache with a new URL - the worker
  never reads it for keying, since doing so would hand a caller unbounded control of
  the keyspace. See `worker/README.md`'s "Changing the response shape" for the full
  mechanism.
- **It bounds its work**: a byte cap on the response it will read, a subrequest
  timeout, and an early exit once `buildInfo` is located, so a hostile or oversized
  upstream cannot exhaust the CPU budget.
- **It is GET-only on a single route**, with `Access-Control-Allow-Origin` scoped to
  our Pages origin rather than `*`. That does not stop `curl`, but it stops the
  worker being a convenient browser-side relay for other sites.
- **It holds no secrets**, no auth, and no storage. There is nothing to steal.

Extraction of `buildInfo` from the HTML lives in a shared module the worker imports,
so it is covered by the in-repo test suite even though the worker is not deployed
from CI. Note the calculator page is a single line, so the object's end must be found
by string-aware brace matching rather than by a line ending.

### Cloudflare setup

1. Sign up at `dash.cloudflare.com/sign-up`. No credit card is required for the
   Workers Free plan, whose limits (100k requests per day) exceed anything this
   feature will use.
2. On first Workers use, choose a `*.workers.dev` subdomain. It is part of the public
   URL.
3. `npm i -D wrangler` in this repo. Wrangler is Cloudflare's CLI. Keep it
   project-local and version-pinned so CI and a developer machine run the same
   version.
4. For local work, authenticate with `wrangler login`. That runs a browser OAuth flow
   and stores the issued token in a local config file, so there is no key to copy by
   hand.
5. Deployment is from CI, not from a developer machine, so that it is reproducible,
   logged, and does not depend on one person's laptop. That requires an API token,
   because there is no browser to redirect to. See below.
6. `wrangler tail` gives live logs; the dashboard gives request and error counts. A
   rate-limiting rule on the route is optional hardening.

### The deploy token

Created by hand in the dashboard under My Profile, API Tokens, from the "Edit
Cloudflare Workers" template, then narrowed: account resources scoped to the single
account, and the zone and Workers Routes permissions removed, since deployment targets
`*.workers.dev` rather than a custom domain. The result needs only
`Account -> Workers Scripts: Edit`.

Leave IP filtering off, because runner addresses are dynamic. Leave expiry off as
well: a token that lapses silently would break deploys on a worker nobody has touched
in months, and the token is revocable in one click if it ever leaks.

The token is stored as the `CLOUDFLARE_API_TOKEN` repository secret. The account id is
an identifier rather than a credential, so it lives in the committed `wrangler.toml`.

Repository secrets are reachable by any workflow that can run in the repository, so
the deploy workflow triggers only on `push` to `main`, filtered to `worker/**`. It
never triggers on `pull_request`, which keeps the token out of reach of runs started
by a pull request and stops unrelated commits from redeploying.

### Automating everything except the minting

Creating the token itself cannot be automated. Cloudflare's `POST
/client/v4/user/tokens` requires a credential that already holds
`User API Tokens: Edit`, which means either another hand-made token or the Global API
Key. Bootstrapping through the Global Key would mean hand-copying a credential that
can do everything on the account in order to avoid hand-copying one that can only edit
Workers scripts, which is a worse trade. Cloudflare also has no GitHub OIDC federation
for API access, so the long-lived secret cannot be avoided entirely, and the OAuth
token from `wrangler login` does not carry the token-management scope. Two minutes in
the dashboard, once, is the floor.

Everything after the copy is scripted, as `just setup-worker-auth`. It reads the token
**on stdin**, never as an argument, so the value never reaches shell history or the
process table. It then:

1. runs `npx wrangler whoami` to read the account id and writes it into
   `wrangler.toml`;
2. verifies the token against `GET /client/v4/user/tokens/verify` and fails if it is
   not active;
3. confirms the token actually carries deploy permission with a dry run, rather than
   letting that surface on the first real deploy;
4. stores it with `gh secret set CLOUDFLARE_API_TOKEN` for this repository;
5. reports each step, and never echoes the token.

`gh` must be installed and authenticated with `repo` scope, which it already is on the
development machine. The recipe checks for that up front and says so plainly rather
than failing partway through. Rotation later is the same recipe with a fresh value.

## Part 3: the planner

### The control

A textbox beside the search box, mirroring `web/src/adapters/searchPanel.ts` in
styling and interaction, including a `✕` clear button matching `#search-clear`.

It accepts a full calculator URL, a URL with a trailing slash or query string, or a
bare slug. Parsing pulls the slug from `/calc/<slug>` or takes the input as a slug
when it matches the charset. Anything else is rejected in the control before a
request is made.

Errors are specific rather than generic: worker unreachable, unknown slug (grimtools
404), data version mismatch, and unmapped stars each say what actually happened.
Every string is a catalog key added to the `web/test/appCatalog.test.ts` guard, with
no literals, per the internationalization invariant.

On success the planner shows "grimtools: <build title>" when the worker returned
one, linking to `https://www.grimtools.com/calc/<slug>`. It falls back to
"Imported from grimtools" when the title is absent or null, which includes a
response served from the worker's edge cache from before this field existed.

### URL state

`gt=<slug>` joins the hash, round-tripping through `encodeHash`/`decodeHash` with the
usual tolerance for stale and malformed values: the slug is re-validated on decode
and dropped if it is junk.

**`gt=` is provenance only. The authoritative selection stays in `s=`.** A shared
link restores the build from the bitset and never re-fetches grimtools, so the worker
sits on the import path alone and a shared link keeps working even if grimtools is
down. Hand-editing `gt=` cannot change the build.

The link persists after the user edits the build, labelled in the past tense so it
stays truthful. The user dismisses the association with the `✕` when it has diverged
enough to stop mattering. Dismissing clears `gt=` from the hash and removes the link,
and does nothing else: the selection, the cap, and every other piece of state are
left alone. We do not track divergence automatically.

Import raises the point cap `p=` to at least the incoming star count, since a 55-star
build otherwise lands against a lower cap. A cap already higher than the star count is
left as it is, so importing never silently reduces someone's budget.

### Legality

An imported selection takes the same path as loading a shared link: set the
selection, then `repairSelection` in `applyHash`. This adds no new engine risk. Two
consequences:

- If repair prunes anything, the planner reports it. Silent pruning belongs to the
  same class of bug as a silently wrong import.
- Build order is unchanged. If `buildOrderPath` cannot prove a legal schedule, the
  panel shows its existing honest empty state.

The import is more precise than the manual audit path. `docs/grimtools-build-audit.md`
describes deducing which Crossroads a build took by legality, because a scrape cannot
tell them apart. Mapping by `sk` id is unambiguous, so that ambiguity does not arise
for imports.

### The failure mode that matters most

Not an error, but a silently wrong import. If a game update renumbers `sk` ids, every
import produces a plausible but incorrect devotion set and nobody notices.

Two guards. The table records the `devotion.json` `version` it was derived from, the
worker returns the live value, and the app refuses the import with an honest message
when they disagree. Separately, a scheduled canary imports a known slug and asserts an
exact star set, so a shape or numbering change reaches us from CI rather than from a
confused user.

An earlier draft of this spec called for reporting unmapped ids, following the item
CLI's `unmatched_criteria` discipline. Planning showed that is not implementable and
not needed. `buildInfo.data.skills` mixes mastery skills and devotion stars with no
marker separating them, so membership in the table is the only thing that tells them
apart, and an id absent from the table cannot be distinguished from a mastery skill.
The case that motivated the requirement, a star the table does not know because
grimtools added stars after it was generated, is caught by the data-version check
above. What does get reported is pruning by `repairSelection`, which is a real and
detectable loss.

## Testing

- `buildInfo` extraction against a committed fixture of a real calculator page, so
  the parser is tested with no network.
- Slug parsing: full URLs, trailing slashes, query strings, bare slugs, and junk.
- `sk` id to star id mapping, including a celestial-power star and a Crossroads star.
- `gt=` hash round-trip, including a malformed slug being dropped on decode.
- A guard test that the committed table has 559 entries and that every value resolves
  to a real star id in `data/devotions.json`.
- A guard test on the within-constellation ordering invariant: the game numbers a
  constellation's star skills sequentially, so sorting a constellation's `sk` ids
  ascending must reproduce our own star indices `0..n-1`. This is emergent from the
  join rather than imposed by it, so it catches a within-constellation scramble the
  count checks above would miss. Gated both at generation time
  (`scripts/gt_star_table.ts`) and on the committed table (no Chrome, no network).
- The table generator's own assertions, which gate regeneration.
- The scheduled canary.

## Out of scope

- Importing anything other than devotions (gear, mastery skills, attributes).
- An e2e leg for the import wiring. Noted in `BACKLOG.md`, matching how the search
  box shipped.
- Automatic divergence marking between the imported set and the current build.
- Any change to `scripts/gt_scrape.ts`. Its headless path still serves the audit
  workflow, which needs the rendered character sheet rather than just the build
  record.

## Included, though it sits outside the feature

`docs/grimtools-build-audit.md` states that the build is decoded from the URL slug
client side and that there is no request carrying build data. That is wrong, and it is
the reason the audit workflow reaches for headless Chrome where a plain GET would do.
Correct it in place, per the living-docs rule, as part of this work.
