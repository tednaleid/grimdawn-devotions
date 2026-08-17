# Backlog

Future work for the web planner that is not yet started or not yet finished.
Each item includes implementation pointers for whoever picks it up. This file
is future work ONLY: shipped features and their history live in the code, in
git history, and in the reference docs under `docs/`.

## Grimtools import/export: deferred follow-ups

Shipped: paste a grimtools calc link or slug to load its devotions, with `gt=`
provenance in the hash and a link back to the source build. Also shipped: one-click
export of a legal selection to a fresh grimtools build, associated the same way as
`gt=`. See `docs/superpowers/specs/2026-08-09-grimtools-devotion-import-design.md`
(import) and `docs/superpowers/specs/2026-08-16-grimtools-export-design.md` (export).

- **No e2e leg for the import wiring.** The core parsing, the mapping and the panel
  adapter are unit tested, but nothing drives the three together in a browser. Belongs
  in `web/e2e/smoke.ts` beside the search checks. Note `just e2e` is not in CI, so this
  buys a repeatable local check rather than an enforced gate.
- **No divergence marking.** The source link persists after the build is edited and is
  dismissed by hand with the `✕`. A "modified since import" indicator was considered and
  deferred: it is a third state to design, translate into 13 locales, and test, for a
  nuance nobody has asked for. Pointer: `ImportState` in
  `web/src/adapters/importPanel.ts`.
- **Import covers devotions only.** `buildInfo` also carries gear, mastery skills,
  attributes and item skills, all already in the worker's reach. Nothing consumes them
  because the planner models devotions.
- **Overlapping imports race.** `runImport` in `web/src/app/main.ts` has no guard against
  a second submit landing while the first is still in flight (two fetches outstanding,
  whichever settles last wins the applied state, whatever the panel is showing at that
  point may not match). Not fixed here, since it needed real UX judgment (disable the
  input while loading? cancel-and-restart? a request token?) that was out of scope for
  a review-fix pass.
- Export: cross-session duplicate detection is impossible without a way to read a
  build's stars back and compare; if it ever matters, the worker's `GET /` already
  returns them, so "compare on demand when a `gt=` link is restored" is one fetch
  (`web/src/app/main.ts` `knownBuilds`).
- Export: the payload is a fresh level-100 character. If grimtools changes its
  Share defaults (`bio` numbers), update `savePayload`'s fixture test from a fresh
  capture (spec 2026-08-16, "What the investigation established").
- Export: the rate limits (5/min per address, 60/min global) are guesses; revisit
  from worker analytics if real users hit them.
