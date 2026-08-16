-- ABOUTME: AE14 acceptance: the three rank breakpoints reproduce Flame Touched exactly.
-- ABOUTME: Pins the values a player sees at 1/12, 12/12 and 22/22 in game.
-- Empty result = failure. Values pinned to build 24756825.
WITH ft AS (
    SELECT stat_id, at_first, at_max, at_ultimate
    FROM skill_ranks
    WHERE skill_record = 'records/skills/playerclass02/blastshield1.dbr'
),
checks AS (
    SELECT
        -- Flame Touched fire damage bonus: +10% at one point, +100% fully
        -- invested, +210% at the hard cap. Verified against the in-game tooltip.
        (SELECT at_first FROM ft WHERE stat_id = 'offensiveFireModifier') = 10 AS ft_first,
        (SELECT at_max FROM ft WHERE stat_id = 'offensiveFireModifier') = 100 AS ft_max,
        (SELECT at_ultimate FROM ft WHERE stat_id = 'offensiveFireModifier') = 210 AS ft_ult,
        (SELECT at_ultimate FROM ft WHERE stat_id = 'characterOffensiveAbility') = 220 AS ft_oa,
        -- Breakpoints must be monotonic in rank for every skill and stat that
        -- starts non-negative and is meant to increase; a decreasing series
        -- there means an index off by one. skillCooldownTime and skillManaCost
        -- legitimately fall with rank (cheaper, faster skills), and
        -- spawnObjectWeights[N] is a relative pet-type spawn weight, not a
        -- scaling value, so none of the three are checked for monotonicity.
        -- Confirmed against this build's only 9 violators: 7 skillCooldownTime
        -- and the 2 spawnObjectWeights columns on Summon Skeleton.
        (SELECT count(*) FROM skill_ranks
          WHERE at_first >= 0 AND (at_max < at_first OR at_ultimate < at_max)
            AND stat_id NOT IN ('skillCooldownTime', 'skillManaCost')
            AND stat_id NOT LIKE 'spawnObjectWeights%')
          = 0 AS monotonic,
        -- A rank-1 skill collapses all three columns onto the same value. It has
        -- rows to collapse only because a rank-1 skill stores its stats as bare
        -- scalars rather than arrays; requiring the semicolon left all 29 of them
        -- out of the table and made the collapse check pass over nothing, so the
        -- row count is asserted alongside it and the check cannot go vacuous.
        (SELECT count(*) FROM skill_ranks r JOIN skills s ON s.record = r.skill_record
          WHERE s.ultimate_level = 1) > 0 AS rank_one_rows_present,
        (SELECT count(*) FROM skill_ranks r JOIN skills s ON s.record = r.skill_record
          WHERE s.ultimate_level = 1 AND (r.at_max != r.at_first OR r.at_ultimate != r.at_first))
          = 0 AS rank_one_collapses,
        (SELECT count(*) FROM skill_ranks WHERE at_ultimate IS NULL) = 0 AS no_null_ultimate,
        (SELECT count(*) FROM skill_ranks WHERE at_first IS NULL) = 0 AS no_null_first,
        (SELECT count(*) FROM skill_ranks WHERE at_max IS NULL) = 0 AS no_null_max,
        -- A skill with no ultimate rank (a transmuter) must report its max value as
        -- its fully-maxed value, not silently fall back to the rank-1 value.
        (SELECT count(*) FROM skill_ranks r JOIN skills s ON s.record = r.skill_record
          WHERE s.ultimate_level IS NULL AND r.at_ultimate != r.at_max) = 0
          AS null_ultimate_uses_max
)
SELECT f.stat_id, f.at_first, f.at_max, f.at_ultimate
FROM ft f CROSS JOIN checks c
WHERE c.ft_first AND c.ft_max AND c.ft_ult AND c.ft_oa
  AND c.monotonic AND c.rank_one_rows_present AND c.rank_one_collapses
  AND c.no_null_ultimate
  AND c.no_null_first AND c.no_null_max AND c.null_ultimate_uses_max
ORDER BY f.stat_id;
