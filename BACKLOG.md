# Backlog

Future work for the web planner that is not yet started or not yet finished.
Each item includes implementation pointers for whoever picks it up. This file
is future work ONLY: shipped features and their history live in the code, in
git history, and in the reference docs under `docs/`.

## Map / List view toggle

A header button at top-center toggles the planner between "Map" (the current
pan/zoom SVG) and "List" view. List view lays the constellations out as a single
vertically-scrollable column at constant zoom (Crossroads first, then the rest):
a "tall vertical map" that only scrolls vertically. Every constellation/star is
interacted with exactly as in map view (same tap/click to select, same
tooltip/popover). Especially good on mobile, where pan/zoom is fiddly. When a
benefit filter is active, constellations that grant nothing matching the filter
are hidden from the list.

Pointers: a new ephemeral view-mode flag (Map | List), not URL-encoded (view
chrome, like the drawer state). The renderer (`web/src/adapters/svgRenderer.ts`)
already builds per-constellation art/star/link markup; List view can render each
constellation into its own small fixed-viewBox SVG stacked in a scroll container,
reusing the same `data-star-id` / `data-con-id` hooks so `main.ts`'s click/hover
wiring works unchanged. Hidden-when-filtered uses the same match set the map uses
(`opts.highlight`). Needs its own brainstorm/spec: the layout of a constellation
"row" (art + stars + name?) and how selection/dimming read at constant zoom are
the open questions.

## Filtered benefits highlighted (and toggleable) in the tooltip/popover

In the star/constellation tooltip, mark the bonus rows that are part of the
active benefit filter with the same circled/selected styling the right sidebar
uses when a benefit is picked, so it is easy to see WHICH of a node's bonuses are
being filtered on. On touch, where the tooltip is an interactive popover, make
those rows clickable to toggle their filter membership (add/remove the tag),
mirroring the sidebar's `onBenefitClick`.

Pointers: `web/src/adapters/tooltipView.ts` renders the bonus rows
(`bonusRowsHtml`) - tag each row with its benefit id (`data-vid`, the same id
space as `selectedBenefits` / `benefitCanonical`) and add the selected class when
the id is in `selectedBenefits`. `main.ts` holds `selectedBenefits` and the
`onBenefitClick` toggle; in touch mode, delegate clicks on tooltip benefit rows
to the same toggle (the popover already commits via a `pointerup` delegate on
`tooltipEl`). Reuse the sidebar's selected-benefit CSS class for consistency.

## Affinities as filter values

Let affinities be filter values too - both GRANTED and REQUIRED affinities count
(e.g. "filter to constellations that grant Eldritch" or "that require Chaos").
The Requires:/Grants: lines in the tooltip become clickable filter toggles on
touch, and active affinity filters are highlighted in popovers the same way as
the benefit rows above.

Pointers: extend the tag system with an affinity namespace distinct from stat ids
(e.g. `aff:grant:<affinity>` / `aff:req:<affinity>`), carried in the `b=` URL
param alongside benefit tags (extend the canonical in `web/src/core/urlState.ts`
and `main.ts`'s `taggedStars()` so a node matches when its constellation
grants/requires the tagged affinity). The Requires/Grants rendering lives in
`tooltipView.ts` (`affinitySections` / `requiresLine` / `affinityLine`); add the
ids + selected class there and the click-toggle in `main.ts`. Builds on the
tooltip-filter work above.

## Celestial powers in filters: deferred follow-ups

Shipped: celestial-power stats participate in benefit filters (match the power's
diamond star), curated debuff/CC/RR subjects, finer sidebar sections, and a
right-side still-pickable Celestial Powers list. See
`docs/superpowers/specs/2026-06-28-celestial-powers-in-filters-design.md`.

Deferred:
- Pet attack-stat filtering: a summon power's pet `attack_stats` (the summoned
  creature's own damage) do not match damage filters. Would need a decision on
  whether they map to the player damage filters or the `pet:` namespace.