- Export has no data-version guard. Import refuses a stale mapping table by comparing
  the worker's reading of `devotion.json`'s version against the table's; export sends
  the table's `sk` ids with no such check, so a grimtools data update would silently
  produce a build of the wrong stars. The worker already reads that version on the
  import route, so a `?dv=` check on `/export` (refuse with a distinct error when it
  differs from the planner's table version) is small. Until then the daily canary is
  the only alarm.
- The controller's export logic has no unit tests: `selectionKey`, the `knownBuilds`
  memo and `exportStateFor`'s precedence (plus the "pinned to the selection it was made
  from" rule) all live inside `boot()` in `web/src/app/main.ts`, which has no test
  harness. Lifting those three into a small pure module would make them testable
  without one. The round trip added `readBuild`, `ensureSourceRead`, the `remove`
  computation and the base data-version refusal to that untested surface.
- grimtools' own "Devotion path" panel reported "There's no way to include all selected
  constellations with only 55 devotion points" for an exported 53-star build
  (`https://www.grimtools.com/calc/2d1W1Q8V`, the forum link with Lion completed) that
  our oracle proves has a legal 55-point schedule; stars, points and affinities matched.
  Worth checking whether their path finder ignores refundable scaffolding, and whether
  the game accepts our schedule for that build (docs/reachability-engine.md playbook).

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

## URL history: follow-up e2e coverage

Shipped: Back/Forward traverse planner states, live hash edits apply, and
points-bar gestures coalesce to one history entry (see
`docs/superpowers/specs/2026-07-14-url-history-design.md`). The final review
recommended two additional e2e checks that are not yet written:

- Back across a compare-mode enter: after Set baseline pushes an entry with
  `cs=`, one `history.back()` should drop `cs=` from the hash and clear
  `body.comparing`.
- Undecodable-hash reset: assigning a garbage hash mid-session should reset to
  the empty build and canonicalize the URL in place (replace, no extra entry).

Pointers: extend the history block in `web/e2e/smoke.ts` (between the
compare-mode checks and the narrow-viewport section); the behaviors under test
live in `main.ts`'s `applyHash()` / `hashchange` listener.

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

## Reachability validation: swap-aware oracle and a filler-state arbiter

Two gaps in the validation tooling, not the engine:

- `minPeakCost` (`web/test/support/costed-oracle.ts`, the arbiter behind `just
  realmap-hunt` and `just build-order-validate`) sizes each step's scaffold in
  isolation, so its minimum is a lower bound on the true construction peak: `>
  budget` proves unreachable, `<= budget` is only evidence that a schedule
  exists. Making it swap-aware (carry the held scaffold set in the DP state, or
  emit and replay its argmin order through `emitSchedule`) would turn the hunt's
  "recovered" and the validator's "order exists" lines into proofs. Pointer:
  docs/reachability-engine.md "The costed-scaffolding oracle".
- There is no exact real-map arbiter for filler-needing (non-self-covering)
  states, where the resolver's DFS decides; `validate-reach` Part B covers only
  whole self-covering builds. Extending the oracle to enumerate filler supersets
  (bounded, offline) would let Part B cover the resolver path too.

## Build-order popup: touch e2e via Playwright

The step popup's touch path (tap shows, re-tap and tap-away dismiss) is wired
per the map tooltip's popover pattern but is not automation-verified: raw CDP
`Emulation.setEmulatedMedia` cannot flip the `(hover: none) and (pointer:
coarse)` media query in the headless Chrome the e2e harness drives (probed in
isolation during implementation), so `web/e2e/smoke.ts` records a named
SKIPPED check for the tap branch. Playwright's touch emulation handles what
raw CDP could not; a small Playwright-driven check (or a hasTouch context in
the existing harness if it grows one) would close the skip permanently.

Pointers: the touch block at the end of `web/e2e/smoke.ts` (the
`touchEmulated` probe and SKIPPED branch); the wiring under test is
`showBoPop`/`hideBoPop` and the row `pointerup` toggle in
`web/src/app/main.ts`.

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
  `web/src/adapters/html.ts`; the `expect(frView.reach).toBeDefined()` in
  `reachability.test.ts` is a no-op (that build now classifies dim, so the
  test only shows `buildOrder` is null for a dim selection).

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
- **Block-recovery label: record why it stays app-authored.**
  `characterDefensiveBlockRecoveryReduction` keeps an app-authored
  `stat.override.*` label even though a game format tag exists
  (`tagCharDefensiveBlockRecoveryReductionR`), because that tag's range form
  `-({%.0f0}-{%.0f1})%` is not reducible by `stripValueTokens` to a clean
  prefix label. `statFormat.ts` carries a comment explaining why its sibling
  `retaliationDamagePct` DID move to `STAT_FORMAT_TAGS` but says nothing about
  why this one did not, so the next reader has to rediscover it. Write the
  reasoning down beside the `OVERRIDES` entry. Related quirk found while
  auditing the Polish catalog: the game ships two variants of this tag, the
  single-value `tagCharDefensiveBlockRecoveryReduction` (which is what a
  devotion star renders, since every devotion value is a scalar) and the
  ranged `...ReductionR`; all 13 catalogs are sourced from the single-value
  one. Pointer: `OVERRIDES` +
  `stat.override.characterDefensiveBlockRecoveryReduction` in
  `web/src/core/statFormat.ts`.
- **Heal label full-template upgrade.** `characterHealIncreasePercent` is
  app-authored as the bare label "Increased Healing" because its game format
  string is value-suffix ("Healing Effects Increased by {v}%") and cannot
  reduce to a clean prefix label in the value+label row model. If a
  value-templated row shape is added later, it could render the game's exact
  string (authoritative in every language) instead. Pointer: `OVERRIDES` +
  `stat.override.characterHealIncreasePercent` in `web/src/core/statFormat.ts`.
- **Proc qualifier: source it from the game tables and carry the low-health
  threshold.** The `trigger.<enum>` catalog values are hand-transcribed from
  the game's `tagAutoSkillCondition01..12` strings (see docs/i18n.md), which
  is correct today but is a copy: a `data/proc-tags.json` (trigger enum ->
  tag) fed to `build_game_tables.py` like `stat-format-tags.json`, plus a
  `{%d0}` -> chance interpolation at render, would make `gameText` the source
  in all 13 languages and remove 13 x 12 catalog entries. Blocked on a game
  table regeneration (`just i18n-tables`, Windows extraction; see "Game text
  tables are stale" below). Do the LowHealth/LowMana threshold at the same
  time: the game says "(100% Chance at 33% Health)" for Ghoulish Hunger and
  "at 40% Health" for Turtle Shell, but `extract_proc` in
  `scripts/parse_devotions.py` reads only `chanceToRun`/`triggerType` from the
  autocast controller, so the app says "on Low Health". Read the threshold
  field off the controller record, carry it in `proc`, and interpolate the
  game's `{%.0f1}`.
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

## Compare mode: repair the decoded baseline in applyHash

`applyHash` runs `repairSelection` on the live state only; `decodeHash` returns
the `cs=` baseline raw. A hand-crafted or stale `cs=` promoted into the live
build (via Swap or the pre-existing Revert path) renders unpruned on screen
until the next reload re-decodes and repairs it, a narrow screen-vs-URL
divergence. Repairing the baseline in `applyHash` hardens Swap and Revert
alike. Related corner: an empty baseline is unrepresentable (`encodeHash`
emits an empty `cs=` and the `baseSel.size > 0` decode gate drops the
comparison on reload/Back), reachable via set-baseline on an empty build or
Reset-while-comparing then Swap.

Pointers: `applyHash` and the `cmp-swap`/`cmp-revert` branches in
`web/src/app/main.ts`; `decodeHash` baseline gate in `web/src/core/urlState.ts`.

## i18n guard: assert REQUIRED key presence per locale

`web/test/appCatalog.test.ts` asserts the `REQUIRED` keys exist only in
`app.en.json`; the per-locale tests catch stray keys and placeholder
mismatches but never a missing key, so a forgotten translation silently
falls back to English. Extend the guard to iterate all 13 catalogs.

Pointers: the `REQUIRED` loop at `web/test/appCatalog.test.ts:150-153` and the
per-locale test block below it.

## Need-driven ordering: small follow-ups from the final review

Three non-blocking items from the need-driven-ordering branch review, in
priority order:

1. A unit test pinning needDrivenOrder's deficient-colors-only scoring: a
   mutant that sums grants over ALL colors (not just deficient ones) passes
   the current six unit tests and is caught only indirectly by the aggregate
   churn pins.
2. A cross-reference comment on REPRO_HASH in web/scripts/order-quality.ts
   ("must match web/test/build-order-oracle.test.ts"), mirroring the comment
   SEEDS already carries.
3. A shared hasGrant helper for the grants predicate duplicated verbatim in
   buildParts and needDrivenOrder.

Pointers: the score loop and grants predicate in web/src/core/reachability.ts
(needDrivenOrder, buildParts); web/test/need-driven-order.test.ts.

## Build-order renderers: shared step-row template

`buildOrderHtml` and `transitionHtml` each carry their own art/dot/row markup;
a shared `renderStepRow` would prevent drift.

Pointers: web/src/adapters/buildOrderView.ts (both renderers).

## Reachability data guard: requirements never exceed CAP_MAX

The capped/uncapped verdict equivalence in the legality oracles assumes every
constellation requirement is at most CAP_MAX per color; nothing pins that
against a future data extraction. Add a one-test guard over cons.

Pointers: CAP_MAX in web/src/core/reachability.ts, orderLegality.ts,
transitionOrder.ts; a new assertion in web/test (e.g. beside the model tests).

## Transition walk: both-directions-null residual (teardown eligibility, approach C)

The reversed-walk candidate resolves the owner's pair in both directions: the state walk still
returns null for the swapped (eel-to-ghoul) direction, but the opposite-direction (ghoul-to-eel)
walk's schedule reversed is oracle-verified and enters the selection pool, so the swapped pair now
resolves incrementally (9 steps, 32 moved) instead of falling back to the 130-moved full respec. A
legal schedule traversed backward visits the same board states in reverse, so either direction's
walk resolving is enough - only a pair where the walk returns null in BOTH directions still falls
back to the two-pass replay or full respec. Likely lever for that residual: move 4's teardown
eligibility is intentionally narrow (only want-members standing exactly at target), so
baseline-only leftovers and shrink candidates can never be torn for cap room. Widening it, or the
spec's deferred approach C (truncated respec), are the recorded next steps if the full-respec tail
matters in practice.

Pointers: stateWalkTransition move 4 and reverseSteps in web/src/core/transitionOrder.ts; approach
C in docs/superpowers/specs/2026-07-20-transition-state-walk-design.md (non-goals).

## Downloadable offline build (parked)

A user asked for a downloadable version they could open locally without the site being served.
Everything is static (no backend), but the current `dist/` cannot be opened by double-clicking
`index.html` over `file://` in Chrome or Firefox: (1) the bundle loads as an external ES module
(`<script type="module" src>`), which those browsers block over `file://` (Safari allows it), and
(2) the app `fetch()`es all its data at runtime (`data/devotions.json`,
`assets/devotions/manifest.json`, `data/cover-table.bin`, `data/reach.wasm`, and the i18n catalogs),
and `file://` fetch is blocked in Chrome/Firefox. So a zip of the loose folder fundamentally needs a
local server; only an all-inlined artifact opens by double-click.

Two shapes: (A) zip `dist/` plus a tiny launcher that starts a local server, works everywhere but
needs the user to run/trust something; (B) one self-contained HTML file with everything inlined
(IIFE/classic script instead of a module, CSS inline, JSON catalogs inline, `reach.wasm` +
`cover-table.bin` base64-embedded and decoded to bytes at startup). Full inlined payload is roughly
3.5-4 MB. `cover-table.bin` (1.8M) and `reach.wasm` (60K) are both optional with graceful fallback,
so a minimal file could drop ~1.9 MB at the cost of slower reachability and no dimming.

Parked because the site is about to become multi-page (a resistance-reduction page alongside the
planner): a single inlined HTML assumes one page, so option B needs rethinking once the page set is
known (inline multiple pages vs. accept the must-be-served folder). Revisit after the multi-page
shape lands.

Pointers: the hexagonal design makes option B additive, not a rewrite - `DataSource` is a port with
`httpDataSource` as one adapter (web/src/adapters/httpDataSource.ts), and the localization adapter
already takes a `fetchImpl` (web/src/adapters/localizationAdapter.ts); an embedded DataSource plus a
fetch shim covers the runtime, and a `just` packaging recipe inlines the assets. WASM already
instantiates from raw bytes (`WebAssembly.compile`, not `instantiateStreaming`), so base64 bytes work
unchanged. No dynamic `import()`/`import.meta` in source, so an IIFE build is clean. URL-hash state
works fine under `file://`, but a copied `file://` link is not shareable across machines.

## Monster stats survey + explorer page (sub-project 3)

**v1 pipeline shipped; phase 2 (explorer page) unblocked.** The extraction
pipeline designed in
[docs/superpowers/specs/2026-07-24-monster-resistance-pipeline-design.md](docs/superpowers/specs/2026-07-24-monster-resistance-pipeline-design.md)
is implemented: `scripts/parse_monsters.py` (run via `just parse-monsters`)
produces the committed `data/monsters.json`, 2,725 kept records collapsed to
1,635 logical monsters keyed on name x classification, with difficulty as a
global additive offset table extracted from
`balancingadjustment_mp+difficulty_enemies01.dbr` (3 difficulties x 4 player
brackets) applied in the page. That spec supersedes the exploratory notes below
for anything it covers; HP/DA/OA plus attacks remain defined follow-on phases.
Superseded 2026-07-26: the tier above Ultimate is Ascendant, and it is now a
fourth key in the offset table, derived from `gameascendant.dbr ->
ultimateChallangeAdjustment` rather than assumed. It still adds no resistance
offset, but the pipeline now reads the record instead of taking that on faith.
See [docs/superpowers/specs/2026-07-26-ascendant-difficulty-design.md](docs/superpowers/specs/2026-07-26-ascendant-difficulty-design.md).
Phase 2, the
explorer page, can now be brainstormed and specced against the real dataset;
the spec pins the data contract it depends on.

A re-runnable survey that extracts **all monster stats** (not just resistances)
from the game files into a queryable committed dataset, plus a dedicated explorer
page (same shape as the resistance-reduction page) that lets users search/filter
monsters and graph distributions - e.g. filter to Nemesis-tier monsters and see
the per-type resistance distribution as a heatmap/histogram. Secondary payoff: it
grounds the RR page's ledger with real difficulty/tier presets instead of a
hand-typed "enemy starting resistance %".

### What the extraction found (confirmed against the records)

- **Resistances** are bare `defensive<Type>` fields (positive = resistance):
  Physical, Pierce, Fire, Cold, Lightning, Poison (= Poison & Acid), Aether,
  Chaos, Life (= Vitality), Bleeding, plus the Elemental aggregate. An absent
  field = 0% to that type. The spread is real: an Aetherial Abomination is
  Physical 20 / Pierce 25 / Aether 25 and 0 elsewhere; an Aetherial Colossus is
  Lightning 70 / Fire 35 / Aether 25 / Vitality 25 / Physical 20 / Pierce 20.
  (Note: `defensive<Type>` bare is the monster's own resistance; a *negative*
  `defensive<Type>` on a skill record is the RR debuff the RR pipeline extracts -
  same field name, opposite sign and context.)
- **Record location gotcha:** stat records are the base-named `.dbr` under
  `records/creatures/` (~4,149) + the `endlessdungeon/` set. The `*_boss.dbr`
  siblings are `charanimationtable.tpl` animation tables, NOT stats - do not read
  those. Each real creature record is large (~1,000 fields) and carries stats
  inline: `defensive*`, `characterLife`, `characterOffensive/DefensiveAbility`,
  attributes, `monsterClassification` (Common / Champion / Hero / Boss / Nemesis),
  `charLevel`/`minLevel`/`maxLevel`, `characterAttributeEquations` (-> a
  `bios/bio_*.dbr` scaling record), and `skillName1..10` (its ability records).
- **A monster's abilities** live under `records/skills/nonplayerskills/` (+ the
  `nonplayerskillsgdx1` / `gdx2` expansion dirs), referenced from `skillNameN` -
  exactly the records the RR pipeline *excludes* as player-irrelevant. If the
  page wants to show "what this monster casts" (incl. the RR it inflicts), join
  those in.
- **Level scaling:** `charLevel` is an equation (e.g. `(charLevel*1.1)+2`); base
  resistances are per-monster with Normal/Elite/Ultimate adding a **global**
  offset on top (constants in `game/gameengine.dbr` - resolve exact per-difficulty
  bumps during design).

### Biggest transferable lesson from the RR work: variant/tier de-duplication

Items turned out to be heavily level-versioned (689 item records -> 402 names),
and the RR pipeline dodged that only because it keys sources on the shared
*skill* record. Monsters have the same problem in a different shape: `_a01/_b01/
_c01` tier variants, `_summon` spawns, and hero/boss/difficulty variants of "the
same" monster. **Decide the logical-monster vs raw-record grain up front** and
plan a dedup/aggregation strategy, plus a filter to drop props / summons /
friendly NPCs / `hiddenFromCombat` / `invincible` records under `creatures/`
(the analogue of the RR pipeline's `nonplayerskills` exclusion).

### Reuse from the RR initiative (don't rebuild)

- **Shared parser helpers:** `scripts/gd_dbr.py` (`read_dbr`, `load_translations`,
  `DB`, `level_array_value`, `register`) - the monster parser is its third
  consumer. Follow the established pattern: `scripts/parse_*.py` -> committed
  `data/*.json` -> a `just` recipe wired into `just all` -> extend
  `scripts/build_game_tables.py` so monster **name** tags (the creature
  `description` tag / `tagCreature*`) land in `data/i18n/game.<lang>.json` for all
  13 languages.
- **Page architecture is a near-template:** `web/src/rr/` (hexagonal
  `core/model.ts` + `aggregate.ts` + `filter.ts` + `urlState.ts` + adapters + a
  second bundle entry in `web/scripts/bundle.ts`, all view state in the URL hash,
  i18n via `rr.*` catalog keys). The monster explorer is the same skeleton with a
  **heatmap/histogram view replacing the ledger**; model/filter/urlState/aggregate
  are largely copy-adapt.

Built after the RR page ships. Needs its own brainstorm/spec (the dedup grain, the
`gameengine.dbr` difficulty scaling, and which stats beyond resistances to surface).
Related: the RR pipeline spec (`docs/superpowers/specs/2026-07-21-resistance-reduction-pipeline-design.md`)
and page spec (`docs/superpowers/specs/2026-07-21-resistance-reduction-page-design.md`).

## Monster resistance dataset: known data quirks for the explorer page

- Two dataset rows will skew any mean-based "which damage type do enemies resist
  least" ranking: `enemies.trap_mineexplosive_a01` is classification `Common` with
  500 in nine of ten types, and `enemies.trap_chthonicshard_zap_a01_summon` carries
  a +500 vitality passive. Both are traps rather than monsters and both predate
  this work. The explorer page should filter or annotate them.
- Bleeding is representative-derived in a few collapsed groups: 544 kept raw
  records individually carry nonzero bleeding while the 245 shipped rows cover
  533, so a group whose representative lacks the passive shows 0. Already flagged
  by `variants_disagree`.

Pointers: `data/monsters.json` (`scripts/parse_monsters.py`); the dedup/collapse
grain and `variants_disagree` are documented in
`docs/superpowers/specs/2026-07-24-monster-resistance-pipeline-design.md`, the
skill-grant resolution in
`docs/superpowers/specs/2026-07-25-monster-passive-resistances-design.md`.

## Monster explorer / RR: tier and role chip labels do not localize

Tier and role chip labels are raw English/record-path tokens (`Common`,
`boss&quest`, `waveevent`) with no catalogue keys, so they never localize. The
same is true of the RR page's own facet chips. `web/test/i18nBoundary.test.ts`
cannot catch this because it only greps `src/core`, `src/adapters`, `src/app`
for two deleted singleton names and never scans `src/monsters/` or `src/rr/`.
Worth widening that guard and adding catalogue keys for both pages' chip
labels.

Pointers: `chipsMarkup` in `web/src/monsters/app/main.ts` and the chip
renderers in `web/src/rr/adapters/tableView.ts`; the grep list in
`web/test/i18nBoundary.test.ts`.

## Monster explorer: cosmetic test gaps confirmed by mutation

Found during the final whole-branch review, not yet fixed:

- Dropping the `hbar empty` class passes, so the styling its documented
  `!important` exists to serve (see the comment on `.hbar.empty` in
  `web/src/monsters/monsters.css`) is untested.
- `rank-pos`'s `i + 1` (`web/src/monsters/adapters/rankView.ts`) mutating to
  `i` passes.
- `class="left"` on facet columns (`web/src/monsters/adapters/tableView.ts`)
  is unpinned.
- The provenance tooltip's `+${amount}` mutating to `+0` (the `marker` helper
  in `web/src/monsters/adapters/tableView.ts`) passes.

Pointers: `web/test/monsters/rankView.test.ts` and `web/test/monsters/tableView.test.ts`.

## Veteran mode as a difficulty option

Ascendant is now derived from `gameengine.dbr -> ascendantRecord ->
gameascendant.dbr -> ultimateChallangeAdjustment`. Veteran is the same shape one
hop shorter: `gameengine.dbr -> challengeAdjustment ->
balancingadjustment_challengemode_enemies01.dbr`, layered on Normal the way
Ascendant layers on Ultimate.

Not built because its ten resistance fields are all zero today, so the control
would gain an option numerically identical to Normal and nobody has asked for it.
If it is ever wanted, `ascendant_ref`/`flat_adjustment` in
`scripts/parse_monsters.py` generalise to it directly.

## Item-database follow-ups (downstream of the derived schema)

The raw deposit (`just deposit`, `docs/deposit.md`) is phase 1 and the derived
typed schema (`just derive`, `docs/item-schema.md`) is phase 2 of the
item-database initiative. Ideation records:
`docs/ideation/2026-07-03-item-data-extraction-ideation.html` (extraction) and
`docs/ideation/2026-07-11-item-db-direction-ideation.html` (repo topology,
artifact policy, item source, grimtools boundary).

### Direction decisions (ratified 2026-07-11)

- **Single repo, split on tripwires.** The item work stays in this repo until
  a tripwire fires: first external consumer of the parquet, first
  independently-deployed item app, or item work breaking devotions CI. The
  split stays cheap by design (`deposit_dir` one-line relocation, no
  cross-imports, deploy ships only `web/dist`); the future combined
  gear+devotion planner weights staying. The released deposit is the
  interchange boundary if a split ever happens (raw text for 13 locales is in
  `labels.parquet`; display formatting stays code).
- **Link-out rule: own everything a query can answer.** Anything answerable
  by DuckDB over the deposit (stats, requirements, sources, crafts, factions)
  is modeled natively; only world geometry and lore link out. Outbound links
  are name-intent links (grimtools name-search URLs, `/map/areas/<id>`, wiki
  name slugs) - never grimtools item ids, which are internal sequential
  values on per-patch snapshot hosts. Never link out for item source.

### Sequenced roadmap

1. **Dataset releases + lockfile** (shipped 2026-07-11; see
   `docs/plans/2026-07-11-001-feat-dataset-releases-plan.md` and
   `docs/deposit.md`). `just publish-deposit` / `just fetch-deposit` with a
   committed `deposit.lock`. Still open as a follow-on: the machine-generated
   balance diff vs the previous build (small text, delta-diffable, doubles as
   a pipeline drift smoke test, community-valuable) - the release archive
   this shipped is its input.
2. **Item source tier 1: faction vendor and crafted sources** (shipped
   2026-07-11; see `docs/plans/2026-07-11-002-feat-item-source-tier1-plan.md`
   and `docs/item-schema.md`). `sources.parquet` derives full vendor lines
   ("Sold by Falonestra (Coven of Ugdenbog), Revered") from the merchant
   chain, materializes crafted rows, and feeds the prototype's source facet;
   `q-ae8-faction-sources` pins 284/292 coverage. Unsourced items stay silent
   (revised from the earlier "world drop" fallback: that label waits for
   step 3, which can actually distinguish it). Follow-up: whether the 8
   template-blank augments should leave the entities table entirely.
3. **Acquisition edges via one transposed loot-graph walker** (big rock;
   supersedes the old affix-applicability item). One reverse-reachability
   walk over creature `chanceToEquip*` -> `LootRandomizerTable` weights ->
   items emits `(item, source, path_kind, effective_weight)` and delivers
   three products at once: `drops_from`/monster-MI source edges, affix-to-gear
   applicability (activates the affix domain's gear-type buttons), and
   resolution of the `blueprints_without_crafts` diagnostic (58 at build
   19149150). Every edge carries a provenance qualifier (flat-fact |
   loot-walk | curated-oracle | interpolated) - decide the qualifier
   vocabulary before the first edge ships. Quest-reward tier needs a fresh
   research pass first: the "XP-only" evidence was refuted (keys belonged to
   devotion shrines), and `perPartyMemberDropItemName` under
   `storyelements/questitems/` shows item rewards exist in the records tree.
   Farmability (whether an item is farmable, and from where) and
   monster-infrequent affix applicability both wait on this walk; neither
   is answerable today. `scripts/gditems.py`'s `--source` field (shipped in
   the item query CLI, see [docs/item-cli.md](docs/item-cli.md)) is thin for
   exactly this reason - 7.2% of gear and 0% of affixes carry any source row
   at build 19149150 - and is designed so that this walk resolves more of
   those `unknown` items automatically once it lands, with no change to the
   CLI's interface.
4. **Ship `/items/` on the existing Pages deploy** (after 1). Publish the
   prototype plus derived parquet at a subpath, with the tier-1 source facet.
   Not "one workflow edit": CI cannot regenerate parquet (Windows-only
   extraction), so it depends on step 1's fetchable release; also resolve the
   prototype's CDN-loaded DuckDB against the self-contained deploy ethos.

### Unsequenced follow-ups

- **Engine bake-off: facet bitmaps vs DuckDB-WASM.** Decide the browser query
  engine with measured sizes, not assumptions. Precedent constraints: the
  2026-06-21 reachability spec's DuckDB rejection (its exception clause
  arguably fits this case) and the 2026-06-28 first-load byte-budget work.
  If bitmaps win, derived parquet stays a build intermediate forever.
