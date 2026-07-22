# Resistance Reduction Extraction Pipeline

Point-in-time design record. Dated 2026-07-21. This is sub-project 1 of a
three-part resistance-reduction (RR) initiative:

1. **RR extraction pipeline** (this spec) - a re-runnable script that sweeps the
   game extraction and emits a committed, localizable catalogue of every source
   of enemy resistance reduction.
2. **`/resistance-reduction` UI page** (separate later spec) - a mechanics primer,
   a filterable/sortable source table, and a live "debuff ledger" that resolves
   final enemy resistance per damage type, consuming the dataset this pipeline
   produces and conforming to the app's i18n and shareable-URL invariants.
3. **Monster resistance survey** (BACKLOG.md) - a re-runnable survey of enemy
   `defensive<Type>` resistances, built after the page ships.

The trigger for this work was a standalone prototype (an in-desktop Claude
artifact, saved at `.llm/grim-dawn-rr_1.html`) whose logic is sound but whose
data was hand-assembled from wiki/forum posts, roughly a third of it flagged
unverified. We have the authoritative game extraction the prototype lacked, so
the goal is to replace its ~33 hand-sourced rows with a complete catalogue read
directly from the `.dbr` records.

## Goals

- Emit `data/resistance-reduction.json`: a complete, mechanical catalogue of every
  player-reachable source of enemy RR, extracted from the extracted `.dbr`
  records - no memory, no community numbers.
- Be **re-runnable**, exactly like the devotions parser: a new game version
  (Fangs of Asterkarn / Berserker, and its new items and balance tweaks) is
  picked up by re-running the script, not by editing data by hand.
- Emit **localizable** text (tag keys resolved through the per-language tag
  tables, English fallback), never hardcoded strings, so the downstream page can
  honor the i18n invariant.
- Carry provenance: every row cites the `recordPath` it came from, and the run
  emits a summary (counts, exclusions with reasons, an "unsure" list) so
  "authoritative" is auditable.

## Non-goals

- The UI page (sub-project 2) and the monster survey (sub-project 3). This spec
  stops at the committed dataset and its summary.
- Modelling the *resolution math* (stack -> mult -> flat, sign-aware). That is the
  ledger's job on the page; the pipeline only classifies and records sources.
- Monster-only ability records (player-irrelevant). Excluded, but counted in the
  summary. Monster-infrequent *items* are in scope (they are player-usable).
- Exhaustive overcap/ultimate-rank modelling that depends on total +skills. We
  record the base per-rank array and the ultimate/overcap rank where the record
  defines one; we do not estimate soft-cap outcomes.

## Step 0: the field vocabulary (established empirically)

Calibrated against known exemplars read from the records, not from memory. The
three RR types map to three distinct `.dbr` field families:

| RR type | In-game text | `.dbr` field family | Exemplar confirmed |
|---|---|---|---|
| **Multiplicative** (single highest applies) | `X% Reduced target's Resistance` | `offensive<Type>ResistanceReductionPercentMin` (+ `...DurationMin`, `...Chance`, `...XOR`, `...Global`) | Viper (`skills/devotion/tier1_13d.dbr`): `offensiveElementalResistanceReductionPercentMin` = 20, duration 3s |
| **Flat** (single highest applies) | `X Reduced target's Resistance` | `offensive<Type>ResistanceReductionAbsoluteMin` (+ same siblings) | Break Morale (`skills/playerclass01/warcry2.dbr`): `offensivePhysicalResistanceReductionAbsoluteMin` array -> 45; Elemental Storm (`skills/devotion/tier2_01c_skill.dbr`): `offensiveElementalResistanceReductionAbsoluteMin` array -> 32 |
| **Stacking** (additive, unlimited) | `-X% [type] Resistance` | **a negative `defensive<Type>` value** (bare, per-type) or the `defensiveElementalResistance` aggregate, on an enemy-facing debuff/modifier record | Night's Chill modifier (`skills/playerclass04/veilofshadows2.dbr`): `defensiveCold` / `defensivePierce` / `defensivePoison` / `defensiveLife` = -3 ... -35; Vulnerability (`skills/playerclass03/curse2.dbr`) and Aura of Censure (`skills/playerclass07/auracensure1_buff.dbr`): `defensiveElementalResistance` = -3 ... -35 |