- Narrow the right-side Celestial Powers list by the active benefit filter (show
  only still-pickable powers whose stats match). Currently filter-independent,
  mirroring the "Available to get" list. Pointer: `availablePowers` +
  `taggedStars`/`selectedBenefits` in `main.ts`.
- Finer Attributes section: ~7 of the Attributes subjects are weapon/armor
  requirement reductions that could split into their own subsection.
- Distinct map treatment for a power match vs a bonus match (today both reuse the
  benefit-match highlight on the diamond).

## Reachability engine: residual synthetic false-reach

`just validate-reach` Part A shows ~450 false-reaches per 12k random small
models vs the independent BFS oracle (the resolver calls some unreachable
selections reachable). The real-map hunt (`just realmap-hunt`) finds 0, but
only for the Affliction-stack shape it generates. Open work: characterize the
residual as synthetic-only, or broaden `just realmap-hunt` to other shapes.
`reachability-oracle.test.ts` stays `test.failing` on the small-model
mechanism; re-run `just realmap-hunt` + `just validate-reach` + `just
validate-wasm` after any resolver change. Background: the resolver decides on
the construction PEAK, not the post-refund cost (see
`docs/reachability-engine.md`); the order-exact `minPeakCost` oracle lives on
branch `reachability-costed-scaffolding`, vendored in
`web/test/support/costed-oracle.ts`.

## Guided build order: remaining follow-ups

- Supporting-set suggester (the principled Oleron fix): for a not-self-covering
  selection, suggest the cheapest supporting constellations that complete it and
  order the whole build, turning "Incomplete build" into actionable guidance. A
  spike proved this viable: an exact min-stars knapsack DP over the affinity
  deficit (the capped affinity space is only ~917k states, so it is tractable,
  not NP-hard at our scale) gives optimal support sets when correct (Oleron ->
  +24 support, 31-point total, matching the engine `minCost` floor; same for
  Light of Empyrion, Ultos, Tsunami). TWO real problems to solve first: (1) the
  deficit-DP ignores that a support constellation has its OWN affinity
  requirement, so it undercounts when support needs support (Ulo, Blind Sage,
  Crab, Hydra came in below the engine floor) - make it self-consistent
  (iterate: add support, fold in its requirement, re-solve) or extract the
  witness from the engine's own `minCost` machinery, which already computes the
  correct total. (2) reconcile a discrepancy the spike surfaced: for Ulo the
  deficit-DP says 9, `selectionMinCost` says 11, AND `buildOrderPath` returned an
  order for the 9-point set - those three must agree; investigate whether the
  9-point final state is genuinely self-covering (minCost loose) or not
  (buildOrderPath returning an order for a non-self-covering final state would be
  a real bug). Also decide cheapest-vs-"productive" support (a player wants
  support that grants stats they want, not just minimal stars - a heuristic layer
  on the feasibility DP). This needs its own brainstorm/spec/plan.
- Tier 3 (bounded exact verify): port `minPeakCost` (branch
  `reachability-costed-scaffolding`, vendored in
  `web/scripts/reachability-realmap-hunt.ts` and
  `web/test/support/costed-oracle.ts`) into `web/src/core` and run it with a
  work/time cap to turn a missing order into a definitive "not buildable at N
  points" and make the false-reaches provably so.