- **Engine-independent query IR in the URL hash.** Compact filter IR (facet
  terms, ranges, text, combinators) encoded with `urlState.ts` tolerance
  discipline, host-independent, so shared links never encode engine or origin
  specifics. Published URLs are the initiative's only irreversible artifact;
  must be settled before the first shareable item-query link ships.
- **Roll-range gap: scaled offensive bonus lines.** Offensive damage-bonus
  stats on items carrying `attributeScalePercent` show a level-linked upscale
  on grimtools that plain jitter does not reproduce; datapoints recorded in
  `data/item-curation/variance.json` under `calibration.known_gap`.
- **Attack-speed tier pinning.** Fast/Average/Moderate/Slow APS bases in
  `data/item-curation/attack-speed.json` are interpolated; one grimtools card
  per tier (a Fast 1h axe, a scepter, a Slow 2h mace) pins them.
- **AND toggle within stat families.** OR is the only launch semantics
  (R16); the stats table already supports AND via `GROUP BY/HAVING`.
- **Pet-skill stat rollup.** Pet chains are relations only (`spawns_pet`);
  rolling pet-skill stats into the filterable stats table is deferred.
- **Exception-only stat-label generator.** Decompose stat-id naming into
  candidate game tags, verify against `Text_EN`, hand-curate only the misses;
  scales item stat labels to 13 locales without hand-authoring 700+ ids.

