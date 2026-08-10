# grimdawn-devotions-import

A small Cloudflare Worker that lets the planner import a devotion build from a
grimtools calculator link. Grimtools serves those pages with
`Access-Control-Allow-Origin` locked to its own origin, so a browser on our site
cannot read them directly. This worker fetches the page server-side and hands back
the build's skill ids.

Contract: `GET /?slug=<slug>&v=<contract version>` returns
`{ slug, skills: ["sk688", ...], gameVersion, dataVersion, title }`. `skills` is every
`sk<id>` in the build - mastery skills and devotion stars both, since the worker has
no way to tell them apart (see "Slug, never a URL" for the ids-only design, and
`web/src/core/grimtools.ts`'s `mapStars` for where the split actually happens). It is
not called `stars`: that name would claim a distinction the worker cannot make.
`dataVersion` is `null` when grimtools' own `devotion.json` could not be checked;
that never blocks the import. `title` may be absent as well as `null`, since a
response served from an entry cached before the field existed predates it entirely.
`v` is the caller's own `IMPORT_CONTRACT_VERSION` (see "Changing the response shape"
below) - present purely so the app can bust its own browser cache; the worker never
reads it.

## Slug, never a URL

The worker takes a `slug` (`^[A-Za-z0-9_-]{1,24}$`) and builds the grimtools URL from
a hardcoded constant. It has no parameter that can name a host, so there is no code
path that fetches anywhere but grimtools — it cannot be turned into an open proxy or
an SSRF relay. See `docs/superpowers/specs/2026-08-09-grimtools-devotion-import-design.md`
("Part 2: the worker") for the full security rationale, including why it never
returns upstream bytes, how it caches, and how it bounds its own work.

## Changing the response shape

Two caches sit between the worker and the app, and each needs a different key to
invalidate: the edge cache inside the worker (`caches.default`), keyed on the slug
plus `IMPORT_CONTRACT_VERSION`, which the worker controls completely; and the
browser's own cache from our `Cache-Control: public, max-age=86400`, keyed on the
request URL, which only a new URL can invalidate. `IMPORT_CONTRACT_VERSION`
(`web/src/core/grimtools.ts`) is the one constant both sides fold in - the app puts it
in the request URL's `v` param so the browser sees a new URL, and the worker folds the
same constant into its own cache key so a stale edge entry stops being served instead
of expiring over 24h. The worker never reads the client's `v` param for its own
keying: doing so would let a caller mint unbounded distinct cache keys (`v=1`, `v=2`,
... `v=999999`), each a fresh grimtools fetch.

Bump `IMPORT_CONTRACT_VERSION` when a change is non-degradable for an old client (a
rename or removal of a field an old bundle depends on) - not for an additive field,
which old clients already tolerate by ignoring it. Forgetting to bump is caught by
`web/test/worker.test.ts`'s response-shape guard test, which pins the exact set of
field names and fails loudly if one changes.

Neither cache trick helps the case that actually matters most during a rollout: a
browser tab that already has the *old* app bundle loaded, talking to the *new*
worker. That tab never re-requests a new URL, so it goes on hitting whatever the
worker returns under the old contract version's key. Tolerant parsing in the app
(optional fields, graceful degradation for absent ones) is the real defense for that
window, not a cache key - see `main.ts`'s handling of a possibly-absent `title`.

## Running locally

```
just worker-dev
```

Runs `wrangler dev --local` on `http://localhost:8787`. This is entirely local: no
Cloudflare account, no login, no network dependency beyond the outbound fetch to
grimtools the worker itself makes. Tasks that build the import UI against this worker
need no Cloudflare setup at all.

### Testing the planner against it (`just serve`)

`wrangler.toml`'s `ALLOWED_ORIGIN` is the production origin
(`https://tednaleid.github.io`), so a planner served locally by `just serve`
(`http://localhost:5173`) is a different origin and the worker's CORS header refuses
it. Override the local origin by creating `worker/.dev.vars` (gitignored, wrangler's
own convention for local-only var overrides - never committed, even though nothing in
it is secret today) with:

```
ALLOWED_ORIGIN=http://localhost:5173
```

`wrangler dev` picks this up automatically and it layers over (does not require
editing) `wrangler.toml`'s `[vars]`. Delete the file, or just don't create it, to test
CORS refusal itself.

## Deployment

Normal deployment is from CI (`.github/workflows/deploy-worker.yml`) on push to
`main`, filtered to `worker/**` plus `web/src/core/grimtools.ts` (the worker imports
it directly, so a change there needs the same redeploy). It never runs on
`pull_request`: the deploy token is
a repository secret, and any workflow that can run in the repo can reach repository
secrets, so keeping the trigger to `push`/`workflow_dispatch` keeps the token out of
PR-triggered runs. A `just deploy-worker` recipe wraps the same `wrangler deploy` for
the first deploy and as a manual escape hatch, but CI is the usual path.

