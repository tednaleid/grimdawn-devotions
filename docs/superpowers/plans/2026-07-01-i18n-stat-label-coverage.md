# i18n Stat-Label Coverage (Groups A + B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Eliminate every user-facing stat label that currently renders through `statFormat.ts`'s mechanical `humanize()` fallback. Two forum reporters hit this: tean101 (German passive-bonus labels) and DenisMashutikov (celestial-power crowd-control names). After this change no devotion stat id reaches `humanize()` in any rendered view, enforced by a data-driven guard test.

**Background:** An audit drove the real `classify()` over all 207 stat ids in `data/devotions.json` (containers `bonuses`, `pet_bonuses`, celestial-power `stats`, pet `attack_stats`). 47 ids structurally fall through to `humanize()`; 21 are intercepted by `formatPowerStats()` before render (skill/projectile/weapon meta lines) and are not user-visible; 26 render as raw humanized text. The 26 split into two groups handled here.

- **Group A (3 passive-bonus stats)** render on the benefits sidebar / tooltip via `classify()`:
  - `defensivePercentCurrentLife` -> game tag `DefensePercentCurrentLife` = "{v}% Resistance to Life Reduction" (DE "{v}% Widerstand gegen Lebensreduzierung"). Value-PREFIX format.
  - `defensiveConvert` -> game tag `DefenseConvert` = "{v}% Reduced Mind Control Duration" (DE "{v}% kürzere Dauer der Gedankenkontrolle"). Value-PREFIX format. (Not stun resistance; tean101 misread it. The node's stun comes from the separate `defensiveStun`.)
  - `characterHealIncreasePercent` -> game tag `tagCharHealIncreaseModifier` = "Healing Effects Increased by {v}%" (DE "Heilungseffekte erhöhen sich um {v}%"). Value-SUFFIX format.
- **Group B (23 celestial-power CC/status stats)** render on power tooltips via `formatPowerStats()`'s unhandled "rest" path: the `offensive(Stun|Freeze|Petrify|Knockdown|Confusion)` families plus `offensiveFumble*`, `offensiveProjectileFumble*`, `offensiveSlowTotalSpeed*`, `offensiveSlowAttackSpeed*`, `offensiveElementalResistanceReductionAbsolute*`, `offensivePhysicalReductionPercent*`.

**Architecture:**
- Value-PREFIX game-term stats are authoritative from the extracted tables (project invariant: game-data text resolves from extracted per-language tag tables). A new `data/stat-format-tags.json` maps the raw stat id to its game tag; `build_game_tables.py` includes those tags so `game.<lang>.json` carries them; `classify()` resolves them via `gameText`, stripping the leading value token. This localizes across all 13 languages with no hand translation.
- The value-SUFFIX heal stat cannot reduce to a clean bare label in a value+label row model (word order varies by language), so it is app-authored via the existing `OVERRIDES` + `stat.override.<id>` mechanism (the same path `defensiveStun` already uses).
- Group B reuses the crowd-control effect-name keys that `decompose()` already defines (`stat.subject.cc*`, `stat.subject.fumble`, `stat.subject.impairedAim`, `stat.subject.slowTotalSpeed`, `stat.subject.slowAttackSpeed`, `stat.subject.reducedElementalResistancesFlat`, `stat.subject.reducedPhysicalResistance`) and adds power-tooltip consolidation in `formatPowerStats()` mirroring its existing `timedDebuffs`/`abilityDebuffs` blocks, plus at most one new composed-phrase template for the chance+duration CC lines.

**Tech Stack:** Python 3 (stdlib) build script, TypeScript + Bun web, `just`. Game extraction already done (`extracted/text_*/`).

## Global Constraints

- English output for every already-correct stat stays byte-for-byte identical. `web/test/statFormat.test.ts` and `web/test/condense.test.ts` are the gate (existing assertions must not change except where a previously-humanized label is the thing being fixed).
- A value-PREFIX stat is game-sourced ONLY when its tag's cleaned English, after stripping the leading value token, is the intended bare noun, and the tag also resolves in German. Confirmed for `DefensePercentCurrentLife` and `DefenseConvert`.
- `game.<lang>.json` remains a strict function of the referenced tag set + a language text table; it never affects `devotions.json` or ids.
- Every new app string is a catalog key (never a literal) and is added to the `web/test/appCatalog.test.ts` guard.
- No locale in the URL hash; ids stay language independent.
- Two `// ABOUTME:` lines on new files; docs evergreen, no emojis/emdashes/hyperbole. Run `just check`.

---

### Task 1: Group A - the three passive-bonus stats

**Files:**
- Create: `data/stat-format-tags.json` (raw stat id -> game tag, value-prefix stats only)
- Modify: `scripts/build_game_tables.py` (include stat-format tags in the resolved set), `scripts/test_build_game_tables.py` (cover it)
- Regenerate: `data/i18n/game.<lang>.json` for all 13 languages (now include `DefensePercentCurrentLife`, `DefenseConvert`)
- Modify: `web/src/core/statFormat.ts` (game-source the two prefix stats + strip value token; app-author heal via OVERRIDES), `web/src/core/statTags.ts` or a small sibling to expose the stat-format map
- Modify: `web/src/i18n/app.en.json` (+ `app.de.json` at minimum) for `stat.override.characterHealIncreasePercent`
- Test: `web/test/statFormat.test.ts` (add cases for all three)

**Interfaces:**
- `data/stat-format-tags.json` = `{ "defensivePercentCurrentLife": "DefensePercentCurrentLife", "defensiveConvert": "DefenseConvert" }`.
- `build_game_tables.py` adds every tag value in `stat-format-tags.json` to the referenced tag set it resolves (alongside devotion `*_tag` and `stat-tags.json`).
- `statFormat.ts`: in `classify()`, before the `humanize()` fallback, `if (STAT_FORMAT_TAGS[id]) return { label: stripValueTokens(gameText(STAT_FORMAT_TAGS[id])), percent: true, sign: 1 }`. `stripValueTokens` removes leading/trailing GD value tokens (`{%.0f0}%`, ranges `{%.0f0}-{%.0f1}%`, `{%t0}%`) and surrounding whitespace; it is a no-op on bare-noun tags.
- `characterHealIncreasePercent` added to `OVERRIDES` as `{ percent: true, sign: 1 }`; `stat.override.characterHealIncreasePercent` = "Increased Healing" (EN), German authored ("Erhöhte Heilungseffekte" or the vetted term); other locales fall back to English.

- [ ] **Step 1: Write failing tests.** In `statFormat.test.ts`, assert `statRow("defensivePercentCurrentLife", 20)` -> label "Resistance to Life Reduction", value "+20%"; `statRow("defensiveConvert", 50)` -> label "Reduced Mind Control Duration", value "+50%"; `statRow("characterHealIncreasePercent", 20)` -> label "Increased Healing", value "+20%". In `test_build_game_tables.py`, assert a stat-format tag resolves into the emitted table. Run to confirm fail.
- [ ] **Step 2: Create `data/stat-format-tags.json`** with the two prefix entries.
- [ ] **Step 3: Wire `build_game_tables.py`** to union the stat-format tag values into the referenced set. Regenerate all 13 tables via `just i18n-tables` (or the EN table via `just parse` for the fast loop, then the rest). Confirm `game.en.json` now contains `DefensePercentCurrentLife` = "{%.0f0}% Resistance to Life Reduction" and `DefenseConvert` = "{%.0f0}% Reduced Mind Control Duration", and `game.de.json` the German equivalents.
- [ ] **Step 4: Implement `statFormat.ts`.** Add `stripValueTokens`, the `STAT_FORMAT_TAGS` lookup in `classify()` before `humanize()`, the heal `OVERRIDES` entry, and the catalog keys. `decompose()` standalone path picks up the corrected `classify().label` automatically; confirm the condensed view also shows the fixed labels.
- [ ] **Step 5: Run the gate.** `cd web && bun test && bunx tsc --noEmit`. English unchanged for all previously-correct stats; the three fixed stats now show real terms. Add the heal key to `appCatalog.test.ts` expectations if needed.
- [ ] **Step 6: Commit.** `feat(i18n): source Resistance to Life Reduction / Mind Control from game tags, author heal label`.

---

### Task 2: Group B - celestial-power crowd-control / status names

**Files:**
- Modify: `web/src/core/statFormat.ts` (`formatPowerStats` consolidation for the CC/status families)
- Modify: `web/src/i18n/app.en.json` (+ other locales) for any new composed-phrase template
- Test: `web/test/statFormat.test.ts` (power-stat cases for each family), `web/test/condense.test.ts` if affected

**Interfaces:**
- `formatPowerStats(stats)` gains handling for the CC/status families so their proc lines render as consolidated, localized phrases instead of raw humanized `offensive*` rows. Two facet shapes:
  1. Chance + duration effects (`offensive(Stun|Freeze|Petrify|Knockdown|Confusion)` with `Chance` + `Min`/`Max` duration): one row via a new template, e.g. `stat.power.chanceOfEffect` = "{chance}% Chance of {seconds} Second(s) of {effect}" (author to match GD's in-game phrasing; verify against the game tags before finalizing wording), using the existing `stat.subject.cc*` effect names.
  2. Magnitude + duration debuffs (`offensiveFumble*`, `offensiveProjectileFumble*`, `offensiveSlowTotalSpeed*`, `offensiveSlowAttackSpeed*`, `offensiveElementalResistanceReductionAbsolute*`, `offensivePhysicalReductionPercent*`): extend the existing `timedDebuffs` array with these families, reusing the existing subject keys and the `forSecondsSuffix` helper.
- No game-table regeneration (all app-authored vocabulary + reused keys).

- [ ] **Step 1: Enumerate facet keys per family** from `data/devotions.json` (each family's `Min`/`Max`/`Chance`/`DurationMin` keys), and confirm which existing `stat.subject.*` / `stat.power.*` keys cover the effect names. List any missing key.
- [ ] **Step 2: Write failing tests.** For a representative power of each family, assert `formatPowerStats` produces the consolidated localized row and no raw "Offensive ..." humanized label remains. Run to confirm fail.
- [ ] **Step 3: Implement** the two facet handlers in `formatPowerStats`, add the one new template key (+ translations, English authoritative), reuse existing subject keys. Keep resolution at call time.
- [ ] **Step 4: Run the gate.** `cd web && bun test && bunx tsc --noEmit`. Add the new template key to `appCatalog.test.ts`.
- [ ] **Step 5: Commit.** `feat(i18n): render celestial-power crowd-control names, not raw stat ids`.

---

### Task 3: Completeness guard + docs

**Files:**
- Create: `web/test/statHumanizeCoverage.test.ts` (data-driven guard)
- Modify: `docs/i18n.md`, `BACKLOG.md`

**Interfaces:**
- The guard walks every stat id in `data/devotions.json` (all four containers), renders it through the SAME view functions the UI uses (`groupedBonusRows`/`condensedRows` for `bonuses`/`pet_bonuses`, `formatPowerStats` for `stats`/`attack_stats`), and asserts no produced label is a raw `humanize()` output. It excludes the coincidental attribute renames structurally (an id that resolves via a family is not a fallthrough) and excludes ids intercepted by `formatPowerStats` because it checks the rendered path, not raw `classify()`. After Tasks 1-2 the visible-humanize set is empty; the test fails if a future devotion reintroduces one.

- [ ] **Step 1: Port the audit's structural detection** (family resolution + formatPowerStats interception) into the test and assert the visible-humanize set is empty. Run: must pass after Tasks 1-2.
- [ ] **Step 2: Sanity-check** by temporarily removing one Task 1/2 fix locally and confirming the guard fails (then restore). Document the check in the commit message, do not commit the removal.
- [ ] **Step 3: Docs.** `docs/i18n.md`: document `data/stat-format-tags.json` (fourth artifact), the value-token strip, the celestial-power CC handling, and the coverage guard. `BACKLOG.md`: note (a) the remaining ongoing work - AI-translation quality correction; (b) the optional bounded pass aligning our authored English stat labels to exact game terms (e.g. `defensiveStun` "Reduced Stun Duration" vs game "Stun Resistance"); (c) that a value-suffix stat (heal) is app-authored and could be upgraded to full game-templated rendering if a templated-row shape is added; (d) the language picker (Group C) remains separate.
- [ ] **Step 4: Commit.** `test(i18n): guard that no devotion stat renders via humanize; docs`.

---

## Self-Review

- Every user-visible `humanize()` fallthrough (26 sites) addressed: Group A (Task 1), Group B (Task 2). Guard locks it (Task 3).
- English identity preserved for already-correct stats: statFormat/condense gates unchanged (Tasks 1, 2).
- Game-data stats sourced from extracted tables per invariant; only the value-suffix heal is app-authored, justified: Task 1.
- Group B reuses existing `stat.subject.*` keys (DRY), adds at most one template: Task 2.
- Guard is data-driven so new expansion content cannot silently reintroduce gibberish: Task 3.
- Out of scope, recorded in BACKLOG: language picker (C), AI-translation quality, authored-English-vs-game-term alignment.