## Game text tables are stale against the current inputs

`data/i18n/game.*.json` has not been regenerated since `devotions.json` /
`resistance-reduction.json` last changed, and one gap is user visible today:
`tagGDX3ItemAwakenedSetC202Name` is referenced by `data/resistance-reduction.json`
but exists only in `game.en.json`, so 12 locales fall back to English for that RR
source name. A `just i18n-tables` run fixes it.

The pet-modifier fix (`fix/rr-pet-modifier-sources`) raises the stakes: re-running
`just parse-rr` takes the catalogue from 539 to 591 sources, and 34 of the tags the
new rows name (Raging Tempest, Hellfire Mine, Hexflame, Veilpiercer, ...) are in no
`game.*.json` yet, so those rows would render as raw tag keys. Whoever regenerates
`data/resistance-reduction.json` must run `just i18n-tables` in the same pass -
that is `just migrate`, which also stamps the current Steam buildid (24756825, not
yet in `data/steam-build-versions.json`).

The same run also drops `tagEnemyTrapA03` and `tagPetThermiteMineA01` from every
locale. That is not game-version drift: both still exist in the installed game
(`extracted/text_en`), and `grep -rl` finds them in no input file, only inside
the generated tables themselves. They are orphans left over from an earlier
input set, and a regen correctly stops emitting them.

