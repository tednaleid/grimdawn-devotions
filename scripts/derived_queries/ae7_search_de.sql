-- ABOUTME: AE7 acceptance: localized text search over entity names/text AND granted-skill
-- ABOUTME: name/description, German with per-tag English fallback.
-- Empty result = failure. Two legs: 'Kälte' matches item names from de labels; the
-- distinctive Doom Bolt description text ('entropischer') surfaces Wrath of Tenebris
-- through its granted skill - skill text is searchable, like the devotions Cold filter.
WITH tags AS (
    SELECT record, name_tag AS tag, 'name' AS kind FROM entities WHERE name_tag IS NOT NULL
    UNION ALL
    SELECT record, text_tag, 'text' FROM entities WHERE text_tag IS NOT NULL
    UNION ALL
    SELECT r.src, f.value, 'skill'
    FROM relations r
    JOIN facts f ON f.record = r.dst AND f.key IN ('skillDisplayName', 'skillBaseDescription')
    WHERE r.kind = 'grants_skill' AND f.value != ''
),
loc AS (
    SELECT t.record, t.kind, COALESCE(d.text, en.text) AS text
    FROM tags t
    LEFT JOIN labels d ON d.tag = t.tag AND d.locale = 'de'
    LEFT JOIN labels en ON en.tag = t.tag AND en.locale = 'en'
),
hits AS (
    SELECT DISTINCT 'Kälte' AS term, l.record, loc.kind, loc.text
    FROM loc JOIN entities l USING (record)
    WHERE loc.text ILIKE '%kälte%' AND loc.kind = 'name'
    UNION ALL
    SELECT DISTINCT 'entropischer (Doom Bolt)', loc.record, loc.kind, loc.text
    FROM loc
    WHERE loc.text ILIKE '%entropischer%' AND loc.kind = 'skill'
),
checks AS (
    SELECT EXISTS (SELECT 1 FROM hits WHERE term = 'Kälte')
       AND EXISTS (SELECT 1 FROM hits
                   WHERE term LIKE 'entropischer%'
                     AND record = 'records/items/gearweapons/melee2h/d205_axe2h.dbr') AS ok
)
SELECT h.term, COALESCE(l.text, h.record) AS name, h.kind, h.record
FROM hits h
JOIN entities e ON e.record = h.record
LEFT JOIN labels l ON l.tag = e.name_tag AND l.locale = 'de'
CROSS JOIN checks c
WHERE c.ok
ORDER BY h.term, name, h.record;
