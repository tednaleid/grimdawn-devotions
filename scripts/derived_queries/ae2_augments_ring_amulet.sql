-- ABOUTME: AE2 acceptance: augments domain with the ring and amulet type buttons selected
-- ABOUTME: (applies-to semantics of the shared gear-type group) returns exactly 113 augments.
-- Empty result = failure: the count is pinned to build 24346246; a game patch that shifts
-- it should fail this recipe so the pin is re-checked deliberately. The pin was 97 at build
-- 19149150, cross-checked then against grimtools' amulet Augments tab. Fangs of Asterkarn
-- moved it to 113: Kurn (factionSource User17, new in 1.3.0.0) sells 14 of them, and the
-- other two are pre-existing factions gaining a ring/amulet augment each. 111 carry a
-- faction vendor row; the remaining 2 are curated blanks (factions.json unsold_augments).
WITH m AS (
    SELECT DISTINCT e.record, l.text AS name
    FROM entities e
    JOIN relations r ON r.src = e.record AND r.kind = 'applies_to'
                    AND r.dst IN ('ring', 'amulet')
    JOIN labels l ON l.tag = e.name_tag AND l.locale = 'en'
    WHERE e.domain = 'augment'
),
checks AS (SELECT count(*) = 113 AS ok FROM m)
SELECT m.name, m.record
FROM m CROSS JOIN checks c
WHERE c.ok
ORDER BY m.name;