The 2026-08-06 stat-label audit hand-inserted its own single new tag rather than
ship that unrelated churn inside a label commit. A deliberate wholesale
regeneration pass is still worth doing; `scripts/build_game_tables.py` already
reports `omitted: N` per language, which is the signal to check afterwards.

The 2026-08-06 constellation-description change hit the same problem at larger
scale: adding `description_tag` made `collect_referenced_tags` newly pull in 105
`tagDevotion_*Desc` keys, but a plain `just i18n-tables` run also carried the
usual unrelated churn described above, plus more of it than in the label-audit
case, since non-English locales differed from each other too, not just from
`en`. Rather than ship that, the new keys were added to all 13 committed tables
by hand-merging (`original` union `{new tagDevotion_*Desc keys}`), not by
committing a literal `just i18n-tables` output. That means the committed tables
are currently not byte-reproducible from `just i18n-tables` alone: re-running it
will surface the same churn again, and that is expected, not a new regression.
It is one more reason the wholesale regeneration pass above is worth doing: it
would restore reproducibility.

The non-English churn is larger than the English case because of an asymmetry
in how each is sourced: `en` reads from the already-extracted, version-pinned
`extracted/text_en`, while every other locale is re-extracted fresh from
whatever `resources/Text_<LANG>.arc` the locally installed game currently ships,
via `ArchiveTool`. When the local install has patched past the version
`extracted/` and the committed data were built from, the non-English tables pick
up that newer patch's text (renamed/added/removed item and enemy tags) while
`en` does not, which is why cs/de/es/ja/ru/zh saw extra changes beyond
`tagGDX3ItemAwakenedSetC202Name` and the two orphans.

