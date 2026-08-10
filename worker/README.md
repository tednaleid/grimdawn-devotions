# grimdawn-devotions-import

A small Cloudflare Worker that lets the planner import a devotion build from a
grimtools calculator link. Grimtools serves those pages with
`Access-Control-Allow-Origin` locked to its own origin, so a browser on our site
cannot read them directly. This worker fetches the page server-side and hands back
just the devotion star ids.

Contract: `GET /?slug=<slug>` returns
`{ slug, stars: ["sk688", ...], gameVersion, dataVersion }`. `dataVersion` is `null`
when grimtools' own `devotion.json` could not be checked; that never blocks the
import.

## Slug, never a URL

The worker takes a `slug` (`^[A-Za-z0-9_-]{1,24}$`) and builds the grimtools URL from
a hardcoded constant. It has no parameter that can name a host, so there is no code
path that fetches anywhere but grimtools — it cannot be turned into an open proxy or
an SSRF relay. See `docs/superpowers/specs/2026-08-09-grimtools-devotion-import-design.md`
("Part 2: the worker") for the full security rationale, including why it never
returns upstream bytes, how it caches, and how it bounds its own work.

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
`main`, filtered to `worker/**`. It never runs on `pull_request`: the deploy token is
a repository secret, and any workflow that can run in the repo can reach repository
secrets, so keeping the trigger to `push`/`workflow_dispatch` keeps the token out of
PR-triggered runs. A `just deploy-worker` recipe wraps the same `wrangler deploy` for
the first deploy and as a manual escape hatch, but CI is the usual path.

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
   repository secret via `gh secret set`. Safe to re-run for rotation.
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
6. **Verify**: reload the deployed planner, import `qNYgbjeV`, and confirm 55 stars
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