- Background-worker search (Ted's idea): move the heavy escalation search off the
  main thread into a Web Worker that searches continuously, cancelling/restarting
  on selection change (generation token), bounded so unbuildable selections do
  not spin forever. Would let an order appear/improve without a manual trigger.
  The message + `minBuildableCap` logic move into the worker unchanged.
- Escalation-recovery test coverage: `buildOrderEscalated` is tested only for
  returning null on the genuine false-reach, never for RECOVERING an order that
  the live tries=16 pass missed. Add a synthetic fixture where tries=16 returns
  null and a higher-tries search returns a replay-legal order. A crude 4000-seed
  random scan did not surface a natural cliff-miss; a constructed synthetic model
  is the likely route.
- Minor cleanup: extract the duplicated `esc` HTML helper into a shared
  `web/src/adapters/html.ts`; tighten the `expect(frView.reach).toBeDefined()`
  no-op in `reachability.test.ts` to assert the engine actually lit the
  false-reach reachable.

## Performance: monotone dim-cache for the reachability sweep

Reachability is monotone under adding stars: if completing/clicking a candidate
is dim at a given selection and budget, it stays dim for every superset
selection. Cache dim verdicts per session and skip re-proving them, so repeated
clicks while finishing a constellation near a borderline-infeasible capstone
become free. Invalidate on any star removal (deselect) or budget (slider)
change - the only moves that can turn a dim candidate reachable again.

Deferred because the WASM resolver already brings per-click latency to a good
place (median ~1.3ms, p95 ~45ms, p99 ~190ms). It would help the late-game dim
tail (it cut p99 ~190ms -> ~137ms in a harness experiment). It does NOT fix the
rare ~1.1s worst case (an early multi-capstone state dominated by
reachable-but-tight verdicts, which are not monotone, so they cannot be cached).
See the "Residual" note in `docs/reachability-performance.md`. Pointers:
`classifyForSelection`/`reachabilityForSelection` in
`web/src/core/reachability.ts`, driven from `main.ts`; key the cache by
candidate id + a generation counter bumped on removal/cap change.

## Baseline build comparison: empty-baseline edge case

Setting a baseline with zero stars selected encodes `cs=`/`cp=` but does not
survive a reload, because `decodeHash` treats an empty `cs=` as "no comparison"
(`urlState.ts`, the `baseSel.size > 0` guard). The diff would be empty anyway,
so it is low impact. Cheapest fix: make `set-baseline`/`cmp-update` a no-op when
`state.selected.size === 0` (or disable the button when nothing is selected) in
`web/src/app/main.ts`, with a test.

## Mobile / touch polish

The responsive + touch pass shipped. Remaining considerations:

- The benefit-match, active-art, taken-link, and selectable-star glows are SVG
  filters (`#match-glow` / `#self-glow` / `#self-glow-art` in
  `web/src/adapters/svgRenderer.ts`), because CSS `filter: drop-shadow()` on SVG
  renders nothing on WebKit/iOS. Their blur is in user units, so the glow scales
  with zoom rather than holding a constant screen size; they are sized to read at
  the fit-zoom the map opens in. Revisit if a screen-constant glow is wanted
  (no clean SVG-filter way; it would need a non-scaling technique).
- The selectable-star glow applies a per-star SVG filter to every selectable star
  (100+ from an empty map). If it janks pan/zoom on low-end phones, drop the
  `filter` from `.star.selectable` in `web/src/styles.css`.

## Pure visual-state model for the map (display language)

Today the map's display logic is split between `svgRenderer.ts` (which CSS
classes each element gets, derived from raw inputs: `reach`, `state.selected`,
`affinityFilter`, `highlight`, `diff`) and `styles.css` (what each class means,
and - by source order - which one wins when two set the same property). There is
no single place that computes an element's final visual status, so independent
signals collide. The concrete symptom that motivated this: reachability dim
(`con-dim`, opacity 0.15) and the affinity-filter fade (`aff-dim`, 0.5) are
equal-specificity class rules on the same `opacity` property, so an unreachable
non-matching constellation took the later/lighter `aff-dim` and read BRIGHTER
under a filter. (Patched directly by making reachability dominate the fade in
`affDim`; the structural issue remains.)

Goal: a clean model that supports a visual language which is easy to tweak,
reason about, and clearly communicates each star/constellation/edge's status to
users. A pure `core` module that, given the model + current settings, emits a
per-element status record (the orthogonal facts: `reach` state, `active`,
`affinity: match | fade | none` + matched colors, `benefit: match | dim | none`,
compare `added/removed`) AND the composed final treatment (e.g. a single opacity
that multiplies the independent factors instead of letting the CSS cascade pick a
winner). The adapter (`svgRenderer.ts` + `styles.css`) maps records to SVG/CSS;
the SVG glow *filters* themselves stay adapter-side (not pure), but *which*
effects apply and *what color* become pure and headless-testable.