## Devotion search: follow-ups from the branch review

The text search over the devotion map shipped (search box, corpus, per-locale
index, map emphasis, `q=` in the hash). Four items the final review raised and
the fix wave deliberately did not take:

- **No e2e leg for the search wiring.** `web/src/app/main.ts`'s search wiring
  (debounce, `replace`-mode hash writes, the `hashchange` re-sync of the box)
  is the branch's only surface with no automated coverage: the core matcher,
  the index, and the panel adapter are all unit tested, but nothing drives the
  three together. `web/e2e/smoke.ts` is where that belongs - it already runs a
  real browser and asserts across `history.back()`. Note `just e2e` is not in
  CI, so this buys a repeatable local check rather than an enforced gate.
- **One channel carries four names.** A search or benefit match travels as
  `RenderOpts.highlight` / `conHighlight` -> `DisplaySettings.benefitMatch` /
  `conMatch` -> `StarDisplay.benefitMatch` / `ConstellationDisplay.emphasis`.
  Now that this is genuinely one channel at two granularities (star and
  constellation), the names should converge on one word per granularity.
  Pointers: `web/src/adapters/svgRenderer.ts`, `web/src/core/displayState.ts`,
  and the call sites in `web/src/app/main.ts`.
- **Search does not index the dimension word.** The corpus indexes
  `condensedRows` subjects, so a star tooltip that renders "Duration" or
  "Chance" as its dimension exposes a word the user can read but cannot search
  for. Deciding whether to index dimensions means deciding whether "duration"
  should match every duration-bearing star, which is a relevance question, not
  a wiring one. Pointer: `searchCorpus` in `web/src/core/search.ts`.
