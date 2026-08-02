# Item query CLI

`scripts/gditems.py` queries the derived Grim Dawn item database
([docs/item-schema.md](item-schema.md)) from the command line: `search` ranks
candidates against build criteria, `show` prints everything known about one
item, and `vocab` lists every valid token so a caller composes real flags
instead of guessing at spelling. It is standalone: a uv-shebang script that
reads only `data/derived/` and `data/deposit/` through DuckDB, touching
neither the game files nor the network.

```
uv run scripts/gditems.py search --domain augment,component --fits chest \
  --resist pierce --source vendor,crafted --limit 10
```

or via the justfile passthrough:

```
just items search --domain augment,component --fits chest --resist pierce
```

## Directory resolution

`--derived-dir` and `--deposit-dir` resolve independently, each: the explicit
flag, else `GDITEMS_DERIVED_DIR` / `GDITEMS_DEPOSIT_DIR`, else a repo-relative
default computed from the script's own location (`data/derived`,
`data/deposit`). Both are always passed explicitly to the repository, so
moving one directory never silently pulls the other from its own fallback.

A missing `data/derived` prints exactly one line and exits 2:

```
data/derived not found. Run: just fetch-deposit
```

## `vocab`

Prints every valid token for every flag: domains, gear types, slots,
rarities, expansions, stat families, conversion types, masteries, skills, and
granted skills, as spelled in the data. Call this before composing `search`
flags - a mistyped token otherwise either fails (for validated flags) or, for
anything not caught, produces a result indistinguishable from a genuine
absence of matches. Conversion types are capitalized in the data (`Pierce`,
`Fire`, `Aether`, ...), not lowercase.

`--json` prints the same categories as structured data. Skill and mastery
names that resolve to no display name are left out of `vocab`'s lists (they
are reachable only by record path, see "Name resolution" below), so what
`vocab` shows is exactly what a caller can type as a bare name.

## `search`

Flags fall into three groups.

### Scope (narrows the candidate set, does not score)

| flag | meaning |
| --- | --- |
| `--domain` | Comma-separated: `gear`, `augment`, `component`, `relic`, `blueprint`, `quest`, `affix` |
| `--slot` | Comma-separated slot tokens |
| `--gear-type` | Comma-separated gear-type tokens |
| `--rarity` | Comma-separated rarity tokens |
| `--expansion` | Comma-separated expansion tokens |
| `--all-tiers` | Score every tier of a family separately, not just the strongest usable one |
| `--source` | Comma-separated: `vendor`, `crafted`, `unknown` |
| `--fits` | A gear-type token an augment/component must apply to |
| `--level N` | Excludes anything whose `req_level` exceeds N; also selects which tier of a family is shown |

### Criteria (both filter and scored dimension)

