-- ABOUTME: AE11 acceptance: damage conversion is modelled as from/to/percent triples, with
-- ABOUTME: multiple conversions per record preserved rather than collapsed.
-- Empty result = failure. Counts pinned to build 24346246; a game patch that shifts them
-- should fail this recipe so the pins are re-checked deliberately. The structural checks
-- below (both types present, every percent positive) are what actually prove the table;
-- the two counts only detect that it moved.
WITH multi AS (
    SELECT record, count(*) AS n FROM conversions GROUP BY record HAVING count(*) > 1
),
checks AS (
    SELECT
        (SELECT count(*) FROM conversions) = 2610 AS rows_present,
        (SELECT count(*) FROM conversions WHERE from_type IS NULL OR to_type IS NULL) = 0 AS types_present,
        (SELECT count(*) FROM conversions WHERE percent <= 0) = 0 AS percent_positive,
        (SELECT count(*) FROM multi) = 126 AS multi_conversion_preserved
)
SELECT c.record, c.from_type, c.to_type, c.percent
FROM conversions c CROSS JOIN checks k
WHERE k.rows_present AND k.types_present AND k.percent_positive AND k.multi_conversion_preserved
ORDER BY c.record, c.from_type, c.to_type
LIMIT 20;