The stacking family reuses the **same bare `defensive<Type>` field name that
monster records use for their own resistances** (positive on a creature = has
resistance; negative on a debuff/modifier = reduces the target's). It has two
naming forms that both occur: bare per-type (`defensiveCold`, `defensivePoison`,
`defensiveLife`, ...) and the elemental aggregate `defensiveElementalResistance`.
An earlier draft of this spec named it `defensive<Type>Resistance` and counted 62
records; that only matched the elemental aggregate and missed every per-type
source. The true population is characterized below.

`<Type>` -> resistance mapping (kept distinct; **not** expanded downstream):

- Stacking `<Type>` tokens seen (bare `defensive<Type>`): `Physical`, `Pierce`,
  `Fire`, `Cold`, `Lightning`, `Poison` (-> "Poison & Acid"), `Aether`, `Chaos`,
  `Life` (-> "Vitality"), `Bleeding`; plus the `defensiveElementalResistance`
  aggregate -> `Elemental`.
- The offensive-reduction families (flat + multiplicative) only ever carry three
  `<Type>` tokens across the whole extraction: `Total` (1103) -> `All`,
  `Elemental` (16), `Physical` (6). There is **no** per-single-element or exotic
  flat/multiplicative RR; those types only appear in the stacking family. Record
  this constraint - it bounds the flat/mult sweep to three field names per suffix.
- `Total` -> `All` resistances; `Elemental` -> Fire, Cold, Lightning (an
  "elemental" marker, expanded by the consumer, never pre-expanded here).

### The stacking family is the only hard part

The stacking type reuses the same bare `defensive<Type>` field name the game uses
to *grant* resistance to players, pets, and monsters - hundreds of positive,
irrelevant occurrences. The negative sign filters the population to a bounded,
inspectable set. Characterized from the extraction: **280 skill records** carry a
negative `defensive<Type>` (per-type or the elemental aggregate), and the
template name classifies them:

- `skillbuff_debuf` (109) / `skillbuff_contageous` (21) / `skillbuff_debuftrap`
  (5) / `skillbuff_debuffreeze` (4) -> enemy-facing debuffs = real RR.
  **Include** (139 records).
- `skill_modifier` (136) -> adds RR onto a parent skill (Night's Chill and
  Vulnerability are these). **Include iff the modified parent resolves to an
  enemy-facing debuff/aura** (Veil of Shadow's toggled aura is; a self-buff
  parent is not).
- `skill_buffselfduration` (3) -> self-applied. **Exclude**, recording the record
  path and reason in the summary (do not silently drop).
- `skillbuff_passive` (1) and `monster.tpl` (1) -> edge cases; inspect and either
  classify or include-with-a-note.

Any negative-defensive record that does not fit these buckets is **included with
a note** rather than guessed at or dropped, per the rigor rules below. The
`skill_modifier` bucket (136) is the largest and needs parent resolution: a
modifier's RR is real only when it modifies an enemy-facing skill, so the sweep
must resolve each modifier to the skill it augments (the parent references the
modifier via `modifierSkill*` / the skill tree wiring; resolve during build).

## Architecture

A new stdlib-only `uv` script `scripts/parse_rr.py`, mirroring
`scripts/parse_devotions.py`. The two share machinery; rather than copy-paste,
lift the reusable primitives out of `parse_devotions.py` into a small shared
module (`scripts/gd_dbr.py` or similar) and import from both:

- `read_dbr(path)` - parse a `.dbr` into a `{field: value}` dict.
- `load_translations(text_dir)` - build the tag -> display-text table for a language.
- `register(key, text, table)` / `clean_text` - the localizable-string pattern
  (resolve a game tag when present, else synthesize a stable key), so RR names
  and parents are emitted as tag keys with fallback text, not baked English.
- `level_array_value` / per-rank array parsing - RR values are per-rank arrays.
- The skill-chain walkers (`power_skill_chain`, `extract_proc`, buff/pet
  resolution) - RR frequently sits on a referenced sub-skill, not the top-level
  skill (Night's Chill carries no RR field itself; it rides a referenced buff).

Refactoring `parse_devotions.py` to extract these helpers is in scope for this
sub-project, but must be behavior-preserving: `just parse` must produce a
byte-identical `data/devotions.json` before and after. Guard it by regenerating
and diffing as part of the work.

### Sweep and classify

1. **Skills sweep** (`records/skills/**`): for every record, detect the three
   field families above. For the stacking family, apply the negative-sign +
   template-name filter and the `skill_modifier` parent resolution. Follow
   skill/proc/buff/pet chains so a modifier or granted skill is attributed to the
   right displayed source.
2. **Devotions**: devotion proc skills live under `records/skills/devotion/**`
   and are covered by the skills sweep; category is assigned from the record path
   / constellation linkage.
3. **Items sweep** (`records/items/**`): components, augments, relics, sets, and
   item **skill-modifiers**. Item-granted RR resolves through the item's
   granted-skill reference into a skill record (then classified as above). An
   item skill-modifier that adds RR onto an existing skill is emitted as its own
   row, naming the modified skill in `notes` (per the prototype's convention;
   exemplars seen under `skills/itemskillsgdx1/skillmodifiers/...`).
4. **Exclusions**: monster-only ability records are skipped and counted;
   monster-infrequent items are included.

### Category assignment

`category` is one of: `mastery skill`, `modifier`, `transmuter`, `devotion`,
`component`, `augment`, `item granted`, `item skill modifier`, `relic`,
`set bonus`, `monster infrequent`. Derived from the record's template/class and
its path (e.g. `skills/devotion/**` -> devotion; transmuters carry the
transmuter template; item categories from the item record type).

## Output schema

`data/resistance-reduction.json`: a top-level object with a `meta` block (game
version + generation stamp, sourced the same way the devotions parser reads
them; whether Berserker / Fangs records are present in this extraction) and a
`sources` array. Each source:

```
id                    stable id derived from the record path
name                  localizable: { key, en } resolved via the tag tables (fallback pattern)
parent                localizable: mastery / constellation / item / set name
recordPath            full dbr path - the citation
category              one of the category values above
rrType                "stacking" | "reduced-percent" | "reduced-flat"
resistances           ["Fire","Cold",...] | "Elemental" | "All" (kept distinct, not expanded)
valuesPerRank         full per-rank array from the record
maxRank               base max rank
ultimateRank          ultimate/overcap rank if the record defines one, else null
valueAtMax            value at max base rank
valueAtUltimate       value at ultimate/overcap rank, else null
durationSeconds       from *DurationMin, else null
cooldownSeconds       from the triggering parent skill/proc, else null (may land in notes)
triggerChancePercent  proc chance if any, else null
trigger               classified: passive aura | on attack | on crit | on being hit |
                      granted active | pet aura | field/trap | transmuter change
perResistanceValues   optional: split values when a source differs by type
                      (e.g. Rumor -23% Cold / -30% Poison) - null when uniform
notes                 anything odd: weapon-damage scaling, shared pet debuff,
                      transmuter interaction, ambiguity, value conflicts
```

`rrType` uses the prototype's vocabulary (`stacking-percent` there = `stacking`
here; `reduced-percent` = multiplicative; `reduced-flat` = flat). The consumer
(page ledger) handles Elemental/All expansion and the stack -> mult -> flat
resolution.

## Rigor rules (from the research prompt, adopted)

1. **Never fill a value from memory.** Every number comes from a field that was
   read. An ambiguous record is included with a `notes` explanation rather than
   dropped or guessed.
2. An item that **modifies a skill's RR** is its own row with the delta value,
   naming the modified skill in `notes`.
3. `Elemental` and `All` stay distinct from listed single resistances - never
   pre-expanded; the consumer expands them.
4. Record the game/database **version string** and whether Berserker / Fangs of
   Asterkarn records exist in this extraction, in `meta`.
5. The run prints a **summary**: counts per `rrType` and per `category`, the
   Step 0 field mapping, records excluded (with reasons), and an "unsure" list.

## Verification (authoritative is the whole point)

- **Cross-check vs. the prototype's 33 rows.** Produce a diff explaining every
  delta - our record-read value vs. their community number - so we know the
  catalogue covers at least the prototype's set and understand each discrepancy.
- **Guard test** pinning a handful of exemplars so a future extraction can't
  silently regress the field mapping, covering both stacking naming forms: Viper
  multiplicative Elemental 20%, Break Morale flat Physical array -> 45, Elemental
  Storm flat Elemental array -> 32, Vulnerability stacking `defensiveElemental
  Resistance` array -> 35, and Night's Chill stacking bare per-type
  (`defensiveCold`/`defensivePierce`/`defensivePoison`/`defensiveLife`) array ->
  35. Mirrors the existing data guard tests.
- **Devotions parity**: `data/devotions.json` is byte-identical before and after
  the shared-helper refactor.
- **Re-runnable check**: running the script twice on the same extraction produces
  an identical `data/resistance-reduction.json` (deterministic ordering).

## Justfile / wiring

- New `just parse-rr` recipe (mirrors `just parse`), stdlib-only `uv`.
- Fold `data/resistance-reduction.json` freshness into whatever regen/doctor flow
  the devotions dataset uses, so the Fangs drop is a single re-run.
- The committed JSON is the source of truth; the page (sub-project 2) copies it
  into `web/dist/data/` at build time, exactly like `devotions.json`.

## Open questions to resolve while building (do not change the architecture)

- **Cooldown / proc-chance sourcing.** These live on the triggering parent skill
  or devotion proc, not on the RR record, so some require chain-walking and a few
  may legitimately land in `notes` rather than a clean field.
- **Full item skill-modifier surface.** The pattern is clear from the
  `itemskillsgdx1/skillmodifiers/...` exemplars, but the complete set is not yet
  enumerated; the sweep must find them all, and the summary's counts are how we
  confirm coverage.
- **Poison vs. "Poison & Acid" and Life vs. Vitality naming.** Normalize the
  emitted resistance labels to the page's vocabulary (the prototype uses
  "Poison & Acid" and "Vitality"); decide the canonical labels here and record
  the mapping.
