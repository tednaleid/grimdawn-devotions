# Monster resistances

How the Monster Resistances page derives each row's displayed resistances from the
extracted game records, and how that is kept in parity with grimtools.com, the
reference players compare it against. The implementation is
`scripts/parse_monsters.py`, which writes `data/monsters.json`; the page reads it
through `web/src/monsters/core/model.ts`.

## What a row is

A row is one `(display name, classification)` group of creature records, collapsed
to a single representative. Grim Dawn stores the same logical monster as several
`.dbr` records (tier variants, `_summon` phases, per-difficulty copies); the parser
groups records that share a name and classification, then splits that group into
subgroups whose combined resistances agree, so a subgroup's representative states a
value that is true of every record behind it. The representative of each subgroup is
the record with the highest `maxLevel`, then the highest `minLevel`, then the
lexicographically lowest path, so a run is reproducible.

Splitting can leave two or more rows that share name, classification, and role, for
example a scripted-event copy of a monster that granted an extra resistance and a
plain copy that did not. Those rows carry a 1-based `variant_index` and the page
labels them "(variant N)"; the record path behind each is shown as that label's
tooltip.

## The formula

What the page displays for a monster at a given difficulty and player count is:

```
displayed = inline + resident passive grants + difficulty offset
```

`inline` is the `defensive<Type>` field on the creature record itself. Resident
passive grants come from the monster's own skills (see below) and are folded into
`resistances` in `data/monsters.json`, so they are always present. The difficulty
offset is a flat, monster-independent bonus added per difficulty and player bracket
(`difficulty_offsets` in the dataset, computed by `difficulty_offsets()` in the
parser); it does not rescale a monster's own resistance, it adds to it. Ascendant is
not a fourth difficulty in the records: it is Ultimate plus a flat adjustment layered
on top (on game version 1.3.0.8 that adjustment is zero for every resistance, so
Ascendant reads identically to Ultimate; the page states this only while the two
rows actually agree, never as an assertion).

Aura grants (see below) are computed and carried on the row (`aura_resistances`) but
are excluded from `displayed` by default, since they are conditional. The page's
"include auras" toggle adds them in; `effective()` in `web/src/monsters/core/model.ts`
is the single place that combines base, offset, and (optionally) aura.

## Skill ranks

A monster's `skillName<n>` reference carries its own rank, `skillLevel<n>`, which
selects the entry from that skill's per-level arrays. `skillLevel<n>` is either a
plain number or an equation of `charLevel` (for example `charLevel/4+1`). The parser
evaluates that equation at monster level 100, grimtools' default, then floors the
result and takes at least 1, since the game does the same. `eval_level_expr()` walks
the parsed expression against a whitelist of numbers, `charLevel`, `+ - * /`, and
parentheses, and never calls `eval`, so a malformed record cannot execute code.

An equation the evaluator does not recognize is read as rank 1 rather than
discarded, and is recorded in `UNPARSED_SKILL_LEVELS`; the parser summary warns
about it by expression and count. On game version 1.3.0.8 one such equation exists:
`charlevel/4+1` (lowercase `charlevel`) in `witchgodguardian_solael.dbr`. It has no
effect on that monster's displayed resistances.

## Resident versus conditional classes

Whether a skill's resistance grant is folded into a monster's permanent
`resistances` or reported separately as conditional depends on the skill record's
`Class`:

- **Resident** (`SELF_PASSIVE_CLASSES`): `Skill_Passive`,
  `Skill_PassiveDualWieldWeapon`, `Skill_Mastery`. Always on; grimtools treats the
  same three classes as permanent, which is why the page matches it.
- **Conditional / aura** (`AURA_CLASSES`): `Skill_BuffSelfDuration`,
  `Skill_BuffSelfToggled`, `Skill_BuffAttackRadiusToggled`, `SkillBuff_Passive`,
  `Skill_PassiveOnLifeBuffSelf`. grimtools shows these only behind its own buff
  toggles, so here they are recorded but excluded by default.

A toggled or radius buff often carries no `defensive<Type>` field of its own; its
grant lives on a child record it applies through `buffSkillName`. Which bucket a
hop grant lands in still follows the host skill's own class, the same as an inline
grant: a host in `SELF_PASSIVE_CLASSES` buckets it resident, a host in
`AURA_CLASSES` buckets it conditional, and only a host in neither set sends its hop
grant to conditional by default (`BUFF_CHILD_CLASSES` lists which child classes are
read this way). The `SkillBuff_Debuf` family is never read here:
its negative values are resistance reduction applied to a player, which belongs to
the Resistance Reduction ledger, not to a monster's own resistance.

## grimtools parity

The parity check (`scripts/test_monster_parity.py`, run with `just monster-parity`)
compares `data/monsters.json` against `scripts/fixtures/gt-monster-resistances.json`,
a fixture of grimtools' own displayed resistances for every Boss, SuperBoss, and
nemesis entry (62 entries on grimtools game version 1.3.0.8). The fixture is
harvested at grimtools' default: monster level 100, 1 player, buff toggles off, so
its offsets and level convention match this page's. Refresh the fixture with
`bun scripts/gt_monster_harvest.mjs` only when grimtools shows a newer game version;
it drives grimtools' own minified stat routine in a headless browser rather than
reimplementing it, so the fixture always records what a player actually sees on the
site.

## grimtools links

Each row's name links to its grimtools monsterdb page for the selected difficulty
where a match exists. `data/grimtools-monsters.json` holds that mapping, regenerated
by `scripts/gt_monster_links.ts` (`just gt-monster-links`); the matching rule
(`matchLinks` in `web/src/monsters/core/grimtoolsLinks.ts`) groups grimtools entries
by name tag and classification, then within a difficulty prefers the candidate whose
inline resistances equal the row's own, breaking ties on the lowest id. The script
fetches grimtools' public `monsterdb.js` with a browser User-Agent, since Cloudflare
rejects a custom one, and evaluates it in-process with `node:vm`; this is not a
security boundary, so running the script trusts that grimtools asset. A row with no
match renders as plain text. Re-run `just gt-monster-links` after regenerating
`data/monsters.json`, since the link table is keyed on this page's row ids and
inline values. The page loads the link file fail-soft (`loadGrimtoolsLinks` in
`web/src/monsters/adapters/dataSource.ts`): a deploy missing it still renders every
row, unlinked.

## Sources

Worked examples, both cross-checked against grimtools 1.3.0.8:

- [Ravager of Flesh](https://www.grimtools.com/monsterdb/364): 85 inline vitality
  resistance plus 26 from its resident `defensiveLife` passive, evaluated at rank
  `charLevel/4+1` = 26 at monster level 100, plus Ultimate's +12 offset, for a
  displayed 123. grimtools keeps one monsterdb entry per difficulty variant of this
  monster: [m363](https://www.grimtools.com/monsterdb/363) (Normal and Elite),
  [m364](https://www.grimtools.com/monsterdb/364) (Ultimate), and
  [m3843](https://www.grimtools.com/monsterdb/3843) (Ascendant).
- Death Revenant: our data splits this monster into two rows on pierce resistance,
  0 and 33, which grimtools confirms rather than contradicts. grimtools carries
  three Hero entries tagged the same name: [m249](https://www.grimtools.com/monsterdb/249)
  (pierce 0, matching our first row), and
  [m339](https://www.grimtools.com/monsterdb/339) and
  [m444](https://www.grimtools.com/monsterdb/444) (pierce 33 on both, identical
  across all ten types; the link matcher picks m339, the lower id, for our second
  row).
