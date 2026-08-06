# Devotion search and stat-label audit

Date: 2026-08-06
Status: design, approved for planning

Two pieces of community feedback from the Crate forums drive this spec. A user
reported that the planner labels `offensiveTotalDamageModifier` as "Total
Damage" when the game calls it "All Damage" (a materially different stat), and
asked for a text search field like the one the game and GrimTools have.

The wording report turns out to be one instance of a class, so this spec covers
the reported fix, an audit for the rest of the class, and the search feature.

## Part 1: the relabel

### What is wrong

`web/src/i18n/app.en.json` authors two stat nouns that disagree with the game:

| catalog key | current | game tag | game text (en) |
| --- | --- | --- | --- |
| `stat.override.offensiveTotalDamageModifier` | Total Damage | `tagDamageModifierTotalDamage` | `{%+.0f0}% {^E}to All Damage` |
| `stat.override.retaliationTotalDamageModifier` | Total Retaliation Damage | `tagRetaliationModifierTotalDamage` | `{%+.0f0}% {^E}to All Retaliation Damage` |

Thirteen constellations carry the first stat and sixteen carry the second, so
the wrong label is widely visible. In Grim Dawn "All Damage" scales every
damage type including damage over time, while "Total Damage" is an item-borne
skill modifier that devotions never grant; the two are not synonyms.

### Why these labels are app-authored at all

The game never states these nouns on their own. It ships value-embedded format
strings (`{%+.0f0}% {^E}to All Damage`) and renders them whole, which is what
GrimTools does too. The planner renders a label column and a value column
separately, so it needs a bare noun that no game string supplies.

`data/stat-format-tags.json` exists for exactly this shape, but it does not
work here: `stripValueTokens` leaves the `{^E}` colour code and the leading
connector word ("to"), and the connector is language-specific, so no generic
strip recovers a bare noun. These two keys therefore stay app-authored. That
structural gap between "how the game phrases a stat" and "what the planner
needs" is the source of the whole drift class this spec addresses.

### The change

Rewrite both keys in all thirteen `web/src/i18n/app.<locale>.json` catalogs,
taking each value from the game's own translation of the corresponding tag with
the value token, the `{^E}` colour code, and the leading connector stripped.
All thirteen languages are already extracted under `extracted/text_*`, so no
value is authored or guessed:

| locale | `offensiveTotalDamageModifier` | `retaliationTotalDamageModifier` |
| --- | --- | --- |
| en | All Damage | All Retaliation Damage |
| de | alle Schadenstypen | alle Vergeltungsschadenstypen |
| fr | tous les dégâts | tous les dégâts de représailles |
| es | todo el daño | todo el daño de contrataque |
| ru | общего урона | общего ответного урона |
| zh | 所有类型伤害 | 所有类型反击伤害 |
| pl | wszystkich obrażeń | całkowitych odbitych obrażeń |
| it | Tutto il Danno | Tutto il Danno di Ritorsione |
| cs | celkovému zranění | všem zraněním odplatou |
| ja | 全ダメージ | 全報復ダメージ |
| ko | 모든 데미지 | 전체 보복 데미지 |
| pt | Todos os Danos | Todos os Danos de Retaliação |
| vi | Tất Cả Các Loại Sát Thương | Tất Cả Sát Thương Phản Lại |

Catalog edits only: no parser change and no dataset regeneration. Russian keeps
"общего" because that is the word the game's own Russian text uses; the rule is
to follow the game, not to translate the English.

"Total Damage" appears fourteen times in
`web/test/__snapshots__/i18nCharacterization.test.ts.snap`. Those regenerate as
part of the change, and the diff should be read rather than accepted blind: it
is the clearest confirmation the relabel reached every render path.

## Part 2: the stat-label audit

### Scope

Sixty-four app-authored stat nouns: the fifty `stat.override.*` keys and the
fourteen `stat.subject.*` keys.

Deliberately excluded. `stat.attr.*`, `stat.damage.*`, `stat.dot.*`, and
`stat.resist.*` (thirty-six keys) already resolve from the game through
`data/stat-tags.json` and cannot drift. `stat.template.*`, `stat.power.*`,
`stat.group.*`, `stat.race.*`, and `stat.pet.*` are composed phrases and
section headers rather than nouns, so there is no single game string to compare
them against.

### Why this cannot be a diff

The game hardcodes the stat-id to display-tag mapping in its engine and never
ships it as data. That absence is precisely why `data/stat-tags.json` is
hand-curated, and it means an audit cannot be mechanical: there is no
authoritative answer to "which game string does stat X display as" to diff
against. The audit's job is to put good candidates in front of a human.

### What was ruled out, and why it is recorded here

GrimTools was investigated as a reference because its phrasing is what the
community expects. Findings:

- `grimtools.com/db/itemdb/l10n/en.js` is the game's own tag table verbatim.
  GrimTools has no independent vocabulary, so "match GrimTools" and "match the
  game" are the same target, and `extracted/` already holds that source.
- `grimtools.com/calc/calc.js` does carry a stat-id to tag mapping
  (`Ge={TotalDamage:"tagDamageModifierTotalDamage",...}`), which is the one
  artifact we lack. Extracting it wholesale was rejected: it is their
  reverse-engineering work, it is minified and keyed by their own normalized
  names rather than raw stat ids, and it breaks whenever they rebuild. A crude
  regex scrape yielded seventy pairs, only five overlapping our overrides, with
  both apparent mismatches being artifacts of the scrape rather than real
  errors.
- `window.dumpDevotion()` returns rendered stat lines per devotion star. This is
  the useful primitive: rendered output, comparable to ours, with no bundle
  archaeology. Two limits matter. It returns an empty array until the devotion
  panel initializes, and it reports only the stars a build has actually taken —
  55 at most, against our 559. It therefore cannot audit the full noun set from
  any number of practical captures, and is a spot check rather than a sweep.

This repository already carries the tooling: `scripts/gt_scrape.ts:217` calls
`dumpDevotion()`, `scripts/gt_audit.py` parses its output,
`docs/grimtools-build-audit.md` documents the debug helpers, and
`scripts/fixtures/gt-devotions-infiltrator.json` is a committed 55-star capture.
That fixture already contains `+50% to All Damage` and zero occurrences of
"Total Damage", which is in-repo evidence of the reported bug.

### The audit, in three steps

1. **`scripts/audit_stat_labels.py`** (uv shebang, stdlib only, matching the
   other scripts). Reads `web/src/i18n/app.en.json` and `extracted/text_en/`
   and, for each of the sixty-four nouns, prints the current label alongside
   every game tag whose stripped text shares its head noun. Report to stdout;
   no committed artifact.
2. **A GrimTools spot check against the committed fixture.** No scraping and no
   browser: diff our rendering of the 55 stars in
   `scripts/fixtures/gt-devotions-infiltrator.json` against that fixture's
   `details` text. This is an end-to-end confirmation that our labels match what
   the community reads, and it runs in CI like any other test. It covers only
   the stats that build takes, so step 1 remains the source of coverage; this
   step is a cheap check, not a sweep. `extracted/` wins any disagreement: since
   GrimTools renders the game's strings, a conflict means our tag guess was
   wrong, not that GrimTools knows better.
3. **Apply the findings.** Each confirmed mismatch resolves one of two ways,
   and the first is strongly preferred:
   - If a clean bare-noun game tag exists, move the key into
     `data/stat-tags.json` so the game supplies all thirteen translations and
     the key can never drift again.
   - Only where no clean tag exists, correct the English and hand-author the
     other twelve from the game's translation of the closest tag.

### Known risk

Step 3's volume is unknown until step 1 runs. If the audit surfaces a handful
of mismatches they land in this spec's implementation. If it surfaces dozens,
the relabel and the search still ship on schedule and the remainder becomes a
tracked `BACKLOG.md` follow-up. Scaling that down is a decision to surface, not
to make silently.

## Part 3: devotion search

### Behaviour

A text field in the right sidebar, between the Affinity panel and "Available to
get". Typing highlights matches on the map. A match count reports what was
found. Nothing is hidden, dimmed, or filtered: search only adds emphasis.

Matching is case-insensitive substring with terms ANDed. The query splits on
whitespace and an entry matches when every term appears somewhere in its text,
so a second word narrows rather than widens. An empty or whitespace-only query
matches nothing (no glow, no count line) rather than matching everything.

Granularity follows the two kinds of text:

- A hit in a **constellation's** name or description emphasizes that
  constellation (its art glows).
- A hit in a **star's** stats, celestial power, or weapon requirement
  emphasizes that star.

Neither implies the other: a constellation-name match does not light its stars,
and a star's stat match does not glow the art.

Affinities are excluded from the corpus. The affinity filter already highlights
every Chaos constellation in red on click, and a second path to the same
outcome would be redundant.

### Data change

`scripts/parse_devotions.py` reads `constellationInfoTag` alongside the existing
`constellationDisplayTag` and emits `description_tag` per constellation,
registered through the same `register(...)` path so `build_game_tables.py`
picks it up for every language. The tags exist already (constellation 05 carries
`constellationInfoTag,tagDevotion_A05Desc,`), but no constellation in
`data/devotions.json` has a description field today.

Regeneration is Windows-only: `just parse` then `just i18n-tables`. Every other
part of the search is web-side.

### Corpus

