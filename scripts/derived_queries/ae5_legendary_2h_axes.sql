-- ABOUTME: AE5 acceptance: legendary two-handed axes count 17 records and The Guillotine's
-- ABOUTME: card fields match (required level 50, physique 426).
-- Empty result = failure. Grouping reconciliation: each record is its own entry (level
-- variants and renamed empowered copies included), so 17 = 17 entity rows across 10 name
-- groups; the group_key column shows the collapse a card UI would apply. The pin was 14
-- rows / 8 groups at build 19149150, reconciled then against grimtools. Fangs of Asterkarn
-- adds two name groups: Wrath of Tenebris (two level variants) and Soulsplitter, whose only
-- record is an Ascension craft under records/items/awakened.
WITH m AS (
    SELECT e.record, l.text AS name, e.group_key, e.req_level, e.req_physique,
           e.is_empowered, e.expansion
    FROM entities e
    JOIN labels l ON l.tag = e.name_tag AND l.locale = 'en'
    WHERE e.domain = 'gear' AND e.gear_type = 'axe2h' AND e.rarity = 'Legendary'
),
checks AS (
    SELECT count(*) = 17
           AND EXISTS (SELECT 1 FROM m
                       WHERE record = 'records/items/gearweapons/melee2h/d002_axe2h.dbr'
                         AND req_level = 50 AND req_physique = 426) AS ok
    FROM m
)
SELECT m.name, m.req_level, m.req_physique, m.is_empowered, m.expansion, m.record
FROM m CROSS JOIN checks c
WHERE c.ok
ORDER BY m.name, m.req_level;
