-- ABOUTME: AE2 acceptance: augments domain with the ring and amulet type buttons selected
-- ABOUTME: (applies-to semantics of the shared gear-type group) returns exactly 97 augments.
-- Empty result = failure: the count is pinned to build 19149150 (grimtools' amulet
-- Augments tab shows the same 97); a game patch that shifts it should fail this recipe
-- so the pin is re-checked deliberately.
WITH m AS (
    SELECT DISTINCT e.record, l.text AS name
    FROM entities e
    JOIN relations r ON r.src = e.record AND r.kind = 'applies_to'
                    AND r.dst IN ('ring', 'amulet')
    JOIN labels l ON l.tag = e.name_tag AND l.locale = 'en'
    WHERE e.domain = 'augment'
),
checks AS (SELECT count(*) = 97 AS ok FROM m)
SELECT m.name, m.record
FROM m CROSS JOIN checks c
WHERE c.ok
ORDER BY m.name;