- **Shadowed `manifest` in the renderer test.** `web/test/svgRenderer.test.ts`
  declares a module-level `manifest` and then five function-local
  `const manifest` bindings with different dimensions, so a reader cannot tell
  which one a given assertion uses without checking the scope. Rename the
  shared one.

## Data guard: the committed devotions.json actually carries descriptions

`scripts/test_parse_devotions.py`'s `description_tag` assertions sit behind an
`if records_dir.is_dir()` guard, and `just check` does not run the Python
suites at all (`test-scripts` is a separate recipe; CI runs it at `ci.yml:38`).
CI has no `extracted/`, so those assertions have never executed there. Nothing
that always runs checks that the committed `data/devotions.json` carries
constellation descriptions, which is what the app actually reads. Add a cheap
assertion to the bun suite, which always runs: load the committed JSON and
assert every constellation has a non-null `description_tag`. Pointer: the
model/data tests under `web/test/`; the Python-side check is "every
constellation has a description_tag" in `scripts/test_parse_devotions.py`.

## Base-game placeholders clobber expansion text in `load_translations`

`gd_dbr.load_translations` globs `*.txt` and merges last-writer-wins. The base
game ships placeholders for the expansion masteries (`tagSkillClassName07=?`,
`tagSkillClassName0407=` empty) and the expansion files carry the real names,
but NTFS returns `tagsgdx1_skills.txt` **before** `tags_skills.txt`, so the
placeholder wins and Infiltrator resolves to "Nightblade + ?". Found while
building `scripts/gd_save.py`, which works around it locally by never letting an
empty or `?` value overwrite a real one.

