-- ABOUTME: AE3 acceptance query - text search against German label text with per-tag
-- ABOUTME: English fallback (COALESCE), over all item name tags.
-- The `source` column shows which locale each match came from: a tag missing from
-- the de table still appears (and is searchable) through its English text.
WITH nt AS (
    SELECT record, value AS tag FROM facts
    WHERE key IN ('itemNameTag', 'description') AND record LIKE 'records/items/%'
),
de AS (SELECT tag, text FROM labels WHERE locale = 'de'),
en AS (SELECT tag, text FROM labels WHERE locale = 'en')
SELECT DISTINCT coalesce(de.text, en.text) AS name,
       CASE WHEN de.text IS NOT NULL THEN 'de' ELSE 'en (fallback)' END AS source,
       nt.record
FROM nt
JOIN en ON en.tag = nt.tag
LEFT JOIN de ON de.tag = nt.tag
WHERE lower(coalesce(de.text, en.text)) LIKE lower('%kälte%')
ORDER BY name, nt.record;
