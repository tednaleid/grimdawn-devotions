# Spec: celestial power proc + ability stats

## Goal

Celestial-power devotion nodes currently expose only `name`, `dbr`, `skill_class`,
and `description`. We want the actual ability: the proc trigger and the skill's
stats, the way grimtools shows them, surfaced in the web planner's star tooltip.

This work MUST run on a machine with the extracted Grim Dawn game files (Windows),
because the stats live in skill `.dbr` records the parser does not currently read.
The repo is reproducible from your own install; do not scrape grimtools or any
external source. Use grimtools only as a correctness reference to check against.

## Concrete target (acceptance example)

For Akeron's Scorpion's celestial power "Scorpion Sting", the in-game / grimtools
tooltip is:

```
Scorpion Sting (25% Chance on Attack)
Spines coated with deadly toxin erupt around you.

Current Level : 25
1.5 Second Skill Recharge
6 Projectile(s)
100% Chance to pass through Enemies
0.1 Meter Radius
40% Weapon Damage
1125 Poison Damage over 5 Seconds
150 Reduced target's Defensive Ability for 5 Seconds
```

The parser output for this power must let the web UI reproduce this: the proc
line ("25% Chance on Attack"), the skill level (25), and each stat line. When in
doubt about a field name or unit, confirm the produced numbers match this example
(and spot-check 2-3 other powers, e.g. Falcon Swoop, Twin Fangs, against
grimtools).

## Current state (what exists)

- `data/devotions.json`: each star may have
  `celestial_power: { name, dbr, skill_class, description }`. No stats.
- `scripts/parse_devotions.py` (single-file, stdlib-only, run via `uv`):
  - `DB` / `read_dbr` load `.dbr` records as `dict[str,str]`.
  - `clean_text` + `tags` resolve display strings from `text_en`.
  - `PASSIVE_CLASSES = {"Skill_Passive", "SkillBuff_Passive"}`.
  - `extract_bonuses(skill)`: non-zero numeric stat ids from a PASSIVE record.
    Note line ~139: it deliberately SKIPS values containing `;` because those are
    per-level arrays that "belong to proc skills, not passives".
  - `parse_star(...)`: resolves devotionButton -> UI button -> skill record. If
    the skill `Class` is passive it extracts bonuses/racial/pet; otherwise it is a
    celestial-power node and calls `resolve_power_name`, storing `celestial_power`.
  - `resolve_power_name(db, tags, skill)`: walks `buffSkillName` /
    `petSkillName` / `modifierSkillName` children to find `skillDisplayName` +
    `skillBaseDescription`.

## The hard parts (read before coding)

1. Stats are PER-LEVEL ARRAYS. Most skill stat fields are semicolon-separated
   (`"10;20;30;..."`). The devotion grants the skill at a fixed level; you must
   pick the value at the granted level index (1-based level -> array index). The
   existing passive extractor skips these on purpose; the proc-skill extractor
   must instead select the right element.
   - Determine the granted level. grimtools shows "Current Level : 25" for
     Scorpion Sting. Find where this comes from (likely the skill's
     `skillMaxLevel`, or a level set on the devotion skill/button). VERIFY your
     chosen level reproduces both the "Current Level" number and the stat values
     in the acceptance example before trusting it.

2. The proc trigger + chance ("25% Chance on Attack"). Discover which field(s)
   hold the chance (25) and the trigger condition ("on Attack" vs "on Hit" vs
   "when Hit" vs "on Block" etc.). It may be on the granting skill record, the
   devotion button, or a controller record. Grep the Scorpion Sting skill `.dbr`
   for a field whose value is 25 and for a trigger/condition field, and confirm
   against the example. Map GD's internal trigger enum to the display words.

3. The stats live on the ATTACK skill and possibly its child skills (the same
   `buffSkillName` / `petSkillName` / `modifierSkillName` walk
   `resolve_power_name` already does). Damage-over-time and debuffs are often on a
   child/buff skill. Collect from the whole chain.

4. Likely stat fields (CONFIRM against real records; names may differ):
   `skillCooldownTime` (Second Skill Recharge), `projectileLaunchNumber`
   (Projectiles), a pass-through field (Chance to pass through Enemies),
   radius/area field (Meter Radius), `weaponDamagePct` (Weapon Damage), the
   `offensive*` / `offensiveSlow*` damage + duration ids (instant + DoT, e.g.
   `offensiveSlowPoisonMin` + `offensiveSlowPoisonDurationMin`), and
   target-debuff ids (e.g. reduced Defensive Ability + its duration). Many of
   these already have display formatting in `web/src/core/statFormat.ts`.

## Parser changes (`scripts/parse_devotions.py`)