Confirmed current visual language (verify before building): identity affinity ->
constellation art gradient tint (only when the constellation has a *requirement*)
+ star gradient outline; active (all stars selected) -> art opacity 1 +
self-glow, selected star white fill + gradient stroke, edge gold only when both
endpoints selected; reachable=false -> `con-dim`/`unmet`/`unreachable` strong
fade on art/stars/edges; passes affinity filter -> constellation-level saturated
glow (no star/edge effect); fails affinity filter -> mild `aff-dim` on
art/stars/edges; passes benefit filter -> matching *stars* enlarge + halo, other
*stars* dim (edges/constellations untouched).

Pointers: inputs already pure (`ReachView` from `reachability.ts`,
`matchedAffinities` in `core/affinity.ts`). New module would live in `core/`
(e.g. `displayState.ts`), consumed by `svgRenderer.ts`'s render loop. Needs its
own brainstorm/spec: the exact record shape, how the orthogonal opacity factors
compose, and how much of the CSS-class language moves to computed values.

## Known limitations (accepted)

- `racialBonusPercentDamage` aggregation in the sidebar uses the union of all
  selected stars' `racial_target`; if different races are mixed it lumps them
  together. Acceptable given how rare these stars are.

- The faded-constellation tooltip's completion line ("Needs N of your M points")
  searches `completionMinCost` only up to the current cap (`main.ts`
  `completionInfo`), so a constellation whose true completion cost sits between
  the current cap and the 55-point game max shows "Cannot be completed within M
  points" rather than a real "Needs N (raise your cap)". Only affects users who
  lowered the cap below 55; at cap 55 the message is exact. Fuller fix: search to
  `BUDGET` (55) in `completionMinCost` and render the cap-raise hint when
  `cap < N <= 55`.

## Internationalization: remaining follow-ups

Phases 1a, 1b, 2, and 3 are all done: the localization seam, app-owned
chrome/statFormat strings, game-data tags resolved via `gameText`, the
curated stat-tag mapping, and 13 shipped locales (`en de fr es ru zh pl it cs
ja ko pt vi`, Spanish added in a follow-on once the `Text_ES.arc` extraction
issue was resolved). A further follow-on added a visible language picker
(header globe button; see `docs/i18n.md`). See [docs/i18n.md](docs/i18n.md)
and `docs/superpowers/specs/2026-06-30-i18n-localization-design.md` for the
full design. Remaining work:

- **Community correction of authored translations.** The 12 non-English
  `app.<locale>.json` catalogs (`web/src/i18n/app.*.json`) are LLM-authored
  best-effort translations, not reviewed by native speakers. Corrections are
  welcome via per-language PRs. The authors flagged the `aff.*` affinity
  names and some race/composed terms as the most uncertain and worth
  prioritizing for review.
- **Crowd-control wrapper templates need translation.** The two composed
  templates `stat.power.ccChanceDuration` / `stat.power.ccDuration`
  (`web/src/i18n/app.en.json`, used by `formatPowerStats` for celestial-power
  Stun/Freeze/Petrify/Knockdown/Confusion procs) are English-authored only;
  non-English locales fall back to English for the wrapper while the effect
  noun (`stat.subject.cc*`) is localized. Add per-language translations (same
  community-correction stream as above). The magnitude/duration debuffs
  (fumble, slows, resistance reductions) reuse already-translated
  `stat.subject.*` keys and need no new translation.
- **Align authored English stat labels to exact game terms (bounded).** A
  handful of app-authored `stat.override.*` labels use our wording rather than
  the game's exact character-sheet term, so they read fine but do not match
  in-game text (for example `defensiveStun` renders "Reduced Stun Duration"
  where the game says "Stun Resistance"). A one-time pass could map these to
  the game tag (like `data/stat-format-tags.json` does for the value-embedded
  ones) or re-author them to the game's wording. Distinct from the open-ended
  translation-quality stream: this is a small, enumerable English-correctness
  pass.
