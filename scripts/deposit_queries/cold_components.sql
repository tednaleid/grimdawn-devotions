-- ABOUTME: AE1 acceptance query - components whose localized name or description contains
-- ABOUTME: "Cold" and whose level requirement is 20 or greater (facet AND range AND text).
-- Components live under records/items/materia/; their name tag is in `description`
-- and their body text tag in `itemText` (weapons use `itemNameTag` instead).
WITH comp AS (
    SELECT DISTINCT record FROM facts
    WHERE record LIKE 'records/items/materia/%'          -- facet: category
),
name_tag AS (
    SELECT record, value AS tag FROM facts
    WHERE key = 'description' AND record LIKE 'records/items/materia/%'
),
text_tag AS (
    SELECT record, value AS tag FROM facts
    WHERE key = 'itemText' AND record LIKE 'records/items/materia/%'
),
lvl AS (
    SELECT record, max(value_num) AS level_req FROM facts
    WHERE key = 'levelRequirement' AND record LIKE 'records/items/materia/%'
    GROUP BY record
)
SELECT nl.text AS name, CAST(lvl.level_req AS INTEGER) AS level_req, comp.record
FROM comp
JOIN name_tag nt ON nt.record = comp.record
JOIN labels nl ON nl.locale = 'en' AND nl.tag = nt.tag
LEFT JOIN text_tag tt ON tt.record = comp.record
LEFT JOIN labels tl ON tl.locale = 'en' AND tl.tag = tt.tag
JOIN lvl ON lvl.record = comp.record
WHERE lvl.level_req >= 20                                 -- range: usable at level 20+
  AND (nl.text ILIKE '%cold%' OR tl.text ILIKE '%cold%')  -- ANDed text search
ORDER BY level_req, name;