- Add an extractor for proc skills that, given the granted skill record (and its
  child skills), returns:
  - `proc`: `{ "chance": <number>, "trigger": "<Attack|Hit|...>" }` (omit/null if
    the power is not a proc).
  - `level`: the granted skill level (the "Current Level" value).
  - `stats`: a map of RAW stat id -> numeric value at the granted level (mirror
    the `bonuses` convention: raw ids, numbers, non-zero only), PLUS the
    skill-meta fields needed for display that are not normal "stat" ids
    (`skillCooldownTime`, `projectileLaunchNumber`, radius, pass-through,
    `weaponDamagePct`). Keep raw ids; let the web layer format them.
- Extend the celestial-power branch of `parse_star` to attach
  `celestial_power.proc`, `celestial_power.level`, `celestial_power.stats`.
- Keep stdlib-only, uv-runnable, and matching the file's style. Update the
  validation report at the end of the script if helpful (e.g. count of powers
  with parsed stats; warn on powers where stats came back empty).

## Output schema addition

```jsonc
"celestial_power": {
  "name": "Scorpion Sting",
  "dbr": "records/skills/devotion/tier1_02e_skill.dbr",
  "skill_class": "Skill_AttackProjectileRing",
  "description": "Spines coated with deadly toxin erupt around you.",
  "proc": { "chance": 25, "trigger": "Attack" },
  "level": 25,
  "stats": {
    "skillCooldownTime": 1.5,
    "projectileLaunchNumber": 6,
    "weaponDamagePct": 40,
    "offensiveSlowPoisonMin": 1125,
    "offensiveSlowPoisonDurationMin": 5
    // ...plus pass-through, radius, the DA debuff + its duration, etc.
  }
}
```

Final field names are your call; document them in a comment and keep them
consistent with the existing raw-id convention.

## Web UI changes (`web/`)

- `web/src/core/model.ts` + `web/src/core/types.ts`: extend `Star.celestialPower`
  to carry `proc`, `level`, and `stats`.
- `web/src/core/statFormat.ts`: add display formatting for the new skill-meta ids
  that are not already handled, GD-style:
  - `skillCooldownTime` -> "N Second Skill Recharge"
  - `projectileLaunchNumber` -> "N Projectile(s)"
  - `weaponDamagePct` -> "N% Weapon Damage"
  - radius -> "N Meter Radius"; pass-through -> "N% Chance to pass through Enemies"
  - DoT pairs like `offensiveSlowPoisonMin` + `offensiveSlowPoisonDurationMin`
    -> "1125 Poison Damage over 5 Seconds" (there is already DoT label logic for
    `offensiveSlow*`; extend to render the "X over Y Seconds" form for the power
    stats). Reuse existing formatting where ids overlap.
- `web/src/adapters/tooltipView.ts`: in the star tooltip, under the power name +
  description, render the proc line ("25% Chance on Attack"), optionally the
  level, then the formatted stat rows. Keep it readable; match the existing
  tooltip styling (see `.tip-power`, `.tip-power-desc`, `.tip-bonus`).
- TDD the new statFormat cases (anchor on the Scorpion Sting numbers).

## Verification (do all of these)

- `just parse` (or `just all` if you need to re-extract first) regenerates
  `data/devotions.json`. The script's validation report must pass (it exits
  non-zero on anomalies).
- Confirm Scorpion Sting in the regenerated JSON reproduces the acceptance
  example exactly (proc 25% on Attack, level 25, recharge 1.5, 6 projectiles,
  40% weapon damage, 1125 poison over 5s, the DA debuff). Spot-check 2-3 more
  powers against grimtools.
- `cd web && bunx tsc --noEmit` clean; `bun test` all green (add tests);
  `just build` succeeds.
- Drive the page (the repo has a playwright-core smoke pattern; chromium via
  `just install-e2e`) and confirm a power-star tooltip shows the proc + stats.
- Commit in logical steps (parser+data, then web UI), conventional messages
  ending with the repo's Co-Authored-By trailer. Do NOT use --no-verify. Push to
  `main` and confirm the GitHub Pages deploy succeeds
  (`gh run watch <id> --exit-status`).

## Notes / pitfalls

- The granted-level + level-array indexing is the most error-prone part; get it
  right first and the rest follows. If a stat looks 10x off, you probably picked
  the wrong level index or a per-level vs total value.
- Some powers are auras/buffs (not on-attack procs); `proc` may be absent or a
  different trigger. Handle a missing proc gracefully (no proc line).
- `extracted/` is git-ignored (~5 GB). Only `data/devotions.json` (and the other
  committed data outputs) should be committed, never the extracted tree.
