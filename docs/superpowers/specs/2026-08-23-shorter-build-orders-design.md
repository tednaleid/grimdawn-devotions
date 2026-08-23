# Shorter build orders, proven against real builds

The build-order panel proves a viable construction order for the selected
constellations. That proof is the non-negotiable core and it stays. This effort
improves the second-order quality of the order it shows: the schedule should
waste as few points as possible, because today the search often returns the
first schedule that fits the budget rather than the shortest one it could find.

Two deliverables, in order:

1. A corpus of roughly 75 real community builds harvested from
   grimtools.com/builds/, committed as a test fixture, with a baseline harness
   that measures what the current search produces for them.
2. A change to the sampling search so it keeps optimizing after the first
   fitting schedule, under a deterministic work budget, scored by the ratified
   objective below.

## Where the headroom is (confirmed in the current code)

`buildOrderPath` (`web/src/core/reachability.ts`) already runs two generators,
the need-driven greedy (`needDrivenOrder`) and the sampled construction
(`sampledConstruction`, tries=16), and keeps the better schedule by churn
points, then step count. The objective is right; the search does not pursue it.
`sampledConstruction`'s `consider()` early-exits the moment any candidate order
fits the budget. It minimizes "peak fits budget", which is the correct
semantics for its reachability-witness callers, but for a typical build almost
any order fits, so the panel effectively shows the first order sampled. The
shuffle budget is spent proving fit, not reducing waste.

A structural fact that frames the whole problem: for a fixed build set, the
points spent on the build's own members are constant in every order. The only
variable cost is scaffolding (constellations bought for their affinity and
refunded later). "Shorter" can only mean less scaffold churn or fewer schedule
steps, and both are functions of the scaffold set alone: steps counts scaffold
constellations (one add row and one refund row each), churn counts scaffold
stars.

## Ratified decisions

**Objective: churn first, steps tiebreak.** Fewest wasted stars, then fewest
rows. The two metrics agree except when two small scaffolds totaling fewer
stars compete with one larger scaffold covering the same deficit. No confirmed
real-map divergence is in hand; scaffold candidates are almost always small
tier-1 constellations of similar per-star density. Churn-first never trades
many wasted points for fewer panel rows (the degenerate corner of steps-first),
and each refunded star is real in-game respec cost. The harness reports both
metrics plus a divergence counter over the real corpus, so if steps-first would
ever have produced a different schedule on real builds, the data will show it
and the objective can be revisited with actual examples.

**Delivery: better synchronous search only.** No worker, no UX change. The
live per-click path keeps roughly its current cost; the existing "Find valid
order" escalation button gets the large budget and now improves a found order
as well as recovering a missing one. The background-worker progressive search
stays a backlog follow-on.

**Determinism: work budget, not wall clock.** `buildOrderPath` is documented
as a pure function of the build set: the same shared URL shows the same order
on every machine, and tests pin outputs. A millisecond budget would silently
break that. The extra search runs under a deterministic work budget counted in
`emitSchedule` evaluations (the dominant cost unit); the shuffle RNG is
already seeded per build.

**Corpus: mixed sample of roughly 75 builds.** Crawl several listing views
(most viewed, top rated, recent) and dedupe, for diversity across masteries
and playstyles. Harvest is manual, rate-limited, and never in CI. The app's
import/export stays off; this uses a real browser against public pages, with
Chrome's default User-Agent, not the worker's blocked one.

## Phase 1: corpus harvest pipeline

Two pieces under `scripts/`, following the raw-CDP plus chrome-headless-shell
pattern proven by `scripts/gt_scrape.ts` (Playwright's own transports do not
connect under Bun, which is why that pattern exists).

**Listing crawl.** New `scripts/gt_harvest_builds.ts` drives headless Chrome
to `grimtools.com/builds/` under the three listing views, paging until it has
collected roughly 100 candidate build-page URLs, deduped. Each build page
embeds a calc link; the crawler collects (build page URL, build title, calc
URL) triples. A delay of 1 to 2 seconds between page loads and a hard page cap
bound the crawl. The exact listing selectors are an implementation-time scout
step; nothing else depends on them.

**Per-build devotion extraction.** For each calc URL, the same in-page
evaluation `gt_scrape.ts` uses pulls the devotion sk ids, and the committed
`data/grimtools-stars.json` table (via the mapping logic in
`web/src/core/grimtools.ts`) converts them to our star ids. Builds that fail
the mapping gates (stale grimtools data version, unmappable star) are skipped
loudly with a reason; the run report counts each skip category.

