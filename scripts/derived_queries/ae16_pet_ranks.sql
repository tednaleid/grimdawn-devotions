-- ABOUTME: AE16 acceptance: the pet chain gives Summon Hellhound a panel a player can judge,
-- ABOUTME: pinning its pet's resistances and both of its rank-scaled ability damage blocks.
-- Empty result = failure. Values pinned to build 24756825, read off the game data.
WITH hh AS (
    SELECT source_kind, source_record, stat_id, at_first, at_max, at_ultimate
    FROM pet_ranks
    WHERE skill_record = 'records/skills/playerclass03/summon_hellhound1.dbr'
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
        -- Coverage: the 17 summons whose spawnObjects names a pet per rank plus
        -- the 3 pet-modifier nodes that swap the pet outright (modSpawnObjects),
        -- which are one-rank nodes indexed by their group base's rank.
        (SELECT count(DISTINCT skill_record) FROM pet_ranks) = 20 AS twenty_summons,
        (SELECT count(*) FROM pet_ranks) = 721 AS rows_exact,
        (SELECT count(*) FROM pet_ranks p
          WHERE NOT EXISTS (SELECT 1 FROM skills s WHERE s.record = p.skill_record))
          = 0 AS every_skill_on_the_roster,
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
        -- Unlike skill_ranks, nothing here legitimately falls with rank: a pet's
        -- abilities have no mana cost or cooldown column in this table, so a
        -- decreasing series would mean an index off by one.
        (SELECT count(*) FROM pet_ranks
          WHERE at_first >= 0 AND (at_max < at_first OR at_ultimate < at_max))
          = 0 AS monotonic,
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
  AND c.twenty_summons AND c.rows_exact AND c.every_skill_on_the_roster
  AND c.swapped_pet_scales AND c.no_null_breakpoints AND c.monotonic
  AND c.spawn_array_is_per_rank
  AND h.source_kind = 'pet_skill'
ORDER BY h.source_record, h.stat_id;
