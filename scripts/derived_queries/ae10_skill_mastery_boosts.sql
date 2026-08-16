-- ABOUTME: AE10 acceptance: the boosts table carries both kinds of skill bonus, with every
-- ABOUTME: skill boost resolving to the mastery its playerclass path names.
-- Empty result = failure. Counts pinned to build 24756825; a game patch that shifts them
-- should fail this recipe so the pins are re-checked deliberately. The structural checks
-- below (every boost resolves to a mastery, every level positive, a mastery boost targets
-- itself) are what actually prove the table; the two counts only detect that it moved.
WITH k AS (
    SELECT kind, count(*) AS n FROM boosts GROUP BY kind
),
sample AS (
    SELECT b.record, b.kind, b.target, b.mastery_record, b.level
    FROM boosts b
    WHERE b.kind = 'mastery'
),
checks AS (
    SELECT
        (SELECT n FROM k WHERE kind = 'skill') = 18862 AS skill_rows_exact,
        (SELECT n FROM k WHERE kind = 'mastery') = 1488 AS mastery_rows_exact,
        (SELECT count(*) FROM boosts WHERE mastery_record IS NULL) = 0 AS every_boost_has_mastery,
        (SELECT count(*) FROM boosts WHERE level <= 0) = 0 AS levels_positive,
        (SELECT count(*) FROM boosts WHERE kind = 'mastery' AND target != mastery_record) = 0 AS mastery_target_is_self
)
SELECT s.record, s.kind, s.target, s.mastery_record, s.level
FROM sample s CROSS JOIN checks c
WHERE c.skill_rows_exact AND c.mastery_rows_exact AND c.every_boost_has_mastery
  AND c.levels_positive AND c.mastery_target_is_self
ORDER BY s.record
LIMIT 20;
