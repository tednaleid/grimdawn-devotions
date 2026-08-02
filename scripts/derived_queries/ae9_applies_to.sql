-- ABOUTME: AE9 acceptance: applies_to edges cover every augment/component except the pinned
-- ABOUTME: template blank, with three card oracles (Spiritguard, Ancient Armor Plate, Amatok).
-- Empty result = failure. Pins at build 19149150: 446 of 447 augment/component records carry
-- applies_to edges (the gap is the dev template blank a00_blank.dbr), and three card oracles:
-- Spiritguard Powder = the seven armor slots ("all armor"), Ancient Armor Plate = chest+legs,
-- Rune of Amatok's Breath = medal only. A game patch that shifts any of these should fail
-- this recipe so the pins are re-checked against grimtools/in-game text.
WITH ap AS (
    SELECT e.record, l.text AS name, r.dst
    FROM entities e
    JOIN relations r ON r.src = e.record AND r.kind = 'applies_to'
    LEFT JOIN labels l ON l.locale = 'en' AND l.tag = e.name_tag
    WHERE e.domain IN ('augment', 'component')
),
sets AS (
    SELECT name, list(DISTINCT dst ORDER BY dst) AS slots FROM ap GROUP BY name
),
uncovered AS (
    SELECT record FROM entities
    WHERE domain IN ('augment', 'component')
      AND record NOT IN (SELECT record FROM ap)
),
checks AS (
    SELECT
      (SELECT slots FROM sets WHERE name = 'Spiritguard Powder')
        = ['chest', 'feet', 'hands', 'head', 'legs', 'shoulders', 'waist']
      AND (SELECT slots FROM sets WHERE name = 'Ancient Armor Plate') = ['chest', 'legs']
      AND (SELECT slots FROM sets WHERE name = 'Rune of Amatok''s Breath') = ['medal']
      AND (SELECT count(*) FROM uncovered) = 1
      AND (SELECT record FROM uncovered) = 'records/items/enchants/a00_blank.dbr'
      AS ok
)
SELECT s.name, s.slots
FROM sets s CROSS JOIN checks c
WHERE c.ok
  AND s.name IN ('Spiritguard Powder', 'Ancient Armor Plate', 'Rune of Amatok''s Breath')
ORDER BY s.name;
