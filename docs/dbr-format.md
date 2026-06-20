# Grim Dawn devotion data model (as found in v1.2 / build 19149150)

This documents what we actually found in the extracted records — discovered by
inspection, not from a spec. Re-verify after any patch (key names drift).

## The two file types

- **`.arz`** — packed database archive (`database/database.arz`). Decompiled with
  `ArchiveTool.exe ... -database <out>` into a tree of `.dbr` files.
- **`.dbr`** — one record per file, stored *vertically*. Every line is
  `key,value,` with a **trailing comma**. Values can themselves contain `,` and
  `;`, so split on the **first** comma only and strip the single trailing one.
- **Translations** — `Text_EN.arc` extracts to `text_en/text_en/tags_*.txt`,
  lines of `tag=Display Text`. Text fields in `.dbr` store a *tag*
  (`tagDevotion_A01`), never display text. Resolve via the tag table.

## Where devotion data lives

Two parallel trees, joined by `skillName` references:

| Path | Role |
|---|---|
| `records/ui/skills/devotion/constellations/constellationNN.dbr` | constellation definition (gameplay-ish + layout) |
| `records/ui/skills/devotion/constellations/constellationNN_background.dbr` | just the artwork (`bitmapName` → a `.tex`) — ignore |
| `records/ui/skills/devotion/tierT_NN{a..}.dbr` | a **star button** (UI): `skillName` → the real skill |
| `records/skills/devotion/tierT_NN{a..}.dbr` | the **star skill** (the actual stats / power) |

In v1.2 there are **86 constellations**: 42 Tier‑1 (incl. 5 Crossroads),
31 Tier‑2, 13 Tier‑3. 438 stars total. Note: the `constellationNN` numbers are
**not** contiguous with tier or display order — discover by reading each record.

## Constellation record (`constellationNN.dbr`)

```
templateName,database/templates/ingameui/devotionconstellation.tpl,
FileDescription,Bat,                         # internal name (English-ish)
constellationDisplayTag,tagDevotion_A01,     # → resolves to "Bat"
affinityRequired1,1,  affinityRequiredName1,Eldritch,   # unlock cost: {eldritch:1}
affinityGiven1,2,     affinityGivenName1,Chaos,         # completion bonus part 1
affinityGiven2,3,     affinityGivenName2,Eldritch,      #   → {chaos:2, eldritch:3}
devotionButton1,records/ui/skills/devotion/tier1_01a.dbr,   # star 0
devotionButton2,...tier1_01b.dbr,                            # star 1
devotionLinks2,1,    # star 2 (button2) requires star 1 (button1) first
devotionLinks3,2,    # → predecessor chain, 1-based indices
```

- `affinityRequired{i}` / `affinityRequiredName{i}` (i=1..3): unlock thresholds.
- `affinityGiven{i}` / `affinityGivenName{i}` (i=1..3): affinity granted **on
  completing the whole constellation**. Tier‑3 constellations grant none.
- Affinity names are display strings (`Chaos`, `Eldritch`, …). Lowercase them to
  the five internal keys: `ascendant, chaos, eldritch, order, primordial`.
- `devotionButton{n}` (n=1..): the ordered stars.
- `devotionLinks{n}`: the **predecessor** of star n, as a 1-based button index.
  Star 1 has no link. The result is a tree/forest rooted at star 1.

## Star skill record (`records/skills/devotion/...`)

A huge, sparse `skill_passive` record (~700 keys, almost all `0`). Only the
non-zero numeric keys are real bonuses, e.g. `offensiveLifeModifier,15.000000`
(= +15% Vitality damage — note GD's internal "Life" = **Vitality**).

- **Bonuses**: every key with a non-zero, single-number value, excluding weapon
  flags and bookkeeping (`skillMaxLevel`, `isCircular`, …). Keep raw stat ids.
- **Weapon requirement**: flags at the top (`Sword,1`, `Sword2h,1`, …). A set
  flag means the star's bonus only applies with that weapon. `skillBaseDescription`
  → `tagDevotion_RequiresSword` → "Requires a sword."
- **Pet bonus**: `petBonusName,records/skills/devotion/..._petbonus.dbr` — a
  sub-record of pet-only stats (captured separately as `pet_bonuses`).
- **Racial bonus**: `racialBonusPercentDamage/Defense` apply only vs a monster
  race named by `racialBonusRace` (`Race012` → `tagRace012` → "Beast"). Captured
  as `racial_target`.

## Celestial power node

Some stars grant a celestial power (a triggered proc) instead of passive stats.
The button's `skillName` points at a skill whose `Class` is **not**
`Skill_Passive` (e.g. `Skill_AttackProjectileBurst`, `Skill_BuffRadius`,
`Skill_BuffSelfDuration`, `SkillBuff_Debuf`, …).

- Direct attack skills carry the name in `skillDisplayName`
  (`tagDevotionEffectA01` → "Twin Fangs").
- **Aura/buff powers** carry no `skillDisplayName` of their own; it lives on the
  child skill referenced by `buffSkillName` (then resolve *that* skill's
  `skillDisplayName`). Final fallback: `FileDescription` is `"<Constellation> -
  <Power>"`, so the power name is the part after `" - "`.

## Crossroads (the bootstrap)

Modeled as **5 separate single-star constellations** (all display "Crossroads"),
each with `affinityRequired=∅`, one star granting a small passive, and
`affinityGiven={one color:1}`. We disambiguate their ids by granted affinity
(`crossroads_ascendant`, …).

## Gotchas

1. One `.dbr` = one record (vertical), not a CSV row.
2. Trailing comma on every line; values may contain `,`/`;`.
3. Union-wide sparse schema — don't assume a fixed key set.
4. All values are strings; cast as needed. `;`-separated values are per-level
   arrays (proc skills), not passive scalars.
5. Open text with `utf-8-sig`, `errors="replace"` (BOM / stray bytes).
6. Relationships are by `.dbr` path; resolve them against the db root (the
   folder that contains `records/`).