- **Heal label full-template upgrade.** `characterHealIncreasePercent` is
  app-authored as the bare label "Increased Healing" because its game format
  string is value-suffix ("Healing Effects Increased by {v}%") and cannot
  reduce to a clean prefix label in the value+label row model. If a
  value-templated row shape is added later, it could render the game's exact
  string (authoritative in every language) instead. Pointer: `OVERRIDES` +
  `stat.override.characterHealIncreasePercent` in `web/src/core/statFormat.ts`.
- **ICU-style plural handling.** Simple named-placeholder interpolation
  (`web/src/core/localization.ts`) is used today. Add narrowly only if a
  target language's grammar needs real plural rules, not preemptively.
- **Code-hardening follow-ups** (minor safety improvements, not blockers):
  - Prototype pollution in interpolation (`web/src/core/localization.ts`): `interpolate` checks `name in params`, which matches inherited prototype properties (e.g. a placeholder literally named `constructor`). Author-controlled today so not a real exposure, but harden with `Object.hasOwn(params, name)` if convenient.
  - Silent fetch failures in catalog loading (`web/src/adapters/localizationAdapter.ts`): `getJson` swallows fetch/parse errors and returns `{}` with no log, unlike the sibling `web/src/adapters/httpDataSource.ts` which `console.warn`s on failed data fetches. Consider a matching `console.warn` to aid diagnosing missing or mistyped catalogs. Silent degrade-to-English is the intended UX.
  - Guard test coverage (`web/test/appCatalog.test.ts`): the REQUIRED list explicitly guards chrome and `stat.group.*` keys but only spot-checks the ~130 other `stat.*` keys; `statFormat.test.ts` effectively covers them today. Consider deriving referenced keys programmatically so the guard enforces its own contract ("every key referenced by the app exists in the catalog").
  - Dead boot keys in catalog (`web/src/i18n/app.en.json`): `ui.boot.failed` / `ui.boot.reload` / `ui.boot.loading` exist in the catalog and appCatalog REQUIRED but nothing consumes them; the boot markup in `web/index.html` renders before catalogs load (the intentional pre-bundle exception). Either wire them if the boot shell becomes JS-rendered later, or note them as reserved for that exception.
  - Orphaned catalog keys from the merged overrides: `stat.override.defensiveProtectionModifier` and `stat.override.retaliationFearChance` exist in all 13 `web/src/i18n/app.<locale>.json` files but are no longer referenced now that those subjects merge and label from `stat.override.defensiveProtection` / `stat.override.retaliationFearMin` instead. Remove the two orphaned keys from all 13 catalogs. Pointer: `web/test/appCatalog.test.ts` guards keys the app references but are missing from a catalog, not keys present but unused, so this cleanup will not surface as a test failure until done by hand.
- i18n pet-name pluralization is English-only. `web/src/core/statFormat.ts` `formatPet` appends a Latin "s" to a pluralized pet name (`` `${name}${plural ? "s" : ""}` ``) where `name` is a `gameText`-resolved (localized) pet name. In non-English locales this appends "s" to a localized noun, which is grammatically wrong. English is unaffected. Fix later via a catalog-driven plural form or a count-aware template.
- i18n partial-gate weapon-requirement prefix strip is English-only. `web/src/adapters/tooltipView.ts` strips `/^Requires\s+/i` from the localized weapon-requirement description before wrapping it in `ui.tooltip.partialGate`. In non-English the prefix will not match, so the full localized string passes through (readable, just not de-prefixed). Currently latent: no constellation in the present data hits this partial-gate branch (all gating is fully-gated). Fix later by sourcing the bare requirement subject rather than string-stripping.

## Parallelize first-load data fetches

`httpDataSource.load()` (`web/src/adapters/httpDataSource.ts`) fetches
`devotions.json`, `manifest.json`, `cover-table.bin`, and `reach.wasm`
serially. Only `devotions.json` must come first: it builds the model the cover
blob decode and the WASM resolver need. The other three could fire in parallel
after it to shave round-trips on slow links. Deferred from the first-load UX
work because it is small and touches a careful degrade path.

