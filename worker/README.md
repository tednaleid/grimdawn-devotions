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

## Deployment

Normal deployment is from CI on push to `main`, filtered to `worker/**`. A
`just deploy-worker` recipe wraps the same `wrangler deploy` for the first deploy and
as a manual escape hatch, but CI is the usual path.

## Rotating the deploy token

CI authenticates with a Cloudflare API token stored as the `CLOUDFLARE_API_TOKEN`
repository secret. Cloudflare has no way to mint that token from the command line —
creating it is a one-time, by-hand step in the dashboard — but everything after
copying it is scripted:

```
just setup-worker-auth
```

Reads the token on stdin (never as an argument, so it never lands in shell history),
verifies it, confirms it can actually deploy, and stores it with `gh secret set`.
Rotation is the same command with a fresh token.
