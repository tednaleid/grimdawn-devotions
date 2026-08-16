-- ABOUTME: AE12 acceptance: the link-walking resolver names every mastery skill and
-- ABOUTME: every skill-boost target, and the two-hop pet-then-buff chains resolve.
-- Empty result = failure. Counts pinned to build 24756825. The structural checks are
-- what prove the walk; the counts only detect that the game moved underneath it.
WITH roster AS (
    SELECT DISTINCT value AS skill_record
    FROM facts
    WHERE regexp_matches(record, '_classtree_class(0[1-9]|10)\.dbr$')
      AND key LIKE 'skillName%'
      AND value NOT LIKE '%_classtraining_%'
),
targets AS (
    SELECT DISTINCT target AS skill_record FROM boosts WHERE kind = 'skill'
),
roster_named AS (
    SELECT r.skill_record, s.hops
    FROM roster r LEFT JOIN skill_effect s USING (skill_record)
),
target_named AS (
    SELECT t.skill_record, s.hops
    FROM targets t LEFT JOIN skill_effect s USING (skill_record)
),
checks AS (
    SELECT
        (SELECT count(*) FROM roster) = 315 AS roster_count_exact,
        (SELECT count(*) FROM roster_named WHERE hops IS NULL) = 0 AS every_roster_skill_named,
        (SELECT count(*) FROM target_named WHERE hops IS NULL) = 0 AS every_boost_target_named,
        (SELECT max(hops) FROM roster_named) = 2 AS max_two_hops,
        -- The six pet-modifier nodes that need petSkillName then buffSkillName.
        (SELECT count(*) FROM target_named WHERE hops = 2) = 6 AS two_hop_chains_exact
)
SELECT r.skill_record, r.hops
FROM roster_named r CROSS JOIN checks c
WHERE c.roster_count_exact AND c.every_roster_skill_named AND c.every_boost_target_named
  AND c.max_two_hops AND c.two_hop_chains_exact
ORDER BY r.hops DESC, r.skill_record
LIMIT 20;