Pointers: the `load()` method in `web/src/adapters/httpDataSource.ts` chains
`await`s; `manifest.json` is independent of the model, and the `cover-table.bin`
/ `reach.wasm` fetches can overlap the `buildModel(doc)` call (only their decode
needs the model). Re-verify the existing fallbacks after: a missing/mismatched
cover blob must still disable dimming, and a missing `reach.wasm` must still fall
back to the TS resolver.

## Reachability sweep: TS-fallback perf for the reachableStars maxK search

The `reachableStars` maxK sweep (added for partial-constellation reachability)
slowed some whole-constellation-from-empty clicks on the pure-TS resolver
fallback path: tree_of_life went from 14ms to roughly 582ms. The deployed WASM
path is unaffected (worst singleton 34ms, 0 clicks over 400ms), so this only
matters for users without the WASM resolver loaded. The documented lever is
the budget-shift dedup: for a non-completable constellation, "selection + k
stars at budget B" decides like "selection + 1 star at budget B-(k-1)" (a
witness that finishes the constellation would make it completable, a
contradiction), cutting the maxK search to about one classify call.

Pointers: `reachabilityForSelection`'s maxK search in
`web/src/core/reachability.ts`; the fallback is described in
`docs/superpowers/specs/2026-07-12-partial-constellation-reachability-design.md`.
The coarse CI guard (`web/test/reachability-perf-guard.test.ts`) runs this TS
path and had its MAX_MS raised to 3000ms to absorb the slowdown on CI runners
(slowest state ~1.6s there); re-tighten it when the dedup lands.

## Reachability fuzz: pre-existing conservative false-dims on seeds 97 and 113

`just fuzz` seeds 97 and 113 (outside the CI fuzz range of seeds 1-20, or 1-4
without WASM) produce 10 pre-existing conservative false-dims: the engine dims
selections that are members of a valid build. Verified identical on
pre-feature main, so this is not a regression from partial-constellation
reachability. Candidates: add to the known-gaps documentation, or a deeper
engine fix.

Pointers: `web/scripts/reachability-fuzz.ts`; `docs/reachability-engine.md`
"Known limits".

## Item-database follow-ups (downstream of the raw deposit)

The raw deposit (`just deposit`, see `docs/deposit.md`) is phase 1 of the
item-database initiative. The ranked ideation record at
`docs/ideation/2026-07-03-item-data-extraction-ideation.html` holds the full
analysis; these are the deferred directions, in rough order:

- **Typed canonical schema: entities + long-form stats.** `items.parquet`
  (dense low-cardinality columns: id, class, rarity, level, slot, template)
  plus `stats.parquet` (item_id, stat_id, value_min, value_max) keeping raw
  .dbr stat ids. Scope which categories are included using the census's
  canonical-key coverage table (R7). All derivation is SQL over the deposit.
- **Reference-closure edges table.** `edges(src_record, ref_key, dst_record)`
  built from the same reference-following the census's dangling-ref
  diagnostic does; enables "items whose granted skill deals chaos damage",
  set membership, affix-pool queries. Pointer: `power_skill_chain` in
  `scripts/parse_devotions.py` for the reference-hop precedent.
- **Dataset-as-product releases.** Per-patch immutable releases tagged by
  Steam buildid (already in deposit meta) with checksums and a
  machine-generated balance diff vs the previous build; the diff doubles as a
  pipeline drift smoke test.
- **Engine bake-off: facet bitmaps vs DuckDB-WASM.** Decide the browser query
  engine with measured deposit sizes, not assumptions. Precedent constraints:
  the 2026-06-21 reachability spec's DuckDB rejection (its exception clause
  arguably fits this case) and the 2026-06-28 first-load byte-budget work.
- **Engine-independent query IR in the URL hash.** Compact filter IR (facet
  terms, ranges, text, combinators) encoded with `urlState.ts` tolerance
  discipline, so shared links never encode engine specifics. Must be settled
  before the first shareable item-query link ships.
- **Exception-only stat-label generator.** Decompose stat-id naming into
  candidate game tags, verify against `Text_EN`, hand-curate only the misses;
  scales item stat labels to 13 locales without hand-authoring 700+ ids.