| flag | meaning |
| --- | --- |
| `--stat FAMILY[:MIN]` | Repeatable. A stat family, optionally with a minimum, e.g. `damage.pierce:20` |
| `--resist TYPE` | Comma-separated resist types, sugar for the `resist.<type>` stat family, e.g. `pierce` |
| `--converts-to TYPE` | Damage-type conversion target, e.g. `Pierce` (see `vocab`'s `conversion_types` for the exact spellings; they are capitalized) |
| `--min-convert N` | Minimum conversion percentage; requires `--converts-to` |
| `--grants-skill` | Comma-separated skill names or record paths (outright grants) |
| `--boosts-skill` | Comma-separated skill names or record paths (skill bonus) |
| `--boosts-mastery` | Comma-separated mastery names or record paths |
| `--mastery` | Comma-separated mastery names or record paths; union of boosting the mastery outright and boosting any skill within it |

A criterion with no minimum (a bare `--stat damage.pierce`, `--resist`, or any
of the skill/mastery flags) still scores every candidate, including those
that miss it entirely at zero, rather than excluding them - that is what lets
a strong partial match outrank a weak complete one. Only `--stat FAMILY:MIN`
and `--converts-to` with `--min-convert` filter the candidate set.

### Output

| flag | meaning |
| --- | --- |
| `--limit N` | Result count (default 20) |
| `--json` | Structured JSON instead of a table |
| `--explain` | Print the per-criterion score arithmetic |
| `--weights` | Comma-separated `name=weight` pairs; names must match a criterion the query actually scores, e.g. `stat:resist.pierce=2.0`. A skill or mastery may be named either the way `--explain` prints it (`boosts_skill:Chilling Rounds`) or by its record path; both resolve to the same criterion. An unrecognised name exits non-zero with a near-match suggestion rather than being silently ignored. `--json` echoes the effective map under `"weights"` so a caller can confirm what was applied. |
| `--open N` | Open the Nth result's grimtools page in a browser |

`--json` and the table render the identical query - both are built from the
same scored list, so they can never describe a query differently.

Every result carries its `domain` (`gear`, `augment`, `component`, `relic`,
...) in both modes. A search spanning several domains needs it: an augment
and a component are acquired and slotted differently, and nothing else in the
row separates them.

### Criterion labels

A criterion is labelled `<kind>:<target>`. Skill and mastery criteria match
on a record path internally, but both the table and `--explain` print the
display name instead, so asking for `--boosts-skill "Chilling Rounds"` reads
back as `boosts skill Chilling Rounds` rather than
`boosts skill records/skills/playerclass07/wpattack02.dbr`.

A record with no display name in the game data keeps its record path. 46 of
the 245 boost targets are genuinely nameless (hidden buff-carrier records
carrying no `skillDisplayName` fact at all, for example
`records/skills/playerclass01/cadence3.dbr`); a name derived from the file
stem would assert one the game does not have.

In `--json` each scored part carries both forms: `name` is the record-keyed
label (the `--weights` key, and what `unmatched_criteria` names), and
`display` is the readable form beside it.

## Result model

One result is one item family (`entities.group_key`), not one record: a
family is the same item across its several tiers. The tier shown is the
strongest one usable at `--level`, or the strongest that exists when no level
is given. `--all-tiers` scores every tier separately instead.

**The tier ladder shows real item levels, not the words "base", "Empowered",
or "Mythical".** Those are grimtools' own display convention and Grim Dawn
terminology for specific in-game upgrades; the derived data does not carry
them - `is_empowered` is `False` on all three tiers of Sellecor's March, a
plain Rare item, exactly as it is on any single-tier item. Asserting those
words from tier position alone would be false for the common case: 208
two-tier and 583 deeper Rare families exist that carry no such upgrade at
all. A multi-tier result's table line reads:

```
   tiers: 65 / 90 (showing 90)
```

listing every tier's item level ascending, with "(showing N)" marking which
one the row above is scored against.

Every result carries a grimtools deep link (see "grimtools links" below).

**`search` never returns a record with no display name.** 944 entities in the
derived data (742 affix, 192 gear, 5 augment, 5 blueprint) resolve to an
empty name - internal templates, not real items - and a grimtools link built
from an empty name matches every item at that item level instead of
isolating one. `search` excludes them outright; `show` still resolves one
directly by its own record path, since inspecting one on purpose is
legitimate even though recommending one never is.

## Name resolution for skill and mastery flags

`--boosts-skill` and `--mastery` resolve names against the skills a mastery
*boosts* (`boosts.target`, 245 records, 199 with a display name).
`--grants-skill` resolves against skills an item outright *grants*
(`relations.dst` where `kind = 'grants_skill'`, 724 records, 616 named).
`--mastery` and `--boosts-mastery` resolve against masteries (9 records, all
named). Each flag reads only the vocabulary key that belongs to it - never
another flag's - because `skills` and `granted_skills` share nine display
names (Canister Bomb, Overguard, Panetti's Replicating Missile, Phantasmal
Blades, Rebuke, Storm Surge, Stun Jacks, Wind Devil, Flashbang) that point at
different records in eight of those nine cases. Resolving a bare name against
the wrong key would silently land on the wrong item's skill.

A raw `records/...` path is always accepted directly, unresolved against any
vocabulary map. This is the only way to address the 46 skill records and 108
granted-skill records that carry no display name at all.

An unrecognised token exits non-zero, naming near matches computed from that
flag's own vocabulary only:

```
$ scripts/gditems.py search --mastery nightblad
ERROR: 'nightblad' is not a known token for --mastery. Did you mean: Nightblade?
```

A name shared by more than one record within one vocabulary key (real for
`granted_skills`: a base skill and its legendary/rune variant commonly share
one display name) is disambiguated to `"name (record)"` for each record that
shares it, so nothing is silently dropped; if the caller's bare name is still
ambiguous after that, the CLI lists every candidate and exits non-zero rather
than guessing.

## `show`

Prints full detail for one item: stats, skill/mastery boosts, granted
skills, conversions, set membership, source, and the tier ladder.

```
scripts/gditems.py show "Titan Plating"
scripts/gditems.py show records/items/materia/compb_titanplating.dbr
```

Accepts either an exact display name or an `entities.record` path.
**Display names are not unique.** All three tiers of Sellecor's March share
the single name "Sellecor's March", and names also collide across unrelated
families - a Massacre relic and an unrelated Massacre two-handed axe both
match the bare name "Massacre". `show` never guesses which one was meant: on
more than one match it lists every candidate and exits non-zero.

```
$ scripts/gditems.py show "Sellecor's March"
ERROR: 'Sellecor's March' matches more than one item:
  records/items/gearfeet/c103_feet.dbr  (item level 30)
  records/items/gearfeet/c106_feet.dbr  (item level 65)
  records/items/gearfeet/c109_feet.dbr  (item level 84)
```

Pick a candidate by its record path to resolve unambiguously. The tier ladder
`show` reports is always the resolved item's own family (`group_key`), never
every record that merely shares its display name - the Massacre relic's
ladder holds only its own level, not the unrelated axe's tiers.

`--json` emits the identical information as structured data, including the
ambiguous-match candidate list on stderr, so an agent never has to parse
prose.

## Honesty rules

These hold in every mode, table and JSON alike, because their failure mode is
a confident wrong answer.

- **The score reflects only the criteria you passed.** It ranks candidates
  and does not judge builds. Every table and JSON result repeats this line
  verbatim.
- **Source is thin for gear specifically, and `unknown` is not a world
  drop.** `source` renders as `vendor`, `crafted`, or `unknown`. `unknown`
  means unattributed in the current data, nothing more - it is never
  rendered or described as a world drop. Measured against build 24346246,
  augments (97.9%), relics (96.7%), and components (78.5%) are well
  attributed. Gear is not: only 7.8% of gear records carry any source row,
  and affixes carry none at all (0%). Gear is exactly the domain a player
  most wants to know how to farm, and this data cannot answer that for 92%
  of it. Farmability and monster-infrequent affix applicability both
  wait on the reverse loot-table graph, out of scope here and tracked as its
  own initiative (see [BACKLOG.md](../BACKLOG.md)); `source` is designed so
  that work resolves more items automatically, without changing this CLI's
  interface.
- **A criterion matching nothing is reported by name**, not folded into a
  silent empty result. `unmatched_criteria` (both renderers) names every
  scored criterion that no candidate in the pool satisfies at all, computed
  before `--limit` truncates the pool, so a criterion nobody can satisfy is
  never confused with a query that is merely narrow:

  ```
  Unmatched criteria (matched nothing in the pool): damage.pierce
  ```

  Read this before concluding a query found nothing: the difference between
  "no item satisfies all of this" and "one of your criteria is impossible"
  changes what to try next.

## grimtools links

Every `search` result carries a grimtools deep link, built from the item's
name plus its exact item level. `show` carries one too, except for a
nameless record (see "Result model" above) - there is no name to link by, so
`show` reports no link rather than a degenerate one that matches everything.

grimtools item ids are internal to that site and cannot be derived from game
data, so the link pins an item by name and level instead: verified live, a
name-only advanced-search query for Sellecor's March returns all three
tiers, while name plus item level 30 returns only the base tier, name plus
item level 84 only the Mythical tier. This usually isolates one record but
not always: a name-and-level collision across unrelated families (Ulgrim's
Keepsake, two quest-item families both at item level 1) or a duplicated
level within one family (Obsidian War Cleaver's ladder is 30 / 30 / 40 / 55
/ 70 / 84 / 94) both resolve more than one record on grimtools.

## Errors

An unrecognised token for any vocabulary-backed flag (`--domain`, `--slot`,
`--gear-type`, `--rarity`, `--expansion`, `--source`, `--fits`, `--stat`,
`--resist`, `--converts-to`, and the skill/mastery flags) exits non-zero and
names near matches from that flag's own vocabulary. `--min-convert` without
`--converts-to` also exits non-zero, since alone it is a silent no-op rather
than a criterion. `--weights` names an unrecognised criterion the same way,
against the criteria the query actually scores. A missing `data/derived`
prints the one fixed line above and nothing else. `--open N` past the number of results actually returned
fails with the range rather than opening nothing:

```
ERROR: --open 5 is out of range: 2 result(s)
```

All error paths exit non-zero so a calling script or agent notices.

## Worked examples

A skill/damage-conversion build question:

```
scripts/gditems.py search --mastery Nightblade,Inquisitor --converts-to Pierce \
  --boosts-skill "Amarasta's Blade Burst" --level 70 --json
```

A modifier-slot question:

```
scripts/gditems.py search --domain augment,component --fits chest \
  --resist pierce --source vendor,crafted --limit 10
```

Ranks Titan Plating first (24 pierce resistance, `source: crafted`), followed
by Spellscorched Plating, Silk Swatch, and the rest of the chest-fitting
pierce-resistance pool.