Two things to settle before changing the shared loader: whether the same
ordering bug is why `data/i18n/game.*.json` had to be hand-merged (see the
game-table staleness item), and whether any committed data currently depends on
the base-game value winning. Fixing it will change generated output, so it wants
a diff against the committed tables rather than a blind regeneration. Pointers:
`load_translations` in `scripts/gd_dbr.py`, consumers in
`scripts/build_game_tables.py` and `scripts/parse_devotions.py`, and the
placeholder-aware version in `gd_save.load_tags`.

## Extract the shared CDP client out of the grimtools scripts

`scripts/gt_star_table.ts` copies about 90 lines of CDP client verbatim from
`scripts/gt_scrape.ts` (the Chrome launch, `cleanup`, `pageWsUrl`, and the `CDP`
class), differing only in the debug port. A protocol fix or a Chrome-path change
now has to be applied twice, with nothing to remind anyone the second copy
exists.

The devotion-import plan mandated the copy on the grounds that `scripts/` are
standalone programs. That rationale does not survive contact with the repo:
`scripts/gd_dbr.py` is already a shared helper with three Python consumers, so
this codebase shares script helpers where it helps. The TS scripts simply never
had a second consumer until now.

Deferred rather than declined, deliberately: the extraction rewrites the very
region of `gt_scrape.ts` that a sibling branch also modified, so doing it before
both branches land turns a clean merge into a hand-resolved conflict. **Both have
now landed, so this is unblocked.**

Pointers: extract to `scripts/gd_cdp.ts`, mirroring `scripts/gd_dbr.py`'s role;
the block is the Chrome launch through the `CDP` class in `scripts/gt_scrape.ts`
and the matching head of `scripts/gt_star_table.ts`. Only the debug port differs,
so it should be a parameter. Find the block by name rather than by line number:
the save-reader work shifted those lines.

## `just check` does not run the script tests

`check: fmt-check test lint lint-py typecheck` leaves out `test-scripts`, so the
pre-commit hook runs none of the twelve `scripts/test_*.py` suites. Every oracle
over the extracted game data is therefore advisory: a parser change that silently
mislabels rows can be committed and pushed with a green hook. The Conduit amulet
bug (every Conduit RR row named for the Occultist amulet) shipped through exactly
that gap.

Blocked on a pre-existing failure, not on the wiring. `just test-scripts` aborts
early because `scripts/test_parse_monsters.py` has count drift against the
1.3.0.7 dataset; adding `test-scripts` to `check` today would block every commit
in the repo. Fix the monster count drift first, then append `test-scripts` to the
`check` recipe.

Note the suite is a no-op without a local game install: each test skips itself
when `extracted/records` is absent, so this gate only bites on Windows machines
that have run `just extract`. That is the same audience that regenerates the
datasets, which is the audience that needs the gate.

Pointers: the `check` recipe and the `test-scripts` recipe in `justfile`.