109 constellations and 559 stars. Small enough that build and match cost are
immaterial.

Constellation entry: `name_tag`, `description_tag`.

Star entry:

- its own bonus stat labels;
- its pet-bonus labels, each prefixed with the `ui.panel.petBonus` label
  ("Bonus to All Pets") so that typing "pet" matches — 93 stars have pet
  bonuses, and without the prefix none of them would match, because the pet
  rows render as bare stat labels and "pet" appears only in the section header;
- its celestial power's name, description, and stat labels (63 stars);
- its weapon requirement text (40 stars), already a `Text` on the star.

Values are not indexed. Searching "15" is not useful and would match noise.

### Architecture

Every searchable string is localized, and `core/` may not resolve text. The
split follows that boundary, mirroring how `condensedRows` builds a catalog of
`Text` once at boot that adapters resolve per render.

`web/src/core/search.ts`, pure, no `Localization` and no DOM:

```ts
export interface SearchCorpus {
  constellations: Map<string, Text[]>;
  stars: Map<StarId, Text[]>;
}
export function searchCorpus(model: DevotionModel): SearchCorpus;

export interface SearchIndex {
  constellations: Map<string, string>;  // normalized, joined
  stars: Map<StarId, string>;
}
export interface SearchMatch {
  constellations: Set<string>;
  stars: Set<StarId>;
}
export function matchQuery(index: SearchIndex, query: string): SearchMatch;
```

`web/src/adapters/searchIndex.ts` holds the single function that resolves text:

```ts
export function resolveIndex(loc: Localization, corpus: SearchCorpus): SearchIndex;
```

The index is built once at boot and rebuilt on a language switch, alongside the
existing `refresh()` call in the language picker's `onSelect`.
`web/test/i18nBoundary.test.ts` already greps `core/` for resolver use, so it
guards `core/search.ts` automatically.

Normalization is applied identically to corpus and query so the two sides cannot
disagree: lowercase, then NFD-decompose and drop combining marks. Diacritic
folding means "degats" finds "dégâts" and unaccented input finds Vietnamese
text, widening matches symmetrically rather than making one side lenient. CJK
needs no special handling: zh, ja, and ko have no spaces, so the query is a
single term and substring matching works unchanged.

### Display

`web/src/core/displayState.ts` gains `DisplaySettings.conMatch?: Set<string>`
and `ConstellationDisplay.emphasis: boolean`. This completes the existing third
channel rather than adding a fourth: the file already documents brightness,
colour, and emphasis, and `benefitMatch` was emphasis's star-level expression
with no constellation-level counterpart.

The star side is untouched. Search stars and benefit-tag stars arrive
pre-unioned in the existing `benefitMatch` set, so both sources share one glow
and the renderer needs no new star layer. The renderer-side name differs from
the core-side name (`RenderOpts.conHighlight` feeds
`DisplaySettings.conMatch`), deliberately matching the existing
`RenderOpts.highlight` to `DisplaySettings.benefitMatch` pairing rather than
introducing a second convention:

```ts
const searched = matchQuery(index, query);
handle.update({ ...,
  highlight: union(taggedStars(), searched.stars),
  conHighlight: searched.constellations });
```

`web/src/adapters/svgRenderer.ts` gains a constellation halo modelled on the
affinity halo, which already solves this exact problem (glow an art silhouette
without touching brightness or colour):

- a `#search-glow` filter built like `#aff-glow` (wide `feGaussianBlur`, stacked
  `feMerge` for alpha density) but flooded with the neutral `#e3f2ff` and
  `#6cb6ff` pair that `#match-glow` uses for star matches, so "match" reads as
  one thing at both granularities and can never be mistaken for an affinity
  colour;
- emitted only when a query is active, mirroring how `#aff-glow` and `#mute`
  are emitted only under an affinity filter;
- the halo rect reuses `ensureMask(c.id, ...)` and flushes through the existing
  `haloParts` array so it paints on top of the art, for the same reason the
  affinity halo does: a halo underneath washes bright line-art to a pastel;
- it respects brightness like the affinity halo (`HALO_UNREACHABLE_OPACITY` on
  an unattainable constellation), so reachability still reads under a search.

Both halos may stack on one constellation. Coloured plus neutral blue is
legible, and the two are independently meaningful. A search match on a
constellation the affinity filter has muted keeps its halo, wrapped in the
existing `#mute-wide` desaturation exactly as an off-filter star's benefit glow
is, so it reads as "matched, off-filter" instead of vanishing.

One targeted tidy, in scope because the signature is being touched:
`SvgHandle.update` takes five positional parameters and would become six.
`RenderOpts` is already an options object, so `update` becomes one too. There
is a single call site (`web/src/app/main.ts:708`) plus the internal `render`.

