-- ABOUTME: AE16 acceptance: the pet chain gives every summon archetype a panel a player can judge,
-- ABOUTME: pinning pet resistances, rank-scaled ability damage, and that no reachable grant is lost.
-- Empty result = failure. Values pinned to build 24756825, read off the game data.
WITH RECURSIVE hh AS (
    SELECT source_kind, source_record, stat_id, at_first, at_max, at_ultimate
    FROM pet_ranks
    WHERE skill_record = 'records/skills/playerclass03/summon_hellhound1.dbr'
),
-- The coverage gate below re-derives the pet chain from facts alone rather than
-- reading pet_ranks' own inputs, so it is an independent check on the builder:
-- which creature a summon spawns, which abilities that creature is granted at a
-- positive level, and whether the stats those abilities carry are reachable.
rank_keys AS (
    SELECT DISTINCT key FROM facts
    WHERE record LIKE 'records/skills/%' AND value LIKE '%;%'
      AND NOT regexp_matches(value, '[A-Za-z/]')
),
summon AS (
    SELECT s.record AS skill_record,
           coalesce(g.max_level, s.max_level) AS max_level,
           coalesce(g.ultimate_level, s.ultimate_level) AS ultimate_level,
           str_split(f.value, ';') AS pets
    FROM skills s
    JOIN facts f ON f.record = s.effect_record
                AND f.key IN ('spawnObjects', 'modSpawnObjects')
                AND trim(f.value) != ''
    LEFT JOIN skills g ON f.key = 'modSpawnObjects' AND g.record = s.group_record
),
bp AS (
    SELECT skill_record, pets[1] AS at_pet FROM summon
    UNION ALL
    SELECT skill_record,
           pets[least(greatest(coalesce(max_level, 1), 1), len(pets))] FROM summon
    UNION ALL
    SELECT skill_record,
           pets[least(greatest(coalesce(ultimate_level, max_level, 1), 1), len(pets))]
    FROM summon
),
grants AS (
    SELECT DISTINCT b.skill_record, lower(trim(n.value)) AS ability
    FROM bp b
    JOIN facts n ON n.record = b.at_pet
                AND n.key LIKE 'skillName%' AND trim(n.value) != ''
    JOIN facts l ON l.record = b.at_pet
                AND l.key = 'skillLevel' || substr(n.key, 10)
    -- Level 0 is an inactive modifier slot and a charLevel equation tracks the
    -- player, not the summon's rank; neither has a value at a rank breakpoint.
    WHERE TRY_CAST(l.value AS INTEGER) > 0
),
walk(root, cur, depth) AS (
    SELECT DISTINCT ability, ability, 0 FROM grants
    UNION ALL
    SELECT w.root, f.value, w.depth + 1
    FROM walk w
    JOIN facts f ON f.record = w.cur
                AND f.key IN ('buffSkillName', 'petSkillName')
                AND f.value LIKE 'records/skills/%'
    WHERE w.depth < 8
),
reachable AS (
    SELECT DISTINCT w.root FROM walk w
    WHERE EXISTS (SELECT 1 FROM facts f
                  WHERE f.record = w.cur
                    AND f.key IN (SELECT key FROM rank_keys)
                    AND f.key NOT IN ('spawnObjects', 'modSpawnObjects',
                                      'petChanges', 'fxChanges', 'projectileOverride',
                                      'radiusEffectName', 'skillProjectileName',
                                      'skillConnectionOn', 'skillConnectionOff')
                    AND NOT regexp_matches(f.value, '[A-Za-z/]')
                    AND (f.value LIKE '%;%'
                         OR (f.value_num IS NOT NULL AND f.value_num != 0)))
),
uncovered AS (
    SELECT g.skill_record, g.ability
    FROM grants g
    JOIN reachable r ON r.root = g.ability
    WHERE NOT EXISTS (SELECT 1 FROM pet_ranks p
                      WHERE p.skill_record = g.skill_record
                        AND p.source_record = g.ability)
),
checks AS (
    SELECT
        -- The whole point of the walk. Summon Hellhound's own record carries a
        -- mana cost, a cooldown and a pet cap and nothing else, so skill_ranks
        -- has four rows for it and none of them say what the pet does.
        (SELECT count(*) FROM skill_ranks
          WHERE skill_record = 'records/skills/playerclass03/summon_hellhound1.dbr')
          = 4 AS summon_own_stats_are_thin,
        (SELECT count(*) FROM hh) = 25 AS hellhound_rows_exact,
        -- The pet creature record: Hellhound is a fire pet, and its authored
        -- resistances say so. None of these move with the summon's rank.
        (SELECT at_first FROM hh WHERE source_kind = 'pet'
           AND stat_id = 'defensiveFire') = 500 AS hh_fire_resist,
        (SELECT at_ultimate FROM hh WHERE source_kind = 'pet'
           AND stat_id = 'defensiveFire') = 500 AS hh_fire_resist_flat,
        (SELECT at_first FROM hh WHERE source_kind = 'pet'
           AND stat_id = 'defensivePoison') = 75 AS hh_poison_resist,
        (SELECT at_first FROM hh WHERE source_kind = 'pet'
           AND stat_id = 'defensivePhysical') = 24 AS hh_physical_resist,
        (SELECT count(*) FROM hh WHERE source_kind = 'pet') = 13 AS hh_body_rows,
        -- Claw and Fang Attacks, the pet's innate: 6 fire damage at one point in
        -- the summon, 110 fully invested, 234 at the hard cap. This is the number
        -- a +4 to Summon Hellhound is actually buying.
        (SELECT at_first || '/' || at_max || '/' || at_ultimate FROM hh
          WHERE source_record = 'records/skills/playerclass03/pets/petskill_hellhound_innate1.dbr'
            AND stat_id = 'offensiveFireMin') = '6.0/110.0/234.0' AS hh_innate_fire,
        (SELECT at_ultimate FROM hh
          WHERE source_record = 'records/skills/playerclass03/pets/petskill_hellhound_innate1.dbr'
            AND stat_id = 'offensivePhysicalMax') = 191 AS hh_innate_physical,
        -- The generic pet growth passive every summon shares: +90% health and
        -- +180% total damage fully invested, +150% and +365% at the hard cap,
        -- and nothing at all at rank 1.
        (SELECT at_first || '/' || at_max || '/' || at_ultimate FROM hh
          WHERE source_record = 'records/skills/playerclass03/pets/petskill_raven_innate1.dbr'
            AND stat_id = 'offensiveTotalDamageModifier') = '0.0/180.0/365.0' AS hh_growth_damage,
        (SELECT at_max FROM hh
          WHERE source_record = 'records/skills/playerclass03/pets/petskill_raven_innate1.dbr'
            AND stat_id = 'characterLifeModifier') = 90 AS hh_growth_life,
        -- The load-bearing reason this is not part of skill_ranks: one summon has
        -- two sources naming offensiveFireMin with different numbers, which a
        -- (skill_record, stat_id) key would collide into one row.
        (SELECT count(*) FROM hh WHERE stat_id = 'offensiveFireMin') = 2 AS two_fire_carriers,
        (SELECT at_ultimate FROM hh
          WHERE source_record = 'records/skills/playerclass03/pets/petskill_hellhound_detonate.dbr'
            AND stat_id = 'offensiveFireMin') = 708 AS hh_detonate_fire,

        -- Every check above is Summon Hellhound, whose abilities all happen to
        -- carry their stats directly. The four below are the other archetypes -
        -- a trap, a wind devil, a totem and an aura seal - and every one of them
        -- reaches its numbers through a buffSkillName hop off a stat-less shell.
        -- Together they are the value oracle for the walk: read straight off the
        -- granted record instead, all four blocks are simply absent.
        -- Thermite Mine's flare: fire damage plus the elemental resistance debuff
        -- the card reads as "-40% Elemental Resistance" at the hard cap.
        (SELECT at_first || '/' || at_max || '/' || at_ultimate FROM pet_ranks
          WHERE skill_record = 'records/skills/playerclass02/thermitemines1.dbr'
            AND source_record = 'records/skills/playerclass02/pets/thermitemine_skill_flare1.dbr'
            AND stat_id = 'offensiveFireMin') = '36.0/218.0/420.0' AS mine_flare_fire,
        (SELECT at_first || '/' || at_max || '/' || at_ultimate FROM pet_ranks
          WHERE skill_record = 'records/skills/playerclass02/thermitemines1.dbr'
            AND source_record = 'records/skills/playerclass02/pets/thermitemine_skill_flare1.dbr'
            AND stat_id = 'offensiveSlowFireMin') = '15.0/116.0/236.0' AS mine_flare_burn,
        (SELECT at_ultimate FROM pet_ranks
          WHERE skill_record = 'records/skills/playerclass02/thermitemines1.dbr'
            AND source_record = 'records/skills/playerclass02/pets/thermitemine_skill_flare1.dbr'
            AND stat_id = 'defensiveElementalResistance') = -40 AS mine_flare_debuff,
        -- Wind Devil's whirlwind, the in-game card at the hard cap: "242 Physical
        -- Damage, 382-463 Lightning Damage over 3 Seconds, 60% Chance of Impaired
        -- Aim". All four numbers live one hop past the ability the pet is granted.
        (SELECT at_ultimate FROM pet_ranks
          WHERE skill_record = 'records/skills/playerclass06/squall1.dbr'
            AND source_record = 'records/skills/playerclass06/pets/petskill_whirlwind_whirlwind.dbr'
            AND stat_id = 'offensivePhysicalMin') = 242 AS devil_physical,
        (SELECT at_first || '/' || at_max || '/' || at_ultimate FROM pet_ranks
          WHERE skill_record = 'records/skills/playerclass06/squall1.dbr'
            AND source_record = 'records/skills/playerclass06/pets/petskill_whirlwind_whirlwind.dbr'
            AND stat_id = 'offensiveSlowLightningMin') = '12.0/213.0/382.0' AS devil_lightning_min,
        (SELECT at_ultimate FROM pet_ranks
          WHERE skill_record = 'records/skills/playerclass06/squall1.dbr'
            AND source_record = 'records/skills/playerclass06/pets/petskill_whirlwind_whirlwind.dbr'
            AND stat_id = 'offensiveSlowLightningMax') = 463 AS devil_lightning_max,
        (SELECT at_ultimate FROM pet_ranks
          WHERE skill_record = 'records/skills/playerclass06/squall1.dbr'
            AND source_record = 'records/skills/playerclass06/pets/petskill_whirlwind_whirlwind.dbr'
            AND stat_id = 'offensiveProjectileFumbleMin') = 60 AS devil_fumble,
        -- Wendigo Totem heals rather than hits, so its panel is a heal block:
        -- 60 life at one point, 500 fully invested, 1350 at the hard cap.
        (SELECT at_first || '/' || at_max || '/' || at_ultimate FROM pet_ranks
          WHERE skill_record = 'records/skills/playerclass06/totem1.dbr'
            AND source_record = 'records/skills/playerclass06/pets/petskill_totem_heal_01.dbr'
            AND stat_id = 'skillLifeBonus') = '60.0/500.0/1350.0' AS totem_heal_flat,
        (SELECT at_first || '/' || at_max || '/' || at_ultimate FROM pet_ranks
          WHERE skill_record = 'records/skills/playerclass06/totem1.dbr'
            AND source_record = 'records/skills/playerclass06/pets/petskill_totem_heal_01.dbr'
            AND stat_id = 'skillLifePercent') = '3.0/6.0/9.0' AS totem_heal_percent,
        -- Inquisitor Seal carries two auras on one creature, a defensive and an
        -- offensive one, each a shell over its own buff record. Both must appear,
        -- and they must stay two rows: source_record is what separates them.
        (SELECT at_first || '/' || at_max || '/' || at_ultimate FROM pet_ranks
          WHERE skill_record = 'records/skills/playerclass07/arcaneseal1.dbr'
            AND source_record = 'records/skills/playerclass07/pets/petskill_arcaneseal_defenseaura.dbr'
            AND stat_id = 'damageAbsorption') = '34.0/190.0/430.0' AS seal_absorb,
        (SELECT at_ultimate FROM pet_ranks
          WHERE skill_record = 'records/skills/playerclass07/arcaneseal1.dbr'
            AND source_record = 'records/skills/playerclass07/pets/petskill_arcaneseal_defenseaura.dbr'
            AND stat_id = 'defensiveElementalResistance') = 40 AS seal_elemental,
        (SELECT at_first || '/' || at_max || '/' || at_ultimate FROM pet_ranks
          WHERE skill_record = 'records/skills/playerclass07/arcaneseal1.dbr'
            AND source_record = 'records/skills/playerclass07/pets/petskill_arcaneseal_offenseaura.dbr'
            AND stat_id = 'offensiveFireMin') = '30.0/240.0/490.0' AS seal_fire,

        -- Coverage: the 17 summons whose spawnObjects names a pet per rank plus
        -- the 3 modifier nodes that swap the pet outright (modSpawnObjects),
        -- which are one-rank nodes indexed by their group base's rank. All three
        -- are node_kind 'modifier'; none of the 22 'pet_modifier' nodes is here.
        (SELECT count(DISTINCT skill_record) FROM pet_ranks) = 20 AS twenty_summons,
        (SELECT count(*) FROM pet_ranks) = 743 AS rows_exact,
        -- The gate the archetype oracles above generalise: every ability a pet is
        -- granted at a positive level, whose chain reaches a record carrying a
        -- rank-scaling stat, contributes at least one row. Deleting a block can no
        -- longer pass unnoticed, because absence is what this counts. Re-derived
        -- above from facts, so it fails when the builder's walk stops short: at
        -- build 24756825 five grants (thermitemine_skill_flare1,
        -- petskill_whirlwind_whirlwind, petskill_totem_heal_01 and the two
        -- arcaneseal auras) are shells whose stats are one buffSkillName hop away.
        (SELECT count(*) FROM uncovered) = 0 AS every_reachable_grant_contributes,
        -- The other direction: a summon that spawns a pet at all has rows. Unlike
        -- a NOT EXISTS against skills, which pet_ranks joins and so can never
        -- fail, this can: a summon dropping out of the table entirely trips it.
        (SELECT count(*) FROM skills s
          JOIN facts f ON f.record = s.effect_record
                      AND f.key IN ('spawnObjects', 'modSpawnObjects')
                      AND trim(f.value) != ''
          WHERE NOT EXISTS (SELECT 1 FROM pet_ranks p WHERE p.skill_record = s.record))
          = 0 AS every_summon_has_rows,
        -- One of the three swapped-pet nodes, proving it borrows its base
        -- summon's 1/16/26 rather than its own single rank.
        (SELECT at_first || '/' || at_max || '/' || at_ultimate FROM pet_ranks
          WHERE skill_record = 'records/skills/playerclass08/summon_blightbeast1b.dbr'
            AND source_record = 'records/skills/playerclass08/pets/petskill_blightbeast_violentbarf.dbr'
            AND stat_id = 'offensivePoisonMin') = '20.0/244.0/413.0' AS swapped_pet_scales,
        -- Every breakpoint is a real number: a NULL means a stat present at one
        -- rank vanished at another and the pivot silently produced a hole.
        (SELECT count(*) FROM pet_ranks
          WHERE at_first IS NULL OR at_max IS NULL OR at_ultimate IS NULL)
          = 0 AS no_null_breakpoints,
        -- Nothing in this table is authored to fall with rank today. The stats
        -- that legitimately could are the three flat skillCooldownTime rows and
        -- the debuffs that start negative (which this skips), so a series rising
        -- from zero or better and then dropping means the rank index is off by
        -- one. A patch that makes a pet cooldown fall with rank belongs in an
        -- explicit exemption here, not in a loosened check.
        (SELECT count(*) FROM pet_ranks
          WHERE at_first >= 0 AND (at_max < at_first OR at_ultimate < at_max))
          = 0 AS monotonic,
        (SELECT count(*) FROM pet_ranks
          WHERE stat_id = 'skillCooldownTime') = 3 AS cooldown_rows_still_flat,
        -- The shape the whole table assumes: the spawn array is one entry per
        -- rank of the summon that drives it.
        (SELECT count(*) FROM skills s
          JOIN facts f ON f.record = s.effect_record
                      AND f.key IN ('spawnObjects', 'modSpawnObjects')
                      AND trim(f.value) != ''
          LEFT JOIN skills g ON f.key = 'modSpawnObjects' AND g.record = s.group_record
          WHERE len(str_split(f.value, ';'))
                != coalesce(g.ultimate_level, s.ultimate_level))
          = 0 AS spawn_array_is_per_rank
)
SELECT h.source_kind, h.source_record, h.stat_id, h.at_first, h.at_max, h.at_ultimate
FROM hh h CROSS JOIN checks c
WHERE c.summon_own_stats_are_thin AND c.hellhound_rows_exact
  AND c.hh_fire_resist AND c.hh_fire_resist_flat AND c.hh_poison_resist
  AND c.hh_physical_resist AND c.hh_body_rows
  AND c.hh_innate_fire AND c.hh_innate_physical
  AND c.hh_growth_damage AND c.hh_growth_life
  AND c.two_fire_carriers AND c.hh_detonate_fire
  AND c.mine_flare_fire AND c.mine_flare_burn AND c.mine_flare_debuff
  AND c.devil_physical AND c.devil_lightning_min AND c.devil_lightning_max
  AND c.devil_fumble
  AND c.totem_heal_flat AND c.totem_heal_percent
  AND c.seal_absorb AND c.seal_elemental AND c.seal_fire
  AND c.twenty_summons AND c.rows_exact
  AND c.every_reachable_grant_contributes AND c.every_summon_has_rows
  AND c.swapped_pet_scales AND c.no_null_breakpoints AND c.monotonic
  AND c.cooldown_rows_still_flat
  AND c.spawn_array_is_per_rank
  AND h.source_kind = 'pet_skill'
ORDER BY h.source_record, h.stat_id;