`web/package.json` pins `wrangler` to an exact version (no `^` range) on purpose.
`web/bun.lock` is gitignored, so a range would let CI resolve a fresh wrangler on
every run and deploy a version nobody tested against. Bumping it is a deliberate,
manual step (update the version, reinstall, re-run the checks, commit), not
something to "helpfully" widen back to a range to match `biome` or `typescript`.

## One-time manual setup

Nothing above works until a Cloudflare account exists and has authorized CI to
deploy to it. This is by-hand, once, because Cloudflare's token-creation API itself
requires a credential that already holds `User API Tokens: Edit`, so there is no way
to bootstrap it from the command line without first hand-copying the Global API Key,
which is a worse trade than a five-minute dashboard visit. In order:

1. **Create the token** at `dash.cloudflare.com`, avatar, **My Profile**, **API
   Tokens**, **Create Token**, the **Edit Cloudflare Workers** template. Narrow
   **Account Resources** to the single account and remove the Zone and Workers
   Routes permissions, since deployment targets `*.workers.dev`, not a custom domain,
   so only `Account -> Workers Scripts: Edit` should remain. Turn off IP filtering
   (runner addresses are dynamic) and expiry (so deploys don't silently break on a
   worker nobody has touched; the token is revocable in one click either way). Copy
   the value, since it is shown once.
2. **Run `just setup-worker-auth`** and paste the token when prompted. It verifies
   the token, reads the account id, confirms the token can actually deploy (a
   `wrangler deploy --dry-run`), and stores it as the `CLOUDFLARE_API_TOKEN`
   repository secret via `gh secret set`. Safe to re-run for rotation. That dry-run
   deploy happens before step 3 below fills in `account_id`, so if the token's
   Cloudflare login can see more than one account, wrangler may prompt interactively
   to pick one - the script's stdin is still your terminal at that point, so just
   answer the prompt. It is a rough edge, not a hang.
3. **Fill in `worker/wrangler.toml`'s `account_id`** with the id the script printed,
   and commit it. It is an identifier, not a credential, so it belongs in the repo
   rather than in a secret.
4. **Run `just deploy-worker`** for the first deploy. Wrangler prompts for a
   `*.workers.dev` subdomain the first time a Worker is deployed to the account;
   record the resulting URL (`https://<subdomain>.workers.dev`).
5. **Set that URL as the `IMPORT_API_URL` repository variable** (a variable, not a
   secret, since it is a public URL and not something that needs protecting):
   `gh variable set IMPORT_API_URL --body "https://<subdomain>.workers.dev"`, or via
   the repo's Settings, Secrets and variables, Actions, Variables tab. This is the
   single place the worker URL lives. Two consumers read it:
   - `.github/workflows/deploy.yml` bakes it into `__IMPORT_API__` (the production
     build's import endpoint, via `web/scripts/bundle.ts`). Left unset, the build
     falls back to `http://localhost:8787` and the workflow logs a loud warning:
     the site still deploys, but the import feature visibly fails for visitors
     rather than silently returning a wrong result.
   - `.github/workflows/canary-import.yml` uses it as the target to import against.
     Left unset, the canary fails outright (`::error::`) rather than skip: a canary
     that quietly passes with nothing configured would be worse than no canary.
6. **Re-run the Pages deploy before verifying anything.** `IMPORT_API_URL` is baked
   into the production bundle at *build* time (`web/scripts/bundle.ts`), and setting
   a repository variable does not itself trigger a build. Without this step the site
   deployed in step 4's era is still live and still points at
   `http://localhost:8787`, so step 7 below would fail even though everything up to
   here was done correctly. Go to **Actions, Deploy to GitHub Pages, Run workflow**
   (it has `workflow_dispatch`) and wait for it to finish. This step must come after
   step 5 and before step 7 - do not reorder it.
7. **Verify**: reload the deployed planner, import `qNYgbjeV`, and confirm 55 stars
   and a working source link. Then run **Actions, Import canary, Run workflow** by
   hand once and confirm it passes.

No other file names a Cloudflare account id or worker URL. If you ever find one,
that is a bug: it should always trace back to `wrangler.toml`'s `account_id` or the
`IMPORT_API_URL` repository variable.

## Rotating the deploy token

CI authenticates with a Cloudflare API token stored as the `CLOUDFLARE_API_TOKEN`
repository secret. Rotation is the same command as the initial setup, with a fresh
token:

```
just setup-worker-auth
```

Reads the token on stdin (never as an argument, so it never lands in shell history),
verifies it, confirms it can actually deploy, and stores it with `gh secret set`.