One CSS rule, `.search-glow`, alongside `.aff-glow` in `web/src/styles.css`.

### Sidebar structure

`renderAffinities` assigns `el.innerHTML` on the whole `#affinity` aside, which
would destroy and rebuild an input nested inside it on every render, losing
focus, caret, and typed text. The aside therefore splits into stable children:

```html
<aside id="affinity" class="sidebar">
  <div id="affinity-panel"></div>   <!-- re-rendered -->
  <div id="search-panel"></div>     <!-- mounted once, never re-rendered -->
  <div id="avail-panel"></div>      <!-- re-rendered -->
</aside>
```

`renderAffinities` targets `#affinity-panel`, the available-to-get HTML goes
into `#avail-panel`, and `web/src/adapters/searchPanel.ts` mounts
`#search-panel` once, updating only its count line thereafter. This also removes
the current append-after-wipe `insertAdjacentHTML("beforeend", ...)` at
`web/src/app/main.ts:722`. No CSS selector targets the sidebars by direct child,
so the wrappers are safe.

### Render paths and history

`refresh()` keeps paying the full engine cost: it calls `selectionView`, which
is the per-click cost of the reachability engine. Search must not pay it. A new
`repaint()` re-renders map emphasis, the count line, and the hash against the
cached `reach`, without touching `selectionView`. Typing calls `repaint()`.

This requires extracting the hash-writing block at `web/src/app/main.ts:763` out
of `refresh()` so both paths can call it.

`repaint()` writes with `replaceState`, so a query never adds a back-button
entry — the same mechanism the point-cap slider already uses while dragging
(`setCap(cap, urlMode)` at `web/src/app/main.ts:460`). A 120ms debounce sits on
top, purely to avoid repainting on every keystroke; the debounce is a cost
measure, not the fix for history pollution.

### URL state

`encodeHash` gains `&q=<encodeURIComponent(query)>`, emitted only when the query
is non-empty, the same way `b=` is. `decodeHash` returns `query`, trimmed and
truncated to 100 characters, tolerating any garbage without throwing, consistent
with every other param. `q` does not collide with `p`, `s`, `b`, `cs`, or `cp`.

### Localization

Five new keys in all thirteen catalogs: `ui.search.label`,
`ui.search.placeholder`, `ui.search.clear` (aria), `ui.search.count`, and
`ui.search.none`.

`ui.search.count` renders as `Constellations: 7 · Stars: 23` rather than "7
constellations, 23 stars". There is no plural machinery in the app, and Russian,
Polish, and Czech have plural rules that "1 constellations" would mangle. The
label-and-count form avoids the problem entirely and translates cleanly.

The three count-line states are distinct: an empty query shows no line at all, a
non-empty query with at least one match shows `ui.search.count`, and a non-empty
query with both sets empty shows `ui.search.none`. The last case is why the
empty state is a separate key rather than a count of zero — "no matches" is
feedback, "Constellations: 0 · Stars: 0" reads like a bug.

### Interaction

- `input` event updates the query, debounced, then `repaint()`.
- A clear button empties the query and repaints.
- Escape clears the query.
- `applyHash` restores `q=` into both the input value and the query state.

## Testing

- `web/test/search.test.ts` — corpus contents (a power-bearing star carries its
  power description; a pet-bonus star carries the pet section label) and
  `matchQuery` semantics (terms ANDed, case- and diacritic-insensitive, empty
  query yields nothing). Pure, no DOM.
- `web/test/urlState.test.ts` — `q=` round-trips; stale or malformed `q=`
  decodes without throwing.
- `web/test/appCatalog.test.ts` — the five new keys.
- A `displayState` case for `emphasis` driven by `conMatch`.
- `web/test/__snapshots__/i18nCharacterization.test.ts.snap` regenerates for the
  relabel; the diff is reviewed, not accepted blind.
- `web/test/i18nBoundary.test.ts` and `web/test/statHumanizeCoverage.test.ts`
  need no changes and should keep passing.

## Out of scope

- Filtering the "Available to get" list by the query. Search adds emphasis to
  the map only.
- A results list with click-to-focus. This would need a new focus-viewbox API in
  `navController`; the match count is the feedback mechanism instead.
- Fuzzy or typo-tolerant matching. It needs a scoring threshold that cannot be
  tuned honestly across thirteen languages and four non-Latin scripts.
- Committing any GrimTools-derived corpus or mapping as project data. The
  existing `scripts/fixtures/gt-devotions-infiltrator.json` is already committed
  and is reused as-is; no new GrimTools-derived data is added.
- Scraping additional GrimTools builds to widen audit coverage. Each build caps
  at 55 stars and is manual work, and GrimTools carries no information the
  game's own text does not.