**Committed fixture.** `web/test/fixtures/real-builds.json`: harvest date and
grimtools data version once at the top, then one entry per build with `source`
(build page URL), `calc`, `title`, and `starIds` (our ids, the exact star set
including any partial constellations). Target roughly 75 mappable builds. The
raw scrape JSONs are not committed.

**Invocation.** `just harvest-real-builds`, manual, re-runnable by hand after
a game patch. CI only ever reads the committed fixture.

## Phase 1: baseline harness and regression gate

**Harness.** Extend `web/scripts/order-quality.ts` (and `just order-quality`)
to run the real corpus after the existing 150 synthetic seeds, keeping the CSV
on stdout, aggregates on stderr shape. Per real build: order found, churn,
steps, and wall time at the live-path configuration. Two additions:

- Headroom curve: each build also runs at escalating work budgets (the current
  tries=16 equivalent, then roughly 16x and 256x). The aggregate reports total
  churn at each budget. This is the evidence base for phase 2: it shows how
  much churn the early exit leaves on the table and where extra work stops
  paying, and it calibrates the live budget.
- Divergence counter: per build, whether a steps-first objective would have
  picked a different schedule than churn-first at the same budget.

**Regression gate.** New `web/test/real-build-order.test.ts` iterates the
fixture and asserts, for every build, that `buildOrderPath` at live settings
returns an order and that the order replays legally through the independent
oracle in `web/src/core/orderLegality.ts`. Real builds were assembled by
actual players, so they are constructible by definition; a null is a genuine
false negative. If the baseline run shows misses, those builds become named,
documented exceptions in the test and investigation targets per the
reachability-engine playbook, so the suite stays green while the misses stay
visible.

**Baseline snapshot.** The first full run's aggregates are recorded in the
phase-1 implementation plan document once measured (a dated artifact, not a
living doc), pinning the "before" for phase 2.

**Partial constellations.** Real builds may include partially completed
constellations. The order panel orders completed members
(`selectionSummary(...).built`), the same as the synthetic harness, so the
harness measures exactly what the panel would show for that selection; partial
stars ride along in the fixture but do not change the member-ordering problem.

## Phase 2: the search change

**Two modes for `sampledConstruction`.** The core sampler gains an explicit
mode instead of one behavior serving two masters:

- Witness mode (unchanged): early-exit the moment any schedule fits the
  budget. `minPeakSampled` and `minPeakSampledOrder` keep this; they exist to
  prove reachability, and the first fitting schedule is a complete proof. No
  behavior change on the reachability verdict path.
- Quality mode (new, used by `buildOrderPath`): once a fitting schedule
  exists, keep sampling and score fitting candidates by churn, then steps,
  keeping the best until the work budget is exhausted. Before anything fits it
  behaves as today, chasing lower peak, so recovery of hard builds is not
  diluted.

**Budget levels.** The live per-click path gets a budget calibrated from the
phase-1 headroom curve, chosen so per-click cost stays within the current perf
gates (`just perf`, the reachability perf guard). `buildOrderEscalated` gets a
large budget.

**What stays the same.** The need-driven greedy still runs and the best-of-two
comparison by churn then steps still decides. The winner's order is still
re-emitted at `REPLAY_CAP` for exact scaffold minimization. Null semantics,
canonicalization, and oracle independence are untouched.

**Testing.** A unit test pins quality mode with a constructed build where
continuing after the first fit provably lowers churn, and pins that witness
mode returns the first fit for the same input. All existing oracle-replay,
witness-schedule, and determinism tests must pass unchanged. The order-quality
harness before/after on the real corpus is the acceptance evidence.

## Approaches considered and deferred

- Local improvement (hill-climbing member swaps and reinsertions, directed
  scaffold shrinking): likely better churn per unit work than random shuffles
  near a good order. Deferred until the phase-2 corpus numbers show remaining
  headroom worth the code.
- Exact branch-and-bound over member orders: could prove optimality for the
  typical 8 to 15 granting members. Deferred; no evidence yet that the
  sampled search leaves a gap that justifies the blowup risk.
- Background-worker progressive search: already in BACKLOG.md, unchanged by
  this effort.

## Success criteria

- Roughly 75 real builds committed as a fixture with provenance.
- Baseline aggregates recorded: order-found rate, churn, steps, divergence
  count, headroom curve.
- Order-found on the real corpus is 100 percent, or every miss is a named
  investigation target.
- Phase 2 reduces aggregate churn on the real corpus at unchanged live-path
  perf gates, with the escalation button reducing it further.

## Non-goals

- No change to reachability verdicts, the oracle, or null semantics.
- No app UX change; no worker; no re-enabling of the grimtools import/export
  worker paths.
- No steps-first or blended objective unless the divergence data motivates it.
